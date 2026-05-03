import type { MudClient } from '../connection/MudClient';

export interface ChunkProcessor {
    /** Called with the full sanitized text chunk from each WebSocket frame. */
    processChunk(data: string, timestamp: number, client: MudClient): void;
}

/**
 * Passthrough — pushes each chunk to the message buffer so it travels through
 * flushLines → ScriptingEngine, which handles both rendering (via 'message')
 * and trigger processing in one pass.
 */
export function createPassthroughProcessor(): ChunkProcessor {
    return {
        processChunk(data, _timestamp, client) {
            client.pushLine(data, 'mud');
        },
    };
}
