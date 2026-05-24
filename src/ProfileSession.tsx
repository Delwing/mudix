import { useEffect, useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { useEngines } from './hooks/useEngines';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { BufferWordIndex } from './ui/bufferWords';
import { ContentLayout } from './ui/layout/ContentLayout';
import { ScriptEditorModal } from './ui/windows/ScriptEditorModal';
import { SettingsModal } from './ui/SettingsModal';
import { FileBrowserModal } from './ui/FileBrowserModal';
import { LogBrowserModal } from './ui/LogBrowserModal';
import { QuickOpenPalette } from './ui/QuickOpenPalette';
import { SessionLogger } from './logging/SessionLogger';
import { useAppStore, selectProfileField, ConnectionIdContext, connectionUrl, type MudConnection } from './storage';
import { DEFAULT_STICKY_LINES } from './hooks/useOutput';
import { applyOutputFont, primeLocalFontsCache } from './utils/fontLoader';
import type { MudSession } from './mud/MudSession';

interface Props {
    connection: MudConnection;
    /** If true, dial the WebSocket on mount. Offline mode skips this. */
    autoConnect: boolean;
    settingsOpen: boolean;
    onToggleSettings: () => void;
    onCloseProfile: () => void;
}

export function ProfileSession({ connection, autoConnect, settingsOpen, onToggleSettings, onCloseProfile }: Props) {
    const { session, status, ping, passwordMode, connect, disconnect, send } = useMudSession();

    const [command, setCommand] = useState('');
    const [scriptsOpen, setScriptsOpen] = useState(false);
    const [filesOpen, setFilesOpen] = useState<false | { initialPath?: string; initialLine?: number; pickedAt?: number }>(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [quickOpenOpen, setQuickOpenOpen] = useState(false);
    const [cmdLineSuggestions, setCmdLineSuggestions] = useState<string[]>([]);
    const [bufferWords, setBufferWords] = useState<BufferWordIndex | null>(null);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const windowContextMenuHandlerRef = useRef<((e: React.MouseEvent) => void) | null>(null);

    // Live mirror of the current command bar text — read by Lua's getCmdLine()
    // through the provider registered on the engine. Updated in render so the
    // provider always returns the latest value the user has typed.
    const commandRef = useRef(command);
    commandRef.current = command;

    const outputFont = useAppStore(s => selectProfileField(s, connection.id, 'outputFont'));
    const promptTimeoutMs = useAppStore(s => selectProfileField(s, connection.id, 'promptTimeoutMs'));
    // Undefined defaults to enabled (see ProfileSettings.loggingEnabled).
    const loggingEnabled = useAppStore(s => selectProfileField(s, connection.id, 'loggingEnabled')) !== false;
    const connectionWindowHints = useAppStore(s => s.connectionWindowHints);
    const connectionDockExtents = useAppStore(s => s.connectionDockExtents);
    const saveWindowHint = useAppStore(s => s.saveWindowHint);
    const saveDockExtents = useAppStore(s => s.saveDockExtents);

    // Seed window hints + dock extents on the fresh session synchronously during
    // render. They must be in place before child useEffects fire (e.g. DockRoot
    // emitting output.ready, which triggers scripts that call windows.open).
    // Keyed by session identity so the StrictMode synthetic swap re-seeds too.
    const seededFor = useRef<MudSession | null>(null);
    if (seededFor.current !== session) {
        seededFor.current = session;
        const hints   = connectionWindowHints[connection.id] ?? {};
        const extents = connectionDockExtents[connection.id];
        if (extents) session.windows.setDockExtentsFromStorage(extents);
        session.windows.setConnectionId(connection.id);
        session.windows.setWindowHints(hints);
    }

    const { engineRef } = useEngines(session, true, connection);

    // Auto-connect on mount. Re-runs if `session` swaps under StrictMode, so the
    // replacement session also dials. Held in a ref so a later prop change to
    // `autoConnect` doesn't re-trigger.
    const autoConnectRef = useRef(autoConnect);
    useEffect(() => {
        if (autoConnectRef.current && !session.destroyed) {
            session.connect(connectionUrl(connection, useAppStore.getState().client.userProxyUrl));
        }
    }, [session, connection]);

    useEffect(() => {
        if (typeof promptTimeoutMs === 'number') {
            session.setPromptTimeoutMs(promptTimeoutMs);
        }
    }, [promptTimeoutMs, session]);

    // Record this session's output to the persistent log store. One logger per
    // profile-session lifetime; reconnects within the same mount append to it.
    // Toggling the setting off stops recording (and flushes what's buffered).
    useEffect(() => {
        if (!loggingEnabled) return;
        const logger = new SessionLogger(session, connection.id, connection.name);
        logger.start();
        return () => { void logger.stop(); };
    }, [session, connection.id, connection.name, loggingEnabled]);

    // Index words from this session's output for argument-word Tab completion in
    // the command bar. Lives for the session's lifetime; one per connection.
    useEffect(() => {
        const index = new BufferWordIndex(session);
        index.start();
        setBufferWords(index);
        return () => { index.stop(); setBufferWords(null); };
    }, [session]);

    useEffect(() => {
        void applyOutputFont(outputFont, engineRef.current?.currentVFS ?? null);
    }, [outputFont, engineRef]);

    // Warm the Local Font Access cache once per profile mount so the first
    // call to getAvailableFonts() from Lua sees installed system fonts. Silent
    // — only queries when permission is already granted; never prompts.
    useEffect(() => { void primeLocalFontsCache(); }, []);

    // Clear the input whenever the server toggles IAC ECHO. Otherwise the
    // previously typed char name remains in state and renders as dots in the
    // password field — and on the way back out, the password would briefly
    // surface as plaintext.
    useEffect(() => {
        setCommand('');
    }, [passwordMode]);

    useEffect(() => {
        const unsub1 = session.events.on('script.appendcmd', (text: string) => {
            setCommand(prev => prev + text);
        });
        const unsub2 = session.events.on('script.setcmd', (text: string) => {
            setCommand(text);
            // Mudlet sendCmdLine ends with selectAll; replicate so the user can
            // overtype or hit Backspace to clear without manually selecting.
            queueMicrotask(() => {
                const el = commandInputRef.current;
                if (!el) return;
                el.focus();
                el.select();
            });
        });
        const unsub3 = session.events.on('script.clearcmd', () => {
            setCommand('');
        });
        const unsub4 = session.events.on('script.openvfs', (path: string) => {
            setFilesOpen({ initialPath: path, pickedAt: Date.now() });
        });
        const unsub5 = session.events.on('script.cmdlinesuggestions', (items: string[]) => {
            setCmdLineSuggestions(items);
        });
        return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
    }, [session]);

    // Register the getCmdLine provider on the engine. Effect re-runs when the
    // engine instance changes (connection swap). Suggestions state is reset
    // here too because the new engine starts with an empty Set.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.setCmdLineProvider(() => commandRef.current);
        setCmdLineSuggestions([]);
        return () => engine.setCmdLineProvider(null);
    }, [session, connection.id, engineRef]);

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
    }, [engineRef]);

    // Global keydown listener — fires keybindings, but not when focused in a textarea (e.g. script editor).
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (target.tagName === 'INPUT' && !(target as HTMLInputElement).classList.contains('command-input')) return;
            if (engineRef.current?.processKey(e)) e.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [engineRef]);

    // Quick-open (Cmd+P / Ctrl+P). Fires regardless of focus so it also works
    // from inside CodeMirror editors and the command bar. preventDefault on the
    // event suppresses the browser's print dialog.
    useEffect(() => {
        const handleQuickOpen = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
                if (!engineRef.current?.currentVFS) return;
                e.preventDefault();
                e.stopPropagation();
                setQuickOpenOpen(true);
            }
        };
        document.addEventListener('keydown', handleQuickOpen, true);
        return () => document.removeEventListener('keydown', handleQuickOpen, true);
    }, [engineRef]);

    useEffect(() => {
        session.windows.onWindowHint        = (id, hint) => saveWindowHint(connection.id, id, hint);
        session.windows.onWindowClosed      = (id)        => saveWindowHint(connection.id, id, { autoOpen: false });
        session.windows.onDockExtentsChange = (extents)   => saveDockExtents(connection.id, extents);
        session.windows.onMapOpen           = ()          => engineRef.current?.notifyMapOpen();
        return () => {
            session.windows.onWindowHint        = undefined;
            session.windows.onWindowClosed      = undefined;
            session.windows.onDockExtentsChange = undefined;
            session.windows.onMapOpen           = undefined;
        };
    }, [session, connection.id, saveWindowHint, saveDockExtents, engineRef]);

    const handleDisconnect = () => disconnect();
    const handleReconnect  = () => connect(connectionUrl(connection, useAppStore.getState().client.userProxyUrl));

    const handleOpenMap = () => {
        if (session.windows.isVisible('map')) {
            session.windows.hide('map');
        } else {
            session.windows.open('map', { kind: 'map', title: 'Map', position: 'right', autoOpen: true });
        }
    };

    const handleOpenScripts  = () => setScriptsOpen(v => !v);
    const handleOpenFiles    = () => setFilesOpen(v => v ? false : {});
    const handleOpenVfsFile  = (initialPath: string, initialLine?: number) =>
        setFilesOpen({ initialPath, ...(initialLine !== undefined ? { initialLine } : {}), pickedAt: Date.now() });

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

    return (
        <ConnectionIdContext.Provider value={connection.id}>
        <div className="app">
            <Toolbar
                connectionName={connection.name}
                status={status}
                ping={ping}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
                onNewConnection={onCloseProfile}
                onOpenMap={handleOpenMap}
                onOpenScripts={handleOpenScripts}
                onOpenFiles={handleOpenFiles}
                onOpenLogs={() => setLogsOpen(true)}
                onOpenSettings={onToggleSettings}
                onContextMenu={e => windowContextMenuHandlerRef.current?.(e)}
            />
            {settingsOpen && (
                <SettingsModal
                    onClose={onToggleSettings}
                    connectionId={connection.id}
                    vfs={engineRef.current?.currentVFS ?? null}
                />
            )}
            <div className="app-content">
                <ContentLayout
                    session={session}
                    manager={session.windows}
                    connectionId={connection.id}
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
                            cmdLineMenu={session.cmdLineMenu}
                            suggestions={cmdLineSuggestions}
                            bufferWords={bufferWords}
                        />
                    }
                />
            </div>
            {scriptsOpen && (
                <ScriptEditorModal
                    connectionId={connection.id}
                    session={session}
                    vfs={engineRef.current?.currentVFS ?? null}
                    scriptingEngineRef={engineRef}
                    onClose={() => setScriptsOpen(false)}
                    onOpenVfsFile={handleOpenVfsFile}
                />
            )}
            {filesOpen && (
                <FileBrowserModal
                    connectionId={connection.id}
                    vfs={engineRef.current?.currentVFS ?? null}
                    initialPath={filesOpen.initialPath ?? null}
                    initialPathTick={filesOpen.pickedAt}
                    initialLine={filesOpen.initialLine}
                    onClose={() => setFilesOpen(false)}
                />
            )}
            {logsOpen && (
                <LogBrowserModal
                    connectionId={connection.id}
                    connectionName={connection.name}
                    onClose={() => setLogsOpen(false)}
                />
            )}
            {quickOpenOpen && engineRef.current?.currentVFS && (
                <QuickOpenPalette
                    vfs={engineRef.current.currentVFS}
                    onPick={path => handleOpenVfsFile(path)}
                    onClose={() => setQuickOpenOpen(false)}
                />
            )}
        </div>
        </ConnectionIdContext.Provider>
    );
}
