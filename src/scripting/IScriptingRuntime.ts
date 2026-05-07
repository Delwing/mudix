export interface IScriptingRuntime {
    load(code: string, name: string): void;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): void;
    /** Dispatch an event to user-registered handlers. Handlers run synchronously. */
    emitEvent(event: string, args: unknown[]): void;
    runWithMatches(code: string, name: string, matches: string[], multimatches?: string[][], namedGroups?: Record<string, string>): void;
    destroy(): void;
    setCurrentLine(line: string, isPrompt: boolean): void;
    /**
     * Evaluate a Lua-function trigger pattern. Side effects (raiseEvent, etc.)
     * always run; the trigger "matches" only when the body returns truthy.
     */
    evalTriggerPattern(code: string): boolean;
    /**
     * Raise sysDataSendRequest and report whether a handler called
     * denyCurrentSend().
     */
    dispatchSendRequest(text: string): boolean;
}
