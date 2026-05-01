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
    feedTriggers = __mudix_feed_triggers__,
    printerror   = __mudix_printerror__,

    windows = {
        open = function(id, options)
            options = options or {}
            __mudix_windows_open__(
                tostring(id),
                options.kind,
                options.title,
                options.position
            )
        end,
        write    = __mudix_windows_write__,
        clear    = __mudix_windows_clear__,
        setTitle = __mudix_windows_set_title__,
        close    = __mudix_windows_close__,
        has      = __mudix_windows_has__,
    },

    timers = {
        after = __mudix_temp_timer__,
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
send         = __mudix_send__
echo         = __mudix_echo__
cecho        = __mudix_cecho__
decho        = __mudix_decho__
hecho        = __mudix_hecho__
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
