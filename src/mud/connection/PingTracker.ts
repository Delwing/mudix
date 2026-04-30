const PING_INTERVAL_MS = 3000;

export interface PingEventSource {
    on(event: 'gmcp.negotiated', handler: () => void): () => void;
    on(event: 'client.disconnect', handler: () => void): () => void;
    on(event: 'gmcp.core.ping', handler: () => void): () => void;
}

export class PingTracker {
    private timer: number | null = null;
    private lastSentAt: number | null = null;
    private lastDuration: number | null = null;
    private readonly unsubs: Array<() => void>;

    constructor(
        private readonly sendPingCommand: () => void,
        private readonly onPing: (duration: number | null) => void,
        source: PingEventSource,
    ) {
        this.unsubs = [
            source.on('gmcp.negotiated', () => this.start()),
            source.on('client.disconnect', () => this.stop()),
            source.on('gmcp.core.ping', () => this.handlePingResponse()),
        ];
    }

    destroy(): void {
        this.stop();
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
    }

    private start() {
        if (this.timer !== null) return;
        this.sendPing();
        this.timer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    }

    private stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.lastSentAt = null;
        if (this.lastDuration !== null) {
            this.lastDuration = null;
            this.onPing(null);
        }
    }

    private sendPing() {
        this.lastSentAt = performance.now();
        this.sendPingCommand();
    }

    private handlePingResponse() {
        if (this.lastSentAt === null) return;
        const duration = performance.now() - this.lastSentAt;
        this.lastSentAt = null;
        this.lastDuration = duration;
        this.onPing(duration);
    }
}
