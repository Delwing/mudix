interface ToggleProps {
    id?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
    'aria-labelledby'?: string;
}

export function Toggle({ id, checked, onChange, disabled, ...aria }: ToggleProps) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            className={`toggle${checked ? ' toggle--on' : ''}`}
            onClick={() => onChange(!checked)}
            {...aria}
        >
            <span className="toggle__track" />
            <span className="toggle__knob" />
        </button>
    );
}
