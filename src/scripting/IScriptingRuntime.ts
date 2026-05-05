export interface IScriptingRuntime {
    load(code: string, name: string): Promise<void>;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): Promise<void>;
    emitEvent(event: string, args: unknown[]): void;
    runWithMatches(code: string, name: string, matches: string[], multimatches?: string[][], namedGroups?: Record<string, string>): Promise<void>;
    destroy(): void;
    setCurrentLine(line: string, isPrompt: boolean): void;
}
