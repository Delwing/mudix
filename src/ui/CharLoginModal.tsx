import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './components/Button';
import { Input } from './components/Input';

interface CharLoginModalProps {
    /** Connection name, shown in the title for context. */
    connectionName?: string;
    /** Error from a previous failed attempt (Char.Login.Result success=false). */
    error?: string;
    /** Account/username to prefill (saved per-profile credential). */
    initialAccount?: string;
    /** Password to prefill (saved per-profile credential — plaintext). */
    initialPassword?: string;
    /** Initial state of the "remember on this device" checkbox. */
    initialRemember?: boolean;
    /** Send `account` + `password` to the server (Char.Login.Credentials).
     *  `remember` tells the caller whether to persist them for next time. */
    onSubmit: (account: string, password: string, remember: boolean) => void;
    /** Decline GMCP login — sends the empty reply so the server falls back to
     *  its text login prompt. */
    onCancel: () => void;
}

/**
 * Credentials popup for GMCP `Char.Login` authentication. Rendered as a real
 * `<form>` with `autocomplete="username"` / `autocomplete="current-password"`
 * inputs so browser password managers offer to fill and save. Optionally
 * remembers the account + password per profile (plaintext localStorage — see
 * the inline warning); the password is otherwise handed straight to `onSubmit`
 * and relayed to the server, never stored. Cancelling falls back to text login.
 */
export function CharLoginModal({
    connectionName,
    error,
    initialAccount,
    initialPassword,
    initialRemember,
    onSubmit,
    onCancel,
}: CharLoginModalProps) {
    const [account, setAccount] = useState(initialAccount ?? '');
    const [password, setPassword] = useState(initialPassword ?? '');
    const [remember, setRemember] = useState(initialRemember ?? !!initialPassword);
    const accountRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Focus the first empty field so a fully-prefilled form is one Enter away.
        (account ? passwordRef : accountRef).current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = account.trim();
        if (!trimmed) {
            accountRef.current?.focus();
            return;
        }
        onSubmit(trimmed, password, remember);
    };

    return (
        <>
            {/* No overlay-click dismissal: a login decision should be explicit
                (Cancel falls back to text login). Escape still cancels. */}
            <div className="modal-overlay" />
            <div className="modal char-login-modal" role="dialog" aria-modal="true" aria-label="Log in">
                <div className="modal-header">
                    <span className="modal-title">
                        Log in{connectionName ? ` — ${connectionName}` : ''}
                    </span>
                    <button className="modal-close" onClick={onCancel} type="button" aria-label="Cancel">
                        ✕
                    </button>
                </div>
                <div className="modal-body">
                    <form className="char-login-form" onSubmit={handleSubmit}>
                        <p className="char-login-hint">
                            This game supports secure login. Enter your credentials — your password
                            manager can fill them in.
                        </p>
                        {error && (
                            <div className="char-login-error" role="alert">
                                {error}
                            </div>
                        )}
                        <label className="char-login-field">
                            <span>Account</span>
                            <Input
                                ref={accountRef}
                                name="username"
                                type="text"
                                autoComplete="username"
                                spellCheck={false}
                                value={account}
                                onChange={e => setAccount(e.target.value)}
                                placeholder="account name"
                            />
                        </label>
                        <label className="char-login-field">
                            <span>Password</span>
                            <Input
                                ref={passwordRef}
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="password"
                            />
                        </label>
                        <label className="char-login-remember">
                            <input
                                type="checkbox"
                                checked={remember}
                                onChange={e => setRemember(e.target.checked)}
                            />
                            <span>Remember on this device</span>
                        </label>
                        {remember && (
                            <p className="cred-warning" role="note">
                                ⚠ Saves unencrypted in your browser's storage. Any script running on
                                this page — an installed package, or an XSS bug — could read it.
                            </p>
                        )}
                        <div className="char-login-actions">
                            <Button type="button" variant="ghost" onClick={onCancel}>
                                Use text login
                            </Button>
                            <Button type="submit" variant="primary">
                                Log in
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
