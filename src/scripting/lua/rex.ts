import PCRE from 'pcre2-wasm-universal';
import type { Lua } from 'wasmoon-lua5.1';

type MatchResult = Record<number, { start: number; end: number; match: string }> & { length: number };

const withRe = <T>(pattern: string, flags: string, fn: (re: InstanceType<typeof PCRE>) => T): T => {
    const re = new PCRE(pattern, flags);
    try { return fn(re); } finally { re.destroy(); }
};

function extractCaptures(m: MatchResult): (string | false)[] {
    const caps: (string | false)[] = [];
    // pcre2-wasm-universal's `m.length` is the ovector pair count, which includes
    // the full match at index 0 — capture groups live at 1..length-1.
    for (let i = 1; i < m.length; i++) {
        // PCRE2 sets ovector to PCRE2_UNSET for unmatched optional groups,
        // which the wasm bridge reads as start === -1. The match object still
        // exists (with match === ""), so we must check the offset, not truthiness,
        // to distinguish "did not match" from "matched empty string".
        const cap = m[i];
        caps.push(cap && cap.start >= 0 ? cap.match : false);
    }
    return caps;
}

/** Register __rex_* JS helpers and put rex_pcre2 into package.loaded. */
export async function setupRex(lua: Lua): Promise<void> {
    await PCRE.init();

    // match(subject, pattern, init?) → table [cap1, cap2, ...] or nil
    lua.global.set('__rex_match__', (subject: string, pattern: string, init?: number) => {
        return withRe(pattern, '', re => {
            const m = re.match(subject, init ? init - 1 : 0);
            if (!m) return null;
            const caps = extractCaptures(m);
            return caps.length > 0 ? caps : [m[0].match];
        });
    });

    // find(subject, pattern, init?) → table [start, end, cap1, ...] or nil  (1-indexed)
    lua.global.set('__rex_find__', (subject: string, pattern: string, init?: number) => {
        return withRe(pattern, '', re => {
            const m = re.match(subject, init ? init - 1 : 0);
            if (!m) return null;
            return [m[0].start + 1, m[0].end, ...extractCaptures(m)];
        });
    });

    // split(subject, pattern) → array of [section, cap1, ...] for Lua iterator
    lua.global.set('__rex_split__', (subject: string, pattern: string) => {
        return withRe(pattern, '', re => {
            const matches = re.matchAll(subject);
            const results: (string | false)[][] = [];
            let lastEnd = 0;
            for (const m of matches) {
                results.push([subject.slice(lastEnd, m[0].start), ...extractCaptures(m)]);
                lastEnd = m[0].end;
            }
            results.push([subject.slice(lastEnd)]);
            return results;
        });
    });

    // gsub(subject, pattern, repl) → string  (repl: string or Lua function)
    lua.global.set('__rex_gsub__', (subject: string, pattern: string, repl: unknown) => {
        return withRe(pattern, '', re => {
            const matches = re.matchAll(subject);
            let result = '';
            let lastEnd = 0;
            for (const m of matches) {
                result += subject.slice(lastEnd, m[0].start);
                if (typeof repl === 'function') {
                    const caps = extractCaptures(m);
                    const r = (repl as (...a: unknown[]) => unknown)(...caps);
                    result += r == null ? m[0].match : String(r);
                } else {
                    result += String(repl);
                }
                lastEnd = m[0].end;
            }
            return result + subject.slice(lastEnd);
        });
    });

    const rexModule = await lua.doString(`
        local _match = __rex_match__
        local _find  = __rex_find__
        local _split = __rex_split__
        local _gsub  = __rex_gsub__

        local M = {}

        -- JS arrays use 0-based indexing. Collect all elements into a proper
        -- 1-based Lua table (stopping at the first nil) then unpack it.
        local function jsarr2vararg(t)
            local r = {}
            local i = 0
            while true do
                local v = t[i]
                if v == nil then break end
                r[i + 1] = v
                i = i + 1
            end
            return unpack(r)
        end

        M.match = function(subject, pattern, init)
            local t = _match(subject, pattern, init)
            if t == nil then return nil end
            return jsarr2vararg(t)
        end

        M.find = function(subject, pattern, init)
            local t = _find(subject, pattern, init)
            if t == nil then return nil end
            return jsarr2vararg(t)
        end

        M.split = function(subject, pattern)
            local results = _split(subject, pattern)
            local i = -1
            return function()
                i = i + 1
                local row = results[i]
                if row == nil then return nil end
                -- row is a 0-indexed JS array: [section, cap1, cap2, ...]
                return row[0], row[1], row[2]
            end
        end

        M.gsub = function(subject, pattern, repl, n)
            return _gsub(subject, pattern, repl)
        end

        M.new = function(pattern, flags)
            local p = pattern
            return setmetatable({}, { __index = {
                match = function(self, subject, init) return M.match(subject, p, init) end,
                find  = function(self, subject, init) return M.find(subject, p, init)  end,
            }})
        end

        package.loaded["rex_pcre2"] = M

        -- clean up bridge globals
        __rex_match__ = nil
        __rex_find__  = nil
        __rex_split__ = nil
        __rex_gsub__  = nil

        return M
    `);
    lua.global.set('rex', rexModule);
    lua.global.set('rex_pcre2', rexModule);
}
