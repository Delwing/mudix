-- User-code sandbox. Wraps every chunk in xpcall so a runtime error doesn't
-- escape to wasmoon's coroutine top-level (which would kill the thread and
-- make later run() calls fail with "cannot resume non-suspended coroutine").
function __exec(code, name)
    __exec_err = nil
    __exec_result = nil
    local fn, compile_err = loadstring(code, "@" .. name)
    if not fn then
        __exec_err = compile_err
        return
    end
    local ok, r = xpcall(fn, function(e)
        return debug.traceback(e, 2)
    end)
    if ok then
        __exec_result = r
    else
        __exec_err = r
    end
end
