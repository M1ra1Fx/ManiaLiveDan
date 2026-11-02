// Prism 分 → 段位表刻度（星数）的换算。
//
// ── 为什么要换算 ──────────────────────────────────────────────
// 段位表（7k-rc.js 等）的区间是按 Sunny 星数刻的（7K: 3.509 ~ 10.544）。
// Prism 输出的是它自己的分（实测 14.8 ~ 49.4），直接查表会全部落在表外。
//
// ── 怎么换算（无拟合参数）────────────────────────────────────
// Prism 内部有一条完整的数学链：
//
//   每 500ms 段 demand → 二分求解 strain → 查 SCALE 表 → 最终分（rating）
//
// 最后一步实现在上游 `prism_rating_of_strain()`（crates/prism/src/lib.rs），
// 是**对数域的线性插值**，因此严格单调、可以精确求逆：
//
//   log(rating) = log(y0) + k · (log(strain) − log(x0))
//   ⇒ strain = exp( log(x0) + (log(rating) − log(y0)) / k )
//
// 反解出来的 strain **本身就是星级尺度**：
// 实测 11 张官方标尺图，strain / Sunny 星数的比值均值为 1.00，
// 所以可以直接喂给现有段位表，不需要任何人为缩放。
//
// 这样做的好处：换算过程**零自由参数**，不是拟合出来的，是 Prism 自己的数学。
//
// ── RC 和 LN 必须分开 ─────────────────────────────────────────
// Prism 的 Overall 走 press 模型，几乎不感知长条。
// 纯 LN 图（例如 Avril 14th）Overall 只有 18.5，但它的 LN 分是 27.1。
// 官方公告也正是把 LN 单独列一栏。所以：
//   Overall 分 → SCALE_7K / SCALE_6K   → 查 RC 表
//   LN 分      → LN_SCALE_7K / LN_SCALE_6K → 查 LN 表
//
// ── 数据来源 ─────────────────────────────────────────────────
// 全部取自上游 mania-hub `algorithms/prism`（MIT, v0.25）：
//   crates/prism/src/params.rs  —— SCALE_7K / SCALE_6K / LN_SCALE_7K / LN_SCALE_6K
//   crates/prism/src/lib.rs     —— prism_rating_of_strain()

/** 7K press 模型的比例表（params.rs: SCALE_7K） */
const SCALE_7K = Object.freeze({
    strain: [0.9903, 1.688, 2.928, 3.814, 4.424, 4.907, 5.357, 5.792, 6.338, 6.81, 7.558, 8.248, 9.136, 10.73, 12.61],
    rating: [2.151, 5.006, 10.21, 14.3, 17.02, 19.09, 20.82, 22.81, 24.59, 26.53, 28.51, 30.41, 33.0, 36.68, 40.62],
});

/** 6K press 模型（params.rs: SCALE_6K） */
const SCALE_6K = Object.freeze({
    strain: [0.8068, 1.47, 2.464, 3.282, 3.843, 4.141, 4.511, 4.971, 5.313, 5.629, 5.991, 6.381, 7.191, 8.341, 9.911],
    rating: [2.716, 5.316, 10.49, 13.68, 16.02, 17.91, 19.82, 21.29, 22.65, 24.23, 25.46, 27.09, 29.16, 33.98, 37.35],
});

/** 7K LN 模型（params.rs: LN_SCALE_7K） */
const LN_SCALE_7K = Object.freeze({
    strain: [2.079, 3.783, 5.305, 6.591, 7.534, 8.225, 8.881, 9.563, 10.18, 10.96, 11.56, 12.89, 14.13, 16.74, 20.07],
    rating: [3.994, 9.566, 15.8, 21.12, 24.54, 26.71, 28.21, 29.45, 30.59, 32.27, 33.45, 35.17, 36.72, 39.58, 43.01],
});

/** 6K LN 模型（params.rs: LN_SCALE_6K） */
const LN_SCALE_6K = Object.freeze({
    strain: [1.859, 2.604, 4.697, 5.59, 6.051, 6.663, 6.881, 7.164, 7.523, 7.713, 8.027, 8.748, 9.888, 12.88, 15.73],
    rating: [4.237, 6.534, 14.97, 19.43, 20.77, 22.63, 22.85, 24.14, 25.06, 26.74, 27.52, 28.23, 31.15, 35.44, 38.8],
});

/** 8K 由 7K 派生，规则同上游 params.rs：press rating ×0.892，LN strain ×1.599 */
const SCALE_8K = Object.freeze({
    strain: SCALE_7K.strain,
    rating: SCALE_7K.rating.map((r) => r * 0.892),
});
const LN_SCALE_8K = Object.freeze({
    strain: SCALE_8K.strain.map((s) => s * 1.599),
    rating: SCALE_8K.rating,
});

/** 键数 → { press, ln } 两套比例表 */
const SCALES_BY_KEYCOUNT = Object.freeze({
    6: Object.freeze({ press: SCALE_6K, ln: LN_SCALE_6K }),
    7: Object.freeze({ press: SCALE_7K, ln: LN_SCALE_7K }),
    8: Object.freeze({ press: SCALE_8K, ln: LN_SCALE_8K }),
});

/**
 * Prism 分 → strain（星级尺度）。
 *
 * 这是上游 `prism_rating_of_strain()` 的精确逆运算。
 * 超出最后一个点时按最后一段的对数斜率外推 —— 与上游正向函数的行为一致。
 *
 * @param {number} rating Prism 分
 * @param {{strain:number[], rating:number[]}} scale 对应的比例表
 * @returns {number} strain；输入无效时返回 NaN
 */
export function prismRatingToStrain(rating, scale) {
    const score = Number(rating);
    if (!scale || !Number.isFinite(score) || score <= 0) return NaN;

    const xs = scale.strain;
    const ys = scale.rating;
    const y = Math.log(score);

    // 找到 rating 落在哪一段（最后一段之后按同一段外推）
    let i = 1;
    while (i < ys.length - 1 && y > Math.log(ys[i])) i += 1;

    const y0 = Math.log(ys[i - 1]);
    const x0 = Math.log(xs[i - 1]);
    const y1 = Math.log(ys[i]);
    const x1 = Math.log(xs[i]);

    if (y1 === y0) return Math.exp(x0);
    return Math.exp(x0 + ((x1 - x0) / (y1 - y0)) * (y - y0));
}

/**
 * Prism 分 → 段位表刻度上的星数（RC 用）。
 * @param {number} prismScore Prism 的 Overall 分
 * @param {number} keyCount   6 / 7 / 8
 */
export function prismScoreToStar(prismScore, keyCount) {
    const scales = SCALES_BY_KEYCOUNT[Number(keyCount)];
    if (!scales) return NaN;
    return prismRatingToStrain(prismScore, scales.press);
}

/**
 * Prism 的 LN 分 → 段位表刻度上的星数。
 *
 * ⚠️ 和 RC 不同：LN **不能**用上面的无参数反解。
 *
 * 原因：`LN_SCALE_7K` 的 strain 起点是 2.079（press 是 0.9903），LN 模型的内部分布
 * 和 press 不是同一套刻度。实测 5 张重 LN 图，直接反解出的 strain 与 Sunny LN 星数的
 * 比值均值为 1.633、跨度 1.74x —— 系统性偏高且不稳定，不能靠乘系数修掉。
 *
 * 所以 LN 用这 5 张样本直接对 Sunny LN 星数做线性回归：
 *   2617975 (99% holds) 2672368 (97%) 963008 (100%) 1527715 (40%) 5074941 (37%)
 *   最大残差 1.07 星，其中 4 张 < 0.5 星。
 *
 * 样本条件：只取长条占比 ≥ 37% 的图 —— 官方定义的 LN 图门槛（PRISM_LN_LEAD_FROM_HOLDS）。
 * 占比低的图本来就没有有意义的 LN 段位���Sunny 那边也会给空。
 *
 * @param {number} prismLnScore Prism 的 LN 分
 * @param {number} keyCount     6 / 7 / 8
 */
export function prismLnScoreToStar(prismLnScore, keyCount) {
    const score = Number(prismLnScore);
    const cal = LN_CALIBRATION[Number(keyCount)];
    if (!cal || !Number.isFinite(score) || score <= 0) return NaN;
    return cal.slope * score + cal.intercept;
}

/**
 * LN 回归系数（7K 由 5 张样本拟合；6K/8K 暂无足够样本，沿用 7K）。
 * 拿到更多 6K/8K 重 LN 样本后应重新拟合，见 BENCHMARK.md。
 */
const LN_CALIBRATION = Object.freeze({
    6: Object.freeze({ slope: 0.22349, intercept: 0.3295 }),
    7: Object.freeze({ slope: 0.22349, intercept: 0.3295 }),
    8: Object.freeze({ slope: 0.22349, intercept: 0.3295 }),
});

/** 导出比例表，供测试与调试用。 */
export const PRISM_SCALES = SCALES_BY_KEYCOUNT;
