import type { ComponentType } from 'react';
import type { ConnectionMode, MudConnection } from './storage/schema';

/**
 * White-label branding for mudix builds. A branded client (a client shipped for
 * one specific MUD) passes a `BrandConfig` to `<MudixApp brand={...}/>`; the
 * config is held in a module-level singleton so non-React code (proxy
 * resolution, document title, default packages) can read it without prop
 * drilling. The default brand is plain mudix — rendering `<MudixApp/>` with no
 * brand reproduces the stock client exactly.
 */

/** The one MUD a branded build targets. Setting this switches the client into
 *  branded mode: exactly one profile (seeded from these fields on first
 *  launch), no profile creation/selection UI — the landing is a login form
 *  (the built-in `BrandLoginScreen`, or the brand's own `Landing`) — and
 *  login credentials are kept in memory only, never persisted. */
export interface BrandMudTarget {
    mode: ConnectionMode;
    /** `mud` mode (via telnet proxy). */
    host?: string;
    port?: number;
    /** `websocket` mode (native WS endpoint). */
    url?: string;
    /** Display name for seeded profiles; defaults to the brand's `appName`. */
    name?: string;
    /** Seeded profiles dial automatically when opened. */
    autoConnect?: boolean;
}

/** A package bundled with the brand, installed on first profile open through
 *  the same pipeline as mudix's own defaults (see `ensureDefaultPackages`). */
export interface BrandPackage {
    /** Must match the manifest name produced by installPackageFromBytes. */
    name: string;
    /** Filename passed to the installer (drives manifest.name + on-disk dir). */
    filename: string;
    /** Resolved URL to the asset (e.g. an `?url` import in the brand's repo). */
    url: string;
}

/** Contract for a brand-supplied landing screen, rendered instead of the stock
 *  connection picker whenever no profile is open. */
export interface LandingProps {
    connections: MudConnection[];
    /** Open a profile; `connect` dials immediately instead of opening offline. */
    openProfile: (connectionId: string, connect: boolean) => void;
    /** Find-or-create the brand's managed profile and return its connection
     *  id to pass to `openProfile`. In `profileMode: 'perLogin'`, `account`
     *  selects (or names) the per-account profile, matched case-insensitively;
     *  otherwise the single shared profile is used. Never pass credentials
     *  into storage — use `setSessionCredentials` from
     *  `utils/sessionCredentials` for the password. */
    ensureBrandProfile: (account?: string) => string;
    openSettings: () => void;
}

export interface BrandConfig {
    /** App name: wordmark, document title, About dialog. */
    appName: string;
    /** Short tagline under the About wordmark. Empty string hides it. */
    tagline?: string;
    /** Descriptive paragraph in the About dialog. Empty string hides it. */
    aboutText?: string;
    /** "View source" link in the About dialog. `undefined` hides the link. */
    repoUrl?: string;
    /** Brand-hardcoded telnet proxy. Sits below explicit user overrides in the
     *  precedence chain (connection > user settings > brand > built-in), but
     *  branded builds never expose the per-connection proxy field, so this
     *  effectively wins. */
    proxyUrl?: string;
    /** The single MUD this build targets. Setting it enables branded mode —
     *  see the type's doc. Leave unset for a stock (open) client. */
    mud?: BrandMudTarget;
    /** How branded builds map logins to profiles (default `'single'`):
     *  - `'single'`   — one shared profile regardless of the account entered.
     *  - `'perLogin'` — find-or-create a profile per account name entered at
     *    the login form (compared case-insensitively, stored as the profile
     *    name) — each login keeps its own scripts, layout and files. There is
     *    still no picker: selection happens by logging in. */
    profileMode?: 'single' | 'perLogin';
    /** Packages preinstalled into every profile on first open. */
    packages?: BrandPackage[];
    /** Custom landing screen replacing the stock connection picker. */
    Landing?: ComponentType<LandingProps>;
}

export const DEFAULT_BRAND: BrandConfig = {
    appName: 'mudix',
    tagline: 'A modern, web-based MUD client.',
    aboutText:
        'mudix connects to MUD servers over WebSocket with full telnet, GMCP and MSDP support, ' +
        'renders ANSI output, and runs Mudlet-compatible Lua scripting right in your browser — ' +
        'aiming for drop-in compatibility with Mudlet packages, maps and profiles.',
    repoUrl: 'https://github.com/Delwing/mudix',
};

let current: BrandConfig = DEFAULT_BRAND;

/** Install the active brand. Called once by `MudixApp` before first render;
 *  unspecified fields fall back to the stock mudix brand. Idempotent. */
export function setBrand(brand?: Partial<BrandConfig>): void {
    current = { ...DEFAULT_BRAND, ...brand };
}

export function getBrand(): BrandConfig {
    return current;
}

/** Whether the active brand pins a MUD — i.e. the client runs in branded mode
 *  (single profile, login-form landing, no persisted credentials). */
export function isBrandedMode(): boolean {
    return !!current.mud;
}

/** Connection-record seed for the brand's MUD, or null when the brand doesn't
 *  pin one. Used to create the managed profile(s) in branded mode; `account`
 *  names a per-login profile (see `profileMode: 'perLogin'`). */
export function brandConnectionData(brand: BrandConfig, account?: string): Omit<MudConnection, 'id'> | null {
    const mud = brand.mud;
    if (!mud) return null;
    const common = {
        name: account?.trim() || mud.name || brand.appName,
        autoReconnect: mud.autoConnect || undefined,
    };
    if (mud.mode === 'mud') {
        return { ...common, mode: 'mud', host: mud.host ?? '', port: mud.port ?? 23 };
    }
    return { ...common, mode: 'websocket', url: mud.url ?? '' };
}

/** The existing managed profile a login maps to, if any. In `'perLogin'` mode
 *  a non-empty `account` matches the profile named after it (trimmed,
 *  case-insensitive); otherwise — `'single'` mode, or no account entered —
 *  the one shared profile (the first connection) is used. */
export function matchBrandProfile(
    connections: MudConnection[],
    brand: BrandConfig,
    account?: string,
): MudConnection | undefined {
    const acct = account?.trim().toLowerCase();
    if (brand.profileMode === 'perLogin' && acct) {
        return connections.find(c => c.name.trim().toLowerCase() === acct);
    }
    return connections[0];
}
