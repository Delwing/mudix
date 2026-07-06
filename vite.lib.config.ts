import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

/**
 * Library build (`yarn build:lib`) — packages mudix as an importable npm
 * module (`import { MudixApp } from 'mudix'`) for branded builds, following
 * the mudlet-map-editor dual app+lib pattern. Only mudix's own source is
 * bundled (with `?raw` Lua, `import.meta.glob`, JSON and `?url` assets
 * pre-resolved); every bare-specifier dependency stays external and resolves
 * from the consumer's node_modules, where the `mudix/vite` companion plugin
 * supplies the same WASM/polyfill handling the app build gets here.
 */

/** Bundle relative/absolute ids (mudix source + emitted assets) and the
 *  node-polyfill shims the nodePolyfills plugin injects (they're a devDep of
 *  mudix, so consumers can't resolve them); externalize every other bare
 *  import. Virtual modules (\0-prefixed) are plugin-internal — keep those. */
function isExternal(id: string): boolean {
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return false;
    if (/^[A-Za-z]:[\\/]/.test(id)) return false; // absolute Windows path
    if (id.startsWith('vite-plugin-node-polyfills')) return false;
    return true;
}

export default defineConfig({
    // Relative base so emitted assets (worker chunks, .mpackage files) are
    // referenced via relative import.meta.url URLs the consumer's bundler can
    // resolve and re-emit — absolute /assets/ paths would 404 on their site.
    base: './',
    plugins: [
        react(),
        nodePolyfills({ include: ['buffer', 'stream', 'events', 'util'] }),
    ],
    // Workers don't inherit `plugins`; the map parser worker imports Buffer.
    worker: {
        format: 'es',
        plugins: () => [
            nodePolyfills({ include: ['buffer', 'stream', 'events', 'util'] }),
        ],
    },
    build: {
        lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            formats: ['es'],
            fileName: 'index',
            cssFileName: 'styles',
        },
        outDir: 'dist-lib',
        copyPublicDir: false,
        rollupOptions: {
            external: isExternal,
        },
    },
});
