import { EventBus } from '../core/EventBus';
import { WindowManager } from '../ui/windows/WindowManager';
import { LabelManager } from '../ui/labels/LabelManager';
import { CommandLineManager } from '../ui/cmdline/CommandLineManager';
import { SoundManager } from '../ui/sound/SoundManager';
import { VideoManager } from '../ui/video/VideoManager';
import { CmdLineMenuRegistry } from '../ui/CmdLineMenuRegistry';
import { MudClient, type MudClientOptions } from './connection/MudClient';
import { PingTracker } from './connection/PingTracker';
import { type MudClientEvents, type MudEvents, type SessionStatus } from './events';
import type { Console } from './text/Console';

export type { SessionStatus, MudEvents } from './events';

export type MudSessionOptions = Omit<MudClientOptions, 'url'>;

export type ScriptLogSourceKind = 'script' | 'alias' | 'trigger' | 'timer' | 'key' | 'button';

export interface ScriptLogSource {
    kind: ScriptLogSourceKind;
    id: string;
    name: string;
    line?: number;
}

export interface ScriptLogEntry {
    text: string;
    level: 'error' | 'info';
    timestamp: number;
    source?: ScriptLogSource;
}

export class MudSession {
    readonly events = new EventBus<MudEvents>();
    readonly windows = new WindowManager();
    readonly labels = new LabelManager();
    readonly cmdLines = new CommandLineManager();
    readonly sounds = new SoundManager();
    readonly videos = new VideoManager();
    readonly cmdLineMenu = new CmdLineMenuRegistry();
    /** Per-window Console instances. 'main' registered by ScriptingAPI; named windows by WindowManager. */
    readonly consoles = new Map<string, Console>();
    private client: MudClient | null = null;
    private pingTracker: PingTracker | null = null;
    private stateUnsubs: (() => void)[] = [];
    private _status: SessionStatus = 'disconnected';
    private _ping: number | null = null;
    private _outputReady = false;
    private _destroyed = false;

    /** Bounded script.log buffer so the editor panel can backfill entries that
     *  arrived before it was first opened (e.g. errors during initial load). */
    private static readonly SCRIPT_LOG_LIMIT = 500;
    private _scriptLog: ScriptLogEntry[] = [];

    private readonly options: MudSessionOptions;

    constructor(options: MudSessionOptions = {}) {
        this.options = { ...options };
        this.windows.setConsoleRegistry(this.consoles);
        this.events.on('script.log', (text, level, source) => {
            this._scriptLog.push({
                text: text ?? '',
                level: level ?? 'info',
                timestamp: Date.now(),
                ...(source ? { source } : {}),
            });
            if (this._scriptLog.length > MudSession.SCRIPT_LOG_LIMIT) {
                this._scriptLog.splice(0, this._scriptLog.length - MudSession.SCRIPT_LOG_LIMIT);
            }
        });
    }

    get scriptLog(): readonly ScriptLogEntry[] { return this._scriptLog; }
    clearScriptLog(): void { this._scriptLog = []; }

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
            this.events.on('client.error', (message) => this.reportConnectionError(message)),
        ];

        this.setStatus('connecting');
        client.connect();
    }

    disconnect(): void {
        this.client?.disconnect();
    }

    echoCommand(text: string): void {
        if (!this.client || this.client.shouldEchoCommand()) {
            this.events.emit('message', `> ${text}`, 'echo', Date.now());
        }
    }

    send(text: string, echo = true): void {
        if (echo) this.echoCommand(text);
        if (!this.client) return;
        this.client.send(text);
    }

    sendGmcpRaw(message: string): void {
        this.client?.sendGmcpRaw(message);
    }

    sendMSDP(variable: string, values: string[]): boolean {
        return this.client?.sendMSDP(variable, values) ?? false;
    }

    sendSocket(data: string): boolean {
        return this.client?.sendSocket(data) ?? false;
    }

    feedTelnet(data: string): void {
        this.client?.feedTelnet(data);
    }

    /** Mudlet `addSupportedTelnetOption(option)`. Forwards to the live
     *  MudClient when one is attached so the option will be auto-negotiated
     *  on the next IAC WILL/DO from the server. Returns false when no client
     *  is wired up yet. */
    addSupportedTelnetOption(option: number): boolean {
        return this.client?.addSupportedTelnetOption(option) ?? false;
    }

    /** Updates both the active client (if any) and the stored options so the
     *  setting survives a reconnect. */
    setPromptTimeoutMs(ms: number): void {
        this.options.promptTimeoutMs = ms;
        this.client?.setPromptTimeoutMs(ms);
    }

    getPromptTimeoutMs(): number | null {
        return this.client?.getPromptTimeoutMs() ?? this.options.promptTimeoutMs ?? null;
    }

    /** Update the telnet protocol toggles applied on the next connect.
     *  Mid-session changes do not retroactively renegotiate — the values are
     *  read by MudClient's constructor, so the next dial sees them. */
    setProtocolOptions(opts: { gmcpEnabled?: boolean; mttsEnabled?: boolean; msdpEnabled?: boolean; charsetEnabled?: boolean; mspEnabled?: boolean }): void {
        if (opts.gmcpEnabled !== undefined) this.options.gmcpEnabled = opts.gmcpEnabled;
        if (opts.mttsEnabled !== undefined) this.options.mttsEnabled = opts.mttsEnabled;
        if (opts.msdpEnabled !== undefined) this.options.msdpEnabled = opts.msdpEnabled;
        if (opts.charsetEnabled !== undefined) this.options.charsetEnabled = opts.charsetEnabled;
        if (opts.mspEnabled !== undefined) this.options.mspEnabled = opts.mspEnabled;
    }

    private teardownClient(): void {
        for (const unsub of this.stateUnsubs) unsub();
        this.stateUnsubs = [];
        this.pingTracker?.destroy();
        this.pingTracker = null;
        this.client?.disconnect();
        this.client = null;
    }

    get destroyed(): boolean { return this._destroyed; }

    /** Release resources that live outside the JS heap. In-memory state (maps,
     *  arrays, sub-managers) is reclaimed by GC once the instance is dropped, so
     *  this only handles the three things that don't self-clean: the WebSocket
     *  + ping timer (via `teardownClient`), Web Audio nodes, and any EventBus
     *  listeners with an AbortSignal cleanup still pending. Idempotent. */
    destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        // Persist any pending map view changes (e.g. a just-changed per-area
        // zoom) before tearing down. The save is async but the worker + IDB
        // outlive this instance, so an in-app close still completes it.
        this.windows.flushMapSave();
        this.teardownClient();
        this.sounds.destroy();
        this.videos.destroy();
        this.events.clear();
    }

    private setStatus(status: SessionStatus): void {
        this._status = status;
        this.events.emit('status', status);
    }

    private setPing(duration: number | null): void {
        this._ping = duration;
        this.events.emit('ping', duration);
    }

    private reportConnectionError(message: string): void {
        const text = `[connection error] ${message}`;
        this.events.emit('message', text, 'error', Date.now());
        this.events.emit('script.log', text, 'error');
    }
}
