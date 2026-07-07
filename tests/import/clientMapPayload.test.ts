import { describe, it, expect } from 'vitest';
import { parseClientMapPayload } from '../../src/import/remotePackageInstall';

// GMCP `Client.Map` announces the game's downloadable map (the MMP protocol).
// Mudlet's Host::setMmpMapLocation only accepts a JSON object carrying a valid
// `url` — every other shape is silently ignored, and the parser mirrors that.
describe('parseClientMapPayload', () => {
  it('accepts the MMP object shape and returns the url', () => {
    expect(parseClientMapPayload({ url: 'https://example.com/maps/map.dat' }))
      .toBe('https://example.com/maps/map.dat');
  });

  it('ignores extra keys (version etc.) like Mudlet does', () => {
    expect(parseClientMapPayload({ url: 'https://example.com/map.dat', version: '3' }))
      .toBe('https://example.com/map.dat');
  });

  it('rejects a bare string — Mudlet requires the JSON object shape', () => {
    expect(parseClientMapPayload('https://example.com/map.dat')).toBeNull();
  });

  it('rejects objects without a url', () => {
    expect(parseClientMapPayload({})).toBeNull();
    expect(parseClientMapPayload({ url: '' })).toBeNull();
    expect(parseClientMapPayload({ url: 42 })).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(parseClientMapPayload({ url: 'not a url' })).toBeNull();
  });

  it('rejects null/undefined/primitives', () => {
    expect(parseClientMapPayload(null)).toBeNull();
    expect(parseClientMapPayload(undefined)).toBeNull();
    expect(parseClientMapPayload(7)).toBeNull();
  });
});
