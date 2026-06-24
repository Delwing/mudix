import { EventBus } from "../../core/EventBus";
import { AnsiAwareBuffer } from "../text/FormatState";
import { scanEscape } from "../text/ansiEscapes";
import { createPassthroughProcessor, type ChunkProcessor } from "../triggers/ChunkProcessor";
import {
    createGmcpStream,
    createMsdpStream,
    createMsspStream,
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
    MSSP_COMMAND_CODE,
    MSSP_DO,
    MSSP_WILL,
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
    OPT_ATCP,
    OPT_TELNET_102,
    CHARSET_COMMAND_CODE,
    CHARSET_WILL,
    CHARSET_DO,
    CHARSET_REQUEST,
    CHARSET_ACCEPTED,
    CHARSET_REJECTED,
    OPT_CHARSET,
    MSP_COMMAND_CODE,
    MSP_WILL,
    MSP_DO,
    MspParser,
    MXP_COMMAND_CODE,
    MXP_WILL,
    MXP_DO,
    NEW_ENVIRON_COMMAND_CODE,
    NEW_ENVIRON_DO,
    NEW_ENVIRON_WILL,
    NEW_ENVIRON_WONT,
    NEW_ENVIRON_USERVAR,
    NEW_ENVIRON_VAR,
    EOR_WILL,
    EOR_DO,
    SGA_WILL,
    SGA_DO,
    computeMtts,
    parseMnesRequest,
    encodeMnesIs,
    selectMnesVars,
    buildNewEnvironVars,
    CLIENT_VERSION,
    type MnesVar,
    NAWS_WILL,
    NAWS_DO,
    NAWS_DONT,
    encodeNaws,
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
     *  at least once, the client latches into "GA-driver" mode and the partial
     *  tail is flushed by the prompt marker instead of this timer — so the value
     *  only matters as an idle safety net (e.g. a line split across frames whose
     *  remainder never arrives). */
    promptTimeoutMs?: number;
    /** Whether to accept GMCP (telnet option 201) negotiation. Default true.
     *  When false, the client silently ignores IAC WILL/DO GMCP so the server
     *  never sees a positive ack and no GMCP envelopes flow. */
    gmcpEnabled?: boolean;
    /** Whether to accept TERMINAL-TYPE / MTTS (telnet option 24) negotiation.
     *  Default true. When false, IAC DO TTYPE is ignored so the server falls
     *  back to its non-MTTS code path. */
    mttsEnabled?: boolean;
    /** Whether to accept MSDP (telnet option 69) negotiation. Default false.
     *  When false, IAC WILL/DO MSDP is ignored and no MSDP envelopes flow. */
    msdpEnabled?: boolean;
    /** Whether to accept MSSP (telnet option 70) negotiation. Default true
     *  (matching Mudlet). When false, IAC WILL/DO MSSP is ignored and the
     *  server's status subnegotiation never arrives. */
    msspEnabled?: boolean;
    /** Whether to accept CHARSET (telnet option 42, RFC 2066) negotiation.
     *  Default true. When false, IAC WILL/DO CHARSET is ignored and the
     *  session stays on the UTF-8 baseline (so non-ASCII bytes from non-UTF-8
     *  MUDs render as replacement chars). */
    charsetEnabled?: boolean;
    /** Whether to enable MSP (MUD Sound Protocol, telnet option 90). Default
     *  false. When true the client negotiates the option and strips inline
     *  `!!SOUND(...)` / `!!MUSIC(...)` tags from MUD text, dispatching them
     *  as `msp` events. Always parses subnegotiations regardless of this flag
     *  once negotiated, but in-band parsing is gated to avoid eating literal
     *  text on MUDs that don't speak MSP. */
    mspEnabled?: boolean;
    /** Whether to accept MXP (telnet option 91) negotiation. Default true.
     *  When false, IAC WILL/DO MXP is ignored so the server never sees a
     *  positive ack and no in-band MXP markup is parsed (tags pass through as
     *  literal text). The actual tag parsing lives downstream in the scripting
     *  engine, gated on the `mxp.negotiated` event this client emits. */
    mxpEnabled?: boolean;
    /** Whether to answer telnet option 39 in MNES mode (Mud New-Environ
     *  Standard). Default false. When on, the client reports the five MNES core
     *  variables (CHARSET / CLIENT_NAME / CLIENT_VERSION / MTTS / TERMINAL_TYPE),
     *  framed as NEW_ENVIRON_VAR. MNES takes precedence over plain NEW-ENVIRON
     *  when both are enabled — matching Mudlet, which restricts the reported set
     *  to these five whenever MNES is active. */
    mnesEnabled?: boolean;
    /** Whether to answer telnet option 39 in plain NEW-ENVIRON mode (RFC 1572,
     *  "Client Variables Standard"). Default false. When on (and MNES off), the
     *  client reports the five core variables plus an extended capability set
     *  (ANSI, 256_COLORS, TRUECOLOR, UTF-8, TLS, WORD_WRAP, …), framed as
     *  NEW_ENVIRON_USERVAR. Mudlet exposes MNES and NEW-ENVIRON as two separate
     *  toggles over the same telnet option; mudix mirrors that. */
    newEnvironEnabled?: boolean;
    /** Whether the link to the *game server* is TLS-encrypted, reported as the
     *  NEW-ENVIRON `TLS` capability. Defaults to whether `url` is `wss://` — the
     *  correct answer for a direct websocket-mode connection. In proxy (`mud`)
     *  mode the caller passes `false` explicitly, because a `wss://` proxy URL
     *  only secures the browser↔proxy hop while the proxy↔MUD telnet socket is
     *  plaintext (see connectionSecureTransport). */
    secureTransport?: boolean;
    /** Whether to negotiate NAWS / window size (telnet option 31). Default true
     *  (matching Mudlet). When true the client offers IAC WILL NAWS on connect
     *  and, once the server accepts (IAC DO NAWS), reports the main output
     *  area's character grid (columns × rows) and re-sends it on every resize.
     *  When false the client never offers NAWS and ignores IAC DO NAWS. */
    nawsEnabled?: boolean;
    /** Mudlet's "Fix unnecessary linebreaks on GA servers"
     *  (`setConfig("fixUnnecessaryLinebreaks", …)`, host flag
     *  `mUSE_IRE_DRIVER_BUGFIX`). Default false. When true *and* the session is
     *  GA-driven, a single spurious leading newline is stripped from the start
     *  of each GA-terminated data block — the IRE-server bug Mudlet patches in
     *  `cTelnet::gotPrompt`. See {@link stripLeadingPromptNewline}. */
    fixUnnecessaryLinebreaks?: boolean;
    /** WebSocket subprotocols to advertise in the opening handshake's
     *  `Sec-WebSocket-Protocol` header (RFC 6455). Empty by default — we open a
     *  bare socket, which every server accepts. Set e.g.
     *  `['telnet.mudstandards.org']` to announce the mudstandards.org WebSocket
     *  profile we already speak (full telnet stream over BINARY frames). Opt-in
     *  because RFC 6455 lets a server *fail the handshake* on an unrecognized
     *  subprotocol — many existing MUD WebSocket endpoints ignore the header, but
     *  stricter ones reject it. The server's selection is read back from
     *  `socket.protocol` on open and emitted via `client.subprotocol`. */
    subprotocols?: string[];
}

const DEFAULT_PROMPT_TIMEOUT_MS = 300;

/** The WebSocket subprotocol name for the mudstandards.org "full telnet stream
 *  over binary frames" profile (https://mudstandards.org/websocket/). mudix
 *  already speaks this wire format; advertising the name lets a conforming
 *  server confirm the dialect via the RFC 6455 handshake. */
export const MUD_TELNET_SUBPROTOCOL = 'telnet.mudstandards.org';


/** In-band MXP line-mode sequence `ESC[<n>z` (n optional). Its presence means
 *  the server is speaking MXP even if it skipped the telnet option-91 handshake.
 *  Non-global so `.test()` stays stateless. */
const MXP_LINE_MODE_RE = /\x1b\[[0-9]*z/;

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
    private readonly msspStream: (data: string) => void;
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
    /** Set true once the server has sent IAC GA / IAC EOR at least once.
     *  Mirrors Mudlet's `mGA_Driver` latch (`cTelnet::gotRest`). From then on
     *  the held partial tail is flushed by the prompt marker (see the `hasPrompt`
     *  block below) rather than the idle timer. Note: unlike Mudlet's cTelnet —
     *  which posts GA-mode chunks verbatim and reassembles split lines in TBuffer
     *  — we keep buffering partial lines here, because our render path finalizes
     *  every emitted chunk and has no downstream open-line carry. */
    private gaDriver = false;
    /** True at the start of a GA-driven data block — i.e. before any content of
     *  the current post-GA transmission has been seen. Drives the
     *  `fixUnnecessaryLinebreaks` leading-newline strip, which fires at most once
     *  per block. Set true on connect and after each prompt flush, cleared once
     *  the block's leading-newline question has been settled. */
    private atPromptBlockStart = true;
    /** Mudlet `mUSE_IRE_DRIVER_BUGFIX` — strip a spurious leading newline from
     *  GA-driven prompt blocks. Off by default; toggled live via
     *  setFixUnnecessaryLinebreaks (setConfig). */
    private fixUnnecessaryLinebreaks: boolean;
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

    /** True once we've sent the GMCP `Core.Hello` / `Core.Supports.Set`
     *  handshake this session, so a server that re-offers GMCP doesn't make us
     *  announce ourselves twice. Reset on each connect(). */
    private gmcpHelloSent = false;

    commandEcho: boolean;
    private gmcpEnabled: boolean;
    private mttsEnabled: boolean;
    private msdpEnabled: boolean;
    private msspEnabled: boolean;
    private charsetEnabled: boolean;
    private mspEnabled: boolean;
    private mxpEnabled: boolean;
    private mnesEnabled: boolean;
    private newEnvironEnabled: boolean;
    /** Whether the game-facing transport is TLS (for the NEW-ENVIRON TLS var). */
    private secureTransport: boolean;
    private nawsEnabled: boolean;
    /** True once we've sent IAC WILL NAWS this session (proactively on connect,
     *  or in response to a server-initiated IAC DO NAWS), so we don't re-offer. */
    private nawsWillSent = false;
    /** True once the server has accepted NAWS (IAC DO NAWS). Gates whether a
     *  window-size change is pushed to the server. */
    private nawsNegotiated = false;
    /** Latest known main output window size in character columns × rows, fed in
     *  by the session's resize observer via setWindowSize(). Null until the UI
     *  has measured the grid at least once. */
    private windowSize: { cols: number; rows: number } | null = null;
    /** Latches true once MXP has started for this session — via telnet option 91
     *  negotiation OR by detecting an in-band MXP line-mode sequence (`ESC[<n>z`).
     *  Many MUDs enable MXP server-side and just start streaming tags without the
     *  telnet handshake, so the in-band signal is the reliable trigger. Reset on
     *  each connect(). */
    private mxpStarted = false;
    private readonly mspParser = new MspParser();
    /** WebSocket subprotocols advertised on connect (see MudClientOptions). */
    private readonly subprotocols: string[];
    /** Currently active byte→char codec label. Starts at UTF-8 (works for
     *  ASCII and modern MUDs); switches when a CHARSET REQUEST/ACCEPTED
     *  exchange agrees on something else. Also drives outgoing encoding for
     *  user input — see encodeOutgoing(). Reset on each connect(). */
    private currentEncoding = 'utf-8';

    constructor(
        {
            url,
            mccpEnabled = true,
            commandEcho = true,
            chunkProcessor,
            promptTimeoutMs = DEFAULT_PROMPT_TIMEOUT_MS,
            gmcpEnabled = true,
            mttsEnabled = true,
            msdpEnabled = false,
            msspEnabled = true,
            charsetEnabled = true,
            mspEnabled = false,
            mxpEnabled = true,
            mnesEnabled = false,
            newEnvironEnabled = false,
            secureTransport,
            nawsEnabled = true,
            fixUnnecessaryLinebreaks = false,
            subprotocols = [],
        }: MudClientOptions,
        eventBus: EventBus<MudClientEvents>,
    ) {
        this.url = url;
        this.commandEcho = commandEcho;
        this.eventBus = eventBus;
        this.chunkProcessor = chunkProcessor ?? createPassthroughProcessor();
        this.promptTimeoutMs = clampPromptTimeout(promptTimeoutMs);
        this.gmcpEnabled = gmcpEnabled;
        this.mttsEnabled = mttsEnabled;
        this.msdpEnabled = msdpEnabled;
        this.msspEnabled = msspEnabled;
        this.charsetEnabled = charsetEnabled;
        this.mspEnabled = mspEnabled;
        this.mxpEnabled = mxpEnabled;
        this.mnesEnabled = mnesEnabled;
        this.newEnvironEnabled = newEnvironEnabled;
        // Fall back to the URL scheme when the caller doesn't say — correct for a
        // direct websocket connection; proxy mode passes false explicitly.
        this.secureTransport = secureTransport ?? /^wss:/i.test(url);
        this.nawsEnabled = nawsEnabled;
        this.fixUnnecessaryLinebreaks = fixUnnecessaryLinebreaks;
        this.subprotocols = subprotocols;

        this.gmcpStream = createGmcpStream({
            onEnvelope: ({ path, value }) => {
                this.handleCharLogin(path, value);
                (this.eventBus.emit as (event: string, ...args: unknown[]) => void)(`gmcp.${path}`, value);
                // GMCP module names are case-insensitive by convention, and the
                // ping tracker listens on a fixed lowercase event. Route the
                // server's Core.Ping reply regardless of spelling — the spec's
                // canonical reply is PascalCase `Core.Ping` with no body, which
                // `gmcp.${path}` alone would emit as `gmcp.Core.Ping`.
                if (path !== 'core.ping' && path.toLowerCase() === 'core.ping') {
                    this.eventBus.emit('gmcp.core.ping', value);
                }
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

        this.msspStream = createMsspStream({
            onEnvelope: ({ name, value }) => {
                (this.eventBus.emit as (event: string, ...args: unknown[]) => void)(`mssp.${name}`, value);
                this.eventBus.emit('mssp', { name, value });
            },
        });

        // A telnet subnegotiation body opens with its option code; route GMCP
        // (201) and MSDP (69) to their respective parsers and ignore the rest.
        this.telnetOptionHandler = createTelnetOptionParser((subneg) => {
            const code = subneg.charCodeAt(0);
            if (code === GMCP_COMMAND_CODE) this.gmcpStream(subneg);
            else if (code === MSDP_COMMAND_CODE) this.msdpStream(subneg);
            else if (code === MSSP_COMMAND_CODE) this.msspStream(subneg);
            else if (code === TTYPE_COMMAND_CODE) this.respondTerminalType(subneg);
            else if (code === CHARSET_COMMAND_CODE) this.handleCharsetSubneg(subneg);
            else if (code === MSP_COMMAND_CODE) this.handleMspSubneg(subneg);
            else if (code === MXP_COMMAND_CODE) this.handleMxpSubneg();
            else if (code === NEW_ENVIRON_COMMAND_CODE) this.handleNewEnvironSubneg(subneg);
        });
        this.mccpHandler = new MccpHandler((data) => this.sendRaw(data));
        this.mccpHandler.enabled = mccpEnabled;

        this.echoHandler = new EchoHandler(
            (data) => this.sendRaw(data),
            (maskInput) => this.eventBus.emit('telnet.echo', maskInput),
            () => this.eventBus.emit('telnet.echo.anomaly'),
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

    /** Mudlet `setConfig("fixUnnecessaryLinebreaks", …)`. Takes effect on the
     *  next GA-driven block; never retroactive. */
    setFixUnnecessaryLinebreaks(enabled: boolean): void {
        this.fixUnnecessaryLinebreaks = enabled;
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
        this.currentEncoding = 'utf-8';
        this.textDecoder = new TextDecoder('utf-8', { fatal: false });
        this.pendingLineTail = "";
        this.gaDriver = false;
        this.atPromptBlockStart = true;
        this.gmcpHelloSent = false;
        this.ttypeStep = 0;
        this.mxpStarted = false;
        this.nawsWillSent = false;
        this.nawsNegotiated = false;
        this.mspParser.reset();
        this.clearTailTimer();

        try {
            // Advertise subprotocols only when configured — passing an empty
            // array still sends an (empty) Sec-WebSocket-Protocol header, so omit
            // the argument entirely in the common case to keep the bare handshake.
            this.socket = this.subprotocols.length > 0
                ? new WebSocket(this.url, this.subprotocols)
                : new WebSocket(this.url);
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
                    if (this.gmcpEnabled && data.includes(GMCP_WILL)) {
                        // Server offers GMCP (IAC WILL GMCP) → we accept (IAC DO GMCP).
                        this.sendRaw(GMCP_DO);
                        this.sendGmcpHandshake();
                        this.eventBus.emit('gmcp.negotiated');
                    } else if (this.gmcpEnabled && data.includes(GMCP_DO)) {
                        // Server requests we enable GMCP (IAC DO GMCP) → we accept
                        // (IAC WILL GMCP). Mirrors the MSDP handling below: telnet
                        // negotiation is symmetric, so handle both directions.
                        this.sendRaw(GMCP_WILL);
                        this.sendGmcpHandshake();
                        this.eventBus.emit('gmcp.negotiated');
                    }
                    if (this.msdpEnabled && data.includes(MSDP_WILL)) {
                        // Server offers MSDP (IAC WILL MSDP) → we accept (IAC DO MSDP).
                        this.sendRaw(MSDP_DO);
                        this.eventBus.emit('msdp.negotiated');
                    } else if (this.msdpEnabled && data.includes(MSDP_DO)) {
                        // Server requests we enable MSDP (IAC DO MSDP) → we accept
                        // (IAC WILL MSDP). Telnet negotiation is symmetric and many
                        // servers (e.g. Legends of Kallisti) start MSDP this way; without
                        // this branch we'd never reply and never fire msdp.negotiated.
                        this.sendRaw(MSDP_WILL);
                        this.eventBus.emit('msdp.negotiated');
                    }
                    if (this.msspEnabled && data.includes(MSSP_WILL)) {
                        // Server offers MSSP (IAC WILL MSSP) → we accept (IAC DO
                        // MSSP). The server then sends its status fields in a
                        // single SB MSSP … SE subnegotiation handled by msspStream.
                        this.sendRaw(MSSP_DO);
                        this.eventBus.emit('mssp.negotiated');
                    } else if (this.msspEnabled && data.includes(MSSP_DO)) {
                        // Server requests we enable MSSP (IAC DO MSSP) → we accept
                        // (IAC WILL MSSP). Telnet negotiation is symmetric, so
                        // handle both directions like MSDP/GMCP above.
                        this.sendRaw(MSSP_WILL);
                        this.eventBus.emit('mssp.negotiated');
                    }
                    if (this.mttsEnabled && data.includes(TTYPE_DO)) {
                        // Server asks us to identify our terminal (IAC DO TTYPE).
                        // Agree (IAC WILL TTYPE); the actual name/type/MTTS values
                        // follow via the SB TTYPE SEND subnegotiation handled in
                        // respondTerminalType(). Many MUDs (e.g. Kallisti) won't
                        // offer MSDP/GMCP until this handshake completes.
                        this.sendRaw(TTYPE_WILL);
                    }
                    if (this.mspEnabled && data.includes(MSP_WILL)) {
                        // Server offers MSP (IAC WILL MSP) → we accept (IAC DO MSP).
                        // In practice most MUDs just inline `!!SOUND(...)` tags
                        // without ever negotiating, so this branch is rarely hit;
                        // when it is, we want the option enabled so subnegotiated
                        // tags route through handleMspSubneg.
                        this.sendRaw(MSP_DO);
                        this.eventBus.emit('msp.negotiated');
                        if (debugMspEnabled()) console.debug('[mudix.msp] negotiated: server WILL → client DO');
                    } else if (this.mspEnabled && data.includes(MSP_DO)) {
                        // Server requests we enable MSP (IAC DO MSP) → we agree.
                        this.sendRaw(MSP_WILL);
                        this.eventBus.emit('msp.negotiated');
                        if (debugMspEnabled()) console.debug('[mudix.msp] negotiated: server DO → client WILL');
                    }
                    if (this.mxpEnabled && data.includes(MXP_WILL)) {
                        // Server offers MXP (IAC WILL MXP) → we accept (IAC DO MXP).
                        // From here the server embeds in-band MXP markup; the
                        // scripting engine parses it once it sees mxp.negotiated.
                        this.sendRaw(MXP_DO);
                        this.startMxp(true);
                    } else if (this.mxpEnabled && data.includes(MXP_DO)) {
                        // Server requests we enable MXP (IAC DO MXP) → we accept
                        // (IAC WILL MXP). Telnet negotiation is symmetric; many
                        // servers (e.g. Aardwolf) start MXP this way.
                        this.sendRaw(MXP_WILL);
                        this.startMxp(true);
                    }
                    if (this.mxpEnabled && !this.mxpStarted && MXP_LINE_MODE_RE.test(data)) {
                        // No telnet handshake, but the server is emitting MXP
                        // line-mode sequences (ESC[<n>z) — it's speaking MXP. Turn
                        // parsing on now, before this frame's text is rendered, so
                        // the very lines carrying the markup get parsed. `z` is not
                        // a standard ANSI CSI final, so this signal is MXP-specific.
                        // viaTelnet=false: we don't send handshake replies because
                        // the server's inbound MXP channel isn't confirmed.
                        this.startMxp(false);
                    }
                    if (data.includes(EOR_WILL)) {
                        // Server announces it will mark prompts with IAC EOR
                        // (telnet option 25, IAC WILL EOR) → we accept (IAC DO
                        // EOR). The EOR markers then drive prompt detection the
                        // same way IAC GA does (see TELNET_EOR handling in
                        // processIncomingData). Many Diku/Circle-derived servers
                        // (e.g. The Last Outpost) won't send the login prompt
                        // until this option is acknowledged.
                        this.sendRaw(EOR_DO);
                    }
                    if (data.includes(SGA_WILL)) {
                        // Server offers Suppress-Go-Ahead (IAC WILL SGA, option 3)
                        // → we accept (IAC DO SGA). Standard for full-duplex MUD
                        // sessions; leaving it unanswered stalls strict servers
                        // that wait for negotiation to settle before prompting.
                        this.sendRaw(SGA_DO);
                    }
                    if (data.includes(NEW_ENVIRON_DO)) {
                        // MNES and plain NEW-ENVIRON share telnet option 39 and
                        // differ only in the variable set reported (handled in
                        // handleNewEnvironSubneg); either toggle being on means we
                        // answer the option. MNES takes precedence when both are on.
                        if (this.mnesEnabled || this.newEnvironEnabled) {
                            // Server asks us to report environment variables (IAC
                            // DO NEW-ENVIRON) → we agree (IAC WILL NEW-ENVIRON).
                            // The server then sends SB NEW-ENVIRON SEND … which
                            // handleNewEnvironSubneg answers. NEW-ENVIRON is
                            // asymmetric — the client owns the variables — so we
                            // only handle the DO direction (a WILL would mean the
                            // server has env vars, which this protocol doesn't use).
                            this.sendRaw(NEW_ENVIRON_WILL);
                            this.eventBus.emit('mnes.negotiated', this.mnesEnabled ? 'MNES' : 'NEW-ENVIRON');
                        } else {
                            // Both disabled → explicitly decline (IAC WONT
                            // NEW-ENVIRON). A bare DO with no WILL/WONT answer
                            // leaves strict servers waiting on the option before
                            // they continue (e.g. before sending the login prompt),
                            // so silence is not an option here.
                            this.sendRaw(NEW_ENVIRON_WONT);
                        }
                    }
                    if (this.nawsEnabled && data.includes(NAWS_DO)) {
                        // Server accepted our WILL NAWS (or requested it outright)
                        // → start reporting window size. If the server initiated
                        // without seeing our WILL (rare), send WILL first. Then
                        // push the current dimensions and re-send on every resize.
                        if (!this.nawsWillSent) {
                            this.sendRaw(NAWS_WILL);
                            this.nawsWillSent = true;
                        }
                        const firstAccept = !this.nawsNegotiated;
                        this.nawsNegotiated = true;
                        this.sendNawsSize();
                        if (firstAccept) this.eventBus.emit('naws.negotiated');
                    } else if (this.nawsEnabled && data.includes(NAWS_DONT)) {
                        // Server declined window-size reporting — stop pushing it.
                        this.nawsNegotiated = false;
                    }
                    if (this.charsetEnabled && data.includes(CHARSET_WILL)) {
                        // Server offers CHARSET (IAC WILL CHARSET) → we accept
                        // (IAC DO CHARSET) and proactively send our REQUEST
                        // listing preferred encodings (UTF-8 first). Mudlet does
                        // the same — without the REQUEST many servers stay on
                        // their default codec and never switch.
                        this.sendRaw(CHARSET_DO);
                        this.sendCharsetRequest();
                    } else if (this.charsetEnabled && data.includes(CHARSET_DO)) {
                        // Server asks us to enable CHARSET (IAC DO CHARSET) → we
                        // agree (IAC WILL CHARSET) and drive the negotiation by
                        // sending our REQUEST.
                        this.sendRaw(CHARSET_WILL);
                        this.sendCharsetRequest();
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
                this.flushPendingLineTail(Date.now(), true);
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
                this.mspParser.reset();
                this.clearTailTimer();
            };

            this.socket.onopen = (event: Event) => {
                this.opened = true;
                // Surface which subprotocol the server actually selected (empty
                // string when none was negotiated). Lets the UI/logs confirm a
                // `telnet.mudstandards.org` handshake succeeded vs. fell back.
                if (this.subprotocols.length > 0) {
                    const selected = this.socket.protocol;
                    this.eventBus.emit('client.subprotocol', selected);
                    if (debugTelnetEnabled()) {
                        // eslint-disable-next-line no-console
                        console.debug('[mudix.telnet subprotocol] requested',
                            this.subprotocols.join(', '), '→ selected',
                            selected ? `'${selected}'` : '(none)');
                    }
                }
                // Proactively offer NAWS (RFC 1073 has the window-owning side
                // send WILL). The server replies IAC DO NAWS — handled below —
                // at which point we send the actual dimensions. Harmless if the
                // server doesn't support it (it answers DONT or ignores us).
                if (this.nawsEnabled && !this.nawsWillSent) {
                    this.sendRaw(NAWS_WILL);
                    this.nawsWillSent = true;
                }
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
        this.flushPendingLineTail(Date.now(), true);
        this.eventBus.emit('client.disconnect');
        this.opened = false;
        this.mccpHandler.reset();
        this.echoHandler.reset();
        this.pendingSubneg = '';
        this.pendingLineTail = '';
        this.mspParser.reset();
        this.clearTailTimer();
    }

    isSocketOpen(): boolean {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    isPasswordMode(): boolean {
        return this.isSocketOpen() && this.echoHandler.passwordMode;
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
            this.sendBytes(this.encodeOutgoing(message + "\r\n"));
        } catch (error) {
            console.error('Error sending message:', error);
            this.eventBus.emit('error', error);
        }
    }

    /** Convert a user-typed JS string (UTF-16) into the Latin-1 byte-string
     *  sendBytes expects, using the currently negotiated outgoing encoding.
     *  For UTF-8 we run it through TextEncoder so multi-byte chars survive;
     *  for other encodings we fall back to a per-char `& 0xff` truncation,
     *  which is lossless for ASCII and acceptable for Latin-1-family inputs.
     *  TextEncoder has no API for non-UTF-8 outputs, so a full per-encoding
     *  outbound table isn't worth the bytes given how rare non-UTF-8 MUDs are. */
    private encodeOutgoing(text: string): string {
        if (this.currentEncoding === 'utf-8') {
            const bytes = new TextEncoder().encode(text);
            let out = '';
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            return out;
        }
        return text;
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

    /** Announce ourselves to the server right after GMCP is negotiated, the way
     *  Mudlet does: `Core.Hello` identifies the client (name + version) and
     *  `Core.Supports.Set` lists the GMCP modules we understand. Many servers
     *  won't push any GMCP data (room, char, vitals, …) until they've received
     *  this hello, so without it GMCP effectively does nothing. Latched so a
     *  repeated WILL/DO GMCP doesn't re-announce. Reports the client name as
     *  "MUDIX" — our own identity — matching the TTYPE/MNES handshake. */
    private sendGmcpHandshake(): void {
        if (this.gmcpHelloSent) return;
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.gmcpHelloSent = true;
        try {
            this.sendBytes(encodeGmcp('Core.Hello', {
                client: 'MUDIX',
                version: CLIENT_VERSION,
            }));
            // Mudlet's default Core.Supports.Set, minus "External.Discord 1"
            // (Mudlet only sends that when its Discord integration is active —
            // we have none) and minus the modules gated on Discord.
            this.sendBytes(encodeGmcp('Core.Supports.Set', [
                'Char 1',
                'Char.Skills 1',
                'Char.Items 1',
                'Room 1',
                'IRE.Rift 1',
                'IRE.Composer 1',
                'Client.Media 1',
                'Char.Login 1',
            ]));
        } catch (error) {
            console.error('Error sending GMCP handshake:', error);
            this.eventBus.emit('error', error);
        }
    }

    /** Route GMCP `Char.Login.*` messages. The server sends `Char.Login.Default
     *  { "type": [...] }` to request login and then *waits* for the client to
     *  supply credentials — withholding the normal text "By what name…" prompt
     *  until it hears back (servers that do this gate on the `Char.Login` module
     *  we advertise in `Core.Supports.Set`). We surface it as `charLogin.request`
     *  so the UI can pop a credentials form; the UI replies via
     *  `sendCharLoginCredentials`, or an empty reply (cancel) to fall back to the
     *  text login (the behaviour Mudlet/Mudlet#7377 is about). `Char.Login.Result`
     *  carries the outcome. Path match is case-insensitive — GMCP module casing
     *  varies between servers. */
    private handleCharLogin(path: string, value: unknown): void {
        const p = path.toLowerCase();
        if (p === 'char.login.default') {
            const type = (value as { type?: unknown } | null)?.type;
            const methods = Array.isArray(type) ? type.map(String) : [];
            this.eventBus.emit('charLogin.request', methods);
        } else if (p === 'char.login.result') {
            const v = (value ?? {}) as { success?: unknown; message?: unknown };
            this.eventBus.emit('charLogin.result', {
                success: v.success === true,
                message: typeof v.message === 'string' ? v.message : undefined,
            });
        }
    }

    /** Send the GMCP `Char.Login.Credentials` reply. With an account, sends
     *  `{ account, password }` (account may be `"account:character"` for games
     *  with both); with no account it sends the empty `{}` form — the spec's
     *  "no credentials, fall back to your next auth method" signal, used when the
     *  user cancels the popup. mudix never stores the password; it only relays it. */
    sendCharLoginCredentials(account?: string, password?: string): void {
        const payload = account ? { account, password: password ?? '' } : {};
        this.sendGmcp('Char.Login.Credentials', payload);
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

    /** Mudlet `sendATCP(message)`. Frames `IAC SB ATCP <message> IAC SE` (ATCP =
     *  telnet option 200, GMCP's predecessor) and sends it raw. Returns false
     *  when the socket isn't open. */
    sendATCP(message: string): boolean {
        return this.sendSubnegotiation(OPT_ATCP, message, 'ATCP');
    }

    /** Mudlet `sendTelnetChannel102(msg)`. Frames `IAC SB 102 <msg> IAC SE`
     *  (the zMUD generic out-of-band channel) and sends it raw. Returns false
     *  when the socket isn't open. */
    sendTelnetChannel102(msg: string): boolean {
        return this.sendSubnegotiation(OPT_TELNET_102, msg, 'telnet channel 102');
    }

    /** Frame a raw `IAC SB <opt> <payload> IAC SE` subnegotiation and send it
     *  with no encoding conversion (each char → one byte), like the other
     *  telnet negotiations. Shared by sendATCP / sendTelnetChannel102. */
    private sendSubnegotiation(opt: string, payload: string, label: string): boolean {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this.sendRaw(GMCP_IAC + GMCP_SB + opt + payload + GMCP_IAC + GMCP_SE);
            return true;
        } catch (error) {
            console.error(`Error sending ${label} message:`, error);
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
        const HARDCODED = new Set<number>([1 /* ECHO */, 3 /* SGA */, 24 /* TTYPE */, 25 /* EOR */, 31 /* NAWS */, 39 /* NEW-ENVIRON/MNES */, 42 /* CHARSET */, 69 /* MSDP */, 70 /* MSSP */, 85 /* MCCP1 */, 86 /* MCCP2 */, 90 /* MSP */, 91 /* MXP */, 201 /* GMCP */]);
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
        if (!this.mttsEnabled) return;
        if (subneg.charCodeAt(1) !== TTYPE_SEND.charCodeAt(0)) return; // only handle SEND
        // MTTS bitvector tracks live state (UTF-8 encoding, TLS transport); the
        // static bits (ANSI, 256 colours, OSC colour palette, truecolour) are
        // always on. See computeMtts.
        const mtts = computeMtts({
            utf8: this.currentEncoding === 'utf-8',
            tls: this.secureTransport,
        });
        const cycle = ['MUDIX', 'ANSI-TRUECOLOR', `MTTS ${mtts}`];
        const value = cycle[Math.min(this.ttypeStep, cycle.length - 1)];
        if (this.ttypeStep < cycle.length - 1) this.ttypeStep++;
        this.sendRaw(GMCP_IAC + GMCP_SB + OPT_TTYPE + TTYPE_IS + value + GMCP_IAC + GMCP_SE);
    }

    /** Send `IAC SB CHARSET REQUEST ;UTF-8;ISO-8859-2;ISO-8859-1 IAC SE` —
     *  advertising the encodings we can decode, in preference order. Each name
     *  is prefixed by the separator (`;`) per RFC 2066 (the separator comes
     *  before each charset, not between them). The server replies ACCEPTED
     *  <name> or REJECTED; handleCharsetSubneg() processes either. */
    private sendCharsetRequest(): void {
        if (!this.charsetEnabled) return;
        const PREFS = ['UTF-8', 'ISO-8859-2', 'ISO-8859-1'];
        const sep = ';';
        const body = OPT_CHARSET + CHARSET_REQUEST + sep + PREFS.join(sep);
        this.sendRaw(GMCP_IAC + GMCP_SB + body + GMCP_IAC + GMCP_SE);
    }

    /** Route an `IAC SB CHARSET ... IAC SE` subnegotiation body (leading byte
     *  is the option code, 42). Handles REQUEST (server lists charsets, we
     *  ACCEPT one or REJECT), ACCEPTED (server picked one of ours — switch
     *  codec), and REJECTED (server didn't like any of ours — stay put).
     *  TTABLE-* subcommands are silently ignored; almost no MUD uses them. */
    private handleCharsetSubneg(subneg: string): void {
        if (!this.charsetEnabled) return;
        if (subneg.length < 2) return;
        const sub = subneg.charCodeAt(1);
        if (sub === CHARSET_REQUEST.charCodeAt(0)) {
            const chosen = pickCharsetFromRequest(subneg);
            if (!chosen) {
                this.sendRaw(GMCP_IAC + GMCP_SB + OPT_CHARSET + CHARSET_REJECTED + GMCP_IAC + GMCP_SE);
                return;
            }
            this.sendRaw(GMCP_IAC + GMCP_SB + OPT_CHARSET + CHARSET_ACCEPTED + chosen.original + GMCP_IAC + GMCP_SE);
            this.setEncoding(chosen.normalized, chosen.original);
        } else if (sub === CHARSET_ACCEPTED.charCodeAt(0)) {
            // Server accepted one of the names from our REQUEST. The body after
            // byte[1] is the chosen name verbatim.
            const name = subneg.substring(2);
            const norm = normalizeCharsetName(name);
            if (norm) this.setEncoding(norm, name);
        }
        // CHARSET_REJECTED — no action, keep current encoding.
    }

    /** Swap the streaming decoder to a new encoding label (an IANA name the
     *  TextDecoder constructor accepts: 'utf-8', 'iso-8859-2', ...). Any partial
     *  multi-byte sequence buffered in the previous decoder is discarded —
     *  fine because CHARSET typically negotiates before any real content
     *  arrives. Emits `charset.negotiated` with the wire-spelling name so
     *  listeners can surface it (status bar / debug log). */
    private setEncoding(encoding: string, displayName: string): void {
        try {
            this.textDecoder = new TextDecoder(encoding, { fatal: false });
            this.currentEncoding = encoding;
        } catch {
            // Browser refused the label (shouldn't happen for our allowlist).
            // Stay on the existing decoder; don't emit the negotiated event.
            return;
        }
        this.eventBus.emit('charset.negotiated', displayName);
    }

    /** Mudlet `getServerEncoding()`. The IANA name of the decoder currently
     *  applied to the inbound stream — 'utf-8' until CHARSET negotiation (or an
     *  explicit setServerEncoding) swaps it. */
    getServerEncoding(): string {
        return this.currentEncoding;
    }

    /** Mudlet `setServerEncoding(name)`. Switch the inbound decoder to `name`
     *  (any value from getServerEncodingsList()). Returns false — leaving the
     *  current encoding untouched — when the name isn't one we can decode. */
    setServerEncoding(name: string): boolean {
        const norm = normalizeCharsetName(String(name ?? ''));
        if (!norm) return false;
        this.setEncoding(norm, String(name));
        return true;
    }

    /** Route an `IAC SB MSP ... IAC SE` body to the MSP parser and dispatch
     *  any parsed commands as `msp` events. Always runs when an MSP subneg
     *  arrives — once the server has bothered to wrap a tag, we trust it. */
    private handleMspSubneg(subneg: string): void {
        const commands = this.mspParser.feedSubneg(subneg);
        if (debugMspEnabled()) {
            if (commands.length === 0) {
                console.debug('[mudix.msp] subneg arrived but parsed 0 commands; body=', JSON.stringify(subneg.substring(1)));
            } else {
                console.debug(`[mudix.msp] subneg parsed ${commands.length} command(s):`, commands);
            }
        }
        for (const cmd of commands) this.eventBus.emit('msp', cmd);
    }

    /** Handle an `IAC SB MXP IAC SE` subnegotiation. Per spec it carries no
     *  payload — it merely confirms MXP is active — so we just start MXP. The
     *  actual MXP markup arrives in-band and is parsed downstream by the
     *  scripting engine. */
    private handleMxpSubneg(): void {
        if (!this.mxpEnabled) return;
        this.startMxp(true);
    }

    /** Latch MXP on for this session and notify listeners. Idempotent — only the
     *  first call emits `mxp.negotiated`; later calls (repeat WILL/DO, in-band
     *  detection on subsequent frames) are no-ops. `viaTelnet` distinguishes a
     *  real option-91 handshake from in-band-only detection (see the event doc). */
    private startMxp(viaTelnet: boolean): void {
        if (this.mxpStarted) return;
        this.mxpStarted = true;
        this.eventBus.emit('mxp.negotiated', viaTelnet);
    }

    /** Answer an `IAC SB NEW-ENVIRON SEND … IAC SE` request, framed as
     *  `IAC SB NEW-ENVIRON IS <marker> … VALUE … IAC SE`. Telnet option 39 is
     *  shared by two modes: MNES reports the five core variables framed as VAR;
     *  plain NEW-ENVIRON reports the core set plus an extended capability set,
     *  framed as USERVAR. MNES takes precedence when both toggles are on
     *  (matching Mudlet). The server may request specific variables or send a
     *  bare SEND for all; selectMnesVars handles both. No-op when the option is
     *  off for this profile or on a malformed/non-SEND body. */
    private handleNewEnvironSubneg(subneg: string): void {
        // MNES precedence: when on, it restricts the reported set to the core
        // five regardless of whether plain NEW-ENVIRON is also enabled.
        const extended = !this.mnesEnabled && this.newEnvironEnabled;
        if (!this.mnesEnabled && !this.newEnvironEnabled) return;
        const request = parseMnesRequest(subneg);
        if (!request.isSend) return;
        const vars = selectMnesVars(request, this.collectNewEnvironVars(extended));
        const marker = extended ? NEW_ENVIRON_USERVAR : NEW_ENVIRON_VAR;
        this.sendRaw(encodeMnesIs(vars, marker));
    }

    /** Build the option-39 variable set from live client state. CHARSET tracks
     *  the negotiated encoding; the extended NEW-ENVIRON capabilities derive from
     *  the game-facing transport (TLS — false in proxy mode, see secureTransport)
     *  and the measured output grid (WORD_WRAP). The static identity
     *  (CLIENT_NAME/VERSION, MTTS, TERMINAL_TYPE) and the capability defaults live
     *  in buildNewEnvironVars. */
    private collectNewEnvironVars(extended: boolean): MnesVar[] {
        const charset = this.currentEncoding === 'utf-8'
            ? 'UTF-8'
            : this.currentEncoding.toUpperCase();
        return buildNewEnvironVars({
            charset,
            utf8: this.currentEncoding === 'utf-8',
            tls: this.secureTransport,
            wrapColumns: this.windowSize?.cols ?? 0,
        }, extended);
    }

    /** Report the main output window's character grid (columns × rows) for NAWS.
     *  The session calls this on every output-area resize. The value is stored
     *  regardless of negotiation state (so a client created on a later connect
     *  can be seeded with the current size); it's only sent to the server once
     *  NAWS has been negotiated, and only when it actually changed. */
    setWindowSize(cols: number, rows: number): void {
        const c = Math.max(0, Math.trunc(cols));
        const r = Math.max(0, Math.trunc(rows));
        if (this.windowSize && this.windowSize.cols === c && this.windowSize.rows === r) return;
        this.windowSize = { cols: c, rows: r };
        if (this.nawsNegotiated) this.sendNawsSize();
    }

    /** Send the current window size as an `IAC SB NAWS … IAC SE` subnegotiation.
     *  Falls back to a conventional 80×24 terminal default when the UI hasn't
     *  reported a real size yet — better than the NAWS 0×0 "no preference"
     *  sentinel, which some servers treat as "disable wrapping". */
    private sendNawsSize(): void {
        const { cols, rows } = this.windowSize ?? { cols: 80, rows: 24 };
        this.sendRaw(encodeNaws(cols, rows));
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
        const decodedRaw = this.decodeUtf8(sanitized);
        // MSP in-band parsing: strip `!!SOUND(...)` / `!!MUSIC(...)` triplets
        // and dispatch them as events. Gated on mspEnabled because the tag
        // bytes are legitimate text on non-MSP MUDs (rare in practice but
        // possible inside log dumps and quoted strings).
        let decoded = decodedRaw;
        if (this.mspEnabled && decodedRaw.length > 0) {
            const { text, commands } = this.mspParser.feed(decodedRaw);
            decoded = text;
            if (commands.length > 0 && debugMspEnabled()) {
                console.debug(`[mudix.msp] inline parsed ${commands.length} command(s):`, commands);
            }
            for (const cmd of commands) this.eventBus.emit('msp', cmd);
        }
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
            // Emit only whole lines (text up to and including the last `\n`) and
            // hold the trailing partial in `pendingLineTail` until the rest of
            // the line arrives, a prompt marker (IAC GA/EOR) flushes it below, or
            // the idle timer fires. This runs even in GA-driver mode: a long MUD
            // line can be split across WebSocket frames at an arbitrary byte
            // (mid-word), and emitting each frame verbatim would render the line
            // broken in two. Mudlet posts verbatim here but reassembles the line
            // downstream in TBuffer (it finalizes a line only at `\n`, appending
            // one after a GA); our render path finalizes every emitted chunk, so
            // we enforce the same "line ends only at \n or GA" invariant here.
            // NB: this holds an incomplete line until it completes rather than
            // rendering it live (Mudlet's TBuffer grows the open line in place).
            // The live-partial parity work is deferred — see
            // docs/line-assembly-tbuffer-port.md.
            let combined = this.pendingLineTail + decoded;
            // Mudlet's "Fix unnecessary linebreaks on GA servers": at the start
            // of a GA-driven block, drop a single spurious leading newline (the
            // IRE-driver bug). Done at block-start rather than at the GA — like
            // Mudlet's cTelnet::gotPrompt — because our render path emits whole
            // lines eagerly and can't retract them once the GA arrives. The block
            // after a GA begins at the very next byte, so its leading newline is
            // the same one Mudlet would strip from mMudData at the next GA.
            // (Deviation: Mudlet also strips the first block at the first GA via
            // buffering; we can't see that block is GA-driven until the GA lands,
            // so the very first transmission keeps its leading newline.)
            if (this.fixUnnecessaryLinebreaks && this.gaDriver && this.atPromptBlockStart) {
                const { result, decided } = stripLeadingPromptNewline(combined);
                if (decided) {
                    combined = result;
                    this.atPromptBlockStart = false;
                }
            }
            const lastNl = combined.lastIndexOf('\n');
            if (lastNl === -1) {
                this.pendingLineTail = combined;
            } else {
                const ready = combined.substring(0, lastNl + 1);
                this.pendingLineTail = combined.substring(lastNl + 1);
                this.chunkProcessor.processChunk(ready, ts, this);
            }
        }

        if (hasPrompt) {
            if (debugGaEnabled()) {
                const marker = processable.includes(TELNET_GA) ? 'GA' : 'EOR';
                // eslint-disable-next-line no-console
                console.debug(
                    `[mudix.ga] prompt marker IAC ${marker} received` +
                    (this.gaDriver ? '' : ' — latching into GA-driven prompt mode'),
                );
            }
            this.flushPendingLineTail(ts);
            this.gaDriver = true;
            // The next data block (the next transmission) starts fresh, so its
            // leading newline is again a candidate for the IRE-bug strip above.
            this.atPromptBlockStart = true;
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
    private flushPendingLineTail(ts: number, final = false): void {
        this.clearTailTimer();
        if (this.pendingLineTail.length === 0) return;
        let tail = this.pendingLineTail;
        // A prompt tail can end mid-ANSI-escape when the server splits e.g.
        // `…known? \x1b[K` across frames so the bare `\x1b` lands at the end of
        // one chunk. Flushing it now would drop the lone ESC (parseAnsiSegments
        // discards a truncated trailing escape) and then render the `[K` that
        // follows as literal text. So hold the incomplete escape back — like a
        // partial UTF-8 sequence — and let the next frame complete it. On a
        // genuine end-of-stream (`final`, i.e. socket close) there is no "next
        // frame", so flush everything verbatim.
        let held = "";
        if (!final) {
            const cut = incompleteEscapeTailStart(tail);
            if (cut !== -1) {
                held = tail.slice(cut);
                tail = tail.slice(0, cut);
            }
        }
        this.pendingLineTail = held;
        // Nothing renderable before the held escape — keep holding it (don't
        // reschedule: a never-completing escape would spin the timer forever;
        // the next inbound frame recombines it).
        if (tail.length === 0) return;
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
 * Mudlet's "Fix unnecessary linebreaks on GA servers" core, ported from
 * `cTelnet::gotPrompt` (gated there on `mUSE_IRE_DRIVER_BUGFIX && mGA_Driver`).
 * IRE-style servers prepend a spurious <LF> to each GA-terminated transmission,
 * which renders as a blank line before every prompt block. This removes a single
 * leading newline from the front of a GA-driven block — first skipping any
 * leading ANSI SGR escape sequence, exactly as Mudlet does (`if (mMudData[j] ==
 * 0x1B) … scan to 'm'`).
 *
 * Returns the (possibly trimmed) string and `decided`:
 *  - `decided: true`  — the leading-newline question is settled for this block
 *    (a newline was removed, or the first real byte wasn't a newline).
 *  - `decided: false` — so far the block is *only* ANSI escapes, or ends inside
 *    an incomplete escape (no terminating 'm' yet). The caller should keep the
 *    block-start flag set and retry once more bytes arrive. (Mudlet never hits
 *    this case — it has the whole block in hand at GA time — but we decide
 *    incrementally as frames stream in.)
 */
function stripLeadingPromptNewline(s: string): { result: string; decided: boolean } {
    let i = 0;
    while (i < s.length) {
        if (s.charCodeAt(i) === 0x1b) {
            // Skip an ANSI escape up to and including its 'm' (SGR) terminator.
            let j = i + 1;
            while (j < s.length && s[j] !== 'm') j++;
            if (j >= s.length) return { result: s, decided: false }; // incomplete — wait
            i = j + 1;
            continue;
        }
        // First non-escape byte reached: strip it iff it's the spurious newline.
        if (s[i] === '\n') return { result: s.slice(0, i) + s.slice(i + 1), decided: true };
        return { result: s, decided: true };
    }
    // Ran off the end with only complete ANSI escapes — no content byte yet.
    return { result: s, decided: false };
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
    42: 'CHARSET', 69: 'MSDP', 70: 'MSSP', 85: 'MCCP1', 86: 'MCCP2', 90: 'MSP',
    91: 'MXP', 93: 'ZMP', 201: 'GMCP', 255: 'IAC',
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
 * Diagnostic gate — enable via `localStorage.setItem('mudix.debugMsp', '1')`
 * in the browser console to log MSP negotiation, parsed `!!SOUND`/`!!MUSIC`
 * tags (inline and subneg), and their dispatch into the SoundManager. Use
 * this to confirm whether a MUD is actually emitting MSP and whether the
 * client is routing it through.
 */
function debugMspEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('mudix.debugMsp') === '1';
    } catch {
        return false;
    }
}

/**
 * Diagnostic gate — enable via `localStorage.setItem('mudix.debugGa', '1')` in
 * the browser console to log every IAC GA / IAC EOR prompt marker the server
 * sends, plus the one-time moment the client latches into GA-driven prompt
 * mode. Use this to confirm whether a MUD actually signals its prompts (GA-less
 * MUDs rely on the `promptTimeoutMs` idle-flush fallback instead).
 */
function debugGaEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('mudix.debugGa') === '1';
    } catch {
        return false;
    }
}

/**
 * Map a wire-format charset name (case-insensitive, with various dash/underscore
 * spellings) onto an IANA label that `TextDecoder` accepts. Returns null for
 * encodings we don't support — most legacy MUD codepages aren't reachable from
 * the browser TextDecoder API and would need a polyfill not worth shipping.
 *
 * Coverage is deliberately narrow: UTF-8 (the universal modern answer), the
 * Latin-N family, the Cyrillic KOI8 variants, and the Windows-125x codepages.
 * That covers every Polish, Russian, and Western European MUD seen in practice.
 */
function normalizeCharsetName(raw: string): string | null {
    const n = raw.trim().toLowerCase().replace(/_/g, '-');
    if (n === 'utf-8' || n === 'utf8') return 'utf-8';
    // US-ASCII is a strict subset of UTF-8, so the UTF-8 decoder handles it byte-for-byte.
    if (n === 'us-ascii' || n === 'ascii') return 'utf-8';
    const iso = /^iso-?8859-?(\d{1,2})$/.exec(n);
    if (iso) {
        // TextDecoder knows iso-8859-{2..16} (and iso-8859-1 via 'latin1').
        const part = parseInt(iso[1], 10);
        if (part >= 1 && part <= 16 && part !== 12 /* iso-8859-12 doesn't exist */) {
            return `iso-8859-${part}`;
        }
        return null;
    }
    const latin = /^latin-?(\d+)$/.exec(n);
    if (latin) {
        // "Latin-N" aliases: Latin-1 = ISO-8859-1, Latin-2 = ISO-8859-2, Latin-9 = ISO-8859-15.
        const map: Record<string, string> = { '1': 'iso-8859-1', '2': 'iso-8859-2', '9': 'iso-8859-15' };
        return map[latin[1]] ?? null;
    }
    if (/^windows-125\d$/.test(n)) return n;        // 1250..1258 all valid TextDecoder labels
    if (n === 'koi8-r' || n === 'koi8-u') return n;
    return null;
}

/** Priority order for picking among offered charsets. Earlier wins. Matches
 *  the Mudlet preference (UTF-8 first, then Polish/Russian, then Western). */
const CHARSET_PRIORITY = [
    'utf-8',
    'iso-8859-2',
    'windows-1250',
    'iso-8859-1',
    'iso-8859-15',
    'windows-1252',
    'koi8-r',
    'koi8-u',
];

/** Wire-format names of every charset mudix can decode, surfaced to Lua scripts
 *  via `getServerEncodingsList()`. Every entry round-trips through
 *  {@link normalizeCharsetName}, so any name here is a valid `setServerEncoding`
 *  argument. ("ASCII" maps to the UTF-8 decoder, which handles it byte-for-byte.) */
export const SUPPORTED_SERVER_ENCODINGS: readonly string[] = [
    'ASCII', 'UTF-8',
    'ISO-8859-1', 'ISO-8859-2', 'ISO-8859-3', 'ISO-8859-4', 'ISO-8859-5',
    'ISO-8859-6', 'ISO-8859-7', 'ISO-8859-8', 'ISO-8859-9', 'ISO-8859-10',
    'ISO-8859-11', 'ISO-8859-13', 'ISO-8859-14', 'ISO-8859-15', 'ISO-8859-16',
    'KOI8-R', 'KOI8-U',
    'WINDOWS-1250', 'WINDOWS-1251', 'WINDOWS-1252', 'WINDOWS-1253', 'WINDOWS-1254',
    'WINDOWS-1255', 'WINDOWS-1256', 'WINDOWS-1257', 'WINDOWS-1258',
];

/**
 * Parse an `IAC SB CHARSET REQUEST ...` subnegotiation body (leading byte is
 * the option code 42, then subcommand byte 1, then optional `[TTABLE]<ver>`
 * prefix, then a separator byte, then separator-delimited IANA names). Returns
 * the best match against {@link CHARSET_PRIORITY} with both the original wire
 * spelling (echoed back in the ACCEPTED reply per RFC 2066) and the normalized
 * IANA label suitable for `new TextDecoder(...)`. Returns null if no offered
 * name is supported.
 */
function pickCharsetFromRequest(subneg: string): { original: string; normalized: string } | null {
    if (subneg.length < 4) return null;
    let i = 2; // skip option code (42) + subcommand (REQUEST = 1)
    // Optional `[TTABLE]<version>` prefix — skip the bracket-delimited tag and
    // the single version byte after it. We don't support translation tables;
    // we just step past the prefix so we can find the real separator.
    if (subneg.charCodeAt(i) === 0x5B /* '[' */) {
        const close = subneg.indexOf(']', i);
        if (close === -1) return null;
        i = close + 1;
        if (i >= subneg.length) return null;
        i++; // skip version byte
    }
    if (i >= subneg.length) return null;
    const sep = subneg[i];
    const list = subneg.substring(i).split(sep).filter(name => name.length > 0);
    if (list.length === 0) return null;
    // Build a lookup from normalized name → first occurrence with original spelling.
    const normalized = new Map<string, string>();
    for (const original of list) {
        const norm = normalizeCharsetName(original);
        if (norm && !normalized.has(norm)) normalized.set(norm, original);
    }
    for (const preferred of CHARSET_PRIORITY) {
        const original = normalized.get(preferred);
        if (original) return { original, normalized: preferred };
    }
    return null;
}

/**
 * If `s` ends with an ANSI/ECMA-48 escape sequence that runs off the end of the
 * string (a bare trailing `\x1b`, or `\x1b[` / `\x1b]…` with no final byte yet),
 * return the index where that incomplete escape begins; otherwise -1. Used to
 * keep a partial escape attached to the start of the next frame instead of
 * flushing it split — which would drop the lone ESC and leak the completion
 * (e.g. `[K`) as literal text. A complete trailing escape returns -1 (nothing to
 * hold). Only the *last* escape can be incomplete, so checking it suffices.
 */
function incompleteEscapeTailStart(s: string): number {
    const esc = s.lastIndexOf("\x1b");
    if (esc === -1) return -1;
    return scanEscape(s, esc).kind === "incomplete" ? esc : -1;
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
