import pako from 'pako';

const MCCP_WILL = "\xFF\xFB\x56";         // IAC WILL COMPRESS2
const MCCP_START = "\xFF\xFA\x56\xFF\xF0"; // IAC SB COMPRESS2 IAC SE
const MCCP_DO = "\xFF\xFD\x56";           // IAC DO COMPRESS2

interface InflateInternal extends pako.Inflate {
    strm: { output: Uint8Array; next_out: number; avail_out: number };
    options: { chunkSize: number };
}

export class MccpHandler {
    private compressing = false;
    private inflator: pako.Inflate | null = null;
    private readonly sendRaw: (data: string) => void;
    private _enabled = true;

    constructor(sendRaw: (data: string) => void) {
        this.sendRaw = sendRaw;
    }

    isActive(): boolean {
        return this.compressing;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    set enabled(value: boolean) {
        this._enabled = value;
    }

    /**
     * Process incoming data, handling MCCP negotiation and decompression.
     * Must be called BEFORE stripTelnetSequences.
     */
    processData(data: string): string {
        if (this.compressing) {
            return this.decompress(data);
        }

        if (!this._enabled) {
            return data;
        }

        if (data.indexOf(MCCP_WILL) !== -1) {
            this.sendRaw(MCCP_DO);
        }

        const startIdx = data.indexOf(MCCP_START);
        if (startIdx === -1) {
            return data;
        }

        const before = data.substring(0, startIdx);
        const after = data.substring(startIdx + MCCP_START.length);

        this.startCompression();

        if (after.length > 0) {
            const decompressed = this.decompress(after);
            return before + decompressed;
        }

        return before;
    }

    reset(): void {
        this.compressing = false;
        this.inflator = null;
    }

    private startCompression(): void {
        this.compressing = true;
        this.inflator = new pako.Inflate();
    }

    private decompress(data: string): string {
        if (!this.inflator) {
            return data;
        }

        const bytes = stringToBytes(data);
        const output: Uint8Array[] = [];

        const origOnData = this.inflator.onData;
        this.inflator.onData = (chunk: Uint8Array) => {
            output.push(new Uint8Array(chunk));
        };

        this.inflator.push(bytes, false);

        // Pako only calls onData when its internal buffer is full (default 64KB),
        // so for small MUD messages we must extract buffered data manually.
        const inf = this.inflator as unknown as InflateInternal;
        if (inf.strm.next_out > 0) {
            output.push(new Uint8Array(inf.strm.output.subarray(0, inf.strm.next_out)));
            inf.strm.next_out = 0;
            inf.strm.avail_out = inf.options.chunkSize;
        }

        this.inflator.onData = origOnData;

        if (this.inflator.err) {
            console.error('MCCP decompression error:', this.inflator.msg);
            this.compressing = false;
            this.inflator = null;
            return data;
        }

        return bytesToString(output);
    }
}

function stringToBytes(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes;
}

function bytesToString(arrays: Uint8Array[]): string {
    let result = '';
    for (const arr of arrays) {
        for (let i = 0; i < arr.length; i++) {
            result += String.fromCharCode(arr[i]);
        }
    }
    return result;
}
