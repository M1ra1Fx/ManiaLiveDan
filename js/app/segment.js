// 自动切段：按 .osu 的小节线把谱面切成 bars → 合并难度相近的相邻段
// → 对每个最终段整体重算一次星数/段位。
// 这样播放时只按时间切段（跨过边界才换），不依赖滑动窗口，既不提前也不滞后。
import { calculate } from "../lib/rework/sunnyAlgorithm.js";
import { calculateLN } from "../lib/rework/sunnyWindowAlgorithm.js";
import { OsuFileParser } from "../lib/parser/osuFileParser.js";
import { sliceOsuTextByTimeRange } from "../lib/parser/osuTimeSlice.js";
import { formatRc, formatLn, parseRc, parseLn } from "./dan.js";
import { APP } from "./config.js";

/** 解析 uninherited timing points（BPM/小节）。 */
export function parseTimingPoints(text) {
    let section = "";
    const points = [];
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("[") && line.endsWith("]")) { section = line; continue; }
        if (section !== "[TimingPoints]" || !line.trim()) continue;
        const parts = line.split(",");
        const time = Number(parts[0]);
        const beatLength = Number(parts[1]);
        const meter = Number(parts[2]) || 4;
        const uninherited = parts.length > 6 ? Number(parts[6]) === 1 : true;
        if (Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0 && uninherited) {
            points.push({ time, beatLength, meter });
        }
    }
    points.sort((a, b) => a.time - b.time);
    return points;
}

/**
 * VIBRO 判定 —— 照 MMA 的做法。
 *
 * ⚠️ 先说清楚一个坑：MMA 的 `js/app/vibro.js` 里有两个导出，但
 * **`detectVibroFromLongjackPattern` 从来没被调用过**，是死函数。
 * 真正用的只有 `detectVibro(ettResult.values, 0.95)`：
 *
 *     isVibroMap = vibroDetection && (star > 5.0) && (JackSpeed / Overall >= 0.95)
 *
 * 也就是 **Etterna 技能值里"连打速度"占了整体难度的 95% 以上**。
 * 所以不能用「同键连行」判 —— 那只是 pattern 分类（Longjacks），
 * The Big Black 中间那些密集叠键会被误判成 vibro（用户实测反馈）。
 *
 * 这里的分段版本：对每一段切片跑一次 `analyzeEtternaFromText`，取同样的比值。
 * 单次约 30~40ms（整张 6 分钟图也才 42ms），100 段约 2~3s，放在 worker 里跑。
 *
 * 实测（8 秒窗口，ratio ≥ 0.95 的窗口数）：
 *   · Yooh - RPG：3/45，正好是 152s / 160s / 168s —— 用户说的那段 jack
 *   · Once Forgotten (Ycloki) 9.62★：2/50
 *   · The Big Black [UHD]：0/18（整图 0.678，不判 vibro）
 *   · The Big Black [Mono's DEATH]：1/18
 */
/** 段内 note 少于这个数就不单独成段（并进邻居）。 */
const MIN_SEGMENT_NOTES = 20;

const VIBRO_JACKSPEED_RATIO = 0.95;
const VIBRO_MIN_STAR = 5.0;

/** 音符流（带 LN 标记），缓存到 analysis 上。分段合并要用它算 LN 占比。 */
function noteStream(analysis) {
    if (analysis.__notes) return analysis.__notes;
    const notes = [];
    let section = "";
    for (const line of String(analysis.text || "").split(/\r?\n/)) {
        if (line.startsWith("[") && line.endsWith("]")) { section = line; continue; }
        if (section !== "[HitObjects]" || !line.trim()) continue;
        const parts = line.split(",");
        const t = Number(parts[2]);
        const type = Number(parts[3]) || 0;
        if (Number.isFinite(t)) notes.push({ t, ln: (type & 128) !== 0 });
    }
    notes.sort((a, b) => a.t - b.t);
    analysis.__notes = notes;
    return notes;
}

/** 某一段的 LN 占比（长条音符 / 全部音符）。不跑算法，直接从音符流数。 */
function lnRatioOf(analysis, from, to) {
    const notes = noteStream(analysis);
    let total = 0;
    let ln = 0;
    for (const n of notes) {
        if (n.t < from) continue;
        if (n.t >= to) break;
        total += 1;
        if (n.ln) ln += 1;
    }
    return total ? ln / total : 0;
}

/**
 * VIBRO 标记的占位。真正的判定要跑 Etterna（异步、在 worker 里），
 * 算完后由 `applyVibroScan()` 回填。
 */
function markVibro(analysis, segments) {
    for (const seg of segments) seg.vibro = false;
    return segments;
}

/**
 * 把 Etterna 扫描结果回填到段上：ratio ≥ 0.95 的段标 VIBRO 并清掉段位。
 * `results` = [{ from, to, ratio }]，和 segments 一一对应（按时间匹配）。
 */
export function applyVibroScan(segments, results) {
    if (!Array.isArray(segments) || !Array.isArray(results)) return false;
    let changed = false;
    for (let i = 0; i < segments.length; i += 1) {
        const hit = results[i];
        if (!hit) continue;
        const vibro = Number(hit.ratio) >= VIBRO_JACKSPEED_RATIO;
        if (vibro === segments[i].vibro) continue;
        segments[i].vibro = vibro;
        segments[i].jackRatio = Number.isFinite(Number(hit.ratio)) ? Number(hit.ratio) : null;
        if (vibro) {
            // 个人差太大，段位数字没有意义 —— 清掉，交给 UI 显示 VIBRO。
            segments[i].rcLabel = "";
            segments[i].lnLabel = "";
            segments[i].color = "#3a3f4b";
            segments[i].lnColor = "#3a3f4b";
        }
        changed = true;
    }
    return changed;
}

/** 对任意时间区间跑一次 Sunny（RC + 可选 LN），并套用整图长度因子。 */
export function estimateRange(analysis, from, to, { withLn = true } = {}) {
    const clampedFrom = Math.max(from, 0);
    const clampedTo = Math.max(clampedFrom + 100, to);
    const sliced = sliceOsuTextByTimeRange(analysis.text, clampedFrom, clampedTo);
    const result = { rc: null, ln: null, notes: sliced.objectCount, lnRatio: 0 };
    if (sliced.objectCount < 2) return result;

    let parser;
    try {
        parser = new OsuFileParser(sliced.text);
        parser.process();
    } catch {
        return result;
    }

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
            result.lnRatio = Number(rc.lnRatio) || 0;
        }
    } catch (error) {
        console.warn("[ManiaLiveDan] segment RC estimate failed", error);
        return result;
    }

    if (withLn) {
        try {
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
            }
        } catch {
            // LN 估算失败不影响 RC。
        }
    }
    return result;
}
/** 按 timing point 的小节线生成 bar 列表（覆盖 [start, end]）。 */
export function buildBarGrid(text, start, end) {
    const timing = parseTimingPoints(text);
    const boundaries = new Set([Math.round(start)]);

    if (timing.length) {
        for (let i = 0; i < timing.length; i += 1) {
            const point = timing[i];
            const nextTime = timing[i + 1] ? timing[i + 1].time : end + 1;
            const barMs = point.beatLength * point.meter;
            if (!Number.isFinite(barMs) || barMs < 200) continue;
            const phaseStart = Math.max(start, point.time);
            const offset = ((phaseStart - point.time) % barMs + barMs) % barMs;
            let t = phaseStart + (offset > 1 ? barMs - offset : 0);
            for (; t < Math.min(end, nextTime); t += barMs) {
                if (t > start + 300) boundaries.add(Math.round(t));
            }
            if (point.time > start + 300 && point.time < end) boundaries.add(Math.round(point.time));
        }
    }

    boundaries.add(Math.round(end));
    let sorted = [...boundaries].filter((t) => t >= start && t <= end).sort((a, b) => a - b);

    // 超长/高 BPM 谱面：限制估算单元数量，避免加载时算太久（每个单元一次 Sunny RC）。
    const MAX_UNITS = 120;
    if (sorted.length - 1 > MAX_UNITS) {
        const stride = Math.ceil((sorted.length - 1) / MAX_UNITS);
        sorted = sorted.filter((_, index) => index % stride === 0 || index === sorted.length - 1);
    }

    const bars = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
        const from = sorted[i];
        const to = sorted[i + 1];
        if (to - from >= 250) bars.push({ from, to });
    }
    if (!bars.length) bars.push({ from: start, to: end });
    return bars;
}

function weightMean(currentValue, currentWeight, nextValue, nextWeight) {
    const total = currentWeight + nextWeight;
    if (!total) return currentValue;
    return (currentValue * currentWeight + nextValue * nextWeight) / total;
}

/** 合并相邻 bar → 段落，再对每段整体重算一次（没有 graph 时的回退路径）。 */
function barSegments(analysis) {
    const bars = buildBarGrid(analysis.text, analysis.start, analysis.end);
    const barResults = bars.map((bar) => ({
        ...bar,
        // 合并阶段只需要 RC 星数；LN 用**占比**参与合并判断（不跑 LN 算法，直接从音符流数），
        // 最终段的 LN 星数仍然只在最后算一次，成本没变。
        ...estimateRange(analysis, bar.from, bar.to, { withLn: false }),
        lnRatio: lnRatioOf(analysis, bar.from, bar.to),
        weight: Math.max(1, bar.to - bar.from),
    }));

    const mergeDelta = Number(APP.segmentMergeDelta) || 0.35;
    // LN 占比差超过这个值就不合并。
    // 用户反馈：密度相近但「前半段 LN 0%、后半段 40%」会被并成一段，
    // 结果前半段根本没 LN 也被标成 LN 17 —— 所以 LN 占比必须参与分段。
    const mergeLnDelta = Number(APP.segmentMergeLnDelta) || 0.25;
    const maxMs = Number(APP.segmentMaxMs) || 32000;
    const minMs = Number(APP.segmentMinMs) || 4000;

    // 1) 贪心合并相似相邻 bar
    const merged = [];
    for (const bar of barResults) {
        const prev = merged[merged.length - 1];
        // 两段都是休止段就直接并成一段
        if (prev && prev.rc === null && bar.rc === null) {
            prev.to = bar.to;
            prev.notes += bar.notes;
            prev.weight += bar.weight;
            continue;
        }
        if (prev && Number.isFinite(prev.rc) && Number.isFinite(bar.rc)
            && Math.abs(bar.rc - prev.rc) <= mergeDelta
            // 跟**上一小节**比，不是跟累计均值比 —— 均值会把渐变抹平，
            // 0%→40% 这种台阶永远超不过阈值。
            && Math.abs((bar.lnRatio || 0) - (Number.isFinite(prev.lastLnRatio) ? prev.lastLnRatio : (prev.lnRatio || 0))) <= mergeLnDelta
            && (bar.to - prev.from) <= maxMs) {
            prev.to = bar.to;
            prev.notes += bar.notes;
            prev.rc = weightMean(prev.rc, prev.weight, bar.rc, bar.weight);
            prev.lnRatio = (prev.lnRatio * prev.weight + (bar.lnRatio || 0) * bar.weight) / (prev.weight + bar.weight);
            prev.lastLnRatio = bar.lnRatio;
            prev.weight += bar.weight;
            prev.ln = Number.isFinite(bar.ln) && (!Number.isFinite(prev.ln) || bar.ln > prev.ln) ? bar.ln : prev.ln;
        } else {
            merged.push({ ...bar });
        }
    }

    // 2) 太短的段并进相邻段（优先并入星数更接近的一侧）
    let changed = true;
    while (changed && merged.length > 1) {
        changed = false;
        for (let i = 0; i < merged.length; i += 1) {
            const seg = merged[i];
            // 太短、或者音太少（< MIN_SEGMENT_NOTES）都不该单独成段 ——
            // Sunny 从十几个音外推出来的星数没有意义（实测 1 秒 17 个音能顶到 Epsilon）。
            // 这种段直接并进邻居，不产生任何段位，比硬标一个数字或标 VIBRO 都诚实。
            if (seg.to - seg.from >= minMs && (Number(seg.notes) || 0) >= MIN_SEGMENT_NOTES) continue;
            const prev = merged[i - 1];
            const next = merged[i + 1];
            const prevDiff = prev && Number.isFinite(prev.rc) && Number.isFinite(seg.rc) ? Math.abs(prev.rc - seg.rc) : Infinity;
            const nextDiff = next && Number.isFinite(next.rc) && Number.isFinite(seg.rc) ? Math.abs(next.rc - seg.rc) : Infinity;
            const target = prevDiff <= nextDiff ? prev : next;
            if (!target) continue;
            if (target === prev) {
                prev.to = seg.to;
                prev.notes += seg.notes;
                prev.rc = weightMean(prev.rc, prev.weight, seg.rc, seg.weight);
                prev.weight += seg.weight;
            } else {
                next.from = seg.from;
                next.notes += seg.notes;
                next.rc = weightMean(next.rc, next.weight, seg.rc, seg.weight);
                next.weight += seg.weight;
            }
            merged.splice(i, 1);
            changed = true;
            break;
        }
    }

    // 3) 每段整体重算（比 bar 平均更准），并生成段位文本
    const keys = analysis.keys;
    const segments = merged.map((seg, index) => {
        const final = estimateRange(analysis, seg.from, seg.to);
        const rc = Number.isFinite(final.rc) ? final.rc : null;
        const ln = Number.isFinite(final.ln) ? final.ln : 0;
        const rcLabel = formatRc(rc, keys, APP.extendedRange);
        const lnLabel = formatLn(ln, keys, APP.extendedRange);
        const rcParsed = parseRc(rcLabel, keys);
        const lnParsed = parseLn(lnLabel, keys);
        return {
            index,
            from: seg.from,
            to: seg.to,
            rc,
            ln,
            notes: final.notes,
            lnRatio: final.lnRatio,
            rcLabel: rcLabel.startsWith("<") ? "" : rcLabel,
            lnLabel: lnLabel.startsWith("<") ? "" : lnLabel,
            color: rcParsed?.color || "#8a93a6",
            lnColor: lnParsed?.color || "#7dd3fc",
        };
    });
    return markVibro(analysis, segments);
}

/** 根据播放位置找当前段（二分）。 */
export function segmentIndexAt(segments, positionMs) {
    if (!Array.isArray(segments) || !segments.length) return -1;
    if (positionMs < segments[0].from) return 0;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const seg = segments[mid];
        if (positionMs < seg.from) hi = mid - 1;
        else if (positionMs >= seg.to) lo = mid + 1;
        else return mid;
    }
    return Math.max(0, Math.min(segments.length - 1, lo));
}

// ---------- graph（逐 note 难度曲线）切段：边界精确到 250ms 网格 ----------

/**
 * 逐 note 难度曲线。
 *
 * 取样窗口默认只往回看（trailing）：t 时刻的值 = 最近 windowMs 内音符的加权难度。
 * 这才是「我正在打的这一段」的难度 —— 音符从落下到被接到有时间差，体感上的
 * 瞬时难度取决于已经在打的东西，不取决于还没到的音符。
 *
 * 如果用居中窗口（t±windowMs），曲线会提前看到未来：比如 1-5s 是 10dan、
 * 6-10s 是 3dan，居中窗口在 t=4s 就把 6-10s 算进去了，难度提前开始掉，
 * 而手上其实还在打 10dan 那一段。
 *
 * segmentCurveLookaheadMs 只留给需要「预读」的实验用，默认 0。
 */
function graphLocalSeries(graph, start, end, rate) {
    const rawTimes = graph.times || [];
    const values = graph.values || [];
    if (rawTimes.length < 4) return [];
    const times = rawTimes.map((t) => t * rate);
    const n = times.length;
    const prefixV = [0];
    const prefixW = [0];
    for (let i = 0; i < n; i += 1) {
        const t0 = times[i];
        const t1 = i + 1 < n ? times[i + 1] : Math.max(end, t0 + 1);
        const w = Math.max(1, t1 - t0);
        prefixV.push(prefixV[prefixV.length - 1] + values[i] * w);
        prefixW.push(prefixW[prefixW.length - 1] + w);
    }
    const windowMs = Math.max(200, Number(APP.segmentCurveWindowMs) || 1200);
    const lookaheadMs = Math.max(0, Number(APP.segmentCurveLookaheadMs) || 0);
    const stepMs = 250;
    const series = [];
    for (let t = start; t <= end; t += stepMs) {
        let value = sampleWindow(t - windowMs, t + lookaheadMs);
        // 开头（还没累积够 windowMs 的音符）不要出现 0 平台：
        // 往回取不到料时，临时借一点未来的音符顶上。
        if (!value.samples) value = sampleWindow(t - windowMs, t + windowMs);
        series.push({ t, v: value.v });
    }
    return series;

    function sampleWindow(lo, hi) {
        let a = 0;
        let b = n;
        while (a < b) { const m = (a + b) >> 1; if (times[m] < lo) a = m + 1; else b = m; }
        let c = a;
        while (c < n && times[c] < hi) c += 1;
        const w = prefixW[c] - prefixW[a];
        return { v: w > 0 ? (prefixV[c] - prefixV[a]) / w : 0, samples: c - a };
    }
}

function findSeriesSegments(series, delta, minMs, stepMs) {
    const minSteps = Math.max(2, Math.ceil(minMs / stepMs));
    const segments = [];
    let start = 0;
    while (start < series.length - 1) {
        let sum = 0;
        let count = 0;
        let boundary = null;
        for (let i = start; i < series.length; i += 1) {
            sum += series[i].v;
            count += 1;
            if (i - start < minSteps) continue;
            const mean = sum / count;
            let recentSum = 0;
            let recentCount = 0;
            for (let k = Math.max(start, i - 4); k <= i; k += 1) { recentSum += series[k].v; recentCount += 1; }
            if (Math.abs(recentSum / recentCount - mean) <= delta) continue;
            let j = i;
            while (j > start + 1 && Math.abs(series[j - 1].v - mean) > delta * 0.7) j -= 1;
            if (j > start + 1 && series[i].t - series[start].t >= minMs) {
                boundary = j;
                break;
            }
        }
        if (boundary === null) {
            const level = series.slice(start).reduce((acc, p) => acc + p.v, 0) / (series.length - start);
            segments.push({ from: series[start].t, to: series[series.length - 1].t, level });
            break;
        }
        let levelSum = 0;
        for (let k = start; k < boundary; k += 1) levelSum += series[k].v;
        const level = levelSum / (boundary - start);
        segments.push({ from: series[start].t, to: series[boundary].t, level });
        start = boundary;
    }
    return segments;
}

function snapBoundaries(segments, noteTimes, toleranceMs) {
    const snap = (t) => {
        let lo = 0;
        let hi = noteTimes.length - 1;
        let best = t;
        let bestDiff = toleranceMs;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const diff = Math.abs(noteTimes[mid] - t);
            if (diff < bestDiff) { bestDiff = diff; best = noteTimes[mid]; }
            if (noteTimes[mid] < t) lo = mid + 1;
            else hi = mid - 1;
        }
        return best;
    };
    for (let i = 0; i < segments.length - 1; i += 1) {
        const snapped = snap(segments[i].to);
        if (snapped > segments[i].from + 300 && snapped < segments[i + 1].to - 300) {
            segments[i].to = snapped;
            segments[i + 1].from = snapped;
        }
    }
}

function mergeShortSegments(segments, minMs, delta) {    const merged = segments.map((seg) => ({ ...seg }));
    let changed = true;
    while (changed && merged.length > 1) {
        changed = false;
        for (let i = 0; i < merged.length; i += 1) {
            const seg = merged[i];
            // 太短、或者音太少（< MIN_SEGMENT_NOTES）都不该单独成段 ——
            // Sunny 从十几个音外推出来的星数没有意义（实测 1 秒 17 个音能顶到 Epsilon）。
            // 这种段直接并进邻居，不产生任何段位，比硬标一个数字或标 VIBRO 都诚实。
            if (seg.to - seg.from >= minMs && (Number(seg.notes) || 0) >= MIN_SEGMENT_NOTES) continue;
            const prev = merged[i - 1];
            const next = merged[i + 1];
            const prevDiff = prev ? Math.abs(prev.level - seg.level) : Infinity;
            const nextDiff = next ? Math.abs(next.level - seg.level) : Infinity;
            const target = prevDiff <= nextDiff ? prev : next;
            const diff = Math.min(prevDiff, nextDiff);
            // 段很短、但确实是另一个难度台阶时别合并（否则边界会被吞掉 → 切换变慢）
            if (!target || diff > delta * 1.2) continue;
            if (target === prev) {
                const total = (prev.to - prev.from) + (seg.to - seg.from);
                prev.level = ((prev.level * (prev.to - prev.from)) + (seg.level * (seg.to - seg.from))) / total;
                prev.to = seg.to;
            } else {
                const total = (next.to - next.from) + (seg.to - seg.from);
                next.level = ((next.level * (next.to - next.from)) + (seg.level * (seg.to - seg.from))) / total;
                next.from = seg.from;
            }
            merged.splice(i, 1);
            changed = true;
            break;
        }
    }
    return merged;
}

function finalizeSegments(analysis, ranges) {
    const keys = analysis.keys;
    const segments = ranges.map((seg, index) => {
        const final = estimateRange(analysis, seg.from, seg.to);
        const rc = Number.isFinite(final.rc) ? final.rc : null;
        const ln = Number.isFinite(final.ln) ? final.ln : 0;
        const rcLabel = formatRc(rc, keys, APP.extendedRange);
        const lnLabel = formatLn(ln, keys, APP.extendedRange);
        const rcParsed = parseRc(rcLabel, keys);
        const lnParsed = parseLn(lnLabel, keys);
        return {
            index,
            from: Math.round(seg.from),
            to: Math.round(seg.to),
            rc,
            ln,
            notes: final.notes,
            lnRatio: final.lnRatio,
            rcLabel: rcLabel.startsWith("<") ? "" : rcLabel,
            lnLabel: lnLabel.startsWith("<") ? "" : lnLabel,
            color: rcParsed?.color || "#8a93a6",
            lnColor: lnParsed?.color || "#7dd3fc",
        };
    });
    return markVibro(analysis, segments);
}

/**
 * 合并难度相近的相邻段。
 *
 * **LN 占比必须一起判断**：用户反馈「密度相近、但前半段 LN 0%、后半段 40%」会被并成一段，
 * 结果前半段根本没 LN 也被标成 LN 17。所以除了 level 接近，还要求 LN 占比也接近。
 * 比较对象是**上一段的 LN 占比**（不是累计均值，均值会把台阶抹平）。
 */
function mergeSimilarSegments(segments, delta, maxMs, analysis) {
    const lnDelta = Number(APP.segmentMergeLnDelta) || 0.25;
    const merged = [];
    for (const seg of segments) {
        const segLn = lnRatioOf(analysis, seg.from, seg.to);
        const prev = merged[merged.length - 1];
        const prevLn = prev ? (Number.isFinite(prev.lastLn) ? prev.lastLn : prev.lnRatio) : null;
        const lnOk = prevLn === null || Math.abs(segLn - prevLn) <= lnDelta;
        if (prev && Math.abs(prev.level - seg.level) <= delta * 0.6 && (seg.to - prev.from) <= maxMs && lnOk) {
            const prevWeight = prev.to - prev.from;
            const segWeight = seg.to - seg.from;
            prev.level = (prev.level * prevWeight + seg.level * segWeight) / (prevWeight + segWeight);
            prev.lnRatio = ((prev.lnRatio || 0) * prevWeight + segLn * segWeight) / (prevWeight + segWeight);
            prev.lastLn = segLn;
            prev.to = seg.to;
        } else {
            merged.push({ ...seg, lnRatio: segLn, lastLn: segLn });
        }
    }
    return merged;
}

function graphSegments(analysis) {
    const graph = analysis.graph;
    if (!graph || !Array.isArray(graph.times) || graph.times.length < 8) return null;
    const rate = analysis.mods.rate || 1;
    const series = graphLocalSeries(graph, analysis.start, analysis.end, rate);
    if (series.length < 8) return null;

    const values = series.map((p) => p.v);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const delta = Math.max(0.3, Math.min(1.0, Math.sqrt(variance) * 0.22));
    const minMs = Math.min(Number(APP.segmentMinMs) || 1500, 1500);

    let ranges = findSeriesSegments(series, delta, minMs, 250);
    const noteTimes = graph.times.map((t) => t * rate);
    snapBoundaries(ranges, noteTimes, 350);
    ranges = mergeShortSegments(ranges, minMs, delta);
    // 难度长时间相近 → 合并成长段；难度在跳的区段保留短段（切密）。
    ranges = mergeSimilarSegments(ranges, delta, Number(APP.segmentMaxMs) || 32000, analysis);
    // 难度平坦但 LN 占比突变的段落要在这里拆开（findSeriesSegments 看不见 LN）。
    ranges = splitByLnRatio(ranges, analysis);
    if (!ranges.length) return null;

    ranges[0].from = analysis.start;
    ranges[ranges.length - 1].to = analysis.end;
    for (let i = 1; i < ranges.length; i += 1) {
        ranges[i].from = ranges[i - 1].to;
    }
    return finalizeSegments(analysis, ranges);
}

/**
 * 按 LN 占比把长段拆开。
 *
 * `findSeriesSegments` 只看**难度曲线**，所以"难度平坦但 LN 从 0% 突然变成 50%"这种段落
 * 会先被切成一个整块，后面的合并逻辑根本没机会拆 —— 用户反馈的
 * 「前半段 LN 0%、后半段 40%，却被标成 LN 17」就是这么来的。
 *
 * 做法：每段按 1 秒一格算 LN 占比，找最大的一次跳变，超过阈值就在那里切开，递归处理。
 * 切出来的段不短于 LN_SPLIT_MIN_MS，避免切出碎片。
 */
const LN_SPLIT_BIN_MS = 1000;
const LN_SPLIT_MIN_MS = 2500;

function splitByLnRatio(ranges, analysis) {
    const lnDelta = Number(APP.segmentMergeLnDelta) || 0.25;
    const out = [];
    const stack = ranges.map((seg) => ({ ...seg }));
    while (stack.length) {
        const cur = stack.pop();
        if (cur.to - cur.from < LN_SPLIT_MIN_MS * 2) { out.push(cur); continue; }
        const bins = [];
        for (let t = cur.from; t + LN_SPLIT_BIN_MS <= cur.to; t += LN_SPLIT_BIN_MS) {
            bins.push({ t, r: lnRatioOf(analysis, t, t + LN_SPLIT_BIN_MS) });
        }
        let best = null;
        for (let i = 1; i < bins.length; i += 1) {
            const jump = Math.abs(bins[i].r - bins[i - 1].r);
            const pos = bins[i].t;
            if (jump <= lnDelta) continue;
            if (pos - cur.from < LN_SPLIT_MIN_MS || cur.to - pos < LN_SPLIT_MIN_MS) continue;
            if (!best || jump > best.jump) best = { pos, jump };
        }
        if (!best) { out.push(cur); continue; }
        stack.push({ ...cur, from: best.pos });
        stack.push({ ...cur, to: best.pos });
    }
    return out.sort((a, b) => a.from - b.from);
}

/** 切段入口：优先用逐 note 难度曲线（边界 250ms 精度），失败回退到小节网格。 */
export function computeSegments(analysis) {
    if (APP.segmentationEnabled === false) return null;
    try {
        const viaGraph = graphSegments(analysis);
        if (viaGraph && viaGraph.length) return viaGraph;
    } catch (error) {
        console.warn("[ManiaLiveDan] graph segmentation failed", error);
    }
    return barSegments(analysis);
}
