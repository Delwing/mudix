import { describe, it, expect } from 'vitest';
import { encodeNaws } from '../../../src/mud/protocol/naws';
import { GMCP_IAC, GMCP_SB, GMCP_SE, OPT_NAWS } from '../../../src/mud/protocol/constants';

// Helper: the expected `IAC SB NAWS <w-hi> <w-lo> <h-hi> <h-lo> IAC SE` frame,
// taking the four already-escaped dimension byte-strings.
const frame = (...payload: string[]) =>
  GMCP_IAC + GMCP_SB + OPT_NAWS + payload.join('') + GMCP_IAC + GMCP_SE;

const byte = (n: number) => String.fromCharCode(n);

describe('encodeNaws', () => {
  it('frames an 80×24 grid as big-endian 16-bit width then height', () => {
    expect(encodeNaws(80, 24)).toBe(frame(byte(0), byte(80), byte(0), byte(24)));
  });

  it('splits values > 255 across the high and low bytes', () => {
    // 320 = 0x0140 → hi 0x01, lo 0x40; 200 = 0x00C8
    expect(encodeNaws(320, 200)).toBe(frame(byte(0x01), byte(0x40), byte(0x00), byte(0xC8)));
  });

  it('doubles an IAC (255) byte so it is not read as a telnet command', () => {
    // 255 columns → low byte is 0xFF, which must be escaped to 0xFF 0xFF.
    expect(encodeNaws(255, 1)).toBe(frame(byte(0x00), byte(0xFF) + byte(0xFF), byte(0x00), byte(0x01)));
    // A full IAC in the high byte too (0xFF00 = 65280) escapes the high byte.
    expect(encodeNaws(65280, 0)).toBe(frame(byte(0xFF) + byte(0xFF), byte(0x00), byte(0x00), byte(0x00)));
  });

  it('clamps out-of-range and non-finite dimensions into [0, 65535]', () => {
    expect(encodeNaws(-5, 24)).toBe(frame(byte(0), byte(0), byte(0), byte(24)));
    expect(encodeNaws(70000, 24)).toBe(frame(byte(0xFF) + byte(0xFF), byte(0xFF) + byte(0xFF), byte(0), byte(24)));
    expect(encodeNaws(Number.NaN, 24)).toBe(frame(byte(0), byte(0), byte(0), byte(24)));
  });

  it('truncates fractional dimensions toward zero', () => {
    expect(encodeNaws(80.9, 24.9)).toBe(frame(byte(0), byte(80), byte(0), byte(24)));
  });
});
