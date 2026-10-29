// 分段级 vibro 判定（本地，不依赖 Etterna / MMA）。
//
// 定义：vibro 是「单列速度超过人类手指连打极限」的段落。正常手指单列上限约 9–10 NPS，
// 再快就只能靠手腕抖动，而抖出来的东西和 Jack/Tech/Speed/Stamina 不是同一种能力。
// 星数算法一定会把它当极限 JackSpeed 算高（RPG 7* 那段被算成 LN17+ε 就是这么来的），
// 但会 vibro 的人能轻松过，所以这个数字对玩家是误导。
//
// 四条判据（必须同时成立）：
//   1. 最忙单列 ≥ 10 NPS
//   2. 同列相邻间隔中位数 ≤ 100ms
//   3. 该列音符的「单音率」≥ 0.4 —— 至少四成音符是单独落下的，不是全被和弦裹住
//   4. 连续超短间隔持续 ≥ 1.5s
//
// 第 3 条是关键：一张谱可以有单列连打，但整体是高速三押叠键，那是「很难的叠谱」。
// 三押时每一列都能刷到 20 NPS，只靠 1、2 条分不开和弦和 vibro，必须看音符是不是单独落的。
//
// 阈值由来（实测）：
//   - 间隔 92→100ms、单音率 0.7→0.4，是为了让「锚点连打」也算 vibro ——
//     即某一列在 97ms 一下不停地响、其它列叠和弦上去（RPG Overdrive 165s 那段）。
//     三押叠键的单音率接近 0，仍然会被挡住，不会误伤。

const MAX_GAP_MS = 100;
const MIN_COL_NPS = 10;
const MIN_ALONE_RATIO = 0.4;
const MIN_SPAN_MS = 1000;
const MIN_SEG_SHARE = 0.45;
const MIN_NOTES = 24;

/** 从解析结果里取出 [{t, c}]，按时间排序。 */
export function extractNotes(parser) {
    const data = parser.getParsedData();
    const starts = data.noteStarts || [];
    const cols = data.columns || [];
    const notes = [];
    for (let i = 0; i < starts.length; i += 1) {
        const t = Number(starts[i]);
        if (!Number.isFinite(t)) continue;
        notes.push({ t, c: Number(cols[i]) });
    }
    notes.sort((a, b) => a.t - b.t);
    return notes;
}

function median(values) {
    if (!values.length) return Number.POSITIVE_INFINITY;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 分析一个时间区间内的 vibro 特征。
 *
 * 注意不能按「整段平均 NPS」算：vibro 常常只是段里的一段爆发，摊到整段就被稀释了。
 * 所以按**连续连打段**（同列、间隔 ≤ 92ms 的连续串）来算速度，
 * 再看这一串够不够长、是不是单音。
 *
 * @returns {{vibro:boolean, share:number, maxColNps:number, gapMedian:number, aloneRatio:number, spanMs:number}}
 */
export function analyzeVibro(notes, from, to) {
    const empty = { vibro: false, share: 0, maxColNps: 0, gapMedian: Infinity, aloneRatio: 0, spanMs: 0 };
    const window = notes.filter((n) => n.t >= from && n.t < to);
    if (window.length < MIN_NOTES) return empty;

    // 每个时间戳上有几个音符（用于判断「单音」）
    const perTime = new Map();
    for (const n of window) perTime.set(n.t, (perTime.get(n.t) || 0) + 1);

    const byCol = new Map();
    for (const n of window) {
        if (!byCol.has(n.c)) byCol.set(n.c, []);
        byCol.get(n.c).push(n.t);
    }

    let best = { nps: 0, gapMedian: Infinity, aloneRatio: 0, spanMs: 0, notes: 0 };
    // 一段里通常有好几串 vibro（中间会被别的音符打断），要把**所有**合格的串都算上，
    // 否则 share 会被稀释成个位数，真正的 vibro 段反而标不出来。
    let qualifyingNotes = 0;

    for (const times of byCol.values()) {
        if (times.length < 8) continue;

        let runStart = 0;
        for (let i = 1; i <= times.length; i += 1) {
            const gap = i < times.length ? times[i] - times[i - 1] : Number.POSITIVE_INFINITY;
            if (gap <= MAX_GAP_MS) continue;

            const run = times.slice(runStart, i);
            runStart = i;
            if (run.length < 8) continue;

            const spanMs = run[run.length - 1] - run[0];
            if (spanMs < MIN_SPAN_MS) continue;

            const nps = ((run.length - 1) / spanMs) * 1000;
            const gaps = [];
            for (let k = 1; k < run.length; k += 1) gaps.push(run[k] - run[k - 1]);
            const gapMedian = median(gaps);
            const alone = run.filter((t) => (perTime.get(t) || 0) === 1).length;
            const aloneRatio = alone / run.length;

            // 这一串本身要满足「够快 + 够短间隔 + 是单音」
            if (nps < MIN_COL_NPS || gapMedian > MAX_GAP_MS || aloneRatio < MIN_ALONE_RATIO) continue;

            qualifyingNotes += run.length;
            if (nps > best.nps) {
                best = { nps, gapMedian, aloneRatio, spanMs, notes: run.length };
            }
        }
    }

    const vibro = best.nps >= MIN_COL_NPS
        && best.gapMedian <= MAX_GAP_MS
        && best.aloneRatio >= MIN_ALONE_RATIO
        && best.spanMs >= MIN_SPAN_MS;

    return {
        vibro,
        share: window.length ? qualifyingNotes / window.length : 0,
        maxColNps: best.nps,
        gapMedian: best.gapMedian,
        aloneRatio: best.aloneRatio,
        spanMs: best.spanMs,
    };
}

/**
 * 在**整张谱**上找出所有合格的 vibro 连打串。
 *
 * 必须在整谱上找，不能逐段找：vibro 串通常只有 1–1.5 秒，
 * 一旦被分段边界切开，两半都不够长，真正的 vibro 段反而标不出来。
 *
 * @returns {Array<{col:number, from:number, to:number, notes:number, nps:number, gapMedian:number, aloneRatio:number}>}
 */
export function findVibroRuns(notes) {
    const runs = [];
    if (!Array.isArray(notes) || notes.length < MIN_NOTES) return runs;

    const perTime = new Map();
    for (const n of notes) perTime.set(n.t, (perTime.get(n.t) || 0) + 1);

    const byCol = new Map();
    for (const n of notes) {
        if (!byCol.has(n.c)) byCol.set(n.c, []);
        byCol.get(n.c).push(n.t);
    }

    for (const [col, times] of byCol) {
        if (times.length < 8) continue;
        let runStart = 0;
        for (let i = 1; i <= times.length; i += 1) {
            const gap = i < times.length ? times[i] - times[i - 1] : Number.POSITIVE_INFINITY;
            if (gap <= MAX_GAP_MS) continue;

            const run = times.slice(runStart, i);
            runStart = i;
            if (run.length < 8) continue;

            const spanMs = run[run.length - 1] - run[0];
            if (spanMs < MIN_SPAN_MS) continue;

            const nps = ((run.length - 1) / spanMs) * 1000;
            const gaps = [];
            for (let k = 1; k < run.length; k += 1) gaps.push(run[k] - run[k - 1]);
            const gapMedian = median(gaps);
            const alone = run.filter((t) => (perTime.get(t) || 0) === 1).length;
            const aloneRatio = alone / run.length;

            if (nps < MIN_COL_NPS || gapMedian > MAX_GAP_MS || aloneRatio < MIN_ALONE_RATIO) continue;

            runs.push({
                col,
                from: run[0],
                to: run[run.length - 1],
                notes: run.length,
                nps,
                gapMedian,
                aloneRatio,
            });
        }
    }
    return runs;
}

/**
 * 给分段结果打 vibro 标记。
 *
 * 判定的是「这一段里有多少音符属于 vibro 连打」，不是「段里有没有 vibro」——
 * 一段叠完之后最后半小节才转 vibro 的混合段，占比不够就不会被整段标成 VIBRO。
 *
 * @returns {number} 被标记的段数
 */
export function applyVibroToSegments(segments, notes) {
    if (!Array.isArray(segments) || !segments.length || !notes || !notes.length) return 0;

    const runs = findVibroRuns(notes);
    let count = 0;

    for (const seg of segments) {
        const inside = runs.filter((r) => r.to >= seg.from && r.from <= seg.to);
        const total = notes.filter((n) => n.t >= seg.from && n.t < seg.to).length;
        // 按串与段的重叠时间估算落在这段里的音符数
        let vibroNotes = 0;
        for (const run of inside) {
            const overlap = Math.max(0, Math.min(run.to, seg.to) - Math.max(run.from, seg.from));
            const span = Math.max(1, run.to - run.from);
            vibroNotes += run.notes * (overlap / span);
        }
        const share = total > 0 ? Math.min(1, vibroNotes / total) : 0;
        const best = inside.sort((a, b) => b.nps - a.nps)[0] || null;

        seg.vibro = Boolean(best) && share >= MIN_SEG_SHARE;
        seg.vibroInfo = best
            ? { share, maxColNps: best.nps, gapMedian: best.gapMedian, aloneRatio: best.aloneRatio, spanMs: best.to - best.from }
            : { share: 0, maxColNps: 0, gapMedian: Infinity, aloneRatio: 0, spanMs: 0 };
        if (seg.vibro) count += 1;
    }
    return count;
}
