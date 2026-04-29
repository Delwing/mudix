import { EventBus } from '../core/EventBus';
import { MudClient, type MudClientOptions } from './connection/MudClient';
import type { AnsiAwareBuffer } from './text/FormatState';

export type SessionStatus = 'disconnected' | 'connecting' | 'connected';

export type SessionEvents = {
    'status': [status: SessionStatus];
    'ping': [duration: number | null];
    'message': [text?: string | AnsiAwareBuffer, type?: string, timestamp?: number];
};

export type MudSessionOptions = Omit<MudClientOptions, 'url'>;

export class MudSession {
    readonly events = new EventBus<SessionEvents>();
    private client: MudClient | null = null;
    private clientUnsubs: (() => void)[] = [];
    private _status: SessionStatus = 'disconnected';
    private _ping: number | null = null;

    constructor(private readonly options: MudSessionOptions = {}) {}

    get status(): SessionStatus { return this._status; }
    get ping(): number | null { return this._ping; }

    connect(url: string): void {
        this.teardownClient();
        const client = new MudClient({ url, ...this.options });
        this.client = client;

        this.clientUnsubs = [
            client.on('client.connect', () => this.setStatus('connected')),
            client.on('client.disconnect', () => { this.setStatus('disconnected'); this.setPing(null); }),
            client.on('error', () => this.setStatus('disconnected')),
            client.on('ping', d => this.setPing(d)),
            client.on('message', (text, type, timestamp) => this.events.emit('message', text, type, timestamp)),
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
        for (const unsub of this.clientUnsubs) unsub();
        this.clientUnsubs = [];
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
