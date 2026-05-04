import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Clock, Folder, FolderOpen, Keyboard, CornerDownRight, FileCode2, Zap } from 'lucide-react';
import { Button, Input } from '../../components';
import { useAppStore } from '../../../storage';
import type { AliasNode, KeyNode, ScriptNode, TimerNode, TriggerNode, TriggerPattern, TriggerPatternType } from '../../../storage/schema';
import { isEffectivelyEnabled } from '../../../storage/schema';
import type { MudSession } from '../../../mud/MudSession';
import { LuaEditor } from './LuaEditor';
import './ScriptEditorPanel.css';

type Category = 'scripts' | 'aliases' | 'triggers' | 'timers' | 'keys';
type AnyNode = ScriptNode | AliasNode | TriggerNode | TimerNode | KeyNode;

const CATEGORY_LABELS: Record<Category, string> = {
    scripts: 'Scripts',
    aliases: 'Aliases',
    triggers: 'Triggers',
    timers: 'Timers',
    keys: 'Keys',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead']);

function formatCode(code: string): string {
    if (!code) return '';
    if (code.startsWith('Key'))    return code.slice(3);
    if (code.startsWith('Digit'))  return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
    return code;
}

function formatKeyCombo(key: string, modifiers: string[]): string {
    if (!key) return '';
    const parts = [...modifiers.map(m => m[0].toUpperCase() + m.slice(1)), formatCode(key)];
    return parts.join('+');
}

function isAncestorOf(ancestorId: string, itemId: string, items: AnyNode[]): boolean {
    const byId = new Map(items.map(i => [i.id, i]));
    let node = byId.get(itemId);
    while (node?.parentId) {
        if (node.parentId === ancestorId) return true;
        node = byId.get(node.parentId);
    }
    return false;
}

const ICON_SIZE = 13;
const ICON_STROKE = 1.6;

function ItemIcon({ category, isGroup, isExpanded }: { category: Category; isGroup: boolean; isExpanded: boolean }) {
    if (isGroup) {
        const F = isExpanded ? FolderOpen : Folder;
        return <F size={ICON_SIZE} strokeWidth={ICON_STROKE} className="script-editor__item-icon script-editor__item-icon--folder" />;
    }
    const props = { size: ICON_SIZE, strokeWidth: ICON_STROKE, className: 'script-editor__item-icon' };
    switch (category) {
        case 'scripts':  return <FileCode2       {...props} />;
        case 'aliases':  return <CornerDownRight  {...props} />;
        case 'triggers': return <Zap              {...props} />;
        case 'timers':   return <Clock            {...props} />;
        case 'keys':     return <Keyboard         {...props} />;
    }
}

/** Build a flat, ordered render list from a tree stored as a flat array. */
function flattenTree<T extends { id: string; parentId: string | null; isGroup: boolean }>(
    items: T[],
    parentId: string | null,
    expanded: Set<string>,
    depth = 0,
): Array<{ item: T; depth: number }> {
    const result: Array<{ item: T; depth: number }> = [];
    for (const item of items.filter(i => i.parentId === parentId)) {
        result.push({ item, depth });
        if (item.isGroup && expanded.has(item.id)) {
            result.push(...flattenTree(items, item.id, expanded, depth + 1));
        }
    }
    return result;
}

const EMPTY: never[] = [];

const PATTERN_TYPE_LABELS: Record<TriggerPatternType, string> = {
    substring:    'substring',
    regex:        'perl regex',
    startOfLine:  'start of line',
    exactMatch:   'exact match',
    luaFunction:  'lua function',
    lineSpacer:   'line spacer',
    colorTrigger: 'color trigger',
    prompt:       'prompt',
};

const PATTERN_NEEDS_TEXT = new Set<TriggerPatternType>(['substring', 'regex', 'startOfLine', 'exactMatch', 'luaFunction']);

const DEFAULT_LUA = `-- Mudlet-compatible Lua script
-- Core:
--   send(text)                              send a command to the MUD
--   sendAll(cmd1, cmd2, ...)                send multiple commands
--   echo(text) / echo(window, text)         plain output
--   cecho("<green>text<r>")                 named-color output (Mudlet color tags)
--   decho("<0,255,0>text<r>")               decimal RGB output
--   hecho("#00ff00text#r")                  hex RGB output
-- Timers:
--   id = tempTimer(seconds, fn)             one-shot timer
--   id = tempTimer(seconds, fn, true)       repeating timer
--   killTimer(id)
-- Aliases:
--   id = tempAlias(pattern, fn)             fn receives: matches[1]=full, matches[2..]=captures
--   killAlias(id)
-- Triggers:
--   id = tempTrigger(pattern, fn)           fn receives: matches[1]=full, matches[2..]=captures
--   killTrigger(id)
-- Events:
--   id = registerAnonymousEventHandler(event, fn)
--   killAnonymousEventHandler(id)
--   raiseEvent(name, ...)
-- Windows:
--   openUserWindow(name)                    open a text panel
--   clearWindow(name)
--   setWindowTitle(name, title)
-- GMCP:
--   gmcp.Module.SubKey                      auto-populated from server packets

registerAnonymousEventHandler("sysConnectionEvent", function()
    echo("Connected!\\n")
end)
`;

const DEFAULT_JS = `// mudix JS script (coming soon)
`;

interface LogEntry {
    text: string;
    level: 'error' | 'info';
}

interface ScriptEditorPanelProps {
    connectionId: string;
    session: MudSession;
    onScriptSave?: (script: ScriptNode) => void;
}

export function ScriptEditorPanel({ connectionId, session, onScriptSave }: ScriptEditorPanelProps) {
    const [category, setCategory] = useState<Category>('scripts');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const scripts     = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY);
    const aliases     = useAppStore(s => s.connectionAliases[connectionId] ?? EMPTY);
    const triggers    = useAppStore(s => s.connectionTriggers[connectionId] ?? EMPTY);
    const timers      = useAppStore(s => s.connectionTimers[connectionId] ?? EMPTY);
    const keybindings = useAppStore(s => s.connectionKeybindings[connectionId] ?? EMPTY);

    const addScript        = useAppStore(s => s.addScript);
    const updateScript     = useAppStore(s => s.updateScript);
    const removeScript     = useAppStore(s => s.removeScript);
    const moveScript       = useAppStore(s => s.moveScript);
    const addAlias         = useAppStore(s => s.addAlias);
    const updateAlias      = useAppStore(s => s.updateAlias);
    const removeAlias      = useAppStore(s => s.removeAlias);
    const moveAlias        = useAppStore(s => s.moveAlias);
    const addTrigger       = useAppStore(s => s.addTrigger);
    const updateTrigger    = useAppStore(s => s.updateTrigger);
    const removeTrigger    = useAppStore(s => s.removeTrigger);
    const moveTrigger      = useAppStore(s => s.moveTrigger);
    const addTimer         = useAppStore(s => s.addTimer);
    const updateTimer      = useAppStore(s => s.updateTimer);
    const removeTimer      = useAppStore(s => s.removeTimer);
    const moveTimer        = useAppStore(s => s.moveTimer);
    const addKeybinding    = useAppStore(s => s.addKeybinding);
    const updateKeybinding = useAppStore(s => s.updateKeybinding);
    const removeKeybinding = useAppStore(s => s.removeKeybinding);
    const moveKeybinding   = useAppStore(s => s.moveKeybinding);

    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Common edit state
    const [editName, setEditName]     = useState('');
    const [editLang, setEditLang]     = useState<'lua' | 'js'>('lua');
    const [editCode, setEditCode]     = useState('');
    // Alias extra
    const [editPattern, setEditPattern]   = useState('');
    // Trigger extra
    const [editPatterns, setEditPatterns] = useState<TriggerPattern[]>([]);
    // Timer extra
    const [editSeconds, setEditSeconds]   = useState(60);
    const [editRepeat, setEditRepeat]     = useState(true);
    // Key extra
    const [editKey, setEditKey]               = useState('');
    const [editModifiers, setEditModifiers]   = useState<string[]>([]);
    const [capturing, setCapturing]           = useState(false);
    // Script extra: event handlers (newline-separated)
    const [editEventHandlers, setEditEventHandlers] = useState('');

    const [dirty, setDirty] = useState(false);
    const [logs, setLogs]   = useState<LogEntry[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Drag-and-drop state
    const [dragId, setDragId]   = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{ id: string; intent: 'before' | 'into' | 'after' } | null>(null);

    const items: AnyNode[] =
        category === 'scripts'  ? scripts  :
        category === 'aliases'  ? aliases  :
        category === 'triggers' ? triggers :
        category === 'timers'   ? timers   :
        keybindings;

    const treeEntries = flattenTree(items, null, expanded);
    const selected = items.find(i => i.id === selectedId) ?? null;

    useEffect(() => {
        setSelectedId(null);
        setCapturing(false);
        setDirty(false);
        setExpanded(new Set());
    }, [category]);

    useEffect(() => {
        if (!selected) return;
        setEditName(selected.name);
        setEditLang(selected.language);
        setEditCode(selected.code);
        if (category === 'aliases') setEditPattern((selected as AliasNode).pattern ?? '');
        if (category === 'triggers') setEditPatterns((selected as TriggerNode).patterns ?? []);
        if (category === 'scripts') setEditEventHandlers((selected as ScriptNode).eventHandlers?.join('\n') ?? '');
        if (category === 'timers') {
            const t = selected as TimerNode;
            setEditSeconds(t.seconds);
            setEditRepeat(t.repeat);
        }
        if (category === 'keys') {
            const k = selected as KeyNode;
            setEditKey(k.key);
            setEditModifiers(k.modifiers);
        }
        setCapturing(false);
        setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, category]);

    useEffect(() => {
        return session.events.on('script.log', (text, level) => {
            setLogs(prev => [...prev, { text, level }]);
        });
    }, [session]);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [logs]);

    useEffect(() => {
        if (!capturing) return;
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.code === 'Escape') { setCapturing(false); return; }
            if (MODIFIER_KEYS.has(e.key)) return;
            const mods: string[] = [];
            if (e.ctrlKey)  mods.push('ctrl');
            if (e.shiftKey) mods.push('shift');
            if (e.altKey)   mods.push('alt');
            if (e.metaKey)  mods.push('meta');
            setEditKey(e.code);
            setEditModifiers(mods);
            setCapturing(false);
            setDirty(true);
        };
        document.addEventListener('keydown', onKeyDown, { capture: true });
        return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
    }, [capturing]);

    const handleDragStart = (e: React.DragEvent, id: string) => {
        if ((e.target as HTMLElement).closest('.script-editor__item-expand')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        // Delay so the item doesn't immediately look "dragging" before the ghost renders
        setTimeout(() => setDragId(id), 0);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, item: AnyNode) => {
        if (!dragId || dragId === item.id || isAncestorOf(dragId, item.id, items)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const intent: 'before' | 'into' | 'after' =
            item.isGroup && relY > 0.3 && relY < 0.7 ? 'into' :
            relY < 0.5 ? 'before' : 'after';
        setDragOver(prev => (prev?.id === item.id && prev?.intent === intent) ? prev : { id: item.id, intent });
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: AnyNode) => {
        e.preventDefault();
        const id = dragId ?? e.dataTransfer.getData('text/plain');
        if (!id || id === target.id || isAncestorOf(id, target.id, items)) return;

        const intent = dragOver?.intent ?? 'before';
        let newParentId: string | null;
        let insertBeforeId: string | null;

        if (intent === 'into') {
            newParentId = target.id;
            insertBeforeId = null;
        } else {
            newParentId = target.parentId;
            if (intent === 'before') {
                insertBeforeId = target.id;
            } else {
                const siblings = items.filter(i => i.parentId === target.parentId);
                const idx = siblings.findIndex(i => i.id === target.id);
                insertBeforeId = siblings[idx + 1]?.id ?? null;
            }
        }

        if (category === 'scripts')        moveScript(connectionId, id, newParentId, insertBeforeId);
        else if (category === 'aliases')   moveAlias(connectionId, id, newParentId, insertBeforeId);
        else if (category === 'triggers')  moveTrigger(connectionId, id, newParentId, insertBeforeId);
        else if (category === 'timers')    moveTimer(connectionId, id, newParentId, insertBeforeId);
        else                               moveKeybinding(connectionId, id, newParentId, insertBeforeId);

        // Auto-expand the group we dropped into
        if (intent === 'into') {
            setExpanded(prev => { const next = new Set(prev); next.add(target.id); return next; });
        }

        setDragId(null);
        setDragOver(null);
    };

    const handleDragEnd = () => {
        setDragId(null);
        setDragOver(null);
    };

    const handleNew = (asGroup = false) => {
        const parentId = selected?.isGroup
            ? selected.id
            : selected?.parentId ?? null;

        if (parentId) {
            setExpanded(prev => { const next = new Set(prev); next.add(parentId); return next; });
        }

        let id: string;
        if (category === 'scripts') {
            id = addScript(connectionId, {
                name: asGroup ? 'New Group' : 'New Script',
                language: 'lua',
                code: asGroup ? '' : DEFAULT_LUA,
                enabled: true,
                isGroup: asGroup,
                parentId,
                eventHandlers: [],
            });
        } else if (category === 'aliases') {
            id = addAlias(connectionId, {
                name: asGroup ? 'New Group' : 'New Alias',
                pattern: '',
                language: 'lua',
                code: '',
                enabled: true,
                isGroup: asGroup,
                parentId,
            });
        } else if (category === 'triggers') {
            id = addTrigger(connectionId, {
                name: asGroup ? 'New Group' : 'New Trigger',
                patterns: asGroup ? [] : [{ text: '', type: 'regex' }],
                language: 'lua',
                code: '',
                enabled: true,
                isGroup: asGroup,
                parentId,
            });
        } else if (category === 'timers') {
            id = addTimer(connectionId, {
                name: asGroup ? 'New Group' : 'New Timer',
                seconds: 60,
                language: 'lua',
                code: '',
                repeat: true,
                enabled: true,
                isGroup: asGroup,
                parentId,
            });
        } else {
            id = addKeybinding(connectionId, {
                name: asGroup ? 'New Group' : 'New Key',
                key: '',
                modifiers: [],
                language: 'lua',
                code: '',
                enabled: true,
                isGroup: asGroup,
                parentId,
            });
        }
        setSelectedId(id);
    };

    const handleToggle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const item = items.find(i => i.id === id);
        if (!item) return;
        if (category === 'scripts')        updateScript(connectionId, id, { enabled: !item.enabled });
        else if (category === 'aliases')   updateAlias(connectionId, id, { enabled: !item.enabled });
        else if (category === 'triggers')  updateTrigger(connectionId, id, { enabled: !item.enabled });
        else if (category === 'timers')    updateTimer(connectionId, id, { enabled: !item.enabled });
        else                               updateKeybinding(connectionId, id, { enabled: !item.enabled });
    };

    const handleToggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleSave = () => {
        if (!selectedId || !selected) return;
        setLogs([]);
        if (category === 'scripts') {
            const handlers = editEventHandlers.split('\n').map(s => s.trim()).filter(Boolean);
            updateScript(connectionId, selectedId, { name: editName, language: editLang, code: editCode, eventHandlers: handlers });
            onScriptSave?.({ ...(selected as ScriptNode), name: editName, language: editLang, code: editCode, eventHandlers: handlers });
        } else if (category === 'aliases') {
            updateAlias(connectionId, selectedId, { name: editName, pattern: editPattern, language: editLang, code: editCode });
        } else if (category === 'triggers') {
            updateTrigger(connectionId, selectedId, { name: editName, patterns: editPatterns, language: editLang, code: editCode });
        } else if (category === 'timers') {
            updateTimer(connectionId, selectedId, { name: editName, seconds: editSeconds, repeat: editRepeat, language: editLang, code: editCode });
        } else {
            updateKeybinding(connectionId, selectedId, { name: editName, key: editKey, modifiers: editModifiers, language: editLang, code: editCode });
        }
        setDirty(false);
    };

    const handleDelete = () => {
        if (!selectedId) return;
        if (category === 'scripts')        removeScript(connectionId, selectedId);
        else if (category === 'aliases')   removeAlias(connectionId, selectedId);
        else if (category === 'triggers')  removeTrigger(connectionId, selectedId);
        else if (category === 'timers')    removeTimer(connectionId, selectedId);
        else                               removeKeybinding(connectionId, selectedId);
        setSelectedId(null);
    };

    const handleTabKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end   = ta.selectionEnd;
        const next  = editCode.slice(0, start) + '  ' + editCode.slice(end);
        setEditCode(next);
        setDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    };

    const categoryLabel = CATEGORY_LABELS[category].toLowerCase();
    const emptyMsg = items.length === 0
        ? `No ${categoryLabel} yet — click "+ New" to create one`
        : `Select a ${categoryLabel.replace(/s$/, '')} to edit`;

    return (
        <div className="script-editor">
            {/* Category nav */}
            <div className="script-editor__nav">
                {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
                    <button
                        key={cat}
                        className={`script-editor__nav-btn${category === cat ? ' script-editor__nav-btn--active' : ''}`}
                        onClick={() => setCategory(cat)}
                    >
                        {CATEGORY_LABELS[cat]}
                    </button>
                ))}
            </div>

            {/* Item list */}
            <div className="script-editor__list">
                <div className="script-editor__list-header">
                    <Button variant="secondary" size="sm" onClick={() => handleNew(false)}>+ New</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleNew(true)}>+ Group</Button>
                </div>
                <div
                    className="script-editor__items"
                    onDragLeave={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                    }}
                >
                    {treeEntries.map(({ item, depth }) => {
                        const effective = isEffectivelyEnabled(item, items);
                        const isSelected = item.id === selectedId;
                        const isExpanded = expanded.has(item.id);
                        const isOver = dragOver?.id === item.id;
                        return (
                            <div
                                key={item.id}
                                draggable
                                className={[
                                    'script-editor__item',
                                    isSelected ? 'script-editor__item--selected' : '',
                                    item.isGroup ? 'script-editor__item--group' : '',
                                    !effective ? 'script-editor__item--inherited-disabled' : '',
                                    item.id === dragId ? 'script-editor__item--dragging' : '',
                                    isOver && dragOver!.intent === 'before' ? 'script-editor__item--drop-before' : '',
                                    isOver && dragOver!.intent === 'after'  ? 'script-editor__item--drop-after'  : '',
                                    isOver && dragOver!.intent === 'into'   ? 'script-editor__item--drop-into'   : '',
                                ].filter(Boolean).join(' ')}
                                onClick={() => setSelectedId(item.id)}
                                style={{ paddingLeft: `${8 + depth * 14}px` }}
                                onDragStart={e => handleDragStart(e, item.id)}
                                onDragOver={e => handleDragOver(e, item)}
                                onDrop={e => handleDrop(e, item)}
                                onDragEnd={handleDragEnd}
                            >
                                {item.isGroup ? (
                                    <button
                                        className="script-editor__item-expand"
                                        onClick={e => handleToggleExpand(item.id, e)}
                                        tabIndex={-1}
                                        title={isExpanded ? 'Collapse' : 'Expand'}
                                    >
                                        <ItemIcon category={category} isGroup={true} isExpanded={isExpanded} />
                                    </button>
                                ) : (
                                    <span className="script-editor__item-spacer">
                                        <ItemIcon category={category} isGroup={false} isExpanded={false} />
                                    </span>
                                )}
                                <input
                                    type="checkbox"
                                    checked={item.enabled}
                                    onChange={() => {}}
                                    onClick={e => handleToggle(item.id, e)}
                                    style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                                />
                                <span className="script-editor__item-name">
                                    {item.name}
                                    {'key' in item && (item as KeyNode).key && (
                                        <span className="script-editor__item-key">
                                            {formatKeyCombo((item as KeyNode).key, (item as KeyNode).modifiers)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Editor pane */}
            {selected ? (
                <div className="script-editor__pane">
                    <div className="script-editor__meta">
                        <div className="script-editor__meta-row">
                            {selected.isGroup && (
                                <span className="script-editor__group-badge">Group</span>
                            )}
                            <Input
                                className="script-editor__name"
                                value={editName}
                                onChange={e => { setEditName(e.target.value); setDirty(true); }}
                                placeholder="Name"
                            />
                            <select
                                className="script-editor__lang-select"
                                value={editLang}
                                onChange={e => {
                                    const lang = e.target.value as 'lua' | 'js';
                                    setEditLang(lang);
                                    if (!dirty && category === 'scripts') setEditCode(lang === 'lua' ? DEFAULT_LUA : DEFAULT_JS);
                                    setDirty(true);
                                }}
                            >
                                <option value="lua">Lua</option>
                                <option value="js">JS</option>
                            </select>
                        </div>
                        {category === 'aliases' && (
                            <div className="script-editor__meta-row">
                                <Input
                                    className="script-editor__pattern"
                                    value={editPattern}
                                    onChange={e => { setEditPattern(e.target.value); setDirty(true); }}
                                    placeholder="Pattern (regex)"
                                />
                            </div>
                        )}
                        {category === 'triggers' && !selected.isGroup && (
                            <div className="script-editor__meta-row script-editor__meta-row--col">
                                <span className="script-editor__field-label">Patterns</span>
                                <div className="script-editor__pattern-list">
                                    {editPatterns.map((p, i) => (
                                        <div key={i} className="script-editor__pattern-row">
                                            <select
                                                className="script-editor__pattern-type"
                                                value={p.type}
                                                onChange={e => {
                                                    const next = [...editPatterns];
                                                    next[i] = { ...next[i], type: e.target.value as TriggerPatternType };
                                                    setEditPatterns(next);
                                                    setDirty(true);
                                                }}
                                            >
                                                {(Object.entries(PATTERN_TYPE_LABELS) as [TriggerPatternType, string][]).map(([t, label]) => (
                                                    <option key={t} value={t}>{label}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="text"
                                                className="script-editor__pattern-text"
                                                value={p.text}
                                                disabled={!PATTERN_NEEDS_TEXT.has(p.type)}
                                                placeholder={p.type === 'luaFunction' ? 'function name' : 'pattern'}
                                                spellCheck={false}
                                                onChange={e => {
                                                    const next = [...editPatterns];
                                                    next[i] = { ...next[i], text: e.target.value };
                                                    setEditPatterns(next);
                                                    setDirty(true);
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="script-editor__pattern-remove"
                                                onClick={() => { setEditPatterns(editPatterns.filter((_, j) => j !== i)); setDirty(true); }}
                                                title="Remove pattern"
                                            >×</button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="script-editor__pattern-add"
                                        onClick={() => { setEditPatterns([...editPatterns, { text: '', type: 'regex' }]); setDirty(true); }}
                                    >+ Add pattern</button>
                                </div>
                            </div>
                        )}
                        {category === 'scripts' && (
                            <div className="script-editor__meta-row script-editor__meta-row--col">
                                <span className="script-editor__field-label">Event handlers (one event name per line)</span>
                                <textarea
                                    className="script-editor__patterns"
                                    value={editEventHandlers}
                                    onChange={e => { setEditEventHandlers(e.target.value); setDirty(true); }}
                                    placeholder="sysConnectionEvent"
                                    spellCheck={false}
                                />
                            </div>
                        )}
                        {category === 'keys' && (
                            <div className="script-editor__meta-row">
                                <button
                                    type="button"
                                    className={`script-editor__key-capture${capturing ? ' script-editor__key-capture--active' : ''}`}
                                    onClick={() => setCapturing(c => !c)}
                                >
                                    {capturing
                                        ? 'Press a key… (Esc to cancel)'
                                        : (formatKeyCombo(editKey, editModifiers) || 'Click to capture key')}
                                </button>
                            </div>
                        )}
                        {category === 'timers' && (
                            <div className="script-editor__meta-row">
                                <span className="script-editor__field-label">Every</span>
                                <input
                                    type="number"
                                    className="script-editor__seconds"
                                    value={editSeconds}
                                    min={1}
                                    onChange={e => { setEditSeconds(Number(e.target.value)); setDirty(true); }}
                                />
                                <span className="script-editor__field-label">sec</span>
                                <label className="script-editor__repeat">
                                    <input
                                        type="checkbox"
                                        checked={editRepeat}
                                        onChange={e => { setEditRepeat(e.target.checked); setDirty(true); }}
                                    />
                                    Repeat
                                </label>
                            </div>
                        )}
                    </div>

                    {editLang === 'lua' ? (
                        <LuaEditor
                            value={editCode}
                            onChange={code => { setEditCode(code); setDirty(true); }}
                        />
                    ) : (
                        <textarea
                            className="script-editor__code"
                            value={editCode}
                            onChange={e => { setEditCode(e.target.value); setDirty(true); }}
                            onKeyDown={handleTabKey}
                            spellCheck={false}
                            autoComplete="off"
                        />
                    )}

                    <div className="script-editor__log">
                        {logs.length === 0
                            ? <span className="script-editor__log-empty">No output</span>
                            : logs.map((entry, i) => (
                                <div key={i} className={`script-editor__log-entry script-editor__log-entry--${entry.level}`}>
                                    {entry.text}
                                </div>
                            ))
                        }
                        <div ref={logEndRef} />
                    </div>

                    <div className="script-editor__actions">
                        <Button variant="ghost" size="sm" onClick={handleDelete}>Delete</Button>
                        <Button variant="primary" size="sm" onClick={handleSave}>
                            {category === 'scripts'
                                ? (dirty ? 'Save & Run' : 'Run')
                                : (dirty ? 'Save' : 'Saved')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="script-editor__empty">{emptyMsg}</div>
            )}
        </div>
    );
}
