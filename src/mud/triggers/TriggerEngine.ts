import type { MudClient } from '../connection/MudClient';

export interface TriggerEngine {
    /** Called with the full sanitized text chunk from each WebSocket frame. */
    processChunk(data: string, timestamp: number, client: MudClient): void;
}

/**
 * Passthrough stub — outputs each chunk directly with no processing.
 * Replace with a real TriggerEngine to handle line splitting, gags, triggers, etc.
 */
export function createPassthroughEngine(): TriggerEngine {
    return {
        processChunk(data, timestamp, client) {
            client.output(data, undefined, timestamp);
        },
    };
}
