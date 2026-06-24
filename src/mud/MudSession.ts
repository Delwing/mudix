import { EventBus } from '../core/EventBus';
import { WindowManager } from '../ui/windows/WindowManager';
import { LabelManager } from '../ui/labels/LabelManager';
import { CommandLineManager } from '../ui/cmdline/CommandLineManager';
import { ScrollBoxManager } from '../ui/scrollbox/ScrollBoxManager';
import { SoundManager } from '../ui/sound/SoundManager';
import { VideoManager } from '../ui/video/VideoManager';
import { CmdLineMenuRegistry } from '../ui/CmdLineMenuRegistry';
import { MouseEventRegistry } from '../ui/MouseEventRegistry';
import { MudClient, type MudClientOptions, SUPPORTED_SERVER_ENCODINGS } from './connection/MudClient';
import { PingTracker } from './connection/PingTracker';
import { type MudClientEvents, type MudEvents, type SessionStatus } from './events';
import type { Console } from './text/Console';
import { mxpColor } from './text/colorParsers';

export type { SessionStatus, MudEvents } from './events';

export type MudSessionOptions = Omit<MudClientOptions, 'url'>;

/** Mudlet `showSentText` modes — controls local echo of commands you send.
 *  `never`: never echo. `script`: echo unless a script passes `send(cmd, false)`
 *  (the default). `always`: echo even when a script passes `send(cmd, false)`. */
export type ShowSentTextMode = 'never' | 'script' | 'always';

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
    readonly scrollBoxes = new ScrollBoxManager();
    readonly sounds = new SoundManager();
    readonly videos = new VideoManager();
    readonly cmdLineMenu = new CmdLineMenuRegistry();
    readonly mouseEvents = new MouseEventRegistry();
    /** Per-window Console instances. 'main' registered by ScriptingAPI; named windows by WindowManager. */
    readonly consoles = new Map<string, Console>();
    private client: MudClient | null = null;
    /** The most recent URL passed to connect() — replayed by reconnect(). */
    private lastUrl: string | null = null;
    private pingTracker: PingTracker | null = null;
    private stateUnsubs: (() => void)[] = [];
    private _status: SessionStatus = 'disconnected';
    private _ping: number | null = null;
    private _outputReady = false;
    private _destroyed = false;
    /** Latest main output area character grid (columns × rows), tracked here so
     *  it survives client teardown and seeds a freshly-created client on the
     *  next connect(). Fed by the WindowManager's main-console resize callback
     *  and forwarded to the live client for NAWS (telnet option 31). */
    private windowSize: { cols: number; rows: number } | null = null;

    /** Colors for the local echo of sent commands. Re-applied from the active
     *  profile by ProfileSession. `fg` defaults to Mudlet's olive; `bg` empty =
     *  no background. Consumed by echoCommand() to wrap the echo in ANSI. */
    commandEchoColor: { fg: string; bg: string } = { fg: '#717100', bg: '' };

    /** Mudlet `setConfig("showSentText", ...)`. Controls local echo of sent
     *  commands (the server-side ECHO suppression in `shouldEchoCommand` still
     *  applies independently). `script` (the default) echoes only when send()'s
     *  `echo` flag is set, so scripts can suppress per command via
     *  `send(cmd, false)`; `always` echoes even then; `never` never echoes.
     *  Toggled live by the config registry in ScriptingAPI. */
    showSentText: ShowSentTextMode = 'script';

    /** Bounded script.log buffer so the editor panel can backfill entries that
     *  arrived before it was first opened (e.g. errors during initial load). */
    private static readonly SCRIPT_LOG_LIMIT = 500;
    private _scriptLog: ScriptLogEntry[] = [];

    private readonly options: MudSessionOptions;

    constructor(options: MudSessionOptions = {}) {
        this.options = { ...options };
        this.windows.setConsoleRegistry(this.consoles);
        // The main output area reports its character grid here on every resize;
        // forward it to the client so NAWS (window size) stays in sync.
        this.windows.onMainConsoleResize = (cols, rows) => this.setWindowSize(cols, rows);
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
        this.lastUrl = url;
        this.teardownClient();
        const client = new MudClient({ url, ...this.options }, this.events as EventBus<MudClientEvents>);
        this.client = client;
        // Seed the fresh client with the last known window size so NAWS reports
        // the right grid as soon as the server negotiates it.
        if (this.windowSize) client.setWindowSize(this.windowSize.cols, this.windowSize.rows);

        this.pingTracker = new PingTracker(
            // Canonical GMCP: `Core.Ping` (PascalCase) with no body. sendGmcp
            // would append a JSON body (`core.ping {}`), which is non-standard —
            // the spec's request is a bare name (optionally a latency number).
            () => client.sendGmcpRaw('Core.Ping'),
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

    /** Whether a send() carrying the given per-call `echo` flag should produce a
     *  local echo, under the current showSentText mode. `script` defers to the
     *  flag; `always`/`never` ignore it. */
    private shouldEchoSentText(echo: boolean): boolean {
        if (this.showSentText === 'never') return false;
        if (this.showSentText === 'always') return true;
        return echo; // 'script'
    }

    echoCommand(text: string): void {
        if (this.showSentText === 'never') return;
        if (!this.client || this.client.shouldEchoCommand()) {
            // No "> " prefix: Mudlet echoes the bare command, and OutputRenderer
            // appends it inline to the open server prompt line (e.g. "- look").
            this.events.emit('message', this.styleEchoCommand(text), 'echo', Date.now());
        }
    }

    /** Wrap the echoed command in ANSI truecolor escapes from commandEchoColor
     *  so it renders in the configured foreground (and optional background). */
    private styleEchoCommand(text: string): string {
        const fg = mxpColor(this.commandEchoColor.fg);
        const bg = this.commandEchoColor.bg ? mxpColor(this.commandEchoColor.bg) : null;
        let prefix = '';
        if (fg && fg.space === 'rgb') prefix += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`;
        if (bg && bg.space === 'rgb') prefix += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
        return prefix ? `${prefix}${text}\x1b[0m` : text;
    }

    send(text: string, echo = true): void {
        if (this.shouldEchoSentText(echo)) this.echoCommand(text);
        if (!this.client) return;
        this.client.send(text);
    }

    /** Send credentials/secrets that must NEVER be echoed locally — regardless of
     *  the showSentText mode (including `always`) or the server-echo state. Used
     *  for auto-login passwords. The normal `send(text, false)` only suppresses
     *  the echo in `script` mode; `always` would override it, so a password must
     *  take this path instead of relying on the per-call echo flag. */
    sendSecret(text: string): void {
        if (!this.client) return;
        this.client.send(text);
    }

    sendGmcpRaw(message: string): void {
        this.client?.sendGmcpRaw(message);
    }

    /** Reply to a GMCP `Char.Login.Default` request. Pass an account + password
     *  to authenticate, or no arguments to send the empty "fall back to text
     *  login" reply (the credentials popup's Cancel). The password is relayed
     *  straight to the wire and never persisted. */
    sendCharLoginCredentials(account?: string, password?: string): void {
        this.client?.sendCharLoginCredentials(account, password);
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

    sendATCP(message: string): boolean {
        return this.client?.sendATCP(message) ?? false;
    }

    sendTelnetChannel102(msg: string): boolean {
        return this.client?.sendTelnetChannel102(msg) ?? false;
    }

    /** Mudlet `reconnect()`. Disconnect and redial the most recently connected
     *  URL (set by connect(), so it covers both the app and Lua connect paths).
     *  Returns false when nothing has been dialed yet. */
    reconnect(): boolean {
        if (!this.lastUrl) return false;
        this.connect(this.lastUrl);
        return true;
    }

    /** Mudlet `getServerEncoding()`. The live client's inbound decoder name;
     *  'utf-8' when no client is attached. */
    getServerEncoding(): string {
        return this.client?.getServerEncoding() ?? 'utf-8';
    }

    /** Mudlet `setServerEncoding(name)`. Returns false when no client is
     *  attached or the name isn't supported. */
    setServerEncoding(name: string): boolean {
        return this.client?.setServerEncoding(name) ?? false;
    }

    /** Mudlet `getServerEncodingsList()`. The fixed set of encodings mudix can
     *  decode — available even before a connection is dialed. */
    getServerEncodingsList(): string[] {
        return [...SUPPORTED_SERVER_ENCODINGS];
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

    /** Mudlet `setConfig("fixUnnecessaryLinebreaks", …)`. Updates the live client
     *  and the stored options so the setting survives a reconnect. */
    setFixUnnecessaryLinebreaks(enabled: boolean): void {
        this.options.fixUnnecessaryLinebreaks = enabled;
        this.client?.setFixUnnecessaryLinebreaks(enabled);
    }

    /** Update the telnet protocol toggles applied on the next connect.
     *  Mid-session changes do not retroactively renegotiate — the values are
     *  read by MudClient's constructor, so the next dial sees them. */
    setProtocolOptions(opts: { gmcpEnabled?: boolean; mttsEnabled?: boolean; msdpEnabled?: boolean; msspEnabled?: boolean; charsetEnabled?: boolean; mspEnabled?: boolean; mxpEnabled?: boolean; mnesEnabled?: boolean; nawsEnabled?: boolean }): void {
        if (opts.gmcpEnabled !== undefined) this.options.gmcpEnabled = opts.gmcpEnabled;
        if (opts.mttsEnabled !== undefined) this.options.mttsEnabled = opts.mttsEnabled;
        if (opts.msdpEnabled !== undefined) this.options.msdpEnabled = opts.msdpEnabled;
        if (opts.msspEnabled !== undefined) this.options.msspEnabled = opts.msspEnabled;
        if (opts.charsetEnabled !== undefined) this.options.charsetEnabled = opts.charsetEnabled;
        if (opts.mspEnabled !== undefined) this.options.mspEnabled = opts.mspEnabled;
        if (opts.mxpEnabled !== undefined) this.options.mxpEnabled = opts.mxpEnabled;
        if (opts.mnesEnabled !== undefined) this.options.mnesEnabled = opts.mnesEnabled;
        if (opts.nawsEnabled !== undefined) this.options.nawsEnabled = opts.nawsEnabled;
    }

    /** Record the main output area's character grid (columns × rows) and forward
     *  it to the live client for NAWS. Stored on the session so a client created
     *  on a later connect() is seeded with the current size. Called by the
     *  WindowManager whenever the main console's grid changes. */
    setWindowSize(cols: number, rows: number): void {
        this.windowSize = { cols, rows };
        this.client?.setWindowSize(cols, rows);
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
