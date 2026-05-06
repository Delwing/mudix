export interface IScriptingRuntime {
    load(code: string, name: string): Promise<void>;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): Promise<void>;
    /**
     * Dispatch an event to user-registered handlers. Returns a Promise that resolves
     * when every handler has finished running (including any async calls they make,
     * e.g. DB ops). Handlers are serialized through a per-runtime queue so they run
     * in arrival order and ordering relative to other queued Lua work is preserved.
     * Callers may fire-and-forget (handlers still run, just after current chunk).
     */
    emitEvent(event: string, args: unknown[]): Promise<void>;
    runWithMatches(code: string, name: string, matches: string[], multimatches?: string[][], namedGroups?: Record<string, string>): Promise<void>;
    destroy(): void;
    setCurrentLine(line: string, isPrompt: boolean): void;
    /**
     * Evaluate a Lua-function trigger pattern. Side effects (raiseEvent, etc.)
     * always run; the trigger "matches" only when the body returns truthy.
     * Async so the body can await DB / other JS Promise-returning bridges.
     */
    evalTriggerPattern(code: string): Promise<boolean>;
    /**
     * Raise sysDataSendRequest and report whether a handler called
     * denyCurrentSend(). Async so handlers can await DB calls before deciding.
     */
    dispatchSendRequest(text: string): Promise<boolean>;
}
