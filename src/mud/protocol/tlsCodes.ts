/**
 * Human-readable names for the certificate faults a proxy can report.
 *
 * The wire codes are OpenSSL/Node verify codes (the Node proxy) plus a couple
 * of synthetic ones for runtimes that can't tell us more (the Cloudflare
 * Worker). Anything unrecognised falls back to the raw code so a newer proxy
 * can report faults this build has never heard of without losing information.
 */
const CERT_CODE_LABELS: Record<string, string> = {
    CERT_HAS_EXPIRED: 'the certificate has expired',
    CERT_NOT_YET_VALID: 'the certificate is not valid yet',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'the certificate is self-signed',
    SELF_SIGNED_CERT_IN_CHAIN: 'the certificate chain ends in a self-signed certificate',
    ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate was issued for a different host',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the issuing authority is not trusted',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate signature could not be verified',
    TLS_HANDSHAKE_FAILED: 'the secure handshake failed',
};

export function describeCertCode(code: string): string {
    return CERT_CODE_LABELS[code] ?? code;
}

/** Which of Mudlet's three tolerance checkboxes would clear a given fault.
 *  `all` means only "accept all certificate errors" covers it. */
export function toleranceForCode(code: string): 'expired' | 'selfSigned' | 'all' {
    if (code === 'CERT_HAS_EXPIRED') return 'expired';
    if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') return 'selfSigned';
    return 'all';
}
