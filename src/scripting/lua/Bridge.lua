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

-- Mudlet getUserWindowSize(name) → width, height when the window exists, or
-- (nil, errMsg) when it doesn't. JS returns `nil` for the miss case.
function getUserWindowSize(name)
    local t = __getUserWindowSize(name)
    if t == nil then
        return nil, "userwindow \"" .. tostring(name) .. "\" not found"
    end
    return t[0], t[1]
end

-- Mudlet getRoomChar(id) → symbol string on success (may be empty when no
-- symbol is set), or (nil, errMsg) when the room id doesn't resolve.
function getRoomChar(id)
    local v = __getRoomChar(id)
    if v == nil then return nil, "no such room id" end
    return v
end

-- Mudlet setFontSize / getFontSize / setFont / getFont. The raw primitives
-- return false / nil for the "named window doesn't exist" miss case; here we
-- re-shape those into Mudlet's (nil, errMsg) multi-return.
function setFontSize(a, b)
    if __setFontSize(a, b) then return true end
    local name = (type(a) == 'string') and a or 'main'
    return nil, "setFontSize: window \"" .. tostring(name) .. "\" not found or invalid size"
end

function getFontSize(a)
    local v = __getFontSize(a)
    if v == nil then
        return nil, "getFontSize: window \"" .. tostring(a) .. "\" not found"
    end
    return v
end

function setFont(a, b)
    if __setFont(a, b) then return true end
    local name = (b ~= nil) and a or 'main'
    return nil, "setFont: window \"" .. tostring(name) .. "\" not found"
end

function getFont(a)
    local v = __getFont(a)
    if v == nil then
        return nil, "getFont: window \"" .. tostring(a) .. "\" not found"
    end
    return v
end

-- Mudlet removeCommandLineMenuEvent([cmdLineName,] uniqueName) → true on
-- success, (false, errMsg) when no entry exists with that uniqueName.
function removeCommandLineMenuEvent(a, b)
    if __removeCommandLineMenuEvent(a, b) then return true end
    local name = (b ~= nil) and b or a
    return false, "no command-line menu event named \"" .. tostring(name) .. "\""
end

-- Mudlet getBackgroundColor([windowName]) → r, g, b, a on success;
-- (nil, errMsg) when the named window doesn't exist. JS hands back a
-- 0-indexed [r, g, b, a] array or `nil` for the miss case.
function getBackgroundColor(windowName)
    local t = __getBackgroundColor(windowName)
    if t == nil then
        return nil, "window \"" .. tostring(windowName) .. "\" not found"
    end
    return t[0], t[1], t[2], t[3]
end

-- Mudlet windowType(name) → "main"/"label"/"miniconsole"/"userwindow", or
-- (nil, errMsg) when the named window doesn't resolve.
function windowType(name)
    local k = __windowType(name)
    if k == nil then
        return nil, "window/label \"" .. tostring(name) .. "\" not found"
    end
    return k
end

-- Mudlet getCurrentLine([window]) → line text, or (nil, errMsg) when the named
-- window doesn't exist. JS returns `nil` only for that miss case (the main
-- window always resolves, may simply have an empty current line).
function getCurrentLine(windowName)
    local v = __getCurrentLine(windowName)
    if v == nil then
        return nil, "window \"" .. tostring(windowName) .. "\" not found"
    end
    return v
end

-- Mudlet getCustomEnvColor(envID). JS returns nil for unknown IDs (matches
-- Mudlet) and a 0-indexed [r,g,b,a] array otherwise.
function getCustomEnvColor(envId)
    local t = __getCustomEnvColor(envId)
    if t == nil then return nil end
    return t[0], t[1], t[2], t[3]
end

-- Mudlet getSelection([windowName]) → text, start, length on success;
-- nil, "no selection" otherwise. JS hands back a 0-indexed array or nil.
function getSelection(windowName)
    local t = __getSelection(windowName)
    if t == nil then return nil, "no selection" end
    return t[0], t[1], t[2]
end

-- Mudlet getMapUserData(key). Returns the stored value on success or
-- (false, errMsg) when the key isn't set.
function getMapUserData(key)
    local v = __getMapUserData(key)
    if v == nil then return false, "no such map user data key" end
    return v
end

-- Mudlet getRoomUserData(id, key [, fullErr]). Default form returns "" when
-- either the room or the key is missing (so scripts can safely concatenate
-- the result). With `fullErr=true` the two miss cases are distinguishable:
--   room missing → (false, "room with given id not found")
--   key missing  → (false, "no such room user data key")
function getRoomUserData(id, key, fullErr)
    local r = __getRoomUserData(id, key)
    if type(r) == 'table' then
        if r.value ~= nil then return r.value end
        if fullErr then
            if r.miss == 'room' then
                return false, "room with given id ('" .. tostring(r.id or id) .. "') not found"
            end
            return false, "no such room user data key ('" .. tostring(r.key or key) .. "')"
        end
        return ""
    end
    return r or ""
end

-- Mudlet getRoomName(id) → name string on success, (false, errMsg) on miss.
function getRoomName(id)
    local n = __getRoomName(id)
    if n == nil then return false, "room with given id not found" end
    return n
end

-- Mudlet getRoomHashByID(id) → hash string on success, (false, errMsg) when
-- the room is missing or has no hash assigned.
function getRoomHashByID(id)
    local h = __getRoomHashByID(id)
    if h == nil then return false, "no hash for given room id" end
    return h
end

-- Mudlet deleteLabel(name) → true on success, (false, errMsg) when the label
-- doesn't exist.
function deleteLabel(name)
    if __deleteLabel(name) then return true end
    return false, "label \"" .. tostring(name) .. "\" does not exist"
end

-- Mudlet HTTP APIs: every call dispatches a fire-and-forget background
-- request and immediately returns (true, url). Completion/failure is
-- reported via sysXxxHttp* events. The wrappers below add the (true, url)
-- tuple over the `__`-prefixed JS primitives.
function downloadFile(saveTo, url)
    __downloadFile(saveTo, url)
    return true, url
end

function getHTTP(url, headers)
    __getHTTP(url, headers)
    return true, url
end

function postHTTP(data, url, headers, file)
    __postHTTP(data, url, headers, file)
    return true, url
end

function putHTTP(data, url, headers, file)
    __putHTTP(data, url, headers, file)
    return true, url
end

function deleteHTTP(url, headers)
    __deleteHTTP(url, headers)
    return true, url
end

function customHTTP(method, data, url, headers, file)
    __customHTTP(method, data, url, headers, file)
    return true, url
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
-- SQL snapshots) through to IndexedDB / the linked folder. Synchronous failure
-- (no VFS available) returns (nil, errMsg). Async flush errors raise the
-- `sysSaveProfileError` event so callers can subscribe for the failure.
function saveProfile(location)
    local r = __mudix_saveProfile(location)
    if type(r) == 'table' then
        local ok = r[0]; if ok == nil then ok = r[1] end
        local val = r[1]; if r[0] == nil then val = r[2] end
        if ok == false then return nil, val end
        return true, val
    end
    -- Fallback for older runtime shape.
    return true, r or ''
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
-- Variant for callbacks that receive a single argument (label mouse events
-- carry a {button, x, y, ...} table). JS sets __mudix_cb_arg before invoking.
function __mudix_dispatch_cb_arg(id)
    local fn = __mudix_cb[id]
    if fn then return fn(__mudix_cb_arg) end
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

-- Mudlet's label-event setters all share a shape: name + (function | code |
-- nil) + optional trailing args that get baked into the closure. The JS side
-- (LuaRuntime.setLabelCb) tracks the prior cb id per slot and frees it on
-- rebind so handlers don't leak in __mudix_cb. cb id 0 means "clear".
do
    local function bind(name, who, fn, raw, ...)
        if fn == nil then return raw(name, 0) end
        local f = __mudix_to_fn(fn, who, 2)
        if select('#', ...) > 0 then
            local trailing = {...}
            local inner = f
            f = function(event) return inner(event, unpack(trailing)) end
        end
        return raw(name, __mudix_register_cb(f))
    end

    local _click = __mudix_setLabelClickCallback
    function setLabelClickCallback(name, fn, ...)
        return bind(name, "setLabelClickCallback", fn, _click, ...)
    end

    local _dblclick = __mudix_setLabelDoubleClickCallback
    function setLabelDoubleClickCallback(name, fn, ...)
        return bind(name, "setLabelDoubleClickCallback", fn, _dblclick, ...)
    end

    local _release = __mudix_setLabelReleaseCallback
    function setLabelReleaseCallback(name, fn, ...)
        return bind(name, "setLabelReleaseCallback", fn, _release, ...)
    end

    local _move = __mudix_setLabelMoveCallback
    function setLabelMoveCallback(name, fn, ...)
        return bind(name, "setLabelMoveCallback", fn, _move, ...)
    end

    local _enter = __mudix_setLabelOnEnter
    function setLabelOnEnter(name, fn, ...)
        return bind(name, "setLabelOnEnter", fn, _enter, ...)
    end

    local _leave = __mudix_setLabelOnLeave
    function setLabelOnLeave(name, fn, ...)
        return bind(name, "setLabelOnLeave", fn, _leave, ...)
    end

    local _wheel = __mudix_setLabelWheelCallback
    function setLabelWheelCallback(name, fn, ...)
        return bind(name, "setLabelWheelCallback", fn, _wheel, ...)
    end
end

-- Mudlet setCmdLineAction([cmdLineName,] fn, [args...]). The cmdLineName arg
-- targets a specific command bar; mudix has only one, so we tolerate either
-- shape — strings as the leading arg are dropped, functions become the
-- handler. The action receives the typed text plus any trailing varargs.
do
    local _set = __mudix_setCmdLineAction
    local _reset = __mudix_resetCmdLineAction
    function setCmdLineAction(...)
        local n = select('#', ...)
        if n == 0 then
            error("setCmdLineAction: missing function argument", 2)
        end
        local first = select(1, ...)
        local fn, extras
        if type(first) == 'string' then
            -- (cmdLineName, fn, ...) — drop the name.
            fn = select(2, ...)
            extras = { select(3, ...) }
        else
            fn = first
            extras = { select(2, ...) }
        end
        if fn == nil then
            return _set(0)
        end
        local f = __mudix_to_fn(fn, "setCmdLineAction", 1)
        if #extras > 0 then
            local trailing = extras
            local inner = f
            f = function(text) return inner(text, unpack(trailing)) end
        end
        return _set(__mudix_register_cb(f))
    end
    function resetCmdLineAction(_cmdLineName)
        return _reset()
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
