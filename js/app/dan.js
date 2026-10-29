// 段位文本 → 结构化显示信息（徽章键、后缀、颜色、阶梯位置）。
//
// 这里只做「文本 ↔ 结构」的翻译，具体每个键数用什么表、什么前缀、什么徽章，
// 全部由 js/app/modes/ 里的三个模块决定。4K / 6K / 7K 互不干扰。
import { estDiff2 } from "../lib/estimator/reworkEstimatorUtils.js";
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

/** LN 段位显示门槛（星数）；没有 LN 表的键数返回 Infinity。 */
export function lnMinStar(keys, override) {
    const mode = getMode(keys);
    if (!mode) return Number.POSITIVE_INFINITY;
    if (Number(keys) === 4 && Number.isFinite(override)) return Number(override);
    return mode.lnMinStar;
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
    const mode = getMode(keys);
    // 10K 有 RC 表但没有 LN 表，estDiff2 会在 keys.LN 上炸，这里直接挡掉
    if (!mode || !Number.isFinite(mode.lnMinStar)) return "";
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

/** 拆分 LN 段位文本。 */
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
