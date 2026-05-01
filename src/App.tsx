import { useCallback, useEffect, useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { DockRoot } from './ui/windows/DockRoot';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { useAppStore, connectionUrl, type MudConnection } from './storage';
import { ScriptingEngine } from './scripting/ScriptingEngine';
import { AliasEngine } from './mud/aliases/AliasEngine';
import { TriggerEngine } from './mud/triggers/TriggerEngine';
import { ScriptEditorPanel } from './ui/windows/panels/ScriptEditorPanel';
import type { SerializedLayout } from './ui/windows/types';
import type { Script } from './storage/schema';

// Stable fallback so the Zustand selector always returns the same reference
// when there are no scripts — avoids an infinite re-render loop.
const NO_SCRIPTS: Script[] = [];

export default function App() {
    const { session, status, ping, passwordMode, connect, disconnect, send } = useMudSession();
    const [command, setCommand] = useState('');
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [scriptsOpen, setScriptsOpen] = useState(false);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const connections = useAppStore(s => s.connections);
    const addConnection = useAppStore(s => s.addConnection);
    const removeConnection = useAppStore(s => s.removeConnection);
    const connectionLayouts = useAppStore(s => s.connectionLayouts);
    const saveLayout = useAppStore(s => s.saveLayout);

    // AliasEngine + TriggerEngine + ScriptingEngine — created per session, destroyed on disconnect/new-connection
    const aliasEngineRef = useRef<AliasEngine | null>(null);
    const triggerEngineRef = useRef<TriggerEngine | null>(null);
    const engineRef = useRef<ScriptingEngine | null>(null);
    useEffect(() => {
        if (!sessionStarted) return;
        const aliasEngine = new AliasEngine();
        const triggerEngine = new TriggerEngine();
        const engine = new ScriptingEngine(session, aliasEngine, triggerEngine);
        aliasEngineRef.current = aliasEngine;
        triggerEngineRef.current = triggerEngine;
        engineRef.current = engine;
        return () => {
            engine.destroy();
            aliasEngine.destroy();
            triggerEngine.destroy();
            engineRef.current = null;
            aliasEngineRef.current = null;
            triggerEngineRef.current = null;
        };
    }, [session, sessionStarted]);

    // Reload scripts whenever the store changes for the active connection.
    const activeScripts = useAppStore(s =>
        activeConnection ? (s.connectionScripts[activeConnection.id] ?? NO_SCRIPTS) : NO_SCRIPTS,
    );
    useEffect(() => {
        engineRef.current?.loadScripts(activeScripts);
    }, [activeScripts]);

    // Reload permanent aliases from store into AliasEngine whenever they change.
    const NO_ALIASES = useRef<never[]>([]).current;
    const activeAliases = useAppStore(s =>
        activeConnection ? (s.connectionAliases[activeConnection.id] ?? NO_ALIASES) : NO_ALIASES,
    );
    useEffect(() => {
        aliasEngineRef.current?.loadPerm(activeAliases);
    }, [activeAliases]);

    // Reload permanent triggers from store into TriggerEngine whenever they change.
    const NO_TRIGGERS = useRef<never[]>([]).current;
    const activeTriggers = useAppStore(s =>
        activeConnection ? (s.connectionTriggers[activeConnection.id] ?? NO_TRIGGERS) : NO_TRIGGERS,
    );
    useEffect(() => {
        triggerEngineRef.current?.loadPerm(activeTriggers);
    }, [activeTriggers]);

    const handleConnect = (connection: MudConnection) => {
        setActiveConnection(connection);
        setSessionStarted(true);
        connect(connectionUrl(connection));
    };

    const handleDisconnect = () => {
        disconnect();
    };

    const handleReconnect = () => {
        if (activeConnection) connect(connectionUrl(activeConnection));
    };

    const handleNewConnection = () => {
        disconnect();
        setActiveConnection(null);
        setSessionStarted(false);
    };

    const handleOpenMap = () => {
        session.windows.open('map', { kind: 'map', title: 'Map', position: 'right' });
    };

    const handleOpenScripts = () => setScriptsOpen(v => !v);

    const handleSend = () => {
        const consumed = engineRef.current?.processInput(command) ?? false;
        if (!consumed) send(command);
        setCommand('');
    };

    const activeConnectionId = activeConnection?.id ?? null;
    const handleLayoutChange = useCallback(
        (layout: SerializedLayout) => {
            if (activeConnectionId) saveLayout(activeConnectionId, layout);
        },
        [activeConnectionId, saveLayout],
    );

    if (!sessionStarted) {
        return (
            <div className="app">
                <ConnectionScreen
                    connections={connections}
                    connecting={status === 'connecting'}
                    connectingId={activeConnection?.id ?? null}
                    onConnect={handleConnect}
                    onAdd={addConnection}
                    onDelete={removeConnection}
                />
            </div>
        );
    }

    const initialLayout = activeConnectionId ? connectionLayouts[activeConnectionId] ?? null : null;

    return (
        <div className="app">
            <Toolbar
                connectionName={activeConnection?.name ?? ''}
                status={status}
                ping={ping}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
                onNewConnection={handleNewConnection}
                onOpenMap={handleOpenMap}
                onOpenScripts={handleOpenScripts}
            />
            <div className="dock-section">
                <DockRoot
                    key={activeConnectionId ?? 'no-connection'}
                    session={session}
                    manager={session.windows}
                    stickyLines={5}
                    initialLayout={initialLayout}
                    onLayoutChange={handleLayoutChange}
                    commandInputRef={commandInputRef}
                />
                {scriptsOpen && (
                    <aside className="scripts-sidebar">
                        <ScriptEditorPanel connectionId={activeConnectionId ?? ''} session={session} />
                    </aside>
                )}
            </div>
            <CommandBar
                command={command}
                onCommandChange={setCommand}
                passwordMode={passwordMode}
                commandInputRef={commandInputRef}
                onSubmit={handleSend}
            />
        </div>
    );
}
