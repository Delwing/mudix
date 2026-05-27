import { defineConfig } from 'vitest/config';

// Tests run through Vite, so the bundled Lua (`?raw` imports + the
// `import.meta.glob('./mudlet-lua/**/*.lua')`), JSON imports, and extensionless
// TS imports resolve exactly as in the app build. happy-dom supplies the
// document / window / localStorage that ScriptingAPI touches; wasmoon's WASM is
// loaded from node's filesystem.
export default defineConfig({
  test: {
    // Default DOM env for future component tests; runtime/Lua suites opt into
    // the node environment per-file (`// @vitest-environment node`) so the WASM
    // libraries load from the filesystem.
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // wasmoon WASM init + bundled-Lua load is ~1s on a cold runtime.
    testTimeout: 20000,
    server: {
      deps: {
        // Emscripten glue in pcre2-wasm-universal uses __dirname, which is
        // undefined when node loads the package's "type":"module" files as ESM.
        // Inlining routes it through Vite's transform, which shims __dirname/
        // __filename so the WASM resolves + loads from node_modules via fs.
        inline: ['pcre2-wasm-universal'],
      },
    },
  },
});
