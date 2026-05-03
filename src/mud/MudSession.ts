import { EventBus } from '../core/EventBus';
import { WindowManager } from '../ui/windows/WindowManager';
import { MudClient, type MudClientOptions } from './connection/MudClient';
import { PingTracker } from './connection/PingTracker';
import { type MudClientEvents, type MudEvents, type SessionStatus } from './events';

export type { SessionStatus, MudEvents } from './events';

export type MudSessionOptions = Omit<MudClientOptions, 'url'>;

export class MudSession {
    readonly events = new EventBus<MudEvents>();
    readonly windows = new WindowManager();
    /** Per-window cursor op registries. 'main' is the primary output window. */
    readonly windowCursors = new Map<string, import('../ui/output/OutputRenderer').CursorOps>();
    private client: MudClient | null = null;
    private pingTracker: PingTracker | null = null;
    private stateUnsubs: (() => void)[] = [];
    private _status: SessionStatus = 'disconnected';
    private _ping: number | null = null;
    private _outputReady = false;

    constructor(private readonly options: MudSessionOptions = {}) {
        this.windows.setCursorRegistry(this.windowCursors);
    }

    get status(): SessionStatus { return this._status; }
    get ping(): number | null { return this._ping; }
    get outputReady(): boolean { return this._outputReady; }

    markOutputReady(): void {
        if (this._outputReady) return;
        this._outputReady = true;
        this.events.emit('output.ready');
    }

    markOutputGone(): void {
        this._outputReady = false;
    }

    connect(url: string): void {
        this.teardownClient();
        const client = new MudClient({ url, ...this.options }, this.events as EventBus<MudClientEvents>);
        this.client = client;

        this.pingTracker = new PingTracker(
            () => client.sendGmcp('core.ping'),
            (d) => this.setPing(d),
            this.events,
        );

        this.stateUnsubs = [
            this.events.on('client.connect', () => this.setStatus('connected')),
            this.events.on('client.disconnect', () => { this.setStatus('disconnected'); this.setPing(null); }),
            this.events.on('error', () => this.setStatus('disconnected')),
        ];

        this.setStatus('connecting');
        client.connect();
    }

    disconnect(): void {
        this.client?.disconnect();
    }

    send(text: string): void {
        if (!this.client) return;
        if (this.client.shouldEchoCommand()) {
            this.client.output(`> ${text}`);
        }
        this.client.send(text);
    }

    private teardownClient(): void {
        for (const unsub of this.stateUnsubs) unsub();
        this.stateUnsubs = [];
        this.pingTracker?.destroy();
        this.pingTracker = null;
        this.client?.disconnect();
        this.client = null;
    }

    private setStatus(status: SessionStatus): void {
        this._status = status;
        this.events.emit('status', status);
    }

    private setPing(duration: number | null): void {
        this._ping = duration;
        this.events.emit('ping', duration);
    }
}
