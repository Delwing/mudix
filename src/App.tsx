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
import { TimerEngine } from './mud/timers/TimerEngine';
import { KeyEngine } from './mud/keybindings/KeyEngine';
import { ScriptEditorPanel } from './ui/windows/panels/ScriptEditorPanel';
import { SettingsModal } from './ui/SettingsModal';
import type { Script } from './storage/schema';
import { DEFAULT_STICKY_LINES } from './hooks/useOutput';

// Stable fallback so the Zustand selector always returns the same reference
// when there are no scripts — avoids an infinite re-render loop.
const NO_SCRIPTS: Script[] = [];

export default function App() {
    const { session, status, ping, passwordMode, connect, disconnect, send } = useMudSession();
    const [command, setCommand] = useState('');
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [scriptsOpen, setScriptsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const connections = useAppStore(s => s.connections);
    const addConnection = useAppStore(s => s.addConnection);
    const removeConnection = useAppStore(s => s.removeConnection);
    const connectionWindowHints = useAppStore(s => s.connectionWindowHints);
    const saveWindowHint = useAppStore(s => s.saveWindowHint);

    // All scripting engines — created per session, destroyed on disconnect/new-connection
    const aliasEngineRef = useRef<AliasEngine | null>(null);
    const triggerEngineRef = useRef<TriggerEngine | null>(null);
    const timerEngineRef = useRef<TimerEngine | null>(null);
    const keyEngineRef = useRef<KeyEngine | null>(null);
    const engineRef = useRef<ScriptingEngine | null>(null);
    useEffect(() => {
        if (!sessionStarted) return;
        const aliasEngine = new AliasEngine();
        const triggerEngine = new TriggerEngine();
        const timerEngine = new TimerEngine();
        const keyEngine = new KeyEngine();
        const engine = new ScriptingEngine(session, aliasEngine, triggerEngine, timerEngine, keyEngine);
        aliasEngineRef.current = aliasEngine;
        triggerEngineRef.current = triggerEngine;
        timerEngineRef.current = timerEngine;
        keyEngineRef.current = keyEngine;
        engineRef.current = engine;
        return () => {
            engine.destroy();
            aliasEngine.destroy();
            triggerEngine.destroy();
            timerEngine.destroy();
            keyEngine.destroy();
            engineRef.current = null;
            aliasEngineRef.current = null;
            triggerEngineRef.current = null;
            timerEngineRef.current = null;
            keyEngineRef.current = null;
        };
    }, [session, sessionStarted]);

    // Reload scripts whenever the store changes for the active connection.
    const activeScripts = useAppStore(s =>
        activeConnection ? (s.connectionScripts[activeConnection.id] ?? NO_SCRIPTS) : NO_SCRIPTS,
    );
    const suppressNextScriptReload = useRef(false);
    const pendingOutputReadyUnsub = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (suppressNextScriptReload.current) {
            suppressNextScriptReload.current = false;
            return;
        }

        pendingOutputReadyUnsub.current?.();
        pendingOutputReadyUnsub.current = null;

        if (session.outputReady) {
            engineRef.current?.loadScripts(activeScripts);
        } else {
            pendingOutputReadyUnsub.current = session.events.on('output.ready', () => {
                pendingOutputReadyUnsub.current = null;
                engineRef.current?.loadScripts(activeScripts);
            }, { once: true });
        }

        return () => {
            pendingOutputReadyUnsub.current?.();
            pendingOutputReadyUnsub.current = null;
        };
    }, [activeScripts, session]);

    const handleScriptSave = useCallback((script: Script) => {
        suppressNextScriptReload.current = true;
        engineRef.current?.reloadScript(script);
    }, []);

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

    // Reload permanent timers from store into ScriptingEngine whenever they change.
    const NO_TIMERS = useRef<never[]>([]).current;
    const activeTimers = useAppStore(s =>
        activeConnection ? (s.connectionTimers[activeConnection.id] ?? NO_TIMERS) : NO_TIMERS,
    );
    useEffect(() => {
        engineRef.current?.loadPermTimers(activeTimers);
    }, [activeTimers]);

    // Reload permanent keybindings from store into ScriptingEngine whenever they change.
    const NO_KEYBINDINGS = useRef<never[]>([]).current;
    const activeKeybindings = useAppStore(s =>
        activeConnection ? (s.connectionKeybindings[activeConnection.id] ?? NO_KEYBINDINGS) : NO_KEYBINDINGS,
    );
    useEffect(() => {
        engineRef.current?.loadPermKeybindings(activeKeybindings);
    }, [activeKeybindings]);

    // Script-driven command bar manipulation.
    useEffect(() => {
        const unsub1 = session.events.on('script.appendcmd', (text: string) => {
            setCommand(prev => prev + text);
        });
        const unsub2 = session.events.on('script.setcmd', (text: string) => {
            setCommand(text);
        });
        return () => { unsub1(); unsub2(); };
    }, [session]);

    // Global keydown listener — fires keybindings, but not when focused in a textarea (e.g. script editor).
    useEffect(() => {
        if (!sessionStarted) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (engineRef.current?.processKey(e)) e.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [sessionStarted]);

    const handleConnect = (connection: MudConnection) => {
        setActiveConnection(connection);
        setSessionStarted(true);
        connect(connectionUrl(connection));
    };

    const handleOpenOffline = (connection: MudConnection) => {
        setActiveConnection(connection);
        setSessionStarted(true);
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
    const handleOpenSettings = () => setSettingsOpen(v => !v);

    const handleSend = () => {
        const consumed = engineRef.current?.processInput(command) ?? false;
        if (!consumed) send(command);
        setCommand('');
    };

    const activeConnectionId = activeConnection?.id ?? null;

    // Wire up window position hints for the active connection.
    useEffect(() => {
        const hints = activeConnectionId ? (connectionWindowHints[activeConnectionId] ?? {}) : {};
        session.windows.setWindowHints(hints);
        session.windows.onWindowHint = activeConnectionId
            ? (id, hint) => saveWindowHint(activeConnectionId, id, hint)
            : undefined;
        return () => {
            session.windows.onWindowHint = undefined;
        };
    }, [session, activeConnectionId, connectionWindowHints, saveWindowHint]);

    if (!sessionStarted) {
        return (
            <div className="app">
                <ConnectionScreen
                    connections={connections}
                    connecting={status === 'connecting'}
                    connectingId={activeConnection?.id ?? null}
                    onConnect={handleConnect}
                    onOpen={handleOpenOffline}
                    onAdd={addConnection}
                    onDelete={removeConnection}
                    onOpenSettings={handleOpenSettings}
                />
                {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            </div>
        );
    }

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
                onOpenSettings={handleOpenSettings}
            />
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            <div className="dock-section">
                <DockRoot
                    key={activeConnectionId ?? 'no-connection'}
                    session={session}
                    manager={session.windows}
                    stickyLines={DEFAULT_STICKY_LINES}
                    commandInputRef={commandInputRef}
                />
                {scriptsOpen && (
                    <aside className="scripts-sidebar">
                        <ScriptEditorPanel connectionId={activeConnectionId ?? ''} session={session} onScriptSave={handleScriptSave} />
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
