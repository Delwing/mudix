import { useState } from 'react';
import { useAppStore, selectProfileField, type Theme, type OutputFontSource, type ProfileSettings } from '../storage';
import { Input, FontPicker } from './components';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

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

type SettingsTab = 'appearance' | 'colors' | 'network';

const TABS: { value: SettingsTab; label: string }[] = [
    { value: 'appearance', label: 'Appearance' },
    { value: 'colors',     label: 'Colors' },
    { value: 'network',    label: 'Network' },
];

interface SettingsModalProps {
    onClose: () => void;
    /** Active profile id; null on the connection screen (only theme is editable). */
    connectionId: string | null;
    vfs?: ProfileVFS | null;
}

export function SettingsModal({ onClose, connectionId, vfs = null }: SettingsModalProps) {
    const theme = useAppStore(s => s.client.theme);
    const patchClient = useAppStore(s => s.patchClient);
    const outputBackground = useAppStore(s => selectProfileField(s, connectionId, 'outputBackground'));
    const outputForeground = useAppStore(s => selectProfileField(s, connectionId, 'outputForeground'));
    const inputBackground = useAppStore(s => selectProfileField(s, connectionId, 'inputBackground'));
    const inputForeground = useAppStore(s => selectProfileField(s, connectionId, 'inputForeground'));
    const outputFont = useAppStore(s => selectProfileField(s, connectionId, 'outputFont'));
    const fontSize = useAppStore(s => selectProfileField(s, connectionId, 'fontSize'));
    const promptTimeoutMs = useAppStore(s => selectProfileField(s, connectionId, 'promptTimeoutMs'));
    const outputBorders = useAppStore(s => selectProfileField(s, connectionId, 'outputBorders'));
    const borders = outputBorders ?? EMPTY_BORDERS;
    const patchConnectionProfile = useAppStore(s => s.patchConnectionProfile);
    // Profile-scoped fields are only writable when a profile is active. On the
    // connection screen the modal hides those rows entirely.
    const patchProfile = (patch: Partial<ProfileSettings>) => {
        if (connectionId) patchConnectionProfile(connectionId, patch);
    };

    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

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
                                <div className="settings-row settings-row--top">
                                    <label className="settings-label">Font</label>
                                    <FontPicker value={outputFont} onChange={handleFontChange} vfs={vfs} />
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
                        </section>
                    )}
                    {activeTab === 'network' && connectionId && (
                        <section className="settings-section">
                            <div className="settings-row settings-row--top">
                                <label className="settings-label" htmlFor="prompt-timeout">Prompt timeout</label>
                                <div className="settings-field-with-help">
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
                                    <p className="settings-help">
                                        How long to wait for the rest of a line before treating a partial chunk as a prompt.
                                        Raise this if you see spurious mid-line breaks on a slow connection; lower it if
                                        prompts on MUDs without IAC GA feel sluggish. Default {DEFAULT_PROMPT_TIMEOUT_MS}ms,
                                        matching Mudlet's "Network packet timeout".
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </div>
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
