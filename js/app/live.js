// 播放位置时钟：tosu 每 ~150ms 发一次 beatmap.time.live（原始谱面毫秒），
// 两帧之间用消息间隔估出的推进速率外推，避免段位/游标一格一格跳。
export class LiveClock {
    constructor() {
        this.reset();
    }

    reset() {
        this.live = null;
        this.receivedAt = 0;
        this.advance = 1;
        this.hasSample = false;
        this.paused = false;
        this.stopped = false;
    }

    /** 每收到一条 tosu 消息调用一次。 */
    update({ liveMs, rate, paused, playing, now = performance.now() }) {
        this.paused = Boolean(paused);
        this.stopped = !playing;

        if (!Number.isFinite(liveMs)) return;

        if (!this.hasSample) {
            this.hasSample = true;
            this.live = liveMs;
            this.receivedAt = now;
            this.advance = Number.isFinite(rate) && rate > 0.1 ? rate : 1;
            return;
        }

        const elapsed = now - this.receivedAt;
        if (elapsed > 0 && elapsed < 2000) {
            const instant = (liveMs - this.live) / elapsed;
            if (Number.isFinite(instant) && instant > 0.1 && instant < 4) {
                this.advance = this.advance * 0.65 + instant * 0.35;
            }
        }

        // 明显跳变（重开/拖动进度）→ 直接用报告值。
        const predicted = this.live + elapsed * this.advance;
        if (!Number.isFinite(predicted) || Math.abs(liveMs - predicted) > 1200) {
            this.advance = Number.isFinite(rate) && rate > 0.1 ? rate : 1;
        }

        this.live = liveMs;
        this.receivedAt = now;
    }

    /** 当前应该显示的原始谱面位置（ms）；没有样本时返回 null。 */
    position(now = performance.now()) {
        if (!this.hasSample || !Number.isFinite(this.live)) return null;
        if (this.paused || this.stopped) return this.live;
        return this.live + (now - this.receivedAt) * this.advance;
    }
}
