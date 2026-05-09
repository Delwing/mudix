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

function getUserWindowSize(name)
    local t = __getUserWindowSize(name)
    return t[0], t[1]
end

-- Mudlet getBackgroundColor([windowName]). JS returns the rgba channels as a
-- 0-indexed array; unpack to four return values to match the C++ API.
function getBackgroundColor(windowName)
    local t = __getBackgroundColor(windowName)
    return t[0], t[1], t[2], t[3]
end

-- Mudlet getCustomEnvColor(envID). JS returns nil for unknown IDs (matches
-- Mudlet) and a 0-indexed [r,g,b,a] array otherwise.
function getCustomEnvColor(envId)
    local t = __getCustomEnvColor(envId)
    if t == nil then return nil end
    return t[0], t[1], t[2], t[3]
end

-- Mudlet getSelection([windowName]) → text, start, length on success;
-- false, "no selection" otherwise. JS hands back a 0-indexed array or nil.
function getSelection(windowName)
    local t = __getSelection(windowName)
    if t == nil then return false, "no selection" end
    return t[0], t[1], t[2]
end

-- Mudlet getMapEvents() → { [uniqueName] = { ["event name"]=..., ["parent"]=...,
-- ["display name"]=..., ["arguments"]={...} } }. JS hands back an array of
-- entries (0-indexed); rebuild into Mudlet's exact key/shape so scripts can
-- index by literal string keys.
function getMapEvents()
    local raw = __getMapEvents()
    local out = {}
    if type(raw) == 'table' then
        local i = 0
        while raw[i] ~= nil do
            local e = raw[i]
            local args = {}
            local rawArgs = e.args
            if type(rawArgs) == 'table' then
                local j = 0
                while rawArgs[j] ~= nil do
                    args[#args + 1] = rawArgs[j]
                    j = j + 1
                end
                if #args == 0 then
                    for _, v in ipairs(rawArgs) do args[#args + 1] = v end
                end
            end
            out[e.uniqueName] = {
                ["event name"]   = e.eventName,
                ["parent"]       = e.parent or "",
                ["display name"] = e.displayName,
                ["arguments"]    = args,
            }
            i = i + 1
        end
    end
    return out
end

-- Mudlet addAreaName(name) → areaID on success, or (false, errMsg) on
-- duplicate / empty name. JS hands back either a number or a table
-- { ok=false, err=... } (wasmoon flattens it to numeric keys 0/1 across the
-- bridge — we tolerate both shapes).
function addAreaName(name)
    local r = __addAreaName(name)
    if type(r) == 'number' then return r end
    if type(r) == 'table' then
        local err = r.err or r[1] or r[0] or 'addAreaName: failed'
        return false, err
    end
    return false, 'addAreaName: failed'
end

-- Mudlet setAreaName(areaID|areaName, newName) → true on success, or
-- (false, errMsg) on duplicate/missing/empty.
function setAreaName(idOrName, newName)
    local r = __setAreaName(idOrName, newName)
    if r == true then return true end
    if type(r) == 'table' then
        local err = r.err or r[1] or r[0] or 'setAreaName: failed'
        return false, err
    end
    return false, 'setAreaName: failed'
end

-- Mudlet getPackages() → 1-indexed Lua array of installed package names. JS
-- arrays come in 0-indexed via wasmoon; rebuild as ipairs-friendly.
local function rebuildJsArray(t)
    local out = {}
    if type(t) == 'table' then
        local i = 0
        while t[i] ~= nil do
            out[#out + 1] = t[i]
            i = i + 1
        end
        if #out == 0 then for _, v in ipairs(t) do out[#out + 1] = v end end
    end
    return out
end

function getPackages()
    return rebuildJsArray(__getPackages())
end

-- Mudlet getModules() — same shape as getPackages(), but lists modules only.
function getModules()
    return rebuildJsArray(__getModules())
end

-- Mudlet getLines([window,] from, to) → 1-indexed table of line strings.
-- JS hands back a 0-indexed array via wasmoon; rebuild as ipairs-friendly.
function getLines(a, b, c)
    return rebuildJsArray(__getLines(a, b, c))
end

-- Mudlet syncModule(name). The JS side runs the actual write asynchronously;
-- this wrapper kicks it off and returns immediately. sysSyncOnModule fires
-- on completion.
function syncModule(name)
    __mudix_syncModule(name)
end

-- Mudlet getModuleInfo(name [, key]) — returns the manifest as a table when
-- called with one argument, or a single string when called with a key.
-- Mudlet exposes a fixed set of keys (author, title, description, version,
-- created, package); we forward whatever the manifest carries.
function getModuleInfo(name, key)
    local info = __getModuleInfo(name)
    if info == nil then return nil end
    if key == nil then return info end
    return info[key]
end

-- Mudlet-compatible getMudletVersion. Behaviour:
--   no arg / nil      → table { major, minor, revision, build }
--   "string"          → "major.minor.revision[-build]"
--   "major" / "minor" / "revision" / "build" → field value
--   "table"           → major, minor, revision as 3 separate return values
--                       (mudlet-lua's mudletOlderThan relies on this)
do
    local MAJOR, MINOR, REVISION, BUILD = 4, 20, 0, ""
    function getMudletVersion(mode)
        if mode == nil then
            return { major = MAJOR, minor = MINOR, revision = REVISION, build = BUILD }
        elseif mode == "string" then
            if BUILD ~= "" then
                return string.format("%d.%d.%d-%s", MAJOR, MINOR, REVISION, BUILD)
            end
            return string.format("%d.%d.%d", MAJOR, MINOR, REVISION)
        elseif mode == "major"    then return MAJOR
        elseif mode == "minor"    then return MINOR
        elseif mode == "revision" then return REVISION
        elseif mode == "build"    then return BUILD
        elseif mode == "table"    then return MAJOR, MINOR, REVISION, BUILD
        else
            error('getMudletVersion: bad argument (expected nil/"string"/"major"/"minor"/"revision"/"build"/"table", got "' .. tostring(mode) .. '")', 2)
        end
    end
end

-- Mudlet saveProfile([location]). zustand state is already auto-saved on every
-- mutation; this call additionally forces pending VFS writes (and any debounced
-- SQL snapshots) through to IndexedDB / the linked folder. The flush itself is
-- async fire-and-forget — failures surface in console.warn rather than the
-- return tuple.
function saveProfile(location)
    local path = __mudix_saveProfile(location)
    return true, path
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

-- Per-script event-handler registry. wrapScript (in ScriptingEngine.ts) emits
-- code that calls __mudix_kill_script_handlers before re-registering, so
-- saving a script doesn't accumulate duplicate handlers. JS calls the same
-- helper on disable/remove via LuaRuntime.killScriptHandlers.
__mudix_script_handlers = __mudix_script_handlers or {}
function __mudix_kill_script_handlers(sid)
    local ids = __mudix_script_handlers[sid]
    if not ids then return end
    for i = 1, #ids do
        if type(killAnonymousEventHandler) == 'function' then
            pcall(killAnonymousEventHandler, ids[i])
        end
    end
    __mudix_script_handlers[sid] = nil
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
    -- Mudlet:
    --   tempTrigger(substring, fn[, expirationCount])  — literal substring match
    --   tempRegexTrigger(regex, fn[, expirationCount]) — PCRE match
    -- expirationCount: positive N fires N times then auto-kills; -1/0/omitted = unlimited.
    local _sub = __mudix_tempTrigger
    function tempTrigger(pattern, fn, expirationCount)
        return _sub(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempTrigger", 2)), expirationCount)
    end
    local _re = __mudix_tempRegexTrigger
    function tempRegexTrigger(pattern, fn, expirationCount)
        return _re(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempRegexTrigger", 2)), expirationCount)
    end
end

do
    local _raw = __mudix_tempKey
    -- Mudlet tempKey([modifier,] keyCode, fn). The 2-arg form omits the
    -- modifier (no Ctrl/Shift/Alt/Meta required); we substitute 0 to keep
    -- the JS binding signature uniform.
    function tempKey(a, b, c)
        if c == nil then
            return _raw(0, a, __mudix_register_cb(__mudix_to_fn(b, "tempKey", 2)))
        end
        return _raw(a, b, __mudix_register_cb(__mudix_to_fn(c, "tempKey", 3)))
    end
end

-- Mudlet permScript(name, parent, luaCode). mudlet-lua's permGroup invokes this
-- with a 4th positional arg ("" type filler); Lua naturally drops it.
do
    local _raw = __mudix_permScript
    function permScript(name, parent, code)
        return _raw(tostring(name or ""), tostring(parent or ""), tostring(code or ""))
    end
end

-- Mudlet permRegexTrigger(name, parent, regexes, luaCode). The 3rd arg is a
-- Lua array of regex pattern strings; flatten to \1-delimited so JS can split
-- it back (LuaTable numeric iteration over wasmoon's JS proxy is unreliable).
-- An empty/missing regex table is the documented way to create a trigger
-- folder, and is what `permGroup("name", "trigger")` ends up calling.
do
    local _raw = __mudix_permRegexTrigger
    local SEP = '\1'
    function permRegexTrigger(name, parent, regexes, code)
        local rs = {}
        if type(regexes) == 'table' then
            for _, r in ipairs(regexes) do rs[#rs + 1] = tostring(r) end
        end
        return _raw(tostring(name or ""), tostring(parent or ""), table.concat(rs, SEP), tostring(code or ""))
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
--
-- Mudlet supports both with-window and no-window forms, disambiguated by
-- argc and arg types:
--   echoPopup(text, cmds, hints)               -- 3 args, no window
--   echoPopup(text, cmds, hints, useFmt)       -- 4 args, no window (cmds is table at slot 2)
--   echoPopup(window, text, cmds, hints)       -- 4 args, with window (text is string at slot 2)
--   echoPopup(window, text, cmds, hints, fmt)  -- 5 args, full form
do
    local _raw = echoPopup
    local SEP = '\1'
    echoPopup = function(...)
        local n = select('#', ...)
        local a1, a2, a3, a4, a5 = ...
        local win, text, cmds, hints, fmt
        if n <= 2 then
            return
        elseif n == 3 then
            win, text, cmds, hints, fmt = "main", a1, a2, a3, nil
        elseif n == 4 then
            if type(a2) == 'table' then
                -- (text, cmds, hints, useFmt)
                win, text, cmds, hints, fmt = "main", a1, a2, a3, a4
            else
                -- (window, text, cmds, hints)
                win, text, cmds, hints, fmt = a1, a2, a3, a4, nil
            end
        else
            win, text, cmds, hints, fmt = a1, a2, a3, a4, a5
        end
        if not text or text == '' then return end
        local cs, hs = {}, {}
        if type(cmds) == 'table' then
            for _, c in ipairs(cmds) do cs[#cs+1] = tostring(c) end
        end
        if type(hints) == 'table' then
            for _, h in ipairs(hints) do hs[#hs+1] = tostring(h) end
        end
        return _raw(win, text, table.concat(cs, SEP), table.concat(hs, SEP), fmt)
    end
end
