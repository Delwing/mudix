// Assets the library build ships as plain files next to the bundle:
// - vfs-sw.js: emitted into consumer builds by the mudix/vite plugin.
// - *.mpackage: referenced from dist-lib/index.js as external relative `?url`
//   imports (see vite.lib.config.ts), resolved and emitted by the consumer's
//   Vite. Rollup rewrites those specifiers relative to the output root, so each
//   file has to land at the same path under dist-lib that it has under src.
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

const GENERIC_MAPPER_DIR = 'scripting/lua/mudlet-lua/generic-mapper';

mkdirSync('dist-lib/import/defaults', { recursive: true });
mkdirSync(`dist-lib/${GENERIC_MAPPER_DIR}`, { recursive: true });
copyFileSync('public/vfs-sw.js', 'dist-lib/vfs-sw.js');
// Both are defaultPackages.ts entries; generic_mapper is imported from the
// vendored mudlet-lua mirror rather than copied into import/defaults/.
cpSync('src/import/defaults', 'dist-lib/import/defaults', { recursive: true });
copyFileSync(
    `src/${GENERIC_MAPPER_DIR}/generic_mapper.mpackage`,
    `dist-lib/${GENERIC_MAPPER_DIR}/generic_mapper.mpackage`,
);
