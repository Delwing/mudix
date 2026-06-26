import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Input } from '../../components';
import { useAppStore } from '../../../storage/appStore';
import type { ScriptingEngine } from '../../../scripting/ScriptingEngine';
import type { LuaGlobalEntry } from '../../../scripting/IScriptingRuntime';

const EMPTY_LIST: string[] = [];

interface VariablesViewProps {
    connectionId: string;
    scriptingEngineRef?: React.RefObject<ScriptingEngine | null>;
}

/** A short, single-line preview of an entry's value for the list. */
function preview(entry: LuaGlobalEntry): string {
    if (entry.isTable) return entry.children?.length ? `{ ${entry.children.length} }` : '{ }';
    if (entry.valueType === 'nil') return 'not set';
    const v = entry.value ?? '';
    return v.length > 80 ? `${v.slice(0, 80)}…` : v;
}

function byName(a: LuaGlobalEntry, b: LuaGlobalEntry): number {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Mudlet's Variables view: the live `_G` tree with a checkbox per top-level
 * entry that toggles whether it persists across sessions (the profile's
 * save-list / Mudlet `<VariablePackage>`). Built-in globals — the default Lua +
 * Mudlet API namespace present at runtime boot — are hidden by default (toggle
 * to show), matching Mudlet, so only your own variables appear. Tables expand to
 * browse their contents. Functions/userdata/threads are shown but not flaggable.
 * Save flagging is at top-level granularity (checking a table persists all of
 * it); per-key flagging is a follow-up.
 */
export function VariablesView({ connectionId, scriptingEngineRef }: VariablesViewProps) {
    const saveList = useAppStore(s => s.connectionVariables[connectionId]?.saveList ?? EMPTY_LIST);
    const setSaveList = useAppStore(s => s.setVariableSaveList);
    const [globals, setGlobals] = useState<LuaGlobalEntry[]>([]);
    const [filter, setFilter] = useState('');
    const [showBuiltins, setShowBuiltins] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const refresh = useCallback(() => {
        setGlobals(scriptingEngineRef?.current?.listGlobals() ?? []);
    }, [scriptingEngineRef]);

    // Snapshot `_G` when the view opens. It changes as scripts run, so the
    // Refresh button re-reads on demand rather than polling.
    useEffect(() => { refresh(); }, [refresh]);

    const savedSet = useMemo(() => new Set(saveList), [saveList]);

    const topRows = useMemo(() => {
        const byNameMap = new Map(globals.map(g => [g.name, g]));
        // Surface saved names that aren't currently in _G (e.g. set later by a
        // script) so they remain visible and removable.
        for (const name of saveList) {
            if (!byNameMap.has(name)) byNameMap.set(name, { name, valueType: 'nil', saveable: true });
        }
        const f = filter.trim().toLowerCase();
        return [...byNameMap.values()]
            // Built-ins hidden unless toggled — but a saved global always shows.
            .filter(g => showBuiltins || !g.builtin || savedSet.has(g.name))
            .filter(g => !f || g.name.toLowerCase().includes(f))
            .sort(byName);
    }, [globals, saveList, filter, showBuiltins, savedSet]);

    const toggleSave = useCallback((name: string) => {
        const next = new Set(saveList);
        if (next.has(name)) next.delete(name); else next.add(name);
        setSaveList(connectionId, [...next]);
    }, [saveList, setSaveList, connectionId]);

    const toggleExpand = useCallback((key: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const renderRows = useCallback((entries: LuaGlobalEntry[], depth: number, parentKey: string): React.ReactNode[] => {
        const rows: React.ReactNode[] = [];
        for (const g of entries) {
            const key = `${parentKey}${g.name}`;
            const kids = g.children ? [...g.children].sort(byName) : [];
            const hasChildren = kids.length > 0;
            const isOpen = expanded.has(key);
            const checked = depth === 0 && savedSet.has(g.name);
            rows.push(
                <div
                    key={key}
                    title={depth === 0 && g.saveable ? 'Toggle save across sessions'
                        : g.saveable ? '' : `${g.valueType} — not saveable`}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '3px 12px', paddingLeft: 12 + depth * 16,
                        opacity: g.saveable ? 1 : 0.5,
                        borderBottom: '1px solid var(--border, #2a2a2a)',
                    }}
                >
                    {g.isTable && hasChildren ? (
                        <button
                            onClick={() => toggleExpand(key)}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex', flexShrink: 0 }}
                            title={isOpen ? 'Collapse' : 'Expand'}
                        >
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                    ) : (
                        <span style={{ width: 13, flexShrink: 0 }} />
                    )}
                    {depth === 0 ? (
                        <input
                            type="checkbox"
                            checked={checked}
                            disabled={!g.saveable}
                            onChange={() => toggleSave(g.name)}
                            style={{ accentColor: 'var(--accent)', cursor: g.saveable ? 'pointer' : 'default', flexShrink: 0 }}
                        />
                    ) : (
                        <span style={{ width: 13, flexShrink: 0 }} />
                    )}
                    <span style={{ fontFamily: 'var(--mono, monospace)', flexShrink: 0, fontWeight: checked ? 600 : 400 }}>
                        {g.name}
                    </span>
                    <span style={{ opacity: 0.5, fontSize: 11, flexShrink: 0 }}>{g.valueType}</span>
                    <span style={{
                        opacity: 0.7, marginLeft: 'auto', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--mono, monospace)',
                    }}>
                        {preview(g)}
                    </span>
                </div>,
            );
            if (hasChildren && isOpen) rows.push(...renderRows(kids, depth + 1, key));
        }
        return rows;
    }, [expanded, savedSet, toggleExpand, toggleSave]);

    return (
        <div className="script-editor__error-log-view">
            <div className="script-editor__error-log-header">
                <span className="script-editor__error-log-title">
                    {saveList.length} saved · {topRows.length} shown
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', opacity: 0.85 }}>
                        <input
                            type="checkbox"
                            checked={showBuiltins}
                            onChange={e => setShowBuiltins(e.target.checked)}
                            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                        Show built-ins
                    </label>
                    <Input
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder="Filter…"
                        style={{ width: 140, height: 26 }}
                    />
                    <Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>
                </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', fontSize: 12 }}>
                {topRows.length === 0 ? (
                    <div style={{ padding: 16, opacity: 0.6 }}>
                        {globals.length === 0
                            ? 'No globals — open/connect the profile so the Lua runtime is running, then Refresh.'
                            : showBuiltins ? 'No globals match the filter.'
                            : 'No user variables yet. Globals you create appear here; tick one to save it across sessions.'}
                    </div>
                ) : renderRows(topRows, 0, '')}
            </div>
        </div>
    );
}
