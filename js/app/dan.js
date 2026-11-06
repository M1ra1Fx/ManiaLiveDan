// 段位文本 → 结构化显示信息（徽章键、后缀、颜色、阶梯位置）。
//
// 这里只做「文本 ↔ 结构」的翻译，具体每个键数用什么表、什么前缀、什么徽章，
// 全部由 js/app/modes/ 里的三个模块决定。4K / 6K / 7K 互不干扰。
import { estDiff2 } from "../lib/estimator/reworkEstimatorUtils.js";
import { DAN_INDEX } from "../lib/estimator/intervals/index.js";
import { getMode, hasDanTable as modeHasDanTable } from "./modes/index.js";

const TIER_RE = /^(low|mid\/low|mid|mid\/high|high)$/i;

const GREEK = [
    ["Alpha", "α"], ["Beta", "β"], ["Gamma", "γ"], ["Delta", "δ"], ["Epsilon", "ε"],
    ["Emik Zeta", "ζ"], ["Thaumiel Eta", "η"], ["CloverWisp Theta", "θ"], ["Iota", "ι"],
    ["Kappa", "κ"], ["Lambda", "λ"], ["Mu", "μ"], ["Nu", "ν"], ["Xi", "ξ"],
    ["Omicron", "ο"], ["Pi", "π"], ["Rho", "ρ"],
];

const GREEK_BY_LOWER = new Map(GREEK.map(([name, symbol], index) => [name.toLowerCase(), { name, symbol, index }]));

// LN 具名段位（4K 的 LN 16-20）。6K/7K 的 LN 具名档走 mode.namedRanks。
const LN_NAMED_RANKS = {
    "ln terra": 16,
    "ln celestial": 17,
    "ln mystery": 18,
    "ln nihility": 19,
    "ln finish": 20,
    "ln gamma": 16,
    "ln azimuth": 17,
    "ln zenith": 18,
    "ln stellium": 19,
};

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/** 该键数是否有段位表（4/6/7 有）。 */
export function hasDanTable(keys) {
    return modeHasDanTable(keys);
}

/**
 * 该键数 LN 表的**真实首档星数** —— 全项目唯一的 LN 门槛。
 *
 * 直接从区间表取 table[0][0]，而不是在 mode 模块里手抄一个数字：
 * 以前 4K 抄的是 4.832、config 的 showLnMinStar 又写 4.84，两处差 0.008，
 * 于是「整图」用 4.84、「当前段」用表里的 4.832，同一张谱两个门槛。
 * 现在只有这一个来源：4K=4.832、6K=3.530、7K=4.836，谁也别再抄第二份。
 *
 * 语义：星数 **低于** 它 = 够不上该键数最弱的 LN 档 = LN 块不显示任何档位文本
 * （也不显示 "< 最弱档" 这种兜底 —— 用户明确不要）。
 * 没有 LN 表的键数（5K/8K/9K/10K）返回 Infinity，调用方据此判「没有 LN 表」。
 */
export function lnFloorStar(keys, extended = false) {
    const table = lnTableOf(keys, extended);
    return table ? Number(table[0][0]) : Number.POSITIVE_INFINITY;
}

/**
 * 该键数的 LN 区间表（extended 有独立表就用独立的）。
 * 没有 LN 表（5K/8K/9K/10K）返回 null。
 */
function lnTableOf(keys, extended = false) {
    const entry = DAN_INDEX[Number(keys)];
    if (!entry || !entry.LN) return null;
    const table = entry.LN[extended ? "extended" : "default"] ?? entry.LN.default;
    return Array.isArray(table) && table.length ? table : null;
}

/** 该键数是否有 LN 段位表。 */
export function hasLnTable(keys, extended = false) {
    return Boolean(lnTableOf(keys, extended));
}

/**
 * LN 显示文本的统一出口（整图 / 当前段 / Prism 覆盖都走这里）。
 *
 * 规则只有两条（用户原话：「不要冒小于号，太简单没有显示的意义」）：
 *   1. 没有长条，或该键数没有 LN 表 → 空串（LN 块不显示）
 *   2. 星数 **≥ 该键数 LN 表真实首档** → formatLn 的档位文本（"LN 5 mid" ...）
 *   3. 星数低于首档 → **空串**。不再返回 "< 最弱档" 兜底文本：
 *      低于最弱一档本来就「没有显示的意义」，留空即可。
 *
 * 门槛用的是 lnFloorStar(keys, extended)，和 engine.js 里判「整图够不够门槛」
 * 是同一个函数 —— 段级和整图级不会再出现 4.84 / 4.832 这种双门槛。
 *
 * @param {number} star      LN 星数（0 或 NaN 都可能：没长条、或没算出来）
 * @param {number} keys      键数
 * @param {boolean} extended 是否用 extended 表
 * @param {boolean} hasLn    这张谱/这一段**有没有长条**（来自长条数据，不是星数）
 * @returns {{ label: string, belowFloor: boolean }}
 *   label 为空 = 不显示 LN 档位（没长条 / 没有 LN 表 / 够不上首档）；
 *   belowFloor = true 表示「有长条但低于首档」，调用方可用它弱化样式。
 */
export function resolveLnLabel(star, keys, extended = false, hasLn = false) {
    if (!hasLn || !hasLnTable(keys, extended)) return { label: "", belowFloor: false };
    const floor = lnFloorStar(keys, extended);
    const value = Number(star);
    if (!Number.isFinite(value) || value < floor) return { label: "", belowFloor: true };
    const raw = formatLn(value, keys, extended);
    // formatLn 在表边界上仍可能给出 "< x"（浮点/表边界），一律当「够不上」处理。
    if (!raw || raw.startsWith("<")) return { label: "", belowFloor: true };
    return { label: raw, belowFloor: false };
}

/** RC 段位前缀（Reform / Regular / Level）。 */
export function rcPrefixOf(keys) {
    const mode = getMode(keys);
    return mode ? mode.rcPrefix : "";
}

/** RC 星数 → 段位文本（如 "Reform 8 mid/low" / "Regular Terra high"）。 */
export function formatRc(star, keys, extended = false) {
    if (!Number.isFinite(star)) return "";
    if (!hasDanTable(keys)) return "";
    const text = String(estDiff2(star, 0, keys, extended) || "");
    if (!text || /unknown/i.test(text)) return "";
    return text;
}

/** LN 星数 → LN 段位文本（如 "LN 9 low"）；无效/低于表下限返回 ""。 */
export function formatLn(star, keys, extended = false) {
    if (!Number.isFinite(star) || star <= 0) return "";
    // 10K 有 RC 表但没有 LN 表，estDiff2 会在 keys.LN 上炸，这里直接挡掉。
    if (!hasLnTable(keys, extended)) return "";
    const text = String(estDiff2(0, star, keys, extended) || "");
    const parts = text.split("||");
    if (parts.length < 2) return "";
    const ln = parts[1].trim();
    if (!ln || /unknown/i.test(ln)) return "";
    return ln;
}

function stripPrefix(text) {
    let prefix = "";
    let body = String(text || "").trim();
    if (body.startsWith("<") || body.startsWith(">")) {
        prefix = body[0];
        body = body.slice(1).trim();
    }
    return { prefix, body };
}

function splitTier(body) {
    const parts = body.split(" ");
    const last = parts[parts.length - 1] || "";
    if (TIER_RE.test(last)) {
        return { family: body.slice(0, body.length - last.length).trim(), suffix: last.toLowerCase() };
    }
    return { family: body, suffix: "" };
}

/**
 * 拆分 RC 段位文本。
 * @param {string} text 段位文本
 * @param {number} [keys] 键数；给了才能正确解析 6K/7K 的具名档位
 */
export function parseRc(text, keys) {
    const { prefix, body } = stripPrefix(text);
    if (!body) return null;
    const { family, suffix } = splitTier(body);
    const lower = family.toLowerCase();
    const mode = getMode(keys);

    let rank = Number.NaN;
    let big = family;
    let english = "";
    let named = "";
    let kind = "";
    let tierKey = "";

    const reform = /^reform\s+(\d+)$/i.exec(family);
    const intro = /^intro\s+(\d+)$/i.exec(family);
    const regular = /^regular\s+(\d+)$/i.exec(family);
    const wild = /^wild\s+(\d+)$/i.exec(family);
    const level = /^level\s+(.+)$/i.exec(family);
    // 6K/7K 的具名档：可能是 "Regular Terra"，也可能上游只给 "Terra"
    const namedMatch = /^(?:regular\s+)?([a-z]+)$/i.exec(family);

    if (reform) {
        kind = "reform";
        rank = Number(reform[1]);
        tierKey = String(rank);
        big = `Reform ${rank}`;
    } else if (intro) {
        kind = "intro";
        rank = Number(intro[1]) / 3 - 0.6;
        tierKey = intro[1];
        big = `Intro ${intro[1]}`;
    } else if (regular) {
        kind = "regular";
        rank = Number(regular[1]);
        tierKey = String(rank);
        big = `Regular ${rank}`;
    } else if (wild) {
        kind = "wild";
        rank = 10 + Number(wild[1]);
        tierKey = `wild-${Number(wild[1])}`;
        big = `Wild ${Number(wild[1])}`;
    } else if (level) {
        kind = "level";
        const raw = level[1].trim();
        rank = Number.isFinite(Number(raw)) ? Number(raw) : (ROMAN[raw.toUpperCase()] ?? Number.NaN);
        tierKey = String(raw).toLowerCase();
        big = `Level ${raw.toUpperCase()}`;
    } else if (namedMatch && mode && mode.namedRanks[namedMatch[1].toLowerCase()] !== undefined) {
        // 6K 的 terra…finish、7K 的 gamma…stellium
        kind = "regular";
        tierKey = namedMatch[1].toLowerCase();
        named = tierKey.charAt(0).toUpperCase() + tierKey.slice(1);
        rank = mode.namedRanks[tierKey];
        big = named;
    } else if (GREEK_BY_LOWER.has(lower)) {
        const greek = GREEK_BY_LOWER.get(lower);
        kind = "greek";
        rank = 11 + greek.index;
        tierKey = greek.name.split(" ").pop().toLowerCase();
        big = greek.symbol;
        english = greek.name;
    }

    if (prefix === "<") rank = Number.isFinite(rank) ? Math.min(rank, -0.5) : -0.5;

    // 「有段位」：6K/7K 的 Regular 0 是合法段位，4K 的 rank 0 是 Intro（不算）
    const numbered = kind === "regular" || kind === "wild" || kind === "level";
    const hasDan = Number.isFinite(rank) && (numbered ? rank >= 0 : rank > 0);
    if (!Number.isFinite(rank)) rank = 0;

    return {
        raw: String(text || "").trim(),
        prefix,
        family,
        suffix,
        kind,
        tierKey,
        named,
        big,
        english,
        rank,
        hasDan,
        color: rcColor(rank, hasDan),
    };
}

/**
 * 拆分 LN 段位文本。
 *
 * 兼容两种输入：
 *   - 正常档位："LN 9 low" / "LN Gamma high"
 *   - 首档以下兜底："< LN 3 low"（prefix="<"，rank 夹到 4.5）
 * 兜底的 "<" 前缀由 stripPrefix 吃掉，所以徽章/配色仍然按首档素材走，
 * 不会因为多一个 "<" 就解析失败。
 */
export function parseLn(text, keys) {
    const { prefix, body } = stripPrefix(text);
    if (!body) return null;
    const { family, suffix } = splitTier(body);
    const lower = family.toLowerCase();
    const mode = getMode(keys);

    const numeric = /^(?:hypersovae\s+|lnlism\s+)?ln\s+(\d+)$/i.exec(family);
    let rank = Number.NaN;
    let big = family;
    let english = "";
    let tierKey = "";

    if (numeric) {
        rank = Number(numeric[1]);
        tierKey = String(rank);
        big = `LN ${rank}`;
        if (/^hypersovae/i.test(family)) english = "Hypersovae";
        else if (/^lnlism/i.test(family)) english = "Lnlism";
    } else {
        const bare = lower.replace(/^ln\s+/, "");
        if (mode && mode.namedRanks[bare] !== undefined) {
            // 6K/7K 的 LN 具名档
            rank = mode.namedRanks[bare];
            tierKey = bare;
            big = bare.charAt(0).toUpperCase() + bare.slice(1);
        } else if (LN_NAMED_RANKS[lower]) {
            rank = LN_NAMED_RANKS[lower];
            tierKey = lower.replace(/^ln\s+/, "");
            big = tierKey.charAt(0).toUpperCase() + tierKey.slice(1);
        } else {
            rank = 0;
        }
    }

    if (prefix === "<") rank = Math.min(rank, 4.5);

    return {
        raw: String(text || "").trim(),
        prefix,
        family,
        tierKey,
        number: numeric ? Number(numeric[1]) : null,
        suffix,
        big,
        english,
        rank,
        hasDan: Number.isFinite(rank) && rank > 0,
        color: lnColor(rank),
    };
}

/** MMA 输出里的「RC || LN」拆两半。 */
export function splitCombined(text) {
    const parts = String(text || "").split("||").map((part) => part.trim()).filter(Boolean);
    return { rc: parts[0] || "", ln: parts[1] || "" };
}

/**
 * RC 段位颜色。
 * @param {number} rank 阶梯位置
 * @param {boolean} [hasDan] 是否是真段位；6K/7K 的 Regular 0 也是真段位，不能画成灰
 */
export function rcColor(rank, hasDan) {
    if (!Number.isFinite(rank)) return "#8a93a6";
    const valid = hasDan === undefined ? rank >= 0.2 : Boolean(hasDan);
    if (!valid) return "#8a93a6";
    if (rank < 2) return "#7dd3fc";
    if (rank < 4) return "#4fffd5";
    if (rank < 6) return "#d3f557";
    if (rank < 8) return "#fda265";
    if (rank < 10) return "#f94d79";
    if (rank < 12) return "#e0529c";
    if (rank < 14) return "#b76cf0";
    return "#8f6bff";
}

export function lnColor(rank) {
    if (!Number.isFinite(rank)) return "#8a93a6";
    if (rank < 6) return "#7dd3fc";
    if (rank < 8) return "#4fffd5";
    if (rank < 10) return "#d3f557";
    if (rank < 12) return "#fda265";
    if (rank < 14) return "#e0529c";
    return "#b76cf0";
}

/** 区间后缀 → 中文小字（保留给调试/无障碍用）。 */
export function tierText(suffix) {
    switch (String(suffix || "").toLowerCase()) {
        case "low": return "低段";
        case "mid/low": return "中低";
        case "mid": return "中段";
        case "mid/high": return "中高";
        case "high": return "高段";
        default: return "";
    }
}

/** 区间后缀 → 紧凑符号（-- / - / 空 / + / ++）。 */
export function tierMark(suffix) {
    switch (String(suffix || "").toLowerCase()) {
        case "low": return "--";
        case "mid/low": return "-";
        case "mid": return "";
        case "mid/high": return "+";
        case "high": return "++";
        default: return "";
    }
}
