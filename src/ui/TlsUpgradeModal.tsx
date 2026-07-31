import { Button } from './components/Button';
import { useModalFocus } from './components/useModalFocus';

interface Props {
    /** The secure port the server advertised via MSSP. */
    port: number;
    onAccept: () => void;
    onDecline: () => void;
}

/**
 * Offers the MSSP-advertised secure port. Wording follows Mudlet's prompt
 * (cTelnet::promptTlsConnectionAvailable) so the choice reads the same to
 * anyone arriving from the desktop client.
 *
 * Declining is permanent for the profile, so it is stated on the button's
 * description rather than hidden behind a "don't ask again" checkbox.
 */
export function TlsUpgradeModal({ port, onAccept, onDecline }: Props) {
    const ref = useModalFocus<HTMLDivElement>(onDecline);
    return (
        <>
            <div className="modal-overlay" onClick={onDecline} />
            <div
                ref={ref}
                className="modal tls-upgrade-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Secure connection available"
            >
                <div className="modal-header">
                    <span className="modal-title">Secure connection available</span>
                    <button className="modal-close" onClick={onDecline} aria-label="Close">×</button>
                </div>
                <div className="modal-body">
                    <p className="tls-upgrade-lead">
                        For data transfer protection and privacy, this connection advertises a secure port.
                    </p>
                    <p className="tls-upgrade-lead">
                        Update to port <strong>{port}</strong> and connect with encryption?
                    </p>
                    <p className="tls-upgrade-note">
                        This reconnects you now, and the profile will use the secure port from now on.
                        If you decline, you won't be asked again for this profile.
                    </p>
                    <div className="tls-upgrade-actions">
                        <Button type="button" variant="ghost" onClick={onDecline}>
                            Not now
                        </Button>
                        <Button type="button" variant="primary" onClick={onAccept} autoFocus>
                            Use port {port}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
