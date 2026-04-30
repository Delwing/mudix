import { forwardRef, type InputHTMLAttributes } from 'react';

const NO_AUTOFILL = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    'data-1p-ignore': true,       // 1Password
    'data-lpignore': 'true',      // LastPass
    'data-bwignore': true,        // Bitwarden
    'data-form-type': 'other',    // generic hint
} as const;

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    noAutofill?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, noAutofill, ...props }, ref) => {
        const cls = ['input', className].filter(Boolean).join(' ');
        return <input ref={ref} className={cls} {...(noAutofill ? NO_AUTOFILL : {})} {...props} />;
    }
);
