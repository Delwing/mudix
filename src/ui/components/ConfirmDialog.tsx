import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { useModalFocus } from './useModalFocus';

export interface ConfirmButton<T = unknown> {
    label: string;
    value: T;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    autoFocus?: boolean;
}

export interface ConfirmOptions<T = unknown> {
    title?: string;
    message?: ReactNode;
    /** Buttons rendered in order, left to right. Last button is treated as the default if none specifies `autoFocus`. */
    buttons?: ConfirmButton<T>[];
    /** Returned when the user dismisses via ESC or backdrop click. */
    dismissValue?: T;
    /** Disable backdrop-click and ESC dismissal. */
    blocking?: boolean;
    /** Visual hint that the action is destructive — adds an icon and styling. */
    tone?: 'default' | 'danger';
}

interface DialogProps<T> extends ConfirmOptions<T> {
    onResolve: (value: T | undefined) => void;
}

export function ConfirmDialog<T>({
    title,
    message,
    buttons,
    dismissValue,
    blocking,
    tone = 'default',
    onResolve,
}: DialogProps<T>) {
    // Trap + restore via the shared hook; this dialog keeps its own Escape
    // (gated on `blocking`) and its own initial focus (the default button).
    const dialogRef = useModalFocus<HTMLDivElement>(undefined, { autoFocus: false, closeOnEscape: false });
    const resolvedRef = useRef(false);

    const resolve = useCallback((value: T | undefined) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        onResolve(value);
    }, [onResolve]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !blocking) {
                e.preventDefault();
                resolve(dismissValue);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [blocking, dismissValue, resolve]);

    useEffect(() => {
        const root = dialogRef.current;
        if (!root) return;
        const target = root.querySelector<HTMLButtonElement>('.btn[data-autofocus="true"]')
                    ?? root.querySelector<HTMLButtonElement>('.btn:last-of-type');
        target?.focus();
    }, []);

    const list = buttons && buttons.length > 0 ? buttons : ([{ label: 'OK', value: undefined as T, variant: 'primary' as const, autoFocus: true }]);
    const hasExplicitFocus = list.some(b => b.autoFocus);

    return (
        <>
            <div
                className="modal-overlay confirm-dialog-overlay"
                onClick={() => { if (!blocking) resolve(dismissValue); }}
            />
            <div
                className={`modal confirm-dialog${tone === 'danger' ? ' confirm-dialog--danger' : ''}`}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={title ? 'confirm-dialog-title' : undefined}
                ref={dialogRef}
            >
                <div className="confirm-dialog-content">
                    {tone === 'danger' && (
                        <div className="confirm-dialog-icon" aria-hidden="true">!</div>
                    )}
                    <div className="confirm-dialog-text">
                        {title && (
                            <div className="confirm-dialog-title" id="confirm-dialog-title">{title}</div>
                        )}
                        {message !== undefined && (
                            <div className="confirm-dialog-message">{message}</div>
                        )}
                    </div>
                </div>
                <div className="confirm-dialog-actions">
                    {list.map((btn, i) => {
                        const variant = btn.variant ?? (i === list.length - 1 ? 'primary' : 'secondary');
                        const isFocus = btn.autoFocus || (!hasExplicitFocus && i === list.length - 1);
                        return (
                            <Button
                                key={i}
                                variant={variant}
                                data-autofocus={isFocus ? 'true' : undefined}
                                onClick={() => resolve(btn.value)}
                            >
                                {btn.label}
                            </Button>
                        );
                    })}
                </div>
            </div>
        </>
    );
}

// ── Imperative API ─────────────────────────────────────────────────

type ConfirmFn = <T = boolean>(options: ConfirmOptions<T>) => Promise<T | undefined>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface QueueItem {
    options: ConfirmOptions<unknown>;
    resolve: (value: unknown) => void;
}

interface QueueItemKeyed extends QueueItem {
    id: number;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [current, setCurrent] = useState<QueueItemKeyed | null>(null);
    const nextId = useRef(0);

    const confirm = useCallback<ConfirmFn>(((options: ConfirmOptions<unknown>) => {
        return new Promise<unknown>((resolve) => {
            setCurrent({ id: nextId.current++, options, resolve });
        });
    }) as ConfirmFn, []);

    const handleResolve = (value: unknown) => {
        setCurrent(prev => {
            prev?.resolve(value);
            return null;
        });
    };

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {current && (
                <ConfirmDialog
                    key={current.id}
                    {...current.options}
                    onResolve={handleResolve}
                />
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
    return ctx;
}
