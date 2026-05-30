import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaseSensitive, ChevronDown, ChevronRight, Clock, Folder, Keyboard, MousePointerClick, Regex, Search, Shuffle, FileCode2, Zap } from 'lucide-react';
import { useAppStore } from '../../../storage';
import type { AliasNode, ButtonNode, KeyNode, ScriptNode, TimerNode, TriggerNode, TriggerPattern } from '../../../storage/schema';
import './ScriptSearch.css';

export type EditCategory = 'scripts' | 'aliases' | 'triggers' | 'timers' | 'keys' | 'buttons';
type AnyNode = ScriptNode | AliasNode | TriggerNode | TimerNode | KeyNode | ButtonNode;

const EMPTY: never[] = [];

const CATEGORY_SINGULAR: Record<EditCategory, string> = {
    scripts: 'Script', aliases: 'Alias', triggers: 'Trigger',
    timers: 'Timer', keys: 'Key', buttons: 'Button',
};

const CATEGORY_ICON: Record<EditCategory, React.ElementType> = {
    scripts: FileCode2, aliases: Shuffle, triggers: Zap,
    timers: Clock, keys: Keyboard, buttons: MousePointerClick,
};

function formatCode(code: string): string {
    if (!code) return '';
    if (code.startsWith('Key'))    return code.slice(3);
    if (code.startsWith('Digit'))  return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
    return code;
}

function formatKeyCombo(key: string, modifiers: string[]): string {
    if (!key) return '';
    return [...modifiers.map(m => m[0].toUpperCase() + m.slice(1)), formatCode(key)].join('+');
}

// ── Matching ────────────────────────────────────────────────────────────────

type MatchRange = [number, number];

interface SearchMatcher {
    valid: boolean;
    ranges: (s: string) => MatchRange[];
}

const NO_RANGES: MatchRange[] = [];

/** Compile a search bar query into a matcher honouring the case / regex flags. */
function buildMatcher(pattern: string, matchCase: boolean, useRegex: boolean): SearchMatcher {
    if (!pattern) return { valid: true, ranges: () => NO_RANGES };
    if (useRegex) {
        let re: RegExp;
        try {
            re = new RegExp(pattern, matchCase ? 'g' : 'gi');
        } catch {
            return { valid: false, ranges: () => NO_RANGES };
        }
        return {
            valid: true,
            ranges: (s) => {
                const out: MatchRange[] = [];
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(s)) !== null) {
                    out.push([m.index, m.index + m[0].length]);
                    if (m[0].length === 0) re.lastIndex++; // never spin on a zero-width match
                }
                return out;
            },
        };
    }
    const needle = matchCase ? pattern : pattern.toLowerCase();
    return {
        valid: true,
        ranges: (s) => {
            const hay = matchCase ? s : s.toLowerCase();
            const out: MatchRange[] = [];
            for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
                out.push([i, i + needle.length]);
            }
            return out;
        },
    };
}

interface SearchOccurrence {
    meta: string;
    what: string;
    ranges: MatchRange[];
    line?: number;
}

/** Scan every user-facing text field of a node and return one occurrence per
 *  matching field (one per matching line for code). */
function findOccurrences(item: AnyNode, matcher: SearchMatcher): SearchOccurrence[] {
    const occ: SearchOccurrence[] = [];
    const any = item as unknown as Record<string, unknown>;
    const codeLabel = any.language === 'js' ? 'JS' : 'Lua';

    const field = (meta: string, value: unknown) => {
        if (typeof value !== 'string' || !value) return;
        const what = value.trim();
        const ranges = matcher.ranges(what);
        if (ranges.length) occ.push({ meta, what, ranges });
    };

    field('name', item.name);
    field('pattern', any.pattern);
    if (Array.isArray(any.patterns)) {
        for (const p of any.patterns as TriggerPattern[]) field('pattern', p.text);
    }
    field('command', any.command);
    field('command ↓', any.commandDown);
    field('tooltip', any.tooltip);
    field('icon', any.icon);
    if (Array.isArray(any.eventHandlers)) {
        for (const e of any.eventHandlers as string[]) field('event', e);
    }
    if ('key' in item && (item as KeyNode).key) {
        field('key', formatKeyCombo((item as KeyNode).key, (item as KeyNode).modifiers));
    }

    if (typeof any.code === 'string' && any.code) {
        const lines = (any.code as string).split('\n');
        for (let i = 0; i < lines.length; i++) {
            const what = lines[i].trim();
            const ranges = matcher.ranges(what);
            if (ranges.length) occ.push({ meta: `${codeLabel} ${i + 1}`, what, ranges, line: i + 1 });
        }
    }
    return occ;
}

/** Render `text` with the given match ranges wrapped in highlight marks. */
function HighlightedText({ text, ranges }: { text: string; ranges: MatchRange[] }) {
    if (ranges.length === 0) return <>{text}</>;
    const parts: React.ReactNode[] = [];
    let last = 0;
    ranges.forEach(([start, end], i) => {
        if (start > last) parts.push(text.slice(last, start));
        parts.push(<mark key={i} className="script-search__mark">{text.slice(start, end)}</mark>);
        last = end;
    });
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
}

function ItemIcon({ category, isGroup }: { category: EditCategory; isGroup: boolean }) {
    if (isGroup) return <Folder size={13} strokeWidth={1.6} className="script-search__icon-folder" />;
    const Icon = CATEGORY_ICON[category];
    return <Icon size={13} strokeWidth={1.6} className="script-search__icon-type" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ScriptSearchProps {
    connectionId: string;
    /** Navigate the editor to a matched item (and optionally a code line). */
    onNavigate: (category: EditCategory, id: string, line?: number) => void;
}

/** Global search for the Scripts editor — lives in the modal title bar and
 *  drops a VS Code-style results overlay (rendered through a portal so it
 *  escapes the modal's `overflow: hidden`). */
export function ScriptSearch({ connectionId, onNavigate }: ScriptSearchProps) {
    const [search, setSearch] = useState('');
    const [matchCase, setMatchCase] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const scripts     = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY);
    const aliases     = useAppStore(s => s.connectionAliases[connectionId] ?? EMPTY);
    const triggers    = useAppStore(s => s.connectionTriggers[connectionId] ?? EMPTY);
    const timers      = useAppStore(s => s.connectionTimers[connectionId] ?? EMPTY);
    const keybindings = useAppStore(s => s.connectionKeybindings[connectionId] ?? EMPTY);
    const buttons     = useAppStore(s => s.connectionButtons[connectionId] ?? EMPTY);

    const searchActive = search.length > 0;
    const matcher = useMemo(() => buildMatcher(search, matchCase, useRegex), [search, matchCase, useRegex]);

    const results = useMemo(() => {
        if (!searchActive || !matcher.valid) return [];
        const lists: Array<[EditCategory, AnyNode[]]> = [
            ['scripts', scripts], ['aliases', aliases], ['triggers', triggers],
            ['timers', timers], ['keys', keybindings], ['buttons', buttons],
        ];
        const out: Array<{ category: EditCategory; item: AnyNode; occurrences: SearchOccurrence[] }> = [];
        for (const [cat, list] of lists) {
            for (const it of list) {
                const occurrences = findOccurrences(it, matcher);
                if (occurrences.length > 0) out.push({ category: cat, item: it, occurrences });
            }
        }
        return out;
    }, [searchActive, matcher, scripts, aliases, triggers, timers, keybindings, buttons]);

    const totalMatches = useMemo(() => results.reduce((n, r) => n + r.occurrences.length, 0), [results]);

    const dropdownOpen = open && searchActive;

    // Anchor the portal dropdown under the input. Recomputed whenever it opens or
    // the layout might shift (results changing height, window resize/scroll).
    useLayoutEffect(() => {
        if (!dropdownOpen) return;
        const measure = () => {
            const el = inputRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const width = Math.min(480, Math.max(300, window.innerWidth - 16));
            const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
            setRect({ left, top: r.bottom + 6, width });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [dropdownOpen, results.length]);

    // Close on outside click / Escape.
    useEffect(() => {
        if (!dropdownOpen) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (wrapRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [dropdownOpen]);

    const toggleCollapsed = useCallback((key: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const navigate = useCallback((cat: EditCategory, id: string, line?: number) => {
        onNavigate(cat, id, line);
        setOpen(false);
        setSearch('');
    }, [onNavigate]);

    return (
        <div className="script-search" ref={wrapRef}>
            <div className={`script-search__bar${searchActive && !matcher.valid ? ' script-search__bar--invalid' : ''}`}>
                <Search size={13} strokeWidth={1.8} className="script-search__bar-icon" />
                <input
                    ref={inputRef}
                    className="script-search__input"
                    type="text"
                    placeholder="Search scripts, triggers…"
                    value={search}
                    spellCheck={false}
                    onChange={e => { setSearch(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onMouseDown={e => e.stopPropagation() /* don't start a modal drag */}
                />
                <button
                    className={`script-search__toggle${matchCase ? ' script-search__toggle--on' : ''}`}
                    onClick={() => setMatchCase(v => !v)}
                    title="Match case"
                    tabIndex={-1}
                ><CaseSensitive size={14} strokeWidth={1.8} /></button>
                <button
                    className={`script-search__toggle${useRegex ? ' script-search__toggle--on' : ''}`}
                    onClick={() => setUseRegex(v => !v)}
                    title="Use regular expression"
                    tabIndex={-1}
                ><Regex size={14} strokeWidth={1.8} /></button>
                {search && (
                    <button className="script-search__clear" onClick={() => { setSearch(''); inputRef.current?.focus(); }} title="Clear" tabIndex={-1}>×</button>
                )}
            </div>

            {dropdownOpen && rect && createPortal(
                <div
                    ref={dropdownRef}
                    className="script-search__dropdown"
                    style={{ left: rect.left, top: rect.top, width: rect.width }}
                >
                    <div className="script-search__summary">
                        {!matcher.valid
                            ? 'Invalid regular expression'
                            : totalMatches === 0
                                ? 'No results'
                                : `${totalMatches} result${totalMatches === 1 ? '' : 's'} in ${results.length} item${results.length === 1 ? '' : 's'}`}
                    </div>
                    <div className="script-search__results">
                        {results.map(({ category: cat, item, occurrences }) => {
                            const key = `${cat}:${item.id}`;
                            const isCollapsed = collapsed.has(key);
                            return (
                                <div key={key} className="script-search__group">
                                    <div className="script-search__group-head" onClick={() => toggleCollapsed(key)} title={item.name}>
                                        {isCollapsed
                                            ? <ChevronRight size={14} strokeWidth={1.8} className="script-search__chevron" />
                                            : <ChevronDown size={14} strokeWidth={1.8} className="script-search__chevron" />}
                                        <ItemIcon category={cat} isGroup={item.isGroup} />
                                        <span className="script-search__group-name">{item.name}</span>
                                        <span className="script-search__group-cat">{CATEGORY_SINGULAR[cat]}</span>
                                        <span className="script-search__count">{occurrences.length}</span>
                                    </div>
                                    {!isCollapsed && occurrences.map((o, idx) => (
                                        <div
                                            key={idx}
                                            className="script-search__occ"
                                            onClick={() => navigate(cat, item.id, o.line)}
                                            title={o.what}
                                        >
                                            <span className="script-search__occ-what">
                                                <HighlightedText text={o.what} ranges={o.ranges} />
                                            </span>
                                            <span className="script-search__occ-meta">{o.meta}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
