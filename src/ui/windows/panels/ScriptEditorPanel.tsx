import React, { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Clock, Folder, FolderOpen, FolderPlus, Keyboard, MousePointerClick, Package, Shuffle, FileCode2, Trash2, Zap } from 'lucide-react';
import { Button, Input, ContextMenu, useConfirm } from '../../components';
import { useAppStore } from '../../../storage';
import type { AliasNode, ButtonLocation, ButtonNode, ButtonOrientation, KeyNode, PackageManifest, ScriptNode, TimerNode, TriggerNode, TriggerPattern, TriggerPatternType } from '../../../storage/schema';
import { isEffectivelyEnabled } from '../../../storage/schema';
import type { MudSession, ScriptLogSource, ScriptLogSourceKind } from '../../../mud/MudSession';
import type { ProfileVFS } from '../../../scripting/vfs/ProfileVFS';
import type { ScriptingEngine } from '../../../scripting/ScriptingEngine';
import { LuaEditor } from './LuaEditor';
import { installPackageFromFile, uninstallPackageFiles } from '../../../import/packageInstaller';
import { strToU8 } from 'fflate';
import './ScriptEditorPanel.css';

type Category = 'scripts' | 'aliases' | 'triggers' | 'timers' | 'keys' | 'buttons' | 'packages' | 'errors';
type EditCategory = Exclude<Category, 'errors' | 'packages'>;
type AnyNode = ScriptNode | AliasNode | TriggerNode | TimerNode | KeyNode | ButtonNode;

const EDIT_CATEGORIES: EditCategory[] = ['scripts', 'aliases', 'triggers', 'timers', 'keys', 'buttons'];

const CATEGORY_LABELS: Record<EditCategory, string> = {
    scripts: 'Scripts',
    aliases: 'Aliases',
    triggers: 'Triggers',
    timers: 'Timers',
    keys: 'Keys',
    buttons: 'Buttons',
};

const CATEGORY_SINGULAR: Record<EditCategory, string> = {
    scripts: 'Script',
    aliases: 'Alias',
    triggers: 'Trigger',
    timers: 'Timer',
    keys: 'Key',
    buttons: 'Button',
};

const BUTTON_GROUP_SINGULAR = 'Toolbar';

const CATEGORY_ICON: Record<EditCategory, React.ElementType> = {
    scripts:  FileCode2,
    aliases:  Shuffle,
    triggers: Zap,
    timers:   Clock,
    keys:     Keyboard,
    buttons:  MousePointerClick,
};

const BUTTON_LOCATIONS: ButtonLocation[] = ['top', 'bottom', 'left', 'right', 'floating'];
const BUTTON_ORIENTATIONS: ButtonOrientation[] = ['horizontal', 'vertical'];

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
        case 'scripts':  return <FileCode2          {...props} />;
        case 'aliases':  return <Shuffle            {...props} />;
        case 'triggers': return <Zap                {...props} />;
        case 'timers':   return <Clock              {...props} />;
        case 'keys':     return <Keyboard           {...props} />;
        case 'buttons':  return <MousePointerClick  {...props} />;
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

const ICON_MIME: Record<string, string> = {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    webp: 'image/webp',
    svg:  'image/svg+xml',
    bmp:  'image/bmp',
    ico:  'image/x-icon',
};

function PackageDescription({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false);
    const [overflows, setOverflows] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        setOverflows(el.scrollHeight > el.clientHeight + 1);
    }, [text]);

    return (
        <div className="script-editor__pkg-desc-wrap">
            <div
                ref={ref}
                className={`script-editor__pkg-desc${expanded ? ' script-editor__pkg-desc--expanded' : ''}`}
            >
                {text}
            </div>
            {(overflows || expanded) && (
                <button
                    className="script-editor__pkg-desc-toggle"
                    onClick={() => setExpanded(e => !e)}
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
}

function PackageIcon({ vfs, pkg }: { vfs: ProfileVFS | null; pkg: PackageManifest }) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!vfs || !pkg.icon) { setUrl(null); return; }
        const path = `${vfs.profilePath}/${pkg.name}/${pkg.icon}`;
        if (!vfs.exists(path)) { setUrl(null); return; }
        let revoke: string | null = null;
        try {
            // Binary files were written as Latin-1 strings; reverse with strToU8(_, true).
            const bytes = strToU8(vfs.readFile(path), true);
            const ext = pkg.icon.split('.').pop()?.toLowerCase() ?? '';
            const mime = ICON_MIME[ext] ?? 'application/octet-stream';
            const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
            revoke = blobUrl;
            setUrl(blobUrl);
        } catch {
            setUrl(null);
        }
        return () => { if (revoke) URL.revokeObjectURL(revoke); };
    }, [vfs, pkg.name, pkg.icon]);

    return (
        <div className="script-editor__pkg-icon-frame">
            {url
                ? <img className="script-editor__pkg-icon-img" src={url} alt="" />
                : <Package className="script-editor__pkg-icon-fallback" size={28} strokeWidth={1.4} />}
        </div>
    );
}

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
    source?: ScriptLogSource;
}

const KIND_TO_CATEGORY: Record<ScriptLogSourceKind, EditCategory> = {
    script:  'scripts',
    alias:   'aliases',
    trigger: 'triggers',
    timer:   'timers',
    key:     'keys',
    button:  'buttons',
};

function formatTime(d: Date): string {
    return d.toTimeString().slice(0, 8);
}

/** config.lua's `created` field is free-form; render as a localized date when parseable, raw otherwise. */
function formatPackageDate(raw: string): string {
    const t = Date.parse(raw);
    if (isNaN(t)) return raw;
    return new Date(t).toLocaleDateString();
}

interface ScriptEditorPanelProps {
    connectionId: string;
    session: MudSession;
    vfs: ProfileVFS | null;
    scriptingEngineRef?: React.RefObject<ScriptingEngine | null>;
    initialListWidth?: number;
    initialMetaHeight?: number;
    onSplitsChange?: (listWidth: number, metaHeight: number | null) => void;
}

export function ScriptEditorPanel({ connectionId, session, vfs, scriptingEngineRef, initialListWidth, initialMetaHeight, onSplitsChange }: ScriptEditorPanelProps) {
    const confirm = useConfirm();
    const [category, setCategory] = useState<Category>('scripts');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const scripts     = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY);
    const aliases     = useAppStore(s => s.connectionAliases[connectionId] ?? EMPTY);
    const triggers    = useAppStore(s => s.connectionTriggers[connectionId] ?? EMPTY);
    const timers      = useAppStore(s => s.connectionTimers[connectionId] ?? EMPTY);
    const keybindings = useAppStore(s => s.connectionKeybindings[connectionId] ?? EMPTY);
    const buttons     = useAppStore(s => s.connectionButtons[connectionId] ?? EMPTY);

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
    const addButton        = useAppStore(s => s.addButton);
    const updateButton     = useAppStore(s => s.updateButton);
    const removeButton     = useAppStore(s => s.removeButton);
    const moveButton       = useAppStore(s => s.moveButton);
    const packages         = useAppStore(s => s.connectionPackages[connectionId] ?? EMPTY);
    const installPackage   = useAppStore(s => s.installPackage);
    const uninstallPackage = useAppStore(s => s.uninstallPackage);

    const importFileRef = useRef<HTMLInputElement>(null);
    const [importError, setImportError] = useState<string | null>(null);

    const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        if (!vfs) {
            setImportError('VFS not ready — wait for the profile to finish loading');
            return;
        }
        try {
            const { manifest, data } = await installPackageFromFile(file, vfs);
            // installPackage commits the new scripts to the store; the
            // engine's store subscription synchronously loads them into Lua
            // before this call returns. By the time notifyPackageInstalled
            // raises sysInstallPackage, all handlers are already registered.
            installPackage(connectionId, manifest, data);
            scriptingEngineRef?.current?.notifyPackageInstalled(manifest.name);
            const total = data.scripts.length + data.aliases.length + data.triggers.length + data.timers.length + data.keys.length;
            setImportError(null);
            const now = new Date();
            const newEntries: LogEntry[] = [{ text: `Installed package "${manifest.name}" (${total} items) from ${file.name}`, level: 'info', timestamp: now }];
            for (const w of data.warnings) newEntries.push({ text: `Warning: ${w}`, level: 'error', timestamp: now });
            setLogs(prev => [...prev, ...newEntries]);
            setErrorLog(prev => [...prev, ...newEntries]);
            const warnCount = data.warnings.length;
            if (warnCount > 0) setUnreadErrors(prev => prev + warnCount);
        } catch (err) {
            setImportError(err instanceof Error ? err.message : String(err));
        }
    }, [connectionId, installPackage, scriptingEngineRef, vfs]);

    const handleUninstall = useCallback(async (packageName: string) => {
        // Raise sysUninstall/sysUninstallPackage before removing the
        // package's items from the store so the package's own handlers can
        // still run during cleanup.
        scriptingEngineRef?.current?.notifyPackageUninstalled(packageName);
        uninstallPackage(connectionId, packageName);
        if (vfs) {
            try { await uninstallPackageFiles(packageName, vfs); }
            catch (err) { console.warn('[ScriptEditor] failed to remove package files:', err); }
        }
        const now = new Date();
        setLogs(prev => [...prev, { text: `Uninstalled package "${packageName}"`, level: 'info', timestamp: now }]);
    }, [connectionId, scriptingEngineRef, uninstallPackage, vfs]);

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
    // Button extra
    const [editButtonCommand,     setEditButtonCommand]     = useState('');
    const [editButtonCommandDown, setEditButtonCommandDown] = useState('');
    const [editButtonIcon,        setEditButtonIcon]        = useState('');
    const [editButtonTooltip,     setEditButtonTooltip]     = useState('');
    const [editButtonIsPushDown,  setEditButtonIsPushDown]  = useState(false);
    const [editButtonStyleSheet,  setEditButtonStyleSheet]  = useState('');
    // Toolbar (button group) extra
    const [editToolbarLocation,    setEditToolbarLocation]    = useState<ButtonLocation>('top');
    const [editToolbarOrientation, setEditToolbarOrientation] = useState<ButtonOrientation>('horizontal');
    const [editToolbarColumns,     setEditToolbarColumns]     = useState(0);

    const [dirty, setDirty] = useState(false);
    // Backfill from the session-level buffer so entries that fired before this
    // panel was first mounted (e.g. errors during initial script load) survive.
    const [logs, setLogs] = useState<LogEntry[]>(() =>
        session.scriptLog.map(e => ({
            text: e.text, level: e.level, timestamp: new Date(e.timestamp),
            ...(e.source ? { source: e.source } : {}),
        })),
    );
    const [errorLog, setErrorLog] = useState<LogEntry[]>(() =>
        session.scriptLog
            .filter(e => e.level === 'error')
            .map(e => ({
                text: e.text, level: e.level, timestamp: new Date(e.timestamp),
                ...(e.source ? { source: e.source } : {}),
            })),
    );
    const [unreadErrors, setUnreadErrors] = useState(() =>
        session.scriptLog.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0),
    );

    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
    const logEndRef      = useRef<HTMLDivElement>(null);
    const errorLogEndRef = useRef<HTMLDivElement>(null);
    // Bumped on each error-row jump click. Carried into LuaEditor's `gotoLine`
    // prop and into a useEffect that performs the parent-tree expansion + scroll
    // — using a revision (rather than only `line`) makes repeated jumps to the
    // same row work, and decouples the request from the editor lifecycle.
    const [pendingJump, setPendingJump] = useState<{
        kind: ScriptLogSourceKind; id: string; line?: number; revision: number;
    } | null>(null);

    const [listWidth, setListWidth]     = useState(() => initialListWidth ?? 180);
    const [metaHeight, setMetaHeight]   = useState<number | null>(() => initialMetaHeight ?? null);
    const metaRef = useRef<HTMLDivElement>(null);

    // Click handler for the "→" button on error log rows. Switches category if
    // needed (the [category] effect will clear selection; our jump effect below
    // re-applies it after the swap), expands ancestors so the row is visible,
    // and — if a line is known — moves the editor cursor to it via LuaEditor's
    // `gotoLine` prop. Bumping `revision` makes repeat clicks always re-trigger.
    const jumpRevisionRef = useRef(0);
    const handleErrorJump = useCallback((source: ScriptLogSource) => {
        jumpRevisionRef.current += 1;
        setPendingJump({
            kind: source.kind, id: source.id,
            ...(source.line !== undefined ? { line: source.line } : {}),
            revision: jumpRevisionRef.current,
        });
    }, []);

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
        else if (category === 'keys')      removeKeybinding(connectionId, id);
        else                               removeButton(connectionId, id);
        setSelectedId(prev => prev === id ? null : prev);
        setCtxMenu(null);
    }, [category, connectionId, removeScript, removeAlias, removeTrigger, removeTimer, removeKeybinding, removeButton]);

    // Drag-and-drop state
    const [dragId, setDragId]   = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{ id: string; intent: 'before' | 'into' | 'after' } | null>(null);

    const items: AnyNode[] =
        category === 'scripts'  ? scripts    :
        category === 'aliases'  ? aliases    :
        category === 'triggers' ? triggers   :
        category === 'timers'   ? timers     :
        category === 'keys'     ? keybindings:
        category === 'buttons'  ? buttons    :
        EMPTY;

    const treeEntries = flattenTree(items, null, expanded);
    const selected = items.find(i => i.id === selectedId) ?? null;

    // Stable identity prevents the LuaEditor's gotoLine effect from re-firing
    // (yanking the cursor) on every parent re-render — e.g. while the user is
    // typing in the editor and triggering setEditCode.
    const editorGotoLine = useMemo(
        () => (pendingJump && pendingJump.line !== undefined && pendingJump.id === selectedId
            ? { line: pendingJump.line, revision: pendingJump.revision }
            : null),
        [pendingJump, selectedId],
    );

    const childCounts = new Map<string, number>();
    for (const it of items) {
        if (it.parentId) childCounts.set(it.parentId, (childCounts.get(it.parentId) ?? 0) + 1);
    }

    useEffect(() => {
        setSelectedId(null);
        setCapturing(false);
        setDirty(false);
        setExpanded(new Set());
    }, [category]);

    // When a jump request comes in (error log click), switch category if needed,
    // expand all ancestor groups so the entity is visible in the tree, and
    // select it. Runs after the [category] effect above, so it re-applies the
    // selection that effect just cleared. Items can be empty during the swap
    // render — guarding on items.length avoids a no-op selection of a missing id.
    useEffect(() => {
        if (!pendingJump) return;
        const targetCategory = KIND_TO_CATEGORY[pendingJump.kind];
        if (category !== targetCategory) {
            setCategory(targetCategory);
            return;
        }
        if (items.length === 0) return;
        const byId = new Map(items.map(i => [i.id, i]));
        let cur = byId.get(pendingJump.id);
        if (!cur) return;
        const ancestorIds: string[] = [];
        while (cur?.parentId) {
            ancestorIds.push(cur.parentId);
            cur = byId.get(cur.parentId);
        }
        if (ancestorIds.length > 0) {
            setExpanded(prev => {
                const next = new Set(prev);
                for (const a of ancestorIds) next.add(a);
                return next;
            });
        }
        setSelectedId(pendingJump.id);
    }, [pendingJump, category, items]);

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
        if (category === 'buttons') {
            const b = selected as ButtonNode;
            setEditButtonCommand(b.command ?? '');
            setEditButtonCommandDown(b.commandDown ?? '');
            setEditButtonIcon(b.icon ?? '');
            setEditButtonTooltip(b.tooltip ?? '');
            setEditButtonIsPushDown(b.isPushDown);
            setEditButtonStyleSheet(b.styleSheet ?? '');
            setEditToolbarLocation(b.location);
            setEditToolbarOrientation(b.orientation);
            setEditToolbarColumns(b.columns ?? 0);
        }
        setCapturing(false);
        setDirty(isNewScript);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, category]);

    useEffect(() => {
        // Re-sync from the session buffer in case entries were appended between
        // the useState initializer and this effect running.
        setLogs(session.scriptLog.map(e => ({
            text: e.text, level: e.level, timestamp: new Date(e.timestamp),
            ...(e.source ? { source: e.source } : {}),
        })));
        setErrorLog(session.scriptLog
            .filter(e => e.level === 'error')
            .map(e => ({
                text: e.text, level: e.level, timestamp: new Date(e.timestamp),
                ...(e.source ? { source: e.source } : {}),
            })));

        let initialErrors = 0;
        for (const e of session.scriptLog) if (e.level === 'error') initialErrors++;
        setUnreadErrors(initialErrors);

        return session.events.on('script.log', (text, level, source) => {
            const entry: LogEntry = {
                text: text ?? '', level: level ?? 'info', timestamp: new Date(),
                ...(source ? { source } : {}),
            };
            setLogs(prev => [...prev, entry]);
            setErrorLog(prev => [...prev, entry]);
            if (level === 'error') setUnreadErrors(prev => prev + 1);
        });
    }, [session, connectionId]);

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
        } else if (
            intent === 'after' &&
            target.isGroup &&
            expanded.has(target.id) &&
            items.some(i => i.parentId === target.id)
        ) {
            // The "after" line cue under an expanded non-empty group sits
            // between the group's row and its first child, so land the drop at
            // that exact slot (first child of the group). Otherwise the
            // calculation can pick the dragged item itself as insertBeforeId
            // and silently no-op.
            newParentId = target.id;
            insertBeforeId = items.find(i => i.parentId === target.id)?.id ?? null;
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
        else if (category === 'keys')      moveKeybinding(connectionId, id, newParentId, insertBeforeId);
        else                               moveButton(connectionId, id, newParentId, insertBeforeId);

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
        } else if (category === 'keys') {
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
        } else {
            id = addButton(connectionId, {
                name: asGroup ? 'New Toolbar' : 'New Button',
                language: 'lua',
                code: '',
                enabled: true,
                isGroup: asGroup,
                parentId,
                orientation: 'horizontal',
                location: 'top',
                columns: 0,
                isPushDown: false,
                buttonState: false,
            });
        }
        setSelectedId(id);
    }, [category, connectionId, addScript, addAlias, addTrigger, addTimer, addKeybinding, addButton]);

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
        else if (category === 'keys')      updateKeybinding(connectionId, id, { enabled: !item.enabled });
        else                               updateButton(connectionId, id, { enabled: !item.enabled });
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
        } else if (category === 'keys') {
            updateKeybinding(connectionId, selectedId, { name: editName, key: editKey, modifiers: editModifiers, language: editLang, code: editCode, command: editKeyCommand || undefined });
        } else {
            // buttons
            if (selected.isGroup) {
                updateButton(connectionId, selectedId, {
                    name: editName,
                    language: editLang,
                    code: editCode,
                    location: editToolbarLocation,
                    orientation: editToolbarOrientation,
                    columns: editToolbarColumns,
                    styleSheet: editButtonStyleSheet || undefined,
                });
            } else {
                updateButton(connectionId, selectedId, {
                    name: editName,
                    language: editLang,
                    code: editCode,
                    command: editButtonCommand || undefined,
                    isPushDown: editButtonIsPushDown,
                    commandDown: editButtonIsPushDown ? (editButtonCommandDown || undefined) : undefined,
                    icon:      editButtonIcon    || undefined,
                    tooltip:   editButtonTooltip || undefined,
                    styleSheet: editButtonStyleSheet || undefined,
                });
            }
        }
        setDirty(false);
    };

    const handleDelete = () => {
        if (!selectedId) return;
        if (category === 'scripts')        removeScript(connectionId, selectedId);
        else if (category === 'aliases')   removeAlias(connectionId, selectedId);
        else if (category === 'triggers')  removeTrigger(connectionId, selectedId);
        else if (category === 'timers')    removeTimer(connectionId, selectedId);
        else if (category === 'keys')      removeKeybinding(connectionId, selectedId);
        else                               removeButton(connectionId, selectedId);
        setSelectedId(null);
    };

    const handleTabKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) {
            e.preventDefault();
            handleSave();
            return;
        }
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

    const isEditCategory = category !== 'errors' && category !== 'packages';
    const categoryLabel = isEditCategory ? CATEGORY_LABELS[category as EditCategory].toLowerCase() : '';
    const emptyMsg = items.length === 0
        ? `No ${categoryLabel} yet — click "+ New" to create one`
        : `Select a ${categoryLabel.replace(/s$/, '')} to edit`;

    return (
        <div className="script-editor">
            {/* Category nav */}
            <div className="script-editor__nav">
                {EDIT_CATEGORIES.map(cat => {
                    const Icon = CATEGORY_ICON[cat];
                    return (
                        <button
                            key={cat}
                            className={`script-editor__nav-btn script-editor__nav-btn--row${category === cat ? ' script-editor__nav-btn--active' : ''}`}
                            onClick={() => setCategory(cat)}
                        >
                            <Icon size={13} strokeWidth={1.6} className="script-editor__nav-icon" />
                            <span className="script-editor__nav-label">{CATEGORY_LABELS[cat]}</span>
                        </button>
                    );
                })}
                <div className="script-editor__nav-sep" />
                <button
                    className={`script-editor__nav-btn script-editor__nav-btn--row${category === 'errors' ? ' script-editor__nav-btn--active' : ''}`}
                    onClick={() => setCategory('errors')}
                >
                    <AlertCircle size={13} strokeWidth={1.6} className="script-editor__nav-icon" />
                    <span className="script-editor__nav-label">Errors</span>
                    {unreadErrors > 0 && (
                        <span className="script-editor__error-badge">{unreadErrors > 99 ? '99+' : unreadErrors}</span>
                    )}
                </button>
                <div className="script-editor__nav-sep" />
                <button
                    className={`script-editor__nav-btn script-editor__nav-btn--row${category === 'packages' ? ' script-editor__nav-btn--active' : ''}`}
                    onClick={() => setCategory('packages')}
                >
                    <Package size={13} strokeWidth={1.6} className="script-editor__nav-icon" />
                    <span className="script-editor__nav-label">Packages</span>
                    {packages.length > 0 && (
                        <span className="script-editor__error-badge" style={{ background: '#3a3a3a' }}>{packages.length}</span>
                    )}
                </button>
                <button className="script-editor__nav-import" onClick={() => importFileRef.current?.click()} title="Import Mudlet package (.mpackage / .zip / .xml)">
                    Import Package
                </button>
                <input ref={importFileRef} type="file" accept=".xml,.mpackage,.zip" style={{ display: 'none' }} onChange={handleImportFile} />
            </div>

            {/* Item list — hidden on the Errors and Packages tabs */}
            {isEditCategory && <div className="script-editor__list" style={{ width: listWidth }}>
                <div className="script-editor__list-resize" onMouseDown={handleListResizeStart} />
                <div className="script-editor__list-header">
                    <Button variant="secondary" size="sm" onClick={() => handleNew(false)}>+ New</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleNew(true)}>+ {category === 'buttons' ? BUTTON_GROUP_SINGULAR : 'Group'}</Button>
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
                        const childCount = item.isGroup ? (childCounts.get(item.id) ?? 0) : 0;
                        const isEmptyGroup = item.isGroup && childCount === 0;
                        return (
                            <div
                                key={item.id}
                                draggable
                                className={[
                                    'script-editor__item',
                                    isSelected ? 'script-editor__item--selected' : '',
                                    item.isGroup ? 'script-editor__item--group' : '',
                                    isEmptyGroup ? 'script-editor__item--empty-group' : '',
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
                                        title={isEmptyGroup ? 'Empty group' : (isExpanded ? 'Collapse' : 'Expand')}
                                    >
                                        <ItemIcon category={category} isGroup={true} isExpanded={isExpanded && !isEmptyGroup} />
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
                                    {item.isGroup && !isEmptyGroup && (
                                        <span className="script-editor__item-count">{childCount}</span>
                                    )}
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

            {/* Packages view */}
            {category === 'packages' && (
                <div className="script-editor__error-log-view">
                    <div className="script-editor__error-log-header">
                        <span className="script-editor__error-log-title">
                            {packages.length === 0 ? 'No packages installed' : `${packages.length} installed`}
                        </span>
                        {importError && <span className="script-editor__import-error" title={importError}>Import failed: {importError}</span>}
                    </div>
                    <div className="script-editor__error-log-entries">
                        {packages.length === 0 ? (
                            <span className="script-editor__log-empty">
                                Click "Import Package" above to install a Mudlet package (.mpackage / .zip / .xml).
                            </span>
                        ) : (
                            packages.map(pkg => {
                                const created = pkg.created ? formatPackageDate(pkg.created) : null;
                                const installed = new Date(pkg.installedAt).toLocaleString();
                                return (
                                    <div key={pkg.name} className="script-editor__pkg-card">
                                        <PackageIcon vfs={vfs} pkg={pkg} />
                                        <div className="script-editor__pkg-body">
                                            <div className="script-editor__pkg-title">{pkg.title || pkg.name}</div>
                                            <div className="script-editor__pkg-byline">
                                                {pkg.name !== (pkg.title || pkg.name) && <span>{pkg.name}</span>}
                                                {pkg.version && <><span className="script-editor__pkg-byline-sep">·</span><span>v{pkg.version}</span></>}
                                                {pkg.author && <><span className="script-editor__pkg-byline-sep">·</span><span>{pkg.author}</span></>}
                                            </div>
                                            {pkg.description && <PackageDescription text={pkg.description} />}
                                            <div className="script-editor__pkg-footer">
                                                {pkg.sourceFile ?? `${pkg.name}.mpackage`}
                                                {created && <> · created {created}</>}
                                                {' · installed '}{installed}
                                            </div>
                                        </div>
                                        <button
                                            className="script-editor__error-log-clear"
                                            onClick={async () => {
                                                const ok = await confirm<boolean>({
                                                    title: 'Uninstall package?',
                                                    tone: 'danger',
                                                    message: (
                                                        <>
                                                            Uninstall <strong>{pkg.title || pkg.name}</strong>? All scripts, aliases,
                                                            triggers, timers and keys it added will be removed, along with its files
                                                            in <code>/{pkg.name}/</code>.
                                                        </>
                                                    ),
                                                    buttons: [
                                                        { label: 'Cancel', value: false, variant: 'secondary' },
                                                        { label: 'Uninstall', value: true, variant: 'danger', autoFocus: true },
                                                    ],
                                                    dismissValue: false,
                                                });
                                                if (ok) handleUninstall(pkg.name);
                                            }}
                                        >
                                            Uninstall
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

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
                                    {entry.source && (
                                        <button
                                            className="script-editor__error-log-jump"
                                            type="button"
                                            onClick={() => handleErrorJump(entry.source!)}
                                            title={`Open ${entry.source.kind} "${entry.source.name}"${entry.source.line !== undefined ? ` at line ${entry.source.line}` : ''}`}
                                            aria-label={`Open ${entry.source.kind} ${entry.source.name}`}
                                        >
                                            →
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                        <div ref={errorLogEndRef} />
                    </div>
                </div>
            )}

            {/* Editor pane */}
            {isEditCategory && selected ? (
                <div className="script-editor__pane">
                    <div
                        className="script-editor__meta"
                        ref={metaRef}
                        style={metaHeight !== null ? { height: metaHeight, overflowY: 'auto' } : {}}
                    >
                        <div className="script-editor__meta-row">
                            {selected.isGroup && (
                                <span className="script-editor__group-badge">{category === 'buttons' ? BUTTON_GROUP_SINGULAR : 'Group'}</span>
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

                                {/* Matching & Highlight sections (side by side when space allows) */}
                                <div className="script-editor__trigger-cards-row">
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
                                            <input
                                                type="color"
                                                className="script-editor__color-pick"
                                                value={editHighlightFg || '#ff0000'}
                                                disabled={!editHighlightFg}
                                                onChange={e => { setEditHighlightFg(e.target.value); setDirty(true); }}
                                            />
                                            <div className="script-editor__trigger-card-divider" />
                                            <label className="script-editor__trigger-opt">
                                                <input
                                                    type="checkbox"
                                                    checked={!!editHighlightBg}
                                                    onChange={e => { setEditHighlightBg(e.target.checked ? '#000080' : ''); setDirty(true); }}
                                                />
                                                BG
                                            </label>
                                            <input
                                                type="color"
                                                className="script-editor__color-pick"
                                                value={editHighlightBg || '#000080'}
                                                disabled={!editHighlightBg}
                                                onChange={e => { setEditHighlightBg(e.target.value); setDirty(true); }}
                                            />
                                        </div>
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
                                <span className="script-editor__field-label">Event handlers (one per line — fires the global function named after this script)</span>
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
                        {category === 'buttons' && selected.isGroup && (
                            <div className="script-editor__meta-row">
                                <span className="script-editor__field-label">Location</span>
                                <select
                                    className="script-editor__lang-select"
                                    value={editToolbarLocation}
                                    onChange={e => { setEditToolbarLocation(e.target.value as ButtonLocation); setDirty(true); }}
                                >
                                    {BUTTON_LOCATIONS.map(loc => (
                                        <option key={loc} value={loc}>{loc[0].toUpperCase() + loc.slice(1)}</option>
                                    ))}
                                </select>
                                <span className="script-editor__field-label">Orientation</span>
                                <select
                                    className="script-editor__lang-select"
                                    value={editToolbarOrientation}
                                    onChange={e => { setEditToolbarOrientation(e.target.value as ButtonOrientation); setDirty(true); }}
                                >
                                    {BUTTON_ORIENTATIONS.map(o => (
                                        <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>
                                    ))}
                                </select>
                                <span className="script-editor__field-label">
                                    {editToolbarOrientation === 'horizontal' ? 'Rows' : 'Columns'}
                                </span>
                                <input
                                    type="number"
                                    className="script-editor__time-part"
                                    value={editToolbarColumns}
                                    min={0}
                                    title={editToolbarOrientation === 'horizontal'
                                        ? '0 = single row; N = wrap into N rows (Mudlet buttonColumn)'
                                        : '0 = single column; N = wrap into N columns (Mudlet buttonColumn)'}
                                    onChange={e => {
                                        const v = parseInt(e.target.value, 10);
                                        setEditToolbarColumns(isNaN(v) || v < 0 ? 0 : v);
                                        setDirty(true);
                                    }}
                                />
                            </div>
                        )}
                        {category === 'buttons' && !selected.isGroup && (
                            <>
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editButtonCommand}
                                        onChange={e => { setEditButtonCommand(e.target.value); setDirty(true); }}
                                        placeholder={editButtonIsPushDown ? 'Command (up — released)' : 'Command to send'}
                                    />
                                </div>
                                {editButtonIsPushDown && (
                                    <div className="script-editor__meta-row">
                                        <Input
                                            className="script-editor__pattern"
                                            value={editButtonCommandDown}
                                            onChange={e => { setEditButtonCommandDown(e.target.value); setDirty(true); }}
                                            placeholder="Command (down — pressed)"
                                        />
                                    </div>
                                )}
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editButtonIcon}
                                        onChange={e => { setEditButtonIcon(e.target.value); setDirty(true); }}
                                        placeholder="Icon path (relative to profile root)"
                                    />
                                </div>
                                <div className="script-editor__meta-row">
                                    <Input
                                        className="script-editor__pattern"
                                        value={editButtonTooltip}
                                        onChange={e => { setEditButtonTooltip(e.target.value); setDirty(true); }}
                                        placeholder="Tooltip"
                                    />
                                </div>
                                <div className="script-editor__meta-row">
                                    <label className="script-editor__trigger-opt">
                                        <input
                                            type="checkbox"
                                            checked={editButtonIsPushDown}
                                            onChange={e => { setEditButtonIsPushDown(e.target.checked); setDirty(true); }}
                                        />
                                        Two-state (push-down) button
                                    </label>
                                </div>
                            </>
                        )}
                        {category === 'buttons' && (
                            <div className="script-editor__meta-row script-editor__meta-row--col">
                                <span className="script-editor__field-label">Stylesheet (stored, not yet applied)</span>
                                <textarea
                                    className="script-editor__patterns"
                                    value={editButtonStyleSheet}
                                    onChange={e => { setEditButtonStyleSheet(e.target.value); setDirty(true); }}
                                    placeholder="QPushButton { ... }"
                                    spellCheck={false}
                                />
                            </div>
                        )}
                    </div>

                    <div className="script-editor__meta-resize" onMouseDown={handleMetaResizeStart} />

                    {editLang === 'lua' ? (
                        <LuaEditor
                            value={editCode}
                            onChange={code => { setEditCode(code); setDirty(true); }}
                            onSave={handleSave}
                            gotoLine={editorGotoLine}
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
                isEditCategory && <div className="script-editor__empty">{emptyMsg}</div>
            )}

            {ctxMenu && isEditCategory && (
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
                        Add {category === 'buttons' ? BUTTON_GROUP_SINGULAR : 'Group'}
                    </button>
                </ContextMenu>
            )}
        </div>
    );
}
