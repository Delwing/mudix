import type { TlsCertInfo } from '../mud/events';
import { describeCertCode } from '../mud/protocol/tlsCodes';

interface Props {
    cert: TlsCertInfo | null;
    /** False when the proxy runtime cannot read peer certificates at all. */
    certInspection: boolean;
    protocol?: string;
    cipher?: string;
    /** Faults the profile's ignore-flags waved through, if any. */
    acceptedDespite?: string[];
}

/**
 * The certificate of the current secure connection.
 *
 * Shows the same four fields Mudlet surfaces in Preferences → Connection
 * (issuer, issued-to, expiry, serial), plus the negotiated protocol. When the
 * proxy can't inspect certificates it says so rather than rendering an empty
 * box — "unknown" and "none" would look identical otherwise.
 */
export function TlsCertificateBox({ cert, certInspection, protocol, cipher, acceptedDespite = [] }: Props) {
    if (!certInspection) {
        return (
            <div className="tls-cert-box">
                <span className="tls-cert-box-title">Certificate</span>
                <p className="tls-cert-box-note">
                    The connection is encrypted{protocol ? ` (${protocol})` : ''}, but this proxy cannot report
                    certificate details. Self-hosting the Node proxy enables them.
                </p>
            </div>
        );
    }
    if (!cert) return null;

    return (
        <div className="tls-cert-box">
            <span className="tls-cert-box-title">Certificate</span>
            <dl className="tls-cert-grid">
                <dt>Issuer</dt>
                <dd>{cert.issuer || '—'}{cert.issuerOrg ? ` (${cert.issuerOrg})` : ''}</dd>
                <dt>Issued to</dt>
                <dd>{cert.subject || '—'}{cert.subjectOrg ? ` (${cert.subjectOrg})` : ''}</dd>
                <dt>Expires</dt>
                <dd>{cert.validTo || '—'}</dd>
                <dt>Serial</dt>
                <dd className="tls-cert-mono">{cert.serial || '—'}</dd>
                {(protocol || cipher) && (
                    <>
                        <dt>Protocol</dt>
                        <dd>{[protocol, cipher].filter(Boolean).join(', ')}</dd>
                    </>
                )}
            </dl>
            {acceptedDespite.length > 0 && (
                <p className="tls-cert-box-warning" role="note">
                    Accepted even though {acceptedDespite.map(describeCertCode).join(', and ')}. The traffic
                    is encrypted, but the server's identity is not verified.
                </p>
            )}
        </div>
    );
}
