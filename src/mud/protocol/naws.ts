import { GMCP_IAC, GMCP_SB, GMCP_SE, OPT_NAWS } from "./constants";

/** Clamp a window dimension to NAWS's 16-bit wire range. Non-finite or negative
 *  values collapse to 0 (the telnet "I don't know / use your default" value). */
function clamp16(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const v = Math.trunc(n);
    if (v < 0) return 0;
    if (v > 0xffff) return 0xffff;
    return v;
}

/** Encode a 16-bit value as two big-endian bytes, doubling any IAC (255) byte
 *  so the receiver doesn't read it as a telnet command inside the subnegotiation
 *  (RFC 1073 / the telnet IAC-escaping rule for SB payloads). */
function encode16(n: number): string {
    const esc = (b: number) => (b === 0xff ? "\xff\xff" : String.fromCharCode(b));
    return esc((n >> 8) & 0xff) + esc(n & 0xff);
}

/**
 * Frame an `IAC SB NAWS <width> <height> IAC SE` subnegotiation (telnet option
 * 31, RFC 1073) reporting the client window size as character columns × rows.
 * Both dimensions are 16-bit big-endian, clamped to [0, 65535], with IAC bytes
 * escaped. The returned string is a Latin-1 byte-string ready for sendRaw.
 */
export function encodeNaws(cols: number, rows: number): string {
    const body = OPT_NAWS + encode16(clamp16(cols)) + encode16(clamp16(rows));
    return GMCP_IAC + GMCP_SB + body + GMCP_IAC + GMCP_SE;
}
