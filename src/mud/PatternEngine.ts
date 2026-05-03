type TempFn = (matches: RegExpMatchArray) => void;

type PatternItem = {
    id: string;
    name: string;
    pattern: string;
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
};

export class PatternEngine<T extends PatternItem> {
    protected readonly temp = new Map<number, { pattern: RegExp; fn: TempFn }>();
    protected nextId = 1;
    protected permCompiled: Array<{ item: T; re: RegExp }> = [];

    addTemp(pattern: string | RegExp, fn: TempFn): () => void {
        const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const id = this.nextId++;
        this.temp.set(id, { pattern: re, fn });
        return () => { this.temp.delete(id); };
    }

    loadPerm(items: T[]): void {
        this.permCompiled = [];
        for (const item of items) {
            if (!item.enabled) continue;
            try {
                this.permCompiled.push({ item, re: new RegExp(item.pattern) });
            } catch {
                // skip invalid patterns
            }
        }
    }

    destroy(): void {
        this.temp.clear();
        this.permCompiled = [];
    }
}
