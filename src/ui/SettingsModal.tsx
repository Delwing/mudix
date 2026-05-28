import { Fragment, useState } from 'react';
import { useAppStore, selectProfileField, MAPPER_DEFAULTS, type Theme, type OutputFontSource, type ProfileSettings, type MapperSettings } from '../storage';
import { Input, FontPicker, Toggle, HelpTip, Button } from './components';
import { DEFAULT_ANSI_PALETTE } from '../mud/text/colors';
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
const DEFAULT_PROMPT_TIMEOUT_MS = 300;
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;
const MAX_BORDER_PX = 1000;
const EMPTY_BORDERS = { top: 0, right: 0, bottom: 0, left: 0 } as const;
type BorderSide = 'top' | 'right' | 'bottom' | 'left';

function isHexColor(s: string | undefined): s is string {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'dark',  label: 'Dark (Teal)' },
    { value: 'amber', label: 'Dark (Amber)' },
    { value: 'sky',   label: 'Dark (Sky Blue)' },
    { value: 'light', label: 'Light (Qt)' },
];

type SettingsTab = 'appearance' | 'colors' | 'network' | 'mapper';

const TABS: { value: SettingsTab; label: string }[] = [
    { value: 'appearance', label: 'Appearance' },
    { value: 'colors',     label: 'Colors' },
    { value: 'network',    label: 'Network' },
    { value: 'mapper',     label: 'Mapper' },
];

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
    const ansiPalette = useAppStore(s => selectProfileField(s, connectionId, 'ansiPalette'));
    const outputFont = useAppStore(s => selectProfileField(s, connectionId, 'outputFont'));
    const fontSize = useAppStore(s => selectProfileField(s, connectionId, 'fontSize'));
    const promptTimeoutMs = useAppStore(s => selectProfileField(s, connectionId, 'promptTimeoutMs'));
    const loggingEnabled = useAppStore(s => selectProfileField(s, connectionId, 'loggingEnabled'));
    const loggingOn = loggingEnabled !== false;
    const outputBorders = useAppStore(s => selectProfileField(s, connectionId, 'outputBorders'));
    const borders = outputBorders ?? EMPTY_BORDERS;
    const mapper = useAppStore(s => selectProfileField(s, connectionId, 'mapper'));
    const mapperRoomSize = mapper?.roomSize ?? MAPPER_DEFAULTS.roomSize;
    const mapperRoomShape = mapper?.roomShape ?? MAPPER_DEFAULTS.roomShape;
    const mapperBorders = mapper?.borders ?? MAPPER_DEFAULTS.borders;
    const mapperHighlightCurrentRoom = mapper?.highlightCurrentRoom ?? MAPPER_DEFAULTS.highlightCurrentRoom;
    const mapperLineWidth = mapper?.lineWidth ?? MAPPER_DEFAULTS.lineWidth;
    const mapperBackgroundColor = mapper?.backgroundColor ?? MAPPER_DEFAULTS.backgroundColor;
    const mapperLineColor = mapper?.lineColor ?? MAPPER_DEFAULTS.lineColor;
    const mapperGridEnabled = mapper?.gridEnabled ?? MAPPER_DEFAULTS.gridEnabled;
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

    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
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
                            </section>
                            )}
                        </>
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
                                <span className="settings-label" id="mapper-highlight-current-label">Highlight current room</span>
                                <Toggle
                                    id="mapper-highlight-current"
                                    aria-labelledby="mapper-highlight-current-label"
                                    checked={mapperHighlightCurrentRoom}
                                    onChange={next => patchMapper({ highlightCurrentRoom: next })}
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
}

function ColorCell({ label, value, fallback, onChange }: ColorCellProps) {
    const picked = isHexColor(value) ? value : fallback;
    return (
        <label className="settings-color-cell">
            <span className="settings-label">{label}</span>
            <input
                type="color"
                className="color-picker"
                value={picked}
                onChange={e => onChange(e.target.value)}
                aria-label={label}
            />
        </label>
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
