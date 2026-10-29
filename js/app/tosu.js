// 从 tosu `/websocket/v2` 的 payload 里提取本插件需要的状态。
// 只读、纯函数（不碰 DOM），方便 Node 侧测试。

const PLAY_STATES = new Set(["play", "gameplay", "playing"]);

// stable 端常见 mod 的 bit 值（与 MMA 的 config 对齐）。
const MOD_BITS = {
    EZ: 2,
    HR: 16,
    DT: 64,
    HT: 256,
    NC: 512,
    SV2: 536870912,
};
const KNOWN_CODES = ["SV2", "NC", "DT", "HT", "DC", "EZ", "HR", "IN", "HO", "DA", "CL", "MR", "AT", "WU", "WD"];

export function normalizeStateName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");
}

export function isPlayingState(name) {
    return PLAY_STATES.has(normalizeStateName(name));
}

export function isResultState(name) {
    return normalizeStateName(name) === "resultscreen";
}

export function isSongSelectState(name) {
    const value = normalizeStateName(name);
    return value === "songselect" || value.startsWith("select");
}

function addCodesFromText(codes, value) {
    if (typeof value !== "string" || !value.trim()) return;
    const text = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    let index = 0;
    while (index < text.length) {
        let matched = false;
        for (const code of KNOWN_CODES) {
            if (text.startsWith(code, index)) {
                codes.add(code);
                index += code.length;
                matched = true;
                break;
            }
        }
        if (!matched) index += 1;
    }
}

function collectModCodes(mods, codes) {
    if (!mods) return;
    if (Array.isArray(mods)) {
        for (const item of mods) {
            if (typeof item === "string") addCodesFromText(codes, item);
            else if (item && typeof item === "object") {
                addCodesFromText(codes, item.acronym);
                addCodesFromText(codes, item.name);
            }
        }
        return;
    }
    if (typeof mods !== "object") return;

    if (Array.isArray(mods.array)) collectModCodes(mods.array, codes);
    addCodesFromText(codes, mods.name);
    addCodesFromText(codes, mods.str);
    addCodesFromText(codes, mods.acronym);

    const number = Number(mods.number ?? mods.num);
    if (Number.isFinite(number)) {
        for (const [code, bit] of Object.entries(MOD_BITS)) {
            if ((number & bit) !== 0) codes.add(code);
        }
    }
}

function collectLazerSpeed(mods, state) {
    const arrays = [];
    if (Array.isArray(mods?.array)) arrays.push(mods.array);
    if (Array.isArray(mods)) arrays.push(mods);

    for (const array of arrays) {
        for (const item of array) {
            if (!item || typeof item !== "object") continue;
            const acronym = String(item.acronym || "").toUpperCase();
            const speedChange = Number(item?.settings?.speed_change);
            if (Number.isFinite(speedChange) && speedChange > 0.1) state.speed = speedChange;
            if (acronym === "DA") {
                const od = Number(item?.settings?.overall_difficulty);
                if (Number.isFinite(od)) state.od = od;
            }
        }
    }
}

/**
 * 解析 mod 信息。注意：tosu 的包可能是 partial，`hasInfo=false` 时调用方应保留旧值。
 */
export function getModInfo(data) {
    const candidates = [data?.play?.mods, data?.resultsScreen?.mods, data?.menu?.mods];
    const codes = new Set();
    for (const mods of candidates) collectModCodes(mods, codes);

    const lazerState = { speed: null, od: null };
    for (const mods of candidates) collectLazerSpeed(mods, lazerState);

    const client = String(data?.client || "").toLowerCase();
    const hasInfo = candidates.some((mods) => mods !== null && mods !== undefined);

    let rate = 1;
    if (client === "lazer" && Number.isFinite(lazerState.speed)) {
        rate = lazerState.speed;
    } else if (codes.has("NC") || codes.has("DT")) {
        rate = 1.5;
    } else if (codes.has("HT") || codes.has("DC")) {
        rate = 0.75;
    } else {
        const reported = Number(data?.play?.mods?.rate);
        if (Number.isFinite(reported) && reported > 0.1) rate = reported;
    }

    let odFlag = null;
    if (client === "lazer" && Number.isFinite(lazerState.od)) odFlag = lazerState.od;
    else if (codes.has("HR")) odFlag = "HR";
    else if (codes.has("EZ")) odFlag = "EZ";

    let cvtFlag = null;
    if (client === "lazer") {
        if (codes.has("IN")) cvtFlag = "IN";
        else if (codes.has("HO")) cvtFlag = "HO";
    }

    const displayCodes = [...codes]
        .filter((code) => code !== "SV2" && code !== "CL")
        .sort();

    return {
        client,
        codes: displayCodes,
        rate,
        odFlag,
        cvtFlag,
        hasInfo,
        signature: `${rate.toFixed(5)}|${odFlag == null ? "-" : odFlag}|${cvtFlag == null ? "-" : cvtFlag}`,
    };
}

/** 只接受真正的数字或非空数字字符串；null/""/NaN → null（防 Number(null)=0）。 */
function toFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    return null;
}

// 极少数情况下 tosu 只给 state.number 不给 name；按常见枚举兜底。
const NUMERIC_STATE_NAMES = { 2: "play", 7: "resultscreen" };

/** 当前谱面/游戏状态。 */
export function readBeatmapState(data) {
    const beatmap = data?.beatmap;
    const time = beatmap?.time;

    const liveMs = toFiniteNumber(time?.live) ?? toFiniteNumber(time?.current);
    const firstObject = toFiniteNumber(time?.firstObject);
    const lastObject = toFiniteNumber(time?.lastObject);

    const stateName = normalizeStateName(data?.state?.name)
        || NUMERIC_STATE_NAMES[toFiniteNumber(data?.state?.number)]
        || "";
    const playing = isPlayingState(stateName);
    const result = isResultState(stateName);

    return {
        identity: buildIdentity(data),
        stateName,
        playing,
        result,
        paused: data?.game?.paused === true,
        liveMs,
        firstObject,
        lastObject,
        mode: String(beatmap?.mode?.name || "").toLowerCase(),
        keysHint: Number(beatmap?.stats?.cs?.original || beatmap?.stats?.cs?.converted || 0) || null,
        title: String(beatmap?.title || ""),
        version: String(beatmap?.version || ""),
        mapper: String(beatmap?.mapper || ""),
        officialStars: Number(beatmap?.stats?.stars?.total) || null,
        songLengthMs: toFiniteNumber(time?.mp3Length),
    };
}

/** 谱面身份：id / checksum / 文件路径 / 元数据，任一稳定即可。 */
export function buildIdentity(data) {
    const beatmap = data?.beatmap;
    const id = Number(beatmap?.id);
    const checksum = String(beatmap?.checksum || beatmap?.md5 || "").trim().toLowerCase();
    const path = String(data?.directPath?.beatmapFile || data?.files?.beatmap || "").trim().toLowerCase();
    const meta = [beatmap?.artist, beatmap?.title, beatmap?.version, beatmap?.mapper]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("::");

    if (Number.isFinite(id) && id > 0) return `id:${id}`;
    if (checksum) return `md5:${checksum}`;
    if (path) return `path:${path}`;
    if (meta.replace(/[:]/g, "").length > 0) return `meta:${meta}`;
    return "";
}
