const PING_INTERVAL_MS = 3000;

export class PingTracker {
    private timer: number | null = null;
    private lastSentAt: number | null = null;
    private lastDuration: number | null = null;

    constructor(
        private readonly sendPingCommand: () => void,
        private readonly onPing: (duration: number | null) => void,
        onGmcpPingResponse: (handler: () => void) => void,
    ) {
        onGmcpPingResponse(this.handlePingResponse);
    }

    start() {
        this.stop();
        this.sendPing();
        this.timer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    }

    stop() {
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

    private handlePingResponse = () => {
        if (this.lastSentAt === null) {
            return;
        }

        const duration = performance.now() - this.lastSentAt;
        this.lastSentAt = null;
        this.lastDuration = duration;
        this.onPing(duration);
    };
}
