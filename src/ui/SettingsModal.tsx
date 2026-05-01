import { useState } from 'react';
import type React from 'react';
import { useAppStore } from '../storage';
import { Button, Input } from './components';

const DEFAULT_BG = '#090909';

function isHexColor(s: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(s);
}

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const outputBackground = useAppStore(s => s.ui.outputBackground);
    const patchUI = useAppStore(s => s.patchUI);

    const [text, setText] = useState(outputBackground);
    const [pickerColor, setPickerColor] = useState(
        isHexColor(outputBackground) ? outputBackground : DEFAULT_BG,
    );

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

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
                <div className="modal-header">
                    <span className="modal-title">Settings</span>
                    <button className="modal-close" onClick={onClose} type="button" aria-label="Close">✕</button>
                </div>
                <div className="modal-body">
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
                    </section>
                </div>
            </div>
        </>
    );
}
