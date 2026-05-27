import { GMCP_IAC, GMCP_SB, GMCP_SE, OPT_MSDP, MSDP_VAR, MSDP_VAL } from "./constants";

/** UTF-8-encode `s` into a Latin-1 byte-string (one char per byte) so it can be
 *  handed to MudClient.sendBytes, which writes `charCodeAt(i) & 0xff` per char.
 *  Plain ASCII (the common case for MSDP variable/value names) is unchanged. */
function toByteString(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
}

/**
 * Frame a Mudlet-style `sendMSDP(variable, ...values)` call as an MSDP
 * subnegotiation: `IAC SB MSDP MSDP_VAR <variable> [MSDP_VAL <value>]... IAC SE`.
 * The returned string is a Latin-1 byte-string ready for sendBytes.
 */
export function encodeMsdp(variable: string, values: string[]): string {
    let out = GMCP_IAC + GMCP_SB + OPT_MSDP + MSDP_VAR + toByteString(variable);
    for (const v of values) {
        out += MSDP_VAL + toByteString(v);
    }
    out += GMCP_IAC + GMCP_SE;
    return out;
}
