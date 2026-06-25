// Minimal typings for the prebuilt Emscripten glue shipped by
// `pcre2-wasm-universal` (exposed via its `./libpcre2` subpath export). Only the
// low-level runtime exports the vendored wrapper (`Pcre2.ts`) actually touches
// are declared here. The heap views are re-created when wasm memory grows, so
// always read them fresh off the module rather than caching the reference.
declare module 'pcre2-wasm-universal/libpcre2' {
    interface Libpcre2Module {
        /** Resolves once the wasm runtime has finished initializing. */
        loaded: Promise<unknown>;
        _malloc(bytes: number): number;
        _free(ptr: number): void;
        cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => number;
        getValue(ptr: number, type: string, noSafe?: boolean): number;
        HEAP8: Int8Array;
        HEAPU8: Uint8Array;
        HEAPU16: Uint16Array;
    }
    const libpcre2: Libpcre2Module;
    export default libpcre2;
}
