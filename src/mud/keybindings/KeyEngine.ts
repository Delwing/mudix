import type { KeyNode } from '../../storage/schema';
import { buildEffectivelyEnabledIds } from '../../storage/schema';

export type { KeyNode };

type TempFn = () => void;

function matchesEvent(key: string, modifiers: string[], event: KeyboardEvent): boolean {
    if (event.code !== key) return false;
    return (
        event.ctrlKey  === modifiers.includes('ctrl')  &&
        event.shiftKey === modifiers.includes('shift') &&
        event.altKey   === modifiers.includes('alt')   &&
        event.metaKey  === modifiers.includes('meta')
    );
}

export class KeyEngine {
    private readonly temp = new Map<number, { key: string; modifiers: string[]; fn: TempFn }>();
    private perm: KeyNode[] = [];
    private nextId = 1;

    // ── Temp keybindings (session-scoped, created by scripts) ─────────────────

    addTemp(key: string, modifiers: string[], fn: TempFn): number {
        const id = this.nextId++;
        this.temp.set(id, { key, modifiers, fn });
        return id;
    }

    killKey(id: number): boolean {
        const had = this.temp.has(id);
        this.temp.delete(id);
        return had;
    }

    processTemp(event: KeyboardEvent): boolean {
        for (const { key, modifiers, fn } of this.temp.values()) {
            if (matchesEvent(key, modifiers, event)) {
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
