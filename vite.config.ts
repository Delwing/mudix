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

export default defineConfig({
    base: './',
    optimizeDeps: {
        exclude: ['pcre2-wasm-universal'],
    },
    plugins: [
        pcre2WasmPlugin(),
        react(),
        nodePolyfills({ include: ['buffer', 'stream', 'events', 'util'] }),
    ],
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
