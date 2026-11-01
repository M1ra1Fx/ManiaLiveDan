// DOM 渲染与时间轴绘制。所有入口都做了空值保护，数据没到也不会炸。
import { hasDanTable, parseRc, parseLn, tierMark } from "./dan.js";
import { getMode } from "./modes/index.js";
import { getSetting } from "./settings.js";
import { t, getLanguage } from "./i18n.js";
import { isLn17Style, LN17_CARD } from "./modes/palettes.js";
import { APP } from "./config.js";

/** 是否要把 "Intro 1/2/3" 隐藏掉（配置项 hideIntro）。 */
function isHiddenIntro(parsed) {
    return Boolean(APP.hideIntro && parsed && /^intro\s+\d+$/i.test(parsed.family || ""));
}

/**
 * 希腊字母的光晕色卡：顺序 = 贴图上的**从左到右**，**数量随贴图实际颜色丰富度自适应**。
 * 由 tests/build_glow_palettes.py 生成（x 轴切 6 条取色 → 合并相邻相近色 → 夹到 1..5）。
 * beta / eta / theta 贴图本身就是单色，所以只有 1 个颜色——这是对的，不要"补"。
 */
/**
 * η / θ 的"血红色 + 细微层次"。
 *
 * 原来这两个段位是单色（eta `#ac100c` / theta `#9d0b07`），铺在 66% 的弧上就是一整块死红，
 * 用户原话「eta theta 纯红色太丑了」。但也不能真的做成彩虹 ——
 * 用户随后明确「也不要太五彩斑斓，整体还要是血红色」。
 *
 * 所以色相只在一个很窄的带里摆：**350° ~ 10°**，全部是红。
 * "五彩"靠的是明度和饱和度在走（暗绯 → 血红 → 正红 → 朱红 → 酒红），
 * 不是靠色相乱跳。转起来能看出层次，但远看仍然是一根血红色的灯管。
 *
 * θ 比 η 强一档：暗端压得更深（`#5e050c`），亮端顶得更热（`#ff3a1e`），对比更大，
 * 再叠加 `glowSpecFor` 里给 theta 的远光/灯芯加成。
 */
const ETA_IRIDESCENT_RED = ["#8a0b14", "#b3121a", "#dc1f1c", "#ef2b1e", "#9c0f1e"];
const THETA_IRIDESCENT_RED = ["#5e050c", "#8f0a12", "#c21418", "#e81f1a", "#ff3a1e"];

const GREEK_GLOW = {
    alpha: ["#874d9f", "#d64b60", "#f4704a", "#d8be38"],
    beta: ["#fec34e"],
    gamma: ["#d90e1f", "#7f41c4", "#43bcd7", "#53e4c0"],
    delta: ["#926979", "#af7556", "#df9251", "#fda34a"],
    epsilon: ["#c83c57", "#8b426c", "#b74d63", "#8f3766", "#275c98"],
    zeta: ["#c2613e", "#c09d9c", "#8d99b2", "#9ac8d4", "#62a6d4"],
    "emik zeta": ["#c2613e", "#c09d9c", "#8d99b2", "#9ac8d4", "#62a6d4"],
    eta: ETA_IRIDESCENT_RED,
    "thaumiel eta": ETA_IRIDESCENT_RED,
    theta: THETA_IRIDESCENT_RED,
    "cloverwisp theta": THETA_IRIDESCENT_RED,
    iota: ["#830806", "#cd0908", "#7e0c0d"],
    kappa: ["#e3c233", "#cca54b", "#6db9d4", "#94bd95", "#2fd1f3"],
};

/**
 * LN 11+ 的光晕色卡：每级 2 个颜色，取自该级贴图的渐变停靠点
 * （取艳丽度最高的两个，再按贴图原顺序排——不能用"首+尾"，LN5 会取到发暗的橄榄色）。
 */
const LN_GLOW = {
    1: ["#e85f93", "#65e0d3"],
    2: ["#f18c42", "#31d2d6"],
    3: ["#61d957", "#28b6d7"],
    4: ["#e0bf52", "#55d584"],
    5: ["#dcc15d", "#8f7f32"],
    6: ["#f0d342", "#db3f3f"],
    7: ["#e97742", "#cf5f8e"],
    8: ["#b45bdf", "#f09643"],
    9: ["#ee464d", "#a34cff"],
    10: ["#e24343", "#d6e94c"],
    11: ["#6fb8f2", "#f0d386"],
    12: ["#ff7a32", "#e74235"],
    13: ["#5272e8", "#8f5bdc"],
    14: ["#cfc8bf", "#b23845"],
    15: ["#696df2", "#e66aac"],
    16: ["#9a7cf0", "#f08fc4"],
    17: ["#dfe6f2", "#aeb8cc"],
};

/**
 * LN 17 光晕专用：五彩斑斓的白（5 段 = 五彩）。段位后缀不用这组。
 *
 * 首段必须是白：LN 弧的两端都紧挨着米段（红/粉），
 * 起手给一块纯白，弧的边界才分得开；后面四段再依次粉、紫、蓝、薄荷。
 * 整体亮度压在 92% 以上，靠霓虹滤镜的 saturate 提色，
 * 灯芯那层再被 brightness 烧一遍 —— 结果就是"管是白的，光在泛彩"。
 */
const LN17_IRIDESCENT = ["#ffa8d8", "#c8a8ff", "#a8c8ff", "#8ff0d0", "#a8ecff"];

function colorWithAlpha(hex, alpha) {
    const value = String(hex || "").replace("#", "");
    if (value.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function parseHex(hex) {
    const value = String(hex || "").replace("#", "");
    if (value.length !== 6) return [255, 255, 255];
    return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
    ];
}

function toHex(rgb) {
    return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
}

function lighten(hex, amount) {
    const [r, g, b] = parseHex(hex);
    const t = clamp01(amount);
    return toHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
}

function rgbToHsl(r, g, b) {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h /= 6;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    const hueToRgb = (p, q, t) => {
        let value = t;
        if (value < 0) value += 1;
        if (value > 1) value -= 1;
        if (value < 1 / 6) return p + (q - p) * 6 * value;
        if (value < 1 / 2) return q;
        if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
        return p;
    };
    if (s === 0) {
        const value = l * 255;
        return [value, value, value];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        hueToRgb(p, q, h + 1 / 3) * 255,
        hueToRgb(p, q, h) * 255,
        hueToRgb(p, q, h - 1 / 3) * 255,
    ];
}

function rotateHue(hex, degrees) {
    const [r, g, b] = parseHex(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    return toHex(hslToRgb((h + degrees / 360 + 1) % 1, s, l));
}

/** 米段数字图（1-10）统一的青铜渐变 */
const RC_NUMBER_TIER = ["#d2c6c1", "#9a7b6c", "#7b543f"];

/**
 * 查希腊段位的取色表。
 *
 * parseRc 给的 `english` 是**完整家族名**（"Thaumiel Eta" / "Emik Zeta" / "CloverWisp Theta"），
 * 而 GREEK_GLOW 的键是短名（eta / zeta / theta）。直接 `GREEK_GLOW[english]` 查不到，
 * 这三个段位会一直落到兜底灰/贴图色上——之前它们的光晕根本不是取色表里的颜色。
 */
function greekPaletteOf(parsed) {
    const key = greekKeyOf(parsed);
    if (!key) return null;
    const full = String(parsed.english || "").toLowerCase().trim();
    return GREEK_GLOW[key] || GREEK_GLOW[full] || null;
}

/**
 * 希腊段位的**短名**（`eta` / `theta` / …）。
 * 注意必须返回短名，不能返回完整家族名 —— 之前这里对 `CloverWisp Theta` 返回的是
 * `cloverwisp theta`，导致 `greekKey === "theta"` 永远不成立，θ 的加成整段没生效。
 */
function greekKeyOf(parsed) {
    if (!parsed) return "";
    const raw = String(parsed.english || "").toLowerCase().trim();
    if (!raw) return "";
    return raw.split(/\s+/).pop();
}

function tierPaletteForRc(parsed) {
    if (!parsed) return ["#d2c6c1", "#9a7b6c", "#7b543f"];
    const reform = /^reform\s+\d+$/i.exec(String(parsed.family || ""));
    if (reform) return RC_NUMBER_TIER;
    const palette = greekPaletteOf(parsed);
    if (palette) return palette.slice(0, 3);
    return [parsed.color || "#d2c6c1", lighten(parsed.color || "#d2c6c1", 0.25), parsed.color || "#7b543f"];
}

/**
 * LN 段位后缀（+/-）的取色。
 *
 * 跟 LN **图标**用同一套颜色：`assets/dan/ln/N.svg` 里的两个渐变 stop 就是 `LN_GLOW[N]`
 * （LN 4 = #e0bf52/#55d584，LN 12 = #ff7a32/#e74235，逐个核对过）。
 * 注意不要用 `lnPaletteInfo()` —— 那个对 LN 1-10 故意返回水蓝（光晕按用户要求走水蓝），
 * 和图标颜色不一样，套上去就会变成"字是彩色的、加号是蓝的"。
 * 之前这里对 LN 1-10 还硬编码过纯白，用户明确否掉了。
 */
function tierPaletteForLn(parsed) {
    if (!parsed) return ["#d2c6c1", "#9a7b6c", "#7b543f"];
    const number = Number(parsed.number);
    if (Number.isFinite(number) && LN_GLOW[number]) return LN_GLOW[number].slice(0, 3);
    return [parsed.color || "#d2c6c1", lighten(parsed.color || "#d2c6c1", 0.25), parsed.color || "#7b543f"];
}

function applyTierPalette(element, colors) {
    if (!element) return;
    element.style.setProperty("--tier-1", colors[0] || "#d2c6c1");
    element.style.setProperty("--tier-2", colors[1] || colors[0] || "#9a7b6c");
    element.style.setProperty("--tier-3", colors[2] || colors[1] || colors[0] || "#7b543f");
}

function saturate(hex, factor) {
    const [r, g, b] = parseHex(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    return toHex(hslToRgb(h, Math.min(1, s * factor), l));
}

function mixHex(a, b, t) {
    const ca = parseHex(a);
    const cb = parseHex(b);
    return toHex(ca.map((channel, index) => channel + (cb[index] - channel) * clamp01(t)));
}

/**
 * 按**色相**插值（走最短弧），而不是按 RGB 线性插值。
 *
 * RGB 插深红 `#ac100c` 和冰蓝 `#a8ecff` 会从中间穿过去，得到 `#aa7e85` 这种灰调 ——
 * 灯芯的 `brightness(2.4)` 一乘就是纯白（这正是之前"左上角一大段白"的元凶）。
 * 走 HSL 短路径则是 红 → 品红 → 紫 → 蓝，正好是霓虹灯该有的过渡。
 * 只用在两个段位之间的过渡弧上；同一段位内部仍然用 `mixHex`（相邻色本来就近，走直线更稳）。
 */
function mixHexHue(a, b, t) {
    const [r1, g1, b1] = parseHex(a);
    const [r2, g2, b2] = parseHex(b);
    const [h1, s1, l1] = rgbToHsl(r1, g1, b1);
    const [h2, s2, l2] = rgbToHsl(r2, g2, b2);
    let dh = h2 - h1;
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;
    const k = clamp01(t);
    return toHex(hslToRgb((h1 + dh * k + 1) % 1, s1 + (s2 - s1) * k, l1 + (l2 - l1) * k));
}

function interpolatePalette(colors, count) {
    const out = [];
    const n = colors.length;
    for (let i = 0; i < count; i += 1) {
        if (n === 1) { out.push(colors[0]); continue; }
        const t = (i / (count - 1)) * (n - 1);
        const index = Math.min(n - 2, Math.floor(t));
        out.push(mixHex(colors[index], colors[index + 1], t - index));
    }
    return out;
}

/**
 * 难度归一化：把段位档位映射成 0..1 的「压迫感」系数 d。
 *
 * 两段**故意不连续**：
 *   Reform 1-10（LN 1-10 同理）落在 0.10 .. 0.46
 *   Alpha 起（LN 11+ 同理）      落在 0.62 .. 1.00
 * 中间留空档，保证「Reform 10 永远不比 Alpha 亮」。
 * LN 档位按 +1 对齐到 RC 刻度：LN12 ≈ Gamma、LN13 ≈ Delta（用户给的对齐关系）。
 */
const D_EASY_MIN = 0.10;
const D_EASY_SPAN = 0.36;
const D_HARD_MIN = 0.62;
const D_HARD_SPAN = 0.38;
/** Gamma / LN12 的亮度水位：从 Delta 起呼吸时，暗端不许低于这条线。 */
const D_FLASH_FLOOR = 0.67;

function tierDifficulty(rank, hardSpan, dScale = 1) {
    const r = Number(rank) || 1;
    const base = r <= 10
        ? D_EASY_MIN + D_EASY_SPAN * clamp01((r - 1) / 9)
        : D_HARD_MIN + D_HARD_SPAN * clamp01((r - 11) / hardSpan);
    // 6K/7K 整体比 4K 难：难度系数直接放大，亮度和转速一起跟着走
    return clamp01(base * dScale);
}

/**
 * 唯一的亮度曲线：所有「越难越亮」都从这里出去。
 *
 * 下限必须 > 1。原来写 0.80 + 0.95d，Reform 1-5 算出来是 0.85~1.1，
 * brightness(0.85) 是在**压暗**颜色——霓虹灯当然不会亮。
 * 上限也压住（2.4 左右）：再高颜色就被冲成白，看不出是哪个字母。
 * 压迫感靠四件事叠出来：灯芯更粗、更亮、管壁更密、转得更快。
 */
function brightnessOf(d) {
    return 1.55 + 0.90 * d;
}

/** 常规段位：Reform 1-10 = 白色；希腊 = 贴图里从左到右取的 4 色。 */
function rcPaletteInfo(parsed, keys) {
    const family = String(parsed.family || "");
    const rank = Number(parsed.rank) || 1;
    const mode = getMode(keys);
    const dScale = mode ? mode.glow.dScale : 1;
    const reform = /^reform\s+(\d+)$/i.exec(family);
    if (reform) {
        // 白色系：越往上越纯白（冷暖差留一点点，纯白在深底上会发灰）。
        const r = Math.max(1, Math.min(10, Number(reform[1]) || 1));
        const localT = (r - 1) / 9;
        const cool = mixHex("#c9d6f5", "#ffffff", 0.30 + 0.55 * localT);
        const warm = mixHex("#e2e9ff", "#ffffff", 0.50 + 0.45 * localT);
        return {
            rank,
            d: tierDifficulty(rank, 16, dScale),
            colors: [cool, warm, "#ffffff", mixHex("#d6e1fb", "#ffffff", 0.45 + 0.5 * localT)],
            card: ["#ffffff", "#ffffff", "#ffffff"],
        };
    }
    if (parsed.named && mode) {
        const named = mode.palette(parsed.tierKey);
        if (named) {
            // 白色里藏色：色卡本身接近白，饱和的那个放在第 3 位。
            // 卡片环境光取它，光环则靠 glowSpecFor 里的「白芯彩光」加成把颜色透出来。
            const accent = named[Math.min(2, named.length - 1)] || named[0];
            // 6K Finish / 7K Stellium 直接照搬 LN 17：卡片底色用银白，
            // 光晕强度也在 glowSpecFor 里按 LN 17 的数值走。
            const ln17 = isLn17Style(keys, parsed.tierKey);
            return {
                rank,
                d: tierDifficulty(rank, 16, dScale),
                colors: named.slice(),
                card: ln17 ? LN17_CARD.slice() : [accent, named[0]],
                iridescent: true,
                ln17Style: ln17,
            };
        }
    }
    const palette = greekPaletteOf(parsed);
    if (palette) {
        // 贴图取色已经是「从左到右」的顺序，数量也已经是自适应的（1-5 个）。
        // 不要再按档位调亮——亮度统一由 d 驱动，否则高段位会先被颜色提亮一次、
        // 再被 filter 提亮一次，两次叠加就糊成白。
        return {
            rank,
            d: tierDifficulty(rank, 16, dScale),
            colors: palette.slice(),
            card: palette.slice(0, 2),
            greekKey: greekKeyOf(parsed),
        };
    }
    const base = parsed.color || "#9aa4b8";
    return {
        rank,
        d: tierDifficulty(rank, 16, dScale),
        colors: [base, rotateHue(base, 40), lighten(base, 0.18), rotateHue(base, -40)],
        card: [base, rotateHue(base, 40), lighten(base, 0.18)],
    };
}

/** LN 段位：LN 1-10 = 水蓝；LN 11+ = 贴图里取的 2 色。 */
function lnPaletteInfo(parsed, keys) {
    if (!parsed) return null;
    const mode = getMode(keys);
    const dScale = mode ? mode.glow.dScale : 1;
    const number = Number(parsed.number);
    const rank = Number(parsed.rank) || number || 1;
    if (Number.isFinite(number) && number >= 0 && number <= 10) {
        // LN 1-10 跟 RC 数字段一样走白色系（用户否掉了原来的浅水蓝）
        const t = clamp01((Math.max(1, number) - 1) / 9);
        const cool = mixHex("#c9d6f5", "#ffffff", 0.30 + 0.55 * t);
        const warm = mixHex("#e2e9ff", "#ffffff", 0.50 + 0.45 * t);
        return {
            rank,
            d: tierDifficulty(rank, 16, dScale),
            colors: [cool, warm, "#ffffff", mixHex("#d6e1fb", "#ffffff", 0.45 + 0.5 * t)],
            card: [warm, "#ffffff", "#ffffff"],
        };
    }
    // LN 17 的光晕：五彩斑斓的白。
    //
    // 不能直接给纯白 —— 灯芯那层是 brightness 1.6~2.4 + saturate 1.2~1.5，
    // 纯白进去出来还是一坨死白，看不出任何层次。这里给一组**很淡但有色相**的白：
    // 粉白 / 紫白 / 蓝白 / 薄荷白 / 金白。灯芯被提亮后仍然是白的，
    // 管壁和远光依次泛出这五种色 —— 就是镭射膜那种"白里透彩"。
    // 只影响光晕；段位后缀（++）仍然用 LN_GLOW[17] 的银白，跟图标一致。
    if (number === 17) {
        return {
            rank,
            d: tierDifficulty(rank, 6, dScale),
            colors: LN17_IRIDESCENT.slice(),
            card: LN_GLOW[17].slice(),
        };
    }

    const palette = Number.isFinite(number) ? LN_GLOW[number] : null;
    const source = palette || [parsed.color || "#7dd3fc", lighten(parsed.color || "#7dd3fc", 0.3)];
    return {
        rank,
        d: tierDifficulty(rank, 6, dScale),
        colors: source.slice(0, 2),
        card: source.slice(0, 2),
    };
}

/**
 * 生成光晕方案。
 *
 * 布局：米段 / LN 段各占**一段连续的弧**（不是交替铺开）。
 * 弧长按「段位数字 × 权重」分配，LN 权重恒为 1，米段权重由
 * `APP.glowRcShareWeight` 给（默认 2），所以 Alpha(11) + LN7 → 22:7，
 * 也就是 22/29 与 7/29。两者加起来永远是 1，正好铺满一圈。
 * LN 的占比另有 1/3 的硬上限（见下方 LN_SHARE_MAX），避免 LN 17 这种
 * 大号段位把米段的弧挤得太窄。
 * 每段内部再按该段自己的色卡从左到右排布。
 */
function glowSpecFor(parsedRc, parsedLn, keys) {
    const rc = parsedRc ? rcPaletteInfo(parsedRc, keys) : null;
    const ln = parsedLn ? lnPaletteInfo(parsedLn, keys) : null;
    if (!rc && !ln) return null;

    const rcWeight = Math.max(0, Number(APP.glowRcShareWeight) || 2);
    const rcRank = rc ? Math.max(1, rc.rank) * rcWeight : 0;
    const lnRank = ln ? Math.max(1, ln.rank) : 0;
    const totalRank = rcRank + lnRank;
    let rcShare = rc && ln ? rcRank / totalRank : (rc ? 1 : 0);

    // LN 占比封顶：Alpha(11)×2 + LN17 → 22:17，LN 会吃到 44%，
    // 用户反馈「ln17 占比太大」。压到最多 1/3，多出来的弧还给米段。
    // 只在两边都在时才封顶 —— 没有米段时 LN 本来就该铺满一圈，
    // 硬压到 33% 会在环上留一大段空弧。
    const LN_SHARE_MAX = 1 / 3;
    if (rc && ln) rcShare = Math.max(1 - LN_SHARE_MAX, rcShare);

    const blocks = [];
    if (rc) blocks.push({ kind: "rc", colors: rc.colors, share: rc && ln ? rcShare : 1 });
    if (ln) blocks.push({ kind: "ln", colors: ln.colors, share: rc && ln ? 1 - rcShare : 1 });

    // 压迫感取两边里更硬的那一边：Alpha + LN7 整体应该读作 Alpha 级，不是 9 级。
    const d = Math.max(rc ? rc.d : -1, ln ? ln.d : -1);

    // θ 要比 η 更"烧"。段位数字上 θ 只比 η 高一点点，光靠 d 拉不开差距，
    // 所以给一档显式加成：灯芯更亮、远光更浓更艳。用户要求「theta 的效果比 eta 的强」。
    const ember = Boolean(rc && rc.greekKey === "theta");

    // ---- 霓虹灯管的三层强度 ----
    // 灯芯：绝对亮度，难度越高越白热。饱和度**不降反升**，
    // 否则 delta 那种 4 色色卡会被 brightness 一起冲成白黄。
    const coreBright = brightnessOf(d) * (ember ? 1.12 : 1);  // 1.64 .. 2.45
    const coreSat = 1.18 + 0.32 * d;               // 1.21 .. 1.50
    // 管壁（紧光）与环境泛光：只吃饱和度，亮度交给灯芯。
    const tightSat = 1.30 + 0.45 * d;              // 1.35 .. 1.75
    let haloSat = 1.15 + 0.35 * d;                 // 1.19 .. 1.50
    let tightOpacity = 0.60 + 0.38 * d;            // 0.64 .. 0.98
    let haloOpacity = 0.14 + 0.22 * d;             // 0.16 .. 0.36
    if (ember) {
        haloSat += 0.30;
        haloOpacity = Math.min(0.62, haloOpacity + 0.16);
        tightOpacity = Math.min(1, tightOpacity + 0.08);
    }

    // LN 17 是"五彩斑斓的白"，但灯芯那层 brightness 1.6~2.4 会把**任何**颜色烧成白，
    // 五彩色只剩管壁那 3~4px 和远光能透出来，默认远光 0.36 太淡，看起来就是一整根白管。
    // 所以单独给 LN 17 把远光调浓、调艳 —— 白芯不动，泛光才是彩的。
    if (ln && Number(ln.rank) === 17) {
        haloOpacity = 0.50;
        haloSat = 1.95;
        tightOpacity = Math.max(tightOpacity, 0.86);
    }

    // 6K/7K 的具名段位（terra…finish / gamma…stellium）同样是「白色里藏色」，
    // 走和 LN 17 一样的加成：白芯不动，把色相压到管壁和远光里透出来。
    // 不加这一档的话，接近白的色卡会被灯芯 brightness 直接烧成一根白管，看不出是哪个段位。
    if (rc && rc.ln17Style) {
        // 和上面 LN 17 完全同一组数值，不要各写一套，否则两个摆一起能看出差别
        haloOpacity = 0.50;
        haloSat = 1.95;
        tightOpacity = Math.max(tightOpacity, 0.86);
    } else if (rc && rc.iridescent) {
        haloOpacity = Math.max(haloOpacity, 0.46);
        haloSat = Math.max(haloSat, 1.90);
        tightOpacity = Math.max(tightOpacity, 0.84);
    }

    // 从 Delta(RC rank 14) / LN13 开始呼吸。
    // 暗端钉死在 Gamma / LN12 的水位（用户要求：暗的那口气不能比 Gamma 更暗），
    // 亮端和节奏随难度拉开 —— 越难，管壁涨得越高、闪得越快。
    //
    // 注意：不透明度这条路已经没余量了（基础值就到 0.85~0.98，离 1 只剩一点点），
    // 早先只做 ±14% 的 opacity 摆动，用户直接反馈「不闪烁了」。
    // 所以**主摆动放在灯芯亮度上**（可以上不封顶），管壁只做小幅补强，
    // 远光的摆动给到 ±150%，靠泛光面积的涨缩来出"压迫感"。
    const mode = getMode(keys);
    const breatheFrom = mode ? mode.glow.breatheFrom : 14;
    const flashOn = Boolean((rc && rc.rank >= breatheFrom) || (ln && ln.rank >= breatheFrom - 1));
    const span = clamp01((d - D_FLASH_FLOOR) / (1 - D_FLASH_FLOOR));
    let coreDim = coreBright;
    let corePeak = coreBright;
    let tightDim = tightOpacity;
    let tightPeak = tightOpacity;
    let haloDim = haloOpacity;
    let haloPeak = haloOpacity;
    let pulseSpeed = "3.4s";
    if (flashOn) {
        // 暗端的绝对水位：Gamma / LN12 那一刻的三层强度。
        const floorCore = brightnessOf(D_FLASH_FLOOR);
        const floorTight = 0.60 + 0.38 * D_FLASH_FLOOR;
        const floorHalo = 0.14 + 0.22 * D_FLASH_FLOOR;
        coreDim = Math.max(floorCore, coreBright * 0.94);
        corePeak = Math.min(4.6, floorCore * (1.55 + 1.05 * span));
        tightDim = Math.max(floorTight, tightOpacity * 0.94);
        tightPeak = Math.min(1, tightOpacity + 0.06 + 0.10 * span);
        haloDim = Math.max(floorHalo, haloOpacity * 0.92);
        haloPeak = Math.min(1, haloOpacity + 0.34 + 0.34 * span);
        pulseSpeed = `${(1.90 - 1.05 * span).toFixed(2)}s`;
    }

    const cardA = colorWithAlpha((rc ? rc.card : ln.card)[0], (0.30 + 0.55 * d).toFixed(3));
    const cardB = colorWithAlpha((ln ? ln.card : rc.card)[0], (0.22 + 0.45 * d).toFixed(3));
    const cardC = colorWithAlpha((rc ? rc.card : ln.card)[1] || (rc ? rc.card : ln.card)[0], (0.14 + 0.32 * d).toFixed(3));

    // 只给**线速度**（px/秒），周期由环的实际周长反算（见 applyGlowIntensity）。
    // 以前这里直接算出"一圈几秒"，结果窗口一拖大、周长变长，线速度就变快了 ——
    // 用户要的是"不管窗口多大，光带走的快慢一样"。
    const speedFactor = 0.45 + 1.8 * d;
    const pxPerSec = (Number(APP.glowBaseSpeed) || 114) * speedFactor;

    return {
        key: `${parsedRc ? `rc:${parsedRc.family}:${parsedRc.rank}` : ""}|${parsedLn ? `ln:${parsedLn.number || parsedLn.family}:${parsedLn.rank}` : ""}`,
        blocks,
        d,
        opacity: Math.min(1, 0.50 + 0.50 * d),
        glowWidth: 2.9 + 2.5 * d,
        bloom: 0.65 + 0.85 * d,
        pxPerSec,
        coreSat,
        tightSat,
        haloSat,
        coreDim,
        corePeak,
        tightDim,
        tightPeak,
        haloDim,
        haloPeak,
        pulseSpeed,
        cardA,
        cardB,
        cardC,
    };
}

let glowKey = null;
let glowActive = 0;


/**
 * 环的几何按**真实像素**重建：viewBox 直接等于卡片的 CSS 尺寸。
 *
 * 原来写死 `viewBox="0 0 520 170"` + `preserveAspectRatio="none"`，
 * 卡片一旦不是 520:170（竖版 overlay 约 180:330）整个环就被非等比拉伸：
 * 14 单位的圆角在屏幕上变成 5px×27px 的椭圆，而遮罩还按 520×170 的圆角挖洞，
 * 于是四个角被遮罩多挖掉一大块 —— 看起来就是"四角没覆盖住"。
 * 改成按实际尺寸生成路径后，描边宽度、圆角、遮罩三者全部 1:1 对齐。
 */
const GLOW_CORNER = 14; // 必须和 .card 的 border-radius 一致

function ringPathFor(w, h) {
    const r = Math.max(1, Math.min(GLOW_CORNER, w / 2, h / 2));
    const x1 = w - r;
    const y1 = h - r;
    return `M${r} 0 H${x1} A${r} ${r} 0 0 1 ${w} ${r} V${y1} A${r} ${r} 0 0 1 ${x1} ${h} H${r} A${r} ${r} 0 0 1 0 ${y1} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
}

/** 尺寸变了就重设 viewBox / 路径 / 采样点，并强制重建色带（遮罩尺寸也跟着变）。 */
function syncGlowGeometry(layer) {
    const w = Math.max(24, Math.round(layer.clientWidth || 0));
    const h = Math.max(24, Math.round(layer.clientHeight || 0));
    const key = `${w}x${h}`;
    if (layer.__glowGeo === key) return false;
    layer.__glowGeo = key;
    layer.__glowSize = [w, h];
    layer.setAttribute("viewBox", `0 0 ${w} ${h}`);
    layer.__ringD = ringPathFor(w, h);
    layer.__glowPts = null;
    layer.__glowLength = 0;
    layer.__glowSegs = null;
    return true;
}

function buildRingSamples(layer, namespace) {
    const probe = document.createElementNS(namespace, "path");
    probe.setAttribute("d", layer.__ringD || ringPathFor(520, 170));
    probe.setAttribute("fill", "none");
    probe.style.visibility = "hidden";
    layer.appendChild(probe);
    let total = 0;
    try { total = probe.getTotalLength(); } catch { /* ignore */ }
    // 采样密度跟着实际周长走：竖版卡片周长更长，固定 720 会在圆角上折线化。
    const count = Math.min(1440, Math.max(360, Math.round(total / 1.6) || 720));
    const points = [];
    if (total > 0) {
        for (let i = 0; i < count; i += 1) {
            const point = probe.getPointAtLength((total * i) / count);
            points.push([point.x, point.y]);
        }
    }
    layer.removeChild(probe);
    // 周长要留着：旋转周期 = 周长 / 线速度，见 applyGlowIntensity。
    layer.__glowLength = total;
    return points;
}

function ringPointAt(points, fraction) {
    const count = points.length;
    if (!count) return [0, 0];
    const wrapped = ((fraction % 1) + 1) % 1;
    const raw = wrapped * count;
    const index = Math.floor(raw) % count;
    const next = (index + 1) % count;
    const t = raw - Math.floor(raw);
    const a = points[index];
    const b = points[next];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function ringSubpath(points, from, to) {
    const steps = Math.max(8, Math.ceil((to - from) * 240));
    const parts = [];
    for (let i = 0; i <= steps; i += 1) {
        const fraction = from + ((to - from) * i) / steps;
        const [x, y] = ringPointAt(points, fraction);
        parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return parts.join(" ");
}

/** 颜色段在环上首尾相接：跨过起点时拆成两段 path，视觉上不会断。 */
function ringArcD(points, start, length) {
    if (!points.length) return "";
    const end = start + length;
    if (end <= 1) return ringSubpath(points, start, end);
    return `${ringSubpath(points, start, 1)} ${ringSubpath(points, 0, end - 1)}`;
}

/** 每条弧最多 5(米段) + 5(LN) 条；实际数量按色卡长度走，见 buildGlowBlocks。 */
const MAX_GLOW_SEGMENTS = 12;
/** 段位交界的过渡弧占整圈的比例（每条 block 两头各让出一半）。 */
const GLOW_SEAM_SHARE = 0.055;

function ensureGlowSegments(layer, count) {
    if (layer.__glowSegs && layer.__glowSegs.length === count) return layer.__glowSegs;
    const namespace = "http://www.w3.org/2000/svg";
    const layerId = layer.id || `glow-${Math.floor(Math.random() * 100000)}`;
    // 采样点只跟环的形状有关，重建色带时保留，省掉 720 次 getPointAtLength。
    const cachedPoints = layer.__glowPts;
    layer.textContent = "";

    // 遮罩：只保留卡片外的部分，光晕不再往框内散。
    // 内框必须和卡片本体**同尺寸、同圆角**，否则角上会多挖一块（四角看起来缺光）。
    const [w, h] = layer.__glowSize || [520, 170];
    const pad = Math.round(Math.max(w, h) * 0.5) + 40;
    const defs = document.createElementNS(namespace, "defs");
    const mask = document.createElementNS(namespace, "mask");
    mask.setAttribute("id", `${layerId}-outside-mask`);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", String(-pad));
    mask.setAttribute("y", String(-pad));
    mask.setAttribute("width", String(w + pad * 2));
    mask.setAttribute("height", String(h + pad * 2));
    const outerRect = document.createElementNS(namespace, "rect");
    outerRect.setAttribute("x", String(-pad));
    outerRect.setAttribute("y", String(-pad));
    outerRect.setAttribute("width", String(w + pad * 2));
    outerRect.setAttribute("height", String(h + pad * 2));
    outerRect.setAttribute("fill", "#fff");
    const innerRect = document.createElementNS(namespace, "rect");
    innerRect.setAttribute("x", "0");
    innerRect.setAttribute("y", "0");
    innerRect.setAttribute("width", String(w));
    innerRect.setAttribute("height", String(h));
    innerRect.setAttribute("rx", String(Math.min(GLOW_CORNER, w / 2, h / 2)));
    innerRect.setAttribute("fill", "#000");
    mask.appendChild(outerRect);
    mask.appendChild(innerRect);
    defs.appendChild(mask);
    const gradients = [];
    for (let i = 0; i < count; i += 1) {
        const gradient = document.createElementNS(namespace, "linearGradient");
        gradient.setAttribute("id", `${layerId}-seg-${i}`);
        gradient.setAttribute("gradientUnits", "userSpaceOnUse");
        gradient.setAttribute("spreadMethod", "pad");
        const stops = [];
        for (let s = 0; s < 4; s += 1) {
            const stop = document.createElementNS(namespace, "stop");
            stop.setAttribute("offset", `${[0, 0.26, 0.74, 1][s] * 100}%`);
            gradient.appendChild(stop);
            stops.push(stop);
        }
        defs.appendChild(gradient);
        gradients.push({ element: gradient, stops });
    }
    layer.appendChild(defs);
    layer.__glowGrads = gradients;
    layer.__glowPts = cachedPoints || buildRingSamples(layer, namespace);

    // 只有远光层被遮罩裁到卡外。
    // 灯芯和管壁**必须整根画在边上**：遮罩会把管子靠里的那一半切掉，
    // 只剩外半边，视觉重心就偏到卡片外面去了 —— 用户反馈的「内圈和光晕对不上」就是这个。
    // 整根管子跨在边框上，才像一根真的灯管贴在边上。
    const haloGroup = document.createElementNS(namespace, "g");
    haloGroup.setAttribute("class", "glow-halo-group");
    haloGroup.setAttribute("mask", `url(#${layerId}-outside-mask)`);
    layer.appendChild(haloGroup);

    const tightGroup = document.createElementNS(namespace, "g");
    tightGroup.setAttribute("class", "glow-tight-group");
    layer.appendChild(tightGroup);

    const coreGroup = document.createElementNS(namespace, "g");
    coreGroup.setAttribute("class", "glow-core-group");
    layer.appendChild(coreGroup);

    // CSS filter 在 SVG 上的滤镜区域默认只有 bbox 外扩 10%：
    // 卡片的 bbox 就是卡片本身，10% 只有 20~35px，blur(14px) 的外圈会被直接切掉，
    // 看起来就是"光晕到了边界就断"。往每个组里塞一个透明大矩形把 bbox 撑开。
    const margin = 96;
    for (const group of [haloGroup, tightGroup, coreGroup]) {
        const bboxRect = document.createElementNS(namespace, "rect");
        bboxRect.setAttribute("x", String(-margin));
        bboxRect.setAttribute("y", String(-margin));
        bboxRect.setAttribute("width", String(w + margin * 2));
        bboxRect.setAttribute("height", String(h + margin * 2));
        bboxRect.setAttribute("fill", "transparent");
        group.appendChild(bboxRect);
    }

    // 霓虹灯管是三层叠出来的，不是一团雾：
    //   glow-halo  很宽很淡的远光（环境泛光）
    //   glow-tight 贴身的紧光（玻璃管壁溢出的那圈饱和颜色）
    //   glow-core  锐利的灯芯（几乎不模糊，随难度白热 → 发白发亮）
    // 只有一层时，模糊后的色带看起来是"雾"；三层叠起来才有"灯管"的实体感。
    // 滤镜和明暗呼吸都挂在这三个 <g> 上：一条 path 的 filter 区域只有自身 bbox，
    // 13px 的模糊会被裁掉；<g> 的 bbox 是整圈环，区域够大，而且只跑一次滤镜。
    const halos = [];
    const tights = [];
    const segments = [];
    for (let i = 0; i < count; i += 1) {
        const halo = document.createElementNS(namespace, "path");
        halo.setAttribute("class", "glow-halo");
        haloGroup.appendChild(halo);
        halos.push(halo);

        const tight = document.createElementNS(namespace, "path");
        tight.setAttribute("class", "glow-tight");
        tightGroup.appendChild(tight);
        tights.push(tight);

        const path = document.createElementNS(namespace, "path");
        path.setAttribute("class", "glow-core");
        coreGroup.appendChild(path);
        segments.push(path);
    }
    layer.__glowHalos = halos;
    layer.__glowTights = tights;
    layer.__glowSegs = segments;
    return segments;
}

/**
 * 把 spec.blocks 展开成「每条弧的起止占比 + 颜色」。
 * 米段和 LN 各占一段**连续**的弧，长度按段位数字分（Alpha 11 : LN7 = 11:18 / 7:18）。
 * 每段内部再切成 colors.length 条，正好一条一个颜色 —— 贴图上从左到右的色序就保住了。
 */
function buildGlowBlocks(spec) {
    const blocks = (spec.blocks || []).map((block) => {
        const colors = (block.colors && block.colors.length ? block.colors : ["#ffffff"]).slice(0, 5);
        return { colors, share: block.share, segs: colors.length };
    });
    const totalSegs = blocks.reduce((sum, block) => sum + block.segs, 0);
    if (!totalSegs || totalSegs > MAX_GLOW_SEGMENTS) return null;

    // 两个段位之间插一条**过渡弧**：深红和冰蓝直接相接是硬切，用户反馈「一白一红看着有点丑」。
    // 过渡弧从相邻两段各让出 GLOW_SEAM_SHARE/2 的周长，整段做 from→to 的色相渐变，
    // 所以两边的色块长度基本不变（各短 5.5%），视觉上就是一段短短的彩色接缝。
    const seamCount = blocks.length > 1 ? blocks.length : 0;
    const seamShare = seamCount ? Math.min(GLOW_SEAM_SHARE, 0.5 / seamCount) : 0;
    // 每条 block 有两个邻居，各让出 seamShare/2，合计让出 seamShare。
    const bodyShare = blocks.map((block) => Math.max(0, block.share - seamShare));

    const meta = [];
    const assigned = [];
    // 每段属于哪个 block（0 = 米段，1 = LN 段…）。
    // 交界处**不能**跨 block 混色：米段是 #ac100c 的深红，LN 17 是 #a8ecff 的冰蓝，
    // RGB 混 50% 出来是 #aa7e85 这种发灰的浅色，再被灯芯 brightness(2.4) 一烧就是纯白 ——
    // 用户看到的"左上角一大段白"就是这段混出来的。同 block 内部才做平滑，跨界交给过渡弧。
    const blockOf = [];
    // 与 assigned 平行：过渡弧放 {from,to}，其余为 null。
    const seams = [];
    let offset = 0;

    for (let b = 0; b < blocks.length; b += 1) {
        const block = blocks[b];
        const colors = interpolatePalette(block.colors, block.segs);
        const segLength = bodyShare[b] / block.segs;
        for (let i = 0; i < block.segs; i += 1) {
            meta.push({ offset: offset + segLength * i, length: segLength });
            assigned.push(colors[i] || "#ffffff");
            blockOf.push(b);
            seams.push(null);
        }
        offset += bodyShare[b];

        if (seamShare > 0) {
            const next = blocks[(b + 1) % blocks.length];
            const nextColors = interpolatePalette(next.colors, next.segs);
            const from = colors[colors.length - 1];
            const to = nextColors[0];
            meta.push({ offset, length: seamShare });
            // 兜底色取 from，真正画出来的是渐变。
            assigned.push(from);
            blockOf.push(-1 - b); // 负数：自成一段，不参与任何跨段混色
            seams.push({ from, to });
            offset += seamShare;
        }
    }

    if (!assigned.length || assigned.length > MAX_GLOW_SEGMENTS) return null;
    return { meta, assigned, blockOf, seams, totalSegs: assigned.length };
}

/** 只写「强度」相关变量：颜色没变时也要更新，否则换段后亮度不会跟着走。 */
function applyGlowIntensity(layer, spec) {
    // 周期 = 周长 / 线速度。周长来自实际几何，所以窗口拖大拖小，光带走的快慢都不变。
    const length = Number(layer.__glowLength) || 0;
    const pxPerSec = Math.max(8, Number(spec.pxPerSec) || 114);
    const seconds = length > 0 ? length / pxPerSec : 8;
    layer.style.setProperty("--glow-speed", `${seconds.toFixed(2)}s`);
    layer.style.setProperty("--glow-width", `${spec.glowWidth.toFixed(1)}px`);
    layer.style.setProperty("--glow-tight-width", `${(spec.glowWidth * (Number(APP.glowTightScale) || 2.4)).toFixed(1)}px`);
    layer.style.setProperty("--glow-halo-width", `${(spec.glowWidth * (Number(APP.glowHaloScale) || 3.4)).toFixed(1)}px`);
    layer.style.setProperty("--glow-core-sat", spec.coreSat.toFixed(3));
    layer.style.setProperty("--glow-tight-sat", spec.tightSat.toFixed(3));
    layer.style.setProperty("--glow-halo-sat", spec.haloSat.toFixed(3));
    layer.style.setProperty("--glow-core-dim", spec.coreDim.toFixed(3));
    layer.style.setProperty("--glow-core-peak", spec.corePeak.toFixed(3));
    layer.style.setProperty("--glow-tight-dim", spec.tightDim.toFixed(3));
    layer.style.setProperty("--glow-tight-peak", spec.tightPeak.toFixed(3));
    layer.style.setProperty("--glow-halo-dim", spec.haloDim.toFixed(3));
    layer.style.setProperty("--glow-halo-peak", spec.haloPeak.toFixed(3));
    layer.style.setProperty("--glow-pulse-speed", spec.pulseSpeed);
    layer.__glowDuration = seconds;
}

function setGlowLayer(layer, spec) {
    layer.__glowSpec = spec;
    syncGlowGeometry(layer);
    const layout = buildGlowBlocks(spec);
    if (!layout) return;
    // 先建色带（会算出周长），再写强度 —— 周期要用周长反算。
    const segments = ensureGlowSegments(layer, layout.totalSegs);
    applyGlowIntensity(layer, spec);
    const halos = layer.__glowHalos || [];
    const tights = layer.__glowTights || [];
    layer.__glowSegMeta = layout.meta;

    const count = layout.assigned.length;
    segments.forEach((segment, index) => {
        const gradient = layer.__glowGrads && layer.__glowGrads[index];
        const seam = layout.seams && layout.seams[index];
        if (!gradient) {
            segment.setAttribute("stroke", seam ? seam.from : layout.assigned[index]);
            return;
        }

        // 过渡弧：整段就是 from → to 的**色相**渐变，不跟邻居混。
        // 走色相而不是 RGB，红→紫→蓝才是霓虹灯该有的过渡；
        // RGB 会从灰里穿过去，再被灯芯提亮就成白。
        if (seam) {
            const stops = [
                seam.from,
                mixHexHue(seam.from, seam.to, 0.34),
                mixHexHue(seam.from, seam.to, 0.66),
                seam.to,
            ];
            stops.forEach((color, s) => gradient.stops[s].setAttribute("stop-color", color));
        } else {
            // 每段用沿弧线方向的渐变：两端各与相邻段混 50%，交界处不会出现硬切。
            // 但**只在同一个 block 内部混** —— 跨 block（米段 ↔ LN 段）交给上面的过渡弧，
            // 否则深红和冰蓝混出来的浅灰会被灯芯提亮成白色，在环上烧出一段假白。
            const curr = layout.assigned[index];
            const prevIndex = (index - 1 + count) % count;
            const nextIndex = (index + 1) % count;
            const samePrev = layout.blockOf && layout.blockOf[prevIndex] === layout.blockOf[index];
            const sameNext = layout.blockOf && layout.blockOf[nextIndex] === layout.blockOf[index];
            const prev = samePrev ? layout.assigned[prevIndex] : curr;
            const next = sameNext ? layout.assigned[nextIndex] : curr;
            gradient.stops[0].setAttribute("stop-color", mixHex(prev, curr, 0.5));
            gradient.stops[1].setAttribute("stop-color", curr);
            gradient.stops[2].setAttribute("stop-color", curr);
            gradient.stops[3].setAttribute("stop-color", mixHex(curr, next, 0.5));
        }

        const paint = `url(#${gradient.element.id})`;
        segment.setAttribute("stroke", paint);
        if (tights[index]) tights[index].setAttribute("stroke", paint);
        if (halos[index]) halos[index].setAttribute("stroke", paint);
    });
    updateGlowSpin(performance.now());
}

let glowFrame = 0;

/** JS 逐帧驱动旋转：不依赖 @property / CSS 动画，任何 WebView2 都会转。 */
function updateGlowSpin(now) {
    const layers = el.glowLayers || [];
    for (const layer of layers) {
        const points = layer.__glowPts;
        const segments = layer.__glowSegs;
        const meta = layer.__glowSegMeta;
        if (!points || !points.length || !segments || !meta) continue;
        const duration = Math.max(0.5, Number(layer.__glowDuration) || 8) * 1000;
        const spin = (now / duration) % 1;
        const halos = layer.__glowHalos || [];
        const tights = layer.__glowTights || [];
        for (let i = 0; i < segments.length && i < meta.length; i += 1) {
            // offset 是静态位置，spin 递增 → 整体**顺时针**走（路径本身是顺时针定义的）。
            const start = (meta[i].offset + spin) % 1;
            const length = meta[i].length;
            const end = start + length;
            const d = ringArcD(points, start, length);
            segments[i].setAttribute("d", d);
            if (tights[i]) tights[i].setAttribute("d", d);
            if (halos[i]) halos[i].setAttribute("d", d);
            const gradient = layer.__glowGrads && layer.__glowGrads[i];
            if (gradient) {
                const from = ringPointAt(points, start);
                const to = ringPointAt(points, end);
                gradient.element.setAttribute("x1", from[0].toFixed(2));
                gradient.element.setAttribute("y1", from[1].toFixed(2));
                gradient.element.setAttribute("x2", to[0].toFixed(2));
                gradient.element.setAttribute("y2", to[1].toFixed(2));
            }
        }
    }
    glowFrame = requestAnimationFrame(updateGlowSpin);
}

function startGlowLoop() {
    if (glowFrame) return;
    glowFrame = requestAnimationFrame(updateGlowSpin);
}

/** 外发光：RC/LN 两段连续弧，越难越亮、转得越快；换段时交叉淡入。 */
/**
 * VIBRO 段的光晕：黑色。
 *
 * 用户要求「判成 vibro 的段落只显示 vibro，周围光芒变成黑色」——
 * 在深色卡片上，黑色灯管等于"这一段灯灭了"，比给个段位更能表达"这里不算难度"。
 * 做法是保留正常的 spec 骨架（宽度/线速度/动画都在），只把颜色换成近黑、
 * 亮度压到 0.3 左右，管子就只剩一根暗线。
 */
function blackenGlow(spec) {
    if (!spec) return spec;
    spec.blocks = [{ kind: "vibro", colors: ["#0d0d12"], share: 1 }];
    spec.coreDim = 0.30;
    spec.corePeak = 0.30;
    spec.tightDim = 0.10;
    spec.tightPeak = 0.10;
    spec.haloDim = 0.06;
    spec.haloPeak = 0.06;
    spec.pulseSpeed = "4s";
    spec.key = `vibro-${spec.key || ""}`;
    return spec;
}

// 上一次显示的段位 rank（用来判断"换段了"要不要滚）。null = 没有上一次。
let lastRcRank = null;
let lastLnRank = null;

function applyCardGlow(parsedRc, parsedLn, visible, vibro = false, keys) {
    const style = el.card.style;
    const layers = el.glowLayers || [];
    if (!visible || (!parsedRc && !parsedLn)) {
        glowKey = null;
        for (const layer of layers) layer.style.opacity = "0";
        style.setProperty("--glow-a", "rgba(255, 255, 255, 0.05)");
        style.setProperty("--glow-b", "rgba(255, 255, 255, 0.02)");
        style.setProperty("--glow-c", "rgba(255, 255, 255, 0.012)");
        style.setProperty("--glow-bloom", "0.7");
        return;
    }
    let spec = glowSpecFor(parsedRc, parsedLn, keys);
    if (!spec) return;
    if (vibro) spec = blackenGlow(spec);
    style.setProperty("--glow-a", spec.cardA);
    style.setProperty("--glow-b", spec.cardB);
    style.setProperty("--glow-c", spec.cardC);
    style.setProperty("--glow-bloom", spec.bloom.toFixed(3));

    if (!layers.length) return;
    if (glowKey !== spec.key) {
        const nextIndex = 1 - glowActive;
        const next = layers[nextIndex];
        const current = layers[glowActive];
        if (next) {
            setGlowLayer(next, spec);
            next.style.opacity = "0";
            // 先把新颜色画到隐藏层，再淡入，避免颜色突变。
            void next.offsetWidth;
            next.style.opacity = spec.opacity.toFixed(3);
            if (current) current.style.opacity = "0";
            glowActive = nextIndex;
        }
        glowKey = spec.key;
    } else {
        // 颜色没变但强度可能变了（同段位不同星数、MMA 结果回填）：
        // 强度变量必须照写，否则亮度会停在上一段的值。
        const current = layers[glowActive];
        if (current) {
            // 尺寸变了（OBS 改分辨率、窗口拉伸）也要重建环，否则圆角/描边会错位。
            if (syncGlowGeometry(current)) {
                setGlowLayer(current, spec);
            } else {
                applyGlowIntensity(current, spec);
            }
            current.style.opacity = spec.opacity.toFixed(3);
        }
    }
}

const RC_GREEK_FILES = {
    alpha: "alpha",
    beta: "beta",
    gamma: "gamma",
    delta: "delta",
    epsilon: "epsilon",
    "emik zeta": "zeta",
    "thaumiel eta": "eta",
    "cloverwisp theta": "theta",
    iota: "iota",
    kappa: "kappa",
};

const el = {};

let lastAnalysis = null;
let resizeObserver = null;

let gameVisible = null;

/** 是否显示整个 overlay（选歌/菜单/结算时隐藏）。 */
export function setGameVisible(visible) {
    const next = Boolean(visible);
    if (gameVisible === next) return;
    gameVisible = next;
    document.body.classList.toggle("in-game", next);
}

export function initUi() {
    el.card = document.getElementById("card");
    el.dot = document.getElementById("dot");
    el.status = document.getElementById("status");
    el.keys = document.getElementById("keys");
    el.mods = document.getElementById("mods");
    el.caption = document.getElementById("caption");
    el.sub = document.getElementById("sub");
    el.rcBlock = document.getElementById("rc-block");
    el.rcPrefix = document.getElementById("rc-prefix");
    el.dan = document.getElementById("dan");
    el.tier = document.getElementById("tier");
    el.star = document.getElementById("star");
    el.algo = document.getElementById("algo");
    el.lnBlock = document.getElementById("ln-block");
    el.lnPrefix = document.getElementById("ln-prefix");
    el.ln = document.getElementById("ln");
    el.lnTier = document.getElementById("ln-tier");
    el.rcBlockName = document.getElementById("rc-block-name");
    el.lnBlockName = document.getElementById("ln-block-name");
    el.stage = document.getElementById("stage");
    el.canvas = document.getElementById("tl");
    el.playhead = document.getElementById("playhead");
    el.segHighlight = document.getElementById("seg-highlight");
    el.glowLayers = [document.getElementById("card-glow-a"), document.getElementById("card-glow-b")].filter(Boolean);
    el.tNow = document.getElementById("t-now");
    el.tEnd = document.getElementById("t-end");

    startGlowLoop();

    // 卡片尺寸变了就重建环（viewBox = 实际像素，圆角/描边才不会变形）。
    if (typeof ResizeObserver === "function" && el.glowLayers.length) {
        resizeObserver = new ResizeObserver(() => {
            for (const layer of el.glowLayers) {
                if (syncGlowGeometry(layer) && layer.__glowSpec) setGlowLayer(layer, layer.__glowSpec);
            }
        });
        for (const layer of el.glowLayers) resizeObserver.observe(layer);
    }

    resetUi();
    applyStaticText();
}

/** 面板里改了 language → 立刻把静态文案换掉（不依赖有没有谱面）。 */
export function applyLanguage() {
    applyStaticText();
}

/** 语言变了要把静态文案（块名 / 指示点 title）一起重刷。 */
function applyStaticText() {
    const strings = t(getLanguage());
    if (el.rcBlockName) el.rcBlockName.textContent = strings.block.rc;
    if (el.lnBlockName) el.lnBlockName.textContent = strings.block.ln;
}

export function resetUi() {
    lastAnalysis = null;
    setStatus(t(getLanguage()).status.waiting, "idle");
    el.card.classList.add("idle");
    el.caption.textContent = t(getLanguage()).caption.current;
    resetMain();
    if (el.playhead) el.playhead.hidden = true;
    if (el.segHighlight) el.segHighlight.hidden = true;
    if (el.tNow) el.tNow.textContent = "0:00";
    if (el.tEnd) el.tEnd.textContent = "0:00";
    clearCanvas();
}

/** 面板里的「显示分档角标」开关。 */
function showTierMark() {
    return getSetting("showTierMark", APP.showTierMark) !== false;
}

function resetMain() {
    el.card.classList.add("idle");
    el.card.style.setProperty("--accent", "#6d7894");
    applyCardGlow(null, null, false, false, null);
    el.rcPrefix.textContent = "";
    renderGlyph(el.dan, { text: "--" });
    el.tier.textContent = "";
    el.tier.hidden = true;
    el.sub.textContent = "";
    el.star.textContent = "--";
    el.lnBlock.hidden = true;
    el.lnPrefix.textContent = "LN";
    renderGlyph(el.ln, { text: "" });
    el.lnTier.textContent = "";
    el.lnTier.hidden = true;
}

export function setConnection(connected) {
    if (!el.dot) return;
    el.dot.classList.toggle("on", Boolean(connected));
    const strings = t(getLanguage()).dot;
    el.dot.title = connected ? strings.connected : strings.disconnected;
}

export function setStatus(text, tone = "idle") {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.dataset.tone = tone;
}

export function setKeys(keys) {
    if (!el.keys) return;
    const value = Number(keys);
    if (!Number.isFinite(value) || value <= 0) {
        el.keys.hidden = true;
        return;
    }
    el.keys.hidden = false;
    el.keys.textContent = `${value}K`;
}

export function setMods(text) {
    if (!el.mods) return;
    const value = String(text || "").trim();
    el.mods.hidden = value.length === 0;
    el.mods.textContent = value;
}

/**
 * 整图数字的来源。
 *
 * 整图优先用当前选中算法（面板下拉）算出的结果；还没算完时先显示 Sunny 的估算值。
 * MMA 还在算的时候先返回 pending，调用方会拿本地 Sunny 值当「估算」显示，
 * 并标上 ≈ / 半透明 —— 不能留空，空着卡片看起来像坏了。
 */
function wholeMapSource(analysis) {
    const whole = analysis.whole;
    if (whole && (whole.rcLabel || whole.lnLabel)) {
        return { rc: whole.rcLabel, ln: whole.lnLabel, pending: false };
    }
    if (analysis.wholeStatus === "pending") {
        return { rc: "", ln: "", pending: true };
    }
    return { rc: analysis.rcLabel, ln: analysis.lnLabel, pending: false };
}

/**
 * 整图星数：有 MMA 结果就用 MMA 的 rework.star。
 *
 * MMA 自己的归一化是 `rework = { ...selectedRework, star: sunnyStar }`——段位名字来自
 * 所选算法（Mixed→Companella），星数恒等于 Sunny 的原始星数。所以「和 MMA 一模一样」
 * 指的是：段位用 mma.rcLabel，星数用 mma.star。混用 mma.numeric 会得到 MMA 页面上
 * 根本不存在的数字。
 */
function wholeMapStar(analysis, src) {
    if (src && !src.pending && analysis.whole) {
        const star = Number(analysis.whole.star);
        if (Number.isFinite(star) && star > 0) return star;
        const value = Number(analysis.whole.numeric);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return analysis.rcStar;
}

/**
 * 主区：米段 / LN 段并排（playing 时是当前段落，idle 时是整图段位）。
 */
export function showCurrent(section, analysis, { playing, segmentIndex = null, segmentTotal = null } = {}) {
    if (!analysis) {
        resetMain();
        return;
    }

    const hasSection = Boolean(section);
    // 分段走 Mixed 时，Sunny 的 rc 可能是 null 而 Mixed 有值，所以两者取其一。
    const sectionValid = hasSection
        && (Number.isFinite(section.rc) || Boolean(section.mixed && section.mixed.rcLabel));
    const supported = hasDanTable(analysis.keys);

    // 整图视图（选歌/待机）：MMA 未就绪时先显示本地估算值，不把卡片留空。
    const wholeSrc = hasSection ? null : wholeMapSource(analysis);
    const estimated = Boolean(wholeSrc && wholeSrc.pending);
    // 分段走 Mixed 时（APP.segmentEstimator="mixed"）优先用 MMA 那套结果。
    const mixedSeg = sectionValid && section.mixed ? section.mixed : null;
    const rcText = mixedSeg ? mixedSeg.rcLabel
        : (sectionValid ? section.rcLabel
            : (hasSection ? "" : (estimated ? analysis.rcLabel : wholeSrc.rc)));
    const lnText = mixedSeg ? mixedSeg.lnLabel
        : (sectionValid ? section.lnLabel
            : (hasSection ? "" : (estimated ? analysis.lnLabel : wholeSrc.ln)));
    const rc = rcText ? parseRc(rcText, analysis.keys) : null;
    const ln = lnText ? parseLn(lnText, analysis.keys) : null;
    const star = sectionValid
        ? (mixedSeg && Number.isFinite(Number(mixedSeg.star)) ? Number(mixedSeg.star) : section.rc)
        : ((playing && hasSection) ? null : wholeMapStar(analysis, wholeSrc));

    el.card.classList.remove("idle");
    const strings = t(getLanguage());
    el.caption.textContent = playing ? strings.caption.current : strings.caption.whole;

    // 当前段位用哪个算法：默认 Sunny（只有它带局部信息），
    // 开了 APP.segmentEstimator="mixed" 才是 Mixed。
    if (el.algo) {
        const label = mixedSeg ? "Mixed" : "Sunny";
        el.algo.textContent = label;
        el.algo.dataset.tone = mixedSeg ? "mma" : "sunny";
    }

    // ---- 米段 ----
    // VIBRO 段：个人差太大，不给段位，直接标 VIBRO + 黑色光晕。
    const vibro = Boolean(hasSection && (section.vibro === true || (section.segment && section.segment.vibro === true)));
    const rcVisible = Boolean(rc) && !isHiddenIntro(rc) && !vibro;
    applyCardGlow(rcVisible ? rc : null, vibro ? null : ln, vibro || rcVisible || Boolean(ln), vibro, analysis.keys);
    if (vibro) {
        renderGlyph(el.dan, { text: "VIBRO", alt: strings.placeholder.vibro });
        el.dan.className = "dan dan-vibro";
        fitLabel(el.dan);
        el.rcPrefix.textContent = "";
        el.tier.textContent = "";
        el.tier.hidden = true;
        el.card.style.setProperty("--accent", "#2b3140");
        el.rcBlock.style.setProperty("--accent", "#2b3140");
        lastRcRank = null;
    } else if (rcVisible) {
        const spec = resolveRcSpec(rc, analysis.keys);
        el.rcPrefix.textContent = "";
        // 段位变了就滚过去（4 → 6 会滚过 5）；首次显示/换图直接落位。
        const nextRank = Number(rc.rank);
        const steps = Number.isFinite(nextRank) && Number.isFinite(lastRcRank)
            ? reelSteps(lastRcRank, nextRank, (r) => rcSpecForRank(r, analysis.keys), { ...spec, rank: nextRank })
            : null;
        if (!steps || !rollGlyph(el.dan, steps)) renderGlyph(el.dan, spec);
        lastRcRank = Number.isFinite(nextRank) ? nextRank : null;
        // 分档角标（可选）：徽章图本身已经带分档，这里只是额外补一个上标提示
        el.tier.textContent = showTierMark() ? tierMark(rc.suffix) : "";
        el.tier.hidden = !el.tier.textContent;
        applyTierPalette(el.tier, tierPaletteForRc(rc));
        el.card.style.setProperty("--accent", rc.color || "#6d7894");
        el.rcBlock.style.setProperty("--accent", rc.color || "#6d7894");
    } else {
        el.rcPrefix.textContent = "";
        const placeholder = !supported ? strings.placeholder.noTable
            : (hasSection && section.notes === 0 ? strings.placeholder.rest : strings.placeholder.dash);
        renderGlyph(el.dan, { text: placeholder });
        lastRcRank = null;
        if (placeholder === strings.placeholder.dash) el.dan.className = "dan dan-sm";
        el.tier.textContent = "";
        el.tier.hidden = true;
        el.card.style.setProperty("--accent", "#6d7894");
        el.rcBlock.style.setProperty("--accent", "#6d7894");
    }
    el.star.textContent = Number.isFinite(star) ? star.toFixed(2) : "--";

    // ---- LN 段（与米段同尺寸）----
    // 整图有 LN 的谱面：即使当前段里没有 LN，也保留 LN 块显示 "—"，
    // 避免 LN 块忽隐忽现导致米段位置左右跳。
    const mapHasLn = Boolean(analysis.lnLabel)
        || Number(analysis.lnStar) > 0
        || Number(analysis.lnRatio) > 0;
    // 没有 LN 段位（零长条 / 低于表下限）→ 整块不显示，预览也不画杠。
    // VIBRO 段 → 连 LN 一起不显示：那一段的难度数字本身就不可信，
    //   米段已经换成 VIBRO 了，LN 再挂一个段位会自相矛盾。
    // 有 LN 段位时：打歌中只在当前段有 LN 时显示，局外预览一直显示。
    const showLnBlock = !vibro && Boolean(analysis.hasLnDan) && (playing ? Boolean(ln) : true);
    if (showLnBlock) {
        el.lnBlock.hidden = false;
        if (ln) {
            const spec = resolveLnSpec(ln, analysis.keys);
            el.lnPrefix.textContent = "";
            const nextLn = Number(ln.number);
            const lnSteps = Number.isFinite(nextLn) && Number.isFinite(lastLnRank)
                ? reelSteps(lastLnRank, nextLn, (r) => lnSpecForRank(r, analysis.keys), { ...spec, rank: nextLn })
                : null;
            if (!lnSteps || !rollGlyph(el.ln, lnSteps)) renderGlyph(el.ln, spec);
            lastLnRank = Number.isFinite(nextLn) ? nextLn : null;
            el.lnTier.textContent = showTierMark() ? tierMark(ln.suffix) : "";
            el.lnTier.hidden = !el.lnTier.textContent;
            applyTierPalette(el.lnTier, tierPaletteForLn(ln));
            el.lnBlock.style.setProperty("--ln-color", ln.color || "#ff9d5c");
        } else {
            el.lnPrefix.textContent = "LN";
            renderGlyph(el.ln, { text: strings.placeholder.dash, alt: strings.placeholder.noLn });
            lastLnRank = null;
            el.lnTier.textContent = "";
            el.lnTier.hidden = true;
            el.lnBlock.style.setProperty("--ln-color", "rgba(154, 215, 255, 0.5)");
        }
    } else {
        el.lnBlock.hidden = true;
        el.lnPrefix.textContent = "LN";
        renderGlyph(el.ln, { text: "" });
        el.lnTier.textContent = "";
    }

    // ---- 说明行 ----
    if (playing && hasSection) {
        if (Number.isFinite(segmentIndex) && Number.isFinite(segmentTotal) && segmentTotal > 0) {
            el.sub.textContent = strings.sub.segment(segmentIndex + 1, segmentTotal, section.notes);
        } else {
            const windowSeconds = Math.round((analysis.windowMs || 0) / 1000);
            const futureSeconds = Math.round((analysis.futureMs || 0) / 1000);
            const pastSeconds = Math.max(0, windowSeconds - futureSeconds);
            let rangeText;
            if (futureSeconds <= 0) rangeText = strings.sub.currentSegment;
            else if (pastSeconds <= 0) rangeText = `+${futureSeconds}s`;
            else rangeText = `-${pastSeconds}s / +${futureSeconds}s`;
            el.sub.textContent = `${rangeText} · ${strings.sub.notes(section.notes)}`;
        }
    } else {
        el.sub.textContent = analysis.keys ? strings.sub.keys(analysis.keys) : "";
    }
}

/** 把段位信息渲染成数字/希腊字母图片；没有素材时回退文字。 */
/**
 * ---- 段位滚动（滚轮式换段）----
 *
 * 用户原话：「这一瞬间从 4dan 跳到 6dan，就像滚轮一样把数字 4 往上滚，
 * 滚经过 5 最终到达 6，反之同理」。段位是图片，所以滚的是图片卷轴。
 *
 * rank 是连续的：Reform 1-10 = 1..10，希腊 = 11 + index（alpha 起）。
 * 所以 4 → 6 就生成 [4,5,6] 三张图，滚过中间那张。
 * 跨大档（Reform 4 → Alpha 是 7 格）也照样滚完，但每格时间会压缩，总时长封顶。
 */
const RC_REEL_GREEK = [
    ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"],
    ["zeta", "ζ"], ["eta", "η"], ["theta", "θ"], ["iota", "ι"], ["kappa", "κ"],
];

const REEL_MAX_STEPS = 10;

/**
 * 滚动总时长。用户要求「连续跨多个段落的时候要滚快点，只差一个段落的时候要滚慢点点」，
 * 所以总时长随格数**次线性**增长（对数），每格时间反而越来越短：
 *   1 格 → 240ms（每格 240ms，慢慢滚，看得清）
 *   2 格 → 298ms（每格 149ms）
 *   4 格 → 356ms（每格 89ms）
 *   7 格 → 403ms（每格 58ms）
 *   10 格 → 433ms（每格 43ms）
 * 这样一次跳很多档不会拖沓，只跳一档也不会一闪而过。
 */
function reelDuration(stepCount) {
    if (!(stepCount > 0)) return 240;
    return Math.round(Math.min(600, 240 + 58 * Math.log2(stepCount)));
}

/**
 * 在 holder 里滚一段图标。steps 是按顺序排好的 spec 列表（含起点和终点）。
 * 滚完换成静态图标，避免 DOM 一直挂着整列图片。
 */
function rollGlyph(holder, steps) {
    if (!holder || !steps || steps.length < 2) return false;

    // 先按终态铺一张静态图 —— .dan 的宽度是靠这张图撑出来的，
    // 直接清空换成绝对定位的裁剪框会让 .dan 塌成 0 宽，整根卷轴就看不见了。
    renderGlyph(holder, steps[steps.length - 1]);
    const base = holder.firstElementChild;
    if (!base) return false;
    if (!(base.getBoundingClientRect().height > 1)) return true; // 卡片隐藏中，直接留终态

    const start = () => {
        if (!base.isConnected) return;
        // 图标实际渲染高度（受媒体查询影响），裁剪框和滚动步长都用它。
        const height = base.getBoundingClientRect().height;
        if (!(height > 1)) return;
        base.style.visibility = "hidden";

        const clip = document.createElement("div");
        clip.className = "dan-reel-clip";
        const reel = document.createElement("div");
        reel.className = "dan-reel";
        clip.style.setProperty("--reel-step", `${height}px`);
        clip.appendChild(reel);
        holder.appendChild(clip);

        // 排布：**高难在上、低难在下**。
        // 所以升段 = 往上翻（内容向下走），降段 = 往下翻（内容向上走）。
        // 之前两个方向都是 translateY 变负，降段看起来也像在"加难度"，方向是反的。
        const ordered = [...steps].sort((a, b) => b.rank - a.rank);
        const fromRank = steps[0].rank;
        const toRank = steps[steps.length - 1].rank;
        const fromIndex = Math.max(0, ordered.findIndex((x) => x.rank === fromRank));
        const toIndex = Math.max(0, ordered.findIndex((x) => x.rank === toRank));
        const height_ = height;

        reel.textContent = "";
        for (const step of ordered) {
            const img = document.createElement("img");
            img.src = step.src;
            img.alt = step.alt || step.text || "";
            img.draggable = false;
            reel.appendChild(img);
        }

        const duration = reelDuration(Math.abs(ordered.length - 1));
        reel.style.transition = "none";
        reel.style.transform = `translateY(${(-fromIndex * height_).toFixed(2)}px)`;
        reel.getBoundingClientRect(); // 强制布局，先把起点钉住
        reel.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
        reel.getBoundingClientRect();
        reel.style.transform = `translateY(${(-toIndex * height_).toFixed(2)}px)`;

        const finish = () => {
            if (clip.parentElement === holder) holder.removeChild(clip);
            base.style.visibility = "";
        };
        reel.addEventListener("transitionend", finish, { once: true });
        // 兜底：transitionend 偶尔不触发（元素被隐藏/取消），到点直接收尾。
        setTimeout(finish, duration + 120);
    };

    // 图标没加载完时 .dan 宽度还是 0，这时候起滚会整根看不见 —— 等 load 再滚。
    if (base.complete && base.naturalWidth > 0) start();
    else base.addEventListener("load", start, { once: true });
    return true;
}

/** 从 from 到 to 生成滚动的 spec 序列（含两端），拿不到图片就返回 null。 */
function reelSteps(fromRank, toRank, specForRank, finalSpec = null) {
    const a = Math.round(Number(fromRank));
    const b = Math.round(Number(toRank));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
    const up = b > a;
    const span = Math.abs(b - a);
    if (span > REEL_MAX_STEPS) return null;
    const steps = [];
    for (let i = 0; i <= span; i += 1) {
        const rank = up ? a + i : a - i;
        // 中间帧只是"路过"的档位，没有真实分档，用基础徽章；
        // 最后一帧必须是这张谱真实的徽章（含 low / mid-high / high 分档），
        // 否则滚动结束会停在 beta，而实际是 beta+。
        const isLast = i === span;
        const spec = isLast && finalSpec ? finalSpec : specForRank(rank);
        if (!spec) return null;
        steps.push(spec);
    }
    return steps;
}

/**
 * 把文字压进它所在的那个格子。
 *
 * VIBRO 是 5 个字母，但 `.dan` 占的是**一个字形**的格子（网格列宽 1.25 × line-h）。
 * 竖版媒体查询又把 `.dan` 的 font-size 定成 min(30vh,36vw)，窄窗口下这行字会撑出格子，
 * 再被 `.card { overflow: hidden }` 裁掉 —— 用户反馈「vibro 在窗口过窄的时候会显示不全」。
 * 所以按格子的实际宽度反算字号，只缩不放。
 */
function fitLabel(holder) {
    if (!holder) return;
    holder.style.fontSize = "";
    const avail = holder.clientWidth;
    if (!(avail > 0)) return;
    // 一次缩放可能还差几个像素（scrollWidth 取整、字距等原因），所以迭代几次。
    for (let i = 0; i < 4; i += 1) {
        const need = holder.scrollWidth;
        if (!(need > avail)) return;
        const size = Number.parseFloat(getComputedStyle(holder).fontSize) || 16;
        const next = Math.max(7, size * (avail / need) * 0.98);
        if (Math.abs(next - size) < 0.1) return;
        holder.style.fontSize = `${next.toFixed(2)}px`;
    }
}

function renderGlyph(holder, spec) {
    if (!holder) return;
    holder.textContent = "";

    if (!spec || (!spec.src && !spec.text)) {
        holder.textContent = "--";
        holder.className = "dan";
        return;
    }

    if (spec.src) {
        const img = document.createElement("img");
        img.className = "dan-glyph";
        img.src = spec.src;
        img.alt = spec.alt || spec.text || "";
        img.draggable = false;
        img.addEventListener("error", () => {
            if (!img.isConnected) return;
            holder.textContent = spec.text || spec.alt || "--";
            holder.className = `${(spec.text || "").length >= 9 ? "dan dan-sm" : "dan"}`;
        }, { once: true });
        holder.appendChild(img);
        holder.className = "dan";
        return;
    }

    holder.textContent = spec.text || "--";
    const text = holder.textContent;
    const cjk = /[\u3400-\u9fff]/.test(text);
    let className = "dan";
    if (cjk && text.length >= 4) className = "dan dan-xs";
    else if (text.length >= 7) className = "dan dan-sm";
    holder.className = className;
}

/**
 * 段位 → 徽章素材。
 *
 * 徽章由模式模块决定路径（4K/6K/7K 三套素材互不相干），
 * 分档（low / mid-low / mid-high / high）直接换图，不再画 -- / - / + / ++ 符号。
 */
function resolveRcSpec(parsed, keys) {
    if (!parsed) return null;
    const mode = getMode(keys);
    if (!mode) return null;
    const src = mode.badge("rc", parsed.tierKey, parsed.suffix);
    const text = parsed.named || parsed.big || parsed.family;
    return { src, text, alt: text };
}

function resolveLnSpec(parsed, keys) {
    if (!parsed) return null;
    const mode = getMode(keys);
    if (!mode) return null;
    const src = mode.badge("ln", parsed.tierKey, parsed.suffix);
    const text = parsed.big || "LN";
    return { src, text, alt: text };
}

/** rank → 徽章 spec（滚动动画的中间帧用）。 */
function rcSpecForRank(rank, keys) {
    const r = Math.round(Number(rank));
    const mode = getMode(keys);
    if (!Number.isFinite(r) || !mode) return null;
    let tierKey = null;
    const lowest = mode.keys === 4 ? 1 : 0;
    if (r >= lowest && r <= 10) {
        tierKey = String(r);
    } else if (mode.keys === 4) {
        const greek = RC_REEL_GREEK[r - 11];
        if (greek) tierKey = greek[0];
    } else {
        const hit = Object.entries(mode.namedRanks).find(([, value]) => value === r);
        if (hit) tierKey = hit[0];
    }
    if (!tierKey) return null;
    const src = mode.badge("rc", tierKey, "");
    return src ? { rank: r, src, text: tierKey, alt: tierKey } : null;
}

function lnSpecForRank(rank, keys) {
    const n = Math.round(Number(rank));
    const mode = getMode(keys);
    if (!Number.isFinite(n) || !mode || n < 0) return null;
    const src = mode.badge("ln", String(n), "");
    return src ? { rank: n, src, text: `LN ${n}`, alt: `LN ${n}` } : null;
}

function rcTierText(parsed) {
    return tierMark(parsed.suffix);
}

/** 重画时间轴（只在数据/尺寸变化时调用）。 */
export function renderTimeline(analysis) {
    lastAnalysis = analysis;
    if (!analysis || !el.canvas) {
        clearCanvas();
        return;
    }

    const rect = el.canvas.getBoundingClientRect();
    const cssW = Math.max(10, Math.round(rect.width));
    const cssH = Math.max(6, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (el.canvas.width !== Math.round(cssW * dpr) || el.canvas.height !== Math.round(cssH * dpr)) {
        el.canvas.width = Math.round(cssW * dpr);
        el.canvas.height = Math.round(cssH * dpr);
    }

    const ctx = el.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 自动切段：时间轴画成一条平滑渐变（按段位颜色过渡），不再是一格一格的条码。
    if (Array.isArray(analysis.segments) && analysis.segments.length) {
        const span = Math.max(1, analysis.end - analysis.start);
        const stops = analysis.segments.map((segment) => {
            const parsed = segment.rcLabel ? parseRc(segment.rcLabel, analysis.keys) : null;
            let color = "rgba(255,255,255,0.07)";
            if (parsed && isHiddenIntro(parsed)) color = "rgba(255,255,255,0.1)";
            else if (Number.isFinite(segment.rc)) color = segment.color || "#8a93a6";
            else if (Number.isFinite(segment.ln)) color = segment.lnColor || "#7dd3fc";
            const mid = ((segment.from + segment.to) / 2 - analysis.start) / span;
            return { color, mid: Math.min(1, Math.max(0, mid)) };
        });

        ctx.save();
        if (typeof ctx.roundRect === "function") {
            ctx.beginPath();
            ctx.roundRect(0, 0, cssW, cssH, 4);
            ctx.clip();
        }

        const gradient = ctx.createLinearGradient(0, 0, cssW, 0);
        gradient.addColorStop(0, stops[0].color);
        let lastStop = 0;
        for (const stop of stops) {
            const position = Math.max(lastStop + 0.0005, Math.min(0.9995, stop.mid));
            gradient.addColorStop(position, stop.color);
            lastStop = position;
        }
        gradient.addColorStop(1, stops[stops.length - 1].color);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, cssW, cssH);

        // 顶部高光 + 底部阴影，让渐变条更立体。
        const gloss = ctx.createLinearGradient(0, 0, 0, cssH);
        gloss.addColorStop(0, "rgba(255,255,255,0.16)");
        gloss.addColorStop(0.45, "rgba(255,255,255,0)");
        gloss.addColorStop(1, "rgba(0,0,0,0.24)");
        ctx.fillStyle = gloss;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.restore();
        return;
    }

    const count = Math.max(1, analysis.count);
    const segmentWidth = cssW / count;

    for (let i = 0; i < count; i += 1) {
        const section = analysis.sections[i];
        let color = "rgba(255,255,255,0.055)";
        if (section) {
            if (Number.isFinite(section.rc)) color = hexToRgba(section.color || "#8a93a6", 0.92);
            else if (Number.isFinite(section.ln)) color = hexToRgba(section.lnColor || "#7dd3fc", 0.85);
        }
        ctx.fillStyle = color;
        const x = i * segmentWidth;
        ctx.fillRect(x, 0, Math.max(0.6, segmentWidth - 0.6), cssH);
    }
}

let lastPlayheadKey = "";

/** 更新播放游标与时间文字（每帧调用，开销很小）。 */
export function updatePlayhead(analysis, positionMs, { visible } = {}) {
    // 时间轴已删除，保留入口避免 main 调用报错。
    if (!el.playhead) return;
    if (!analysis || !Number.isFinite(positionMs)) {
        if (el.playhead) el.playhead.hidden = true;
        return;
    }

    const span = Math.max(1, analysis.end - analysis.start);
    const pct = Math.min(1, Math.max(0, (positionMs - analysis.start) / span));

    if (visible) {
        el.playhead.hidden = false;
        el.playhead.style.left = `${(pct * 100).toFixed(3)}%`;
    } else {
        el.playhead.hidden = true;
    }

    // 时间轴上的“当前段落”高亮：只做参考，不锁大号数字。
    if (el.segHighlight) {
        const segments = analysis.segments;
        if (visible && Array.isArray(segments) && segments.length) {
            let lo = 0;
            let hi = segments.length - 1;
            let found = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const seg = segments[mid];
                if (positionMs < seg.from) hi = mid - 1;
                else if (positionMs >= seg.to) lo = mid + 1;
                else { found = mid; break; }
            }
            if (found === -1) found = Math.max(0, Math.min(segments.length - 1, lo));
            const seg = segments[found];
            el.segHighlight.hidden = false;
            el.segHighlight.style.left = `${(((seg.from - analysis.start) / span) * 100).toFixed(3)}%`;
            el.segHighlight.style.width = `${(((seg.to - seg.from) / span) * 100).toFixed(3)}%`;
        } else {
            el.segHighlight.hidden = true;
        }
    }

    const elapsed = Math.max(0, positionMs - analysis.start);
    const key = `${Math.floor(elapsed / 1000)}|${Math.floor(span / 1000)}`;
    if (key !== lastPlayheadKey) {
        lastPlayheadKey = key;
        el.tNow.textContent = formatTime(elapsed);
        el.tEnd.textContent = formatTime(span);
    }
}

function formatTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hexToRgba(hex, alpha) {
    const text = String(hex || "").replace("#", "");
    const full = text.length === 3
        ? text.split("").map((ch) => ch + ch).join("")
        : text.padEnd(6, "0").slice(0, 6);
    const value = Number.parseInt(full, 16);
    if (!Number.isFinite(value)) return `rgba(138,147,166,${alpha})`;
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

function clearCanvas() {
    if (!el.canvas) return;
    const ctx = el.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
}
