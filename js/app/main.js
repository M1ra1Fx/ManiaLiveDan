// ManiaLiveDan 主入口：接 tosu → 抓谱面 → 整图/分段计算 → 实时渲染。
import { APP } from "./config.js";
import { TosuSocket } from "./socket.js";
import { getModInfo, readBeatmapState, isSongSelectState } from "./tosu.js";
import { LiveClock } from "./live.js";
import { analyzeWholeMap, computeSectionAt, fetchBeatmapFile } from "./engine.js";
import { segmentIndexAt } from "./segment.js";
import {
    analyzeWhole,
    normalizeResult,
    algorithmFor,
    readCachedResult,
    writeCachedResult,
    clearCachedResult,
    warmupEstimators,
} from "./estimate.js";
import { startSettingsStream, getSetting, onSettingsChange } from "./settings.js";
import { t, getLanguage } from "./i18n.js";
import * as ui from "./ui.js";

const analysisCache = new Map(); // `${identity}|${modSignature}` → analysis
const textCache = new Map(); // identity → .osu 原文

const state = {
    mods: {
        client: "",
        codes: [],
        rate: 1,
        odFlag: null,
        cvtFlag: null,
        hasInfo: false,
        signature: "1.00000|-|-",
    },
    beat: null,
    analysis: null,
    algorithm: "",
    activeKey: "",
    requestToken: 0,
    prefillTimer: 0,
    sectionIndex: -1,
    statusKey: "",
    statusOverride: null,
    loadRetries: 0,
    missingIdentity: 0,
    lastMessageAt: 0,
    stale: false,
};

const clock = new LiveClock();

export function boot() {
    ui.initUi();
    ui.setStatus(t(getLanguage()).status.connecting, "loading");

    const socket = new TosuSocket({
        onMessage: onMessage,
        onStatus: (connected) => {
            ui.setConnection(connected);
            if (!connected) {
                setStatus(t(getLanguage()).status.disconnected, "error");
            } else if (state.statusOverride) {
                setStatus(state.statusOverride.text, state.statusOverride.tone);
            } else if (state.analysis) {
                refreshStatus();
            } else {
                setStatus(t(getLanguage()).status.waiting, "idle");
            }
        },
    });
    socket.connect();

    requestAnimationFrame(tick);
    startSettingsStream();
    // 面板里换了算法 → 立刻重算当前谱面的整图段位（规格：换算法立刻生效）
    onSettingsChange(() => {
        // 语言：静态文案先换掉，再重画（重画会重写 caption / sub / status）。
        ui.applyLanguage();
        if (!state.analysis) {
            ui.resetUi();
            refreshStatus({ force: true });
            return;
        }
        // 分档角标之类的显示开关：立刻重画
        renderCurrent();
        const next = algorithmFor(state.analysis.keys);
        if (next === state.algorithm) return;
        state.algorithm = next;
        state.analysis.whole = null;
        state.analysis.wholeStatus = "";
        maybeAlignWhole(state.analysis, state.requestToken);
    });
    // 预热本地算法 worker：把模块和 ONNX 运行时提前加载好，别等第一次换图才现装。
    // 稍微延后一点，避免和首屏分析抢主线程。
    setTimeout(() => warmupEstimators(), 1500);
}

function onMessage(data) {
    if (typeof window !== "undefined") {
        window.__MLD = window.__MLD || {};
        window.__MLD.messages = (window.__MLD.messages || 0) + 1;
    }

    const beat = readBeatmapState(data);
    const mods = getModInfo(data);

    state.lastMessageAt = performance.now();
    state.beat = beat;
    if (mods.hasInfo || !state.mods.hasInfo) {
        state.mods = mods;
    }

    clock.update({
        liveMs: beat.liveMs,
        rate: state.mods.rate,
        paused: beat.paused,
        playing: beat.playing,
    });

    if (!beat.identity) {
        // tosu 的 partial 包/换图空档可能短暂没有谱面身份；连续几条都没有才真正清空。
        state.missingIdentity += 1;
        if (state.missingIdentity >= APP.missingIdentityLimit) setIdle();
        return;
    }
    state.missingIdentity = 0;

    const key = `${beat.identity}|${state.mods.signature}`;
    if (key !== state.activeKey) {
        activate(key, beat);
    }

    ui.setKeys(state.analysis ? state.analysis.keys : (beat.mode === "mania" ? beat.keysHint : null));
    ui.setMods(formatMods(state.mods));

    refreshStatus();
}

function activate(key, beat) {
    // 无论缓存命中与否都递增 token：让任何在途的旧 fetch/analyze 立刻作废。
    const token = ++state.requestToken;
    const cached = touchCache(analysisCache, key);
    if (cached) {
        activateAnalysis(key, cached, token);
        return;
    }

    state.activeKey = key;
    state.analysis = null;
    state.sectionIndex = -1;
    state.loadRetries = 0;
    stopPrefill();
    ui.showCurrent(null, null, { playing: false });
    setStatusOverride(t(getLanguage()).status.reading, "loading");

    loadAnalysis(token, key, beat, { ...state.mods });
}

async function loadAnalysis(token, key, beat, mods) {
    const text = await getBeatmapText(beat);
    if (token !== state.requestToken) return;
    if (!text) {
        state.loadRetries += 1;
        if (state.loadRetries <= 10) {
            setStatusOverride(t(getLanguage()).status.readingRetry(state.loadRetries, 10), "error");
            setTimeout(() => {
                if (token === state.requestToken) loadAnalysis(token, key, beat, mods);
            }, 2500);
        } else {
            setStatusOverride(t(getLanguage()).status.noFile, "error");
        }
        return;
    }
    state.loadRetries = 0;

    // 让「读取谱面…」先画出来，再做同步计算。
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== state.requestToken) return;

    let analysis;
    try {
        analysis = analyzeWholeMap(text, mods, {
            firstObject: beat.firstObject,
            lastObject: beat.lastObject,
        });
    } catch (error) {
        console.warn("[ManiaLiveDan] analyze failed", error);
        analysis = { error: "parse-failed" };
    }
    if (token !== state.requestToken) return;

    if (analysis.error) {
        setStatusOverride(errorText(analysis.error), "error");
        return;
    }

    analysisCache.set(key, analysis);
    trimMap(analysisCache, 6, key);
    activateAnalysis(key, analysis, token);
}

function activateAnalysis(key, analysis, token) {
    if (token !== state.requestToken) return;

    state.activeKey = key;
    state.analysis = analysis;
    state.sectionIndex = -1;
    state.statusOverride = null;
    stopPrefill();
    ui.setKeys(analysis.keys);
    ui.showCurrent(null, analysis, { playing: false });
    ui.renderTimeline(analysis);
    refreshStatus({ force: true });

    // 有自适应分段就按分段显示；分段计算失败时才回退到滑动窗口预计算。
    if (!(analysis.segments && analysis.segments.length) && analysis.sections.includes(null)) {
        startPrefill(analysis, token);
    }

    maybeAlignWhole(analysis, token);
}

/**
 * 整图结果里的 LN 闸门。
 *
 * MMA 的 estDiff() 是拿 **RC 星数** 去查 LN 表得出 LN 段位的，压根不看 lnRatio；
 * 再配上 enableAlwaysShowLNDifficulty=true，任何谱都会被硬算出一个 LN 段位。
 * 结果就是「一根 LN 都没有的 7K 谱」也能显示 LN Stellium。
 *
 * 但 LN 估计器本身是诚实的：零 LN 谱会返回 NaN，低于表下限会返回 "< ..."，
 * 这两种情况 analysis.lnLabel 都是空 —— 拿它当闸门，算法给的 LN 一律不采信。
 */
function gateWholeLn(result, analysis) {
    if (!result) return result;
    if (!analysis.lnLabel) result.lnLabel = "";
    return result;
}

/** 按当前状态重画一次卡片（改设置后要立刻看到效果，不能等换段）。 */
function renderCurrent() {
    const analysis = state.analysis;
    if (!analysis) return;
    const playing = Boolean(state.beat && (state.beat.playing || state.beat.paused));
    if (playing && state.sectionIndex >= 0 && Array.isArray(analysis.segments)) {
        ui.showCurrent(analysis.segments[state.sectionIndex], analysis, {
            playing: true,
            segmentIndex: state.sectionIndex,
            segmentTotal: analysis.segments.length,
        });
    } else {
        ui.showCurrent(null, analysis, { playing: false });
    }
}

// 整图段位：用当前选中的算法在本地算一遍（不再读 MMA 的结果）。
// 结果只更新「整图」行；「当前这段」仍用 Sunny 分段口径。
function maybeAlignWhole(analysis, token) {
    if (analysis.wholeStatus === "ok" || analysis.wholeStatus === "error") return;

    // 同一张图、同 mods、同算法算过 → 直接命中
    const cacheKey = `${state.activeKey}|${algorithmFor(analysis.keys)}`;
    const cached = readCachedResult(cacheKey);
    if (cached) {
        analysis.whole = gateWholeLn(cached, analysis);
        analysis.wholeStatus = "ok";
        if (state.beat && !state.beat.playing) {
            ui.showCurrent(null, analysis, { playing: false });
        }
        return;
    }

    analysis.wholeStatus = "pending";
    const algorithm = algorithmFor(analysis.keys);
    state.algorithm = algorithm;

    analyzeWhole({ text: analysis.text, mods: analysis.mods, algorithm, keys: analysis.keys })
        .then((result) => {
            if (token !== state.requestToken || state.analysis !== analysis) {
                analysis.wholeStatus = "";
                return;
            }
            if (!result || !result.rcLabel) {
                analysis.wholeStatus = "error";
                return;
            }
            gateWholeLn(result, analysis);
            analysis.whole = result;
            analysis.wholeStatus = "ok";
            writeCachedResult(cacheKey, result);
            if (state.beat && !state.beat.playing) {
                ui.showCurrent(null, analysis, { playing: false });
            }
        })
        .catch((error) => {
            if (token !== state.requestToken || state.analysis !== analysis) {
                analysis.wholeStatus = "";
                return;
            }
            console.warn("[ManiaLiveDan] whole-map estimate failed", error);
            analysis.wholeStatus = "error";
            analysis.wholeError = String(error?.message || error);
        });
}

async function getBeatmapText(beat) {
    const cached = touchCache(textCache, beat.identity);
    if (cached) return cached;
    const text = await fetchBeatmapFile({ title: beat.title, version: beat.version });
    if (text) {
        textCache.set(beat.identity, text);
        trimMap(textCache, 4, beat.identity);
    }
    return text;
}

function startPrefill(analysis, token) {
    stopPrefill();
    let index = 0;
    let lastPaint = 0;
    const step = () => {
        if (token !== state.requestToken || state.analysis !== analysis) return;
        const startedAt = performance.now();
        while (index < analysis.count && performance.now() - startedAt < APP.prefillBudgetMs) {
            computeSectionAt(analysis, index);
            index += 1;
        }
        const now = performance.now();
        if (index >= analysis.count || now - lastPaint >= APP.timelinePaintIntervalMs) {
            lastPaint = now;
            ui.renderTimeline(analysis);
        }
        if (index < analysis.count) {
            state.prefillTimer = setTimeout(step, APP.prefillDelayMs);
        }
    };
    state.prefillTimer = setTimeout(step, 0);
}

function stopPrefill() {
    if (state.prefillTimer) {
        clearTimeout(state.prefillTimer);
        state.prefillTimer = 0;
    }
}

function tick() {
    requestAnimationFrame(tick);

    const beat = state.beat;
    if (!beat) {
        ui.setGameVisible(false);
        return;
    }

    // 断流看门狗：tosu 不再发包时停止外推，并给出提示。
    const stale = state.lastMessageAt > 0
        && performance.now() - state.lastMessageAt > APP.staleMs;
    if (stale !== state.stale) {
        state.stale = stale;
        if (stale) {
            setStatusOverride(t(getLanguage()).status.unresponsive, "error");
        } else {
            state.statusOverride = null;
            refreshStatus({ force: true });
        }
    }

    // 只在游戏进行中显示；选歌界面可额外显示整图难度（可在 tosu 面板设置里关掉）。
    const onlyInGame = getSetting("showOnlyInGame", APP.showOnlyInGame) !== false;
    const showSelect = getSetting("showInSongSelect", APP.showInSongSelect) !== false;
    const inMatch = Boolean(beat.playing || beat.paused) && !stale;
    const inSelect = isSongSelectState(beat.stateName) && showSelect;
    const inGame = onlyInGame ? (inMatch || inSelect) : true;
    ui.setGameVisible(inGame);

    const analysis = state.analysis;
    if (!analysis) return;

    const rawPosition = stale ? clock.live : clock.position();
    const offset = Number(APP.timeOffsetMs) || 0;
    const position = Number.isFinite(rawPosition) ? rawPosition + offset : rawPosition;
    const playing = Boolean(beat.playing || beat.paused);

    if (playing && Number.isFinite(position)) {
        // 自适应分段：稳定段保持不动，难度变化的区段切得更密。
        if (Array.isArray(analysis.segments) && analysis.segments.length) {
            const segmentIdx = segmentIndexAt(analysis.segments, position);
            if (segmentIdx !== state.sectionIndex) {
                state.sectionIndex = segmentIdx;
                ui.showCurrent(analysis.segments[segmentIdx], analysis, {
                    playing: true,
                    segmentIndex: segmentIdx,
                    segmentTotal: analysis.segments.length,
                });
            }
        } else {
            const index = sectionIndexFor(analysis, position);
            if (index !== state.sectionIndex) {
                state.sectionIndex = index;
                const section = computeSectionAt(analysis, index);
                ui.showCurrent(section, analysis, { playing: true });
            }
        }
        ui.updatePlayhead(analysis, position, { visible: true });
    } else {
        if (state.sectionIndex !== -1) {
            state.sectionIndex = -1;
            ui.showCurrent(null, analysis, { playing: false });
        }
        ui.updatePlayhead(analysis, position ?? analysis.start, { visible: false });
    }
}

function sectionIndexFor(analysis, positionMs) {
    // 窗口结束于当前播放位置（futureMs=0）：取已经播完的秒数，避免取到未来。
    const index = Math.floor((positionMs - analysis.start) / analysis.stepMs);
    return Math.max(0, Math.min(analysis.count - 1, index));
}

function setIdle() {
    const wasActive = state.activeKey !== "" || state.analysis !== null || state.statusOverride !== null;
    state.activeKey = "";
    state.analysis = null;
    state.sectionIndex = -1;
    state.requestToken += 1;
    state.statusOverride = null;
    state.loadRetries = 0;
    state.missingIdentity = 0;
    state.stale = false;
    stopPrefill();
    if (wasActive) {
        ui.showCurrent(null, null, { playing: false });
        ui.renderTimeline(null);
    }
    setStatus(t(getLanguage()).status.waiting, "idle");
    ui.setKeys(null);
    ui.setMods("");
}

function refreshStatus({ force = false } = {}) {
    if (state.statusOverride && !force) return;

    let key;
    let text;
    let tone;
    const strings = t(getLanguage()).status;
    if (!state.analysis) {
        key = "no-analysis";
        text = strings.waiting;
        tone = "idle";
    } else if (state.beat && state.beat.playing) {
        key = "playing";
        text = strings.live;
        tone = "ok";
    } else {
        key = "ready";
        text = strings.ready;
        tone = "ok";
    }
    if (!force && key === state.statusKey) return;
    state.statusKey = key;
    setStatus(text, tone);
}

function setStatus(text, tone) {
    state.statusKey = "";
    ui.setStatus(text, tone);
}

function setStatusOverride(text, tone) {
    state.statusOverride = text ? { text, tone } : null;
    setStatus(text, tone);
}

function formatMods(mods) {
    const codes = Array.isArray(mods.codes) ? mods.codes.join("") : "";
    const rate = Number(mods.rate);
    const rateText = Number.isFinite(rate) && Math.abs(rate - 1) > 1e-6 ? `${rate.toFixed(2)}x` : "";
    return [codes, rateText].filter(Boolean).join(" ");
}

function errorText(code) {
    const strings = t(getLanguage()).status;
    switch (code) {
        case "not-mania": return strings.errorNotMania;
        case "empty-chart": return strings.errorEmpty;
        default: return strings.errorParse;
    }
}

function trimMap(map, limit, keepKey) {
    while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === keepKey) {
            // 正在显示的那一项不淘汰：挪到队尾。
            const value = map.get(oldest);
            map.delete(oldest);
            map.set(oldest, value);
            continue;
        }
        map.delete(oldest);
    }
}

// 命中即刷新 LRU 顺序。
function touchCache(map, key) {
    const value = map.get(key);
    if (value === undefined) return null;
    map.delete(key);
    map.set(key, value);
    return value;
}
