import { describe, it, expect } from 'vitest';
import { isClientGuiRedelivery } from '../../src/import/remotePackageInstall';
import type { PackageManifest } from '../../src/storage/schema';

const pkg = (patch: Partial<PackageManifest> = {}): PackageManifest => ({
  name: 'ServerGUI',
  installedAt: '2026-07-29T00:00:00.000Z',
  sourceUrl: 'https://example.com/gui.mpackage',
  ...patch,
});

// GMCP `Client.GUI` re-delivers the same URL on every connect. Skipping the
// reinstall matters beyond file-system churn: installPackage strips and
// replaces every script/alias/trigger the package owns, so a redundant pass
// discards whatever the user changed in them.
describe('isClientGuiRedelivery', () => {
  it('never skips when nothing is installed from that URL', () => {
    expect(isClientGuiRedelivery(undefined, '3')).toBe(false);
    expect(isClientGuiRedelivery(undefined, undefined)).toBe(false);
  });

  it('skips when the server repeats the delivery revision it sent last time', () => {
    expect(isClientGuiRedelivery(pkg({ sourceVersion: '3' }), '3')).toBe(true);
  });

  it('reinstalls when the server names a new delivery revision', () => {
    expect(isClientGuiRedelivery(pkg({ sourceVersion: '3' }), '4')).toBe(false);
  });

  it('skips when the server declares no version at all', () => {
    // No version means no signal that anything changed, so the URL match is
    // the whole answer. Comparing against the package's own `version` here is
    // what conflated the two fields in the first place.
    expect(isClientGuiRedelivery(pkg({ sourceVersion: '3' }), undefined)).toBe(true);
    expect(isClientGuiRedelivery(pkg({ version: '3.2.0' }), undefined)).toBe(true);
    // Including a package whose author shipped no version either.
    expect(isClientGuiRedelivery(pkg(), undefined)).toBe(true);
  });

  it('ignores the package’s own version when deciding', () => {
    // A 3.2.0 package delivered by a server calling it "1" must not be read as
    // a version mismatch — that is the loop this separation exists to break.
    expect(isClientGuiRedelivery(pkg({ version: '3.2.0', sourceVersion: '1' }), '1')).toBe(true);
  });

  it('reinstalls a manifest predating sourceVersion, once', () => {
    // Pre-migration install: the server's value sits in `version` and no
    // sourceVersion was recorded. One reinstall restores the author's version
    // and records sourceVersion, after which the first case above applies.
    const legacy = pkg({ version: '1' });
    expect(isClientGuiRedelivery(legacy, '1')).toBe(false);
    expect(isClientGuiRedelivery(pkg({ version: '1', sourceVersion: '1' }), '1')).toBe(true);
  });
});
