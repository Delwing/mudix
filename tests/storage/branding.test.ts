import { describe, it, expect, afterEach } from 'vitest';
import { setBrand, getBrand, isBrandedMode, isPackageRemovable, brandConnectionData, matchBrandProfile, DEFAULT_BRAND } from '../../src/branding';
import { connectionUrl, DEFAULT_PROXY_URL, type MudConnection } from '../../src/storage/schema';

const conn = (c: Partial<MudConnection>): MudConnection => ({ id: 'x', name: 'x', ...c });

// The brand is a module-level singleton — always restore the stock brand so
// test order can't leak a branded config into other suites.
afterEach(() => setBrand());

describe('setBrand / getBrand', () => {
    it('defaults to the stock mudix brand', () => {
        expect(getBrand()).toEqual(DEFAULT_BRAND);
        expect(getBrand().appName).toBe('mudix');
        expect(isBrandedMode()).toBe(false);
    });

    it('merges a partial brand over the defaults', () => {
        setBrand({ appName: 'Arkadia', proxyUrl: 'wss://proxy.arkadia.example' });
        expect(getBrand().appName).toBe('Arkadia');
        expect(getBrand().proxyUrl).toBe('wss://proxy.arkadia.example');
        // Unspecified fields fall through to the stock brand.
        expect(getBrand().tagline).toBe(DEFAULT_BRAND.tagline);
    });

    it('enters branded mode exactly when a MUD target is pinned', () => {
        setBrand({ appName: 'Arkadia' });
        expect(isBrandedMode()).toBe(false);
        setBrand({ appName: 'Arkadia', mud: { mode: 'mud', host: 'arkadia.rpg.pl', port: 4000 } });
        expect(isBrandedMode()).toBe(true);
    });

    it('resets to defaults when called with no brand', () => {
        setBrand({ appName: 'Arkadia' });
        setBrand();
        expect(getBrand().appName).toBe('mudix');
    });
});

describe('connectionUrl brand proxy precedence', () => {
    const mud = conn({ mode: 'mud', host: 'mud.example.com', port: 4000 });

    it('uses the brand proxy over the built-in default', () => {
        setBrand({ proxyUrl: 'wss://proxy.brand.example' });
        expect(connectionUrl(mud)).toBe('wss://proxy.brand.example?host=mud.example.com&port=4000');
    });

    it('lets the user-deployed proxy override the brand proxy', () => {
        setBrand({ proxyUrl: 'wss://proxy.brand.example' });
        expect(connectionUrl(mud, 'wss://user.workers.dev')).toBe('wss://user.workers.dev?host=mud.example.com&port=4000');
    });

    it('lets a connection-level proxy override everything', () => {
        setBrand({ proxyUrl: 'wss://proxy.brand.example' });
        expect(connectionUrl(conn({ ...mud, proxyUrl: 'wss://per-conn.example' }), 'wss://user.workers.dev'))
            .toBe('wss://per-conn.example?host=mud.example.com&port=4000');
    });

    it('falls back to the built-in default without a brand proxy', () => {
        expect(connectionUrl(mud)).toBe(`${DEFAULT_PROXY_URL}?host=mud.example.com&port=4000`);
    });
});

describe('brandConnectionData', () => {
    it('returns null when the brand pins no MUD', () => {
        expect(brandConnectionData(getBrand())).toBeNull();
    });

    it('builds a proxy-mode seed from the brand target', () => {
        setBrand({
            appName: 'Arkadia',
            mud: { mode: 'mud', host: 'arkadia.rpg.pl', port: 4000, autoConnect: true },
        });
        expect(brandConnectionData(getBrand())).toEqual({
            name: 'Arkadia',
            mode: 'mud',
            host: 'arkadia.rpg.pl',
            port: 4000,
            autoReconnect: true,
        });
    });

    it('builds a websocket-mode seed and prefers the target name', () => {
        setBrand({
            appName: 'Arkadia',
            mud: { mode: 'websocket', url: 'wss://arkadia.rpg.pl/ws', name: 'Main character' },
        });
        expect(brandConnectionData(getBrand())).toEqual({
            name: 'Main character',
            mode: 'websocket',
            url: 'wss://arkadia.rpg.pl/ws',
            autoReconnect: undefined,
        });
    });

    it('names a per-login seed after the account', () => {
        setBrand({ appName: 'Arkadia', mud: { mode: 'mud', host: 'arkadia.rpg.pl', port: 4000 } });
        expect(brandConnectionData(getBrand(), '  Gandalf ')?.name).toBe('Gandalf');
        // Empty account falls back to the brand name.
        expect(brandConnectionData(getBrand(), '  ')?.name).toBe('Arkadia');
    });
});

describe('matchBrandProfile', () => {
    const mud = { mode: 'mud', host: 'arkadia.rpg.pl', port: 4000 } as const;
    const profiles = [
        conn({ id: 'a', name: 'Gandalf' }),
        conn({ id: 'b', name: 'Frodo' }),
    ];

    it("matches per-login profiles by account name, case-insensitively", () => {
        setBrand({ mud, profileMode: 'perLogin' });
        expect(matchBrandProfile(profiles, getBrand(), 'FRODO')?.id).toBe('b');
        expect(matchBrandProfile(profiles, getBrand(), '  gandalf ')?.id).toBe('a');
        expect(matchBrandProfile(profiles, getBrand(), 'Bilbo')).toBeUndefined();
    });

    it('falls back to the shared profile without an account or in single mode', () => {
        setBrand({ mud, profileMode: 'perLogin' });
        expect(matchBrandProfile(profiles, getBrand(), '')?.id).toBe('a');
        setBrand({ mud });
        expect(matchBrandProfile(profiles, getBrand(), 'Frodo')?.id).toBe('a');
    });
});

describe('isPackageRemovable', () => {
    it('locks only brand packages marked removable: false', () => {
        setBrand({
            packages: [
                { name: 'locked-ui', filename: 'locked-ui.mpackage', url: 'u', removable: false },
                { name: 'optional-pack', filename: 'optional-pack.mpackage', url: 'u' },
            ],
        });
        expect(isPackageRemovable('locked-ui')).toBe(false);
        expect(isPackageRemovable('optional-pack')).toBe(true);
        // Stock defaults and unknown packages are always removable.
        expect(isPackageRemovable('run-lua-code')).toBe(true);
    });

    it('treats everything as removable with no brand packages', () => {
        expect(isPackageRemovable('run-lua-code')).toBe(true);
    });
});
