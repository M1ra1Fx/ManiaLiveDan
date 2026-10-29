// 4K 模式：Reform 1-10 → Alpha…Kappa，LN 1-17。
// 这一套是插件的原始基准，其它两个键数都以它为参照（亮度/转速刻度、光环分配）。

const DIR = "assets/dan/4k";

/** 分档后缀 → 素材文件名后缀。mid（无符号）就是基础图。 */
export function variantSuffix(suffix) {
    switch (String(suffix || "").toLowerCase()) {
        case "low": return "-low";
        case "mid/low": return "-mid-low";
        case "mid/high": return "-mid-high";
        case "high": return "-high";
        default: return "";
    }
}

/** 4K 的希腊字母档（tierKey 就是 alpha…kappa）。 */
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"]);

export const mode4k = {
    keys: 4,
    label: "4K",
    rcPrefix: "Reform",
    lnMinStar: 4.832,
    maxRank: 20,
    // 4K 的具名档是希腊字母，走 greek 分支，不用这张表
    namedRanks: {},
    // 亮度/转速/呼吸的基准：其它键数以此为 1.0
    glow: { dScale: 1.0, breatheFrom: 14, breatheSpan: 16, speedScale: 1.0 },

    badge(kind, tierKey, suffix) {
        if (!tierKey) return null;
        const v = variantSuffix(suffix);
        if (kind === "ln") {
            return `${DIR}/ln/${tierKey}${v}.svg`;
        }
        if (GREEK.has(tierKey)) {
            return `${DIR}/rc/${tierKey}${v}.webp`;
        }
        return `${DIR}/rc/${tierKey}${v}.svg`;
    },

    palette() {
        return null;
    },
};
