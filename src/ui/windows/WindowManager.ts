import type { DockviewApi } from 'dockview';
import { AnsiAwareBuffer } from '../../mud/text/FormatState';
import type {
    PanelKind,
    PanelPosition,
    WindowHandle,
    WindowOpenOptions,
} from './types';

interface PanelEntry {
    id: string;
    kind: PanelKind;
    /** The container element exposed to scripts. Resolved once the panel mounts. */
    element: HTMLElement | null;
    /** Buffered text written before the element was ready (text-kind only). */
    pendingText: string[];
}

const TEXT_BUFFER_LIMIT = 5000;

export class WindowManager {
    private api: DockviewApi | null = null;
    private readonly entries = new Map<string, PanelEntry>();
    private readonly pendingOpens: Array<{ id: string; options: WindowOpenOptions }> = [];

    /** Called by DockRoot once Dockview is ready. */
    attach(api: DockviewApi): void {
        this.api = api;
        const drained = this.pendingOpens.splice(0);
        for (const { id, options } of drained) this.open(id, options);
    }

    /** Called when the host React tree unmounts. */
    detach(): void {
        this.api = null;
    }

    /**
     * Called by panel components from a mount effect. Creates or updates the
     * entry for this id — restored panels (after fromJSON) won't have an entry
     * yet, so this is the canonical place to wire one up.
     */
    register(id: string, element: HTMLElement, kind: PanelKind): void {
        const existing = this.entries.get(id);
        if (existing) {
            existing.element = element;
            existing.kind = kind;
            if (kind === 'text' && existing.pendingText.length > 0) {
                for (const text of existing.pendingText) this.appendText(element, text);
                existing.pendingText = [];
            }
            return;
        }
        this.entries.set(id, {
            id,
            kind,
            element,
            pendingText: [],
        });
    }

    unregister(id: string): void {
        const entry = this.entries.get(id);
        if (entry) entry.element = null;
    }

    open(id: string, options: WindowOpenOptions = {}): WindowHandle {
        if (!this.api) {
            this.pendingOpens.push({ id, options });
            return this.makeHandle(id, options.kind ?? 'text');
        }

        const existing = this.api.getPanel(id);
        if (existing) {
            if (options.title) existing.api.setTitle(options.title);
            if (options.activate !== false) existing.api.setActive();
            return this.makeHandle(id, this.entries.get(id)?.kind ?? 'text');
        }

        const kind = options.kind ?? 'text';
        if (!this.entries.has(id)) {
            this.entries.set(id, { id, kind, element: null, pendingText: [] });
        }

        const addOptions = this.buildAddPanelOptions(id, kind, options);
        this.api.addPanel(addOptions);

        return this.makeHandle(id, kind);
    }

    close(id: string): void {
        const panel = this.api?.getPanel(id);
        if (!panel) {
            this.entries.delete(id);
            return;
        }
        panel.api.close();
        this.entries.delete(id);
    }

    write(id: string, text: string): void {
        const entry = this.entries.get(id);
        if (!entry) {
            const handle = this.open(id, { kind: 'text', title: id });
            handle.write(text);
            return;
        }
        if (entry.kind === 'output') return;
        if (!entry.element) {
            if (entry.kind === 'text') {
                entry.pendingText.push(text);
                if (entry.pendingText.length > TEXT_BUFFER_LIMIT) {
                    entry.pendingText.splice(0, entry.pendingText.length - TEXT_BUFFER_LIMIT);
                }
            }
            return;
        }
        if (entry.kind === 'text') this.appendText(entry.element, text);
        else entry.element.insertAdjacentHTML('beforeend', text);
    }

    clear(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        if (entry.kind === 'output') return;
        if (entry.element) entry.element.replaceChildren();
        entry.pendingText = [];
    }

    setTitle(id: string, title: string): void {
        const panel = this.api?.getPanel(id);
        if (panel) panel.api.setTitle(title);
    }

    focus(id: string): void {
        const panel = this.api?.getPanel(id);
        if (panel) panel.api.setActive();
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    getElement(id: string): HTMLElement | null {
        return this.entries.get(id)?.element ?? null;
    }

    /** Used by DockRoot to claim the locked Output panel id up front. */
    registerOutputEntry(id: string): void {
        if (this.entries.has(id)) return;
        this.entries.set(id, {
            id,
            kind: 'output',
            element: null,
            pendingText: [],
        });
    }

    private appendText(element: HTMLElement, text: string): void {
        const buffer = new AnsiAwareBuffer(text);
        const line = document.createElement('div');
        line.classList.add('window-text-line');
        line.style.whiteSpace = 'pre-wrap';
        if (buffer.length === 0) {
            line.innerHTML = '&nbsp;';
        } else {
            line.appendChild(buffer.toDom());
            buffer.notifyRender(line);
        }
        element.appendChild(line);
        element.scrollTop = element.scrollHeight;
    }

    private buildAddPanelOptions(
        id: string,
        kind: PanelKind,
        options: WindowOpenOptions,
    ): Parameters<DockviewApi['addPanel']>[0] {
        const component = kind === 'output' ? 'output'
            : kind === 'text' ? 'text'
            : kind === 'map' ? 'map'
            : 'html';
        const title = options.title ?? id;
        const activate = options.activate !== false;

        const params = { manager: this };

        if (options.position === 'float') {
            return {
                id,
                component,
                title,
                params,
                inactive: !activate,
                floating: {
                    width: options.floatSize?.width ?? 320,
                    height: options.floatSize?.height ?? 240,
                },
            };
        }

        const direction = directionFromPosition(options.position ?? 'right');
        const reference = options.referencePanelId ?? 'output';
        const referenceExists = !!this.api?.getPanel(reference);

        if (referenceExists && direction !== null) {
            return {
                id,
                component,
                title,
                params,
                inactive: !activate,
                position: { referencePanel: reference, direction },
            };
        }
        return {
            id,
            component,
            title,
            params,
            inactive: !activate,
        };
    }

    private makeHandle(id: string, kind: PanelKind): WindowHandle {
        const manager = this;
        return {
            id,
            kind,
            get element(): HTMLElement {
                const el = manager.entries.get(id)?.element;
                if (el) return el;
                return document.createElement('div');
            },
            write(text: string) { manager.write(id, text); },
            clear() { manager.clear(id); },
            setTitle(title: string) { manager.setTitle(id, title); },
            focus() { manager.focus(id); },
            close() { manager.close(id); },
        };
    }
}

function directionFromPosition(position: PanelPosition): 'left' | 'right' | 'above' | 'below' | 'within' | null {
    switch (position) {
        case 'left': return 'left';
        case 'right': return 'right';
        case 'above': return 'above';
        case 'below': return 'below';
        case 'within': return 'within';
        case 'float': return null;
    }
}
