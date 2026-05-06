matches = {}; multimatches = {}
-- wasmoon pushes JS arrays 0-indexed in Lua (Object.keys → numeric keys
-- 0..n-1), so unpack as t[0], t[1], ... not t[1], t[2], ...
function getRoomCoordinates(id)
    local t = __getRoomCoordinates(id)
    if t then return t[0], t[1], t[2] end
    return false
end

function getMainWindowSize()
    local t = __getMainWindowSize()
    return t[0], t[1]
end

-- Callback registry: stores Lua functions handed to tempTimer/Alias/Trigger/Key
-- so JS only ever sees a numeric ID. JS invokes __mudix_dispatch_cb(id) via
-- doStringSync, sidestepping wasmoon's broken Lua-function-from-JS proxy.
__mudix_cb = {}
__mudix_cb_next = 0
function __mudix_register_cb(fn)
    __mudix_cb_next = __mudix_cb_next + 1
    __mudix_cb[__mudix_cb_next] = fn
    return __mudix_cb_next
end
function __mudix_unregister_cb(id) __mudix_cb[id] = nil end
function __mudix_dispatch_cb(id)
    local fn = __mudix_cb[id]
    if fn then return fn() end
end

-- JS event bridge. emitEvent() sets __mudix_evt_name + __mudix_evt_args
-- (a JS array, so its keys are 0-indexed) and runs this dispatcher.
function __mudix_dispatch_event()
    local event = __mudix_evt_name
    local raw = __mudix_evt_args
    -- JS arrays push as Lua tables keyed 0..n-1; rebuild as a 1-indexed sequence.
    local args = {}
    if type(raw) == 'table' then
        local i = 0
        while raw[i] ~= nil do
            args[#args + 1] = raw[i]
            i = i + 1
        end
        -- Fall back to ipairs in case wasmoon ever pushes 1-indexed.
        if #args == 0 then for _, v in ipairs(raw) do args[#args + 1] = v end end
    end
    if type(_G[event]) == 'function' then
        local ok, err = pcall(_G[event], unpack(args))
        if not ok and type(showHandlerError) == 'function' then showHandlerError(event, err) end
    end
    if type(dispatchEventToFunctions) == 'function' then
        dispatchEventToFunctions(event, unpack(args))
    end
end

-- Mudlet REGEX_LUA_CODE pattern evaluator: run the body as a Lua chunk on
-- every line. Side effects (raiseEvent, etc.) always execute; the trigger
-- "matches" only when the body's return value is truthy.
function __mudix_eval_pattern(code)
    __mudix_pat_result = false
    local fn = loadstring(code)
    if not fn then return end
    local ok, res = pcall(fn)
    if not ok then return end
    __mudix_pat_result = (res and true) or false
end

-- Mudlet accepts either a function or a Lua code string for temp* callbacks;
-- compile strings to functions so handlers run in a fresh chunk.
function __mudix_to_fn(v, who, argN)
    if type(v) == 'function' then return v end
    if type(v) == 'string' then
        local fn, err = loadstring(v)
        if not fn then
            error(who .. ": failed to compile code string: " .. tostring(err))
        end
        return fn
    end
    error(who .. ": bad argument #" .. argN .. " (function or string expected, got " .. type(v) .. ")")
end

do
    local _raw = __mudix_tempTimer
    function tempTimer(seconds, fn, repeating)
        return _raw(seconds, __mudix_register_cb(__mudix_to_fn(fn, "tempTimer", 2)), repeating or false)
    end
end

do
    local _raw = __mudix_tempAlias
    function tempAlias(pattern, fn)
        return _raw(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempAlias", 2)))
    end
end

do
    local _raw = __mudix_tempTrigger
    function tempTrigger(pattern, fn)
        return _raw(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempTrigger", 2)))
    end
end

do
    local _raw = __mudix_tempKey
    function tempKey(modifier, key, fn)
        return _raw(modifier, key, __mudix_register_cb(__mudix_to_fn(fn, "tempKey", 3)))
    end
end

-- setLabelClickCallback(name, fnOrCode) — Mudlet also accepts trailing args,
-- but we don't pass them through yet. Strings compile as Lua chunks (matches
-- the temp* family).
do
    local _raw = __mudix_setLabelClickCallback
    function setLabelClickCallback(name, fn)
        return _raw(name, __mudix_register_cb(__mudix_to_fn(fn, "setLabelClickCallback", 2)))
    end
end

-- echoLink: convert Lua function cmd → stored ref + string command.
do
    local _fns = {}
    local _id  = 0
    local _raw = echoLink
    function __mudix_call_link(id) _fns[id]() end
    echoLink = function(...)
        local args = {...}
        local n = #args
        local ci = (n >= 4 and type(args[4]) == 'string') and 3 or 2
        if type(args[ci]) == 'function' then
            _id = _id + 1
            local id = _id
            _fns[id] = args[ci]
            args[ci] = '__mudix_call_link(' .. id .. ')'
        end
        return _raw(unpack(args))
    end
end

-- echoPopup: xEcho passes cmds/hints as Lua tables.  wasmoon's JS proxy
-- for LuaTable doesn't support reliable numeric-key iteration from JS, so
-- flatten the tables to \x01-delimited strings here in Lua (where ipairs
-- is trivial) and let the JS binding split them.
do
    local _raw = echoPopup
    local SEP = '\1'
    echoPopup = function(win, v, cmds, hints, fmt)
        if not v or v == '' then return end
        local cs, hs = {}, {}
        if type(cmds) == 'table' then
            for _, c in ipairs(cmds) do cs[#cs+1] = tostring(c) end
        end
        if type(hints) == 'table' then
            for _, h in ipairs(hints) do hs[#hs+1] = tostring(h) end
        end
        return _raw(win, v, table.concat(cs, SEP), table.concat(hs, SEP), fmt)
    end
end
