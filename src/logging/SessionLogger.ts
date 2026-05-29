import type { MudSession } from '../mud/MudSession';
import { AnsiAwareBuffer } from '../mud/text/FormatState';
import { appendEntries, createSession, updateSession, type LogEntry } from '../storage/logStorage';

const FLUSH_INTERVAL_MS = 1500;
/** Force a flush once the in-memory buffer reaches this many lines. */
const FLUSH_AT = 500;

/**
 * Transient partial lines (a script echo being built up character-by-character
 * before its newline). The completed line is re-emitted as 'script' /
 * 'trigger-echo', so logging the partials would just create duplicates.
 */
const SKIP_TYPES = new Set(['script-partial']);

/**
 * Records one gameplay session to IndexedDB. Subscribes to the session's
 * `message` event — the single choke point every line of output passes
 * through, including the player's own echoed commands (type 'echo') — and
 * snapshots each line's rendered HTML at emit time (before later trigger
 * gagging/recolouring can mutate the live buffer). Lines are buffered and
 * written in batches to keep IndexedDB traffic off the hot path.
 *
 * The session record is created lazily on the first flush that carries
 * entries, so opening a profile you never receive output in leaves no trace.
 */
export class SessionLogger {
    private readonly sessionId = crypto.randomUUID();
    private readonly startedAt = Date.now();
    private buffer: LogEntry[] = [];
    private seq = 0;
    private totalCount = 0;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private unsubscribe: (() => void) | null = null;
    private sessionCreated = false;
    /** Serializes flushes so a size-triggered flush can't race the timer. */
    private flushing: Promise<void> = Promise.resolve();

    constructor(
        private readonly session: MudSession,
        private readonly connectionId: string,
        private readonly connectionName: string,
    ) {}

    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.session.events.on('message', (text, type, timestamp) => {
            this.capture(text, type, timestamp);
        });
        this.flushTimer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
    }

    private capture(text?: string | AnsiAwareBuffer, type?: string, timestamp?: number): void {
        if (text === undefined || text === null) return;
        const entryType = type ?? 'mud';
        if (SKIP_TYPES.has(entryType)) return;

        // Snapshot the styled HTML now. For raw strings, route through a buffer
        // so any embedded ANSI is parsed and the text is HTML-escaped.
        const buffer = typeof text === 'string' ? new AnsiAwareBuffer(text) : text;
        this.buffer.push({
            sessionId: this.sessionId,
            seq: this.seq++,
            timestamp: timestamp ?? Date.now(),
            type: entryType,
            html: buffer.toHtml(),
            plain: buffer.text,
        });
        this.totalCount++;
        if (this.buffer.length >= FLUSH_AT) void this.flush();
    }

    /**
     * Mudlet `appendLog(text)` — append an arbitrary line to the current log,
     * outside the normal output stream. Recorded with type 'appendLog'; any
     * embedded ANSI is parsed for the HTML snapshot.
     */
    appendLine(text: string): void {
        this.capture(text ?? '', 'appendLog');
    }

    /** Persist any buffered lines and bump the session's end time/count. */
    flush(): Promise<void> {
        this.flushing = this.flushing.then(() => this.doFlush());
        return this.flushing;
    }

    private async doFlush(): Promise<void> {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
        try {
            if (!this.sessionCreated) {
                this.sessionCreated = true;
                await createSession({
                    id: this.sessionId,
                    connectionId: this.connectionId,
                    connectionName: this.connectionName,
                    startedAt: this.startedAt,
                    endedAt: Date.now(),
                    entryCount: 0,
                });
            }
            await appendEntries(batch);
            await updateSession(this.sessionId, { endedAt: Date.now(), entryCount: this.totalCount });
        } catch (err) {
            // Re-queue the batch so a transient IndexedDB error doesn't lose it.
            this.buffer = batch.concat(this.buffer);
            console.error('[SessionLogger] flush failed', err);
        }
    }

    /** Detach the listener and write out whatever is buffered. */
    async stop(): Promise<void> {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.unsubscribe?.();
        this.unsubscribe = null;
        await this.flush();
    }
}
