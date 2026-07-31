import { Button } from './components/Button';
import type { TlsStatus } from '../mud/events';
import { describeCertCode, toleranceForCode } from '../mud/protocol/tlsCodes';

interface Props {
    status: TlsStatus;
    /** The plaintext port to fall back to, when one was remembered. */
    revertPort?: number;
    onRevert: () => void;
    onDismiss: () => void;
}

const TOLERANCE_HINT: Record<ReturnType<typeof toleranceForCode>, string> = {
    expired: 'Accept expired certificates',
    selfSigned: 'Accept self-signed certificates',
    all: 'Accept all certificate errors',
};

/**
 * Explains a TLS connection that didn't work, and offers the way back.
 *
 * Mudlet reacts to a certificate failure by opening Preferences on the
 * connection tab with the offending checkbox highlighted; the browser
 * equivalent is to say which setting would allow it and let the user undo the
 * port change in one click.
 */
export function TlsAlertBanner({ status, revertPort, onRevert, onDismiss }: Props) {
    if (status.kind === 'established') return null;

    const isTimeout = status.kind === 'timeout';
    const codes = isTimeout ? [] : (status.info.codes.length ? status.info.codes : [status.info.code]);
    // Suggest the narrowest setting that would clear every reported fault.
    const hints = [...new Set(codes.map(c => TOLERANCE_HINT[toleranceForCode(c)]))];

    return (
        <div className="tls-alert-banner" role="alert">
            <div className="tls-alert-body">
                <strong className="tls-alert-title">Secure connection failed</strong>
                {isTimeout ? (
                    <span>
                        Nothing answered on the secure port {status.port}. Your proxy may be too old to
                        support TLS, or the game refused the connection.
                    </span>
                ) : (
                    <span>
                        The game's certificate was refused because {codes.map(describeCertCode).join('; ')}.
                        {hints.length > 0 && (
                            <> You can allow it with “{hints.join('” and “')}” in Settings → Network.</>
                        )}
                    </span>
                )}
            </div>
            <div className="tls-alert-actions">
                {revertPort !== undefined && (
                    <Button type="button" variant="primary" onClick={onRevert}>
                        Revert to port {revertPort}
                    </Button>
                )}
                <Button type="button" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
                    Dismiss
                </Button>
            </div>
        </div>
    );
}
