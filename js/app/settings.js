// 读取/监听 tosu 面板里的本插件设置（settings.json）。
import { APP } from "./config.js";

const cache = {
    showOnlyInGame: APP.showOnlyInGame,
    showInSongSelect: APP.showInSongSelect,
};

let socket = null;
let retryTimer = 0;
let pollTimer = 0;
let started = false;

function counterPath() {
    if (typeof window !== "undefined" && typeof window.COUNTER_PATH === "string" && window.COUNTER_PATH.trim()) {
        return window.COUNTER_PATH.trim();
    }
    if (typeof window !== "undefined" && window.location) {
        return `${window.location.pathname || "/"}${window.location.search || ""}`;
    }
    return APP.counterPath;
}

function asBool(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(text)) return false;
    if (["true", "1", "on", "yes"].includes(text)) return true;
    return fallback;
}

const listeners = new Set();

/** 订阅面板设置变化（换算法后要立刻重算，就靠它）。 */
export function onSettingsChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

function applyPayload(payload) {
    if (!payload) return;
    if (Array.isArray(payload)) {
        for (const entry of payload) {
            if (entry && typeof entry.uniqueID === "string") {
                cache[entry.uniqueID] = entry.value;
            }
        }
    } else if (typeof payload === "object") {
        Object.assign(cache, payload);
    }
    cache.showOnlyInGame = asBool(cache.showOnlyInGame, APP.showOnlyInGame);
    cache.showInSongSelect = asBool(cache.showInSongSelect, APP.showInSongSelect);
    if (typeof window !== "undefined") {
        window.__MLD = window.__MLD || {};
        window.__MLD.settings = { ...cache };
    }
    for (const callback of listeners) {
        try {
            callback(cache);
        } catch {
            // 单个监听器出错不影响其它
        }
    }
}

function schedulePoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            try { socket.send(`getSettings:${encodeURIComponent(counterPath())}`); } catch { /* ignore */ }
        }
    }, 3000);
}

function connect() {
    clearTimeout(retryTimer);
    if (typeof WebSocket !== "function") return;
    try {
        socket = new WebSocket(`${APP.wsOrigin}/websocket/commands`);
    } catch {
        retryTimer = setTimeout(connect, 2500);
        return;
    }
    socket.onopen = () => {
        try { socket.send(`getSettings:${encodeURIComponent(counterPath())}`); } catch { /* ignore */ }
        schedulePoll();
    };
    socket.onmessage = (event) => {
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        if (Array.isArray(packet)) applyPayload(packet);
        else if (packet && packet.command === "getSettings") applyPayload(packet.message);
        else if (packet && packet.settings) applyPayload(packet.settings);
    };
    socket.onerror = () => { /* onclose handles retry */ };
    socket.onclose = () => {
        clearInterval(pollTimer);
        retryTimer = setTimeout(connect, 2500);
    };
}

export function startSettingsStream() {
    if (started) return;
    started = true;
    connect();
}

/** 取 Tosu 面板里保存的设置；未加载时回退到 config.js。 */
export function getSetting(key, fallback) {
    const value = cache[key];
    return value === undefined ? fallback : value;
}
