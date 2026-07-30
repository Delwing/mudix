# Branded builds

Mudlet Web can be consumed as an npm library to ship a **white-label client for one
specific MUD** — your own app name, login screen, theme, toolbar, and bundled
Lua packages — without forking the Mudlet Web repo. Updates land as a version bump
(`yarn upgrade @mudlet/mudlet-web`) instead of a rebase.

A branded build is a small standalone app: `import { MudletWebApp } from
'@mudlet/mudlet-web'`, render it with a `brand` prop, and let the `@mudlet/mudlet-web/vite`
plugin handle the WASM/polyfill wiring Mudlet Web's runtime needs. Everything else
(index.html, favicon, manifest, deployment) is your repo's own job — Mudlet Web
doesn't impose a shell around it.

Live example: [embervale-web](https://github.com/Delwing/embervale-web) is a
complete branded client (custom landing, theme, toolbar button, a Lua package
with a scripted map) deployed to GitHub Pages.

## Quickstart

```bash
yarn create vite my-brand-web --template react-ts
cd my-brand-web
yarn add @mudlet/mudlet-web
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mudletWeb from '@mudlet/mudlet-web/vite';

export default defineConfig({
    plugins: [mudletWeb(), react()],
});
```

`src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { MudletWebApp, type BrandConfig } from '@mudlet/mudlet-web';
import '@mudlet/mudlet-web/styles.css';

const brand: BrandConfig = {
    appName: 'My Brand',
    tagline: 'A MUD client for MyMud.',
    mud: { mode: 'websocket', url: 'wss://mymud.example.com/ws' },
};

createRoot(document.getElementById('root')!).render(<MudletWebApp brand={brand} />);
```

`yarn dev` and you have a working branded client: setting `brand.mud` switches
Mudlet Web into **branded mode** — no profile picker/creation UI, just a login form
(the built-in one, unless you supply a custom `Landing`), and login
credentials are never persisted to storage.

For production, `yarn build` (plain `vite build` — the plugin supplies
everything the consumer build needs) and deploy `dist/` as a static site.

## `BrandConfig` reference

All fields are optional; an empty `{}` (or no `brand` prop at all) reproduces
stock Mudlet Web exactly. The full, current type definitions live in
[`src/branding.ts`](../src/branding.ts) — treat this section as a guided tour,
that file as the source of truth.

- **`appName`** — wordmark, document title, About dialog.
- **`tagline`** / **`aboutText`** / **`repoUrl`** — About dialog content; empty
  string hides the tagline/aboutText, `undefined` hides the repo link.
- **`proxyUrl`** — hardcode the telnet→WebSocket proxy URL for this brand
  (branded builds don't expose the per-connection proxy field to end users).
- **`mud`** — the one MUD this build targets (`{ mode: 'mud', host, port }` or
  `{ mode: 'websocket', url }`, plus optional `name`/`autoConnect`). Setting
  this is what switches the client into branded mode.
- **`profileMode`** — `'single'` (default: one shared profile regardless of
  the account entered) or `'perLogin'` (find-or-create a profile per account
  name, so each login keeps its own scripts/layout/files).
- **`packages`** — the exact `BrandPackage[]` preinstalled into every profile on
  first open, **replacing** Mudlet Web's stock defaults rather than adding to
  them. Leave it unset to get the stock defaults (`run-lua-code` plus one
  mapper); set `[]` to preinstall nothing; list packages to get exactly those.
  See [Bundling Lua packages](#bundling-lua-packages) below.
- **`themes`** / **`availableThemes`** / **`defaultTheme`** — brand color
  themes and picker configuration (see [Theming](#theming) below).
- **`toolbar`** — hide stock buttons, add brand buttons, restyle via
  `className` (see [Toolbar](#toolbar) below).
- **`Landing`** — replace the built-in login screen entirely (see
  [Custom landing screens](#custom-landing-screens) below).

## Custom landing screens

The default `BrandLoginScreen` (account + password + Connect/Open-offline) is
usually enough, but you can supply your own `Landing` component for full
control over markup and layout:

```tsx
import { useBrandLogin, type LandingProps } from '@mudlet/mudlet-web';

function MyLanding({ openProfile, ensureBrandProfile, openSettings }: LandingProps) {
    const { account, setAccount, password, setPassword, enter } = useBrandLogin({ openProfile, ensureBrandProfile });
    // ...your own markup, calling enter(true) to connect or enter(false) to open offline
}
```

`useBrandLogin` handles the find-or-create-profile + in-memory-credential
sequence — nothing is ever read from or written to persistent storage. If you
just want the stock fields with different labels/classes, use
`BrandLoginFields` instead of the hook — it's an unstyled form with stable
`mudix-login-*` classes for your own CSS.

Pass your component as `brand.Landing`.

## Bundling Lua packages

Ship a `.mpackage` (or zip) with your app and point a `BrandPackage` at its
`?url` import — it installs into every profile automatically on first open,
through the same pipeline as Mudlet Web's own defaults:

```ts
import myPackageUrl from './assets/my-brand.mpackage?url';

const brand: BrandConfig = {
    // ...
    packages: [
        { name: 'my-brand', filename: 'my-brand.mpackage', url: myPackageUrl, version: '1.0.0', removable: false },
    ],
};
```

- **`version`** — bump it (together with the package's own `config.lua`
  version) whenever you change the package; a profile whose installed copy
  doesn't match reinstalls fresh on next open. This is how you push script
  updates to players. Leave unset to install once and never touch it again.
- **`removable: false`** — hides the uninstall control, makes Lua's
  `uninstallPackage()` refuse, and reinstalls it if removed by other means.

## Theming

```ts
const brand: BrandConfig = {
    themes: [{ id: 'mybrand', label: 'My Brand', variables: { '--accent': '#c09648' }, colorScheme: 'dark' }],
    defaultTheme: 'mybrand',
    availableThemes: ['mybrand', 'light'], // omit to offer all stock + brand themes
};
```

A brand theme is injected as a `:root[data-theme="<id>"]` CSS rule after
Mudlet Web's bundled stylesheets, so unset variables fall back to the dark base and
reusing a stock id (`dark`, `light`, ...) overrides that stock theme in place.
See the `:root` block in `src/App.css` for the full CSS variable list.

## Toolbar

```ts
const brand: BrandConfig = {
    toolbar: {
        hide: ['map', 'logs'],
        buttons: [
            { id: 'roll', label: 'Roll d20', onClick: ctx => ctx.raiseEvent('rollDice', 20) },
        ],
        className: 'mybrand-toolbar',
    },
};
```

Brand buttons get a `BrandToolbarContext` with `send(text)` (as if the user
typed a command) and `raiseEvent(event, ...args)` (a Mudlet event your Lua
scripts can register a handler for).

## Consumer build notes

- **`optimizeDeps`** — the `mudletWeb()` plugin already excludes `@mudlet/mudlet-web`
  and `pcre2-wasm-universal` and pre-bundles the CJS deps Mudlet Web needs
  (`eventemitter3`, `wasmoon-lua5.1`, `@zenfs/core > readable-stream`). If dev
  mode reports `"does not provide an export named ..."` for another
  dependency, add it to that `include` list in your own `vite.config.ts`.
- **Yarn `file:` tarballs** — if you're testing a local build via `yarn pack`
  instead of the published package, version-stamp the tarball filename
  (`mudlet-web-X.Y.Z.tgz`) and bump the version each time — Yarn's cache otherwise
  ignores content changes to a same-named file.
- **`import '@mudlet/mudlet-web/styles.css'`** is required once, near your app
  root — the library build ships CSS separately from the JS bundle.

## What's still yours to build

Mudlet Web's library export deliberately stops at the app root. Your branded repo
owns:
- `index.html`, favicon, manifest, and any marketing/landing chrome outside
  `<MudletWebApp/>`.
- Deployment (GitHub Pages, Netlify, your own host — `dist/` is a static
  site).
- The `.mpackage` content itself (scripts, triggers, aliases, maps) — build it
  in Mudlet Web like any other profile and export/zip it.

See [`CLAUDE.md`](../CLAUDE.md) for the internals of `MudletWebApp`/`branding.ts`
if you need to go beyond what `BrandConfig` exposes.
