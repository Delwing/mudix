import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Clock, Folder, FolderOpen, FolderPlus, Keyboard, Shuffle, FileCode2, Trash2, Zap } from 'lucide-react';
import { Button, Input, ContextMenu } from '../../components';
import { useAppStore } from '../../../storage';
import type { AliasNode, KeyNode, ScriptNode, TimerNode, TriggerNode, TriggerPattern, TriggerPatternType } from '../../../storage/schema';
import { isEffectivelyEnabled } from '../../../storage/schema';
import type { MudSession } from '../../../mud/MudSession';
import { LuaEditor } from './LuaEditor';
import { parseMudletXml } from '../../../import/mudletXmlImport';
import './ScriptEditorPanel.css';

type Category = 'scripts' | 'aliases' | 'triggers' | 'timers' | 'keys' | 'errors';
type EditCategory = Exclude<Category, 'errors'>;
type AnyNode = ScriptNode | AliasNode | TriggerNode | TimerNode | KeyNode;

const EDIT_CATEGORIES: EditCategory[] = ['scripts', 'aliases', 'triggers', 'timers', 'keys'];

const CATEGORY_LABELS: Record<EditCategory, string> = {
    scripts: 'Scripts',
    aliases: 'Aliases',
    triggers: 'Triggers',
    timers: 'Timers',
    keys: 'Keys',
};

const CATEGORY_SINGULAR: Record<EditCategory, string> = {
    scripts: 'Script',
    aliases: 'Alias',
    triggers: 'Trigger',
    timers: 'Timer',
    keys: 'Key',
};

const CATEGORY_ICON: Record<EditCategory, React.ElementType> = {
    scripts:  FileCode2,
    aliases:  Shuffle,
    triggers: Zap,
    timers:   Clock,
    keys:     Keyboard,
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

function secsToHMSM(total: number) {
    const totalMs = Math.round(total * 1000);
    const ms = totalMs % 1000;
    const totalSecs = Math.floor(totalMs / 1000);
    const s = totalSecs % 60;
    const totalMins = Math.floor(totalSecs / 60);
    const m = totalMins % 60;
    const h = Math.floor(totalMins / 60);
    return { h, m, s, ms };
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
        case 'scripts':  return <FileCode2  {...props} />;
        case 'aliases':  return <Shuffle    {...props} />;
        case 'triggers': return <Zap        {...props} />;
        case 'timers':   return <Clock      {...props} />;
        case 'keys':     return <Keyboard   {...props} />;
        default:         return null;
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

const PATTERN_TYPE_COLORS: Record<TriggerPatternType, string> = {
    substring:    '#000000',
    regex:        '#0000ff',
    startOfLine:  '#ff0000',
    exactMatch:   '#00ff00',
    luaFunction:  '#00ffff',
    lineSpacer:   '#ff00ff',
    colorTrigger: '#c0c0c0',
    prompt:       '#ffff00',
};

const PATTERN_NEEDS_TEXT = new Set<TriggerPatternType>(['substring', 'regex', 'startOfLine', 'exactMatch', 'luaFunction']);

function PatternTypeSelect({ value, onChange }: { value: TriggerPatternType; onChange: (t: TriggerPatternType) => void }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos]   = useState({ x: 0, y: 0 });
    const btnRef          = useRef<HTMLButtonElement>(null);

    const toggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ x: r.left, y: r.bottom + 2 });
        }
        setOpen(v => !v);
    };

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className="script-editor__pattern-type-btn"
                onClick={toggle}
            >
                <span className="script-editor__pattern-type-swatch" style={{ background: PATTERN_TYPE_COLORS[value] }} />
                <span className="script-editor__pattern-type-label">{PATTERN_TYPE_LABELS[value]}</span>
                <span className="script-editor__pattern-type-arrow">▾</span>
            </button>
            {open && (
                <ContextMenu x={pos.x} y={pos.y} onClose={() => setOpen(false)}>
                    {(Object.entries(PATTERN_TYPE_LABELS) as [TriggerPatternType, string][]).map(([t, label]) => (
                        <button
                            key={t}
                            type="button"
                            className={`ctx-menu__item script-editor__pattern-type-option${t === value ? ' script-editor__pattern-type-option--active' : ''}`}
                            onClick={() => { onChange(t); setOpen(false); }}
                        >
                            <span className="script-editor__pattern-type-swatch" style={{ background: PATTERN_TYPE_COLORS[t] }} />
                            {label}
                        </button>
                    ))}
                </ContextMenu>
            )}
        </>
    );
}

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
--   setUserWindowTitle(name, title)
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
    timestamp: Date;
}

function formatTime(d: Date): string {
    return d.toTimeString().slice(0, 8);
}

interface ScriptEditorPanelProps {
    connectionId: string;
    session: MudSession;
    onScriptSave?: (script: ScriptNode) => void;
    initialListWidth?: number;
    initialMetaHeight?: number;
    onSplitsChange?: (listWidth: number, metaHeight: number | null) => void;
}

export function ScriptEditorPanel({ connectionId, session, onScriptSave, initialListWidth, initialMetaHeight, onSplitsChange }: ScriptEditorPanelProps) {
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
    const groupTriggers    = useAppStore(s => s.groupTriggers);
    const addTimer         = useAppStore(s => s.addTimer);
    const updateTimer      = useAppStore(s => s.updateTimer);
    const removeTimer      = useAppStore(s => s.removeTimer);
    const moveTimer        = useAppStore(s => s.moveTimer);
    const addKeybinding    = useAppStore(s => s.addKeybinding);
    const updateKeybinding = useAppStore(s => s.updateKeybinding);
    const removeKeybinding = useAppStore(s => s.removeKeybinding);
    const moveKeybinding   = useAppStore(s => s.moveKeybinding);
    const importMudletNodes = useAppStore(s => s.importMudletNodes);

    const importFileRef = useRef<HTMLInputElement>(null);
    const [importError, setImportError] = useState<string | null>(null);

    const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
            const text = await file.text();
            const data = parseMudletXml(text);
            importMudletNodes(connectionId, data);
            const total = data.scripts.length + data.aliases.length + data.triggers.length + data.timers.length + data.keys.length;
            setImportError(null);
            const now = new Date();
            const newEntries: LogEntry[] = [{ text: `Imported ${total} items from ${file.name}`, level: 'info', timestamp: now }];
            for (const w of data.warnings) newEntries.push({ text: `Warning: ${w}`, level: 'error', timestamp: now });
            setLogs(prev => [...prev, ...newEntries]);
            setErrorLog(prev => [...prev, ...newEntries]);
            const warnCount = data.warnings.length;
            if (warnCount > 0) setUnreadErrors(prev => prev + warnCount);
        } catch (err) {
            setImportError(err instanceof Error ? err.message : String(err));
        }
    }, [connectionId, importMudletNodes]);

    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Common edit state
    const [editName, setEditName]     = useState('');
    const [editLang, setEditLang]     = useState<'lua' | 'js'>('lua');
    const [editCode, setEditCode]     = useState('');
    // Alias extra
    const [editPattern, setEditPattern]   = useState('');
    const [editCommand, setEditCommand]   = useState('');
    // Trigger extra
    const [editPatterns, setEditPatterns] = useState<TriggerPattern[]>([]);
    const [editFireLength, setEditFireLength] = useState(0);
    const [editMultipleMatches, setEditMultipleMatches] = useState(false);
    const [editMultiline, setEditMultiline] = useState(false);
    const [editDelta, setEditDelta] = useState(0);
    const [editIsFilter, setEditIsFilter] = useState(false);
    const [editHighlightFg, setEditHighlightFg] = useState('');
    const [editHighlightBg, setEditHighlightBg] = useState('');
    const [editTriggerCommand, setEditTriggerCommand] = useState('');
    // Timer extra
    const [editHours,   setEditHours]   = useState(0);
    const [editMinutes, setEditMinutes] = useState(1);
    const [editSecs,    setEditSecs]    = useState(0);
    const [editMs,      setEditMs]      = useState(0);
    const [editRepeat, setEditRepeat]   = useState(true);
    // Key extra
    const [editKey, setEditKey]               = useState('');
    const [editModifiers, setEditModifiers]   = useState<string[]>([]);
    const [capturing, setCapturing]           = useState(false);
    const [editKeyCommand, setEditKeyCommand] = useState('');
    // Timer extra (command)
    const [editTimerCommand, setEditTimerCommand] = useState('');
    // Script extra: event handlers (newline-separated)
    const [editEventHandlers, setEditEventHandlers] = useState('');

    const [dirty, setDirty] = useState(false);
    // Backfill from the session-level buffer so entries that fired before this
    // panel was first mounted (e.g. errors during initial script load) survive.
    const [logs, setLogs] = useState<LogEntry[]>(() =>
        session.scriptLog.map(e => ({ text: e.text, level: e.level, timestamp: new Date(e.timestamp) })),
    );
    const [errorLog, setErrorLog] = useState<LogEntry[]>(() =>
        session.scriptLog
            .filter(e => e.level === 'error')
            .map(e => ({ text: e.text, level: e.level, timestamp: new Date(e.timestamp) })),
    );
    const [unreadErrors, setUnreadErrors] = useState(() =>
        session.scriptLog.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0),
    );

    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
    const logEndRef      = useRef<HTMLDivElement>(null);
    const errorLogEndRef = useRef<HTMLDivElement>(null);

    const [listWidth, setListWidth]     = useState(() => initialListWidth ?? 180);
    const [metaHeight, setMetaHeight]   = useState<number | null>(() => initialMetaHeight ?? null);
    const metaRef = useRef<HTMLDivElement>(null);

    const handleItemContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(id);
        setCtxMenu({ x: e.clientX, y: e.clientY, targetId: id });
    }, []);

    const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, targetId: null });
    }, []);

    const handleContextDelete = useCallback((id: string) => {
        if (category === 'scripts')        removeScript(connectionId, id);
        else if (category === 'aliases')   removeAlias(connectionId, id);
        else if (category === 'triggers')  removeTrigger(connectionId, id);
        else if (category === 'timers')    removeTimer(connectionId, id);
        else                               removeKeybinding(connectionId, id);
        setSelectedId(prev => prev === id ? null : prev);
        setCtxMenu(null);
    }, [category, connectionId, removeScript, removeAlias, removeTrigger, removeTimer, removeKeybinding]);

    // Drag-and-drop state
    const [dragId, setDragId]   = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{ id: string; intent: 'before' | 'into' | 'after' } | null>(null);

    const items: AnyNode[] =
        category === 'scripts'  ? scripts    :
        category === 'aliases'  ? aliases    :
        category === 'triggers' ? triggers   :
        category === 'timers'   ? timers     :
        category === 'errors'   ? EMPTY      :
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
        // New unsaved scripts have code='' in the store; show the template so the
        // user has a starting point, and mark dirty so "Save & Run" is active.
        const isNewScript = category === 'scripts' && !selected.isGroup && selected.code === '';
        setEditCode(isNewScript ? DEFAULT_LUA : selected.code);
        if (category === 'aliases') {
            setEditPattern((selected as AliasNode).pattern ?? '');
            setEditCommand((selected as AliasNode).command ?? '');
        }
        if (category === 'triggers') {
            const t = selected as TriggerNode;
            setEditPatterns(t.patterns ?? []);
            setEditFireLength(t.fireLength ?? 0);
            setEditMultipleMatches(t.multipleMatches ?? false);
            setEditMultiline(t.multiline ?? false);
            setEditDelta(t.delta ?? 0);
            setEditIsFilter(t.isFilter ?? false);
            setEditHighlightFg(t.highlight?.fg ?? '');
            setEditHighlightBg(t.highlight?.bg ?? '');
            setEditTriggerCommand(t.command ?? '');
        }
        if (category === 'scripts') setEditEventHandlers((selected as ScriptNode).eventHandlers?.join('\n') ?? '');
        if (category === 'timers') {
            const t = selected as TimerNode;
            const { h, m, s, ms } = secsToHMSM(t.seconds);
            setEditHours(h);
            setEditMinutes(m);
            setEditSecs(s);
            setEditMs(ms);
            setEditRepeat(t.repeat);
            setEditTimerCommand(t.command ?? '');
        }
        if (category === 'keys') {
            const k = selected as KeyNode;
            setEditKey(k.key);
            setEditModifiers(k.modifiers);
            setEditKeyCommand(k.command ?? '');
        }
        setCapturing(false);
        setDirty(isNewScript);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, category]);

    useEffect(() => {
        // Re-sync from the session buffer in case entries were appended between
        // the useState initializer and this effect running.
        setLogs(session.scriptLog.map(e => ({ text: e.text, level: e.level, timestamp: new Date(e.timestamp) })));
        setErrorLog(session.scriptLog
            .filter(e => e.level === 'error')
            .map(e => ({ text: e.text, level: e.level, timestamp: new Date(e.timestamp) })));

        let initialErrors = 0;
        for (const e of session.scriptLog) if (e.level === 'error') initialErrors++;
        setUnreadErrors(initialErrors);

        return session.events.on('script.log', (text, level) => {
            const entry: LogEntry = { text: text ?? '', level: level ?? 'info', timestamp: new Date() };
            setLogs(prev => [...prev, entry]);
            setErrorLog(prev => [...prev, entry]);
            if (level === 'error') setUnreadErrors(prev => prev + 1);
        });
    }, [session]);

    // Clear unread badge when visiting the Errors tab
    useEffect(() => {
        if (category === 'errors') setUnreadErrors(0);
    }, [category]);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [logs]);

    useEffect(() => {
        errorLogEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [errorLog]);

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
        const canDropInto = item.isGroup || category === 'triggers';
        const intent: 'before' | 'into' | 'after' =
            canDropInto && relY > 0.3 && relY < 0.7 ? 'into' :
            relY < 0.5 ? 'before' : 'after';
        setDragOver(prev => (prev?.id === item.id && prev?.intent === intent) ? prev : { id: item.id, intent });
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: AnyNode) => {
        e.preventDefault();
        const id = dragId ?? e.dataTransfer.getData('text/plain');
        if (!id || id === target.id || isAncestorOf(id, target.id, items)) return;

        const intent = dragOver?.intent ?? 'before';

        // Special case: dropping onto a non-group trigger → target becomes the group, dragged becomes child
        if (intent === 'into' && !target.isGroup && category === 'triggers') {
            groupTriggers(connectionId, target.id, id);
            setExpanded(prev => { const next = new Set(prev); next.add(target.id); return next; });
            setSelectedId(target.id);
            setDragId(null);
            setDragOver(null);
            return;
        }

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

    const metaHeightRef = useRef(metaHeight);
    metaHeightRef.current = metaHeight;
    const listWidthRef = useRef(listWidth);
    listWidthRef.current = listWidth;

    const handleListResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = listWidthRef.current;
        const onMove = (ev: MouseEvent) => {
            setListWidth(Math.max(120, Math.min(400, startWidth + ev.clientX - startX)));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            onSplitsChange?.(listWidthRef.current, metaHeightRef.current);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [onSplitsChange]);

    const handleMetaResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = metaRef.current?.getBoundingClientRect().height ?? 100;
        const onMove = (ev: MouseEvent) => {
            setMetaHeight(Math.max(32, startHeight + ev.clientY - startY));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            onSplitsChange?.(listWidthRef.current, metaHeightRef.current);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [onSplitsChange]);

    const createItem = useCallback((asGroup: boolean, parentId: string | null) => {
        if (parentId) {
            setExpanded(prev => { const next = new Set(prev); next.add(parentId); return next; });
        }
        let id: string;
        if (category === 'scripts') {
            id = addScript(connectionId, {
                name: asGroup ? 'New Group' : 'New Script',
                language: 'lua',
                code: '',
                enabled: true,
                isGroup: asGroup,
                parentId,
                eventHandlers: [],
            });
        } else if (category === 'aliases') {
            id = addAlias(connectionId, {
                name: asGroup ? 'New Group' : 'New Alias',
                pattern: '',
                command: '',
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
                fireLength: 0,
                multipleMatches: false,
                multiline: false,
                delta: 0,
                isFilter: false,
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
    }, [category, connectionId, addScript, addAlias, addTrigger, addTimer, addKeybinding]);

    const handleNew = (asGroup = false) => {
        const parentId = selected?.isGroup
            ? selected.id
            : selected?.parentId ?? null;
        createItem(asGroup, parentId);
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
            updateAlias(connectionId, selectedId, { name: editName, pattern: editPattern, command: editCommand, language: editLang, code: editCode });
        } else if (category === 'triggers') {
            const highlight = (editHighlightFg || editHighlightBg)
                ? { fg: editHighlightFg || undefined, bg: editHighlightBg || undefined }
                : undefined;
            updateTrigger(connectionId, selectedId, {
                name: editName,
                patterns: editPatterns,
                language: editLang,
                code: editCode,
                fireLength: editFireLength,
                multipleMatches: editMultipleMatches,
                multiline: editMultiline,
                delta: editDelta,
                isFilter: editIsFilter,
                highlight,
                command: editTriggerCommand || undefined,
            });
        } else if (category === 'timers') {
            const seconds = editHours * 3600 + editMinutes * 60 + editSecs + editMs / 1000;
            updateTimer(connectionId, selectedId, { name: editName, seconds, repeat: editRepeat, language: editLang, code: editCode, command: editTimerCommand || undefined });
        } else {
            updateKeybinding(connectionId, selectedId, { name: editName, key: editKey, modifiers: editModifiers, language: editLang, code: editCode, command: editKeyCommand || undefined });
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

    const categoryLabel = category !== 'errors' ? CATEGORY_LABELS[category].toLowerCase() : '';
    const emptyMsg = items.length === 0
        ? `No ${categoryLabel} yet — click "+ New" to create one`
        : `Select a ${categoryLabel.replace(/s$/, '')} to edit`;

    return (
        <div className="script-editor">
            {/* Category nav */}
            <div className="script-editor__nav">
                {EDIT_CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        className={`script-editor__nav-btn${category === cat ? ' script-editor__nav-btn--active' : ''}`}
                        onClick={() => setCategory(cat)}
                    >
                        {CATEGORY_LABELS[cat]}
                    </button>
                ))}
                <button
                    className={`script-editor__nav-btn${category === 'errors' ? ' script-editor__nav-btn--active' : ''}`}
                    onClick={() => setCategory('errors')}
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                    Errors
                    {unreadErrors > 0 && (
                        <span className="script-editor__error-badge">{unreadErrors > 99 ? '99+' : unreadErrors}</span>
                    )}
                </button>
                <button className="script-editor__nav-import" onClick={() => importFileRef.current?.click()} title="Import Mudlet XML package">
                    Import XML
                </button>
                <input ref={importFileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleImportFile} />
            </div>

            {/* Item list — hidden on the Errors tab */}
            {category !== 'errors' && <div className="script-editor__list" style={{ width: listWidth }}>
                <div className="script-editor__list-resize" onMouseDown={handleListResizeStart} />
                <div className="script-editor__list-header">
                    <Button variant="secondary" size="sm" onClick={() => handleNew(false)}>+ New</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleNew(true)}>+ Group</Button>
                </div>
                {importError && <div className="script-editor__import-error" title={importError}>Import failed: {importError}</div>}
                <div
                    className="script-editor__items"
                    onDragLeave={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                    }}
                    onContextMenu={handlePaneContextMenu}
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
                                onContextMenu={e => handleItemContextMenu(e, item.id)}
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
            </div>}

            {/* Errors view */}
            {category === 'errors' && (
                <div className="script-editor__error-log-view">
                    <div className="script-editor__error-log-header">
                        <span className="script-editor__error-log-title">
                            {errorLog.length === 0 ? 'No output yet' : `${errorLog.length} entr${errorLog.length === 1 ? 'y' : 'ies'}`}
                        </span>
                        <button
                            className="script-editor__error-log-clear"
                            onClick={() => { session.clearScriptLog(); setErrorLog([]); setLogs([]); setUnreadErrors(0); }}
                            disabled={errorLog.length === 0}
                        >
                            Clear
                        </button>
                    </div>
                    <div className="script-editor__error-log-entries">
                        {errorLog.length === 0 ? (
                            <span className="script-editor__log-empty">Lua errors and script output will appear here.</span>
                        ) : (
                            errorLog.map((entry, i) => (
                                <div key={i} className={`script-editor__error-log-entry script-editor__error-log-entry--${entry.level}`}>
                                    <span className="script-editor__error-log-time">{formatTime(entry.timestamp)}</span>
                                    <span className="script-editor__error-log-text">{entry.text}</span>
                                </div>
                            ))
                        )}
                        <div ref={errorLogEndRef} />
                    </div>
                </div>
            )}

            {/* Editor pane */}
            {category !== 'errors' && selected ? (
                <div className="script-editor__pane">
                    <div
                        className="script-editor__meta"
                        ref={metaRef}
                        style={metaHeight !== null ? { height: metaHeight, overflowY: 'auto' } : {}}
                    >
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
                            <>
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editPattern}
                                        onChange={e => { setEditPattern(e.target.value); setDirty(true); }}
                                        placeholder="Pattern (regex)"
                                    />
                                </div>
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editCommand}
                                        onChange={e => { setEditCommand(e.target.value); setDirty(true); }}
                                        placeholder="Command (%1, %2… = captures)"
                                    />
                                </div>
                            </>
                        )}
                        {category === 'triggers' && (
                            <>
                                {/* Patterns */}
                                <div className="script-editor__meta-row script-editor__meta-row--col">
                                    <span className="script-editor__field-label">Patterns</span>
                                    <div className="script-editor__pattern-list">
                                        {editPatterns.map((p, i) => (
                                            <div key={i} className="script-editor__pattern-row">
                                                <PatternTypeSelect
                                                    value={p.type}
                                                    onChange={t => {
                                                        const next = [...editPatterns];
                                                        next[i] = { ...next[i], type: t };
                                                        setEditPatterns(next);
                                                        setDirty(true);
                                                    }}
                                                />
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

                                {/* Command */}
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editTriggerCommand}
                                        onChange={e => { setEditTriggerCommand(e.target.value); setDirty(true); }}
                                        placeholder="Command to send (%1..%9 = captures)"
                                    />
                                </div>

                                {/* Matching section */}
                                <div className="script-editor__trigger-card">
                                    <span className="script-editor__trigger-card-label">Matching</span>
                                    <div className="script-editor__trigger-card-row">
                                        <label className="script-editor__trigger-opt">
                                            <input
                                                type="checkbox"
                                                checked={editMultipleMatches}
                                                onChange={e => { setEditMultipleMatches(e.target.checked); setDirty(true); }}
                                            />
                                            Multiple matches
                                        </label>
                                        <label className="script-editor__trigger-opt script-editor__trigger-opt--fire">
                                            Fire length
                                            <input
                                                type="number"
                                                className="script-editor__fire-length"
                                                value={editFireLength}
                                                min={0}
                                                title="0 = only the current line; N = also open for N more lines"
                                                onChange={e => {
                                                    const v = parseInt(e.target.value, 10);
                                                    setEditFireLength(isNaN(v) || v < 0 ? 0 : v);
                                                    setDirty(true);
                                                }}
                                            />
                                        </label>
                                    </div>
                                    <div className="script-editor__trigger-card-row">
                                        <label className="script-editor__trigger-opt">
                                            <input
                                                type="checkbox"
                                                checked={editMultiline}
                                                onChange={e => { setEditMultiline(e.target.checked); setDirty(true); }}
                                            />
                                            AND (multiline)
                                        </label>
                                        {editMultiline && (
                                            <label className="script-editor__trigger-opt script-editor__trigger-opt--fire">
                                                Delta
                                                <input
                                                    type="number"
                                                    className="script-editor__fire-length"
                                                    value={editDelta}
                                                    min={0}
                                                    title="0 = unlimited; N = max lines between first and last match"
                                                    onChange={e => {
                                                        const v = parseInt(e.target.value, 10);
                                                        setEditDelta(isNaN(v) || v < 0 ? 0 : v);
                                                        setDirty(true);
                                                    }}
                                                />
                                                lines
                                            </label>
                                        )}
                                    </div>
                                </div>

                                {/* Highlight section */}
                                <div className="script-editor__trigger-card">
                                    <span className="script-editor__trigger-card-label">Highlight</span>
                                    <div className="script-editor__trigger-card-row">
                                        <label className="script-editor__trigger-opt">
                                            <input
                                                type="checkbox"
                                                checked={!!editHighlightFg}
                                                onChange={e => { setEditHighlightFg(e.target.checked ? '#ff0000' : ''); setDirty(true); }}
                                            />
                                            FG
                                        </label>
                                        {editHighlightFg && (
                                            <input
                                                type="color"
                                                className="script-editor__color-pick"
                                                value={editHighlightFg}
                                                onChange={e => { setEditHighlightFg(e.target.value); setDirty(true); }}
                                            />
                                        )}
                                        <div className="script-editor__trigger-card-divider" />
                                        <label className="script-editor__trigger-opt">
                                            <input
                                                type="checkbox"
                                                checked={!!editHighlightBg}
                                                onChange={e => { setEditHighlightBg(e.target.checked ? '#000080' : ''); setDirty(true); }}
                                            />
                                            BG
                                        </label>
                                        {editHighlightBg && (
                                            <input
                                                type="color"
                                                className="script-editor__color-pick"
                                                value={editHighlightBg}
                                                onChange={e => { setEditHighlightBg(e.target.value); setDirty(true); }}
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Chain section — groups only */}
                                {selected.isGroup && (
                                    <div className="script-editor__trigger-card">
                                        <span className="script-editor__trigger-card-label">Chain</span>
                                        <div className="script-editor__trigger-card-row">
                                            <label className="script-editor__trigger-opt">
                                                <input
                                                    type="checkbox"
                                                    checked={editIsFilter}
                                                    onChange={e => { setEditIsFilter(e.target.checked); setDirty(true); }}
                                                />
                                                Filter (pass match to children)
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </>
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
                            <>
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
                                {!selected.isGroup && (
                                    <div className="script-editor__meta-row">
                                        <Input
                                            className="script-editor__pattern"
                                            value={editKeyCommand}
                                            onChange={e => { setEditKeyCommand(e.target.value); setDirty(true); }}
                                            placeholder="Command to send"
                                        />
                                    </div>
                                )}
                            </>
                        )}
                        {category === 'timers' && (
                            <div className="script-editor__meta-row">
                                <span className="script-editor__field-label">Every</span>
                                <input
                                    type="number"
                                    className="script-editor__time-part"
                                    value={editHours}
                                    min={0}
                                    onChange={e => { setEditHours(Math.max(0, Number(e.target.value))); setDirty(true); }}
                                />
                                <span className="script-editor__field-label">h</span>
                                <input
                                    type="number"
                                    className="script-editor__time-part"
                                    value={editMinutes}
                                    min={0}
                                    max={59}
                                    onChange={e => { setEditMinutes(Math.max(0, Math.min(59, Number(e.target.value)))); setDirty(true); }}
                                />
                                <span className="script-editor__field-label">m</span>
                                <input
                                    type="number"
                                    className="script-editor__time-part"
                                    value={editSecs}
                                    min={0}
                                    max={59}
                                    onChange={e => { setEditSecs(Math.max(0, Math.min(59, Number(e.target.value)))); setDirty(true); }}
                                />
                                <span className="script-editor__field-label">s</span>
                                <input
                                    type="number"
                                    className="script-editor__time-part"
                                    value={editMs}
                                    min={0}
                                    max={999}
                                    onChange={e => { setEditMs(Math.max(0, Math.min(999, Number(e.target.value)))); setDirty(true); }}
                                />
                                <span className="script-editor__field-label">ms</span>
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
                        {category === 'timers' && !selected.isGroup && (
                            <div className="script-editor__meta-row">
                                <Input
                                    className="script-editor__pattern"
                                    value={editTimerCommand}
                                    onChange={e => { setEditTimerCommand(e.target.value); setDirty(true); }}
                                    placeholder="Command to send"
                                />
                            </div>
                        )}
                    </div>

                    <div className="script-editor__meta-resize" onMouseDown={handleMetaResizeStart} />

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
                category !== 'errors' && <div className="script-editor__empty">{emptyMsg}</div>
            )}

            {ctxMenu && category !== 'errors' && (
                <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
                    {ctxMenu.targetId !== null && (
                        <>
                            <button
                                className="ctx-menu__item ctx-menu__item--danger"
                                onClick={() => handleContextDelete(ctxMenu.targetId!)}
                            >
                                <Trash2 size={13} strokeWidth={1.6} />
                                Delete
                            </button>
                            <div className="ctx-menu__sep" />
                        </>
                    )}
                    <button
                        className="ctx-menu__item"
                        onClick={() => {
                            const parentId = ctxMenu.targetId !== null
                                ? (items.find(i => i.id === ctxMenu.targetId)?.parentId ?? null)
                                : null;
                            createItem(false, parentId);
                            setCtxMenu(null);
                        }}
                    >
                        {React.createElement(CATEGORY_ICON[category as EditCategory], { size: 13, strokeWidth: 1.6 })}
                        Add {CATEGORY_SINGULAR[category as EditCategory]}
                    </button>
                    <button
                        className="ctx-menu__item"
                        onClick={() => {
                            const parentId = ctxMenu.targetId !== null
                                ? (items.find(i => i.id === ctxMenu.targetId)?.parentId ?? null)
                                : null;
                            createItem(true, parentId);
                            setCtxMenu(null);
                        }}
                    >
                        <FolderPlus size={13} strokeWidth={1.6} />
                        Add Group
                    </button>
                </ContextMenu>
            )}
        </div>
    );
}
