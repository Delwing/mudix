import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from './components';
import { useProfileField } from '../storage';
import { useCommandHistory } from './useCommandHistory';
import { computeLcp, matchHistory, type Match } from './commandHistory';
import type { CmdLineMenuEntry, CmdLineMenuRegistry } from './CmdLineMenuRegistry';

interface CommandBarProps {
    command: string;
    onCommandChange: (command: string) => void;
    passwordMode?: boolean;
    commandInputRef: React.RefObject<HTMLInputElement>;
    onSubmit: () => void;
    cmdLineMenu: CmdLineMenuRegistry;
    /** Tab-completion suggestions added via Mudlet's addCmdLineSuggestion API.
     *  Merged ahead of command history (dedup, case-insensitive). */
    suggestions?: string[];
}

export function CommandBar({ command, onCommandChange, passwordMode, commandInputRef, onSubmit, cmdLineMenu, suggestions }: CommandBarProps) {
    const [menu, setMenu] = useState<{ x: number; y: number; items: CmdLineMenuEntry[] } | null>(null);
    const inputBackground = useProfileField('inputBackground');
    const inputForeground = useProfileField('inputForeground');
    const inputStyle = (inputBackground || inputForeground) ? {
        ...(inputBackground ? { background: inputBackground } : {}),
        ...(inputForeground ? { color: inputForeground } : {}),
    } : undefined;

    const { history, add: pushHistory } = useCommandHistory();

    // -1 = "draft" slot (the user's pre-traversal text); otherwise an index
    // into the MRU `history` array.
    const [cursor, setCursor] = useState(-1);
    const draftRef = useRef(command);
    const isComposingRef = useRef(false);

    // Last value we know is in `command`. Lets us distinguish edits coming
    // *through* this component (typing / traversal / Tab) from external
    // updates fired via script.setcmd / script.appendcmd, which need to reset
    // the traversal cursor and re-arm the draft.
    const lastValueRef = useRef(command);

    // After traversal or Tab, we want the caret pinned at end after the value
    // re-renders. Set inside the keydown handler, applied in useLayoutEffect.
    const pendingCaretEndRef = useRef(false);

    const [ghostHidden, setGhostHidden] = useState(false);

    // Suggestions (from Mudlet's addCmdLineSuggestion) come before history so
    // they outrank older entries when prefix kinds tie. Dedup is case-insensitive
    // — typing the same word in either source shouldn't produce a duplicate row.
    const candidates = useMemo<string[]>(() => {
        if (!suggestions || suggestions.length === 0) return history;
        const seen = new Set<string>();
        const out: string[] = [];
        for (const s of suggestions) {
            const k = s.toLowerCase();
            if (!seen.has(k)) { seen.add(k); out.push(s); }
        }
        for (const h of history) {
            const k = h.toLowerCase();
            if (!seen.has(k)) { seen.add(k); out.push(h); }
        }
        return out;
    }, [suggestions, history]);

    const matches = useMemo<Match[]>(
        () => (passwordMode ? [] : matchHistory(command, candidates)),
        [command, candidates, passwordMode],
    );

    const ghostText = useMemo(() => {
        if (passwordMode || ghostHidden || matches.length === 0) return '';
        const top = matches[0];
        // Only a true prefix match produces a visible inline ghost — anything
        // else would shift the displayed glyph and look like a glitch.
        if (top.kind !== 'prefix-start') return '';
        return top.item.slice(command.length);
    }, [matches, command, ghostHidden, passwordMode]);

    // External `command` updates (script.setcmd / appendcmd / clearcmd) snap
    // us back to the draft slot and re-arm the ghost.
    useEffect(() => {
        if (command === lastValueRef.current) return;
        lastValueRef.current = command;
        draftRef.current = command;
        setCursor(-1);
        setGhostHidden(false);
    }, [command]);

    useLayoutEffect(() => {
        if (!pendingCaretEndRef.current) return;
        pendingCaretEndRef.current = false;
        const el = commandInputRef.current;
        if (!el) return;
        const len = el.value.length;
        el.setSelectionRange(len, len);
    });

    useEffect(() => {
        commandInputRef.current?.focus();
    }, [commandInputRef]);

    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            const root = document.getElementById('mudix-cmdline-menu');
            if (root && !root.contains(e.target as Node)) setMenu(null);
        };
        const onClose = () => setMenu(null);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [menu]);

    const setValue = (val: string) => {
        lastValueRef.current = val;
        onCommandChange(val);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        draftRef.current = val;
        setCursor(-1);
        setGhostHidden(false);
        setValue(val);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isComposingRef.current) return;
        if (!command) return;
        if (!passwordMode) pushHistory(command);
        draftRef.current = command;
        setCursor(-1);
        setGhostHidden(false);
        onSubmit();
    };

    const tryTabComplete = (): boolean => {
        if (matches.length === 0) return false;
        const lcp = computeLcp(matches, command);
        const target = lcp ?? matches[0].item;
        draftRef.current = target;
        setCursor(-1);
        pendingCaretEndRef.current = true;
        setValue(target);
        return true;
    };

    const traverseTo = (newCursor: number) => {
        if (newCursor === -1) {
            setCursor(-1);
            pendingCaretEndRef.current = true;
            setValue(draftRef.current);
        } else {
            setCursor(newCursor);
            pendingCaretEndRef.current = true;
            setValue(history[newCursor]);
        }
    };

    const qualifiesForTraversal = (): boolean => {
        const el = commandInputRef.current;
        if (!el) return false;
        const len = el.value.length;
        if (len === 0) return true;
        const s = el.selectionStart ?? 0;
        const e = el.selectionEnd ?? 0;
        if (s === 0 && e === len) return true;  // full selection
        if (s === 0 && e === 0) return true;    // caret at start
        if (s === len && e === len) return true; // caret at end
        return false;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (isComposingRef.current || e.nativeEvent.isComposing) return;

        if (e.key === 'Escape') {
            if (ghostText) {
                setGhostHidden(true);
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !passwordMode) {
            // Always consume — keeps focus in the input regardless of whether
            // the input has matches to complete against.
            e.preventDefault();
            if (matches.length === 0) return;
            tryTabComplete();
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (!qualifiesForTraversal()) return;
            if (history.length === 0 && cursor === -1) return;

            if (e.key === 'ArrowUp') {
                if (cursor === -1) draftRef.current = command;
                const next = Math.min(cursor + 1, history.length - 1);
                if (next !== cursor) {
                    e.preventDefault();
                    traverseTo(next);
                } else if (history.length > 0) {
                    // At the oldest entry already — still consume the keypress
                    // so caret doesn't jump unexpectedly.
                    e.preventDefault();
                }
            } else {
                if (cursor === -1) return; // already on draft; let native do nothing
                e.preventDefault();
                traverseTo(cursor - 1);
            }
        }
    };

    const handleCompositionStart = () => { isComposingRef.current = true; };
    const handleCompositionEnd = () => { isComposingRef.current = false; };

    const handleContextMenu = (e: React.MouseEvent<HTMLInputElement>) => {
        const items = cmdLineMenu.list();
        if (items.length === 0) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items });
    };

    return (
        <form className="command-bar" onSubmit={handleSubmit}>
            <div className="command-input-wrap">
                <span className="prompt" aria-hidden="true">&gt;</span>

                {ghostText && (
                    <div className="command-ghost" aria-hidden="true">
                        <span className="command-ghost__shadow">{command}</span>
                        <span className="command-ghost__suffix">{ghostText}</span>
                    </div>
                )}

                <Input
                    ref={commandInputRef}
                    className="command-input"
                    type={passwordMode ? 'password' : 'text'}
                    value={command}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onContextMenu={handleContextMenu}
                    placeholder={passwordMode ? 'Enter password…' : 'Enter command…'}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Command input"
                    style={inputStyle}
                />
            </div>

            <Button
                variant="secondary"
                type="submit"
            >
                Send
            </Button>

            {menu && (
                <div
                    id="mudix-cmdline-menu"
                    className="map-context-menu"
                    style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {menu.items.map(item => (
                        <div
                            key={item.uniqueName}
                            className="map-context-menu-item"
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                cmdLineMenu.dispatch(item.uniqueName, command);
                                setMenu(null);
                            }}
                        >
                            <span className="map-context-menu-label">{item.displayName}</span>
                        </div>
                    ))}
                </div>
            )}
        </form>
    );
}
