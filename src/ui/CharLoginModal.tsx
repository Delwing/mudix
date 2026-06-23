import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './components/Button';
import { Input } from './components/Input';

interface CharLoginModalProps {
    /** Connection name, shown in the title for context. */
    connectionName?: string;
    /** Error from a previous failed attempt (Char.Login.Result success=false). */
    error?: string;
    /** Send `account` + `password` to the server (Char.Login.Credentials). */
    onSubmit: (account: string, password: string) => void;
    /** Decline GMCP login — sends the empty reply so the server falls back to
     *  its text login prompt. */
    onCancel: () => void;
}

/**
 * Credentials popup for GMCP `Char.Login` authentication. Rendered as a real
 * `<form>` with `autocomplete="username"` / `autocomplete="current-password"`
 * inputs so browser password managers offer to fill and save. mudix never
 * stores the password — it's handed straight to `onSubmit` and relayed to the
 * server. Cancelling falls back to the server's text login.
 */
export function CharLoginModal({ connectionName, error, onSubmit, onCancel }: CharLoginModalProps) {
    const [account, setAccount] = useState('');
    const [password, setPassword] = useState('');
    const accountRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        accountRef.current?.focus();
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
        onSubmit(trimmed, password);
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
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="password"
                            />
                        </label>
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
