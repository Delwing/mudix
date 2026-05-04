import { useCallback, useEffect, useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { ContentLayout } from './ui/layout/ContentLayout';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { useAppStore, connectionUrl, type MudConnection } from './storage';
import { useEngines } from './hooks/useEngines';
import { ScriptEditorModal } from './ui/windows/ScriptEditorModal';
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
    const windowContextMenuHandlerRef = useRef<((e: React.MouseEvent) => void) | null>(null);
    const connections = useAppStore(s => s.connections);
    const addConnection = useAppStore(s => s.addConnection);
    const updateConnection = useAppStore(s => s.updateConnection);
    const removeConnection = useAppStore(s => s.removeConnection);
    const connectionWindowHints = useAppStore(s => s.connectionWindowHints);
    const connectionDockExtents = useAppStore(s => s.connectionDockExtents);
    const saveWindowHint = useAppStore(s => s.saveWindowHint);
    const saveDockExtents = useAppStore(s => s.saveDockExtents);

    const { aliasEngineRef, triggerEngineRef, engineRef } = useEngines(session, sessionStarted);

    // Reload scripts whenever the store changes for the active connection.
    const activeScripts = useAppStore(s =>
        activeConnection ? (s.connectionScripts[activeConnection.id] ?? NO_SCRIPTS) : NO_SCRIPTS,
    );
    // When handleScriptSave hot-reloads a single script, the subsequent Zustand
    // update causes activeScripts to change and would trigger a full loadScripts
    // (which destroys the runtime). We skip that full reload when the only change
    // is the one script we already individually reloaded.
    const pendingHotReload = useRef<string | null>(null);
    const lastLoadedSnap = useRef<{ scripts: Script[]; session: typeof session } | null>(null);
    const pendingOutputReadyUnsub = useRef<(() => void) | null>(null);
    useEffect(() => {
        const hotId = pendingHotReload.current;
        pendingHotReload.current = null;

        pendingOutputReadyUnsub.current?.();
        pendingOutputReadyUnsub.current = null;

        const snap = lastLoadedSnap.current;
        if (hotId && snap && snap.session === session) {
            const prev = snap.scripts;
            const onlyHotChanged =
                prev.length === activeScripts.length &&
                activeScripts.every(s => s.id === hotId || prev.some(p => p === s));
            if (onlyHotChanged) {
                lastLoadedSnap.current = { scripts: activeScripts, session };
                return;
            }
        }

        lastLoadedSnap.current = { scripts: activeScripts, session };

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
        pendingHotReload.current = script.id;
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
        // Load hints synchronously BEFORE any renders so they're ready when scripts run.
        // (Child useEffects fire before App's, meaning output.ready could fire before
        //  a deferred setWindowHints effect, causing open() to miss dock positions.)
        const hints   = connectionWindowHints[connection.id] ?? {};
        const extents = connectionDockExtents[connection.id];
        if (extents) session.windows.setDockExtentsFromStorage(extents);
        session.windows.setWindowHints(hints);
        setActiveConnection(connection);
        setSessionStarted(true);
        connect(connectionUrl(connection));
    };

    const handleOpenOffline = (connection: MudConnection) => {
        const hints   = connectionWindowHints[connection.id] ?? {};
        const extents = connectionDockExtents[connection.id];
        if (extents) session.windows.setDockExtentsFromStorage(extents);
        session.windows.setWindowHints(hints);
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
        session.windows.clearAll();
        setActiveConnection(null);
        setSessionStarted(false);
    };

    const handleOpenMap = () => {
        if (session.windows.isVisible('map')) {
            session.windows.hide('map');
        } else {
            session.windows.open('map', { kind: 'map', title: 'Map', position: 'right', autoOpen: true });
        }
    };

    const handleOpenScripts = () => setScriptsOpen(v => !v);
    const handleOpenSettings = () => setSettingsOpen(v => !v);

    const handleSend = () => {
        const consumed = engineRef.current?.processInput(command) ?? false;
        if (!consumed) {
            session.echoCommand(command);
            send(command, false);
        }
        setCommand('');
    };

    const activeConnectionId = activeConnection?.id ?? null;

    // Wire up save callbacks (re-established whenever connection or savers change).
    useEffect(() => {
        session.windows.onWindowHint = activeConnectionId
            ? (id, hint) => saveWindowHint(activeConnectionId, id, hint)
            : undefined;
        session.windows.onWindowClosed = activeConnectionId
            ? (id) => saveWindowHint(activeConnectionId, id, { autoOpen: false })
            : undefined;
        session.windows.onDockExtentsChange = activeConnectionId
            ? (extents) => saveDockExtents(activeConnectionId, extents)
            : undefined;
        return () => {
            session.windows.onWindowHint        = undefined;
            session.windows.onWindowClosed      = undefined;
            session.windows.onDockExtentsChange = undefined;
        };
    }, [session, activeConnectionId, saveWindowHint, saveDockExtents]);

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
                    onUpdate={updateConnection}
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
                onContextMenu={e => windowContextMenuHandlerRef.current?.(e)}
            />
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            <div className="app-content">
                <ContentLayout
                    session={session}
                    manager={session.windows}
                    stickyLines={DEFAULT_STICKY_LINES}
                    commandInputRef={commandInputRef}
                    contextMenuHandlerRef={windowContextMenuHandlerRef}
                    commandBar={
                        <CommandBar
                            command={command}
                            onCommandChange={setCommand}
                            passwordMode={passwordMode}
                            commandInputRef={commandInputRef}
                            onSubmit={handleSend}
                        />
                    }
                />
            </div>
            {scriptsOpen && (
                <ScriptEditorModal
                    connectionId={activeConnectionId ?? ''}
                    session={session}
                    onScriptSave={handleScriptSave}
                    onClose={() => setScriptsOpen(false)}
                />
            )}
        </div>
    );
}
