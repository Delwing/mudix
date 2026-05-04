local _handlers = {}
local _anon_registry = {}  -- id → { event, fn }
local _anon_next_id  = 1

-- GMCP state table — populated automatically as packets arrive.
gmcp = {}

local function _gmcp_set(path, value)
    local parts = {}
    for part in path:gmatch('[^.]+') do
        table.insert(parts, part)
    end
    if #parts == 0 then return end
    local t = gmcp
    for i = 1, #parts - 1 do
        if type(t[parts[i]]) ~= 'table' then
            t[parts[i]] = {}
        end
        t = t[parts[i]]
    end
    t[parts[#parts]] = value
end

mudix = {
    send         = __mudix_send__,
    print        = __mudix_print__,
    echo         = __mudix_echo__,
    cecho        = __mudix_cecho__,
    decho        = __mudix_decho__,
    hecho        = __mudix_hecho__,
    fg           = __mudix_fg__,
    bg           = __mudix_bg__,
    resetFormat  = __mudix_reset_format__,
    feedTriggers  = __mudix_feed_triggers__,
    printerror    = __mudix_printerror__,
    deleteLine    = __mudix_delete_line__,
    appendCmdLine = __mudix_append_cmd_line__,
    setCmdLine    = __mudix_set_cmd_line__,

    windows = {
        open = function(id, options)
            options = options or {}
            -- Pass autoDock and ignoreHint as strings to avoid boolean marshalling issues.
            local autoDockStr   = options.autoDock   == nil and nil or (options.autoDock   and 'true' or 'false')
            local ignoreHintStr = options.ignoreHint == nil and nil or (options.ignoreHint and 'true' or nil)
            __mudix_windows_open__(
                tostring(id),
                options.kind,
                options.title,
                options.position,
                autoDockStr,
                options.dockingArea,
                ignoreHintStr
            )
        end,
        write    = __mudix_windows_write__,
        clear    = __mudix_windows_clear__,
        setTitle = __mudix_windows_set_title__,
        close    = __mudix_windows_close__,
        has      = __mudix_windows_has__,
    },

    timers = {
        -- after(seconds, fn)        -- one-shot
        -- after(seconds, fn, true)  -- repeating until killTimer()
        after = __mudix_temp_timer__,
        kill  = __mudix_kill_timer__,
    },

    keys = {
        -- add(key, modifiers, fn)  e.g. add("F1", nil, fn) or add("F2", {"ctrl"}, fn)
        add    = __mudix_temp_key__,
        remove = __mudix_kill_key__,
    },

    aliases = {
        add    = __mudix_temp_alias__,
        remove = __mudix_kill_alias__,
    },

    triggers = {
        add    = __mudix_temp_trigger__,
        remove = __mudix_kill_trigger__,
    },

    on = function(event, fn)
        _handlers[event] = _handlers[event] or {}
        table.insert(_handlers[event], fn)
    end,

    off = function(event, fn)
        local hs = _handlers[event]
        if not hs then return end
        for i = #hs, 1, -1 do
            if hs[i] == fn then table.remove(hs, i) end
        end
    end,
}

local function _resolve_fn(fn)
    if type(fn) ~= 'string' then return fn end
    -- Support dotted paths like "map.eventHandler"
    local obj = _G
    for part in fn:gmatch('[^.]+') do
        if type(obj) ~= 'table' then return nil end
        obj = obj[part]
    end
    return obj
end

-- Dispatches a named event to all registered Lua handlers.
-- Called from JavaScript via emitEvent().
function __dispatch__(event, ...)
    -- Lua 5.1 compat: Mudlet scripts use `arg` inside event handlers.
    arg = {...}

    if event == 'gmcp' then
        local path, value = ...
        _gmcp_set(path, value)
        local path_hs = _handlers['gmcp.' .. path]
        if path_hs then
            for _, fn in ipairs(path_hs) do
                fn = _resolve_fn(fn)
                if type(fn) == 'function' then
                    local ok, err = xpcall(fn, debug.traceback, value)
                    if not ok then
                        mudix.printerror('[lua] ' .. tostring(err))
                    end
                end
            end
        end
    end
    local hs = _handlers[event]
    if not hs then return end
    for _, fn in ipairs(hs) do
        fn = _resolve_fn(fn)
        if type(fn) == 'function' then
            local ok, err = xpcall(fn, debug.traceback, event, ...)
            if not ok then
                mudix.printerror('[lua] ' .. tostring(err))
            end
        end
    end

    arg = nil
end

-- Lua 5.1 compat
unpack      = table.unpack
loadstring  = function(s, name) return load(s, name, 't', _ENV) end

-- Mudlet-compatible globals
-- openUserWindow(name, [restoreLayout=true], [autoDock=true], [dockingArea="r"])
-- dockingArea short codes (Mudlet-compatible):
--   "f" or false = floating   "t" = top   "b" = bottom   "r" = right   "l" = left
-- Default docking area is "r" (right) when autoDock is true and no area is given.
function openUserWindow(name, restoreLayout, autoDock, dockingArea)
    if restoreLayout == nil then restoreLayout = true end
    if autoDock      == nil then autoDock      = true  end

    -- Normalise dockingArea to a full side name (or nil = floating)
    local areaMap = { f='main', t='top', b='bottom', r='right', l='left',
                      ['false']='main', top='top', bottom='bottom',
                      right='right', left='left', main='main' }
    local areaNorm
    if dockingArea == false or dockingArea == 'f' then
        autoDock  = false        -- "f" / false explicitly means float
    elseif type(dockingArea) == 'string' then
        areaNorm  = areaMap[dockingArea]
    elseif autoDock then
        areaNorm  = 'right'      -- Mudlet default: dock to right when no area given
    end

    mudix.windows.open(name, {
        kind        = 'text',
        title       = name,
        autoDock    = autoDock,
        dockingArea = areaNorm,
        ignoreHint  = not restoreLayout,
    })
end

function clearWindow(name)
    mudix.windows.clear(name)
end

function setWindowTitle(name, title)
    mudix.windows.setTitle(name, title)
end

send         = __mudix_send__
printError   = __mudix_printerror__

-- echo/cecho/decho/hecho: Mudlet allows an optional first arg as window name.
--   echo("text")               → main output (plain)
--   echo("windowName", "text") → named window (plain ANSI)
--   cecho("text")              → main output (Mudlet color tags)
--   cecho("windowName","text") → named window (Mudlet color tags, parsed before write)
local function _dispatch(win_fn, main_fn, ...)
    local args = {...}
    if #args >= 2 and type(args[1]) == "string" and type(args[2]) == "string" then
        win_fn(args[1], args[2])
    else
        main_fn(args[1] or "")
    end
end

echo  = function(...) _dispatch(__mudix_windows_write__,  __mudix_echo__,  ...) end
cecho = function(...) _dispatch(__mudix_windows_cecho__,  __mudix_cecho__, ...) end
decho = function(...) _dispatch(__mudix_windows_decho__,  __mudix_decho__, ...) end
hecho = function(...) _dispatch(__mudix_windows_hecho__,  __mudix_hecho__, ...) end
fg           = __mudix_fg__
bg           = __mudix_bg__
resetFormat  = __mudix_reset_format__
feedTriggers = __mudix_feed_triggers__
tempTimer    = __mudix_temp_timer__
killTimer    = __mudix_kill_timer__
tempAlias    = __mudix_temp_alias__
killAlias    = __mudix_kill_alias__
tempTrigger  = __mudix_temp_trigger__
killTrigger  = __mudix_kill_trigger__
killKey      = __mudix_kill_key__

-- tempKey(modifier, key, fn) — Mudlet-compatible.
-- modifier: Qt::KeyboardModifiers bitflag (0 = no modifier, or bitwise OR of flags below).
-- key: Qt::Key integer OR a web KeyboardEvent.code string (e.g. "F1", "KeyA", "ArrowUp").
-- Supported modifier flags:
--   Qt.ShiftModifier   = 33554432  (0x02000000)
--   Qt.ControlModifier = 67108864  (0x04000000)
--   Qt.AltModifier     = 134217728 (0x08000000)
--   Qt.MetaModifier    = 268435456 (0x10000000)
do
    local _qt_key_map = {
        [16777216] = 'Escape',      [16777217] = 'Tab',         [16777219] = 'Backspace',
        [16777220] = 'Enter',       [16777221] = 'NumpadEnter', [16777222] = 'Insert',
        [16777223] = 'Delete',      [16777224] = 'Pause',       [16777225] = 'PrintScreen',
        [16777232] = 'Home',        [16777233] = 'End',
        [16777234] = 'ArrowLeft',   [16777235] = 'ArrowUp',
        [16777236] = 'ArrowRight',  [16777237] = 'ArrowDown',
        [16777238] = 'PageUp',      [16777239] = 'PageDown',
        [16777264] = 'F1',  [16777265] = 'F2',  [16777266] = 'F3',  [16777267] = 'F4',
        [16777268] = 'F5',  [16777269] = 'F6',  [16777270] = 'F7',  [16777271] = 'F8',
        [16777272] = 'F9',  [16777273] = 'F10', [16777274] = 'F11', [16777275] = 'F12',
        [32] = 'Space',
    }
    for i = 48, 57 do _qt_key_map[i] = 'Digit' .. string.char(i) end
    for i = 65, 90 do _qt_key_map[i] = 'Key'   .. string.char(i) end

    local _QT_SHIFT = 33554432   -- 0x02000000
    local _QT_CTRL  = 67108864   -- 0x04000000
    local _QT_ALT   = 134217728  -- 0x08000000
    local _QT_META  = 268435456  -- 0x10000000

    function tempKey(modifier, key, fn)
        local mods = {}
        if type(modifier) == 'number' and modifier ~= 0 then
            if modifier & _QT_SHIFT ~= 0 then mods[#mods+1] = 'shift' end
            if modifier & _QT_CTRL  ~= 0 then mods[#mods+1] = 'ctrl'  end
            if modifier & _QT_ALT   ~= 0 then mods[#mods+1] = 'alt'   end
            if modifier & _QT_META  ~= 0 then mods[#mods+1] = 'meta'  end
        end
        local webKey = type(key) == 'number' and (_qt_key_map[key] or ('Key_' .. key)) or key
        return __mudix_temp_key__(webKey, #mods > 0 and mods or nil, fn)
    end
end
deleteLine   = __mudix_delete_line__
appendCmdLine = __mudix_append_cmd_line__
setCmdLine   = __mudix_set_cmd_line__

-- String utilities (Mudlet-compatible)
function string.starts(s, prefix)
    return s:sub(1, #prefix) == prefix
end

function string.ends(s, suffix)
    if suffix == '' then return true end
    return s:sub(-#suffix) == suffix
end

function string.trim(s)
    return s:match('^%s*(.-)%s*$')
end

function string.split(str, sep)
    if sep == nil or sep == '' then return { str } end
    local result = {}
    local i = 1
    local len = #str
    local sepLen = #sep
    while i <= len + 1 do
        local j = str:find(sep, i, true)
        if j then
            table.insert(result, str:sub(i, j - 1))
            i = j + sepLen
        else
            table.insert(result, str:sub(i))
            break
        end
    end
    return result
end

function string.contains(s, sub)
    return s:find(sub, 1, true) ~= nil
end

-- Table utilities (Mudlet-compatible)
function table.contains(t, val)
    for _, v in pairs(t) do
        if v == val then return true end
    end
    return false
end

function table.size(t)
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    return count
end

-- sendAll: send multiple commands at once
function sendAll(...)
    for _, cmd in ipairs({...}) do
        send(cmd)
    end
end

-- raiseEvent: fire a named event to all registered Lua handlers; returns true (Mudlet-compatible)
function raiseEvent(name, ...)
    __dispatch__(name, ...)
    return true
end

-- registerAnonymousEventHandler / killAnonymousEventHandler (Mudlet-compatible)
function registerAnonymousEventHandler(name, fn)
    local id = _anon_next_id
    _anon_next_id = _anon_next_id + 1
    _handlers[name] = _handlers[name] or {}
    table.insert(_handlers[name], fn)
    _anon_registry[id] = { event = name, fn = fn }
    return id
end

function killAnonymousEventHandler(id)
    local entry = _anon_registry[id]
    if not entry then return false end
    _anon_registry[id] = nil
    local hs = _handlers[entry.event]
    if hs then
        for i = #hs, 1, -1 do
            if hs[i] == entry.fn then
                table.remove(hs, i)
                break
            end
        end
    end
    return true
end

-- Window shortcuts
clearWindow  = __mudix_clear_window__
hideWindow   = __mudix_windows_hide__
showWindow   = __mudix_windows_show__
centerview         = __mudix_centerview__
getRoomIDbyHash    = __mudix_get_room_id_by_hash__

-- ── Map API (Mudlet-compatible) ───────────────────────────────────────────────
createRoomID        = __map_create_room_id__
addRoom             = __map_add_room__
deleteRoom          = __map_delete_room__
roomExists          = __map_room_exists__
getRoomName         = __map_get_room_name__
setRoomName         = __map_set_room_name__
getRoomArea         = __map_get_room_area__
setRoomArea         = __map_set_room_area__
getRoomCoordinates  = __map_get_room_coordinates__
setRoomCoordinates  = __map_set_room_coordinates__
getRoomsByPosition  = __map_get_rooms_by_position__
setRoomIDbyHash     = __map_set_room_id_by_hash__
getRoomHashByID     = __map_get_room_hash_by_id__
getRoomExits        = __map_get_room_exits__
setExit             = __map_set_exit__
getExitStubs        = __map_get_exit_stubs__
setExitStub         = __map_set_exit_stub__
addSpecialExit      = __map_add_special_exit__
removeSpecialExit   = __map_remove_special_exit__
getSpecialExitsSwap = __map_get_special_exits_swap__
getDoors            = __map_get_doors__
setDoor             = __map_set_door__
getRoomUserData     = __map_get_user_data__
setRoomUserData     = __map_set_user_data__
getRoomEnv          = __map_get_room_env__
setRoomEnv          = __map_set_room_env__
getRoomChar         = __map_get_room_char__
setRoomChar         = __map_set_room_char__
addAreaName         = __map_add_area_name__
deleteArea          = __map_delete_area__
getAreaTable        = __map_get_area_table__
getRoomAreaName     = __map_get_room_area_name__
setAreaName         = __map_set_area_name__
getAreaRooms        = __map_get_area_rooms__

-- display(...): Mudlet-compatible pretty-print; each argument is printed on its own line.
local function _display_one(what, indent, seen)
    local t = type(what)
    if t == "table" then
        if seen[what] then
            echo("{...}\n")
            return
        end
        seen[what] = true
        echo("{\n")
        for k, v in pairs(what) do
            local key = type(k) == "number" and tostring(k) or ('"' .. tostring(k) .. '"')
            echo(indent .. "  [" .. key .. "] = ")
            if type(v) == "table" then
                _display_one(v, indent .. "  ", seen)
            else
                local val = type(v) == "string" and ('"' .. tostring(v) .. '"') or tostring(v)
                echo(val .. "\n")
            end
        end
        echo(indent .. "}\n")
    else
        local val = t == "string" and ('"' .. what .. '"') or tostring(what)
        echo(val .. "\n")
    end
end

function display(...)
    for i = 1, select('#', ...) do
        _display_one(select(i, ...), "", {})
    end
end

-- os.setlocale is not available in fengari (browser has no OS locale).
-- Stub it so Mudlet's stdlib.lua can load without error.
if os then
    os.setlocale = os.setlocale or function() return "C" end
end

-- utf8 compatibility: Mudlet extends the standard utf8 library with gsub/find/match.
-- fengari provides the Lua 5.3 utf8 library (char/codepoint/codes/len/offset) but not
-- the string-like functions, so we fill those in with string equivalents.
if type(utf8) ~= 'table' then utf8 = {} end
utf8.gsub  = utf8.gsub  or string.gsub
utf8.find  = utf8.find  or string.find
utf8.match = utf8.match or string.match

-- Trigger-context functions backed by C implementations in LuaRuntime.
getCurrentLine   = __mudix_get_current_line__
isPrompt         = __mudix_is_prompt__
tempLineTrigger  = __mudix_temp_line_trigger__
insertText       = __mudix_insert_text__
moveCursorUp     = __mudix_move_cursor_up__
moveCursorDown   = __mudix_move_cursor_down__
moveCursor       = __mudix_move_cursor__
getLineNumber    = __mudix_get_line_number__
getLineCount     = __mudix_get_line_count__
getColumnNumber  = __mudix_get_column_number__
getLines         = __mudix_get_lines__
selectString     = __mudix_select_string__
selectSection    = __mudix_select_section__
deselect         = __mudix_deselect__

-- multiline trigger context globals — populated by the trigger engine when a multiline
-- trigger fires. Initialised here so scripts can safely call table.size(multimatches).
multimatches = multimatches or {}

-- ── VFS: profile path ─────────────────────────────────────────────────────────

function getMudixProfilePath()
    return __vfs_profile_path__()
end

getMudletHomeDir = getMudixProfilePath

function loadRawFile(path)
    local f, err = io.open(path, 'r')
    if not f then return nil, err end
    local content = f:read('*a')
    f:close()
    return content
end

-- ── VFS: loadfile / dofile ────────────────────────────────────────────────────

function loadfile(filename, mode, env)
    if not filename then
        return nil, "loadfile without filename not supported"
    end
    local content, err = __vfs_read_file__(tostring(filename))
    if not content then return nil, err end
    return load(content, '@' .. filename, mode, env)
end

function dofile(filename)
    if not filename then
        error("dofile without filename not supported", 2)
    end
    local fn, err = loadfile(filename)
    if not fn then error(err, 2) end
    return fn()
end

-- ── VFS: package.path and searcher ────────────────────────────────────────────

do
    local _p = __vfs_profile_path__()
    if _p ~= '' then
        package.path = _p .. '/?.lua;' ..
                       _p .. '/?/init.lua;' ..
                       _p .. '/packages/?.lua;' ..
                       _p .. '/packages/?/init.lua'
    end

    -- Override package.searchpath to use VFS (the C-level one uses real io.open)
    package.searchpath = function(name, path, sep, rep)
        sep = sep or '.'
        rep = rep or '/'
        local safesep = sep:gsub('[%(%)%.%%%+%-%*%?%[%^%$]', '%%%0')
        local modpath = name:gsub(safesep, rep)
        local tried = {}
        for template in (path or ''):gmatch('[^;]+') do
            local filename = template:gsub('%?', modpath)
            if __vfs_exists__(filename) then return filename end
            tried[#tried + 1] = '\n\tno VFS file: ' .. filename
        end
        return nil, table.concat(tried)
    end

    -- Replace the file-based searcher so require uses our VFS loadfile
    if package.searchers then
        package.searchers[2] = function(name)
            local filename, err = package.searchpath(name, package.path)
            if not filename then return err end
            local fn, lerr = loadfile(filename)
            if not fn then return '\n\t' .. tostring(lerr) end
            return fn, filename
        end
    end
end

-- ── VFS: io ───────────────────────────────────────────────────────────────────

do
    local _handles = {}

    local function _make_handle(id)
        local f = {}
        local mt = {
            __index = {
                read = function(self, fmt)
                    return __vfs_io_read__(id, fmt)
                end,
                write = function(self, ...)
                    local ok, err = __vfs_io_write__(id, ...)
                    if not ok then return nil, err end
                    return self
                end,
                close = function(self)
                    _handles[id] = nil
                    return __vfs_io_close__(id)
                end,
                seek = function(self, whence, offset)
                    return __vfs_io_seek__(id, whence or 'cur', offset or 0)
                end,
                lines = function(self)
                    return function()
                        local line = __vfs_io_read__(id, '*l')
                        if line == nil then self:close() end
                        return line
                    end
                end,
                flush = function(self) return self end,
            },
            __tostring = function() return 'file (0x' .. string.format('%x', id) .. ')' end,
        }
        setmetatable(f, mt)
        _handles[id] = f
        return f
    end

    io = {
        open = function(filename, mode)
            local id, err = __vfs_io_open__(tostring(filename), mode or 'r')
            if not id then return nil, err end
            return _make_handle(id)
        end,

        close = function(file)
            if file then return file:close() end
        end,

        lines = function(filename, fmt)
            if not filename then
                error("io.lines without filename not supported", 2)
            end
            fmt = fmt or '*l'
            local f, err = io.open(filename, 'r')
            if not f then error(err, 2) end
            return function()
                local val = f:read(fmt)
                if val == nil then f:close() end
                return val
            end
        end,

        read = function()
            error("io.read (stdin) is not supported", 2)
        end,

        write = function()
            error("io.write (stdout) not supported; use echo()", 2)
        end,

        type = function(obj)
            if type(obj) ~= 'table' then return nil end
            for id, h in pairs(_handles) do
                if h == obj then return 'file' end
            end
            return 'closed file'
        end,
    }
end

-- moveCursorEnd: Mudlet-compatible cursor-to-end-of-line (stub)
function moveCursorEnd(win) end

-- setUnderline: emit ANSI underline on/off
function setUnderline(bool)
    if bool then
        echo("\27[4m")
    else
        echo("\27[24m")
    end
end

-- openWebPage: open URL in a new browser tab
function openWebPage(url)
    __mudix_openWebPage__(url)
end

-- echoLink: Mudlet-compatible clickable text link
-- Mudlet: echoLink([window,] text, command, tooltip [, useCurrentFormatting])
function echoLink(...)
    local args = {...}
    local n = select('#', ...)
    local text, cmd, tooltip
    if n >= 5 or (n == 4 and type(args[4]) == 'string') then
        -- windowed form: window, text, command, tooltip [, useCurrentFmt]
        text    = args[2] or ''
        cmd     = args[3] or ''
        tooltip = args[4] or ''
    else
        -- main form: text, command, tooltip [, useCurrentFmt]
        text    = args[1] or ''
        cmd     = args[2] or ''
        tooltip = args[3] or ''
    end
    __mudix_echoLink__(text, cmd, tooltip)
end

-- cechoLink: like echoLink but color-tagged text (cecho format); outputs colored text as clickable link
function cechoLink(...)
    local args = {...}
    local n = select('#', ...)
    local text, cmd, tooltip
    if n >= 5 or (n == 4 and type(args[4]) == 'string') then
        text    = args[2] or ''
        cmd     = args[3] or ''
        tooltip = args[4] or ''
    else
        text    = args[1] or ''
        cmd     = args[2] or ''
        tooltip = args[3] or ''
    end
    -- Output the colored text via cecho (no click support yet for multi-color links)
    cecho(text)
end

-- io.exists: Mudlet-compatible file/directory existence check
io.exists = function(path)
    return lfs.attributes(path) ~= nil
end

-- rex: PCRE-compatible regex module backed by JavaScript RegExp
-- lrexlib convention: non-participating optional captures return false (not nil)
rex = {
    match = function(subject, pattern, init)
        return __rex_match__(subject, pattern, init)
    end,
    find = function(subject, pattern, init)
        return __rex_find__(subject, pattern, init)
    end,
    new = function(pattern)
        local p = pattern
        return setmetatable({}, { __index = {
            match = function(self, subject, init)
                return __rex_match__(subject, p, init)
            end,
            find = function(self, subject, init)
                return __rex_find__(subject, p, init)
            end,
        }})
    end,
}

-- ── VFS: lfs ─────────────────────────────────────────────────────────────────

lfs = {
    mkdir = function(path)
        local ok, err = __vfs_lfs_mkdir__(tostring(path))
        if not ok then return nil, err end
        return true
    end,

    rmdir = function(path)
        local ok, err = __vfs_lfs_rmdir__(tostring(path))
        if not ok then return nil, err end
        return true
    end,

    dir = function(path)
        local entries, err = __vfs_lfs_dir__(tostring(path))
        if not entries then
            error(tostring(err), 2)
        end
        local all = {'.', '..'}
        for _, e in ipairs(entries) do all[#all + 1] = e end
        local i = 0
        return function()
            i = i + 1
            return all[i]
        end
    end,

    attributes = function(path, attr)
        local info, err = __vfs_lfs_attr__(tostring(path))
        if not info then return nil, err end
        if attr ~= nil then return info[attr] end
        return info
    end,

    currentdir = function()
        return __vfs_lfs_currentdir__()
    end,

    chdir = function(path)
        local ok, err = __vfs_lfs_chdir__(tostring(path))
        if not ok then return nil, err end
        return true
    end,

    touch = function(path)
        if not __vfs_exists__(tostring(path)) then
            local f, err = io.open(path, 'w')
            if not f then return nil, err end
            f:close()
        end
        return true
    end,
}
