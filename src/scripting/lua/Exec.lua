-- User-code sandbox.
--
-- Each chunk runs inside a private coroutine that we step manually, forwarding
-- any value the chunk yields (typically a Promise from the JS bridge) up to
-- the JS-side resume loop. We can't use xpcall/pcall here: in Lua 5.1 they
-- introduce a C-call boundary that `coroutine.yield` cannot cross, which would
-- break every JS-async API (db, sql, future async tools). Errors are captured
-- via `coroutine.resume`'s (false, err) return instead.
--
-- Returns (err, result) on its own thread's stack instead of setting globals.
-- Globals would race with concurrent / re-entrant exec calls — the queue
-- serializes ENTRY into Lua, but a re-entrant exec (e.g. expandAlias from
-- inside a script) runs nested while the outer is mid-execution; both share
-- globals, both would clobber __exec_err. Stack returns are per-thread.
function __exec(code, name)
    local fn, compile_err = loadstring(code, "@" .. name)
    if not fn then
        return compile_err, nil
    end
    local co = coroutine.create(fn)
    local resume_arg = nil
    while true do
        local ok, value = coroutine.resume(co, resume_arg)
        if not ok then
            return tostring(value), nil
        end
        if coroutine.status(co) == "dead" then
            return nil, value
        end
        -- Forward the inner yield (Promise or other) up to JS; `value` returned
        -- below is whatever JS resumed us with (resolved Promise value).
        resume_arg = coroutine.yield(value)
    end
end
