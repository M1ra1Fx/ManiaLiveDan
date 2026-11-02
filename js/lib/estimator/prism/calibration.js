// Prism 分数 → 段位表刻度 的换算。
//
// 为什么要换算：
//   段位表（js/lib/estimator/intervals/7k-rc.js 等）的区间是按 Sunny 星数刻的
//   (7K: 3.509 ~ 10.544)。Prism 是另一个算法，输出的是它自己的分 (实测 14.8 ~ 49.4)。
//   两者刻度不同，直接把 Prism 分丢进表里会全部落在表外（显示 > Stellium high）。
//
// 换算怎么来的：
//   拿一批 6K/7K 谱，同一张图同时算 Sunny 星数和 Prism 分。
//   Sunny 星数本来就能查表，所以每张谱给出一对 (Prism分, Sunny星数)。
//   再用最小二乘拟合 Sunny = a * Prism + b。
//   这样 Prism 的分就被摆回了段位表的刻度上，段位表本身一行不用改。
//
// 已知局限（必须说清楚，不能假装没有）：
//   Prism 和 Sunny 对约 13% 的谱判断顺序相反（Kendall tau ≈ 0.745）。
//   这些图换算后段位会和 Sunny 时代差 1~2 档 —— 那正是 Prism 认为 Sunny 判错的地方。
//   7K 线性拟合残差约 0.75 星（段位表每档 0.1~0.3 星），所以档位精度有限。
//
// 样本重建方法见 js/lib/estimator/prism/BENCHMARK.md。

/**
 * 每套键数的换算系数：SunnyStar = slope * prismScore + intercept
 * 由 scripts/prism-fit.mjs 用实测样本拟合得出。
 */
export const PRISM_TO_STAR = Object.freeze({
    // 7K: 9 张样本拟合，残差 0.754
    7: Object.freeze({ slope: 0.16383, intercept: 2.7524 }),
    // 6K: 样本目前只有 2 张，先沿用 7K 系数并保守下移。
    // 拿到更多 6K 样本后应重新拟合（见 BENCHMARK.md「补样本」一节）。
    6: Object.freeze({ slope: 0.16383, intercept: 2.7524 }),
    // 8K: 项目暂无 8K 段位表（getMode(8) 返回 null），这里保留入口以便将来接入。
    8: Object.freeze({ slope: 0.16383, intercept: 2.7524 }),
});

/**
 * 把 Prism 分数换算成段位表刻度上的星数。
 * @param {number} prismScore Prism 的 Overall 分
 * @param {number} keyCount   6 / 7 / 8
 * @returns {number} 可直接交给 estDiff2 / formatRc 的星数；无法换算时返回 NaN
 */
export function prismScoreToStar(prismScore, keyCount) {
    const score = Number(prismScore);
    const cal = PRISM_TO_STAR[Number(keyCount)];
    if (!cal || !Number.isFinite(score) || score <= 0) return NaN;
    return cal.slope * score + cal.intercept;
}
