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
}

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
        }: MudClientOptions,
        eventBus: EventBus<MudClientEvents>,
    ) {
        this.url = url;
        this.commandEcho = commandEcho;
        this.eventBus = eventBus;
        this.chunkProcessor = chunkProcessor ?? createPassthroughProcessor();

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

    connect(): void {
        if (this.socket) {
            this.socket.onmessage = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onopen = null;
        }
        this.mccpHandler.reset();
        this.echoHandler.reset();

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
                this.eventBus.emit('close', event);
                if (isAbnormalClose(event)) {
                    this.eventBus.emit('client.error', formatCloseError(event, this.opened));
                }
                this.eventBus.emit('client.disconnect');
                this.opened = false;
                this.mccpHandler.reset();
                this.echoHandler.reset();
                this.pendingSubneg = "";
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
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
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
        const ts = typeof timestamp === 'number' ? timestamp : Date.now();
        if (sanitized.length > 0) {
            this.chunkProcessor.processChunk(sanitized, ts, this);
        }
        if (hasPrompt) {
            this.eventBus.emit('prompt');
        }
        this.flushMessageBuffer();
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
