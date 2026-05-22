import { useState } from 'react';
import type React from 'react';
import { useAppStore, type Theme, type OutputFontSource } from '../storage';
import { Button, Input, FontPicker } from './components';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

const DEFAULT_BG = '#090909';
const DEFAULT_PROMPT_TIMEOUT_MS = 300;
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;

function isHexColor(s: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(s);
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'dark',  label: 'Dark (Teal)' },
    { value: 'amber', label: 'Dark (Amber)' },
    { value: 'sky',   label: 'Dark (Sky Blue)' },
    { value: 'light', label: 'Light (Qt)' },
];

type SettingsTab = 'appearance' | 'network';

const TABS: { value: SettingsTab; label: string }[] = [
    { value: 'appearance', label: 'Appearance' },
    { value: 'network',    label: 'Network' },
];

interface SettingsModalProps {
    onClose: () => void;
    vfs?: ProfileVFS | null;
}

export function SettingsModal({ onClose, vfs = null }: SettingsModalProps) {
    const outputBackground = useAppStore(s => s.ui.outputBackground);
    const theme = useAppStore(s => s.ui.theme);
    const outputFont = useAppStore(s => s.ui.outputFont);
    const fontSize = useAppStore(s => s.ui.fontSize);
    const promptTimeoutMs = useAppStore(s => s.ui.promptTimeoutMs);
    const patchUI = useAppStore(s => s.patchUI);

    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

    const handleFontChange = (next: OutputFontSource | undefined) => {
        patchUI({ outputFont: next });
    };

    const [text, setText] = useState(outputBackground);
    const [pickerColor, setPickerColor] = useState(
        isHexColor(outputBackground) ? outputBackground : DEFAULT_BG,
    );
    const [timeoutText, setTimeoutText] = useState(
        promptTimeoutMs !== undefined ? String(promptTimeoutMs) : '',
    );
    const [fontSizeText, setFontSizeText] = useState(String(fontSize));

    const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setText(value);
        setPickerColor(value);
        patchUI({ outputBackground: value });
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
    };

    const handleTextBlur = () => {
        patchUI({ outputBackground: text });
        if (isHexColor(text)) setPickerColor(text);
    };

    const handleReset = () => {
        setText('');
        setPickerColor(DEFAULT_BG);
        patchUI({ outputBackground: '' });
    };

    const handleTimeoutBlur = () => {
        const trimmed = timeoutText.trim();
        if (trimmed === '') {
            patchUI({ promptTimeoutMs: undefined });
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
        patchUI({ promptTimeoutMs: clamped });
    };

    const handleTimeoutReset = () => {
        setTimeoutText('');
        patchUI({ promptTimeoutMs: undefined });
    };

    const handleFontSizeBlur = () => {
        const parsed = parseInt(fontSizeText.trim(), 10);
        if (!Number.isFinite(parsed)) {
            setFontSizeText(String(fontSize));
            return;
        }
        const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, parsed));
        setFontSizeText(String(clamped));
        patchUI({ fontSize: clamped });
    };

    const handleFontSizeReset = () => {
        setFontSizeText(String(DEFAULT_FONT_SIZE));
        patchUI({ fontSize: DEFAULT_FONT_SIZE });
    };

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
                <div className="modal-header">
                    <span className="modal-title">Settings</span>
                    <button className="modal-close" onClick={onClose} type="button" aria-label="Close">✕</button>
                </div>
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
                <div className="modal-body">
                    {activeTab === 'appearance' && (
                        <>
                            <section className="settings-section">
                                <h3 className="settings-section-title">Appearance</h3>
                                <div className="settings-row">
                                    <label className="settings-label" htmlFor="theme-select">Theme</label>
                                    <select
                                        id="theme-select"
                                        className="settings-select"
                                        value={theme}
                                        onChange={e => patchUI({ theme: e.target.value as Theme })}
                                    >
                                        {THEME_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </section>
                            <section className="settings-section">
                                <h3 className="settings-section-title">Output</h3>
                                <div className="settings-row">
                                    <label className="settings-label" htmlFor="output-bg">Background</label>
                                    <div className="settings-color-field">
                                        <input
                                            type="color"
                                            className="color-picker"
                                            value={pickerColor}
                                            onChange={handlePickerChange}
                                            aria-label="Pick background color"
                                        />
                                        <Input
                                            id="output-bg"
                                            value={text}
                                            placeholder={DEFAULT_BG}
                                            onChange={handleTextChange}
                                            onBlur={handleTextBlur}
                                            spellCheck={false}
                                        />
                                        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
                                    </div>
                                </div>
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
                                        <Button variant="ghost" size="sm" onClick={handleFontSizeReset}>Reset</Button>
                                    </div>
                                </div>
                                <div className="settings-row settings-row--top">
                                    <label className="settings-label">Font</label>
                                    <FontPicker value={outputFont} onChange={handleFontChange} vfs={vfs} />
                                </div>
                            </section>
                        </>
                    )}
                    {activeTab === 'network' && (
                        <section className="settings-section">
                            <h3 className="settings-section-title">Network</h3>
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
                                        <Button variant="ghost" size="sm" onClick={handleTimeoutReset}>Reset</Button>
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
