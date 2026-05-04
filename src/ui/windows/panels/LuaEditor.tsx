import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, indentUnit, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { luaCompletionSource, HOVER_MAP } from '../../../scripting/lua/luaCompletions';

// ── Theme ─────────────────────────────────────────────────────────────────────

const mudixTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '13px',
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
        overflow: 'auto',
    },
    '.cm-content': {
        caretColor: 'var(--accent)',
        padding: '10px 0',
    },
    '.cm-line': { padding: '0 12px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(78, 201, 176, 0.18)',
    },
    '.cm-gutters': {
        background: '#0d0d0d',
        borderRight: '1px solid var(--border)',
        color: 'var(--text-dim)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
        minWidth: '36px',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-activeLineGutter': {
        backgroundColor: 'rgba(255,255,255,0.025)',
        color: 'var(--text)',
    },
    '.cm-matchingBracket': {
        background: 'rgba(78,201,176,0.15)',
        outline: '1px solid rgba(78,201,176,0.35)',
    },
    // Autocomplete dropdown
    '.cm-tooltip': {
        background: '#1a1a1a',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        color: 'var(--text)',
    },
    '.cm-tooltip-autocomplete > ul': {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        maxHeight: '220px',
    },
    '.cm-tooltip-autocomplete > ul > li': {
        padding: '3px 10px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        background: 'var(--accent-dim)',
        color: 'var(--text)',
    },
    '.cm-completionDetail': {
        color: '#9090a0',
        fontStyle: 'normal',
        marginLeft: '8px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
        color: '#b0d8d0',
    },
    '.cm-completionInfo': {
        background: '#1a1a1a',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '6px 10px',
        color: 'var(--text-dim)',
        fontSize: '11px',
        maxWidth: '320px',
    },
    // Hover tooltip
    '.cm-lua-hover': {
        padding: '6px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        maxWidth: '360px',
    },
    '.cm-lua-hover__header': {
        display: 'flex',
        alignItems: 'baseline',
        gap: '2px',
        flexWrap: 'wrap',
    },
    '.cm-lua-hover__name': {
        color: '#dcdcaa',
        fontWeight: '500',
    },
    '.cm-lua-hover__sig': {
        color: '#9090a0',
    },
    '.cm-lua-hover__info': {
        marginTop: '5px',
        color: '#a0a0b0',
        fontSize: '11px',
        lineHeight: '1.5',
    },
    // Scrollbar
    '.cm-scroller::-webkit-scrollbar': { width: '6px', height: '6px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
        background: 'var(--border)',
        borderRadius: '3px',
    },
}, { dark: true });

// ── Hover tooltip ─────────────────────────────────────────────────────────────

const luaHover = hoverTooltip((view, pos) => {
    const word = view.state.wordAt(pos);
    if (!word) return null;

    const label = view.state.sliceDoc(word.from, word.to);
    if (!label || !/^[a-zA-Z_]/.test(label)) return null;

    // Walk left to pick up any dotted namespace prefix (e.g. "mudix.windows.")
    const lookback = view.state.sliceDoc(Math.max(0, word.from - 60), word.from);
    const prefixMatch = lookback.match(/([\w.]+\.)$/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const fullName = prefix + label;

    // Most-specific match first, then bare label as fallback
    const entry = HOVER_MAP.get(fullName) ?? HOVER_MAP.get(label);
    if (!entry) return null;

    const infoText = typeof entry.info === 'string' ? entry.info : null;
    if (!entry.detail && !infoText) return null;

    return {
        pos: word.from,
        end: word.to,
        above: true,
        arrow: true,
        create() {
            const dom = document.createElement('div');
            dom.className = 'cm-lua-hover';

            const header = document.createElement('div');
            header.className = 'cm-lua-hover__header';

            const nameEl = document.createElement('span');
            nameEl.className = 'cm-lua-hover__name';
            nameEl.textContent = fullName;
            header.appendChild(nameEl);

            if (entry.detail) {
                const sigEl = document.createElement('span');
                sigEl.className = 'cm-lua-hover__sig';
                sigEl.textContent = entry.detail;
                header.appendChild(sigEl);
            }

            dom.appendChild(header);

            if (infoText) {
                const infoEl = document.createElement('div');
                infoEl.className = 'cm-lua-hover__info';
                infoEl.textContent = infoText;
                dom.appendChild(infoEl);
            }

            return { dom };
        },
    };
});

// ── Extensions ────────────────────────────────────────────────────────────────

function buildExtensions(onChangeFn: () => void) {
    return [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        closeBrackets(),
        indentUnit.of('  '),
        StreamLanguage.define(lua),
        syntaxHighlighting(oneDarkHighlightStyle),
        autocompletion({ override: [luaCompletionSource], activateOnTyping: true }),
        luaHover,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeFn();
        }),
        mudixTheme,
    ];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
    value: string;
    onChange: (value: string) => void;
}

export function LuaEditor({ value, onChange }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef      = useRef<EditorView | null>(null);
    const onChangeRef  = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return;

        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: buildExtensions(() => {
                    onChangeRef.current(viewRef.current!.state.doc.toString());
                }),
            }),
            parent: containerRef.current,
        });

        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync external value changes (script switch, revert, etc.)
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: value },
                selection: { anchor: 0 },
            });
        }
    }, [value]);

    return <div ref={containerRef} className="lua-editor" />;
}
