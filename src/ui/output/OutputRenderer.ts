import { AnsiAwareBuffer } from "../../mud/text/FormatState";

// Buffers are stored keyed by their wrapper element. The WeakMap means the
// AnsiAwareBuffer is garbage-collected automatically when its element is removed
// from the DOM and no longer referenced elsewhere.  Exported so other renderers
// (WindowManager text panels) can attach buffers to their own line elements.
export const elementBuffers = new WeakMap<Element, AnsiAwareBuffer>();

type MessageListener = (message?: string | AnsiAwareBuffer, type?: string, timestamp?: number) => void;
type MessageSource = {
    on(event: 'message', listener: MessageListener): () => void;
    on(event: 'script.deleteline', listener: () => void): () => void;
    on(event: 'script.clearwindow', listener: () => void): () => void;
    on(event: 'script.movecursorup', listener: () => void): () => void;
    on(event: 'script.movecursordown', listener: () => void): () => void;
};

/** Returns the 0-based index of `el` among the non-sentinel children of `parent`. */
function elementIndex(parent: HTMLElement, el: Element, sentinel: HTMLElement): number {
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
        if (children[i] === sentinel) break;
        if (children[i] === el) return i;
    }
    return -1;
}

/** Line count: all children before the sentinel. */
function lineCount(parent: HTMLElement, sentinel: HTMLElement): number {
    const idx = Array.prototype.indexOf.call(parent.children, sentinel);
    return idx >= 0 ? idx : parent.childElementCount;
}

export type CursorOps = {
    /** Plain text of the line at the current cursor position. */
    getLine: () => string;
    /** AnsiAwareBuffer of the line at the current cursor position, for in-place coloring. */
    getBuffer: () => AnsiAwareBuffer | null;
    /** Remove the line at the current cursor position. */
    deleteLine: () => void;
    /** Move the cursor one line toward older output. */
    moveUp: () => void;
    /** Move the cursor one line toward newer output. */
    moveDown: () => void;
    /** Move the cursor to an absolute line number (1 = oldest, getLineCount() = newest). */
    moveTo: (line: number) => void;
    /** 1-indexed line number of the cursor from the top of the buffer. */
    getLineNumber: () => number;
    /** Total number of lines currently in the output buffer. */
    getLineCount: () => number;
    /** Plain text of lines [from..to] (1-indexed, inclusive) as a JS string array. */
    getLines: (from: number, to: number) => string[];
};

/**
 * Creates cursor ops for a plain line container (text/miniconsole windows).
 * The container holds `div` line elements appended via appendChild — no sentinel.
 * Returns the ops plus an `onLineAppended` callback that must be called each
 * time a new line element is added, so the cursor resets to the latest line.
 */
export function createWindowCursorOps(container: HTMLElement): {
    ops: CursorOps;
    onLineAppended: (el: Element) => void;
} {
    let cursorEl: Element | null = null;
    let deletedPrev: Element | null = null;

    function resolve(): Element | null {
        return cursorEl ?? container.lastElementChild;
    }

    const ops: CursorOps = {
        getLine(): string {
            const el = resolve();
            return el ? (elementBuffers.get(el)?.text ?? '') : '';
        },

        getBuffer(): AnsiAwareBuffer | null {
            const el = resolve();
            return el ? (elementBuffers.get(el) ?? null) : null;
        },

        deleteLine(): void {
            const el = resolve();
            if (!el) return;
            deletedPrev = el.previousElementSibling;
            container.removeChild(el);
            cursorEl = null;
        },

        moveUp(): void {
            if (cursorEl === null) {
                if (deletedPrev !== null) {
                    cursorEl = deletedPrev;
                    deletedPrev = null;
                } else {
                    cursorEl = container.lastElementChild?.previousElementSibling ?? null;
                }
            } else {
                cursorEl = cursorEl.previousElementSibling;
            }
        },

        moveDown(): void {
            const current = resolve();
            if (!current) return;
            cursorEl = current.nextElementSibling;
            deletedPrev = null;
        },

        moveTo(line: number): void {
            const el = container.children[line - 1];
            if (el) { cursorEl = el; deletedPrev = null; }
        },

        getLineNumber(): number {
            const el = resolve();
            if (!el) return 0;
            const children = container.children;
            for (let i = 0; i < children.length; i++) {
                if (children[i] === el) return i + 1;
            }
            return 0;
        },

        getLineCount(): number {
            return container.childElementCount;
        },

        getLines(from: number, to: number): string[] {
            const result: string[] = [];
            const children = container.children;
            for (let i = from - 1; i < to && i < children.length; i++) {
                result.push(elementBuffers.get(children[i])?.text ?? '');
            }
            return result;
        },
    };

    return {
        ops,
        onLineAppended(el: Element): void {
            cursorEl = el;
            deletedPrev = null;
        },
    };
}

type OutputHandlerOptions = {
    outputWrapper: HTMLElement;
    sentinel: HTMLElement;
    stickyArea: HTMLElement;
    isSplitView: () => boolean;
    stickyLines: number;
    maxElements?: number | (() => number);
    trimSlack?: number;
    suppressSplitView?: (durationMs: number) => void;
    /** Called once the cursor ops are ready; wire them to ScriptingAPI/session. */
    onCursorReady?: (ops: CursorOps) => void;
};

export type OutputRendererControls = {
    teardown: () => void;
    areTimestampsVisible: () => boolean;
    setTimestampVisibility: (visible: boolean) => void;
    toggleTimestampVisibility: () => void;
    populateStickyArea: () => void;
    clearStickyArea: () => void;
    push: (message: string | AnsiAwareBuffer, type?: string, timestamp?: number) => void;
    clear: () => void;
};

const TIMESTAMP_CLASS = 'output-show-timestamps';

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function createTimestampElement(timestamp: number): HTMLSpanElement {
    const timestampEl = document.createElement('span');
    timestampEl.classList.add('output-timestamp');
    timestampEl.textContent = formatTimestamp(timestamp);
    timestampEl.dataset.timestamp = `${timestamp}`;
    timestampEl.title = new Date(timestamp).toLocaleString();
    return timestampEl;
}

function createMessageWrapper(
    message: string | AnsiAwareBuffer,
    type: string | undefined,
    timestamp: number
): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.classList.add('output-msg');
    if (type) {
        wrapper.classList.add(type);
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('output-msg-text');
    wrapper.dataset.timestamp = `${timestamp}`;

    const timestampEl = createTimestampElement(timestamp);
    const contentSpan = document.createElement('span');
    contentSpan.classList.add('output-msg-content');

    const buffer = typeof message === 'string' ? new AnsiAwareBuffer(message) : message;

    // Attach the buffer to the element so it can be retrieved via the cursor.
    elementBuffers.set(wrapper, buffer);

    if (buffer.length === 0) {
        contentSpan.innerHTML = '&nbsp;';
    } else {
        contentSpan.appendChild(buffer.toDom());
        buffer.notifyRender(contentSpan);
    }

    contentSpan.style.whiteSpace = 'pre-wrap';

    messageDiv.appendChild(timestampEl);
    messageDiv.appendChild(contentSpan);
    wrapper.appendChild(messageDiv);

    return wrapper;
}

export function setupOutputRenderer(
    source: MessageSource | null,
    {
        outputWrapper,
        sentinel,
        stickyArea,
        isSplitView,
        stickyLines,
        maxElements = 1000,
        trimSlack = 100,
        suppressSplitView,
        onCursorReady,
    }: OutputHandlerOptions,
): OutputRendererControls {
    let timestampsVisible = false;

    // ── Trigger cursor ────────────────────────────────────────────────────────
    //
    // `cursorEl`   — the element the cursor is currently pointing at.
    //                null means "use sentinel.previousElementSibling" (the
    //                latest rendered line), which is also the post-delete state.
    // `deletedPrev`— saved previousElementSibling of the element that was just
    //                deleted via deleteLine(). moveCursorUp() consumes this to
    //                land on the correct next element.
    let cursorEl: Element | null = null;
    let deletedPrev: Element | null = null;

    function resolveElement(): Element | null {
        return cursorEl ?? sentinel.previousElementSibling;
    }

    const cursorOps: CursorOps = {
        getLine(): string {
            const el = resolveElement();
            if (!el || el === sentinel) return '';
            return elementBuffers.get(el)?.text ?? '';
        },

        getBuffer(): AnsiAwareBuffer | null {
            const el = resolveElement();
            if (!el || el === sentinel) return null;
            return elementBuffers.get(el) ?? null;
        },

        deleteLine(): void {
            const el = resolveElement();
            if (!el || el === sentinel) return;
            deletedPrev = el.previousElementSibling === sentinel ? null : el.previousElementSibling;
            outputWrapper.removeChild(el);
            cursorEl = null;
        },

        moveUp(): void {
            if (cursorEl === null) {
                if (deletedPrev !== null) {
                    cursorEl = deletedPrev;
                    deletedPrev = null;
                } else {
                    const latest = sentinel.previousElementSibling;
                    cursorEl = latest?.previousElementSibling ?? null;
                }
            } else {
                cursorEl = cursorEl.previousElementSibling;
            }
        },

        moveDown(): void {
            const current = resolveElement();
            if (!current || current === sentinel) return;
            const next = current.nextElementSibling;
            // Stop at sentinel — it marks the end of output.
            cursorEl = (next && next !== sentinel) ? next : null;
            deletedPrev = null;
        },

        moveTo(line: number): void {
            // line is 1-indexed from the top of the buffer.
            const idx = line - 1;
            const el = outputWrapper.children[idx];
            if (el && el !== sentinel) {
                cursorEl = el;
                deletedPrev = null;
            }
        },

        getLineNumber(): number {
            const el = resolveElement();
            if (!el || el === sentinel) return 0;
            const idx = elementIndex(outputWrapper, el, sentinel);
            return idx >= 0 ? idx + 1 : 0; // 1-indexed
        },

        getLineCount(): number {
            return lineCount(outputWrapper, sentinel);
        },

        getLines(from: number, to: number): string[] {
            const result: string[] = [];
            const children = outputWrapper.children;
            const clampedTo = Math.min(to, lineCount(outputWrapper, sentinel));
            for (let i = from - 1; i < clampedTo; i++) {
                const el = children[i];
                if (!el || el === sentinel) break;
                result.push(elementBuffers.get(el)?.text ?? '');
            }
            return result;
        },
    };

    onCursorReady?.(cursorOps);

    // ── Message rendering ─────────────────────────────────────────────────────

    function applyTimestampVisibility() {
        outputWrapper.classList.toggle(TIMESTAMP_CLASS, timestampsVisible);
        stickyArea.classList.toggle(TIMESTAMP_CLASS, timestampsVisible);
    }

    const handleMessage = (message?: string | AnsiAwareBuffer, type?: string, timestamp?: number) => {
        if (message === undefined || message === null) {
            return;
        }

        const timestampValue = typeof timestamp === 'number' ? timestamp : Date.now();
        const wrapper = createMessageWrapper(message, type, timestampValue);

        outputWrapper.insertBefore(wrapper, sentinel);

        // Reset the cursor to the freshly rendered line so trigger processing
        // that fires immediately after always starts at the right position.
        cursorEl = wrapper;
        deletedPrev = null;

        const maxElementsValue = typeof maxElements === 'function' ? maxElements() : maxElements;

        // Trim in batches while not in split view — removing nodes while the user is scrolled
        // up would shift the content they are reading. Excess drains on the next message.
        if (!isSplitView() && outputWrapper.childElementCount - 1 > maxElementsValue + trimSlack) {
            while (outputWrapper.childElementCount - 1 > maxElementsValue) {
                const first = outputWrapper.firstElementChild;
                if (first === sentinel) {
                    const second = first.nextElementSibling;
                    if (second) {
                        outputWrapper.removeChild(second);
                    } else {
                        break;
                    }
                } else if (first) {
                    outputWrapper.removeChild(first);
                } else {
                    break;
                }
            }
        }

        if (isSplitView()) {
            const stickyWrapper = createMessageWrapper(message, type, timestampValue);
            stickyArea.appendChild(stickyWrapper);
            while (stickyArea.childElementCount > stickyLines) {
                const firstSticky = stickyArea.firstElementChild;
                if (firstSticky) {
                    stickyArea.removeChild(firstSticky);
                } else {
                    break;
                }
            }
        } else {
            if (suppressSplitView) {
                suppressSplitView(250);
            }
            requestAnimationFrame(() => {
                outputWrapper.scrollTop = outputWrapper.scrollHeight;
            });
        }
    };

    function clearStickyArea() {
        while (stickyArea.firstChild) {
            stickyArea.removeChild(stickyArea.firstChild);
        }
    }

    function populateStickyArea() {
        clearStickyArea();
        const children = Array.from(outputWrapper.children);
        const sentinelIdx = children.indexOf(sentinel as Element);
        const messages = sentinelIdx >= 0 ? children.slice(0, sentinelIdx) : children;
        const lastN = messages.slice(-stickyLines);
        for (const el of lastN) {
            stickyArea.appendChild(el.cloneNode(true));
        }
        applyTimestampVisibility();
    }

    let teardownSubscriptions = () => {};

    if (source) {
        const unsubscribeMessage = source.on('message', handleMessage);

        const unsubscribeDeleteLine = source.on('script.deleteline', () => {
            const el = resolveElement();
            if (!el || el === sentinel) return;
            deletedPrev = el.previousElementSibling === sentinel ? null : el.previousElementSibling;
            outputWrapper.removeChild(el);
            cursorEl = null;
        });

        const unsubscribeClearWindow    = source.on('script.clearwindow',    clearAll);
        const unsubscribeMoveCursorUp   = source.on('script.movecursorup',   cursorOps.moveUp);
        const unsubscribeMoveCursorDown = source.on('script.movecursordown', cursorOps.moveDown);

        teardownSubscriptions = () => {
            unsubscribeMessage();
            unsubscribeDeleteLine();
            unsubscribeClearWindow();
            unsubscribeMoveCursorUp();
            unsubscribeMoveCursorDown();
        };
    }

    function clearAll() {
        clearStickyArea();
        while (outputWrapper.firstElementChild !== sentinel) {
            if (outputWrapper.firstElementChild) {
                outputWrapper.removeChild(outputWrapper.firstElementChild);
            } else break;
        }
        cursorEl = null;
        deletedPrev = null;
    }

    return {
        teardown: teardownSubscriptions,
        areTimestampsVisible: () => timestampsVisible,
        setTimestampVisibility: (visible: boolean) => {
            timestampsVisible = visible;
            applyTimestampVisibility();
        },
        toggleTimestampVisibility: () => {
            timestampsVisible = !timestampsVisible;
            applyTimestampVisibility();
        },
        populateStickyArea,
        clearStickyArea,
        push: handleMessage,
        clear: clearAll,
    };
}
