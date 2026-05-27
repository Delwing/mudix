/**
 * `start` is the offset of the capture in the source line; `length` is the
 * capture's byte length. Used by `selectCaptureGroup` to re-select the actual
 * occurrence rather than the first textual match of the captured substring.
 */
export type CaptureSpan = { start: number; length: number };

export interface IScriptingRuntime {
    load(code: string, name: string): void;
    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): void;
    /** Dispatch an event to user-registered handlers. Handlers run synchronously. */
    emitEvent(event: string, args: unknown[]): void;
    /**
     * Write a single GMCP message into the runtime's `gmcp` table. The leaf
     * at `path` is replaced; sibling subtrees are preserved (Mudlet parity).
     */
    setGmcpValue(path: string, value: unknown): void;
    /**
     * Write a single MSDP variable into the runtime's `msdp` table. `path` is
     * the flat top-level variable name; the top-level key is replaced.
     */
    setMsdpValue(path: string, value: unknown): void;
    runWithMatches(
        code: string,
        name: string,
        matches: string[],
        multimatches?: string[][],
        namedGroups?: Record<string, string>,
        captureSpans?: CaptureSpan[],
        namedSpans?: Record<string, CaptureSpan>,
        fullMatchSpan?: CaptureSpan,
    ): void;
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
    /**
     * Kill every event handler registered by `wrapScript` for the given
     * script id. Called when a script is removed or disabled so its handlers
     * stop firing without waiting for a full runtime reload.
     */
    killScriptHandlers(scriptId: string): void;
}
