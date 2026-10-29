// 极简 tosu websocket 客户端：断线 1s 重连，只发 /websocket/v2。
import { APP } from "./config.js";

function debugState() {
    if (typeof window === "undefined") return null;
    if (!window.__MLD) window.__MLD = {};
    if (!window.__MLD.socket) window.__MLD.socket = { open: 0, messages: 0, errors: 0, lastError: "" };
    return window.__MLD.socket;
}

export class TosuSocket {
    constructor({ onMessage, onStatus } = {}) {
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.ws = null;
        this.reconnectTimer = 0;
        this.closedByUser = false;
    }

    connect() {
        this.closedByUser = false;
        const url = `${APP.wsOrigin}${APP.wsPath}`;
        let socket;
        try {
            socket = new WebSocket(url);
        } catch (error) {
            this.emitStatus(false, error);
            this.scheduleReconnect();
            return;
        }
        this.ws = socket;

        socket.onopen = () => {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = 0;
            }
            const dbg = debugState();
            if (dbg) dbg.open += 1;
            this.emitStatus(true, null);
        };

        socket.onclose = () => {
            if (this.ws === socket) this.ws = null;
            this.emitStatus(false, null);
            this.scheduleReconnect();
        };

        socket.onerror = () => {
            const dbg = debugState();
            if (dbg) dbg.errors += 1;
            // onclose 会接手重连；这里只更新状态。
            this.emitStatus(false, null);
        };

        socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                const dbg = debugState();
                if (dbg) dbg.lastError = "json-parse";
                return;
            }
            if (data?.error || data?.message?.error) return;
            const dbg = debugState();
            if (dbg) dbg.messages += 1;
            try {
                this.onMessage && this.onMessage(data);
            } catch (error) {
                const state = debugState();
                if (state) state.lastError = String(error && error.message ? error.message : error);
                console.warn("[ManiaLiveDan] message handler error", error);
            }
        };
    }

    scheduleReconnect() {
        if (this.closedByUser || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = 0;
            this.connect();
        }, 1000);
    }

    emitStatus(connected, error) {
        try {
            this.onStatus && this.onStatus(connected, error);
        } catch (error) {
            console.warn("[ManiaLiveDan] status handler error", error);
        }
    }

    close() {
        this.closedByUser = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = 0;
        }
        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
            this.ws = null;
        }
    }
}
