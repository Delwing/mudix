// Assets the library build ships as plain files next to the bundle:
// - vfs-sw.js: emitted into consumer builds by the mudix/vite plugin.
// - import/defaults/*.mpackage: referenced from dist-lib/index.js as external
//   relative `?url` imports (see vite.lib.config.ts), resolved and emitted by
//   the consumer's Vite.
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist-lib/import/defaults', { recursive: true });
copyFileSync('public/vfs-sw.js', 'dist-lib/vfs-sw.js');
cpSync('src/import/defaults', 'dist-lib/import/defaults', { recursive: true });
