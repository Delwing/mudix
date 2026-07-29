import { describe, it, expect } from 'vitest';
import { parseClientGuiPayload } from '../../src/import/remotePackageInstall';

const URL_ = 'https://example.com/gui.mpackage';

// GMCP `Client.GUI` asks the client to install a package from a URL. Mudlet
// accepts both the `{url, version}` object and the legacy two-line string.
describe('parseClientGuiPayload', () => {
  it('reads the object shape', () => {
    expect(parseClientGuiPayload({ url: URL_, version: '3' })).toEqual({ url: URL_, version: '3' });
    expect(parseClientGuiPayload({ url: URL_ })).toEqual({ url: URL_ });
  });

  it('reads the legacy raw-telnet shape as "<version>\\n<url>"', () => {
    // Version first — Mudlet's cTelnet fallback takes the version off line 0
    // and the url off line 1. Reading these the other way round would send the
    // version off to be downloaded as a URL.
    expect(parseClientGuiPayload(`3\n${URL_}`)).toEqual({ url: URL_, version: '3' });
    expect(parseClientGuiPayload(` 3 \r\n ${URL_} `)).toEqual({ url: URL_, version: '3' });
  });

  it('drops a half legacy pair rather than guessing which half it has', () => {
    expect(parseClientGuiPayload(`3\n`)).toBeNull();
    expect(parseClientGuiPayload(`\n${URL_}`)).toBeNull();
  });

  it('accepts a lone line as a bare url', () => {
    expect(parseClientGuiPayload(URL_)).toEqual({ url: URL_ });
  });

  it('accepts an unquoted numeric version', () => {
    // Servers using the field as a delivery counter often send it as a JSON
    // number. Dropping it left the install with no revision to compare, so
    // every connect looked like a fresh delivery.
    expect(parseClientGuiPayload({ url: URL_, version: 1 })).toEqual({ url: URL_, version: '1' });
    expect(parseClientGuiPayload({ url: URL_, version: 3.2 })).toEqual({ url: URL_, version: '3.2' });
    // Zero is a legitimate counter value, not an absent one.
    expect(parseClientGuiPayload({ url: URL_, version: 0 })).toEqual({ url: URL_, version: '0' });
  });

  it('drops a version it cannot render as a stable string', () => {
    expect(parseClientGuiPayload({ url: URL_, version: '' })).toEqual({ url: URL_ });
    expect(parseClientGuiPayload({ url: URL_, version: true })).toEqual({ url: URL_ });
    expect(parseClientGuiPayload({ url: URL_, version: null })).toEqual({ url: URL_ });
    expect(parseClientGuiPayload({ url: URL_, version: { major: 3 } })).toEqual({ url: URL_ });
    expect(parseClientGuiPayload({ url: URL_, version: NaN })).toEqual({ url: URL_ });
  });

  it('rejects payloads without a usable url', () => {
    expect(parseClientGuiPayload({})).toBeNull();
    expect(parseClientGuiPayload({ url: '' })).toBeNull();
    expect(parseClientGuiPayload({ url: 42 })).toBeNull();
    expect(parseClientGuiPayload('')).toBeNull();
    expect(parseClientGuiPayload('\n3')).toBeNull();
    expect(parseClientGuiPayload(null)).toBeNull();
    expect(parseClientGuiPayload(undefined)).toBeNull();
    expect(parseClientGuiPayload(7)).toBeNull();
  });
});
