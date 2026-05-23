import { EventBus } from "../../core/EventBus";
import { AnsiAwareBuffer } from "../text/FormatState";
import { createPassthroughProcessor, type ChunkProcessor } from "../triggers/ChunkProcessor";
import {
    createGmcpStream,
    createTelnetOptionParser,
    EchoHandler,
    encodeGmcp,
    encodeGmcpRaw,
    GMCP_DO,
    GMCP_WILL,
    MccpHandler,
    stripTelnetSequences,
    TELNET_GA,
    TELNET_EOR,
} from "../protocol";
import type { MudClientEvents } from "../events";

export type { MudClientEvents } from "../events";

export interface MudClientOptions {
    url: string;
    mccpEnabled?: boolean;
    commandEcho?: boolean;
    chunkProcessor?: ChunkProcessor;
    /** Milliseconds to hold a partial trailing line (text after the last `\n`)
     *  before flushing it as a prompt. Mirrors Mudlet's "Network packet timeout"
     *  preference; defaults to 300ms. Once a server has sent IAC GA or IAC EOR
     *  at least once, the client latches into "GA-driver" mode and bypasses
     *  buffering entirely, making this value moot. */
    promptTimeoutMs?: number;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 300;

export class MudClient {
    private socket!: WebSocket;
    private readonly eventBus: EventBus<MudClientEvents>;
    private readonly chunkProcessor: ChunkProcessor;
    private messageBuffer: { text: string; type: string }[] = [];
    private readonly gmcpStream: (data: string) => void;
    private readonly telnetOptionHandler: (optionData: string) => string;
    private readonly mccpHandler: MccpHandler;
    private readonly echoHandler: EchoHandler;
    private readonly url: string;
    /** Buffers the start of a subnegotiation that arrived without its closing IAC SE. */
    private pendingSubneg = "";
    /** Streaming UTF-8 decoder for the text stream after telnet sequences are stripped.
     *  Holds trailing partial multi-byte chars across WebSocket frames. */
    private textDecoder = new TextDecoder('utf-8', { fatal: false });
    /** Trailing text (after the last `\n`) held back from rendering until either
     *  the next frame supplies the rest of the line, a prompt marker arrives, or
     *  the idle-flush timer fires. Prevents spurious line breaks when a long MUD
     *  line is split across multiple WebSocket frames. */
    private pendingLineTail = "";
    private pendingTailTimer: number | null = null;
    private promptTimeoutMs: number;
    /** Set true once the server has sent IAC GA / IAC EOR at least once. From
     *  then on, partial-line buffering is bypassed — matches Mudlet's
     *  `mGA_Driver` latch in `cTelnet::gotRest`. */
    private gaDriver = false;
    /** True once the WebSocket handshake has completed; used to differentiate
     *  "failed to connect" from "connection lost mid-session" in close events. */
    private opened = false;

    commandEcho: boolean;

    constructor(
        {
            url,
            mccpEnabled = true,
            commandEcho = true,
            chunkProcessor,
            promptTimeoutMs = DEFAULT_PROMPT_TIMEOUT_MS,
        }: MudClientOptions,
        eventBus: EventBus<MudClientEvents>,
    ) {
        this.url = url;
        this.commandEcho = commandEcho;
        this.eventBus = eventBus;
        this.chunkProcessor = chunkProcessor ?? createPassthroughProcessor();
        this.promptTimeoutMs = clampPromptTimeout(promptTimeoutMs);

        this.gmcpStream = createGmcpStream({
            onEnvelope: ({ path, value }) => {
                (this.eventBus.emit as (event: string, ...args: unknown[]) => void)(`gmcp.${path}`, value);
                this.eventBus.emit('gmcp', { path, value });
            },
            onMessage: (text, type) => {
                this.messageBuffer.push({ text, type });
            },
        });

        this.telnetOptionHandler = createTelnetOptionParser(this.gmcpStream);
        this.mccpHandler = new MccpHandler((data) => this.sendRaw(data));
        this.mccpHandler.enabled = mccpEnabled;

        this.echoHandler = new EchoHandler(
            (data) => this.sendRaw(data),
            (serverEchoing) => this.eventBus.emit('telnet.echo', serverEchoing),
        );

        addEventListener('beforeunload', (event) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                event.preventDefault();
            }
        });
    }

    setMccpEnabled(enabled: boolean): void {
        this.mccpHandler.enabled = enabled;
    }

    isMccpEnabled(): boolean {
        return this.mccpHandler.enabled;
    }

    setPromptTimeoutMs(ms: number): void {
        this.promptTimeoutMs = clampPromptTimeout(ms);
    }

    getPromptTimeoutMs(): number {
        return this.promptTimeoutMs;
    }

    connect(): void {
        if (this.socket) {
            this.socket.onmessage = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onopen = null;
        }
        this.mccpHandler.reset();
        this.echoHandler.reset();
        this.textDecoder = new TextDecoder('utf-8', { fatal: false });
        this.pendingLineTail = "";
        this.gaDriver = false;
        this.clearTailTimer();

        try {
            this.socket = new WebSocket(this.url);

            this.socket.onmessage = (event: MessageEvent<string>) => {
                try {
                    if (event.data.length === 0) return;
                    const decodedData = atob(event.data);
                    const data = this.mccpHandler.processData(decodedData);
                    if (data.includes(GMCP_WILL)) {
                        this.sendRaw(GMCP_DO);
                        this.eventBus.emit('gmcp.negotiated');
                    }
                    this.echoHandler.processData(data);
                    this.eventBus.emit('socket.incoming', data);
                    try {
                        this.processIncomingData(data);
                    } catch (processingError) {
                        console.error('Error during data processing:', processingError);
                    }
                } catch (error) {
                    console.error('Error processing incoming message:', error);
                }
            };

            this.socket.onerror = (error: Event) => {
                this.eventBus.emit('error', error);
            };

            this.socket.onclose = (event: CloseEvent) => {
                this.flushPendingLineTail(Date.now());
                this.eventBus.emit('close', event);
                if (isAbnormalClose(event)) {
                    this.eventBus.emit('client.error', formatCloseError(event, this.opened));
                }
                this.eventBus.emit('client.disconnect');
                this.opened = false;
                this.mccpHandler.reset();
                this.echoHandler.reset();
                this.pendingSubneg = "";
                this.pendingLineTail = "";
                this.clearTailTimer();
            };

            this.socket.onopen = (event: Event) => {
                this.opened = true;
                this.eventBus.emit('open', event);
                this.eventBus.emit('client.connect');
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.eventBus.emit('error', error);
            this.eventBus.emit('client.error', `Failed to open WebSocket: ${message}`);
        }
    }

    disconnect(): void {
        if (!this.socket) return;
        const socket = this.socket;
        // Null handlers first so a delayed onclose (server doesn't ACK the
        // close frame — happens with Cloudflare tunnels and unresponsive
        // servers) doesn't re-fire the cleanup after we've already
        // synthesized it below.
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onopen = null;
        const state = socket.readyState;
        if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
            socket.close();
        }
        this.flushPendingLineTail(Date.now());
        this.eventBus.emit('client.disconnect');
        this.opened = false;
        this.mccpHandler.reset();
        this.echoHandler.reset();
        this.pendingSubneg = '';
        this.pendingLineTail = '';
        this.clearTailTimer();
    }

    isSocketOpen(): boolean {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    isPasswordMode(): boolean {
        return this.isSocketOpen() && this.echoHandler.serverEchoing;
    }

    shouldEchoCommand(): boolean {
        if (!this.isSocketOpen()) return true;
        return !this.echoHandler.serverEchoing && this.commandEcho;
    }

    send(message: string): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        if (!this.echoHandler.serverEchoing) {
            this.eventBus.emit('socket.outgoing', message);
        }
        try {
            this.socket.send(btoa(message + "\r\n"));
        } catch (error) {
            console.error('Error sending message:', error);
            this.eventBus.emit('error', error);
        }
    }

    private sendRaw(data: string): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        try {
            this.socket.send(btoa(data));
        } catch (error) {
            console.error('Error sending raw data:', error);
        }
    }

    sendGmcp(path: string, payload: unknown = {}): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        try {
            this.socket.send(btoa(encodeGmcp(path, payload)));
        } catch (error) {
            console.error('Error sending GMCP message:', error);
            this.eventBus.emit('error', error);
        }
    }

    sendGmcpRaw(message: string): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        try {
            this.socket.send(btoa(encodeGmcpRaw(message)));
        } catch (error) {
            console.error('Error sending GMCP message:', error);
            this.eventBus.emit('error', error);
        }
    }

    output(text?: string | AnsiAwareBuffer, type?: string, timestamp?: number): void {
        const ts = typeof timestamp === 'number' ? timestamp : Date.now();
        this.eventBus.emit('message', text, type, ts);
    }

    /** Push a line directly into the message buffer for trigger processing + rendering via flushLines. */
    pushLine(text: string, type: string): void {
        this.messageBuffer.push({ text, type });
    }

    /** Converts a Latin-1 byte-string (from atob) into a UTF-8 decoded string,
     *  buffering any trailing partial multi-byte sequence for the next frame. */
    private decodeUtf8(byteString: string): string {
        if (byteString.length === 0) return '';
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i) & 0xff;
        }
        return this.textDecoder.decode(bytes, { stream: true });
    }

    private processIncomingData(rawData: string, timestamp?: number): void {
        const data = this.pendingSubneg + rawData;
        this.pendingSubneg = "";

        const incompleteAt = findIncompleteSubnegStart(data);
        let processable = data;
        if (incompleteAt !== -1) {
            this.pendingSubneg = data.substring(incompleteAt);
            processable = data.substring(0, incompleteAt);
        }

        const hasPrompt = processable.includes(TELNET_GA) || processable.includes(TELNET_EOR);
        const sanitized = stripTelnetSequences(processable, this.telnetOptionHandler).replace(/\r/g, '');
        const decoded = this.decodeUtf8(sanitized);
        const ts = typeof timestamp === 'number' ? timestamp : Date.now();

        if (debugFramesEnabled() && decoded.length > 0) {
            const endsWithNl = decoded.endsWith('\n');
            const tail = decoded.slice(-40).replace(/\n/g, '\\n').replace(/\x1B/g, '\\e');
            const head = decoded.slice(0, 40).replace(/\n/g, '\\n').replace(/\x1B/g, '\\e');
            // eslint-disable-next-line no-console
            console.debug(
                `[mudix.frame] bytes=${rawData.length} chars=${decoded.length} endsWithNl=${endsWithNl} hasPrompt=${hasPrompt}\n  head: ${JSON.stringify(head)}\n  tail: ${JSON.stringify(tail)}`,
            );
        }

        if (decoded.length > 0) {
            this.clearTailTimer();
            if (this.gaDriver) {
                // Server reliably signals prompts via IAC GA/EOR — emit chunks
                // verbatim, matching Mudlet's `mGA_Driver` fast path.
                this.chunkProcessor.processChunk(decoded, ts, this);
            } else {
                const combined = this.pendingLineTail + decoded;
                const lastNl = combined.lastIndexOf('\n');
                if (lastNl === -1) {
                    this.pendingLineTail = combined;
                } else {
                    const ready = combined.substring(0, lastNl + 1);
                    this.pendingLineTail = combined.substring(lastNl + 1);
                    this.chunkProcessor.processChunk(ready, ts, this);
                }
            }
        }

        if (hasPrompt) {
            this.flushPendingLineTail(ts);
            this.gaDriver = true;
            this.eventBus.emit('prompt');
        } else if (this.pendingLineTail.length > 0) {
            this.scheduleTailFlush();
        }

        this.flushMessageBuffer();
    }

    /** Flush a held-back partial line (text after the final `\n` of a frame).
     *  Triggered by prompt markers (IAC GA/EOR), the idle-flush timer, or
     *  socket close. Pushes the tail through the normal chunk path so triggers
     *  and rendering treat it as a complete line. */
    private flushPendingLineTail(ts: number): void {
        this.clearTailTimer();
        if (this.pendingLineTail.length === 0) return;
        const tail = this.pendingLineTail;
        this.pendingLineTail = "";
        this.chunkProcessor.processChunk(tail, ts, this);
    }

    private scheduleTailFlush(): void {
        if (this.pendingTailTimer !== null) return;
        this.pendingTailTimer = window.setTimeout(() => {
            this.pendingTailTimer = null;
            if (this.pendingLineTail.length === 0) return;
            this.flushPendingLineTail(Date.now());
            this.flushMessageBuffer();
        }, this.promptTimeoutMs);
    }

    private clearTailTimer(): void {
        if (this.pendingTailTimer !== null) {
            clearTimeout(this.pendingTailTimer);
            this.pendingTailTimer = null;
        }
    }

    flushMessageBuffer(): void {
        if (this.messageBuffer.length === 0) return;

        const groups: { text: string; type: string }[] = [];
        let currentType: string | null = null;
        let currentText = '';

        for (const message of this.messageBuffer) {
            if (message.type === currentType) {
                currentText += message.text;
            } else {
                if (currentType !== null) {
                    groups.push({ text: currentText, type: currentType });
                }
                currentType = message.type;
                currentText = message.text;
            }
        }
        if (currentType !== null) {
            groups.push({ text: currentText, type: currentType });
        }

        this.messageBuffer = [];
        this.eventBus.emit('flushLines', groups);
    }
}

/**
 * 1000 = normal closure, 1005 = no status received (treat as normal when wasClean).
 * Anything else, or `wasClean=false`, is something the user should know about.
 */
function isAbnormalClose(event: CloseEvent): boolean {
    if (!event.wasClean) return true;
    return event.code !== 1000 && event.code !== 1005;

}

function formatCloseError(event: CloseEvent, wasOpened: boolean): string {
    const reason = event.reason?.trim();
    if (reason) return reason;
    if (event.code === 1006) {
        return wasOpened
            ? 'Connection lost (no close frame received from server)'
            : 'Failed to connect (proxy unreachable, blocked, or refused the connection)';
    }
    return wasOpened
        ? `Connection closed (code ${event.code})`
        : `Failed to connect (code ${event.code})`;
}

/**
 * Keep prompt-flush timeouts in a sane range. 0 disables the safety net (only
 * a real GA/EOR or the next chunk's newline will flush a partial tail) — handy
 * for tests but risky for GA-less MUDs. The upper bound stops a typo from
 * stalling output for minutes.
 */
function clampPromptTimeout(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) return DEFAULT_PROMPT_TIMEOUT_MS;
    return Math.min(ms, 5000);
}

/**
 * Diagnostic gate — enable via `localStorage.setItem('mudix.debugFrames', '1')`
 * in the browser console to log WebSocket frame boundaries for the MUD stream.
 * Used to investigate "extra line break" issues that surface when long MUD
 * lines arrive split across multiple WebSocket frames.
 */
function debugFramesEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('mudix.debugFrames') === '1';
    } catch {
        return false;
    }
}

/**
 * Returns the index of the first IAC SB that has no matching IAC SE later in
 * the string, or -1 if every subnegotiation is complete.
 * Used to detect subnegotiations split across WebSocket frames.
 */
function findIncompleteSubnegStart(data: string): number {
    const IAC = 0xFF;
    const SB  = 0xFA;
    const SE  = 0xF0;
    let i = 0;
    while (i < data.length - 1) {
        if (data.charCodeAt(i) === IAC && data.charCodeAt(i + 1) === SB) {
            // Found start of subneg — scan forward for IAC SE
            let j = i + 2;
            let found = false;
            while (j < data.length - 1) {
                if (data.charCodeAt(j) === IAC && data.charCodeAt(j + 1) === SE) {
                    found = true;
                    i = j + 2;
                    break;
                }
                j++;
            }
            if (!found) return i;
        } else {
            i++;
        }
    }
    return -1;
}
