import {
    GMCP_IAC,
    GMCP_SB,
    GMCP_SE,
    NEW_ENVIRON_COMMAND_CODE,
    OPT_NEW_ENVIRON,
    NEW_ENVIRON_IS,
    NEW_ENVIRON_VAR,
    NEW_ENVIRON_VALUE,
    NEW_ENVIRON_ESC,
} from "./constants";

// NEW-ENVIRON control bytes as numeric codes for the byte-at-a-time parser.
// The command byte (right after the option code) and the structural markers
// share values — see constants.ts — but never collide because they're
// distinguished by position: command first, markers everywhere after.
const SEND = 1;     // command: server requests variables
const VAR = 0;      // marker: standard variable name follows
const VALUE = 1;    // marker: variable value follows
const ESC = 2;      // marker: next byte is literal (unescape it)
const USERVAR = 3;  // marker: user-defined variable name follows

/** A single MNES variable the client reports back, e.g. `{ name: "CHARSET",
 *  value: "UTF-8" }`. */
export interface MnesVar {
    name: string;
    value: string;
}

/** Result of parsing an `IAC SB NEW-ENVIRON SEND … IAC SE` request body. */
export interface MnesRequest {
    /** True when the body is a well-formed SEND command (the only request kind
     *  a client answers). */
    isSend: boolean;
    /** Variable names the server explicitly asked for, in request order. Empty
     *  means a bare SEND — the server wants every variable we report. */
    requested: string[];
}

/** Escape a name/value per RFC 1572: any control byte that would otherwise be
 *  read as a marker (VAR/VALUE/ESC/USERVAR = 0..3) or as IAC (255) is prefixed
 *  with ESC. MNES values are ASCII in practice, so this rarely fires — but a
 *  charset name or version string is server-influenced enough to be worth
 *  doing correctly. */
function escapeEnv(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c <= 3 || c === 0xff) out += NEW_ENVIRON_ESC;
        out += s[i];
    }
    return out;
}

/**
 * Parse an `IAC SB NEW-ENVIRON SEND …` request. `subneg` is the subnegotiation
 * body with the leading option code (39) still attached (matching how the
 * telnet option parser hands bodies to the other protocol streams). The byte
 * after the option code is the command; for a server→client request it's SEND.
 * After SEND comes an optional list of `VAR <name>` / `USERVAR <name>` entries,
 * each name running until the next marker (ESC-escaped bytes pass through).
 * A bare SEND with no entries — or only empty names — means "send everything".
 */
export function parseMnesRequest(subneg: string): MnesRequest {
    if (subneg.length < 2 || subneg.charCodeAt(0) !== NEW_ENVIRON_COMMAND_CODE) {
        return { isSend: false, requested: [] };
    }
    if (subneg.charCodeAt(1) !== SEND) return { isSend: false, requested: [] };

    const requested: string[] = [];
    const n = subneg.length;
    let i = 2;
    while (i < n) {
        const marker = subneg.charCodeAt(i);
        if (marker !== VAR && marker !== USERVAR) {
            i++; // skip stray bytes between entries
            continue;
        }
        i++; // consume the VAR/USERVAR marker
        let name = "";
        while (i < n) {
            const c = subneg.charCodeAt(i);
            if (c === ESC) {
                i++;
                if (i < n) { name += subneg[i]; i++; }
                continue;
            }
            if (c === VAR || c === USERVAR || c === VALUE) break;
            name += subneg[i];
            i++;
        }
        if (name.length > 0) requested.push(name);
    }
    return { isSend: true, requested };
}

/**
 * Frame an `IAC SB NEW-ENVIRON IS VAR <name> VALUE <value> … IAC SE` reply for
 * the given variables. The returned string is a Latin-1 byte-string ready for
 * sendBytes (names/values are ASCII; control bytes are escaped per RFC 1572).
 */
export function encodeMnesIs(vars: ReadonlyArray<MnesVar>): string {
    let body = OPT_NEW_ENVIRON + NEW_ENVIRON_IS;
    for (const { name, value } of vars) {
        body += NEW_ENVIRON_VAR + escapeEnv(name) + NEW_ENVIRON_VALUE + escapeEnv(value);
    }
    return GMCP_IAC + GMCP_SB + body + GMCP_IAC + GMCP_SE;
}

/**
 * Pick which of the client's `available` MNES variables to report in response
 * to a parsed request. A bare SEND (no specific names) returns everything;
 * otherwise the requested names are returned in request order, filtered to the
 * ones we actually know. If the server asked only for names we don't report,
 * we fall back to sending everything rather than an empty reply — the server
 * still learns who we are.
 */
export function selectMnesVars(
    request: MnesRequest,
    available: ReadonlyArray<MnesVar>,
): MnesVar[] {
    if (request.requested.length === 0) return [...available];
    const byName = new Map(available.map((v) => [v.name, v.value] as const));
    const picked: MnesVar[] = [];
    for (const name of request.requested) {
        const value = byName.get(name);
        if (value !== undefined) picked.push({ name, value });
    }
    return picked.length > 0 ? picked : [...available];
}
