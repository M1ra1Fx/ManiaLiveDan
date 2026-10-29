// 具名段位的光环色卡 —— 统一走「白色里藏色」。
//
// 为什么不是实色：网页上 6K/7K 的具名徽章（terra / gamma …）本身是**单色银质**，
// 从 SVG 抽色只能抽出一组灰（#d4d4d8 / #ababb2 / #7e7e86），四个段位全是同一根灰灯管。
// 所以改用手调：**底色是白，色相藏在泛光里**，跟 LN 17「五彩斑斓的白」一个思路。
//
// 灯芯那层 brightness 1.6~2.4 会把任何颜色烧成白，所以真正能看见颜色的是管壁和远光；
// ui.js 里对这些具名段额外把远光调浓、调艳（和 LN 17 同样的加成），白芯不动，彩在泛光。

const IRIDESCENT = ["#ffa8d8", "#c8a8ff", "#a8c8ff", "#8ff0d0", "#a8ecff"];

export const NAMED_PALETTES = {
    // ---- 6K：青绿 → 蓝 → 紫 → 暗紫 → 五彩 ----
    "6:terra": ["#eafff7", "#ccf7e8", "#a8f0d4", "#e6fff9"],
    "6:celestial": ["#eef6ff", "#d2e8ff", "#a8d0ff", "#eaf4ff"],
    "6:mystery": ["#f4eeff", "#ded2ff", "#c0a8ff", "#f0e8ff"],
    "6:nihility": ["#efe9f7", "#d5c8e8", "#b09ad0", "#e8e0f4"],
    "6:finish": IRIDESCENT.slice(),

    // ---- 7K：白里藏青 → 白里藏蓝紫 → 白里藏紫红 → 五彩 ----
    "7:gamma": ["#e8fdff", "#cdf4ff", "#a8ecff", "#e6fbff"],
    "7:azimuth": ["#efeeff", "#d8d6ff", "#b8b2ff", "#eceaff"],
    "7:zenith": ["#ffeef8", "#ffd9ef", "#ffb8e0", "#ffe8f4"],
    "7:stellium": IRIDESCENT.slice(),
};

/** 取具名段位的色卡；没有对应项返回 null，调用方回退到默认渐变。 */
export function namedPalette(keys, tierKey) {
    if (!tierKey) return null;
    return NAMED_PALETTES[`${keys}:${tierKey}`] || null;
}

/** 该具名段位是否需要「白芯彩光」的加成（远光调浓调艳）。 */
export function isIridescent(keys, tierKey) {
    return Boolean(tierKey) && Boolean(NAMED_PALETTES[`${keys}:${tierKey}`]);
}

/**
 * 走 LN 17 同款的段位：6K Finish 与 7K Stellium（两个阶梯的终点）。
 * 这两个不只要五彩色卡，连**光晕强度**和**卡片底色**都要和 LN 17 一模一样，
 * 否则和 LN 17 摆在一起会明显不是一套。
 */
const LN17_STYLE = new Set(["6:finish", "7:stellium"]);

export function isLn17Style(keys, tierKey) {
    return Boolean(tierKey) && LN17_STYLE.has(`${keys}:${tierKey}`);
}

/** LN 17 的卡片底色（银白），给 LN17 同款段位共用。 */
export const LN17_CARD = ["#dfe6f2", "#aeb8cc"];
