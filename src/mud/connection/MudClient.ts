import { EventBus } from "../../core/EventBus";
import { AnsiAwareBuffer } from "../text/FormatState";
import { PingTracker } from "./PingTracker";
import { createPassthroughEngine, type TriggerEngine } from "../triggers/TriggerEngine";
import {
    createGmcpStream,
    createTelnetOptionParser,
    EchoHandler,
    encodeGmcp,
    GMCP_DO,
    GMCP_WILL,
    MccpHandler,
    stripTelnetSequences,
} from "../protocol";

export type MudClientEvents = {
    'open': [event: Event];
    'close': [event: CloseEvent];
    'error': [error: unknown];
    'client.connect': void;
    'client.disconnect': void;
    'socket.incoming': [data: string];
    'socket.outgoing': [data: string];
    'message': [text?: string | AnsiAwareBuffer, type?: string, timestamp?: number];
    'flushLines': [groups: { text: string; type: string }[]];
    'gmcp': [payload: { path: string; value: unknown }];
    'telnet.echo': [serverEchoing: boolean];
    'ping': [duration: number | null];
} & Record<string, any>;

type Params<T> = [T] extends [void]
    ? []
    : [T] extends [any[]]
        ? T
        : [T];
type EventListener<K extends keyof MudClientEvents> = (...args: Params<MudClientEvents[K]>) => void;

export interface MudClientOptions {
    url: string;
    mccpEnabled?: boolean;
    commandEcho?: boolean;
    triggerEngine?: TriggerEngine;
}

export class MudClient {
    private socket!: WebSocket;
    private readonly eventBus: EventBus<MudClientEvents>;
    private readonly pingTracker: PingTracker;
    private readonly triggerEngine: TriggerEngine;
    private messageBuffer: { text: string; type: string }[] = [];
    private readonly gmcpStream: (data: string) => void;
    private readonly telnetOptionHandler: (optionData: string) => string;
    private readonly mccpHandler: MccpHandler;
    private readonly echoHandler: EchoHandler;
    private readonly url: string;

    commandEcho: boolean;

    constructor({
        url,
        mccpEnabled = true,
        commandEcho = true,
        triggerEngine,
    }: MudClientOptions) {
        this.url = url;
        this.commandEcho = commandEcho;
        this.eventBus = new EventBus<MudClientEvents>();
        this.triggerEngine = triggerEngine ?? createPassthroughEngine();

        this.gmcpStream = createGmcpStream({
            onEnvelope: ({ path, value }) => {
                (this.eventBus.emit as (event: string, ...args: unknown[]) => void)(`gmcp.${path}`, value);
                this.emit('gmcp', { path, value });
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
            (serverEchoing) => this.emit('telnet.echo', serverEchoing),
        );

        this.pingTracker = new PingTracker(
            () => this.sendGmcp('core.ping'),
            (duration) => this.emit('ping', duration),
            (handler) => this.eventBus.on('gmcp.core.ping', handler),
        );

        addEventListener('beforeunload', (event) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                event.preventDefault();
            }
        });
    }

    on<K extends keyof MudClientEvents>(event: K, listener: EventListener<K>): () => void {
        return this.eventBus.on(event, listener);
    }

    off<K extends keyof MudClientEvents>(event: K, listener: EventListener<K>): void {
        this.eventBus.off(event, listener);
    }

    emit<K extends keyof MudClientEvents>(event: K, ...args: Params<MudClientEvents[K]>): void {
        this.eventBus.emit(event, ...args);
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
                    }
                    this.echoHandler.processData(data);
                    this.emit('socket.incoming', data);
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
                this.emit('error', error);
            };

            this.socket.onclose = (event: CloseEvent) => {
                this.emit('close', event);
                this.emit('client.disconnect');
                this.pingTracker.stop();
                this.mccpHandler.reset();
                this.echoHandler.reset();
            };

            this.socket.onopen = (event: Event) => {
                this.emit('open', event);
                this.emit('client.connect');
                this.pingTracker.start();
            };
        } catch (error) {
            this.emit('error', error);
        }
    }

    disconnect(): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
        this.pingTracker.stop();
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
            this.emit('socket.outgoing', message);
        }
        try {
            this.socket.send(btoa(message + "\r\n"));
        } catch (error) {
            console.error('Error sending message:', error);
            this.emit('error', error);
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
            this.emit('error', error);
        }
    }

    output(text?: string | AnsiAwareBuffer, type?: string, timestamp?: number): void {
        const ts = typeof timestamp === 'number' ? timestamp : Date.now();
        this.emit('message', text, type, ts);
    }

    private processIncomingData(data: string, timestamp?: number): void {
        const sanitized = stripTelnetSequences(data, this.telnetOptionHandler).replace(/\r/g, '');
        const ts = typeof timestamp === 'number' ? timestamp : Date.now();
        if (sanitized.length > 0) {
            this.triggerEngine.processChunk(sanitized, ts, this);
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
        this.emit('flushLines', groups);
    }
}
