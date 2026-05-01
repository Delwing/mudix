export interface PermanentAlias {
    id: string;
    name: string;
    pattern: string;   // PCRE regex string
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
}

type TempFn = (matches: RegExpMatchArray) => void;

export class AliasEngine {
    private readonly temp = new Map<number, { pattern: RegExp; fn: TempFn }>();
    private nextId = 1;
    private perm: PermanentAlias[] = [];

    // ── Temp aliases (session-scoped, created by scripts) ─────────────────────

    addTemp(pattern: string | RegExp, fn: TempFn): () => void {
        const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const id = this.nextId++;
        this.temp.set(id, { pattern: re, fn });
        return () => { this.temp.delete(id); };
    }

    processTemp(input: string): boolean {
        for (const { pattern, fn } of this.temp.values()) {
            const m = input.match(pattern);
            if (m) { fn(m); return true; }
        }
        return false;
    }

    // ── Perm aliases (persisted, visible in UI) ────────────────────────────────

    loadPerm(aliases: PermanentAlias[]): void {
        this.perm = aliases.filter(a => a.enabled);
    }

    matchPerm(input: string): { alias: PermanentAlias; captures: string[] } | null {
        for (const alias of this.perm) {
            try {
                const m = input.match(new RegExp(alias.pattern));
                if (m) return { alias, captures: m.slice(1).map(c => c ?? '') };
            } catch {
                // Skip aliases with invalid patterns
            }
        }
        return null;
    }

    destroy(): void {
        this.temp.clear();
        this.perm = [];
    }
}
