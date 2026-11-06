// 计算引擎（主线程）：
//   - analyzeWholeMap：整图 RC/LN 星数 + 段位文本 + 长度因子
//   - computeSectionAt：以某个播放位置为中心切 15s，重算该段星数/段位
//   - fetchBeatmapFile：从 tosu 的 /files/beatmap/file 取 .osu 原文
import { calculate } from "../lib/rework/sunnyAlgorithm.js";
import { calculateLN } from "../lib/rework/sunnyWindowAlgorithm.js";
import { OsuFileParser } from "../lib/parser/osuFileParser.js";
import { sliceOsuTextByTimeRange } from "../lib/parser/osuTimeSlice.js";
import { formatRc, parseRc, parseLn, lnFloorStar, resolveLnLabel } from "./dan.js";
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
    // 该键数 LN 表的真实首档（4K 4.832 / 6K 3.530 / 7K 4.836）。
    // **整图和段级共用这一个值** —— 不再读 APP.showLnMinStar（那是 4.84，
    // 和表里的 4.832 差 0.008，会让整图和段级用两个门槛）。
    const lnMin = lnFloorStar(keys, APP.extendedRange);
    const lnRatio = Number(rc.lnRatio) || 0;

    // ---- 「有没有长条」看长条数据，不看星数 ----
    //   · lnRatio > 0  → 解析器直接数出来的长条占比（modIN/modHO 转换之后），最可靠
    //   · lnTotal > 0  → calculateLN 真的跑通了（没长条时它返回 {NoLN:true}，这里就是 0）
    //   · lnStar  > 0  → 兜底
    // 注意：这**只**说明谱里有长条，不说明「够不够难」。
    const hasLnNotes = lnRatio > 0 || lnTotal > 0 || (Number.isFinite(lnStar) && lnStar > 0);

    // ---- LN 档位文本：够不上首档就留空（不显示 "< 最弱档"）----
    // 统一走 resolveLnLabel，保证整图 / 当前段 / Prism 覆盖三条路径行为一致。
    const lnResolved = resolveLnLabel(lnStar, keys, APP.extendedRange, hasLnNotes);
    const lnLabel = lnResolved.label;
    const lnBelowFloor = lnResolved.belowFloor;
    // 整图「够不够门槛」：有长条 **且** 整图 LN 星数 ≥ 该键数 LN 表首档。
    // 这是整图级结论，只在选歌/待机预览整图时用；打歌时必须看当前段
    // （见 ui.js 的 shouldShowLnBlock），否则整图简单 + 某段 LN 难就会漏显示。
    const hasLnDan = hasLnNotes && Boolean(lnLabel);

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
        // 用户在面板里选的算法名（Mixed / Prism / Sunny / ...）。
        // 与 estimator 的区别：Mixed 的 estimator 是 "sunny" 口径，但界面应显示 Mixed。
        algorithmName: String(algorithmName || "Sunny"),
        // Prism 各 skillset 原始分（百分制）；没选 Prism 时为 null
        prismValues,
        lnRatio,
        rcTotal,
        lnTotal,
        rcFactor,
        lnFactor,
        // 该键数 LN 表的真实首档星数（整图 / 段级共用；见 dan.js 的 lnFloorStar）
        lnMinStar: lnMin,
        rcLabel: formatRc(rcStar, keys, APP.extendedRange),
        lnLabel,
        // 这张谱有没有长条（纯数据事实，不代表够不够难）
        hasLnNotes,
        // 整图级结论：有长条 **且** 整图 LN 星数够得上该键数 LN 表首档。
        // 只在「选歌 / 待机预览整图」时当闸门；打歌时看当前段（ui.js 的 shouldShowLnBlock）。
        hasLnDan,
        // true = 有长条但整图 LN 星数低于首档（lnLabel 因此为空）
        lnBelowFloor,
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
            let segments = computeSegments(analysis);

            // 分段算法跟随整图算法：选了 Prism（6K/7K/8K）时，按已切好的段边界
            // 逐段算一遍 Prism 星数放进覆盖表，再重切一次段让它生效。
            // 其它算法（Mixed/Sunny/Daniel/Azusa/Roxy）的整图结果都归一到 Sunny 星数尺度，
            // 分段直接用 Sunny 就是它们的正确口径，不需要覆盖表。
            if (segments && segments.length && estimator.startsWith("prism")) {
                try {
                    const override = await buildPrismSegmentOverride(text, segments, mods, keys);
                    if (override) {
                        analysis.segmentOverride = override;
                        const again = computeSegments(analysis);
                        if (again && again.length) segments = again;
                    }
                } catch (error) {
                    // Prism 分段失败就保留 Sunny 分段，不影响主流程
                    console.warn("[ManiaLiveDan] Prism segment override failed, keeping Sunny segments", error);
                }
            } else {
                analysis.segmentOverride = null;
            }

            analysis.segments = segments;
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
 * 按已切好的段边界，用 Prism 逐段算一遍星数，产出 estimateRange 用的覆盖表。
 *
 * 为什么需要它：分段原本固定用 Sunny 算（同步、快）。用户选了 Prism 之后，
 * 打歌时看到的段位却还是 Sunny 的 —— 选算法等于没选。
 * 这里把 Prism 的分段结果预先算出来，segment.js 的 estimateRange 会优先用它。
 *
 * 返回形状（见 segment.js 的 overrideFor）：
 *   { rc: [{from,to,star}], ln: [{from,to,star}], estimator }
 */
async function buildPrismSegmentOverride(text, segments, mods, keyCount) {
    if (!usesPrism(keyCount)) return null;
    // 段太多时跳过：每段都要过一次 wasm，几百段会让首屏明显变慢。
    // 超过阈值就退回 Sunny 分段（整图仍是 Prism），至少不会卡住。
    const MAX_SEGMENTS = 400;
    if (segments.length > MAX_SEGMENTS) {
        console.warn(`[ManiaLiveDan] too many segments (${segments.length}) for Prism override, using Sunny segments`);
        return null;
    }

    const rate = Number(mods.rate) || 1.0;
    const odFlag = mods.odFlag;
    const rc = [];
    const ln = [];

    for (const seg of segments) {
        const from = Math.max(0, seg.from);
        const to = Math.max(from + 100, seg.to);
        let sliced;
        try {
            sliced = sliceOsuTextByTimeRange(text, from, to);
        } catch {
            sliced = null;
        }
        if (!sliced || sliced.objectCount < 2) {
            rc.push({ from, to, star: NaN });
            ln.push({ from, to, star: NaN });
            continue;
        }
        try {
            const prism = await prismDifficulty(sliced.text, { rate, odFlag });
            rc.push({ from, to, star: prism ? prism.rcStar : NaN });
            ln.push({ from, to, star: prism ? prism.lnStar : NaN });
        } catch {
            rc.push({ from, to, star: NaN });
            ln.push({ from, to, star: NaN });
        }
    }

    return { rc, ln, estimator: "prism" };
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
 *
 * 注意：这条路径只在 segmentationEnabled === false 时才会被 tick() 调用；
 * 默认开启分段时走的是 analysis.segments（由 segment.js 算好）。
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
        // 这一段的长条占比（来自切片解析），显示层判断「本段有没有 LN」用
        lnRatio: 0,
        // 这一段有没有长条（切片级事实，不是整图结论）
        hasLnNotes: false,
        rcLabel: "",
        lnLabel: "",
        // true = 本段有长条但低于 LN 表首档（lnLabel 因此为空）
        lnBelowFloor: false,
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
                    // 「这一段有没有 LN」同样看长条数据：切片自己的 lnRatio 最直接。
                    const sectionLnRatio = Number(rc.lnRatio) || 0;
                    result.lnRatio = sectionLnRatio;
                    const sectionLnStar = ln && typeof ln === "object" && Number.isFinite(ln.star) ? Number(ln.star) : 0;
                    const sectionLnTotal = ln && typeof ln === "object" && Number.isFinite(ln.totalNotes) ? Number(ln.totalNotes) : 0;
                    const sectionHasLn = sectionLnRatio > 0 || sectionLnTotal > 0 || sectionLnStar > 0;
                    result.hasLnNotes = sectionHasLn;
                    // 够不上首档就留空（不再给 "< 最弱档" 兜底），和整图同一套门槛。
                    const sectionLn = resolveLnLabel(sectionLnStar, analysis.keys, APP.extendedRange, sectionHasLn);
                    // ln 保留原始星数（即使够不上门槛），和 segment.js 的 buildSegment 保持一致：
                    // 「显不显示档位」只看 lnLabel 是否为空。
                    result.ln = sectionHasLn ? sectionLnStar : null;
                    if (sectionLn.label) {
                        result.lnLabel = sectionLn.label;
                        result.lnBelowFloor = false;
                        result.lnColor = parseLn(result.lnLabel, analysis.keys)?.color || "#7dd3fc";
                    } else {
                        result.lnBelowFloor = sectionLn.belowFloor;
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
            result.lnBelowFloor = false;
            // Prism 的长条占比不到门槛时 lnStar 会给 0（见 prism/index.js 的
            // PRISM_LN_HOLD_RATIO_FLOOR），所以「这一段有没有长条」不能只看 lnStar：
            // 这一段切片自己的长条占比优先。
            // ⚠️ 不能用 analysis.hasLnNotes 兜底 —— 那是整图结论，整图有 LN
            // 不代表这一段有；拿它兜底会让没 LN 的段也被判成「有长条」。
            const prismLnStar = Number.isFinite(Number(prism.lnStar)) ? Number(prism.lnStar) : 0;
            const prismHasLn = prismLnStar > 0 || Number(result.lnRatio) > 0;
            result.hasLnNotes = prismHasLn;
            const prismLn = resolveLnLabel(prismLnStar, analysis.keys, APP.extendedRange, prismHasLn);
            if (prismLn.label) {
                result.ln = prismLnStar;
                result.lnLabel = prismLn.label;
                result.lnBelowFloor = false;
                result.lnColor = parseLn(result.lnLabel, analysis.keys)?.color || "#7dd3fc";
            } else {
                result.lnBelowFloor = prismLn.belowFloor;
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
