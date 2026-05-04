import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '../../components';
import { useAppStore } from '../../../storage';
import type { PermanentAlias, PermanentKeybinding, PermanentTimer, PermanentTrigger, Script } from '../../../storage/schema';
import type { MudSession } from '../../../mud/MudSession';
import { LuaEditor } from './LuaEditor';
import './ScriptEditorPanel.css';

type Category = 'scripts' | 'aliases' | 'triggers' | 'timers' | 'keys';

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

const EMPTY: never[] = [];

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
    onScriptSave?: (script: Script) => void;
}

export function ScriptEditorPanel({ connectionId, session, onScriptSave }: ScriptEditorPanelProps) {
    const [category, setCategory] = useState<Category>('scripts');

    const scripts     = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY);
    const aliases     = useAppStore(s => s.connectionAliases[connectionId] ?? EMPTY);
    const triggers    = useAppStore(s => s.connectionTriggers[connectionId] ?? EMPTY);
    const timers      = useAppStore(s => s.connectionTimers[connectionId] ?? EMPTY);
    const keybindings = useAppStore(s => s.connectionKeybindings[connectionId] ?? EMPTY);

    const addScript        = useAppStore(s => s.addScript);
    const updateScript     = useAppStore(s => s.updateScript);
    const removeScript     = useAppStore(s => s.removeScript);
    const addAlias         = useAppStore(s => s.addAlias);
    const updateAlias      = useAppStore(s => s.updateAlias);
    const removeAlias      = useAppStore(s => s.removeAlias);
    const addTrigger       = useAppStore(s => s.addTrigger);
    const updateTrigger    = useAppStore(s => s.updateTrigger);
    const removeTrigger    = useAppStore(s => s.removeTrigger);
    const addTimer         = useAppStore(s => s.addTimer);
    const updateTimer      = useAppStore(s => s.updateTimer);
    const removeTimer      = useAppStore(s => s.removeTimer);
    const addKeybinding    = useAppStore(s => s.addKeybinding);
    const updateKeybinding = useAppStore(s => s.updateKeybinding);
    const removeKeybinding = useAppStore(s => s.removeKeybinding);

    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Common edit state
    const [editName, setEditName] = useState('');
    const [editLang, setEditLang] = useState<'lua' | 'js'>('lua');
    const [editCode, setEditCode] = useState('');
    // Alias / trigger extra
    const [editPattern, setEditPattern] = useState('');
    // Timer extra
    const [editSeconds, setEditSeconds] = useState(60);
    const [editRepeat, setEditRepeat]   = useState(true);
    // Key extra
    const [editKey, setEditKey]             = useState('');
    const [editModifiers, setEditModifiers] = useState<string[]>([]);
    const [capturing, setCapturing]         = useState(false);

    const [dirty, setDirty] = useState(false);
    const [logs, setLogs]   = useState<LogEntry[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    const items: Array<Script | PermanentAlias | PermanentTrigger | PermanentTimer | PermanentKeybinding> =
        category === 'scripts'  ? scripts  :
        category === 'aliases'  ? aliases  :
        category === 'triggers' ? triggers :
        category === 'timers'   ? timers   :
        keybindings;

    const selected = items.find(i => i.id === selectedId) ?? null;

    useEffect(() => {
        setSelectedId(null);
        setCapturing(false);
        setDirty(false);
    }, [category]);

    useEffect(() => {
        if (!selected) return;
        setEditName(selected.name);
        setEditLang(selected.language);
        setEditCode(selected.code);
        if ('pattern' in selected) setEditPattern((selected as { pattern: string }).pattern);
        if ('seconds' in selected) {
            const t = selected as unknown as { seconds: number; repeat: boolean };
            setEditSeconds(t.seconds);
            setEditRepeat(t.repeat);
        }
        if ('key' in selected) {
            const k = selected as PermanentKeybinding;
            setEditKey(k.key);
            setEditModifiers(k.modifiers);
        }
        setCapturing(false);
        setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

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

    const handleNew = () => {
        let id: string;
        if (category === 'scripts') {
            id = addScript(connectionId, { name: 'New Script', language: 'lua', code: DEFAULT_LUA, enabled: true });
        } else if (category === 'aliases') {
            id = addAlias(connectionId, { name: 'New Alias', pattern: '^$', language: 'lua', code: '', enabled: true });
        } else if (category === 'triggers') {
            id = addTrigger(connectionId, { name: 'New Trigger', pattern: '^$', language: 'lua', code: '', enabled: true });
        } else if (category === 'timers') {
            id = addTimer(connectionId, { name: 'New Timer', seconds: 60, language: 'lua', code: '', repeat: true, enabled: true });
        } else {
            id = addKeybinding(connectionId, { name: 'New Key', key: '', modifiers: [], language: 'lua', code: '', enabled: true });
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

    const handleSave = () => {
        if (!selectedId || !selected) return;
        setLogs([]);
        if (category === 'scripts') {
            updateScript(connectionId, selectedId, { name: editName, language: editLang, code: editCode });
            onScriptSave?.({ ...(selected as Script), name: editName, language: editLang, code: editCode });
        } else if (category === 'aliases') {
            updateAlias(connectionId, selectedId, { name: editName, pattern: editPattern, language: editLang, code: editCode });
        } else if (category === 'triggers') {
            updateTrigger(connectionId, selectedId, { name: editName, pattern: editPattern, language: editLang, code: editCode });
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
                    <Button variant="secondary" size="sm" onClick={handleNew}>+ New</Button>
                </div>
                <div className="script-editor__items">
                    {items.map(item => (
                        <div
                            key={item.id}
                            className={`script-editor__item${item.id === selectedId ? ' script-editor__item--selected' : ''}`}
                            onClick={() => setSelectedId(item.id)}
                        >
                            <input
                                type="checkbox"
                                checked={item.enabled}
                                onChange={() => {}}
                                onClick={e => handleToggle(item.id, e)}
                                style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span className="script-editor__item-name">
                                {item.name}
                                {'key' in item && (item as PermanentKeybinding).key && (
                                    <span className="script-editor__item-key">
                                        {formatKeyCombo((item as PermanentKeybinding).key, (item as PermanentKeybinding).modifiers)}
                                    </span>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Editor pane */}
            {selected ? (
                <div className="script-editor__pane">
                    <div className="script-editor__meta">
                        <div className="script-editor__meta-row">
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
                        {(category === 'aliases' || category === 'triggers') && (
                            <div className="script-editor__meta-row">
                                <Input
                                    className="script-editor__pattern"
                                    value={editPattern}
                                    onChange={e => { setEditPattern(e.target.value); setDirty(true); }}
                                    placeholder="Pattern (regex)"
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
