// 本地算法调度：把「选哪个算法」翻译成一次本地 pipeline 调用。
// 不再依赖 ManiaMapAnalyser 目录；MMA 只在用户显式选择 Follow MMA 时才被读取。
import { APP } from "./config.js";
import { getSetting } from "./settings.js";
import { getMode } from "./modes/index.js";

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./estimateWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
        const message = event.data;
        if (!message || typeof message.id === "undefined") return;
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        if (item.timer) clearTimeout(item.timer);
        item.resolve(message);
    };
    worker.onerror = (event) => {
        const error = new Error(event?.message || "estimator worker failed");
        for (const [id, item] of pending) {
            pending.delete(id);
            if (item.timer) clearTimeout(item.timer);
            item.reject(error);
        }
        try { worker.terminate(); } catch { /* ignore */ }
        worker = null;
    };
    return worker;
}

export function warmupEstimators() {
    try {
        getWorker().postMessage({ id: 0, warmup: true });
    } catch {
        // 预热失败不影响正常流程
    }
}

function postToWorker(payload, timeoutMs) {
    const workerRef = getWorker();
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("estimator timeout"));
        }, timeoutMs || APP.estimatorTimeoutMs);
        pending.set(id, {
            resolve: (message) => {
                clearTimeout(timer);
                resolve(message);
            },
            reject,
            timer,
        });
        try {
            workerRef.postMessage({ id, ...payload });
        } catch (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
        }
    });
}

// ---- 算法选择 ----

const ALL_ALGORITHMS = ["Sunny", "Daniel", "Azusa", "Roxy", "Mixed", "Companella"];
// Azusa / Roxy 的源码里明确只支持 4K；Companella 依赖 4K 的 MSD 口径
const KEYS_ALGORITHMS = {
    4: ALL_ALGORITHMS,
    6: ["Sunny", "Daniel", "Mixed"],
    7: ["Sunny", "Daniel", "Mixed"],
};

/** 该键数可用的算法列表。 */
export function availableAlgorithms(keys) {
    return KEYS_ALGORITHMS[Number(keys)] || ["Sunny"];
}

/** 该键数当前选中的算法（面板下拉 > 默认值）。 */
export function algorithmFor(keys) {
    const mode = getMode(keys);
    if (!mode) return "Sunny";
    const list = availableAlgorithms(keys);
    const fallback = APP.defaultAlgorithm || "Mixed";
    const picked = getSetting(`algorithm${mode.label}`, fallback);
    if (list.includes(picked)) return picked;
    return list.includes(fallback) ? fallback : list[0];
}

// ---- 结果归一化 ----

/** 「RC || LN」拆两半。 */
export function splitCombinedLabel(text) {
    const parts = String(text || "").split("||").map((part) => part.trim()).filter(Boolean);
    return { rc: parts[0] || "", ln: parts[1] || "" };
}

export function normalizeResult(result) {
    const finalParts = splitCombinedLabel(result.estDiff);
    const sunnyParts = splitCombinedLabel(result.sunnyWindowEstDiff);
    // RC 和 LN 必须来自**同一套算法**，否则会出现「米段对、LN 错」的割裂。
    // 之前这里优先取 SunnyWindow 的 LN（那是为了 0.3.x 在 enableAnalyzeLN=false 时补 LN），
    // 结果 7K 上 SunnyWindow 的 LN 常比所选算法低好几档，甚至掉到 "LN 0"。
    // 现在以 estDiff 为准，只有它没给 LN 时才回退到 SunnyWindow。
    const lnLabel = finalParts.ln || sunnyParts.ln;
    const baseAlgorithm = String(result.algorithm || "?");
    const algorithm = result.companellaMerged && !/companella/i.test(baseAlgorithm)
        ? `${baseAlgorithm}→Companella`
        : baseAlgorithm;
    return {
        rcLabel: finalParts.rc,
        lnLabel: lnLabel.startsWith("<") ? "" : lnLabel,
        numeric: Number.isFinite(Number(result.numeric)) ? Number(result.numeric) : null,
        star: Number.isFinite(Number(result.star)) ? Number(result.star) : null,
        algorithm,
    };
}

/** 整图分析：按选中的算法在本地跑一遍。 */
export async function analyzeWhole({ text, mods, algorithm, keys }) {
    const needsEtt = Number(keys) === 4 && /companella|mixed/i.test(String(algorithm));
    const options = {
        speedRate: mods.rate,
        odFlag: mods.odFlag,
        cvtFlag: mods.cvtFlag,
        withGraph: false,
        withPattern: false,
        withEtterna: needsEtt,
        withInterlude: needsEtt,
        withPpMetrics: false,
        enableAnalyzeLN: true,
        enableAlwaysShowLNDifficulty: true,
        forceSunnyReferenceHo: true,
        forceSunnyWindow: true,
        display6kLevel: true,
        extendedEstimationRange: Boolean(APP.extendedRange),
        etternaVersion: APP.etternaVersion,
        companellaEtternaVersion: APP.companellaEtternaVersion,
    };
    const message = await postToWorker({ text, algorithm, options }, APP.estimatorTimeoutMs);
    if (!message || !message.ok) {
        throw new Error(message?.error || "estimator failed");
    }
    return normalizeResult(message);
}

// ---- 整图结果缓存（按 谱面+mods，不按算法；换算法即重算）----

// v3：normalize 改了 LN 的取值来源，旧缓存里的 LN 是错的，必须整批作废
const RESULT_CACHE_PREFIX = "mld.est.v3:";

export function readCachedResult(identityKey) {
    if (!identityKey) return null;
    try {
        const raw = localStorage.getItem(RESULT_CACHE_PREFIX + identityKey);
        if (!raw) return null;
        const value = JSON.parse(raw);
        return value && value.rcLabel ? value : null;
    } catch {
        return null;
    }
}

export function writeCachedResult(identityKey, result) {
    if (!identityKey || !result || !result.rcLabel) return;
    try {
        localStorage.setItem(RESULT_CACHE_PREFIX + identityKey, JSON.stringify({
            rcLabel: result.rcLabel,
            lnLabel: result.lnLabel,
            numeric: result.numeric,
            star: result.star,
            algorithm: result.algorithm,
        }));
    } catch {
        // 无 localStorage 或配额满：忽略
    }
}

export function clearCachedResult(identityKey) {
    if (!identityKey) return;
    try {
        localStorage.removeItem(RESULT_CACHE_PREFIX + identityKey);
    } catch {
        // ignore
    }
}
