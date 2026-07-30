import type { KeyNode } from '../../storage/schema';
import { buildEffectivelyEnabledIds } from '../../storage/schema';
import { domCodeToQtKey, listToQtModifiers } from './qtKeys';

export type { KeyNode };

type TempFn = () => void;

/** Mudlet getKeyCode() result — a Qt::Key integer + Qt::KeyboardModifier mask. */
export interface KeyCodeInfo {
    keyCode: number;
    modifiers: number;
}

function matchesEvent(key: string, modifiers: string[], event: KeyboardEvent): boolean {
    if (event.code !== key) return false;
    return (
        event.ctrlKey  === modifiers.includes('ctrl')  &&
        event.shiftKey === modifiers.includes('shift') &&
        event.altKey   === modifiers.includes('alt')   &&
        event.metaKey  === modifiers.includes('meta')
    );
}

interface TempKey {
    key: string;
    modifiers: string[];
    fn: TempFn;
    // The original Qt::Key / Qt modifier mask passed to tempKey, kept verbatim so
    // getKeyCode() round-trips exactly (the DOM-code translation is lossy).
    qtKey?: number;
    qtModifier?: number;
    /** Temp keys can be toggled by id, exactly like permanent ones — Mudlet's
     *  enableKey/disableKey and isActive() see no difference between them. */
    enabled: boolean;
}

export class KeyEngine {
    private readonly temp = new Map<number, TempKey>();
    private perm: KeyNode[] = [];
    private nextId = 1;

    // ── Temp keybindings (session-scoped, created by scripts) ─────────────────

    /** Number of live session-scoped temp keys (Mudlet `getProfileStats` temp count). */
    get tempCount(): number {
        return this.temp.size;
    }

    addTemp(key: string, modifiers: string[], fn: TempFn, qt?: { keyCode: number; modifier: number }): number {
        const id = this.nextId++;
        this.temp.set(id, { key, modifiers, fn, qtKey: qt?.keyCode, qtModifier: qt?.modifier, enabled: true });
        return id;
    }

    /** Whether a temp key with this id is live — backs exists(id, "key"). */
    hasTemp(id: number): boolean { return this.temp.has(id); }

    /** Whether a live temp key is enabled — backs isActive(id, "key"). */
    isTempEnabled(id: number): boolean { return this.temp.get(id)?.enabled === true; }

    /** enableKey/disableKey with a numeric id. False when no temp key matches. */
    setTempEnabled(id: number, enabled: boolean): boolean {
        const t = this.temp.get(id);
        if (!t) return false;
        t.enabled = enabled;
        return true;
    }

    /**
     * Mudlet getKeyCode(idOrName) lookup. A numeric id resolves a temp key; a
     * string resolves a permanent key by name. Returns the Qt key code + modifier
     * mask, or null when nothing matches (caller turns that into nil + errMsg).
     */
    getKeyCode(idOrName: number | string): KeyCodeInfo | null {
        if (typeof idOrName === 'number') {
            const t = this.temp.get(idOrName);
            if (!t) return null;
            return {
                keyCode: t.qtKey ?? (typeof t.key === 'string' ? domCodeToQtKey(t.key) ?? 0 : t.key),
                modifiers: t.qtModifier ?? listToQtModifiers(t.modifiers),
            };
        }
        const node = this.perm.find(k => k.name === idOrName && k.key);
        if (!node) return null;
        return { keyCode: domCodeToQtKey(node.key) ?? 0, modifiers: listToQtModifiers(node.modifiers) };
    }

    killKey(id: number): boolean {
        const had = this.temp.has(id);
        this.temp.delete(id);
        return had;
    }

    processTemp(event: KeyboardEvent): boolean {
        for (const { key, modifiers, fn, enabled } of this.temp.values()) {
            if (enabled && matchesEvent(key, modifiers, event)) {
                fn();
                return true;
            }
        }
        return false;
    }

    // ── Perm keybindings (persisted, visible in UI) ────────────────────────────

    loadPerm(keybindings: KeyNode[]): void {
        const enabledIds = buildEffectivelyEnabledIds(keybindings);
        this.perm = keybindings.filter(k => enabledIds.has(k.id) && k.key);
    }

    matchPerm(event: KeyboardEvent): KeyNode | null {
        for (const binding of this.perm) {
            if (matchesEvent(binding.key, binding.modifiers, event)) return binding;
        }
        return null;
    }

    destroy(): void {
        this.temp.clear();
        this.perm = [];
    }
}
