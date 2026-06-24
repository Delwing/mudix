import { Fragment, useState } from 'react';
import { useAppStore, selectProfileField, MAPPER_DEFAULTS, MAP_INFO_BG_DEFAULT, PROTOCOL_DEFAULTS, type Theme, type OutputFontSource, type ProfileSettings, type MapperSettings, type MapInfoBgColor, type ProtocolSettings } from '../storage';
import { Input, FontPicker, Toggle, HelpTip, Button } from './components';
import { DEFAULT_ANSI_PALETTE } from '../mud/text/colors';
import { DEFAULT_HISTORY_SAVE_SIZE, MAX_HISTORY } from './commandHistory';
import type { ShowSentTextMode } from '../mud/MudSession';

const SHOW_SENT_TEXT_OPTIONS: { value: ShowSentTextMode; label: string }[] = [
    { value: 'script', label: 'Let scripts decide' },
    { value: 'always', label: 'Always echo' },
    { value: 'never',  label: 'Never echo' },
];
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

const ANSI_LABELS = [
    'Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
    'Light Black', 'Light Red', 'Light Green', 'Light Yellow',
    'Light Blue', 'Light Magenta', 'Light Cyan', 'Light White',
] as const;

const DEFAULT_BG_FALLBACK = '#090909';
const DEFAULT_FG_FALLBACK = '#d4d4d4';
const DEFAULT_INPUT_BG_FALLBACK = '#141414';
const DEFAULT_INPUT_FG_FALLBACK = '#d4d4d4';
const DEFAULT_CMD_ECHO_FG_FALLBACK = '#717100';
const DEFAULT_PROMPT_TIMEOUT_MS = 300;
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;
const MAX_BORDER_PX = 1000;
const MAX_WRAP_AT = 500;
const MAX_WRAP_INDENT = 200;
const EMPTY_BORDERS = { top: 0, right: 0, bottom: 0, left: 0 } as const;
type BorderSide = 'top' | 'right' | 'bottom' | 'left';

function isHexColor(s: string | undefined): s is string {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** {r,g,b} → "#rrggbb" for the <input type="color"> swatch. */
function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
/** "#rrggbb" → {r,g,b}; returns null for anything not a 6-digit hex color. */
function hexToRgb(s: string): { r: number; g: number; b: number } | null {
    if (!isHexColor(s)) return null;
    return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'dark',  label: 'Dark (Teal)' },
    { value: 'amber', label: 'Dark (Amber)' },
    { value: 'sky',   label: 'Dark (Sky Blue)' },
    { value: 'light', label: 'Light (Qt)' },
    { value: 'graylight', label: 'Light (Gray)' },
];

type SettingsTab = 'general' | 'appearance' | 'input' | 'colors' | 'network' | 'mapper';

const TABS: { value: SettingsTab; label: string }[] = [
    { value: 'general',    label: 'General' },
    { value: 'appearance', label: 'Appearance' },
    { value: 'input',      label: 'Input' },
    { value: 'colors',     label: 'Colors' },
    { value: 'network',    label: 'Network' },
    { value: 'mapper',     label: 'Mapper' },
];

const DEFAULT_COMMAND_SEPARATOR = ';;';

interface SettingsModalProps {
    onClose: () => void;
    /** Active profile id; null on the connection screen (only theme is editable). */
    connectionId: string | null;
    vfs?: ProfileVFS | null;
}

export function SettingsModal({ onClose, connectionId, vfs = null }: SettingsModalProps) {
    const theme = useAppStore(s => s.client.theme);
    const allowMudPackageInstall = useAppStore(s => s.client.allowMudPackageInstall);
    const notificationsEnabled = useAppStore(s => s.client.notificationsEnabled);
    const patchClient = useAppStore(s => s.patchClient);
    // Default to true when the user hasn't explicitly disabled it.
    const mudPackageInstallEnabled = allowMudPackageInstall !== false;
    // Notifications are opt-in (default off) and require browser permission.
    const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;
    const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
        notificationsSupported ? Notification.permission : 'denied',
    );
    const notificationsOn = notificationsEnabled === true && notifPermission === 'granted';

    // Toggling on requests browser permission here — a real user gesture — so the
    // first script-driven showNotification fires without a surprise prompt. We
    // only flip the stored flag true when permission is actually granted.
    const handleNotificationsToggle = async (checked: boolean) => {
        if (!checked) {
            patchClient({ notificationsEnabled: false });
            return;
        }
        if (!notificationsSupported) return;
        let perm = Notification.permission;
        if (perm === 'default') {
            try { perm = await Notification.requestPermission(); }
            catch { /* some browsers reject without a gesture; leave as-is */ }
        }
        setNotifPermission(perm);
        patchClient({ notificationsEnabled: perm === 'granted' });
    };
    const outputBackground = useAppStore(s => selectProfileField(s, connectionId, 'outputBackground'));
    const outputForeground = useAppStore(s => selectProfileField(s, connectionId, 'outputForeground'));
    const inputBackground = useAppStore(s => selectProfileField(s, connectionId, 'inputBackground'));
    const inputForeground = useAppStore(s => selectProfileField(s, connectionId, 'inputForeground'));
    const commandEchoForeground = useAppStore(s => selectProfileField(s, connectionId, 'commandEchoForeground'));
    const commandEchoBackground = useAppStore(s => selectProfileField(s, connectionId, 'commandEchoBackground'));
    const ansiPalette = useAppStore(s => selectProfileField(s, connectionId, 'ansiPalette'));
    const outputFont = useAppStore(s => selectProfileField(s, connectionId, 'outputFont'));
    const fontSize = useAppStore(s => selectProfileField(s, connectionId, 'fontSize'));
    const outputWrapAt = useAppStore(s => selectProfileField(s, connectionId, 'outputWrapAt'));
    const outputWrapIndent = useAppStore(s => selectProfileField(s, connectionId, 'outputWrapIndent'));
    const outputWrapHangingIndent = useAppStore(s => selectProfileField(s, connectionId, 'outputWrapHangingIndent'));
    const promptTimeoutMs = useAppStore(s => selectProfileField(s, connectionId, 'promptTimeoutMs'));
    const loggingEnabled = useAppStore(s => selectProfileField(s, connectionId, 'loggingEnabled'));
    const loggingOn = loggingEnabled !== false;
    const outputBorders = useAppStore(s => selectProfileField(s, connectionId, 'outputBorders'));
    const borders = outputBorders ?? EMPTY_BORDERS;
    const autoClearInput = useAppStore(s => selectProfileField(s, connectionId, 'autoClearInput')) === true;
    const commandSeparator = useAppStore(s => selectProfileField(s, connectionId, 'commandSeparator')) ?? '';
    const protocols = useAppStore(s => selectProfileField(s, connectionId, 'protocols'));
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
    const mapper = useAppStore(s => selectProfileField(s, connectionId, 'mapper'));
    const mapperRoomSize = mapper?.roomSize ?? MAPPER_DEFAULTS.roomSize;
    const mapperRoomShape = mapper?.roomShape ?? MAPPER_DEFAULTS.roomShape;
    const mapperBorders = mapper?.borders ?? MAPPER_DEFAULTS.borders;
    const mapperLineWidth = mapper?.lineWidth ?? MAPPER_DEFAULTS.lineWidth;
    const mapperBackgroundColor = mapper?.backgroundColor ?? MAPPER_DEFAULTS.backgroundColor;
    const mapperLineColor = mapper?.lineColor ?? MAPPER_DEFAULTS.lineColor;
    const mapperGridEnabled = mapper?.gridEnabled ?? MAPPER_DEFAULTS.gridEnabled;
    const config = useAppStore(s => selectProfileField(s, connectionId, 'config'));
    const mapInfoColor = (config?.mapInfoColor as MapInfoBgColor | undefined) ?? MAP_INFO_BG_DEFAULT;
    const rawHistorySaveSize = config?.commandLineHistorySaveSize;
    const historySaveSize = typeof rawHistorySaveSize === 'number' && Number.isFinite(rawHistorySaveSize)
        ? rawHistorySaveSize
        : DEFAULT_HISTORY_SAVE_SIZE;
    const showTabConnectionIndicators = (config?.showTabConnectionIndicators as boolean | undefined) ?? true;
    const fixUnnecessaryLinebreaks = (config?.fixUnnecessaryLinebreaks as boolean | undefined) ?? false;
    const enableBlinkText = (config?.enableBlinkText as boolean | undefined) ?? false;
    // showSentText is stored as a mode string; legacy profiles may hold a boolean
    // (false ≙ never, true/unset ≙ script).
    const rawShowSentText = config?.showSentText;
    const showSentText: ShowSentTextMode =
        rawShowSentText === 'never' || rawShowSentText === 'always' ? rawShowSentText
        : rawShowSentText === false ? 'never'
        : 'script';
    const patchConnectionProfile = useAppStore(s => s.patchConnectionProfile);
    // Profile-scoped fields are only writable when a profile is active. On the
    // connection screen the modal hides those rows entirely.
    const patchProfile = (patch: Partial<ProfileSettings>) => {
        if (connectionId) patchConnectionProfile(connectionId, patch);
    };
    // Mapper is stored as a nested object so future renderer toggles share one
    // slot in ProfileSettings; patches merge into the current value so toggling
    // one field doesn't wipe siblings.
    const patchMapper = (patch: Partial<MapperSettings>) => {
        patchProfile({ mapper: { ...(mapper ?? {}), ...patch } });
    };
    // Merge into the Mudlet-compatible `config` bag (same slot ScriptingAPI's
    // setConfig writes), so the Settings UI and Lua setConfig stay in sync.
    const patchMapInfoColor = (patch: Partial<MapInfoBgColor>) => {
        patchProfile({ config: { ...(config ?? {}), mapInfoColor: { ...mapInfoColor, ...patch } } });
    };
    // Merge plain Mudlet `setConfig` keys into the same `config` bag the
    // scripting registry reads/writes, so Lua and the Settings UI stay in sync.
    const patchConfig = (patch: Record<string, unknown>) => {
        patchProfile({ config: { ...(config ?? {}), ...patch } });
    };
    // Same pattern as patchMapper — protocols share one slot so flipping one
    // toggle doesn't wipe the others.
    const patchProtocols = (patch: Partial<ProtocolSettings>) => {
        patchProfile({ protocols: { ...(protocols ?? {}), ...patch } });
    };

    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [fontPickerOpen, setFontPickerOpen] = useState(false);

    const handleFontChange = (next: OutputFontSource | undefined) => {
        patchProfile({ outputFont: next });
    };

    const [timeoutText, setTimeoutText] = useState(
        promptTimeoutMs !== undefined ? String(promptTimeoutMs) : '',
    );
    const [fontSizeText, setFontSizeText] = useState(String(fontSize));

    const handleTimeoutBlur = () => {
        const trimmed = timeoutText.trim();
        if (trimmed === '') {
            patchProfile({ promptTimeoutMs: undefined });
            return;
        }
        const parsed = parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            // Invalid input — revert display to stored value.
            setTimeoutText(promptTimeoutMs !== undefined ? String(promptTimeoutMs) : '');
            return;
        }
        const clamped = Math.min(parsed, 5000);
        setTimeoutText(String(clamped));
        patchProfile({ promptTimeoutMs: clamped });
    };

    const handleFontSizeBlur = () => {
        const parsed = parseInt(fontSizeText.trim(), 10);
        if (!Number.isFinite(parsed)) {
            setFontSizeText(String(fontSize));
            return;
        }
        const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, parsed));
        setFontSizeText(String(clamped));
        patchProfile({ fontSize: clamped });
    };

    // Word-wrap settings: wrap width (0 = off, blank = default 100) plus the
    // first-line and hanging continuation indents (both default 0). An empty
    // field clears the override; an invalid one reverts to the stored value.
    const [wrapAtText, setWrapAtText] = useState(outputWrapAt !== undefined ? String(outputWrapAt) : '');
    const [wrapIndentText, setWrapIndentText] = useState(outputWrapIndent !== undefined ? String(outputWrapIndent) : '');
    const [wrapHangingText, setWrapHangingText] = useState(outputWrapHangingIndent !== undefined ? String(outputWrapHangingIndent) : '');

    const makeWrapBlurHandler = (
        key: 'outputWrapAt' | 'outputWrapIndent' | 'outputWrapHangingIndent',
        max: number,
        text: string,
        setText: (s: string) => void,
        stored: number | undefined,
    ) => () => {
        const trimmed = text.trim();
        if (trimmed === '') {
            // Blank clears the override → falls back to the field's default.
            patchProfile({ [key]: undefined });
            setText('');
            return;
        }
        const parsed = parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            setText(stored !== undefined ? String(stored) : '');
            return;
        }
        const clamped = Math.min(parsed, max);
        setText(String(clamped));
        patchProfile({ [key]: clamped });
    };

    const handleWrapAtBlur = makeWrapBlurHandler('outputWrapAt', MAX_WRAP_AT, wrapAtText, setWrapAtText, outputWrapAt);
    const handleWrapIndentBlur = makeWrapBlurHandler('outputWrapIndent', MAX_WRAP_INDENT, wrapIndentText, setWrapIndentText, outputWrapIndent);
    const handleWrapHangingBlur = makeWrapBlurHandler('outputWrapHangingIndent', MAX_WRAP_INDENT, wrapHangingText, setWrapHangingText, outputWrapHangingIndent);

    const [historySaveSizeText, setHistorySaveSizeText] = useState(String(historySaveSize));

    const handleHistorySaveSizeBlur = () => {
        const parsed = parseInt(historySaveSizeText.trim(), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            setHistorySaveSizeText(String(historySaveSize));
            return;
        }
        const clamped = Math.min(parsed, MAX_HISTORY);
        setHistorySaveSizeText(String(clamped));
        patchConfig({ commandLineHistorySaveSize: clamped });
    };

    const [roomSizeText, setRoomSizeText] = useState(String(mapperRoomSize));
    const [lineWidthText, setLineWidthText] = useState(String(mapperLineWidth));

    const handleRoomSizeBlur = () => {
        const parsed = parseFloat(roomSizeText.trim());
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setRoomSizeText(String(mapperRoomSize));
            return;
        }
        const clamped = Math.min(parsed, 10);
        setRoomSizeText(String(clamped));
        patchMapper({ roomSize: clamped });
    };

    const handleLineWidthBlur = () => {
        const parsed = parseFloat(lineWidthText.trim());
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setLineWidthText(String(mapperLineWidth));
            return;
        }
        const clamped = Math.min(parsed, 1);
        setLineWidthText(String(clamped));
        patchMapper({ lineWidth: clamped });
    };

    const handleAnsiChange = (idx: number, value: string) => {
        const next: (string | undefined)[] = new Array(16);
        if (ansiPalette) for (let i = 0; i < 16; i++) next[i] = ansiPalette[i];
        next[idx] = value;
        patchProfile({ ansiPalette: next });
    };

    const handleAnsiResetCell = (idx: number) => {
        if (!ansiPalette) return;
        const next: (string | undefined)[] = new Array(16);
        for (let i = 0; i < 16; i++) next[i] = ansiPalette[i];
        next[idx] = undefined;
        // If nothing remains overridden, drop the whole array.
        const anySet = next.some(v => typeof v === 'string');
        patchProfile({ ansiPalette: anySet ? next : undefined });
    };

    const handleAnsiResetAll = () => patchProfile({ ansiPalette: undefined });

    const handleBorderChange = (side: BorderSide, raw: string) => {
        // Empty input clears that side back to 0 (Mudlet's no-border state).
        // Negative or non-numeric input is ignored so the field's display value
        // (controlled by `borders`) snaps back on next render.
        const parsed = raw === '' ? 0 : parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        const clamped = Math.min(parsed, MAX_BORDER_PX);
        const next = { ...borders, [side]: clamped };
        // When all four sides are 0, drop the override entirely so the field
        // falls back to PROFILE_DEFAULTS (no border).
        const allZero = next.top === 0 && next.right === 0 && next.bottom === 0 && next.left === 0;
        patchProfile({ outputBorders: allZero ? undefined : next });
    };

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
                <div className="modal-header">
                    <span className="modal-title">Settings</span>
                    <button className="modal-close" onClick={onClose} type="button" aria-label="Close">✕</button>
                </div>
                {connectionId && (
                    <div className="settings-tabs" role="tablist" aria-label="Settings categories">
                        {TABS.map(tab => (
                            <button
                                key={tab.value}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.value}
                                className={`settings-tab${activeTab === tab.value ? ' settings-tab--active' : ''}`}
                                onClick={() => setActiveTab(tab.value)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="modal-body">
                    {activeTab === 'general' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-gmcp-label">
                                    GMCP
                                    <HelpTip label="About GMCP">
                                        Telnet option 201. Generic MUD Communication Protocol —
                                        servers expose room, character and UI data as JSON
                                        envelopes (the <code>gmcp</code> table in Lua). Disable
                                        to negotiate as a vanilla telnet client.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-gmcp"
                                    aria-labelledby="protocol-gmcp-label"
                                    checked={gmcpEnabled}
                                    onChange={next => patchProtocols({ gmcp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-mtts-label">
                                    MTTS
                                    <HelpTip label="About MTTS / TERMINAL-TYPE">
                                        Telnet option 24. Identifies the client (name, terminal
                                        type, capability bitvector — colors, UTF-8, truecolor).
                                        Many MUDs gate MSDP/GMCP on this handshake completing.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-mtts"
                                    aria-labelledby="protocol-mtts-label"
                                    checked={mttsEnabled}
                                    onChange={next => patchProtocols({ mtts: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-msdp-label">
                                    MSDP
                                    <HelpTip label="About MSDP">
                                        Telnet option 69. Mud Server Data Protocol — a binary
                                        alternative to GMCP for the same kind of structured
                                        server data (the <code>msdp</code> table in Lua). Off
                                        by default; enable only if your MUD prefers MSDP.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-msdp"
                                    aria-labelledby="protocol-msdp-label"
                                    checked={msdpEnabled}
                                    onChange={next => patchProtocols({ msdp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-mssp-label">
                                    MSSP
                                    <HelpTip label="About MSSP">
                                        Telnet option 70. Mud Server Status Protocol — the server
                                        reports read-only status fields (player count, uptime,
                                        codebase, …) once per connection into the <code>mssp</code>
                                        table in Lua. On by default; harmless to leave enabled.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-mssp"
                                    aria-labelledby="protocol-mssp-label"
                                    checked={msspEnabled}
                                    onChange={next => patchProtocols({ mssp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-charset-label">
                                    CHARSET
                                    <HelpTip label="About CHARSET">
                                        Telnet option 42 (RFC 2066). Negotiates the character
                                        encoding for the session — typically switches to UTF-8
                                        so non-ASCII text (Polish, Cyrillic, box-drawing) renders
                                        correctly. Disable to stay on the UTF-8 baseline without
                                        negotiation.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-charset"
                                    aria-labelledby="protocol-charset-label"
                                    checked={charsetEnabled}
                                    onChange={next => patchProtocols({ charset: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-msp-label">
                                    MSP
                                    <HelpTip label="About MSP">
                                        Telnet option 90. MUD Sound Protocol — strips inline
                                        <code>!!SOUND(...)</code> and <code>!!MUSIC(...)</code> tags from
                                        MUD text and plays them through the sound manager. Off by
                                        default; enable for MUDs that send sound triggers.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-msp"
                                    aria-labelledby="protocol-msp-label"
                                    checked={mspEnabled}
                                    onChange={next => patchProtocols({ msp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-mccp-label">
                                    MCCP
                                    <HelpTip label="About MCCP">
                                        Telnet option 86 (MCCP2). MUD Client Compression Protocol —
                                        when a server offers it, the client accepts and transparently
                                        decompresses the stream, cutting bandwidth. On by default;
                                        disable to force compression off (Mudlet's
                                        <code>specialForceCompressionOff</code>) — the client ignores
                                        the server's offer and the stream stays uncompressed, which is
                                        handy when debugging the raw telnet bytes.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-mccp"
                                    aria-labelledby="protocol-mccp-label"
                                    checked={mccpEnabled}
                                    onChange={next => patchProtocols({ mccp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-mxp-label">
                                    MXP
                                    <HelpTip label="About MXP">
                                        Telnet option 91. MUD eXtension Protocol — parses in-band
                                        HTML-like markup from the server: text formatting, clickable
                                        <code>&lt;SEND&gt;</code>/<code>&lt;A&gt;</code> links, entities, and
                                        custom element definitions. On by default; disable for MUDs
                                        where literal angle-bracket text is being eaten.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-mxp"
                                    aria-labelledby="protocol-mxp-label"
                                    checked={mxpEnabled}
                                    onChange={next => patchProtocols({ mxp: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-mnes-label">
                                    MNES
                                    <HelpTip label="About MNES">
                                        Telnet option 39, Mud New-Environ Standard — the restricted
                                        subset of NEW-ENVIRON. When a server requests it, the client
                                        reports just its <code>CHARSET</code>, <code>CLIENT_NAME</code>,
                                        <code>CLIENT_VERSION</code>, <code>MTTS</code>, and
                                        <code>TERMINAL_TYPE</code>. Off by default; enable for MUDs
                                        that use it for client detection. Takes precedence over
                                        NEW-ENVIRON when both are on.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-mnes"
                                    aria-labelledby="protocol-mnes-label"
                                    checked={mnesEnabled}
                                    onChange={next => patchProtocols({ mnes: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-new-environ-label">
                                    NEW-ENVIRON
                                    <HelpTip label="About NEW-ENVIRON">
                                        Telnet option 39, Client Variables Standard (RFC 1572). Like
                                        MNES but reports an extended capability set in addition to the
                                        five core variables — <code>ANSI</code>, <code>256_COLORS</code>,
                                        <code>TRUECOLOR</code>, <code>UTF-8</code>, <code>TLS</code>,
                                        <code>WORD_WRAP</code>, <code>OSC_COLOR_PALETTE</code>,
                                        the <code>OSC_HYPERLINKS_*</code> set and more — so servers can
                                        tailor output to the client. On by default. When MNES is also
                                        on, MNES wins.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-new-environ"
                                    aria-labelledby="protocol-new-environ-label"
                                    checked={newEnvironEnabled}
                                    onChange={next => patchProtocols({ newEnviron: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-naws-label">
                                    NAWS
                                    <HelpTip label="About NAWS">
                                        Telnet option 31 (Negotiate About Window Size). Reports the
                                        main output area's size in characters (columns × rows) to the
                                        server and updates it whenever the window is resized. Servers
                                        use it for word-wrap, pagination, and full-screen layouts. On
                                        by default.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-naws"
                                    aria-labelledby="protocol-naws-label"
                                    checked={nawsEnabled}
                                    onChange={next => patchProtocols({ naws: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="protocol-ws-telnet-label">
                                    WebSocket subprotocol
                                    <HelpTip label="About the telnet.mudstandards.org subprotocol">
                                        Advertises <code>telnet.mudstandards.org</code> in the
                                        WebSocket opening handshake (the mudstandards.org WebSocket
                                        proposal). mudix already speaks that profile — a full telnet
                                        stream over binary frames — this just announces it so a
                                        conforming server can confirm the dialect. Off by default:
                                        some servers reject an unrecognized subprotocol, so enable it
                                        only for servers known to implement the proposal. Applies to
                                        direct WebSocket connections, not the telnet proxy.
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="protocol-ws-telnet"
                                    aria-labelledby="protocol-ws-telnet-label"
                                    checked={wsTelnetSubprotocol}
                                    onChange={next => patchProtocols({ wsTelnetSubprotocol: next })}
                                />
                            </div>
                            <p className="settings-hint">
                                Protocol changes take effect the next time you connect.
                            </p>
                        </section>
                    )}
                    {(activeTab === 'appearance' || !connectionId) && (
                        <>
                            <section className="settings-section">
                                <div className="settings-row">
                                    <label className="settings-label" htmlFor="theme-select">Theme</label>
                                    <select
                                        id="theme-select"
                                        className="settings-select"
                                        value={theme}
                                        onChange={e => patchClient({ theme: e.target.value as Theme })}
                                    >
                                        {THEME_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="allow-mud-package-install-label">
                                        Allow package installs from MUDs
                                        <HelpTip label="About MUD package installs">
                                            When a connected MUD sends a <code>Client.GUI</code> GMCP message, automatically
                                            download and install the package it points to. Disable to ignore those requests.
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="allow-mud-package-install"
                                        aria-labelledby="allow-mud-package-install-label"
                                        checked={mudPackageInstallEnabled}
                                        onChange={next => patchClient({ allowMudPackageInstall: next })}
                                    />
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="notifications-enabled-label">
                                        Desktop notifications
                                        <HelpTip label="About desktop notifications">
                                            Let scripts raise desktop notifications via <code>showNotification()</code>.
                                            {!notificationsSupported
                                                ? ' Your browser does not support notifications.'
                                                : notifPermission === 'denied'
                                                ? ' Notifications are blocked for this site — re-enable them in your browser’s site settings, then toggle this on.'
                                                : ' Enabling prompts your browser for permission so the first notification can show without interruption.'}
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="notifications-enabled"
                                        aria-labelledby="notifications-enabled-label"
                                        checked={notificationsOn}
                                        disabled={!notificationsSupported || notifPermission === 'denied'}
                                        onChange={next => { void handleNotificationsToggle(next); }}
                                    />
                                </div>
                            </section>
                            {connectionId && (
                            <section className="settings-section">
                                <div className="settings-row">
                                    <label className="settings-label" htmlFor="output-font-size">Font size</label>
                                    <div className="settings-color-field">
                                        <Input
                                            id="output-font-size"
                                            type="number"
                                            min={MIN_FONT_SIZE}
                                            max={MAX_FONT_SIZE}
                                            step={1}
                                            value={fontSizeText}
                                            placeholder={String(DEFAULT_FONT_SIZE)}
                                            onChange={e => setFontSizeText(e.target.value)}
                                            onBlur={handleFontSizeBlur}
                                        />
                                        <span className="settings-unit">pt</span>
                                    </div>
                                </div>
                                <div className="settings-row">
                                    <label className="settings-label">Font</label>
                                    <div className="settings-font-summary">
                                        {outputFont
                                            ? <span className="settings-font-summary__name" style={{ fontFamily: `"${outputFont.family}", monospace` }}>
                                                <strong>{outputFont.family}</strong>
                                                <em className="settings-font-summary__kind">({outputFont.kind})</em>
                                              </span>
                                            : <span className="settings-font-summary__muted">Default monospace</span>}
                                        <Button variant="secondary" size="sm" onClick={() => setFontPickerOpen(true)}>
                                            Change…
                                        </Button>
                                    </div>
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="logging-enabled-label">
                                        Record session logs
                                        <HelpTip label="About session logging">
                                            Save this profile's output and your typed commands to the persistent
                                            log store, browsable from the toolbar's <code>Logs</code> button.
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="logging-enabled"
                                        aria-labelledby="logging-enabled-label"
                                        checked={loggingOn}
                                        onChange={next => patchProfile({ loggingEnabled: next })}
                                    />
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="show-tab-connection-indicators-label">
                                        Connection indicator in title
                                        <HelpTip label="About the connection indicator">
                                            Show a connection-status dot in front of the profile name in
                                            the browser tab/window title (Mudlet's
                                            <code> showTabConnectionIndicators</code>). The profile name
                                            is shown either way.
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="show-tab-connection-indicators"
                                        aria-labelledby="show-tab-connection-indicators-label"
                                        checked={showTabConnectionIndicators}
                                        onChange={next => patchConfig({ showTabConnectionIndicators: next })}
                                    />
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="fix-unnecessary-linebreaks-label">
                                        Fix unnecessary linebreaks
                                        <HelpTip label="About fixing unnecessary linebreaks">
                                            On GA-driven servers, strip a stray leading blank line that
                                            some MUDs (IRE-style) prepend before each prompt block
                                            (Mudlet's <code>fixUnnecessaryLinebreaks</code>). Off by
                                            default; leave it off unless you see a spurious blank line
                                            before every prompt.
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="fix-unnecessary-linebreaks"
                                        aria-labelledby="fix-unnecessary-linebreaks-label"
                                        checked={fixUnnecessaryLinebreaks}
                                        onChange={next => patchConfig({ fixUnnecessaryLinebreaks: next })}
                                    />
                                </div>
                                <div className="settings-row">
                                    <span className="settings-label" id="enable-blink-text-label">
                                        Enable blinking text
                                        <HelpTip label="About blinking text">
                                            Animate ANSI blink (SGR 5/6) as a smooth opacity pulse
                                            (Mudlet's <code>enableBlinkText</code>). Off by default;
                                            when off, blinking text is shown in italics instead.
                                        </HelpTip>
                                    </span>
                                    <Toggle
                                        id="enable-blink-text"
                                        aria-labelledby="enable-blink-text-label"
                                        checked={enableBlinkText}
                                        onChange={next => patchConfig({ enableBlinkText: next })}
                                    />
                                </div>
                                <div className="settings-row settings-row--top">
                                    <label className="settings-label">Borders</label>
                                    <div className="settings-borders">
                                        {(['top', 'right', 'bottom', 'left'] as BorderSide[]).map(side => (
                                            <label key={side} className="settings-border-field">
                                                <span className="settings-border-side">{side}</span>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={MAX_BORDER_PX}
                                                    step={1}
                                                    value={String(borders[side])}
                                                    onChange={e => handleBorderChange(side, e.target.value)}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div className="settings-row settings-row--top">
                                    <label className="settings-label">
                                        Word wrap
                                        <HelpTip label="About line wrapping">
                                            <strong>at</strong> wraps main-window output at that many
                                            characters (Mudlet's <code>setWindowWrap("main", N)</code>).
                                            Default <code>0</code> disables wrapping so lines fill the
                                            window width.
                                            {' '}<strong>indent</strong> indents the start of each new
                                            line (<code>setWindowWrapIndent</code>) and
                                            {' '}<strong>hanging</strong> indents each wrapped
                                            continuation line (<code>setWindowWrapHangingIndent</code>),
                                            both default 0. All fields default to 0; leave blank or set
                                            0 to use the default.
                                        </HelpTip>
                                    </label>
                                    <div className="settings-borders">
                                        <label className="settings-border-field">
                                            <span className="settings-border-side">at</span>
                                            <Input
                                                id="output-wrap-at"
                                                type="number"
                                                min={0}
                                                max={MAX_WRAP_AT}
                                                step={1}
                                                value={wrapAtText}
                                                placeholder="0"
                                                onChange={e => setWrapAtText(e.target.value)}
                                                onBlur={handleWrapAtBlur}
                                            />
                                        </label>
                                        <label className="settings-border-field">
                                            <span className="settings-border-side">indent</span>
                                            <Input
                                                id="output-wrap-indent"
                                                type="number"
                                                min={0}
                                                max={MAX_WRAP_INDENT}
                                                step={1}
                                                value={wrapIndentText}
                                                placeholder="0"
                                                onChange={e => setWrapIndentText(e.target.value)}
                                                onBlur={handleWrapIndentBlur}
                                            />
                                        </label>
                                        <label className="settings-border-field">
                                            <span className="settings-border-side">hanging</span>
                                            <Input
                                                id="output-wrap-hanging"
                                                type="number"
                                                min={0}
                                                max={MAX_WRAP_INDENT}
                                                step={1}
                                                value={wrapHangingText}
                                                placeholder="0"
                                                onChange={e => setWrapHangingText(e.target.value)}
                                                onBlur={handleWrapHangingBlur}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </section>
                            )}
                        </>
                    )}
                    {activeTab === 'input' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-row">
                                <span className="settings-label" id="auto-clear-input-label">
                                    Clear input after send
                                    <HelpTip label="About clearing the command line">
                                        When on, the command bar empties after each Enter.
                                        When off, the text stays selected so the next keystroke
                                        overtypes it (and a bare Enter resends).
                                    </HelpTip>
                                </span>
                                <Toggle
                                    id="auto-clear-input"
                                    aria-labelledby="auto-clear-input-label"
                                    checked={autoClearInput}
                                    onChange={next => patchProfile({ autoClearInput: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="command-separator">
                                    Command separator
                                    <HelpTip label="About the command separator">
                                        Splits one Enter into multiple commands — typing
                                        <code> kill orc{DEFAULT_COMMAND_SEPARATOR}get all</code>
                                        sends both as separate commands. Each split is run
                                        through aliases independently. Leave blank to disable
                                        splitting.
                                    </HelpTip>
                                </label>
                                <Input
                                    id="command-separator"
                                    type="text"
                                    value={commandSeparator}
                                    placeholder={DEFAULT_COMMAND_SEPARATOR}
                                    spellCheck={false}
                                    onChange={e => patchProfile({ commandSeparator: e.target.value })}
                                />
                            </div>
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="command-history-save-size">
                                    Command history size
                                    <HelpTip label="About command history size">
                                        How many recently sent commands to keep for recall and
                                        Tab-completion (Mudlet's <code>commandLineHistorySaveSize</code>).
                                        History is shared across profiles. Max {MAX_HISTORY}.
                                    </HelpTip>
                                </label>
                                <Input
                                    id="command-history-save-size"
                                    type="number"
                                    min={0}
                                    max={MAX_HISTORY}
                                    step={10}
                                    value={historySaveSizeText}
                                    placeholder={String(DEFAULT_HISTORY_SAVE_SIZE)}
                                    onChange={e => setHistorySaveSizeText(e.target.value)}
                                    onBlur={handleHistorySaveSizeBlur}
                                />
                            </div>
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="show-sent-text">
                                    Echo sent commands
                                    <HelpTip label="About echoing sent commands">
                                        Whether commands you send are echoed into the output
                                        (Mudlet's <code>showSentText</code>). <strong>Let scripts
                                        decide</strong> echoes unless a script suppresses it with
                                        <code> send(cmd, false)</code> (e.g. passwords);
                                        <strong> Always</strong> echoes even then;
                                        <strong> Never</strong> never echoes.
                                    </HelpTip>
                                </label>
                                <select
                                    id="show-sent-text"
                                    className="settings-select"
                                    value={showSentText}
                                    onChange={e => patchConfig({ showSentText: e.target.value as ShowSentTextMode })}
                                >
                                    {SHOW_SENT_TEXT_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </section>
                    )}
                    {activeTab === 'colors' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-colors-grid">
                                <ColorCell
                                    label="Output background"
                                    value={outputBackground}
                                    fallback={DEFAULT_BG_FALLBACK}
                                    onChange={v => patchProfile({ outputBackground: v })}
                                />
                                <ColorCell
                                    label="Output foreground"
                                    value={outputForeground}
                                    fallback={DEFAULT_FG_FALLBACK}
                                    onChange={v => patchProfile({ outputForeground: v })}
                                />
                                <ColorCell
                                    label="Input background"
                                    value={inputBackground}
                                    fallback={DEFAULT_INPUT_BG_FALLBACK}
                                    onChange={v => patchProfile({ inputBackground: v })}
                                />
                                <ColorCell
                                    label="Input foreground"
                                    value={inputForeground}
                                    fallback={DEFAULT_INPUT_FG_FALLBACK}
                                    onChange={v => patchProfile({ inputForeground: v })}
                                />
                                <ColorCell
                                    label="Command echo foreground"
                                    value={commandEchoForeground}
                                    fallback={DEFAULT_CMD_ECHO_FG_FALLBACK}
                                    onChange={v => patchProfile({ commandEchoForeground: v })}
                                />
                                <ColorCell
                                    label="Command echo background"
                                    value={commandEchoBackground}
                                    fallback={DEFAULT_BG_FALLBACK}
                                    onChange={v => patchProfile({ commandEchoBackground: v })}
                                    onClear={() => patchProfile({ commandEchoBackground: '' })}
                                />
                            </div>
                            <div className="settings-ansi-header">
                                <span className="settings-label">
                                    ANSI palette
                                    <HelpTip label="About the ANSI palette">
                                        Redefines the 16 basic ANSI colors used by SGR codes
                                        30–37 / 90–97 (and their background counterparts).
                                        Changes apply to lines rendered after the edit; existing
                                        output keeps its current colors.
                                    </HelpTip>
                                </span>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleAnsiResetAll}
                                    disabled={!ansiPalette}
                                >
                                    Reset all
                                </Button>
                            </div>
                            <div className="settings-ansi-grid">
                                {Array.from({ length: 8 }, (_, row) => {
                                    const dark = row;
                                    const light = row + 8;
                                    return (
                                        <Fragment key={row}>
                                            <AnsiSwatch
                                                label={ANSI_LABELS[dark]}
                                                index={dark}
                                                value={ansiPalette?.[dark]}
                                                fallback={DEFAULT_ANSI_PALETTE[dark]}
                                                onChange={v => handleAnsiChange(dark, v)}
                                                onReset={() => handleAnsiResetCell(dark)}
                                            />
                                            <AnsiSwatch
                                                label={ANSI_LABELS[light]}
                                                index={light}
                                                value={ansiPalette?.[light]}
                                                fallback={DEFAULT_ANSI_PALETTE[light]}
                                                onChange={v => handleAnsiChange(light, v)}
                                                onReset={() => handleAnsiResetCell(light)}
                                            />
                                        </Fragment>
                                    );
                                })}
                            </div>
                        </section>
                    )}
                    {activeTab === 'network' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="prompt-timeout">
                                    Prompt timeout
                                    <HelpTip label="About prompt timeout">
                                        How long to wait for the rest of a line before treating a partial chunk as a prompt.
                                        Raise this if you see spurious mid-line breaks on a slow connection; lower it if
                                        prompts on MUDs without IAC GA feel sluggish. Default {DEFAULT_PROMPT_TIMEOUT_MS}ms,
                                        matching Mudlet's "Network packet timeout".
                                    </HelpTip>
                                </label>
                                <div className="settings-color-field">
                                    <Input
                                        id="prompt-timeout"
                                        type="number"
                                        min={0}
                                        max={5000}
                                        step={50}
                                        value={timeoutText}
                                        placeholder={String(DEFAULT_PROMPT_TIMEOUT_MS)}
                                        onChange={e => setTimeoutText(e.target.value)}
                                        onBlur={handleTimeoutBlur}
                                    />
                                    <span className="settings-unit">ms</span>
                                </div>
                            </div>
                        </section>
                    )}
                    {activeTab === 'mapper' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="mapper-room-size">Room size</label>
                                <Input
                                    id="mapper-room-size"
                                    type="number"
                                    min={0.1}
                                    max={10}
                                    step={0.05}
                                    value={roomSizeText}
                                    placeholder={String(MAPPER_DEFAULTS.roomSize)}
                                    onChange={e => setRoomSizeText(e.target.value)}
                                    onBlur={handleRoomSizeBlur}
                                />
                            </div>
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="mapper-room-shape">Room shape</label>
                                <select
                                    id="mapper-room-shape"
                                    className="settings-select"
                                    value={mapperRoomShape}
                                    onChange={e => patchMapper({ roomShape: e.target.value as MapperSettings['roomShape'] })}
                                >
                                    <option value="rectangle">Rectangle</option>
                                    <option value="roundedRectangle">Rounded rectangle</option>
                                    <option value="circle">Circle</option>
                                </select>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="mapper-borders-label">Room borders</span>
                                <Toggle
                                    id="mapper-borders"
                                    aria-labelledby="mapper-borders-label"
                                    checked={mapperBorders}
                                    onChange={next => patchMapper({ borders: next })}
                                />
                            </div>
                            <div className="settings-row">
                                <label className="settings-label" htmlFor="mapper-line-width">Exit line width</label>
                                <Input
                                    id="mapper-line-width"
                                    type="number"
                                    min={0.001}
                                    max={1}
                                    step={0.005}
                                    value={lineWidthText}
                                    placeholder={String(MAPPER_DEFAULTS.lineWidth)}
                                    onChange={e => setLineWidthText(e.target.value)}
                                    onBlur={handleLineWidthBlur}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="mapper-grid-enabled-label">Show grid</span>
                                <Toggle
                                    id="mapper-grid-enabled"
                                    aria-labelledby="mapper-grid-enabled-label"
                                    checked={mapperGridEnabled}
                                    onChange={next => patchMapper({ gridEnabled: next })}
                                />
                            </div>
                            <div className="settings-colors-grid">
                                <ColorCell
                                    label="Background"
                                    value={mapperBackgroundColor}
                                    fallback={MAPPER_DEFAULTS.backgroundColor}
                                    onChange={v => patchMapper({ backgroundColor: v })}
                                />
                                <ColorCell
                                    label="Exit lines"
                                    value={mapperLineColor}
                                    fallback={MAPPER_DEFAULTS.lineColor}
                                    onChange={v => patchMapper({ lineColor: v })}
                                />
                            </div>
                            <div className="settings-row">
                                <span className="settings-label" id="mapper-info-bg-label">
                                    Map info background
                                    <HelpTip label="About map info background">
                                        Background behind the info overlay shown on top of the
                                        map (Mudlet's <code>mapInfoColor</code>). The opacity
                                        slider sets its alpha channel.
                                    </HelpTip>
                                </span>
                                <div className="settings-mapinfo-bg" aria-labelledby="mapper-info-bg-label">
                                    <label className="settings-ansi-swatch__bar" title="Map info background color" aria-label="Map info background color">
                                        <input
                                            type="color"
                                            value={rgbToHex(mapInfoColor)}
                                            onChange={e => { const rgb = hexToRgb(e.target.value); if (rgb) patchMapInfoColor(rgb); }}
                                            aria-label="Map info background color"
                                        />
                                        <span
                                            className="settings-ansi-swatch__fill"
                                            style={{ background: `rgba(${mapInfoColor.r}, ${mapInfoColor.g}, ${mapInfoColor.b}, ${mapInfoColor.a / 255})` }}
                                        />
                                    </label>
                                    <input
                                        type="range"
                                        className="settings-mapinfo-bg__alpha"
                                        min={0}
                                        max={255}
                                        step={1}
                                        value={mapInfoColor.a}
                                        onChange={e => patchMapInfoColor({ a: Number(e.target.value) })}
                                        aria-label="Map info background opacity"
                                        title="Opacity"
                                    />
                                    <span className="settings-mapinfo-bg__alpha-readout">{Math.round((mapInfoColor.a / 255) * 100)}%</span>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </div>
            {fontPickerOpen && connectionId && (
                <>
                    <div className="modal-overlay font-picker-overlay" onClick={() => setFontPickerOpen(false)} />
                    <div className="modal font-picker-modal" role="dialog" aria-modal="true" aria-label="Choose font">
                        <div className="modal-header">
                            <span className="modal-title">Choose Font</span>
                            <button className="modal-close" onClick={() => setFontPickerOpen(false)} type="button" aria-label="Close">✕</button>
                        </div>
                        <div className="modal-body">
                            <FontPicker value={outputFont} onChange={handleFontChange} vfs={vfs} />
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

interface ColorCellProps {
    label: string;
    value: string | undefined;
    fallback: string;
    onChange: (next: string) => void;
    /** When provided, shows a clear button (only while a value is set) to unset the color. */
    onClear?: () => void;
}

function ColorCell({ label, value, fallback, onChange, onClear }: ColorCellProps) {
    const picked = isHexColor(value) ? value : fallback;
    const isSet = isHexColor(value);
    return (
        <Fragment>
            <span className="settings-ansi-swatch__label">{label}</span>
            <label className="settings-ansi-swatch__bar" title={label} aria-label={label}>
                <input
                    type="color"
                    value={picked}
                    onChange={e => onChange(e.target.value)}
                    aria-label={label}
                />
                <span className="settings-ansi-swatch__fill" style={{ background: picked }} />
                {onClear && isSet && (
                    <button
                        type="button"
                        className="settings-ansi-swatch__reset"
                        onClick={(e) => { e.preventDefault(); onClear(); }}
                        aria-label={`Clear ${label}`}
                        title="Clear (use none)"
                    >
                        ↺
                    </button>
                )}
            </label>
        </Fragment>
    );
}

interface AnsiSwatchProps {
    label: string;
    index: number;
    value: string | undefined;
    fallback: string;
    onChange: (next: string) => void;
    onReset: () => void;
}

function AnsiSwatch({ label, index, value, fallback, onChange, onReset }: AnsiSwatchProps) {
    const picked = isHexColor(value) ? value : fallback;
    const overridden = isHexColor(value) && value.toLowerCase() !== fallback.toLowerCase();
    return (
        <Fragment>
            <span className={`settings-ansi-swatch__label${overridden ? ' settings-ansi-swatch__label--overridden' : ''}`}>
                {label}:
            </span>
            <label className="settings-ansi-swatch__bar" title={label} aria-label={label}>
                <input
                    type="color"
                    value={picked}
                    onChange={e => onChange(e.target.value)}
                    aria-label={`${label} (ANSI ${index})`}
                />
                <span className="settings-ansi-swatch__fill" style={{ background: picked }} />
                {overridden && (
                    <button
                        type="button"
                        className="settings-ansi-swatch__reset"
                        onClick={(e) => { e.preventDefault(); onReset(); }}
                        aria-label={`Reset ${label} to default`}
                        title="Reset to default"
                    >
                        ↺
                    </button>
                )}
            </label>
        </Fragment>
    );
}
