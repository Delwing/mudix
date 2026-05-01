import type { MudSession } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import mudletColors from '../mud/text/mudletColors.json';

// ── Color conversion utilities ────────────────────────────────────────────────

const MUDLET_COLORS = mudletColors as unknown as Record<string, [number, number, number]>;

function namedColorToAnsi(name: string, bg = false): string {
    if (name === 'r' || name === 'reset') return '\x1b[0m';
    const c = MUDLET_COLORS[name];
    if (!c) return '';
    return `\x1b[${bg ? 48 : 38};2;${c[0]};${c[1]};${c[2]}m`;
}

/** cecho: <color_name>text<r>  or  <b:color_name>text for background */
function parseCecho(text: string): string {
    return text.replace(/<([^>]+)>/g, (_, tag: string) => {
        if (tag.startsWith('b:')) return namedColorToAnsi(tag.slice(2), true);
        return namedColorToAnsi(tag);
    }) + '\x1b[0m';
}

/** decho: <r,g,b>text  or  <:r,g,b>text for background, <r> to reset */
function parseDecho(text: string): string {
    return text
        .replace(/<(:?)(\d+),(\d+),(\d+)>/g, (_, bg, r, g, b) =>
            `\x1b[${bg ? 48 : 38};2;${r};${g};${b}m`)
        .replace(/<r>/g, '\x1b[0m') + '\x1b[0m';
}

/** hecho: #RRGGBBtext  or  #:RRGGBBtext for background, #r to reset */
function parseHecho(text: string): string {
    return text
        .replace(/#(:?)([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/g,
            (_, bg, rh, gh, bh) =>
                `\x1b[${bg ? 48 : 38};2;${parseInt(rh, 16)};${parseInt(gh, 16)};${parseInt(bh, 16)}m`)
        .replace(/#r/g, '\x1b[0m') + '\x1b[0m';
}

// ── Timers ────────────────────────────────────────────────────────────────────

class ScriptingTimersAPI {
    private readonly handles: Set<ReturnType<typeof setTimeout>> = new Set();

    /** Schedule `fn` to run after `seconds`. Returns a function that cancels the timer. */
    after(seconds: number, fn: () => void): () => void {
        const handle = setTimeout(() => {
            this.handles.delete(handle);
            fn();
        }, seconds * 1000);
        this.handles.add(handle);
        return () => {
            clearTimeout(handle);
            this.handles.delete(handle);
        };
    }

    destroy(): void {
        for (const h of this.handles) clearTimeout(h);
        this.handles.clear();
    }
}

// ── Windows ───────────────────────────────────────────────────────────────────

class ScriptingWindowsAPI {
    constructor(private readonly session: MudSession) {}

    open(id: string, options?: WindowOpenOptions): WindowHandle {
        return this.session.windows.open(id, options);
    }

    write(id: string, text: string): void {
        this.session.windows.write(id, text);
    }

    clear(id: string): void {
        this.session.windows.clear(id);
    }

    setTitle(id: string, title: string): void {
        this.session.windows.setTitle(id, title);
    }

    focus(id: string): void {
        this.session.windows.focus(id);
    }

    close(id: string): void {
        this.session.windows.close(id);
    }

    has(id: string): boolean {
        return this.session.windows.has(id);
    }

    element(id: string): HTMLElement | null {
        return this.session.windows.getElement(id);
    }
}

// ── Main API ──────────────────────────────────────────────────────────────────

export class ScriptingAPI {
    readonly windows: ScriptingWindowsAPI;
    readonly timers: ScriptingTimersAPI;
    readonly aliases: AliasEngine;
    readonly triggers: TriggerEngine;
    readonly gmcp: Record<string, unknown> = {};
    private lineBuffer = '';

    constructor(private readonly session: MudSession, aliasEngine: AliasEngine, triggerEngine: TriggerEngine) {
        this.windows = new ScriptingWindowsAPI(session);
        this.timers = new ScriptingTimersAPI();
        this.aliases = aliasEngine;
        this.triggers = triggerEngine;
    }

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string): void {
        this.session.send(text);
    }

    echo(text: string): void {
        this.bufferText(text);
    }

    cecho(text: string): void {
        this.bufferText(parseCecho(text));
    }

    decho(text: string): void {
        this.bufferText(parseDecho(text));
    }

    hecho(text: string): void {
        this.bufferText(parseHecho(text));
    }

    fg(name: string): void {
        this.bufferText(namedColorToAnsi(name, false));
    }

    bg(name: string): void {
        this.bufferText(namedColorToAnsi(name, true));
    }

    resetFormat(): void {
        this.bufferText('\x1b[0m');
    }

    /**
     * Feed `text` through the trigger pipeline as if it arrived from the MUD.
     * Emits `message` so the text appears in the output window, then emits
     * `flushLines` so ScriptingEngine runs pattern triggers and fires the Lua
     * `output` event — identical to what real MUD data does.
     */
    feedTriggers(text: string): void {
        this.flushOutput();
        this.session.events.emit('message', text, 'mud', Date.now());
        this.session.events.emit('flushLines', [{ text, type: 'mud' }]);
    }

    /** Flush any buffered partial line to the output. Called after each event dispatch. */
    flushOutput(): void {
        if (this.lineBuffer.length === 0) return;
        this.session.events.emit('message', this.lineBuffer, 'script');
        this.lineBuffer = '';
    }

    /** @deprecated use echo() */
    print(text: string): void {
        this.echo(text);
    }

    printError(text: string): void {
        this.session.events.emit('script.log', text, 'error');
    }

    updateGmcp(path: string, value: unknown): void {
        const parts = path.split('.');
        let node = this.gmcp as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (typeof node[key] !== 'object' || node[key] === null) {
                node[key] = {};
            }
            node = node[key] as Record<string, unknown>;
        }
        node[parts[parts.length - 1]] = value;
    }

    destroy(): void {
        this.flushOutput();
        this.timers.destroy();
    }

    // Split on newlines: emit each complete line immediately, buffer the remainder.
    private bufferText(text: string): void {
        const combined = this.lineBuffer + text;
        const lines = combined.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
            this.session.events.emit('message', lines[i], 'script');
        }
        this.lineBuffer = lines[lines.length - 1];
    }
}
