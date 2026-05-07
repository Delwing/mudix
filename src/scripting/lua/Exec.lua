-- User-code sandbox. Compile the chunk and run it under pcall so a runtime
-- error returns as (errmsg, nil) instead of unwinding through wasmoon's
-- bridge. Returns (err, result).
function __exec(code, name)
    local fn, compile_err = loadstring(code, "@" .. name)
    if not fn then
        return compile_err, nil
    end
    local ok, result = pcall(fn)
    if not ok then
        return tostring(result), nil
    end
    return nil, result
end
