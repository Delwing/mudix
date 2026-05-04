import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '../../components';
import { useAppStore } from '../../../storage';
import type { PermanentAlias, PermanentTimer, PermanentTrigger, Script } from '../../../storage/schema';
import type { MudSession } from '../../../mud/MudSession';
import { LuaEditor } from './LuaEditor';
import './ScriptEditorPanel.css';

type Category = 'scripts' | 'aliases' | 'triggers' | 'timers';

const CATEGORY_LABELS: Record<Category, string> = {
    scripts: 'Scripts',
    aliases: 'Aliases',
    triggers: 'Triggers',
    timers: 'Timers',
};

const EMPTY: never[] = [];

const DEFAULT_LUA = `-- mudix Lua script
-- Available API:
--   send(text)                     send a command to the MUD
--   echo(text)                     print to main output
--   cecho("<color>text<r>")        print with named colors
--   mudix.on('output', fn)         receive MUD output lines
--   mudix.on('gmcp', fn)           receive GMCP packets
--   mudix.on('connect', fn)        fired on connect
--   mudix.on('disconnect', fn)     fired on disconnect
--   mudix.windows.open(id, opts)   open a panel
--   mudix.windows.write(id, text)  write to a panel

mudix.on('connect', function()
    echo('Connected!')
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

    const scripts  = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY);
    const aliases  = useAppStore(s => s.connectionAliases[connectionId] ?? EMPTY);
    const triggers = useAppStore(s => s.connectionTriggers[connectionId] ?? EMPTY);
    const timers   = useAppStore(s => s.connectionTimers[connectionId] ?? EMPTY);

    const addScript     = useAppStore(s => s.addScript);
    const updateScript  = useAppStore(s => s.updateScript);
    const removeScript  = useAppStore(s => s.removeScript);
    const addAlias      = useAppStore(s => s.addAlias);
    const updateAlias   = useAppStore(s => s.updateAlias);
    const removeAlias   = useAppStore(s => s.removeAlias);
    const addTrigger    = useAppStore(s => s.addTrigger);
    const updateTrigger = useAppStore(s => s.updateTrigger);
    const removeTrigger = useAppStore(s => s.removeTrigger);
    const addTimer      = useAppStore(s => s.addTimer);
    const updateTimer   = useAppStore(s => s.updateTimer);
    const removeTimer   = useAppStore(s => s.removeTimer);

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

    const [dirty, setDirty] = useState(false);
    const [logs, setLogs]   = useState<LogEntry[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    const items: Array<Script | PermanentAlias | PermanentTrigger | PermanentTimer> =
        category === 'scripts'  ? scripts  :
        category === 'aliases'  ? aliases  :
        category === 'triggers' ? triggers :
        timers;

    const selected = items.find(i => i.id === selectedId) ?? null;

    useEffect(() => {
        setSelectedId(null);
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

    const handleNew = () => {
        let id: string;
        if (category === 'scripts') {
            id = addScript(connectionId, { name: 'New Script', language: 'lua', code: DEFAULT_LUA, enabled: true });
        } else if (category === 'aliases') {
            id = addAlias(connectionId, { name: 'New Alias', pattern: '^$', language: 'lua', code: '', enabled: true });
        } else if (category === 'triggers') {
            id = addTrigger(connectionId, { name: 'New Trigger', pattern: '^$', language: 'lua', code: '', enabled: true });
        } else {
            id = addTimer(connectionId, { name: 'New Timer', seconds: 60, language: 'lua', code: '', repeat: true, enabled: true });
        }
        setSelectedId(id);
    };

    const handleToggle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const item = items.find(i => i.id === id);
        if (!item) return;
        if (category === 'scripts')  updateScript(connectionId, id, { enabled: !item.enabled });
        else if (category === 'aliases')  updateAlias(connectionId, id, { enabled: !item.enabled });
        else if (category === 'triggers') updateTrigger(connectionId, id, { enabled: !item.enabled });
        else updateTimer(connectionId, id, { enabled: !item.enabled });
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
        } else {
            updateTimer(connectionId, selectedId, { name: editName, seconds: editSeconds, repeat: editRepeat, language: editLang, code: editCode });
        }
        setDirty(false);
    };

    const handleDelete = () => {
        if (!selectedId) return;
        if (category === 'scripts')       removeScript(connectionId, selectedId);
        else if (category === 'aliases')  removeAlias(connectionId, selectedId);
        else if (category === 'triggers') removeTrigger(connectionId, selectedId);
        else removeTimer(connectionId, selectedId);
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
                            <span className="script-editor__item-name">{item.name}</span>
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
