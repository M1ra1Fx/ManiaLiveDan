// 计算引擎（主线程）：
//   - analyzeWholeMap：整图 RC/LN 星数 + 段位文本 + 长度因子
//   - computeSectionAt：以某个播放位置为中心切 15s，重算该段星数/段位
//   - fetchBeatmapFile：从 tosu 的 /files/beatmap/file 取 .osu 原文
import { calculate } from "../lib/rework/sunnyAlgorithm.js";
import { calculateLN } from "../lib/rework/sunnyWindowAlgorithm.js";
import { OsuFileParser } from "../lib/parser/osuFileParser.js";
import { sliceOsuTextByTimeRange } from "../lib/parser/osuTimeSlice.js";
import { formatRc, formatLn, parseRc, parseLn, lnMinStar } from "./dan.js";
import { computeSegments } from "./segment.js";
import { applyVibroToSegments, extractNotes } from "./vibro.js";
import { APP } from "./config.js";
import { prismDifficulty, usesPrism } from "../lib/estimator/prism/index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeParse(text) {
    try {
        const parser = new OsuFileParser(text);
        parser.process();
        return parser;
    } catch (error) {
        console.warn("[ManiaLiveDan] osu parse failed", error);
        return null;
    }
}

function noteRange(parser) {
    const data = parser.getParsedData();
    const starts = data.noteStarts || [];
    const ends = data.noteEnds || [];
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < starts.length; i += 1) {
        const start = Number(starts[i]);
        if (Number.isFinite(start)) {
            if (start < first) first = start;
            if (start > last) last = start;
        }
        const end = Number(ends[i]);
        if (Number.isFinite(end) && end >= 0 && end > last) last = end;
    }
    return {
        first: Number.isFinite(first) ? first : null,
        last: Number.isFinite(last) ? last : null,
    };
}

/**
 * 整图分析。
 * @returns {{error:string}|{error:null, ...}} 成功时返回完整分析对象。
 */
export async function analyzeWholeMap(text, mods, tosuRange = {}, algorithm = "Sunny") {
    const parser = safeParse(text);
    if (!parser) return { error: "parse-failed" };

    let rc;
    try {
        rc = calculate(text, mods.rate, mods.odFlag, mods.cvtFlag, { withMeta: true, withGraph: true }, parser);
    } catch (error) {
        console.warn("[ManiaLiveDan] RC estimator failed", error);
        return { error: "parse-failed" };
    }
    if (rc === -1) return { error: "parse-failed" };
    if (rc === -2) return { error: "not-mania" };

    let ln = null;
    try {
        ln = calculateLN(text, mods.rate, mods.odFlag, mods.cvtFlag, {}, parser);
    } catch (error) {
        console.warn("[ManiaLiveDan] LN estimator failed", error);
    }

    const keys = Number(rc.columnCount) || 0;
    let rcStar = Number(rc.star);
    const rcTotal = Number(rc.totalNotes) || 0;
    const rcFactor = rcTotal > 0 ? rcTotal / (rcTotal + 60) : 1;

    let lnStar = 0;
    let lnTotal = 0;
    if (ln && typeof ln === "object" && Number.isFinite(ln.star)) {
        lnStar = Number(ln.star);
        lnTotal = Number(ln.totalNotes) || 0;
    }

    // ---- 可选算法：Prism（只对 6K / 7K / 8K 有意义）----
    // 只有当用户在下拉里选了 Prism 才走这条；否则一律 Sunny（原行为不变）。
    // Prism 只替换「星数怎么算出来」；星数 → 段位 的查表（DAN_INDEX）一行没动。
    let estimator = "sunny";
    let prismValues = null;
    // algorithm 可以是字符串，也可以是 (keys) => string 的函数（调用方按键数选算法）
    const algorithmName = typeof algorithm === "function" ? algorithm(keys) : algorithm;
    const wantsPrism = String(algorithmName || "").toLowerCase() === "prism";
    if (wantsPrism && usesPrism(keys)) {
        try {
            const prism = await prismDifficulty(text, {
                rate: Number(mods.rate) || 1.0,
                odFlag: mods.odFlag,
            });
            if (prism) {
                rcStar = prism.rcStar;
                lnStar = prism.lnStar;
                estimator = prism.engine;
                prismValues = prism.values;
            }
        } catch (error) {
            // Prism 不可用（wasm 加载失败等）时退回 Sunny，不让整个界面挂掉
            console.warn("[ManiaLiveDan] Prism estimator failed, falling back to Sunny", error);
        }
    }

    // Prism 换算失败（NaN）时退回 Sunny 原值，避免段位查表拿到 NaN
    if (estimator !== "sunny" && (!Number.isFinite(rcStar) || !Number.isFinite(lnStar))) {
        console.warn("[ManiaLiveDan] Prism -> 段位刻度换算失败，退回 Sunny 星数");
        rcStar = Number(rc.star);
        lnStar = ln && typeof ln === "object" && Number.isFinite(ln.star) ? Number(ln.star) : 0;
        estimator = "sunny";
        prismValues = null;
    }

    const lnFactor = lnTotal > 0 ? lnTotal / (lnTotal + 60) : rcFactor;
    const lnMin = lnMinStar(keys, APP.showLnMinStar);
    const lnVisible = lnStar >= lnMin;
    const lnLabelRaw = lnVisible ? formatLn(lnStar, keys, APP.extendedRange) : "";
    const lnLabel = lnLabelRaw.startsWith("<") ? "" : lnLabelRaw;

    const fallbackRange = noteRange(parser);
    const start = Number.isFinite(tosuRange.firstObject) ? tosuRange.firstObject : fallbackRange.first;
    const end = Number.isFinite(tosuRange.lastObject) ? tosuRange.lastObject : fallbackRange.last;

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return { error: "empty-chart" };
    }

    const count = Math.max(1, Math.floor((end - start) / APP.stepMs) + 1);

    const analysis = {
        error: null,
        text,
        mods,
        keys,
        rcStar,
        lnStar,
        // 这张图的难度是谁算的：Sunny 等非 Prism 算法是 "sunny"，Prism 是 "prism-v25"
        estimator,
        // Prism 各 skillset 原始分（百分制）；没选 Prism 时为 null
        prismValues,
        lnRatio: Number(rc.lnRatio) || 0,
        rcTotal,
        lnTotal,
        rcFactor,
        lnFactor,
        lnMinStar: lnMin,
        rcLabel: formatRc(rcStar, keys, APP.extendedRange),
        lnLabel,
        // 这张谱到底有没有 LN 段位：
        //   - 没有长条 → calculateLN 返回 NaN → lnLabel 为空
        //   - 低于 LN 表下限 → "< LN x" 被剥掉 → 也是空
        // 两种情况都说明「总体难度里没有 LN 难度」，显示层据此整块隐藏。
        hasLnDan: Boolean(lnLabel),
        start,
        end,
        stepMs: APP.stepMs,
        windowMs: APP.windowMs,
        futureMs: Number(APP.futureMs) || 0,
        count,
        // 每段缓存：null = 还没算（切段关闭时的回退路径用）。
        sections: new Array(count).fill(null),
        // Sunny 的逐 note 难度曲线（用于把段边界精确定位到 note/拍点）。
        graph: rc.graph || null,
        // 自动切段结果（“现在这段”）；播放时只按时间查找，不依赖窗口。
        segments: null,
    };

    if (APP.segmentationEnabled) {
        try {
            const startedAt = performance.now();
            analysis.segments = computeSegments(analysis);
            if (typeof window !== "undefined" && window.__MLD) {
                window.__MLD.segmentMs = Math.round(performance.now() - startedAt);
            }
        } catch (error) {
            console.warn("[ManiaLiveDan] segmentation failed", error);
            analysis.segments = null;
        }
    }

    // vibro 判定：本地跑，纯音符统计，不依赖 Etterna。
    // 判成 vibro 的段落会显示 VIBRO 而不是段位（星数算法本身不动）。
    if (analysis.segments && analysis.segments.length) {
        try {
            const notes = extractNotes(parser);
            const marked = applyVibroToSegments(analysis.segments, notes);
            if (typeof window !== "undefined" && window.__MLD) {
                window.__MLD.vibroSegments = marked;
            }
        } catch (error) {
            console.warn("[ManiaLiveDan] vibro scan failed", error);
        }
    }

    return analysis;
}

/**
 * 计算第 index 段（以 start + index*step 为中心）。
 * 结果缓存在 analysis.sections[index]。
 */
/**
 * 计算第 index 段（以 start + index*step 为中心）。
 * 结果缓存在 analysis.sections[index]。
 *
 * 返回的是**同步值**：命中缓存时直接给结果；未命中时先给一个占位的空结果，
 * 真正的计算在后台跑，算完写回缓存并回调 onReady（供 UI 刷新）。
 * 这样 requestAnimationFrame 的 tick() 里调用它不会因为 await 掉帧。
 */
export function computeSectionAt(analysis, index, onReady = null) {
    if (!analysis || index < 0 || index >= analysis.count) return null;
    const cached = analysis.sections[index];
    if (cached) return cached;

    const center = analysis.start + index * analysis.stepMs;
    const future = Number.isFinite(analysis.futureMs) ? analysis.futureMs : 0;
    const windowMs = analysis.windowMs;
    const from = center - (windowMs - future);
    const to = center + future;

    const result = {
        center,
        from,
        to,
        notes: 0,
        rc: null,
        ln: null,
        rcLabel: "",
        lnLabel: "",
        color: "#8a93a6",
    };

    let sliced;
    try {
        sliced = sliceOsuTextByTimeRange(analysis.text, from, to);
    } catch {
        sliced = null;
    }

    if (sliced && sliced.objectCount >= 2) {
        result.notes = sliced.objectCount;
        const parser = safeParse(sliced.text);
        if (parser) {
            try {
                const rc = calculate(
                    sliced.text,
                    analysis.mods.rate,
                    analysis.mods.odFlag,
                    analysis.mods.cvtFlag,
                    { lengthFactorOverride: analysis.rcFactor, withMeta: true },
                    parser,
                );
                if (rc && typeof rc === "object" && Number.isFinite(rc.star)) {
                    result.rc = Number(rc.star);
                    result.rcLabel = formatRc(result.rc, analysis.keys, APP.extendedRange);
                    result.color = parseRc(result.rcLabel, analysis.keys)?.color || "#8a93a6";

                    const ln = calculateLN(
                        sliced.text,
                        analysis.mods.rate,
                        analysis.mods.odFlag,
                        analysis.mods.cvtFlag,
                        { lengthFactorOverride: analysis.lnFactor },
                        parser,
                    );
                    if (ln && typeof ln === "object" && Number.isFinite(ln.star) && ln.star >= analysis.lnMinStar) {
                        result.ln = Number(ln.star);
                        result.lnLabel = formatLn(result.ln, analysis.keys, APP.extendedRange);
                        if (result.lnLabel.startsWith("<")) result.lnLabel = "";
                        if (result.lnLabel) {
                            result.lnColor = parseLn(result.lnLabel, analysis.keys)?.color || "#7dd3fc";
                        }
                    }
                }

                // 6K / 7K / 8K：与整图保持一致，本段也走 Prism。
                // Prism 是异步的（wasm），而这里（tick 里）不能 await，所以：
                //   1. 先返回上面 Sunny 的同步结果（或占位）让界面立刻有东西
                //   2. 后台算 Prism，算完写回缓存并回调 onReady
                if (analysis.estimator?.startsWith("prism")) {
                    applyPrismToSectionAsync(analysis, index, result, sliced.text, onReady);
                }
            } catch (error) {
                console.warn("[ManiaLiveDan] section estimator failed", error);
            }
        }
    }

    analysis.sections[index] = result;
    return result;
}

/**
 * 后台用 Prism 重算某一段，算完写回缓存。
 * 同一段只跑一次；段落被整体替换（换图）时靠 analysis 引用判断是否还作数。
 */
function applyPrismToSectionAsync(analysis, index, result, sectionText, onReady) {
    if (analysis.prismPending?.has(index)) return;
    if (!analysis.prismPending) analysis.prismPending = new Set();
    analysis.prismPending.add(index);

    prismDifficulty(sectionText, {
        rate: Number(analysis.mods.rate) || 1.0,
        odFlag: analysis.mods.odFlag,
    })
        .then((prism) => {
            analysis.prismPending.delete(index);
            if (!prism) return;
            // 期间若已被重新计算/替换，丢弃
            if (analysis.sections[index] !== result) return;

            result.rc = prism.rcStar;
            result.rcLabel = formatRc(result.rc, analysis.keys, APP.extendedRange);
            result.color = parseRc(result.rcLabel, analysis.keys)?.color || "#8a93a6";
            result.ln = null;
            result.lnLabel = "";
            result.lnColor = undefined;
            if (prism.lnStar >= analysis.lnMinStar) {
                result.ln = prism.lnStar;
                result.lnLabel = formatLn(result.ln, analysis.keys, APP.extendedRange);
                if (result.lnLabel.startsWith("<")) result.lnLabel = "";
                if (result.lnLabel) {
                    result.lnColor = parseLn(result.lnLabel, analysis.keys)?.color || "#7dd3fc";
                }
            }
            result.estimator = prism.engine;

            if (typeof onReady === "function") {
                try {
                    onReady(result);
                } catch {
                    // UI 回调失败不影响后续段落
                }
            }
        })
        .catch((error) => {
            analysis.prismPending.delete(index);
            console.warn("[ManiaLiveDan] Prism section failed", error);
        });
}

/** 从 tosu 取当前谱面的 .osu 原文。 */
export async function fetchBeatmapFile(expected = {}) {
    const url = `${APP.httpOrigin}/files/beatmap/file`;
    for (let attempt = 0; attempt < APP.fetchRetries; attempt += 1) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                const text = await response.text();
                if (isUsableBeatmapText(text) && matchesExpected(text, expected)) {
                    return text;
                }
            }
        } catch (error) {
            // tosu 换图瞬间可能短暂 4xx/连接拒绝，重试即可。
        }
        await sleep(APP.fetchRetryDelayMs);
    }
    return null;
}

function isUsableBeatmapText(text) {
    return typeof text === "string" && text.length > 200 && text.includes("[HitObjects]");
}

function matchesExpected(text, expected) {
    const title = String(expected.title || "").trim();
    const version = String(expected.version || "").trim();
    if (!title && !version) return true;

    const header = text.split("[HitObjects]")[0];
    const titleLine = /^Title:(.*)$/m.exec(header);
    const versionLine = /^Version:(.*)$/m.exec(header);
    const actualTitle = titleLine ? titleLine[1].trim() : "";
    const actualVersion = versionLine ? versionLine[1].trim() : "";

    if (title && actualTitle && actualTitle !== title) {
        // 换图竞态：拿到的是上一张。
        return false;
    }
    if (version && actualVersion && actualVersion !== version) {
        return false;
    }
    return true;
}
