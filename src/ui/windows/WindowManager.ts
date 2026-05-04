import { type CursorOps, type OutputRendererControls } from '../output/OutputRenderer';
import type { DockSide, WindowHandle, WindowOpenOptions, ScriptWindowRenderData } from './types';

interface ScriptWindowData extends ScriptWindowRenderData {
    pendingText: string[];
}

const TEXT_BUFFER_LIMIT = 5000;

const DEFAULT_SIZE: Record<'text' | 'html' | 'map', { w: number; h: number }> = {
    text: { w: 400, h: 300 },
    html: { w: 400, h: 300 },
    map:  { w: 500, h: 400 },
};

const DEFAULT_DOCK_EXTENTS: Record<DockSide, number> = {
    left: 250, right: 250, top: 150, bottom: 150,
};

export type WindowsChangedFn = (
    windows: ScriptWindowRenderData[],
    dockExtents: Record<DockSide, number>,
) => void;

export class WindowManager {
    private readonly windows       = new Map<string, ScriptWindowData>();
    private readonly controls      = new Map<string, OutputRendererControls>();
    private readonly elements      = new Map<string, HTMLElement>();
    private readonly lineBuffers   = new Map<string, string>();
    private readonly portalTargets = new Map<string, HTMLDivElement>();
    private readonly activeTabGroups = new Map<string, string>(); // groupId → active panelId
    private cursorRegistry: Map<string, CursorOps> | null = null;
    private windowHints: Record<string, WindowOpenOptions> = {};
    private nextZ       = 10;
    private nextDockOrder = 0;
    private readonly dockExtents: Record<DockSide, number> = { ...DEFAULT_DOCK_EXTENTS };

    onWindowsChange?:     WindowsChangedFn;
    onWindowHint?:        (id: string, hint: WindowOpenOptions) => void;
    /** Called when a window is explicitly closed — use to clear its auto-open flag. */
    onWindowClosed?:      (id: string) => void;
    /** Called when a dock side's extent changes — use to persist it. */
    onDockExtentsChange?: (extents: Record<DockSide, number>) => void;

    setCursorRegistry(registry: Map<string, CursorOps>): void {
        this.cursorRegistry = registry;
    }

    setWindowHints(hints: Record<string, WindowOpenOptions>): void {
        this.windowHints = hints;
        // Auto-restore windows that were open when the connection was last closed.
        for (const [id, hint] of Object.entries(hints)) {
            if (hint.autoOpen && !this.windows.has(id)) {
                this.open(id, hint);
            }
        }
    }

    /** Restore saved dock extents from storage (called on connect, before setWindowHints). */
    setDockExtentsFromStorage(extents: Record<string, number>): void {
        for (const [side, size] of Object.entries(extents)) {
            if (size !== undefined) this.dockExtents[side as DockSide] = size;
        }
        this.notify();
    }

    /** Call after setting onWindowsChange to deliver current state immediately.
     *  Needed because windows may have been opened (e.g. autoOpen) before the
     *  React subscriber mounted. */
    initialize(): void {
        this.notify();
    }

    // ── Portal target ─────────────────────────────────────────────────────────

    /** Returns the stable portal-target div for a window, creating it on first call.
     *  This div is physically moved between dock slots and floating frames — the
     *  panel component rendered into it never unmounts during transitions. */
    getOrCreatePortalTarget(id: string): HTMLDivElement {
        if (!this.portalTargets.has(id)) {
            const div = document.createElement('div');
            div.style.display = 'contents';
            this.portalTargets.set(id, div);
        }
        return this.portalTargets.get(id)!;
    }

    getPortalTarget(id: string): HTMLDivElement | undefined {
        return this.portalTargets.get(id);
    }

    // ── Panel mount / unmount ─────────────────────────────────────────────────

    registerTextPanel(id: string, controls: OutputRendererControls, element: HTMLElement): void {
        this.controls.set(id, controls);
        const win = this.windows.get(id);
        if (win?.pendingText.length) {
            for (const line of win.pendingText) controls.push(line);
            win.pendingText = [];
        }
        this.elements.set(id, element);
    }

    register(id: string, element: HTMLElement, _kind: 'html'): void {
        this.elements.set(id, element);
        const win = this.windows.get(id);
        if (win?.pendingText.length) {
            for (const line of win.pendingText) element.insertAdjacentHTML('beforeend', line);
            win.pendingText = [];
        }
    }

    registerCursor(id: string, ops: CursorOps): void {
        this.cursorRegistry?.set(id, ops);
    }

    unregister(id: string): void {
        this.controls.delete(id);
        this.elements.delete(id);
        this.cursorRegistry?.delete(id);
    }

    // ── Floating window drag / resize ─────────────────────────────────────────

    setPosition(id: string, x: number, y: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.x = x;
        win.y = y;
        this.notify();
        this.saveHint(id, win);
    }

    setSize(id: string, width: number, height: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.width  = Math.max(150, width);
        win.height = Math.max(80, height);
        this.notify();
        this.saveHint(id, win);
    }

    bringToFront(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.zIndex = ++this.nextZ;
        this.notify();
    }

    // ── Dock management ───────────────────────────────────────────────────────

    dock(id: string, side: DockSide, slotIndex?: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.dockGroup)  this.removeFromGroup(id);
        if (win.splitGroup) this.removeFromSplitGroup(id);
        const existing = [...this.windows.values()]
            .filter(w => w.docked === side)
            .sort((a, b) => (a.dockOrder ?? 0) - (b.dockOrder ?? 0));
        // Unique dockOrder values represent logical slots (all members of a tab/split
        // group share one dockOrder). Translate the visual slot index to a dockOrder
        // value so that sparse dockOrders (from previous undock/redock cycles) don't
        // cause the panel to land at the wrong position.
        const slotOrders = [...new Set(existing.map(w => w.dockOrder ?? 0))];
        let insertAt: number;
        if (slotIndex === undefined || slotIndex >= slotOrders.length) {
            insertAt = slotOrders.length > 0 ? slotOrders[slotOrders.length - 1] + 1 : 0;
        } else {
            insertAt = slotOrders[slotIndex];
        }
        existing.forEach(w => {
            if ((w.dockOrder ?? 0) >= insertAt) w.dockOrder = (w.dockOrder ?? 0) + 1;
        });
        win.docked    = side;
        win.dockOrder = insertAt;
        win.dockFlex  = 1;
        win.visible   = true;
        this.notify();
        this.saveHint(id, win);
    }

    /** Stack panel `id` as a tab with panel `targetId` (or into its existing group). */
    tabIntoGroup(id: string, targetId: string): void {
        const source = this.windows.get(id);
        const target = this.windows.get(targetId);
        if (!source || !target || !target.docked) return;
        // Leave any existing group membership
        if (source.dockGroup) this.removeFromGroup(id);

        // Get or create the target's group
        let groupId: string;
        if (target.dockGroup) {
            groupId = target.dockGroup;
        } else {
            groupId = `grp_${targetId}`;
            target.dockGroup = groupId;
            target.tabOrder  = 0;
            this.activeTabGroups.set(groupId, targetId);
            this.saveHint(targetId, target);
        }

        const members   = [...this.windows.values()].filter(w => w.dockGroup === groupId);
        const maxOrder  = members.reduce((m, w) => Math.max(m, w.tabOrder ?? 0), -1);

        source.docked    = target.docked;
        source.dockOrder = target.dockOrder;
        source.dockFlex  = target.dockFlex;
        source.dockGroup = groupId;
        source.tabOrder  = maxOrder + 1;
        source.visible   = true;
        // If the target panel lives inside a split group, the new tab member must
        // inherit the same split position so it's rendered inside the split slot.
        if (target.splitGroup) {
            source.splitGroup = target.splitGroup;
            source.splitOrder = target.splitOrder;
            source.splitFlex  = target.splitFlex;
        }

        this.activeTabGroups.set(groupId, id);
        this.notify();
        this.saveHint(id, source);
    }

    setActiveTab(panelId: string): void {
        const win = this.windows.get(panelId);
        if (!win?.dockGroup) return;
        this.activeTabGroups.set(win.dockGroup, panelId);
        this.notify();
    }

    /** Split panel `id` above or below `targetId` (cross-axis within the same dock slot). */
    splitIntoGroup(id: string, targetId: string, splitBefore: boolean): void {
        const source = this.windows.get(id);
        const target = this.windows.get(targetId);
        if (!source || !target || !target.docked) return;
        if (source.dockGroup)  this.removeFromGroup(id);
        if (source.splitGroup) this.removeFromSplitGroup(id);

        let splitGroupId: string;
        if (target.splitGroup) {
            splitGroupId = target.splitGroup;
        } else if (target.dockGroup) {
            // Entire tab group becomes one split member — assign splitGroup to every
            // member so SplitGroupPanel can render the group as a unit without creating
            // a panel that has both dockGroup and splitGroup in isolation.
            splitGroupId = `splt_${target.dockGroup}`;
            const tabSplitOrder = splitBefore ? 1 : 0;
            for (const m of this.windows.values()) {
                if (m.dockGroup !== target.dockGroup) continue;
                m.splitGroup = splitGroupId;
                m.splitOrder = tabSplitOrder;
                m.splitFlex  = 1;
                this.saveHint(m.id, m);
            }
            source.docked     = target.docked;
            source.dockOrder  = target.dockOrder;
            source.dockFlex   = target.dockFlex;
            source.splitGroup = splitGroupId;
            source.splitOrder = splitBefore ? 0 : 1;
            source.splitFlex  = 1;
            source.visible    = true;
            this.notify();
            this.saveHint(id, source);
            return;
        } else {
            splitGroupId = `splt_${targetId}`;
            target.splitGroup = splitGroupId;
            target.splitOrder = 0;
            target.splitFlex  = 1;
            this.saveHint(targetId, target);
        }

        const members  = [...this.windows.values()]
            .filter(w => w.splitGroup === splitGroupId)
            .sort((a, b) => (a.splitOrder ?? 0) - (b.splitOrder ?? 0));
        const targetIdx = members.findIndex(m => m.id === targetId);
        const insertAt  = splitBefore ? (targetIdx < 0 ? 0 : targetIdx) : (targetIdx < 0 ? members.length : targetIdx + 1);

        members.forEach(w => {
            if ((w.splitOrder ?? 0) >= insertAt) w.splitOrder = (w.splitOrder ?? 0) + 1;
        });

        source.docked     = target.docked;
        source.dockOrder  = target.dockOrder;
        source.dockFlex   = target.dockFlex;
        source.splitGroup = splitGroupId;
        source.splitOrder = insertAt;
        source.splitFlex  = 1;
        source.visible    = true;

        this.notify();
        this.saveHint(id, source);
    }

    setSplitFlex(panelId: string, flex: number): void {
        const win = this.windows.get(panelId);
        if (!win?.splitGroup) return;
        const normalized = Math.max(0.05, flex);
        // Update all panels at the same split position (tab group members share a slot)
        for (const w of this.windows.values()) {
            if (w.splitGroup === win.splitGroup && w.splitOrder === win.splitOrder) {
                w.splitFlex = normalized;
                this.saveHint(w.id, w);
            }
        }
        this.notify();
    }

    /** Undock. Pass the panel's screen rect so the floating window appears in-place. */
    undock(id: string, visualWidth?: number, visualHeight?: number, screenX?: number, screenY?: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.dockGroup)  this.removeFromGroup(id);
        if (win.splitGroup) this.removeFromSplitGroup(id);
        const side = win.docked;
        if (visualWidth  !== undefined) win.width  = visualWidth;
        else if (side === 'left' || side === 'right') win.width = this.dockExtents[side!];
        if (visualHeight !== undefined) win.height = visualHeight;
        else if (side === 'top' || side === 'bottom') win.height = this.dockExtents[side!];
        if (screenX !== undefined) win.x = screenX;
        if (screenY !== undefined) win.y = screenY;
        delete win.docked;
        delete win.dockOrder;
        delete win.dockFlex;
        win.visible = true;
        win.zIndex  = ++this.nextZ;
        this.notify();
        this.saveHint(id, win);
    }

    getDockExtent(side: DockSide): number {
        return this.dockExtents[side];
    }

    setDockExtent(side: DockSide, size: number): void {
        const min = side === 'left' || side === 'right' ? 80 : 50;
        this.dockExtents[side] = Math.max(min, size);
        this.notify();
        this.onDockExtentsChange?.({ ...this.dockExtents });
    }

    setDockFlex(id: string, flex: number): void {
        const win = this.windows.get(id);
        if (!win?.docked) return;
        win.dockFlex = Math.max(0.05, flex);
        this.notify();
        this.saveHint(id, win);
    }

    /** Set flex for all panels in the same slot (by panel ID, tab-group ID, or split-group ID). */
    setSlotFlex(slotId: string, flex: number): void {
        const normalized = Math.max(0.05, flex);
        for (const win of this.windows.values()) {
            if (win.id === slotId || win.dockGroup === slotId || win.splitGroup === slotId) {
                win.dockFlex = normalized;
            }
        }
        this.notify();
        for (const win of this.windows.values()) {
            if (win.id === slotId || win.dockGroup === slotId || win.splitGroup === slotId) {
                this.saveHint(win.id, win);
            }
        }
    }

    // ── Scripting API ─────────────────────────────────────────────────────────

    open(id: string, options: WindowOpenOptions = {}): WindowHandle {
        const existing = this.windows.get(id);
        if (existing) {
            if (options.title) existing.title = options.title;
            existing.visible = true;
            existing.zIndex  = ++this.nextZ;
            this.notify();
            return this.makeHandle(id);
        }

        const kind = options.kind ?? 'text';
        const hint = options.ignoreHint ? undefined : this.windowHints[id];
        const def  = DEFAULT_SIZE[kind];

        // Determine dock state, following Mudlet semantics:
        //   autoDock=false           → always float
        //   hint present             → restore saved dock position
        //   dockingArea (no hint)    → dock to that side
        //   otherwise                → float
        let docked: DockSide | undefined;
        let dockOrder: number | undefined;
        let dockFlex: number | undefined;
        let dockGroup: string | undefined;
        let tabOrder: number | undefined;
        let splitGroup: string | undefined;
        let splitOrder: number | undefined;
        let splitFlex: number | undefined;

        if (options.autoDock === false) {
            // Force floating
        } else if (hint?.docked) {
            docked    = hint.docked;
            dockOrder = hint.dockOrder;
            dockFlex  = hint.dockFlex;
            if (hint.dockGroup) {
                dockGroup = hint.dockGroup;
                tabOrder  = hint.tabOrder;
                if (hint.isActiveTab || !this.activeTabGroups.has(hint.dockGroup)) {
                    this.activeTabGroups.set(hint.dockGroup, id);
                }
            }
            if (hint.splitGroup) {
                splitGroup = hint.splitGroup;
                splitOrder = hint.splitOrder;
                splitFlex  = hint.splitFlex;
            }
        } else if (options.dockingArea && options.dockingArea !== 'main') {
            const areaMap: Partial<Record<string, DockSide>> = {
                left: 'left', right: 'right', top: 'top', bottom: 'bottom',
            };
            docked = areaMap[options.dockingArea];
            if (docked) { dockFlex = 1; dockOrder = ++this.nextDockOrder; }
        }

        const win: ScriptWindowData = {
            id,
            title:       options.title ?? (kind === 'map' ? 'Map' : id),
            kind,
            visible:     hint?.hidden !== true,
            x:           hint?.x      ?? this.defaultX(options.position),
            y:           hint?.y      ?? this.defaultY(options.position),
            width:       hint?.width  ?? options.width  ?? def.w,
            height:      hint?.height ?? options.height ?? def.h,
            zIndex:      ++this.nextZ,
            docked,
            dockOrder,
            dockFlex,
            dockGroup,
            tabOrder,
            splitGroup,
            splitOrder,
            splitFlex,
            pendingText: [],
        };

        this.windows.set(id, win);
        this.windowHints[id] = {
            ...this.windowHints[id],
            kind:     win.kind,
            autoOpen: options.autoOpen ?? this.windowHints[id]?.autoOpen,
        };
        this.saveHint(id, win);
        this.notify();
        return this.makeHandle(id);
    }

    close(id: string): void {
        this.windows.delete(id);
        this.controls.delete(id);
        this.elements.delete(id);
        this.lineBuffers.delete(id);
        this.portalTargets.delete(id);
        this.cursorRegistry?.delete(id);
        this.onWindowClosed?.(id);
        this.notify();
    }

    clearAll(): void {
        for (const id of this.windows.keys()) {
            this.controls.delete(id);
            this.elements.delete(id);
            this.lineBuffers.delete(id);
            this.portalTargets.delete(id);
            this.cursorRegistry?.delete(id);
        }
        this.windows.clear();
        this.notify();
    }

    hide(id: string): void {
        const win = this.windows.get(id);
        if (!win || !win.visible) return;
        win.visible = false;
        this.saveHint(id, win);
        this.notify();
    }

    show(id: string): void {
        const win = this.windows.get(id);
        if (!win) { this.open(id); return; }
        if (win.visible) return;
        win.visible = true;
        win.zIndex  = ++this.nextZ;
        this.saveHint(id, win);
        this.notify();
    }

    isVisible(id: string): boolean {
        return this.windows.get(id)?.visible ?? false;
    }

    write(id: string, text: string): void {
        if (!this.windows.has(id)) this.open(id, { kind: 'text', title: id });
        const win = this.windows.get(id)!;
        if (win.kind === 'map') return;

        const buffered = (this.lineBuffers.get(id) ?? '') + text;
        const lines    = buffered.split('\n');
        for (let i = 0; i < lines.length - 1; i++) this.pushLine(win, id, lines[i]);

        const remainder = lines[lines.length - 1];
        if (remainder) this.lineBuffers.set(id, remainder);
        else           this.lineBuffers.delete(id);
    }

    flushLine(id: string): void {
        const partial = this.lineBuffers.get(id);
        if (!partial) return;
        this.lineBuffers.delete(id);
        const win = this.windows.get(id);
        if (win) this.pushLine(win, id, partial);
    }

    flushAllLines(): void {
        for (const id of this.lineBuffers.keys()) this.flushLine(id);
    }

    clear(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.pendingText = [];
        this.lineBuffers.delete(id);
        this.controls.get(id)?.clear();
        const el = this.elements.get(id);
        if (el && win.kind === 'html') el.replaceChildren();
    }

    setTitle(id: string, title: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.title = title;
        this.notify();
    }

    focus(id: string): void { this.bringToFront(id); }
    has(id: string): boolean { return this.windows.has(id); }
    getElement(id: string): HTMLElement | null { return this.elements.get(id) ?? null; }

    // ── Private ───────────────────────────────────────────────────────────────

    private pushLine(win: ScriptWindowData, id: string, line: string): void {
        if (win.kind === 'text') {
            const ctrl = this.controls.get(id);
            if (ctrl) {
                ctrl.push(line);
            } else {
                win.pendingText.push(line);
                if (win.pendingText.length > TEXT_BUFFER_LIMIT) {
                    win.pendingText.splice(0, win.pendingText.length - TEXT_BUFFER_LIMIT);
                    console.warn(`[WindowManager] pre-mount buffer for "${id}" exceeded ${TEXT_BUFFER_LIMIT} lines`);
                }
            }
        } else if (win.kind === 'html') {
            const el = this.elements.get(id);
            if (el) el.insertAdjacentHTML('beforeend', line);
            else    win.pendingText.push(line);
        }
    }

    private defaultX(position?: string): number {
        if (position === 'right') return Math.round(window.innerWidth * 0.6);
        if (position === 'left')  return 20;
        return 20 + (this.windows.size % 8) * 30;
    }

    private defaultY(position?: string): number {
        if (position === 'above') return 20;
        if (position === 'below') return Math.round(window.innerHeight * 0.55);
        return 20 + (this.windows.size % 8) * 30;
    }

    private notify(): void {
        const arr = [...this.windows.values()]
            .map(({ id, title, kind, visible, x, y, width, height, zIndex, docked, dockOrder, dockFlex, dockGroup, tabOrder, splitGroup, splitOrder, splitFlex }) => ({
                id, title, kind, visible, x, y, width, height, zIndex,
                docked, dockOrder, dockFlex, dockGroup, tabOrder, splitGroup, splitOrder, splitFlex,
                isActiveTab: dockGroup ? this.activeTabGroups.get(dockGroup) === id : undefined,
            }))
            .sort((a, b) => a.zIndex - b.zIndex);
        this.onWindowsChange?.(arr, { ...this.dockExtents });
    }

    private saveHint(id: string, win: ScriptWindowData): void {
        const hint: WindowOpenOptions = {
            x: win.x, y: win.y, width: win.width, height: win.height,
            kind:      win.kind,
            title:     win.title,
            autoOpen:  this.windowHints[id]?.autoOpen,
            hidden:    win.visible ? undefined : true,
            docked:    win.docked,    dockOrder:  win.dockOrder,  dockFlex:  win.dockFlex,
            dockGroup: win.dockGroup, tabOrder:   win.tabOrder,
            isActiveTab: win.dockGroup ? this.activeTabGroups.get(win.dockGroup) === id : undefined,
            splitGroup: win.splitGroup, splitOrder: win.splitOrder, splitFlex: win.splitFlex,
        };
        this.windowHints[id] = hint;
        this.onWindowHint?.(id, hint);
    }

    private removeFromSplitGroup(id: string): void {
        const win = this.windows.get(id);
        if (!win?.splitGroup) return;
        const groupId = win.splitGroup;
        delete win.splitGroup;
        delete win.splitOrder;
        delete win.splitFlex;

        // Dissolve group when only one distinct split position remains.
        // Tab groups in a split share one splitOrder, so count unique orders not panels.
        const remaining = [...this.windows.values()].filter(w => w.splitGroup === groupId);
        const uniqueOrders = new Set(remaining.map(w => w.splitOrder ?? 0));
        if (uniqueOrders.size <= 1) {
            for (const last of remaining) {
                delete last.splitGroup;
                delete last.splitOrder;
                delete last.splitFlex;
                this.saveHint(last.id, last);
            }
        }
    }

    private removeFromGroup(id: string): void {
        const win = this.windows.get(id);
        if (!win?.dockGroup) return;
        const groupId = win.dockGroup;
        delete win.dockGroup;
        delete win.tabOrder;

        // Switch active tab if this was the active one
        if (this.activeTabGroups.get(groupId) === id) {
            const remaining = [...this.windows.values()].filter(w => w.dockGroup === groupId);
            if (remaining.length > 0) {
                this.activeTabGroups.set(groupId, remaining[0].id);
            } else {
                this.activeTabGroups.delete(groupId);
            }
        }

        // Dissolve group when only one panel remains
        const remaining = [...this.windows.values()].filter(w => w.dockGroup === groupId);
        if (remaining.length === 1) {
            const last = remaining[0];
            delete last.dockGroup;
            delete last.tabOrder;
            this.activeTabGroups.delete(groupId);
            this.saveHint(last.id, last);
        } else if (remaining.length === 0) {
            this.activeTabGroups.delete(groupId);
        }
    }

    private makeHandle(id: string): WindowHandle {
        const m = this;
        return {
            get id()      { return id; },
            get kind()    { return m.windows.get(id)?.kind ?? 'text'; },
            get element() { return m.elements.get(id) ?? document.createElement('div'); },
            write(text)   { m.write(id, text); },
            clear()       { m.clear(id); },
            setTitle(t)   { m.setTitle(id, t); },
            focus()       { m.focus(id); },
            close()       { m.close(id); },
        };
    }
}
