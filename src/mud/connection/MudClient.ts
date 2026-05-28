import { EventBus } from "../../core/EventBus";
import { AnsiAwareBuffer } from "../text/FormatState";
import { createPassthroughProcessor, type ChunkProcessor } from "../triggers/ChunkProcessor";
import {
    createGmcpStream,
    createMsdpStream,
    createTelnetOptionParser,
    EchoHandler,
    encodeGmcp,
    encodeGmcpRaw,
    encodeMsdp,
    GMCP_COMMAND_CODE,
    GMCP_DO,
    GMCP_WILL,
    MccpHandler,
    MSDP_COMMAND_CODE,
    MSDP_DO,
    MSDP_WILL,
    stripTelnetSequences,
    TELNET_GA,
    TELNET_EOR,
    TTYPE_COMMAND_CODE,
    TTYPE_DO,
    TTYPE_WILL,
    TTYPE_IS,
    TTYPE_SEND,
    OPT_TTYPE,
    GMCP_IAC,
    GMCP_SB,
    GMCP_SE,
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

/** Converts raw bytes into a Latin-1 byte-string (charCode === byte for 0..255),
 *  exactly what atob() used to yield for the downstream telnet/MCCP pipeline.
 *  NB: TextDecoder('latin1') is *not* equivalent — that label maps to
 *  windows-1252 and mangles bytes 0x80–0x9F, so we map by hand. Chunked to stay
 *  within String.fromCharCode's argument limit on large frames. */
function bytesToLatin1(bytes: Uint8Array): string {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return binary;
}

export class MudClient {
    private socket!: WebSocket;
    private readonly eventBus: EventBus<MudClientEvents>;
    private readonly chunkProcessor: ChunkProcessor;
    private messageBuffer: { text: string; type: string }[] = [];
    private readonly gmcpStream: (data: string) => void;
    private readonly msdpStream: (data: string) => void;
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
    /** MTTS cycle position. The server issues SB TTYPE SEND repeatedly; we walk
     *  through client name (0), terminal type (1), then the MTTS bitvector (2+).
     *  Reset on each connect(). */
    private ttypeStep = 0;
    /** Mudlet `addSupportedTelnetOption(option)` registry. On IAC WILL <opt>
     *  we reply IAC DO <opt>; on IAC DO <opt> we reply IAC WILL <opt>. Options
     *  already negotiated inline (GMCP/MSDP/TTYPE) are excluded — they have
     *  their own response logic. */
    private readonly supportedTelnetOptions = new Set<number>();
    /** Per-incoming-frame index of which IAC sequences we've already announced
     *  via `telnet.event`. Telnet sequences can repeat across frames (the same
     *  option byte appears in multiple WILL/DO commands), so we only suppress
     *  duplicates within a single frame to avoid event storms. */
    private telnetEventSeen = new Set<number>();

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

        this.msdpStream = createMsdpStream({
            onEnvelope: ({ path, value }) => {
                (this.eventBus.emit as (event: string, ...args: unknown[]) => void)(`msdp.${path}`, value);
                this.eventBus.emit('msdp', { path, value });
            },
        });

        // A telnet subnegotiation body opens with its option code; route GMCP
        // (201) and MSDP (69) to their respective parsers and ignore the rest.
        this.telnetOptionHandler = createTelnetOptionParser((subneg) => {
            const code = subneg.charCodeAt(0);
            if (code === GMCP_COMMAND_CODE) this.gmcpStream(subneg);
            else if (code === MSDP_COMMAND_CODE) this.msdpStream(subneg);
            else if (code === TTYPE_COMMAND_CODE) this.respondTerminalType(subneg);
        });
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

    /** Mudlet `addSupportedTelnetOption(option)`. Marks the telnet option byte
     *  (0..255) as one the client will accept: on the next IAC WILL <opt> we
     *  reply IAC DO <opt>; on IAC DO <opt> we reply IAC WILL <opt>. Hardcoded
     *  options (GMCP=201, MSDP=69, TTYPE=24) already negotiate inline and
     *  don't need to be registered. Returns true if the option was newly
     *  added, false if it was already present. */
    addSupportedTelnetOption(option: number): boolean {
        if (!Number.isFinite(option)) return false;
        const opt = Math.trunc(option) & 0xff;
        if (this.supportedTelnetOptions.has(opt)) return false;
        this.supportedTelnetOptions.add(opt);
        return true;
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
        this.ttypeStep = 0;
        this.clearTailTimer();

        try {
            this.socket = new WebSocket(this.url);
            // Receive raw binary frames instead of base64 text. The proxy worker
            // sends bytes directly; decoding base64 on every frame was the bulk
            // of its (and our) per-message CPU cost.
            this.socket.binaryType = "arraybuffer";

            this.socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
                try {
                    if (event.data.byteLength === 0) return;
                    const decodedData = bytesToLatin1(new Uint8Array(event.data));
                    const data = this.mccpHandler.processData(decodedData);
                    if (debugTelnetEnabled()) {
                        logTelnetNegotiation('raw', decodedData);
                        if (data !== decodedData) logTelnetNegotiation('post-mccp', data);
                    }
                    if (data.includes(GMCP_WILL)) {
                        // Server offers GMCP (IAC WILL GMCP) → we accept (IAC DO GMCP).
                        this.sendRaw(GMCP_DO);
                        this.eventBus.emit('gmcp.negotiated');
                    } else if (data.includes(GMCP_DO)) {
                        // Server requests we enable GMCP (IAC DO GMCP) → we accept
                        // (IAC WILL GMCP). Mirrors the MSDP handling below: telnet
                        // negotiation is symmetric, so handle both directions.
                        this.sendRaw(GMCP_WILL);
                        this.eventBus.emit('gmcp.negotiated');
                    }
                    if (data.includes(MSDP_WILL)) {
                        // Server offers MSDP (IAC WILL MSDP) → we accept (IAC DO MSDP).
                        this.sendRaw(MSDP_DO);
                        this.eventBus.emit('msdp.negotiated');
                    } else if (data.includes(MSDP_DO)) {
                        // Server requests we enable MSDP (IAC DO MSDP) → we accept
                        // (IAC WILL MSDP). Telnet negotiation is symmetric and many
                        // servers (e.g. Legends of Kallisti) start MSDP this way; without
                        // this branch we'd never reply and never fire msdp.negotiated.
                        this.sendRaw(MSDP_WILL);
                        this.eventBus.emit('msdp.negotiated');
                    }
                    if (data.includes(TTYPE_DO)) {
                        // Server asks us to identify our terminal (IAC DO TTYPE).
                        // Agree (IAC WILL TTYPE); the actual name/type/MTTS values
                        // follow via the SB TTYPE SEND subnegotiation handled in
                        // respondTerminalType(). Many MUDs (e.g. Kallisti) won't
                        // offer MSDP/GMCP until this handshake completes.
                        this.sendRaw(TTYPE_WILL);
                    }
                    this.scanTelnetOptions(data);
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
        // Idempotent on an already-torn-down socket. Without this, a second
        // disconnect() call — e.g. the Lua `disconnect` global re-entering via
        // a sysDisconnectionEvent handler, or teardownClient running after the
        // user clicked Disconnect — would re-emit `client.disconnect` and
        // re-enter the same chain. wasmoon's registry corrupts and the next
        // emitEvent crashes with an out-of-bounds wasm trap.
        const state = socket.readyState;
        if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) return;
        // Null handlers first so a delayed onclose (server doesn't ACK the
        // close frame — happens with Cloudflare tunnels and unresponsive
        // servers) doesn't re-fire the cleanup after we've already
        // synthesized it below.
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onopen = null;
        socket.close();
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
            this.sendBytes(message + "\r\n");
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
            this.sendBytes(data);
        } catch (error) {
            console.error('Error sending raw data:', error);
        }
    }

    /** Encodes a Latin-1 byte-string to raw bytes and sends it as a binary
     *  WebSocket frame. The proxy worker expects binary, not base64. */
    private sendBytes(payload: string): void {
        const bytes = new Uint8Array(payload.length);
        for (let i = 0; i < payload.length; i++) {
            bytes[i] = payload.charCodeAt(i) & 0xff;
        }
        this.socket.send(bytes);
    }

    sendGmcp(path: string, payload: unknown = {}): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        try {
            this.sendBytes(encodeGmcp(path, payload));
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
            this.sendBytes(encodeGmcpRaw(message));
        } catch (error) {
            console.error('Error sending GMCP message:', error);
            this.eventBus.emit('error', error);
        }
    }

    /** Mudlet `sendMSDP(variable, ...values)`. Frames + sends an MSDP
     *  subnegotiation. Returns false when the socket isn't open. */
    sendMSDP(variable: string, values: string[]): boolean {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this.sendBytes(encodeMsdp(variable, values));
            return true;
        } catch (error) {
            console.error('Error sending MSDP message:', error);
            this.eventBus.emit('error', error);
            return false;
        }
    }

    /** Walk a Latin-1 byte-string for IAC sequences, auto-respond to any
     *  WILL/DO whose option byte is in `supportedTelnetOptions`, and raise
     *  `telnet.event` for every WILL/WONT/DO/DONT/SB whose option isn't
     *  natively handled (the hardcoded GMCP/MSDP/TTYPE/MCCP/ECHO set). The
     *  Mudlet `sysTelnetEvent(type, option, message)` parity event is fired
     *  by ScriptingEngine from this signal.
     *
     *  `type` mirrors Mudlet's TLuaInterpreter mapping: 1=WILL, 2=WONT,
     *  3=DO, 4=DONT, 5=SB. */
    private scanTelnetOptions(data: string): void {
        this.telnetEventSeen.clear();
        const IAC = 0xFF;
        // Telnet command codes
        const SB = 0xFA, WILL = 0xFB, WONT = 0xFC, DO = 0xFD, DONT = 0xFE;
        // Options the client negotiates inline elsewhere — exclude from
        // sysTelnetEvent so handlers see only "everything else".
        const HARDCODED = new Set<number>([1 /* ECHO */, 24 /* TTYPE */, 69 /* MSDP */, 85 /* MCCP1 */, 86 /* MCCP2 */, 201 /* GMCP */]);
        for (let i = 0; i < data.length - 2; i++) {
            if (data.charCodeAt(i) !== IAC) continue;
            const cmd = data.charCodeAt(i + 1);
            if (cmd !== WILL && cmd !== WONT && cmd !== DO && cmd !== DONT && cmd !== SB) continue;
            const opt = data.charCodeAt(i + 2);
            // Auto-negotiate registered options. SB carries data so we don't
            // mirror it; for the four negotiation commands we accept WILL/DO
            // for supported options.
            if (this.supportedTelnetOptions.has(opt)) {
                if (cmd === WILL) this.sendRaw(String.fromCharCode(IAC, DO,   opt));
                if (cmd === DO)   this.sendRaw(String.fromCharCode(IAC, WILL, opt));
            }
            if (HARDCODED.has(opt) || this.supportedTelnetOptions.has(opt)) continue;
            // Dedupe within this frame so a server that spams the same option
            // doesn't flood handlers.
            const key = (cmd << 8) | opt;
            if (this.telnetEventSeen.has(key)) continue;
            this.telnetEventSeen.add(key);
            const typeNum = cmd === WILL ? 1 : cmd === WONT ? 2 : cmd === DO ? 3 : cmd === DONT ? 4 : 5;
            const cmdName = cmd === WILL ? 'WILL' : cmd === WONT ? 'WONT' : cmd === DO ? 'DO' : cmd === DONT ? 'DONT' : 'SB';
            this.eventBus.emit('telnet.event', typeNum, opt, `IAC ${cmdName} ${opt}`);
        }
    }

    /** Reply to a TERMINAL-TYPE / MTTS subnegotiation. `subneg` is the SB body
     *  with the option byte (24) at [0]; [1] is the request kind (1 = SEND). We
     *  answer `IAC SB TTYPE IS <value> IAC SE`, cycling client name → terminal
     *  type → MTTS capability bitvector on successive SENDs, then repeating the
     *  last value to signal the list is exhausted (RFC 1091 + the MTTS standard). */
    private respondTerminalType(subneg: string): void {
        if (subneg.charCodeAt(1) !== TTYPE_SEND.charCodeAt(0)) return; // only handle SEND
        // MTTS bits we advertise: ANSI(1) + UTF-8(4) + 256 COLORS(8) + TRUECOLOR(256) = 269.
        const cycle = ['Mudix', 'XTERM-256COLOR', 'MTTS 269'];
        const value = cycle[Math.min(this.ttypeStep, cycle.length - 1)];
        if (this.ttypeStep < cycle.length - 1) this.ttypeStep++;
        this.sendRaw(GMCP_IAC + GMCP_SB + OPT_TTYPE + TTYPE_IS + value + GMCP_IAC + GMCP_SE);
    }

    /** Mudlet `sendSocket(data)`. Sends literal bytes over the socket with no
     *  telnet/encoding processing (each char becomes one byte). Returns false
     *  when the socket isn't open. */
    sendSocket(data: string): boolean {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this.sendBytes(data);
            return true;
        } catch (error) {
            console.error('Error in sendSocket:', error);
            this.eventBus.emit('error', error);
            return false;
        }
    }

    /** Mudlet `feedTelnet(data)`. Injects raw bytes into the inbound pipeline
     *  as if they had arrived from the server — they pass through telnet
     *  stripping, ANSI parsing, the trigger pipeline, and rendering. `data` is
     *  treated as a Latin-1 byte-string (matching incoming-frame handling). */
    feedTelnet(data: string): void {
        this.processIncomingData(data);
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
 * Diagnostic gate — enable via `localStorage.setItem('mudix.debugTelnet', '1')`
 * in the browser console to log every telnet command/subnegotiation byte seen
 * on each incoming frame. Used to investigate protocol-negotiation issues
 * (GMCP/MSDP/MCCP not enabling) by revealing exactly what the server sends.
 */
function debugTelnetEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('mudix.debugTelnet') === '1';
    } catch {
        return false;
    }
}

const TELNET_CMD_NAMES: Record<number, string> = {
    239: 'EOR', 240: 'SE', 241: 'NOP', 249: 'GA', 250: 'SB',
    251: 'WILL', 252: 'WONT', 253: 'DO', 254: 'DONT',
};
const TELNET_OPT_NAMES: Record<number, string> = {
    1: 'ECHO', 3: 'SGA', 24: 'TTYPE', 25: 'EOR', 31: 'NAWS', 32: 'TSPEED',
    69: 'MSDP', 70: 'MSSP', 85: 'MCCP1', 86: 'MCCP2', 90: 'MSP', 91: 'MXP',
    93: 'ZMP', 201: 'GMCP', 255: 'IAC',
};

/** Scan a Latin-1 byte-string for telnet IAC sequences and log them in
 *  human-readable form. Logs SB option codes too (e.g. `SB GMCP` / `SB MSDP`). */
function logTelnetNegotiation(label: string, s: string): void {
    const seqs: string[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) !== 0xFF) continue; // not IAC
        const cmd = s.charCodeAt(i + 1);
        if (cmd === 250) { // SB <opt> ... — just name the option
            const opt = s.charCodeAt(i + 2);
            seqs.push(`SB ${TELNET_OPT_NAMES[opt] ?? opt}`);
        } else if (cmd >= 251 && cmd <= 254) { // WILL/WONT/DO/DONT <opt>
            const opt = s.charCodeAt(i + 2);
            seqs.push(`${TELNET_CMD_NAMES[cmd]} ${TELNET_OPT_NAMES[opt] ?? opt}`);
        } else if (TELNET_CMD_NAMES[cmd]) {
            seqs.push(TELNET_CMD_NAMES[cmd]);
        }
    }
    // eslint-disable-next-line no-console
    console.debug(`[mudix.telnet ${label}] bytes=${s.length}`,
        seqs.length ? seqs.join(' | ') : '(no IAC sequences)');
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
