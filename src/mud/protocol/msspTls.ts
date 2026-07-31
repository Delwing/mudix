/**
 * MSSP-advertised TLS port tracking.
 *
 * Mirrors Mudlet's `cTelnet::promptTlsConnectionAvailable` (ctelnet.cpp) —
 * a server may advertise a secure port through the MSSP `TLS` / `SSL` variable,
 * and the client offers, once, to switch to it.
 *
 * Kept free of React and session plumbing so the decision rules can be tested
 * directly; the caller supplies the current connection state.
 */

/** Per-connection MSSP facts that bear on the TLS offer. */
export interface MsspTlsFacts {
    /** The advertised secure port, or 0 when none/unusable. */
    tlsPort: number;
    /** MSSP `HOSTNAME`, used to catch an advertisement meant for a different host. */
    hostName: string;
}

export function emptyMsspTlsFacts(): MsspTlsFacts {
    return { tlsPort: 0, hostName: '' };
}

/**
 * Fold one MSSP variable into the accumulated facts.
 *
 * `TLS`/`SSL` normally carries a port number, but the values `-1` and `1` are
 * used by some servers as plain "unsupported"/"supported" booleans. Mudlet
 * discards both rather than dialling port 1, and so do we.
 */
export function applyMsspVariable(facts: MsspTlsFacts, name: string, value: string): MsspTlsFacts {
    const key = name.toUpperCase();
    if (key === 'HOSTNAME') {
        return { ...facts, hostName: value.trim() };
    }
    if (key === 'TLS' || key === 'SSL') {
        const raw = value.trim();
        if (raw === '-1' || raw === '1') return { ...facts, tlsPort: 0 };
        const port = Number.parseInt(raw, 10);
        const usable = Number.isFinite(port) && port > 0 && port <= 65535;
        return { ...facts, tlsPort: usable ? port : 0 };
    }
    return facts;
}

/** True for a literal IPv4/IPv6 address. A certificate is very unlikely to be
 *  issued for a bare IP, so Mudlet suppresses the offer in that case rather
 *  than steering the user into a guaranteed validation failure. */
export function isIpAddress(host: string): boolean {
    const h = host.trim();
    if (!h) return false;
    // IPv4: four decimal octets, each 0-255.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        return h.split('.').every(o => Number(o) <= 255);
    }
    // IPv6: hex groups and colons only (covers compressed `::` forms), optionally
    // bracketed. Deliberately loose — this is a suppression hint, not a parser.
    const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
    return bare.includes(':') && /^[0-9a-fA-F:]+$/.test(bare);
}

export interface TlsOfferState {
    /** MSSP facts gathered on this connection. */
    facts: MsspTlsFacts;
    /** The host this profile actually dialled. */
    host: string;
    /** The port currently in use. */
    port: number;
    /** Whether this profile is already connecting over TLS. */
    tlsEnabled: boolean;
    /** The profile's "remind me about secure connections" preference. */
    askTlsAvailable: boolean;
    /** True while an offer is already on screen, so repeats can't stack. */
    promptInFlight: boolean;
    /** Only proxy-mode connections can be upgraded: an MSSP TLS port is a raw
     *  telnet-over-TLS port, which a browser cannot dial directly. */
    proxyMode: boolean;
}

/**
 * Decide whether to offer the secure-port switch. Mirrors Mudlet's guard set:
 * a usable advertised port, not already encrypted, the reminder still enabled,
 * the host not a bare IP, MSSP `HOSTNAME` (when given) matching the host we
 * dialled, and no offer already pending.
 */
export function shouldOfferTlsUpgrade(s: TlsOfferState): boolean {
    if (!s.proxyMode) return false;
    if (!s.facts.tlsPort) return false;
    if (s.tlsEnabled) return false;
    if (!s.askTlsAvailable) return false;
    if (s.promptInFlight) return false;
    // Already on the advertised port — nothing to switch to.
    if (s.facts.tlsPort === s.port) return false;
    if (isIpAddress(s.host)) return false;
    if (s.facts.hostName && s.facts.hostName.toLowerCase() !== s.host.trim().toLowerCase()) return false;
    return true;
}
