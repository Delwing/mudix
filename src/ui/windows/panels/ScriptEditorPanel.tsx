import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '../../components';
import { useAppStore } from '../../../storage';
import type { Script } from '../../../storage/schema';
import type { MudSession } from '../../../mud/MudSession';
import './ScriptEditorPanel.css';

const EMPTY_SCRIPTS: Script[] = [];

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
}

export function ScriptEditorPanel({ connectionId, session }: ScriptEditorPanelProps) {

    const scripts      = useAppStore(s => s.connectionScripts[connectionId] ?? EMPTY_SCRIPTS);
    const addScript    = useAppStore(s => s.addScript);
    const updateScript = useAppStore(s => s.updateScript);
    const removeScript = useAppStore(s => s.removeScript);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editName, setEditName]     = useState('');
    const [editLang, setEditLang]     = useState<Script['language']>('lua');
    const [editCode, setEditCode]     = useState('');
    const [dirty, setDirty]           = useState(false);
    const [logs, setLogs]             = useState<LogEntry[]>([]);

    const logEndRef = useRef<HTMLDivElement>(null);

    const selected = scripts.find(s => s.id === selectedId) ?? null;

    useEffect(() => {
        if (!selected) return;
        setEditName(selected.name);
        setEditLang(selected.language);
        setEditCode(selected.code);
        setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // Subscribe to script error/log events from the session.
    useEffect(() => {
        return session.events.on('script.log', (text, level) => {
            setLogs(prev => [...prev, { text, level }]);
        });
    }, [session]);

    // Auto-scroll log to bottom when new entries arrive.
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [logs]);

    const handleNew = () => {
        const id = addScript(connectionId, {
            name: 'New Script',
            language: 'lua',
            code: DEFAULT_LUA,
            enabled: true,
        });
        setSelectedId(id);
    };

    const handleSave = () => {
        if (!selectedId) return;
        setLogs([]);
        updateScript(connectionId, selectedId, {
            name: editName,
            language: editLang,
            code: editCode,
        });
        setDirty(false);
    };

    const handleDelete = () => {
        if (!selectedId) return;
        removeScript(connectionId, selectedId);
        setSelectedId(null);
    };

    const handleToggle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const sc = scripts.find(s => s.id === id);
        if (sc) updateScript(connectionId, id, { enabled: !sc.enabled });
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
        requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 2;
        });
    };

    return (
        <div className="script-editor">
            {/* Script list */}
            <div className="script-editor__list">
                <div className="script-editor__list-header">
                    <Button variant="secondary" size="sm" onClick={handleNew}>+ New</Button>
                </div>
                <div className="script-editor__items">
                    {scripts.map(sc => (
                        <div
                            key={sc.id}
                            className={`script-editor__item${sc.id === selectedId ? ' script-editor__item--selected' : ''}`}
                            onClick={() => setSelectedId(sc.id)}
                        >
                            <input
                                type="checkbox"
                                checked={sc.enabled}
                                onChange={() => {}}
                                onClick={e => handleToggle(sc.id, e)}
                                style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span className="script-editor__item-name">{sc.name}</span>
                            <span className={`script-editor__lang-badge script-editor__lang-badge--${sc.language}`}>
                                {sc.language}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Editor pane */}
            {selected ? (
                <div className="script-editor__pane">
                    <div className="script-editor__meta">
                        <Input
                            className="script-editor__name"
                            value={editName}
                            onChange={e => { setEditName(e.target.value); setDirty(true); }}
                            placeholder="Script name"
                        />
                        <select
                            className="script-editor__lang-select"
                            value={editLang}
                            onChange={e => {
                                const lang = e.target.value as Script['language'];
                                setEditLang(lang);
                                if (!dirty) setEditCode(lang === 'lua' ? DEFAULT_LUA : DEFAULT_JS);
                                setDirty(true);
                            }}
                        >
                            <option value="lua">Lua</option>
                            <option value="js">JS</option>
                        </select>
                    </div>

                    <textarea
                        className="script-editor__code"
                        value={editCode}
                        onChange={e => { setEditCode(e.target.value); setDirty(true); }}
                        onKeyDown={handleTabKey}
                        spellCheck={false}
                        autoComplete="off"
                    />

                    {/* Script log */}
                    <div className="script-editor__log">
                        {logs.length === 0
                            ? <span className="script-editor__log-empty">No output</span>
                            : logs.map((entry, i) => (
                                <div
                                    key={i}
                                    className={`script-editor__log-entry script-editor__log-entry--${entry.level}`}
                                >
                                    {entry.text}
                                </div>
                            ))
                        }
                        <div ref={logEndRef} />
                    </div>

                    <div className="script-editor__actions">
                        <Button variant="ghost" size="sm" onClick={handleDelete}>Delete</Button>
                        <Button variant="primary" size="sm" onClick={handleSave}>
                            {dirty ? 'Save & Run' : 'Run'}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="script-editor__empty">
                    {scripts.length === 0
                        ? 'No scripts yet — click "+ New" to create one'
                        : 'Select a script to edit'}
                </div>
            )}
        </div>
    );
}
