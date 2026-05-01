import type { MudClient } from '../connection/MudClient';

export interface ChunkProcessor {
    /** Called with the full sanitized text chunk from each WebSocket frame. */
    processChunk(data: string, timestamp: number, client: MudClient): void;
}

/** Passthrough — outputs each chunk directly with no processing. */
export function createPassthroughProcessor(): ChunkProcessor {
    return {
        processChunk(data, timestamp, client) {
            client.output(data, undefined, timestamp);
        },
    };
}
