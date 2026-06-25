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
import { ScriptingDocsModal } from './ui/ScriptingDocsModal';
import { CharLoginModal } from './ui/CharLoginModal';
import { QuickOpenPalette } from './ui/QuickOpenPalette';
import { SessionLogger } from './logging/SessionLogger';
import { useAppStore, selectProfileField, ConnectionIdContext, connectionUrl, connectionSecureTransport, PROTOCOL_DEFAULTS, type MudConnection } from './storage';
import { DEFAULT_STICKY_LINES } from './hooks/useOutput';
import { applyOutputFont, primeLocalFontsCache } from './utils/fontLoader';
import { applyAnsiPalette, setServerRedefineColorsAllowed, resetAllPaletteColors } from './mud/text/colors';
import type { MudSession } from './mud/MudSession';
import { MUD_TELNET_SUBPROTOCOL } from './mud/connection/MudClient';

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
    const [docsOpen, setDocsOpen] = useState(false);
    const [quickOpenOpen, setQuickOpenOpen] = useState(false);
    // GMCP Char.Login credentials popup. Non-null while the server is waiting on
    // a Char.Login.Default reply; `error` carries a previous attempt's failure.
    const [charLogin, setCharLogin] = useState<{ error?: string } | null>(null);
    const [cmdLineSuggestions, setCmdLineSuggestions] = useState<string[]>([]);
    const [bufferWords, setBufferWords] = useState<BufferWordIndex | null>(null);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const windowContextMenuHandlerRef = useRef<((e: React.MouseEvent) => void) | null>(null);

    // Live mirror of the current command bar text — read by Lua's getCmdLine()
    // through the provider registered on the engine. Updated in render so the
    // provider always returns the latest value the user has typed.
    const commandRef = useRef(command);
    commandRef.current = command;
    // Last command actually sent. Used by the password-mode useEffect to tell
    // the leftover character-name case ("MyChar" still showing when the server
    // toggles ECHO) apart from a freshly-typed partial password.
    const lastSentRef = useRef('');
    // Auto-login state. `autoLoginStage` drives the text-login state machine
    // (send account at the first prompt, password when the server enters
    // password mode). `gmcpAutoTried` guards against re-sending stored GMCP
    // credentials in a loop when they're wrong. Both reset on each connect.
    const autoLoginStage = useRef<'idle' | 'name' | 'password'>('idle');
    const gmcpAutoTried = useRef(false);

    const outputFont = useAppStore(s => selectProfileField(s, connection.id, 'outputFont'));
    const promptTimeoutMs = useAppStore(s => selectProfileField(s, connection.id, 'promptTimeoutMs'));
    const ansiPalette = useAppStore(s => selectProfileField(s, connection.id, 'ansiPalette'));
    const serverRedefineColors = useAppStore(s => selectProfileField(s, connection.id, 'serverRedefineColors'));
    const autoClearInput = useAppStore(s => selectProfileField(s, connection.id, 'autoClearInput')) === true;
    const commandSeparator = useAppStore(s => selectProfileField(s, connection.id, 'commandSeparator')) ?? '';
    const commandEchoForeground = useAppStore(s => selectProfileField(s, connection.id, 'commandEchoForeground'));
    const commandEchoBackground = useAppStore(s => selectProfileField(s, connection.id, 'commandEchoBackground'));
    // Saved GMCP Char.Login credentials (password is plaintext — opt-in only).
    const charLoginAccount = useAppStore(s => selectProfileField(s, connection.id, 'charLoginAccount'));
    const charLoginPassword = useAppStore(s => selectProfileField(s, connection.id, 'charLoginPassword'));
    const patchProfile = useAppStore(s => s.patchConnectionProfile);
    const protocols = useAppStore(s => selectProfileField(s, connection.id, 'protocols'));
    const gmcpEnabled = protocols?.gmcp ?? PROTOCOL_DEFAULTS.gmcp;
    const mttsEnabled = protocols?.mtts ?? PROTOCOL_DEFAULTS.mtts;
    const msdpEnabled = protocols?.msdp ?? PROTOCOL_DEFAULTS.msdp;
    const msspEnabled = protocols?.mssp ?? PROTOCOL_DEFAULTS.mssp;
    const charsetEnabled = protocols?.charset ?? PROTOCOL_DEFAULTS.charset;
    const mspEnabled = protocols?.msp ?? PROTOCOL_DEFAULTS.msp;
    const mccpEnabled = protocols?.mccp ?? PROTOCOL_DEFAULTS.mccp;
    const mxpEnabled = protocols?.mxp ?? PROTOCOL_DEFAULTS.mxp;
    const mnesEnabled = protocols?.mnes ?? PROTOCOL_DEFAULTS.mnes;
    const newEnvironEnabled = protocols?.newEnviron ?? PROTOCOL_DEFAULTS.newEnviron;
    const nawsEnabled = protocols?.naws ?? PROTOCOL_DEFAULTS.naws;
    const wsTelnetSubprotocol = protocols?.wsTelnetSubprotocol ?? PROTOCOL_DEFAULTS.wsTelnetSubprotocol;
    // Undefined defaults to enabled (see ProfileSettings.loggingEnabled).
    const loggingEnabled = useAppStore(s => selectProfileField(s, connection.id, 'loggingEnabled')) !== false;
    // Mudlet's `showTabConnectionIndicators` (config bag). Defaults to true; when
    // on, the window title is prefixed with a connection-status dot. mudix has no
    // tab strip, so the indicator (and always the profile name) live in the title.
    const profileConfig = useAppStore(s => selectProfileField(s, connection.id, 'config'));
    const showConnectionIndicator = (profileConfig?.showTabConnectionIndicators as boolean | undefined) ?? true;
    // Mudlet's "enable blinking text" (config bag). When on, ANSI blink (SGR
    // 5/6) renders as a smooth opacity pulse; when off (the default) it's shown
    // in italics instead. The blink classes are always emitted by
    // FormatState.toHtml — this root class picks the presentation (see
    // App.css). Toggled on the document root so it covers the main output, user
    // windows, and mini-consoles alike.
    const blinkTextEnabled = (profileConfig?.enableBlinkText as boolean | undefined) ?? false;
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
    // Protocol toggles need to be on the session's options before the
    // autoConnect effect dials — the MudClient reads them at construction. Set
    // synchronously during render (matching the seededFor pattern); user-driven
    // toggles after the first connect take effect on the next reconnect.
    // Advertise the mudstandards.org telnet WebSocket profile only when the
    // profile opts in (see ProtocolSettings.wsTelnetSubprotocol).
    const subprotocols = wsTelnetSubprotocol ? [MUD_TELNET_SUBPROTOCOL] : [];
    // The NEW-ENVIRON TLS variable describes the game-facing link: a direct
    // wss:// connection is TLS, but proxy mode is plaintext upstream regardless
    // of the proxy URL scheme (see connectionSecureTransport).
    const secureTransport = connectionSecureTransport(connection);
    session.setProtocolOptions({ gmcpEnabled, mttsEnabled, msdpEnabled, msspEnabled, charsetEnabled, mspEnabled, mccpEnabled, mxpEnabled, mnesEnabled, newEnvironEnabled, secureTransport, nawsEnabled, subprotocols });
    // Mudlet's "Fix unnecessary linebreaks on GA servers" (config bag, persisted
    // by setConfig). Applied during render — like the protocol toggles above —
    // so it's on the session's options before autoConnect dials, and re-applied
    // live whenever the config bag changes.
    session.setFixUnnecessaryLinebreaks((profileConfig?.fixUnnecessaryLinebreaks as boolean | undefined) ?? false);

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

    useEffect(() => {
        document.documentElement.classList.toggle('blink-text-enabled', blinkTextEnabled);
        return () => { document.documentElement.classList.remove('blink-text-enabled'); };
    }, [blinkTextEnabled]);

    // Window title: always the profile name, prefixed with a connection-status
    // dot when showTabConnectionIndicators is on. Restored to the bare app name
    // when the profile is closed (back to the connection screen).
    useEffect(() => {
        const dot = status === 'connected' ? '🟢' : status === 'connecting' ? '🟡' : '🔴';
        const prefix = showConnectionIndicator ? `${dot} ` : '';
        document.title = `${prefix}${connection.name} — mudix`;
        return () => { document.title = 'mudix'; };
    }, [connection.name, status, showConnectionIndicator]);

    // Color for the local echo of sent commands (Settings → Colors). Empty
    // foreground falls back to Mudlet's olive; empty background = none.
    useEffect(() => {
        session.commandEchoColor = {
            fg: commandEchoForeground || '#717100',
            bg: commandEchoBackground || '',
        };
    }, [commandEchoForeground, commandEchoBackground, session]);

    // Per-profile ANSI palette override (Mudlet's Settings → Color). Mutates
    // the global colorCodes table so FormatState picks it up on the next parse;
    // restored to defaults on profile close so the connection screen / next
    // profile starts from a clean slate.
    useEffect(() => {
        applyAnsiPalette(ansiPalette);
        return () => applyAnsiPalette(undefined);
    }, [ansiPalette]);

    // Mudlet's "Allow server to redefine your colors" (default on). Gates the
    // global OSC 4/104 path. Turning it off also snaps the palette back to the
    // user's colors, revoking anything the server already redefined this session.
    useEffect(() => {
        const allowed = serverRedefineColors === true;
        setServerRedefineColorsAllowed(allowed);
        if (!allowed) resetAllPaletteColors();
        return () => setServerRedefineColorsAllowed(true);
    }, [serverRedefineColors]);

    // Record this session's output to the persistent log store. One logger per
    // profile-session lifetime; reconnects within the same mount append to it.
    // Toggling the setting off stops recording (and flushes what's buffered).
    // The active logger is held in a ref so Mudlet's startLogging(state) hook
    // (wired through ScriptingAPI below) can flip the recorder on/off without
    // racing the effect cleanup.
    const loggerRef = useRef<SessionLogger | null>(null);
    useEffect(() => {
        if (!loggingEnabled) return;
        const logger = new SessionLogger(session, connection.id, connection.name);
        logger.start();
        loggerRef.current = logger;
        return () => { loggerRef.current = null; void logger.stop(); };
    }, [session, connection.id, connection.name, loggingEnabled]);

    // Mudlet `startLogging(state)` — when true, create a logger on demand;
    // when false, stop any active one. Returns true so scripts can chain
    // off the call's success.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.setLoggingToggler((enabled: boolean) => {
            if (enabled) {
                if (loggerRef.current) return true;
                const l = new SessionLogger(session, connection.id, connection.name);
                l.start();
                loggerRef.current = l;
                return true;
            }
            const live = loggerRef.current;
            if (!live) return true;
            loggerRef.current = null;
            void live.stop();
            return true;
        });
        return () => engine.setLoggingToggler(null);
    }, [session, connection.id, connection.name, engineRef]);

    // Mudlet `appendLog(text)` → append a line to the live logger, and
    // `closeMudlet()` → disconnect + return to the connection screen.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.setLogAppender((text: string) => loggerRef.current?.appendLine(text));
        engine.setCloseProfileCallback(() => onCloseProfile());
        return () => {
            engine.setLogAppender(null);
            engine.setCloseProfileCallback(null);
        };
    }, [engineRef, onCloseProfile]);

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

    // When the server toggles IAC ECHO we clear the command line, but only if
    // the current text is the last command we sent — i.e. the character name
    // still showing because autoClearInput is off. If the user has already
    // started typing fresh password chars during the echo-debounce window we
    // keep them (mirrors Mudlet's TCommandLine "partial password" scenario).
    // Leaving password mode always clears, otherwise the password would
    // briefly surface as plaintext on the way back out.
    useEffect(() => {
        if (passwordMode) {
            if (commandRef.current && commandRef.current === lastSentRef.current) {
                setCommand('');
            }
        } else {
            setCommand('');
        }
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
        // Mudlet selectCmdLineText — highlight all text in the command bar so the
        // next keystroke overtypes it (same selectAll behaviour as script.setcmd).
        const unsub6 = session.events.on('script.selectcmd', () => {
            queueMicrotask(() => {
                const el = commandInputRef.current;
                if (!el) return;
                el.focus();
                el.select();
            });
        });
        // GMCP Char.Login: the server asks for credentials.
        const unsub7 = session.events.on('charLogin.request', (methods) => {
            // GMCP login takes over — disarm the text-login state machine.
            autoLoginStage.current = 'idle';
            // We only implement the password-credentials method; if the server
            // offers only other methods (e.g. OAuth), decline so it falls back to
            // its text login rather than showing a form we can't fulfil.
            if (methods.length > 0 && !methods.includes('password-credentials')) {
                session.sendCharLoginCredentials();
                return;
            }
            // If credentials are saved, send them straight away — no popup. The
            // guard stops wrong saved credentials from looping; a failure
            // (charLogin.result below) re-opens the popup prefilled for a retry.
            const st = useAppStore.getState();
            const account = selectProfileField(st, connection.id, 'charLoginAccount');
            const password = selectProfileField(st, connection.id, 'charLoginPassword');
            if (account && password && !gmcpAutoTried.current) {
                gmcpAutoTried.current = true;
                session.sendCharLoginCredentials(account, password);
                return;
            }
            setCharLogin({});
        });
        // Char.Login.Result: on failure re-open the popup with the server's
        // message; on success the popup was already dismissed on submit.
        const unsub8 = session.events.on('charLogin.result', (result) => {
            setCharLogin(result.success ? null : { error: result.message || 'Login failed.' });
        });
        // A reconnect/disconnect invalidates any pending login prompt.
        const unsub9 = session.events.on('client.disconnect', () => setCharLogin(null));
        return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub8(); unsub9(); };
    }, [session]);

    // Text-login auto-fill for MUDs without GMCP login. When the profile has
    // saved credentials, send the account at the first server prompt and the
    // password when the server switches to password mode (IAC ECHO off) —
    // mirroring Mudlet's saved-login. Armed on connect; disarmed after use, on
    // disconnect, or when GMCP Char.Login takes over (see charLogin.request).
    useEffect(() => {
        const readCreds = () => {
            const st = useAppStore.getState();
            return {
                account: selectProfileField(st, connection.id, 'charLoginAccount') ?? '',
                password: selectProfileField(st, connection.id, 'charLoginPassword') ?? '',
            };
        };
        const onConnect = () => {
            gmcpAutoTried.current = false;
            const { account, password } = readCreds();
            autoLoginStage.current = account && password ? 'name' : 'idle';
        };
        // First prompt ≈ the "By what name?" prompt: send the account (echoed,
        // since the server echoes it back off here just like a typed name).
        const onPrompt = () => {
            if (autoLoginStage.current !== 'name') return;
            const { account } = readCreds();
            if (!account) { autoLoginStage.current = 'idle'; return; }
            autoLoginStage.current = 'password';
            send(account, true);
        };
        // Server enters password mode (ECHO off) → send the password via the
        // secret path so it never surfaces as plaintext, even under the
        // showSentText='always' echo mode.
        const onEcho = (mask: boolean) => {
            if (!mask || autoLoginStage.current !== 'password') return;
            const { password } = readCreds();
            autoLoginStage.current = 'idle';
            if (password) session.sendSecret(password);
        };
        const onDisconnect = () => { autoLoginStage.current = 'idle'; };
        const u1 = session.events.on('client.connect', onConnect);
        const u2 = session.events.on('prompt', onPrompt);
        const u3 = session.events.on('telnet.echo', onEcho);
        const u4 = session.events.on('client.disconnect', onDisconnect);
        return () => { u1(); u2(); u3(); u4(); };
    }, [session, connection.id, send]);

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
        // Mudlet's command separator: one Enter expands to N commands, each run
        // through aliases independently. Empty separator (or a separator that
        // doesn't appear in the text) yields a single-element array, so the
        // single-command path is just a special case of the loop.
        const parts = commandSeparator && command.includes(commandSeparator)
            ? command.split(commandSeparator)
            : [command];
        for (const part of parts) {
            const consumed = engineRef.current?.processInput(part) ?? false;
            if (consumed) continue;
            // Routes through ScriptingAPI.send so sysDataSendRequest fires and
            // denyCurrentSend() can suppress the command. Falls back to the bare
            // session.send before the engine is ready (offline profile, init race).
            if (engineRef.current) {
                engineRef.current.sendCommand(part);
            } else {
                // echo=true lets session.send apply the showSentText mode itself
                // (avoids a double echo under 'always', which would echo here too).
                send(part, true);
            }
        }
        lastSentRef.current = command;
        if (autoClearInput) {
            setCommand('');
        } else {
            commandInputRef.current?.select();
        }
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
                onOpenDocs={() => setDocsOpen(true)}
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
            {docsOpen && (
                <ScriptingDocsModal
                    connectionId={connection.id}
                    onClose={() => setDocsOpen(false)}
                />
            )}
            {quickOpenOpen && engineRef.current?.currentVFS && (
                <QuickOpenPalette
                    vfs={engineRef.current.currentVFS}
                    onPick={path => handleOpenVfsFile(path)}
                    onClose={() => setQuickOpenOpen(false)}
                />
            )}
            {charLogin && (
                <CharLoginModal
                    connectionName={connection.name}
                    error={charLogin.error}
                    initialAccount={charLoginAccount}
                    initialPassword={charLoginPassword}
                    onSubmit={(account, password, remember) => {
                        // Optimistic close: most servers proceed on success. A
                        // failure re-opens the popup via the charLogin.result
                        // handler with the server's message.
                        setCharLogin(null);
                        // Persist (plaintext) or clear the saved credentials.
                        patchProfile(connection.id, {
                            charLoginAccount: remember ? account : undefined,
                            charLoginPassword: remember ? password : undefined,
                        });
                        session.sendCharLoginCredentials(account, password);
                    }}
                    onCancel={() => {
                        // Empty reply → server falls back to its text login.
                        setCharLogin(null);
                        session.sendCharLoginCredentials();
                    }}
                />
            )}
        </div>
        </ConnectionIdContext.Provider>
    );
}
