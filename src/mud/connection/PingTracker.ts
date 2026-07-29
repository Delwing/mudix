const PING_INTERVAL_MS = 3000;
const PING_PROBE_TIMEOUT_MS = 10000;

export interface PingEventSource {
    on(event: 'gmcp.negotiated', handler: () => void): () => void;
    on(event: 'client.disconnect', handler: () => void): () => void;
    on(event: 'gmcp.core.ping', handler: () => void): () => void;
}

export class PingTracker {
    private timer: number | null = null;
    private probeTimer: number | null = null;
    private lastSentAt: number | null = null;
    private lastDuration: number | null = null;
    private supported = false;
    private readonly unsubs: Array<() => void>;

    constructor(
        private readonly sendPingCommand: (latencyMs: number) => void,
        private readonly onPing: (duration: number | null) => void,
        source: PingEventSource,
    ) {
        this.unsubs = [
            source.on('gmcp.negotiated', () => this.probe()),
            source.on('client.disconnect', () => this.stop()),
            source.on('gmcp.core.ping', () => this.handlePingResponse()),
        ];
    }

    destroy(): void {
        this.stop();
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
    }

    private probe() {
        if (this.supported || this.timer !== null || this.probeTimer !== null) return;
        this.sendPing();
        this.probeTimer = window.setTimeout(() => {
            this.probeTimer = null;
            this.lastSentAt = null;
        }, PING_PROBE_TIMEOUT_MS);
    }

    private start() {
        if (this.timer !== null) return;
        this.timer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    }

    private stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.probeTimer !== null) {
            clearTimeout(this.probeTimer);
            this.probeTimer = null;
        }
        this.supported = false;
        this.lastSentAt = null;
        if (this.lastDuration !== null) {
            this.lastDuration = null;
            this.onPing(null);
        }
    }

    /** Sends the last round-trip we measured, per the GMCP spec's documented
     *  `Core.Ping <average latency>` form — 0 on the first probe, when there is
     *  nothing measured yet. The latency is informational to the server; what
     *  matters here is that the request always carries a body, since a bare
     *  `Core.Ping` makes servers that unconditionally JSON-parse the part after
     *  the module name choke on an empty string. */
    private sendPing() {
        this.lastSentAt = performance.now();
        this.sendPingCommand(Math.round(this.lastDuration ?? 0));
    }

    private handlePingResponse() {
        if (this.lastSentAt === null) return;
        const duration = performance.now() - this.lastSentAt;
        this.lastSentAt = null;
        this.lastDuration = duration;
        this.onPing(duration);

        if (!this.supported) {
            this.supported = true;
            if (this.probeTimer !== null) {
                clearTimeout(this.probeTimer);
                this.probeTimer = null;
            }
            this.start();
        }
    }
}
