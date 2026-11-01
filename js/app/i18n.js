// ManiaLiveDan — 界面文案（i18n）。
//
// 语言由 tosu 面板的 `language` 设置决定（见 settings.json 的 Language / 语言）；
// 面板取不到时回退到 config.js 的 APP.language。
//
// ⚠️ 对外暴露的是**解析之后的字符串**（t.status.connecting 这种），不是函数 ——
// 调用处照原样 `${t.sub.keys(section.notes)}` 用即可。
//
// ⚠️ 只有真渲染到屏幕上的字才进这里（textContent / alt / title）。
// 代码注释、调试用的 tierText、以及 `--` `★` `·` `K` 这类图标/单位不进。
import { APP } from "./config.js";
import { getSetting } from "./settings.js";

const STRINGS = {
    en: {
        // ---- 状态行（header 左侧）----
        status: {
            connecting: "Connecting to tosu…",
            disconnected: "tosu disconnected",
            waiting: "Waiting for beatmap…",
            reading: "Reading beatmap…",
            readingRetry: (n, max) => `Can't fetch beatmap file (retry ${n}/${max})`,
            noFile: "Can't fetch beatmap file",
            unresponsive: "tosu not responding",
            live: "Live dan",
            ready: "Waiting to start",
            errorNotMania: "Not an osu!mania beatmap",
            errorEmpty: "Beatmap has no notes",
            errorParse: "Failed to parse beatmap",
        },
        // ---- 右上角小字 ----
        caption: { current: "Current", whole: "Whole map" },
        // ---- 连接指示灯 title ----
        dot: { connected: "tosu connected", disconnected: "tosu not connected" },
        // ---- 主区两个块的名字 ----
        block: { rc: "RC DAN", ln: "LN DAN" },
        // ---- 主区占位 ----
        placeholder: {
            noTable: "No dan table",
            rest: "Rest",
            dash: "—",
            noLn: "No LN difficulty in this segment",
            vibro: "VIBRO segment (too player-dependent, no dan)",
        },
        // ---- 说明行 ----
        sub: {
            segment: (i, total, notes) => `Segment ${i}/${total} · ${notes} notes`,
            notes: (notes) => `${notes} notes`,
            currentSegment: "Current segment",
            keys: (keys) => `${keys}K beatmap`,
        },
    },

    zh: {
        status: {
            connecting: "连接 tosu…",
            disconnected: "tosu 连接断开",
            waiting: "等待谱面…",
            reading: "读取谱面…",
            readingRetry: (n, max) => `拿不到谱面文件（重试 ${n}/${max}）`,
            noFile: "拿不到谱面文件",
            unresponsive: "tosu 无响应",
            live: "实时段位",
            ready: "等待开始",
            errorNotMania: "非 osu!mania 谱面",
            errorEmpty: "谱面没有音符",
            errorParse: "谱面解析失败",
        },
        caption: { current: "当前", whole: "整图" },
        dot: { connected: "tosu 已连接", disconnected: "tosu 未连接" },
        block: { rc: "米段", ln: "LN段" },
        placeholder: {
            noTable: "无段位表",
            rest: "休止",
            dash: "—",
            noLn: "本段没有 LN 难度",
            vibro: "VIBRO 段落（个人差大，不标段位）",
        },
        sub: {
            segment: (i, total, notes) => `第 ${i}/${total} 段 · ${notes} 键`,
            notes: (notes) => `${notes} 键`,
            currentSegment: "当前段",
            keys: (keys) => `${keys}K 谱面`,
        },
    },
};

/** 默认英文：非法/缺失的语言值都落到英文。 */
export const DEFAULT_LANGUAGE = "en";

/** 把面板里的原始值归一成 "en" / "zh"；认不出的返回 null。 */
export function normalizeLanguage(value) {
    const text = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
    if (!text) return null;
    if (text.startsWith("zh") || text === "chinese" || text === "中文") return "zh";
    if (text.startsWith("en") || text === "english") return "en";
    return null;
}

/** 当前生效的语言：面板 > config.js > 英文。 */
export function getLanguage() {
    return normalizeLanguage(getSetting("language", APP.language)) || APP.language || DEFAULT_LANGUAGE;
}

/** 按语言取文案表；未知语言回退英文。 */
export function t(lang) {
    return STRINGS[normalizeLanguage(lang) || DEFAULT_LANGUAGE] || STRINGS[DEFAULT_LANGUAGE];
}

export const LANGUAGES = Object.keys(STRINGS);
