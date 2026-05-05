import { useCallback, useEffect, useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { ContentLayout } from './ui/layout/ContentLayout';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { useAppStore, connectionUrl, type MudConnection } from './storage';
import { useEngines } from './hooks/useEngines';
import { TriggerEngine } from './mud/triggers/TriggerEngine';
import { ScriptEditorModal } from './ui/windows/ScriptEditorModal';
import { SettingsModal } from './ui/SettingsModal';
import { FileBrowserModal } from './ui/FileBrowserModal';
import type { ScriptNode } from './storage/schema';
import { isEffectivelyEnabled } from './storage/schema';
import { DEFAULT_STICKY_LINES } from './hooks/useOutput';

// Stable fallback so the Zustand selector always returns the same reference
// when there are no scripts — avoids an infinite re-render loop.
const NO_SCRIPTS: ScriptNode[] = [];

export default function App() {
    const { session, status, ping, passwordMode, connect, disconnect, send } = useMudSession();
    const [command, setCommand] = useState('');
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [scriptsOpen, setScriptsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [filesOpen, setFilesOpen] = useState(false);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const windowContextMenuHandlerRef = useRef<((e: React.MouseEvent) => void) | null>(null);
    const deepLinkProfileId = useRef(new URLSearchParams(window.location.search).get('profile'));
    const theme = useAppStore(s => s.ui.theme);
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
    const connections = useAppStore(s => s.connections);
    const addConnection = useAppStore(s => s.addConnection);
    const updateConnection = useAppStore(s => s.updateConnection);
    const removeConnection = useAppStore(s => s.removeConnection);
    const connectionWindowHints = useAppStore(s => s.connectionWindowHints);
    const connectionDockExtents = useAppStore(s => s.connectionDockExtents);
    const saveWindowHint = useAppStore(s => s.saveWindowHint);
    const saveDockExtents = useAppStore(s => s.saveDockExtents);

    const { aliasEngineRef, triggerEngineRef, engineRef } = useEngines(session, sessionStarted, activeConnection);

    // Reload scripts whenever the store changes for the active connection.
    const activeScripts = useAppStore(s =>
        activeConnection ? (s.connectionScripts[activeConnection.id] ?? NO_SCRIPTS) : NO_SCRIPTS,
    );
    // Set when handleScriptSave pre-emptively reloads a single script so the
    // subsequent store update doesn't double-reload it via the diff below.
    const pendingHotReload = useRef<string | null>(null);
    const lastLoadedSnap = useRef<{ scripts: ScriptNode[]; session: typeof session; connId: string } | null>(null);
    const pendingOutputReadyUnsub = useRef<(() => void) | null>(null);
    useEffect(() => {
        const hotId = pendingHotReload.current;
        pendingHotReload.current = null;

        pendingOutputReadyUnsub.current?.();
        pendingOutputReadyUnsub.current = null;

        const connId = activeConnection?.id ?? '';
        const snap = lastLoadedSnap.current;
        lastLoadedSnap.current = { scripts: activeScripts, session, connId };

        // First load, session change, or connection switch → full reload.
        if (!snap || snap.session !== session || snap.connId !== connId) {
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
        }

        // Incremental diff: run only newly-enabled scripts or those whose code/
        // handlers changed. Deleted or disabled scripts leave dirty Lua state that
        // persists until the next full reload (connection switch / reconnect).
        const prevEnabled = new Map(
            snap.scripts
                .filter(s => s.language === 'lua' && isEffectivelyEnabled(s, snap.scripts))
                .map(s => [s.id, s]),
        );

        for (const s of activeScripts) {
            if (s.language !== 'lua' || !isEffectivelyEnabled(s, activeScripts)) continue;
            if (s.id === hotId) continue; // Already reloaded by handleScriptSave.
            const was = prevEnabled.get(s.id);
            if (!was) {
                engineRef.current?.reloadScript(s); // Newly enabled or created.
            } else if (was.code !== s.code || was.eventHandlers.join('\n') !== s.eventHandlers.join('\n')) {
                engineRef.current?.reloadScript(s); // Code or event-handler binding changed.
            }
            // Metadata-only changes (name, parentId, ordering) → no reload.
        }
    }, [activeScripts, session, activeConnection]);

    const handleScriptSave = useCallback((script: ScriptNode) => {
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
        let cancelled = false;
        // PCRE pattern compilation is sync once the wasm is initialized; gate the
        // first load on that so patterns aren't silently dropped at compile time.
        TriggerEngine.ready().then(() => {
            if (cancelled) return;
            triggerEngineRef.current?.loadPerm(activeTriggers);
        });
        return () => { cancelled = true; };
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

    // Drain disk-backed VFS writes before navigation. Folder-linked profiles
    // use async write-through; without this, edits made just before close can
    // be lost. visibilitychange fires more reliably on mobile/PWA than unload.
    useEffect(() => {
        const flush = () => { engineRef.current?.currentVFS?.flush(); };
        const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', onVis);
        return () => {
            window.removeEventListener('beforeunload', flush);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    // Global keydown listener — fires keybindings, but not when focused in a textarea (e.g. script editor).
    useEffect(() => {
        if (!sessionStarted) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (target.tagName === 'INPUT' && !(target as HTMLInputElement).classList.contains('command-input')) return;
            if (engineRef.current?.processKey(e)) e.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [sessionStarted]);

    const setProfileQuery = (id: string | null) => {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set('profile', id);
        else url.searchParams.delete('profile');
        window.history.replaceState(null, '', url.toString());
    };

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
        setProfileQuery(connection.id);
        connect(connectionUrl(connection));
    };

    const handleOpenOffline = (connection: MudConnection) => {
        const hints   = connectionWindowHints[connection.id] ?? {};
        const extents = connectionDockExtents[connection.id];
        if (extents) session.windows.setDockExtentsFromStorage(extents);
        session.windows.setWindowHints(hints);
        setActiveConnection(connection);
        setSessionStarted(true);
        setProfileQuery(connection.id);
    };

    // Auto-connect when the page is loaded with ?profile=<id>
    useEffect(() => {
        const id = deepLinkProfileId.current;
        if (!id || sessionStarted) return;
        const conn = connections.find(c => c.id === id);
        if (!conn) return;
        deepLinkProfileId.current = null;
        handleConnect(conn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connections]);

    const handleDisconnect = () => {
        disconnect();
    };

    const handleReconnect = () => {
        if (activeConnection) connect(connectionUrl(activeConnection));
    };

    const handleNewConnection = () => {
        disconnect();
        session.windows.clearAll();
        session.gauges.clearAll();
        session.labels.clearAll();
        setActiveConnection(null);
        setSessionStarted(false);
        setProfileQuery(null);
    };

    const handleOpenMap = () => {
        if (session.windows.isVisible('map')) {
            session.windows.hide('map');
        } else {
            session.windows.open('map', { kind: 'map', title: 'Map', position: 'right', autoOpen: true });
        }
    };

    const handleOpenScripts = () => setScriptsOpen(v => !v);
    const handleOpenFiles = () => setFilesOpen(v => !v);
    const handleOpenSettings = () => setSettingsOpen(v => !v);

    const handleSend = () => {
        const consumed = engineRef.current?.processInput(command) ?? false;
        if (!consumed) {
            // Routes through ScriptingAPI.send so sysDataSendRequest fires and
            // denyCurrentSend() can suppress the command. Falls back to the bare
            // session.send before the engine is ready (offline profile, init race).
            if (engineRef.current) {
                engineRef.current.sendCommand(command);
            } else {
                session.echoCommand(command);
                send(command, false);
            }
        }
        commandInputRef.current?.select();
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
        session.windows.onMapOpen = () => engineRef.current?.notifyMapOpen();
        return () => {
            session.windows.onWindowHint        = undefined;
            session.windows.onWindowClosed      = undefined;
            session.windows.onDockExtentsChange = undefined;
            session.windows.onMapOpen           = undefined;
        };
    }, [session, activeConnectionId, saveWindowHint, saveDockExtents, engineRef]);

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
                onOpenFiles={handleOpenFiles}
                onOpenSettings={handleOpenSettings}
                onContextMenu={e => windowContextMenuHandlerRef.current?.(e)}
            />
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            <div className="app-content">
                <ContentLayout
                    session={session}
                    manager={session.windows}
                    connectionId={activeConnectionId ?? ''}
                    stickyLines={DEFAULT_STICKY_LINES}
                    commandInputRef={commandInputRef}
                    contextMenuHandlerRef={windowContextMenuHandlerRef}
                    scriptingEngineRef={engineRef}
                    vfs={engineRef.current?.currentVFS ?? null}
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
                    vfs={engineRef.current?.currentVFS ?? null}
                    onScriptSave={handleScriptSave}
                    onClose={() => setScriptsOpen(false)}
                />
            )}
            {filesOpen && (
                <FileBrowserModal
                    connectionId={activeConnectionId ?? ''}
                    vfs={engineRef.current?.currentVFS ?? null}
                    onClose={() => setFilesOpen(false)}
                />
            )}
        </div>
    );
}
