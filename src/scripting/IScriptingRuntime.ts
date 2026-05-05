export interface IScriptingRuntime {
    load(code: string, name: string): Promise<void>;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): Promise<void>;
    emitEvent(event: string, args: unknown[]): void;
    runWithMatches(code: string, name: string, matches: string[], multimatches?: string[][], namedGroups?: Record<string, string>): Promise<void>;
    destroy(): void;
    setCurrentLine(line: string, isPrompt: boolean): void;
    /**
     * Evaluate a Lua-function trigger pattern: runs the user code synchronously
     * (line global is already set) and returns whether its return value is truthy.
     * Side effects (raiseEvent, etc.) execute on every line regardless of match.
     */
    evalTriggerPattern(code: string): boolean;
    /**
     * Raise sysDataSendRequest synchronously and report whether a handler called
     * denyCurrentSend(). Mudlet fires this just before send()/sendAll()/command-bar
     * input reaches the wire.
     */
    dispatchSendRequest(text: string): boolean;
}
