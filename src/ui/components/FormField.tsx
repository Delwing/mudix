import type { ReactNode } from 'react';

interface FormFieldProps {
    label: string;
    htmlFor?: string;
    className?: string;
    children: ReactNode;
}

export function FormField({ label, htmlFor, className, children }: FormFieldProps) {
    const cls = ['field', className].filter(Boolean).join(' ');
    return (
        <div className={cls}>
            <label className="field__label" htmlFor={htmlFor}>{label}</label>
            {children}
        </div>
    );
}

interface CheckFieldProps {
    label: string;
    htmlFor?: string;
    className?: string;
    children: ReactNode;
}

export function CheckField({ label, htmlFor, className, children }: CheckFieldProps) {
    const cls = ['field field--check', className].filter(Boolean).join(' ');
    return (
        <label className={cls} htmlFor={htmlFor}>
            {children}
            <span className="field__label">{label}</span>
        </label>
    );
}
