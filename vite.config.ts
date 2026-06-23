import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Serves libpcre2.wasm at the root URL in dev (where emscripten looks for it
// when document.currentScript is null) and emits it to the build output.
function pcre2WasmPlugin(): Plugin {
    const wasmPath = resolve('node_modules/pcre2-wasm-universal/dist/libpcre2.wasm');
    return {
        name: 'pcre2-wasm',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url === '/libpcre2.wasm') {
                    res.setHeader('Content-Type', 'application/wasm');
                    res.end(readFileSync(wasmPath));
                    return;
                }
                next();
            });
        },
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'libpcre2.wasm',
                source: readFileSync(wasmPath),
            });
        },
    };
}

// Injects a strict Content-Security-Policy <meta> into the built index.html.
// Build-only (`apply: 'build'`) because the dev server relies on inline scripts,
// eval, and a localhost WebSocket for HMR that a strict policy would break.
//
// Key choices, given what mudix actually does:
//   - script-src 'self' 'wasm-unsafe-eval' — NO 'unsafe-inline'/'unsafe-eval'.
//     The production bundle has no inline scripts; 'wasm-unsafe-eval' lets the
//     Lua/PCRE/SQLite WebAssembly compile WITHOUT permitting JS eval(), so an
//     injected <script> or inline handler (the XSS vector that could read saved
//     credentials from localStorage) cannot run.
//   - style-src allows 'unsafe-inline': the renderer sets per-segment ANSI
//     colors via inline styles and CodeMirror injects <style>; inline *styles*
//     are far lower risk than inline scripts and can't be hashed here.
//   - connect-src / img/font/media are broad (https:, wss:, ws:, data:, blob:)
//     because a MUD client connects to arbitrary servers and loads VFS/remote
//     assets — this breadth doesn't enable script injection.
function cspPlugin(): Plugin {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' blob: data: https:",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "connect-src 'self' https: wss: ws: data: blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
    return {
        name: 'inject-csp',
        apply: 'build',
        transformIndexHtml() {
            return [{
                tag: 'meta',
                attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
                injectTo: 'head-prepend',
            }];
        },
    };
}

export default defineConfig({
    base: './',
    optimizeDeps: {
        exclude: ['pcre2-wasm-universal'],
    },
    plugins: [
        cspPlugin(),
        pcre2WasmPlugin(),
        react(),
        nodePolyfills({ include: ['buffer', 'stream', 'events', 'util'] }),
    ],
    // Workers don't inherit `plugins`; re-declare nodePolyfills here so the map
    // parser worker (mudlet-map-binary-reader → Buffer) gets the same shim it
    // gets on the main thread.
    worker: {
        format: 'es',
        plugins: () => [
            nodePolyfills({ include: ['buffer', 'stream', 'events', 'util'] }),
        ],
    },
    build: {
        rollupOptions: {
            onwarn(warning, defaultHandler) {
                if (
                    warning.code === 'COMMONJS_VARIABLE_IN_ESM' &&
                    warning.id?.includes('pcre2-wasm-universal')
                ) {
                    return;
                }
                defaultHandler(warning);
            },
        },
    },
});
