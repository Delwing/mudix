local _handlers = {}

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

-- Dispatches a named event to all registered Lua handlers.
-- Called from JavaScript via emitEvent().
function __dispatch__(event, ...)
    if event == 'gmcp' then
        local path, value = ...
        _gmcp_set(path, value)
    end
    local hs = _handlers[event]
    if not hs then return end
    for _, fn in ipairs(hs) do
        local ok, err = pcall(fn, ...)
        if not ok then
            mudix.printerror('[lua] ' .. tostring(err))
        end
    end
end

-- Lua 5.1 compat
unpack = table.unpack

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
tempKey      = __mudix_temp_key__
killKey      = __mudix_kill_key__
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

-- raiseEvent: fire a named event to all registered Lua handlers
function raiseEvent(name, ...)
    __dispatch__(name, ...)
end

-- registerAnonymousEventHandler: Mudlet-compatible alias for mudix.on
function registerAnonymousEventHandler(name, fn)
    mudix.on(name, fn)
end

-- Window shortcuts
clearWindow  = __mudix_clear_window__
hideWindow   = __mudix_windows_hide__
showWindow   = __mudix_windows_show__

-- display: pretty-print a value to the output window
function display(what, indent, seen)
    indent = indent or ""
    seen = seen or {}
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
                display(v, indent .. "  ", seen)
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

-- multiline trigger context globals — populated by the trigger engine when a multiline
-- trigger fires. Initialised here so scripts can safely call table.size(multimatches).
multimatches = multimatches or {}
