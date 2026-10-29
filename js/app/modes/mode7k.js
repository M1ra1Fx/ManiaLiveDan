// 7K 模式：Regular 0-10 → Gamma / Azimuth / Zenith / Stellium，LN 阶梯同名同数量。
// 不做 Wild 表；超过 Stellium 直接封顶在 Stellium high（显示 stellium++）。

import { namedPalette } from "./palettes.js";
import { variantSuffix } from "./mode4k.js";

const DIR = "assets/dan/7k";

export const mode7k = {
    keys: 7,
    label: "7K",
    rcPrefix: "Regular",
    lnMinStar: 0,
    maxRank: 14,
    namedRanks: { gamma: 11, azimuth: 12, zenith: 13, stellium: 14 },
    glow: { dScale: 1.5, breatheFrom: 7, breatheSpan: 7, speedScale: 1.5 },

    badge(kind, tierKey, suffix) {
        if (!tierKey) return null;
        const v = variantSuffix(suffix);
        return `${DIR}/${kind === "ln" ? "ln" : "rc"}/${tierKey}${v}.svg`;
    },

    palette(tierKey) {
        return namedPalette(7, tierKey);
    },
};
