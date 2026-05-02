export interface IScriptingRuntime {
    load(code: string, name: string): void;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): void;
    emitEvent(event: string, args: unknown[]): void;
    processInput(text: string): boolean;
    /** Fire all Lua-registered temp triggers that match `line`. Sets `matches` per trigger. */
    processTrigger(line: string): void;
    /** Fire the first matching Lua-registered temp keybinding. Returns true if consumed. */
    processKey(event: KeyboardEvent): boolean;
    runWithMatches(code: string, name: string, matches: string[]): void;
    destroy(): void;
}
