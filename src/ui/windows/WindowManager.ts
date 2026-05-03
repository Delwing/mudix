import type { DockviewApi } from 'dockview';
import { type CursorOps, type OutputRendererControls } from '../output/OutputRenderer';
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
    /** Renderer controls for text panels — provides push/clear and split-view. */
    controls?: OutputRendererControls | null;
}

const TEXT_BUFFER_LIMIT = 5000;

export class WindowManager {
    private api: DockviewApi | null = null;
    private readonly entries = new Map<string, PanelEntry>();
    private readonly pendingOpens: Array<{ id: string; options: WindowOpenOptions }> = [];
    // Per-window partial-line buffers — accumulate text until \n, matching main output behaviour.
    private readonly lineBuffers = new Map<string, string>();
    private cursorRegistry: Map<string, CursorOps> | null = null;
    private windowHints: Record<string, WindowOpenOptions> = {};

    /** Called by App to supply saved position hints for the active connection. */
    setWindowHints(hints: Record<string, WindowOpenOptions>): void {
        this.windowHints = hints;
    }

    /** Called after a NEW panel is opened with the effective positional options used. */
    onWindowHint?: (id: string, hint: WindowOpenOptions) => void;

    /** Wired up by MudSession so cursor ops are registered per text window. */
    setCursorRegistry(registry: Map<string, CursorOps>): void {
        this.cursorRegistry = registry;
    }

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
     * Called by non-text panel components from a mount effect (html, output).
     * Creates or updates the entry for this id.
     */
    register(id: string, element: HTMLElement, kind: PanelKind): void {
        const existing = this.entries.get(id);
        if (existing) {
            existing.element = element;
            existing.kind = kind;
            return;
        }
        this.entries.set(id, { id, kind, element, pendingText: [] });
    }

    /**
     * Called by TextPanel once its OutputRenderer is ready.
     * Drains any text buffered before the panel mounted.
     */
    registerTextPanel(id: string, controls: OutputRendererControls, element: HTMLElement): void {
        const existing = this.entries.get(id);
        if (existing) {
            existing.controls = controls;
            existing.element = element;
            for (const text of existing.pendingText) controls.push(text);
            existing.pendingText = [];
            return;
        }
        this.entries.set(id, { id, kind: 'text', element, pendingText: [], controls });
    }

    registerCursor(id: string, ops: CursorOps): void {
        this.cursorRegistry?.set(id, ops);
    }

    unregister(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.element = null;
        entry.controls = null;
        this.cursorRegistry?.delete(id);
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
            const kind = this.entries.get(id)?.kind ?? (options.kind ?? 'text');
            // Panel was restored from a saved layout — ensure a manager entry exists
            // so that write() calls buffer correctly until registerTextPanel fires.
            if (!this.entries.has(id)) {
                this.entries.set(id, { id, kind, element: null, pendingText: [] });
            }
            return this.makeHandle(id, kind);
        }

        // Merge saved position hint: hint provides positional fields only where
        // the caller has not explicitly specified them.
        const hint = this.windowHints[id];
        const mergedOptions: WindowOpenOptions = hint
            ? {
                kind: options.kind ?? hint.kind,
                position: options.position ?? hint.position,
                referencePanelId: options.referencePanelId ?? hint.referencePanelId,
                floatSize: options.floatSize ?? hint.floatSize,
                title: options.title,
                activate: options.activate,
            }
            : options;

        const kind = mergedOptions.kind ?? 'text';
        if (!this.entries.has(id)) {
            this.entries.set(id, { id, kind, element: null, pendingText: [] });
        }

        const addOptions = this.buildAddPanelOptions(id, kind, mergedOptions);
        this.api.addPanel(addOptions);

        // Persist the effective positional options as a new hint.
        const effectiveHint: WindowOpenOptions = {
            kind,
            position: mergedOptions.position,
            referencePanelId: mergedOptions.referencePanelId,
            floatSize: mergedOptions.floatSize,
        };
        this.onWindowHint?.(id, effectiveHint);

        return this.makeHandle(id, kind);
    }

    close(id: string): void {
        this.lineBuffers.delete(id);
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
        if (entry.kind === 'text') {
            // Buffer partial lines — only push complete lines (terminated by \n).
            const buffered = (this.lineBuffers.get(id) ?? '') + text;
            const lines = buffered.split('\n');
            for (let i = 0; i < lines.length - 1; i++) {
                this.pushLine(entry, id, lines[i]);
            }
            const remainder = lines[lines.length - 1];
            if (remainder) {
                this.lineBuffers.set(id, remainder);
            } else {
                this.lineBuffers.delete(id);
            }
            return;
        }
        if (entry.element) entry.element.insertAdjacentHTML('beforeend', text);
    }

    /** Flush the partial-line buffer for a single window to its renderer. */
    flushLine(id: string): void {
        const partial = this.lineBuffers.get(id);
        if (!partial) return;
        this.lineBuffers.delete(id);
        const entry = this.entries.get(id);
        if (entry?.kind === 'text') this.pushLine(entry, id, partial);
    }

    /** Flush all pending partial lines across every open window. */
    flushAllLines(): void {
        for (const id of this.lineBuffers.keys()) this.flushLine(id);
    }

    hide(id: string): void {
        const el = this.groupElement(id);
        if (el) el.style.display = 'none';
    }

    show(id: string): void {
        const el = this.groupElement(id);
        if (el) el.style.display = '';
    }

    private groupElement(id: string): HTMLElement | null {
        const panel = this.api?.getPanel(id);
        // DockviewGroupPanel extends BasePanelView which has element, but
        // BasePanelViewExported (the interface) doesn't expose it.
        return panel ? ((panel.api.group as any).element as HTMLElement) ?? null : null;
    }

    clear(id: string): void {
        this.lineBuffers.delete(id);
        const entry = this.entries.get(id);
        if (!entry) return;
        if (entry.kind === 'output') return;
        entry.pendingText = [];
        if (entry.kind === 'text') {
            entry.controls?.clear();
        } else if (entry.element) {
            entry.element.replaceChildren();
        }
    }

    private pushLine(entry: PanelEntry, id: string, line: string): void {
        if (!entry.controls) {
            entry.pendingText.push(line);
            if (entry.pendingText.length > TEXT_BUFFER_LIMIT) {
                entry.pendingText.splice(0, entry.pendingText.length - TEXT_BUFFER_LIMIT);
                console.warn(`[WindowManager] pre-mount buffer for panel "${id}" exceeded ${TEXT_BUFFER_LIMIT} lines — oldest entries dropped`);
            }
        } else {
            entry.controls.push(line);
        }
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
