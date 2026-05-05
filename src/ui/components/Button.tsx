import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
    const cls = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
    return <button className={cls} {...props} />;
}
