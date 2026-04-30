import {AnsiAwareBuffer} from "../../mud/text/FormatState";

type MessageListener = (message?: string | AnsiAwareBuffer, type?: string, timestamp?: number) => void;
type MessageSource = { on(event: 'message', listener: MessageListener): () => void };

type OutputHandlerOptions = {
    outputWrapper: HTMLElement;
    sentinel: HTMLElement;
    stickyArea: HTMLElement;
    isSplitView: () => boolean;
    stickyLines: number;
    maxElements?: number | (() => number);
    trimSlack?: number;
    suppressSplitView?: (durationMs: number) => void;
};

export type OutputRendererControls = {
    teardown: () => void;
    areTimestampsVisible: () => boolean;
    setTimestampVisibility: (visible: boolean) => void;
    toggleTimestampVisibility: () => void;
    areMessageTypesVisible: () => boolean;
    setMessageTypeVisibility: (visible: boolean) => void;
    toggleMessageTypeVisibility: () => void;
};

const TIMESTAMP_CLASS = 'output-show-timestamps';
const MESSAGE_TYPE_CLASS = 'output-show-message-types';

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

function createMessageTypeElement(type: string | undefined): HTMLSpanElement {
    const typeEl = document.createElement('span');
    typeEl.classList.add('output-message-type');
    typeEl.textContent = type && type.length > 0 ? type : '—';
    typeEl.dataset.messageType = type ?? '';
    typeEl.title = type ? `Message type: ${type}` : 'No message type';
    return typeEl;
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
    const typeEl = createMessageTypeElement(type);
    const contentSpan = document.createElement('span');
    contentSpan.classList.add('output-msg-content');

    const buffer = typeof message === 'string' ? new AnsiAwareBuffer(message) : message;
    if (buffer.length === 0) {
        contentSpan.innerHTML = '&nbsp;';
    } else {
        contentSpan.appendChild(buffer.toDom());
        buffer.notifyRender(contentSpan);
    }

    contentSpan.style.whiteSpace = 'pre-wrap';

    messageDiv.appendChild(timestampEl);
    messageDiv.appendChild(typeEl);
    messageDiv.appendChild(contentSpan);
    wrapper.appendChild(messageDiv);

    return wrapper;
}

export function setupOutputRenderer(
    source: MessageSource,
    {
        outputWrapper,
        sentinel,
        stickyArea,
        isSplitView,
        stickyLines,
        maxElements = 1000,
        trimSlack = 100,
        suppressSplitView,
    }: OutputHandlerOptions,
): OutputRendererControls {
    let timestampsVisible = false;
    let messageTypesVisible = false;

    function applyTimestampVisibility() {
        outputWrapper.classList.toggle(TIMESTAMP_CLASS, timestampsVisible);
        stickyArea.classList.toggle(TIMESTAMP_CLASS, timestampsVisible);
    }

    function applyMessageTypeVisibility() {
        outputWrapper.classList.toggle(MESSAGE_TYPE_CLASS, messageTypesVisible);
        stickyArea.classList.toggle(MESSAGE_TYPE_CLASS, messageTypesVisible);
    }

    const handleMessage = (message?: string | AnsiAwareBuffer, type?: string, timestamp?: number) => {
        if (message === undefined || message === null) {
            return;
        }

        const timestampValue = typeof timestamp === 'number' ? timestamp : Date.now();
        const wrapper = createMessageWrapper(message, type, timestampValue);

        outputWrapper.insertBefore(wrapper, sentinel);

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

    const unsubscribeMessage = source.on('message', handleMessage);

    return {
        teardown: () => { unsubscribeMessage(); },
        areTimestampsVisible: () => timestampsVisible,
        setTimestampVisibility: (visible: boolean) => {
            timestampsVisible = visible;
            applyTimestampVisibility();
        },
        toggleTimestampVisibility: () => {
            timestampsVisible = !timestampsVisible;
            applyTimestampVisibility();
        },
        areMessageTypesVisible: () => messageTypesVisible,
        setMessageTypeVisibility: (visible: boolean) => {
            messageTypesVisible = visible;
            applyMessageTypeVisibility();
        },
        toggleMessageTypeVisibility: () => {
            messageTypesVisible = !messageTypesVisible;
            applyMessageTypeVisibility();
        },
    };
}
