// Prism 难度计算引擎（6K / 7K / 8K）。
//
// 上游：aleju03/mania-hub `algorithms/prism`（Rust, MIT, v0.25）。
// 本项目未改动其任何算法逻辑，只是把它原样编译成 wasm，再用一层纯 C-ABI 出口包起来。
// 出口层源码见仓库内 `prism-wasm/README.md`。
//
// 为什么是 wasm 而不是翻译成 JS：
//   Prism 是 465KB Rust、含大量浮点边界处理（jsmath 还特意复刻了 V8 的 Math 语义）。
//   手翻必然出偏差，且上游升级后无法跟随。编成 wasm 可做到与上游逐位一致。
//
// 验证：用 mania-tracker 公告里 12 张标尺图对过，10 张误差 ≤0.03，
// 详见 `js/lib/estimator/prism/BENCHMARK.md`。

/** Prism 只负责这三套键数；4K / 5K / 9K+ 仍是 MinaCalc。 */
export const PRISM_KEY_COUNTS = Object.freeze([6, 7, 8]);

import { prismScoreToStar } from "./calibration.js";

export { prismScoreToStar, PRISM_TO_STAR } from "./calibration.js";

/** 上游默认目标成绩（0.965），与站点 `PRISM_BASE_GOAL` 一致。 */
export const PRISM_BASE_GOAL = 0.965;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

let instancePromise = null;
let injectedSource = null;

/**
 * 指定默认的 wasm 来源（ArrayBuffer / Uint8Array）。
 * 浏览器里不用调，会自动按同目录的 prism.wasm 拉取；
 * Node 测试环境里 `fetch("file://…")` 不可用，需要先注入。
 */
export function setPrismSource(source) {
    injectedSource = source;
    instancePromise = null;
}

/** 该键数是否由 Prism 评级。 */
export function usesPrism(keyCount) {
    return PRISM_KEY_COUNTS.includes(Number(keyCount));
}

function readResult(exp) {
    const slotPtr = exp.prism_result_ptr();
    const view = new DataView(exp.memory.buffer);
    const ptr = view.getUint32(slotPtr, true);
    const len = view.getUint32(slotPtr + 4, true);
    if (!ptr || !len) return null;

    const bytes = new Uint8Array(exp.memory.buffer, ptr, len);
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    const json = decoder.decode(bytes.subarray(0, end));
    exp.prism_free_bytes(ptr, len);

    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function withText(exp, text, fn) {
    const bytes = encoder.encode(text);
    const ptr = exp.prism_alloc(bytes.length);
    if (!ptr) return null;
    new Uint8Array(exp.memory.buffer, ptr, bytes.length).set(bytes);
    try {
        fn(ptr, bytes.length);
    } finally {
        exp.prism_free(ptr, bytes.length);
    }
    return readResult(exp);
}

function make(instance) {
    const exp = instance.exports;

    function analyze(osuText, { rate = 1.0, od = -1, goal = PRISM_BASE_GOAL, overallOnly = false } = {}) {
        const raw = withText(exp, String(osuText || ""), (ptr, len) => {
            exp.prism_analyze(ptr, len, Number(rate) || 1, Number(od), Number(goal), overallOnly ? 1 : 0);
        });
        if (!raw?.ok) return null;
        return raw;
    }

    function analyzeLn(osuText, { rate = 1.0, od = -1, goal = PRISM_BASE_GOAL } = {}) {
        const raw = withText(exp, String(osuText || ""), (ptr, len) => {
            exp.prism_analyze_ln(ptr, len, Number(rate) || 1, Number(od), Number(goal));
        });
        if (!raw?.ok) return null;
        return Number(raw.ln) || 0;
    }

    function supports(keyCount) {
        return exp.prism_supports(Number(keyCount)) === 1;
    }

    function version() {
        exp.prism_version();
        const raw = readResult(exp);
        return raw?.version ?? null;
    }

    return { analyze, analyzeLn, supports, version };
}

/**
 * 加载 Prism wasm。多次调用共享同一个实例。
 * @param {string|URL|ArrayBuffer|Uint8Array} [source]
 *        可选自定义来源；默认取同目录的 prism.wasm。
 */
export async function loadPrism(source = null) {
    // 显式传了来源 → 不入缓存（允许测试并行用不同 wasm）
    if (source) {
        return instantiate(source);
    }
    if (instancePromise) return instancePromise;
    const promise = (async () => instantiate(injectedSource || new URL("./prism.wasm", import.meta.url)))();
    instancePromise = promise;
    promise.catch(() => {
        instancePromise = null;
    });
    return promise;
}

async function instantiate(source) {
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        const mod = await WebAssembly.instantiate(source, {});
        return make(mod.instance);
    }
    const response = await fetch(source);
    if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
            const mod = await WebAssembly.instantiateStreaming(response, {});
            return make(mod.instance);
        } catch {
            // 某些服务器不给 application/wasm 类型，退回到 arrayBuffer
        }
    }
    const mod = await WebAssembly.instantiate(await (await fetch(source)).arrayBuffer(), {});
    return make(mod.instance);
}

/**
 * 一次性拿到「RC 星数 + LN 星数」，供 engine.js 替换 6K/7K/8K 的难度。
 *
 * 关键：返回值里的 rcStar / lnStar **已经换算到段位表的刻度**（Sunny 星数口径），
 * 所以下游 estDiff2 → DAN_INDEX 查表一行都不用改。换算公式见 calibration.js。
 *
 * 注意：`odFlag` 沿用项目现有语义 —— 传 null/undefined 或负数表示「用谱面自带 OD」。
 * @returns {Promise<{rcStar:number, lnStar:number, prismRc:number, prismLn:number, values:object, engine:string}|null>}
 */
export async function prismDifficulty(text, { rate = 1.0, odFlag = -1 } = {}) {
    const prism = await loadPrism();
    const od = odFlag == null || !Number.isFinite(Number(odFlag)) || Number(odFlag) < 0 ? -1 : Number(odFlag);
    const full = prism.analyze(text, { rate, od });
    if (!full) return null;
    const keyCount = Number(full.keyCount) || 0;
    const prismRc = Number(full.values?.Overall) || 0;
    const prismLn = Number(prism.analyzeLn(text, { rate, od })) || 0;

    return {
        // 换算到段位表刻度后给下游用
        rcStar: prismScoreToStar(prismRc, keyCount),
        lnStar: prismScoreToStar(prismLn, keyCount),
        // 原始 Prism 分（百分制）留着显示/调试
        prismRc,
        prismLn,
        values: full.values || {},
        keyCount,
        engine: `prism-v${full.version}`,
    };
}
