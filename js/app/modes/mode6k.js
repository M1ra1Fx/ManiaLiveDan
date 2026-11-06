// 6K 模式：Regular 0-9 → Terra / Celestial / Mystery / Nihility / Finish，
// LN 阶梯与 RC 同名同数量。
//
// 注意：Terra…Finish 五档的星数区间是**推算值**，不是官方数字。
// MMA 上游的 6k-rc.js 只到 Regular 9 high（7.965 星），这一段是按它自己的
// 档距递减规律接上去的（Regular 8 宽 0.36、Regular 9 宽 0.33，继续按 0.917 倍收窄）。

import { namedPalette } from "./palettes.js";
import { variantSuffix } from "./mode4k.js";

const DIR = "assets/dan/6k";

export const mode6k = {
    keys: 6,
    label: "6K",
    rcPrefix: "Regular",
    // 6K LN 表的**首档星数**（6k-ln.js 首档 = [3.530, 3.718, "LN 0 low"]）。
    //
    // ⚠️ 这是唯一门槛：整图和当前段都用它。星数低于它 = 够不上最弱一档 = 不显示 LN 档位
    // （也不显示 "< 最弱档" 兜底）。运行时实际取值来自 dan.js 的 lnFloorStar()，
    // 直接读区间表首档；这里保留同值只是给模式模块自己参考，改表时记得同步。
    lnMinStar: 3.530,
    maxRank: 14,
    namedRanks: { terra: 10, celestial: 11, mystery: 12, nihility: 13, finish: 14 },
    // 6K 整体比 4K 难：难度系数 ×1.5，从 7dan 起呼吸，转速同步 +50%
    glow: { dScale: 1.5, breatheFrom: 7, breatheSpan: 7, speedScale: 1.5 },

    badge(kind, tierKey, suffix) {
        if (!tierKey) return null;
        const v = variantSuffix(suffix);
        return `${DIR}/${kind === "ln" ? "ln" : "rc"}/${tierKey}${v}.svg`;
    },

    palette(tierKey) {
        return namedPalette(6, tierKey);
    },
};
