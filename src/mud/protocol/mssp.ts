import { MSSP_COMMAND_CODE, MSSP_VAR, MSSP_VAL } from "./constants";

// MSSP control bytes, as numeric codes for the byte-at-a-time parser below.
// They alias MSDP's VAR/VAL bytes (1/2); MSSP simply reuses the framing.
const VAR = MSSP_VAR.charCodeAt(0); // 1
const VAL = MSSP_VAL.charCodeAt(0); // 2

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

/** Decode a Latin-1 byte-string (one char per byte, as produced upstream) into
 *  a proper UTF-8 string. MSSP names are ASCII but values may carry UTF-8. */
function fromByteString(s: string): string {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    return utf8Decoder.decode(bytes);
}

export interface MsspEnvelope {
    /** MSSP variable name (e.g. "PLAYERS", "UPTIME", "HOSTNAME"). */
    name: string;
    /** The reported value. Always a string — Mudlet treats MSSP values as
     *  scalars (the multi-value list form, rare in practice, is collapsed to
     *  the first value). */
    value: string;
}

/**
 * Parse an MSSP subnegotiation body (the `IAC SB MSSP … IAC SE` payload with
 * the leading option byte already stripped). The grammar is a flat run of
 * `MSSP_VAR <name> MSSP_VAL <value>` pairs; names/values are scalar byte runs
 * terminated by the next control byte. Tolerant of truncation and stray bytes.
 *
 * Mirrors Mudlet's TLuaInterpreter::parseMSSP: scalar string values, and a
 * variable with extra `MSSP_VAL` runs keeps only its first value.
 */
export function parseMssp(body: string): MsspEnvelope[] {
    const out: MsspEnvelope[] = [];
    const n = body.length;
    let i = 0;
    while (i < n) {
        if (body.charCodeAt(i) !== VAR) {
            i++; // skip stray bytes before the first/next VAR
            continue;
        }
        i++; // consume VAR
        // Name runs up to the next control byte (VAR or VAL).
        const nameStart = i;
        while (i < n && body.charCodeAt(i) !== VAR && body.charCodeAt(i) !== VAL) i++;
        const name = fromByteString(body.substring(nameStart, i));
        let value = "";
        if (i < n && body.charCodeAt(i) === VAL) {
            i++; // consume VAL
            const valStart = i;
            while (i < n && body.charCodeAt(i) !== VAR && body.charCodeAt(i) !== VAL) i++;
            value = fromByteString(body.substring(valStart, i));
            // Any further VAL runs for this variable (list-valued MSSP) are left
            // for the outer loop to skip — we keep the first value, like Mudlet.
        }
        if (name) out.push({ name, value });
    }
    return out;
}

export interface MsspStreamOptions {
    onEnvelope: (payload: MsspEnvelope) => void;
}

/** Mirror of createMsdpStream for MSSP subnegotiations. The handler receives a
 *  subnegotiation body whose first byte is the MSSP option code (70); each
 *  variable is emitted as its own envelope. */
export const createMsspStream = ({ onEnvelope }: MsspStreamOptions) => {
    return (data: string) => {
        if (data.length === 0 || data.charCodeAt(0) !== MSSP_COMMAND_CODE) return;
        for (const env of parseMssp(data.substring(1))) onEnvelope(env);
    };
};
