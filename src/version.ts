/**
 * The client's own identity on the wire — one source of truth for every
 * protocol that asks who we are: TTYPE/MTTS (`TelnetNegotiator`), MNES and
 * NEW-ENVIRON (`protocol/mnes`), GMCP `Core.Hello` (`MudClient`), and the MXP
 * `<VERSION>` reply (`protocol/mxp`). These four used to carry three different
 * spellings and two different version numbers; keep them going through here.
 *
 * This is *our* version, not the Mudlet API level we implement. Scripts
 * feature-gate on `getMudletVersion()` (Bridge.lua), which reports the Mudlet
 * release whose Lua API this client targets and moves independently of the
 * client's own release number — a script asking `mudletOlderThan(4, 10, 0)`
 * wants to know which APIs exist, not which build of Mudlet Web it runs on.
 *
 * `CLIENT_VERSION` comes straight from package.json, substituted at build time
 * by Vite `define` (see buildInfo.ts) — `src/` can't import package.json
 * itself because tsconfig.lib.json pins `rootDir: "src"`.
 */

/** Client name reported to servers. Uppercase, hyphenated: TTYPE values are
 *  conventionally uppercase tokens (Mudlet sends `MUDLET`), and the MNES and
 *  GMCP slots reuse the same token so a server sees one consistent identity.
 *
 *  Deliberately distinct from desktop Mudlet's `MUDLET`: server authors
 *  feature-detect off this, and Mudlet Web is not feature-identical to the
 *  desktop client. Claiming to be `MUDLET` would invite traffic we can't
 *  honour. */
export const CLIENT_NAME = "MUDLET-WEB";

/** Client version, reported alongside `CLIENT_NAME`. Always package.json's
 *  `version` — there is nothing to keep in sync by hand. */
export const CLIENT_VERSION = __APP_VERSION__;

/** Short git hash of the build, or '' when git wasn't available at build time.
 *  Shown in the About dialog next to the version: releases between version
 *  bumps are otherwise indistinguishable in a bug report. */
export const GIT_COMMIT = __GIT_COMMIT__;

/** Terminal type reported via TTYPE and MNES `TERMINAL_TYPE`. "ANSI-TRUECOLOR"
 *  (matching Mudlet) describes the real capability — ANSI with 24-bit colour —
 *  better than an xterm emulation claim; 256-colour/truecolour support is also
 *  signalled via MTTS and the 256_COLORS/TRUECOLOR vars, so capability
 *  detection doesn't rest on this name. */
export const TERMINAL_TYPE = "ANSI-TRUECOLOR";
