import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, indentUnit, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { tags as t } from '@lezer/highlight';
import { useAppStore } from '../../../storage';
import { luaCompletionSource, HOVER_MAP } from '../../../scripting/lua/luaCompletions';

// ── Theme ─────────────────────────────────────────────────────────────────────
// Chrome (background, gutter, tooltip) themes via CSS vars; the `dark` flag and
// the syntax highlighting style are swapped per theme via Compartment below.

const mudixTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '13px',
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg)',
        color: 'var(--text)',
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
        backgroundColor: 'var(--accent-glow)',
    },
    '.cm-gutters': {
        background: 'var(--bg-input)',
        borderRight: '1px solid var(--border)',
        color: 'var(--text-dim)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
        minWidth: '36px',
    },
    '.cm-activeLine': { backgroundColor: 'var(--hover-bg)' },
    '.cm-activeLineGutter': {
        backgroundColor: 'var(--hover-bg-strong)',
        color: 'var(--text)',
    },
    '.cm-matchingBracket': {
        background: 'var(--accent-glow)',
        outline: '1px solid var(--accent-focus)',
    },
    // Autocomplete dropdown
    '.cm-tooltip': {
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-float)',
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
        background: 'var(--accent)',
        color: 'var(--btn-primary-text)',
    },
    '.cm-completionDetail': {
        color: 'var(--text-dim)',
        fontStyle: 'normal',
        marginLeft: '8px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
        color: 'var(--btn-primary-text)',
        opacity: '0.75',
    },
    '.cm-completionInfo': {
        background: 'var(--bg-surface)',
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
        color: 'var(--accent)',
        fontWeight: '500',
    },
    '.cm-lua-hover__sig': {
        color: 'var(--text-dim)',
    },
    '.cm-lua-hover__info': {
        marginTop: '5px',
        color: 'var(--text-dim)',
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
});

// ── Light syntax highlight (Atom One Light palette) ──────────────────────────

const oneLightHighlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: '#a626a4' },
    { tag: [t.deleted, t.character, t.propertyName, t.macroName], color: '#e45649' },
    { tag: [t.function(t.variableName), t.labelName], color: '#4078f2' },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#986801' },
    { tag: [t.definition(t.name), t.separator], color: '#383a42' },
    { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#c18401' },
    { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#0184bc' },
    { tag: [t.meta, t.comment], color: '#a0a1a7', fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: '#0184bc', textDecoration: 'underline' },
    { tag: t.heading, fontWeight: 'bold', color: '#a626a4' },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#986801' },
    { tag: [t.processingInstruction, t.string, t.inserted], color: '#50a14f' },
    { tag: t.invalid, color: '#e45649' },
]);

const highlightCompartment = new Compartment();

function highlightFor(theme: string): ReturnType<typeof syntaxHighlighting> {
    return theme === 'light'
        ? syntaxHighlighting(oneLightHighlightStyle)
        : syntaxHighlighting(oneDarkHighlightStyle);
}

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

function buildExtensions(onChangeFn: () => void, theme: string) {
    return [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        closeBrackets(),
        indentUnit.of('  '),
        StreamLanguage.define(lua),
        highlightCompartment.of(highlightFor(theme)),
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
    const theme = useAppStore(s => s.ui.theme);
    const themeRef = useRef(theme);
    themeRef.current = theme;

    useEffect(() => {
        if (!containerRef.current) return;

        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: buildExtensions(() => {
                    onChangeRef.current(viewRef.current!.state.doc.toString());
                }, themeRef.current),
            }),
            parent: containerRef.current,
        });

        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Swap syntax highlighting when the theme changes; preserves doc + scroll.
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
            effects: highlightCompartment.reconfigure(highlightFor(theme)),
        });
    }, [theme]);

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
