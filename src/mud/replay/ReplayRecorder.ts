import { encodeReplay, replayLatin1ToBytes, type ReplayChunk } from './replayFormat';

/**
 * Accumulates the inbound telnet stream into Mudlet replay chunks. Fed with
 * the post-MCCP Latin-1 byte-strings the client emits as `socket.incoming` —
 * the same tap point Mudlet records at, so the file captures IAC sequences,
 * GMCP subnegotiations, prompts, and ANSI verbatim. Chunks are buffered in
 * memory (MUD output is small) and serialized once on stop().
 */
export class ReplayRecorder {
    private chunks: ReplayChunk[] = [];
    private lastChunkTime: number;

    constructor() {
        this.lastChunkTime = performance.now();
    }

    /** Record one inbound data block. The chunk's offset is the time elapsed
     *  since the previous block (or since recording started, for the first). */
    feed(data: string): void {
        if (data.length === 0) return;
        const now = performance.now();
        const offsetMs = Math.max(0, Math.round(now - this.lastChunkTime));
        this.lastChunkTime = now;
        this.chunks.push({ offsetMs, data: replayLatin1ToBytes(data) });
    }

    get chunkCount(): number {
        return this.chunks.length;
    }

    /** Serialize everything recorded so far to Mudlet's .dat format. */
    encode(): Uint8Array {
        return encodeReplay(this.chunks);
    }
}
