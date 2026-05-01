export interface IScriptingRuntime {
    load(code: string, name: string): void;
    emitEvent(event: string, args: unknown[]): void;
    processInput(text: string): boolean;
    /** Fire all Lua-registered temp triggers that match `line`. Sets `matches` per trigger. */
    processTrigger(line: string): void;
    runWithMatches(code: string, name: string, matches: string[]): void;
    destroy(): void;
}
