matches = {}; multimatches = {}

-- Mudlet's getPath populates these globals (cleared on every call). Predeclare
-- them as empty tables so user code reading them before any getPath call
-- doesn't crash on nil-indexing — Mudlet's C++ side leaves them undefined
-- until first call but most scripts assume they exist.
speedWalkPath, speedWalkDir, speedWalkWeight = {}, {}, {}

-- Mudlet getPath(from, to) — A* over the map graph. Always clears the three
-- speedWalk* globals; on success repopulates them 1-indexed and returns
-- (true, totalWeight). On argument-validation failure returns (false, errMsg);
-- on no-path returns (false, -1, errMsg) — matching Mudlet's multi-return.
function getPath(from, to)
    speedWalkPath, speedWalkDir, speedWalkWeight = {}, {}, {}
    local res = __getPath(from, to)
    if type(res) == 'string' then
        return false, res
    end
    if type(res) ~= 'table' then
        return false, -1,
            "getPath: no path found from the roomID " .. tostring(from)
            .. " to roomID " .. tostring(to) .. "!"
    end
    -- JS hands the three step lists over as 0-indexed arrays (wasmoon convention).
    local p, d, w = res.path, res.dirs, res.weights
    if type(p) == 'table' then
        local i = 0
        while p[i] ~= nil do
            speedWalkPath[i + 1]   = p[i]
            speedWalkDir[i + 1]    = d[i]
            speedWalkWeight[i + 1] = w[i]
            i = i + 1
        end
    end
    return true, res.totalWeight or 0
end

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

-- Mudlet getConsoleBufferSize([consoleName]) → linesLimit, sizeOfBatchDeletion.
-- JS returns a 0-indexed [limit, batch] array (wasmoon convention), or nil when
-- the named console doesn't exist.
function getConsoleBufferSize(name)
    local t = __getConsoleBufferSize(name)
    if t then return t[0], t[1] end
end

-- Mudlet getConnectionInfo() → host (string), port (number), connected (bool).
-- JS returns a 0-indexed [host, port, connected] array (wasmoon convention).
function getConnectionInfo()
    local t = __getConnectionInfo()
    return t[0], t[1], t[2]
end

function getMousePosition()
    local t = __getMousePosition()
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

-- Mudlet setMiniConsoleFontSize(name, size). Mudlet returns (nil, "setting
-- font size of '<name>' failed") when the miniconsole is missing or the size
-- is invalid; the raw primitive returns false for both, so we re-shape here.
function setMiniConsoleFontSize(name, size)
    if __setMiniConsoleFontSize(name, size) then return true end
    return nil, "setting font size of '" .. tostring(name) .. "' failed"
end

function getFont(a)
    local v = __getFont(a)
    if v == nil then
        return nil, "getFont: window \"" .. tostring(a) .. "\" not found"
    end
    return v
end

-- Mudlet calcFontSize(size [, family]) | calcFontSize(windowName) → width,
-- height (pixels) of an average character cell. JS returns a 2-element array
-- (0-indexed under wasmoon) or nil for the miss case; re-shape into Mudlet's
-- multi-return on success and (nil, errMsg) on failure.
function calcFontSize(a, b)
    local t = __calcFontSize(a, b)
    if t == nil then
        if type(a) == 'string' then
            return nil, "calcFontSize: window \"" .. a .. "\" not found"
        end
        return nil, "calcFontSize: bad argument #1 (number or window name expected)"
    end
    return t[0], t[1]
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

-- Mudlet getFgColor([windowName]) / getBgColor([windowName]) → r, g, b of the
-- character at the current selection's start position. Returns no values when
-- there is no selection (so `r, g, b = getFgColor()` yields three nils, the
-- same shape Mudlet produces for out-of-bounds cursors).
function getFgColor(windowName)
    local t = __getFgColor(windowName)
    if t == nil then return end
    return t[0], t[1], t[2]
end

function getBgColor(windowName)
    local t = __getBgColor(windowName)
    if t == nil then return end
    return t[0], t[1], t[2]
end

-- Mudlet getTextFormat([windowName]) → table describing the display attributes
-- of the character at the current selection's start, or (nil, errMsg) when
-- there is no usable selection. JS returns a flat 0-indexed array of primitives
-- (see __getTextFormat); rebuild the documented table here, with 1-indexed
-- {r, g, b} foreground/background triples.
function getTextFormat(windowName)
    local t = __getTextFormat(windowName)
    if t == nil then return nil, "no character under cursor or selection" end
    return {
        bold = t[0],
        italic = t[1],
        underline = t[2],
        strikeout = t[3],
        reverse = t[4],
        overline = t[5],
        concealed = t[6],
        alternateFont = t[7],
        blinking = t[8],
        foreground = { t[9], t[10], t[11] },
        background = { t[12], t[13], t[14] },
    }
end

-- Mudlet getMapUserData(key). Returns the stored value on success or
-- (false, errMsg) when the key isn't set.
function getMapUserData(key)
    local v = __getMapUserData(key)
    if v == nil then return false, "no such map user data key" end
    return v
end

-- Mudlet getRoomUserDataKeys(id) → sequential Lua table of the user-data keys
-- stored on the room, or nil when the room does not exist. JS hands back a
-- 0-indexed array (wasmoon convention) or nil; rebuild as a 1-indexed table.
function getRoomUserDataKeys(id)
    local raw = __getRoomUserDataKeys(id)
    if raw == nil then return nil end
    local out = {}
    if type(raw) == 'table' then
        local i = 0
        while raw[i] ~= nil do
            out[#out + 1] = raw[i]
            i = i + 1
        end
        if #out == 0 then
            for _, v in ipairs(raw) do out[#out + 1] = v end
        end
    end
    return out
end

-- Mudlet getExitStubs1(id) → 1-indexed variant of getExitStubs. The base
-- `getExitStubs` binding hands back a wasmoon array (0-indexed in Lua); walk
-- it and rebuild as a 1-indexed sequence.
function getExitStubs1(id)
    local raw = getExitStubs(id)
    if raw == nil then return nil end
    local out = {}
    local i = 0
    while raw[i] ~= nil do
        out[i + 1] = raw[i]
        i = i + 1
    end
    return out
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

-- Mudlet getCustomEnvColorTable() → { [envID] = { r, g, b, a } } with the
-- inner table 1-indexed. JS hands the inner over as { r=, g=, b=, a= }; rebuild
-- as a 4-element 1-indexed array. envID keys cross the wasmoon bridge as
-- numeric strings — coerce back to number so script code that does t[i] works.
function getCustomEnvColorTable()
    local raw = __getCustomEnvColorTable()
    local out = {}
    if type(raw) == 'table' then
        for k, c in pairs(raw) do
            local id = tonumber(k)
            if id and type(c) == 'table' then
                out[id] = { c.r, c.g, c.b, c.a }
            end
        end
    end
    return out
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

-- Mudlet getStopWatches() → { [watchID] = { name, isRunning, isPersistent,
-- elapsedTime = {...} } }. JS hands ids over as stringified keys (wasmoon
-- convention); re-key via tonumber to integer ids and rebuild each record off
-- the proxy so callers never touch the wasmoon table directly.
function getStopWatches()
    local raw = __getStopWatches()
    local out = {}
    if type(raw) == 'table' then
        for k, v in pairs(raw) do
            local id = tonumber(k) or k
            local e = v.elapsedTime or {}
            out[id] = {
                name = v.name,
                isRunning = v.isRunning,
                isPersistent = v.isPersistent,
                elapsedTime = {
                    negative = e.negative,
                    days = e.days,
                    hours = e.hours,
                    minutes = e.minutes,
                    seconds = e.seconds,
                    milliSeconds = e.milliSeconds,
                    decimalSeconds = e.decimalSeconds,
                },
            }
        end
    end
    return out
end

-- Mudlet getSpecialExits(roomID [, listAllExits]) → { [exitRoomID] =
-- { [command] = "0"|"1" } }. JS hands the outer table over with stringified
-- numeric room-id keys (wasmoon convention); re-key via tonumber so callers can
-- index by integer destination room id. The inner command→lockState table is
-- rebuilt off the proxy so callers never touch the wasmoon table directly.
function getSpecialExits(roomId, listAllExits)
    local raw = __getSpecialExits(roomId, listAllExits)
    local out = {}
    if type(raw) == 'table' then
        for k, v in pairs(raw) do
            local id = tonumber(k) or k
            local inner = {}
            if type(v) == 'table' then
                for cmd, lock in pairs(v) do inner[cmd] = lock end
            end
            out[id] = inner
        end
    end
    return out
end

-- Mudlet getMapLabels(areaID) → { [labelID] = labelText }. JS hands the
-- per-area label record over with stringified numeric keys (wasmoon
-- convention); re-key via tonumber so scripts can index by integer label id
-- and pass that same id straight back into deleteMapLabel.
function getMapLabels(areaId)
    local raw = __getMapLabels(areaId)
    local out = {}
    if type(raw) == 'table' then
        for k, v in pairs(raw) do
            local id = tonumber(k)
            if id then out[id] = v end
        end
    end
    return out
end

-- Build a fresh Lua table from a JS-side label info proxy so the caller never
-- touches the wasmoon proxy directly (some proxy operations are flaky once the
-- bridge has moved on). Mirrors Mudlet's pushMapLabelPropertiesToLua key set.
local function _buildMapLabelInfo(p)
    if type(p) ~= 'table' then return nil end
    local fg = p.FgColor or {}
    local bg = p.BgColor or {}
    return {
        X = p.X, Y = p.Y, Z = p.Z,
        Width = p.Width, Height = p.Height,
        Text = p.Text,
        Pixmap = p.Pixmap,
        OnTop = p.OnTop,
        Scaling = p.Scaling,
        Temporary = p.Temporary,
        FgColor = { r = fg.r, g = fg.g, b = fg.b },
        BgColor = { r = bg.r, g = bg.g, b = bg.b },
    }
end

-- Mudlet getMapLabel(areaID, labelID|labelText). By-ID returns a flat
-- properties table; by-text returns { [labelID] = properties, ... } for every
-- matching label. Missing area or missing labelID → (false, errMsg) — matching
-- Mudlet's warnArgumentValue convention. An area with no labels at all returns
-- an empty table regardless of the lookup form.
function getMapLabel(areaId, key)
    local kt = type(key)
    if kt ~= 'number' and kt ~= 'string' then
        error('getMapLabel: bad argument #2 type (labelID as number or labelText as string expected, got ' .. kt .. '!)', 2)
    end
    if kt == 'number' and key < 0 then
        return false, 'getMapLabel: labelID ' .. tostring(key) .. ' is invalid, it must be zero or greater'
    end
    local r = __getMapLabel(areaId, key)
    if type(r) ~= 'table' then return false, 'getMapLabel: unexpected result' end
    if r.ok == false then
        if r.err == 'noarea' then
            return false, 'getMapLabel: areaID ' .. tostring(areaId) .. ' does not exist'
        end
        if r.err == 'noid' then
            return false, 'getMapLabel: labelID ' .. tostring(key) .. ' does not exist in area with areaID ' .. tostring(areaId)
        end
        return false, tostring(r.err or 'getMapLabel: failed')
    end
    if r.single then return _buildMapLabelInfo(r.single) end
    if r.multi then
        local out = {}
        if type(r.multi) == 'table' then
            for k, v in pairs(r.multi) do
                local id = tonumber(k)
                if id then out[id] = _buildMapLabelInfo(v) end
            end
        end
        return out
    end
    return {}
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

-- Mudlet getTime([asString, format]) → table or string.
--   getTime()                    → { year, month, day, hour, min, sec, msec }
--   getTime(true)                → string formatted with "hh:mm:ss.zzz"
--   getTime(true, fmt)           → string formatted with QDateTime tokens:
--     yyyy/yy, MMMM/MMM/MM/M, dddd/ddd/dd/d, HH/H (24h), hh/h (12h if AP present
--     in format, otherwise 24h), mm/m, ss/s, zzz/z (ms), AP/A (uppercase) and
--     ap/a (lowercase) for AM/PM. Unrecognized characters pass through literally.
do
    local DAYS_SHORT   = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"}
    local DAYS_LONG    = {"Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"}
    local MONTHS_SHORT = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"}
    local MONTHS_LONG  = {"January","February","March","April","May","June","July","August","September","October","November","December"}
    -- Tokens scanned longest-first so "yyyy" beats "yy", "MMMM" beats "MM", etc.
    local TOKENS = {
        "yyyy","yy",
        "MMMM","MMM","MM","M",
        "dddd","ddd","dd","d",
        "HH","H","hh","h",
        "mm","m",
        "ss","s",
        "zzz","z",
        "AP","ap","A","a",
    }

    local function formatTime(t, fmt)
        local wdayIdx = (t.wday or 0) + 1
        local isPM = t.hour >= 12
        local h12 = t.hour % 12; if h12 == 0 then h12 = 12 end
        -- h/hh switch to 12-hour when an AM/PM token is present in the format
        -- (Qt QDateTime semantics). H/HH are always 24-hour regardless.
        local hasAP = fmt:find("AP") or fmt:find("ap") or fmt:find("A") or fmt:find("a")
        local R = {
            yyyy = string.format("%04d", t.year),
            yy   = string.format("%02d", t.year % 100),
            MMMM = MONTHS_LONG[t.month] or "",
            MMM  = MONTHS_SHORT[t.month] or "",
            MM   = string.format("%02d", t.month),
            M    = tostring(t.month),
            dddd = DAYS_LONG[wdayIdx] or "",
            ddd  = DAYS_SHORT[wdayIdx] or "",
            dd   = string.format("%02d", t.day),
            d    = tostring(t.day),
            HH   = string.format("%02d", t.hour),
            H    = tostring(t.hour),
            hh   = string.format("%02d", hasAP and h12 or t.hour),
            h    = tostring(hasAP and h12 or t.hour),
            mm   = string.format("%02d", t.min),
            m    = tostring(t.min),
            ss   = string.format("%02d", t.sec),
            s    = tostring(t.sec),
            zzz  = string.format("%03d", t.msec),
            z    = tostring(t.msec),
            AP   = isPM and "PM" or "AM",
            A    = isPM and "PM" or "AM",
            ap   = isPM and "pm" or "am",
            a    = isPM and "pm" or "am",
        }
        local out, i, n = {}, 1, #fmt
        while i <= n do
            local matched = false
            for _, tok in ipairs(TOKENS) do
                local len = #tok
                if fmt:sub(i, i + len - 1) == tok then
                    out[#out+1] = R[tok]
                    i = i + len
                    matched = true
                    break
                end
            end
            if not matched then
                out[#out+1] = fmt:sub(i, i)
                i = i + 1
            end
        end
        return table.concat(out)
    end

    function getTime(asString, format)
        local t = __getTime()
        if not asString then
            return {
                year = t.year, month = t.month, day = t.day,
                hour = t.hour, min   = t.min,   sec = t.sec,
                msec = t.msec,
            }
        end
        return formatTime(t, format or "hh:mm:ss.zzz")
    end
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

-- Mirrors Mudlet's TLuaInterpreter::parseJSON gmcp-table walk: descend
-- gmcp.<part1>.<part2>... creating intermediate tables on demand and
-- replace only the leaf, so siblings under the same parent survive.
function __mudix_set_gmcp(key, value)
    if type(gmcp) ~= 'table' then gmcp = {} end
    local parts = {}
    for part in string.gmatch(key, '[^.]+') do parts[#parts + 1] = part end
    if #parts == 0 then return end
    local node = gmcp
    for i = 1, #parts - 1 do
        local k = parts[i]
        if type(node[k]) ~= 'table' then node[k] = {} end
        node = node[k]
    end
    node[parts[#parts]] = value
end

-- MSDP equivalent of __mudix_set_gmcp. MSDP variable names are flat (any
-- nesting lives inside the value), so we replace the single top-level key.
function __mudix_set_msdp(key, value)
    if type(msdp) ~= 'table' then msdp = {} end
    msdp[key] = value
end

-- Mirrors Mudlet's C++ TLuaInterpreter::registerAnonymousEventHandler: stores
-- (event name → list of Lua function names) keyed registrations made by scripts
-- loaded before Other.lua's Lua-side override takes effect (notably
-- GeyserReposition). __mudix_dispatch_event reads from here and from
-- dispatchEventToFunctions, just like Mudlet's C++ raiseEvent dispatches both
-- C-side anonymous handlers and the wildcard ("*") Lua dispatcher.
__mudix_native_handlers = __mudix_native_handlers or {}
function registerAnonymousEventHandler(event, func)
    if type(event) ~= 'string' or type(func) ~= 'string' then return 0 end
    local list = __mudix_native_handlers[event]
    if not list then list = {}; __mudix_native_handlers[event] = list end
    for _, existing in ipairs(list) do if existing == func then return 0 end end
    list[#list + 1] = func
    return 0
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
    -- Native handlers registered before Other.lua overrode registerAnonymousEventHandler.
    -- Mudlet's C++ raiseEvent passes `event` as the first argument followed by event args.
    local nativeList = __mudix_native_handlers[event]
    if nativeList then
        for _, funcName in ipairs(nativeList) do
            local f = _G[funcName]
            if type(f) == 'function' then
                local ok, err = pcall(f, event, unpack(args))
                if not ok and type(showHandlerError) == 'function' then showHandlerError(event, err) end
            end
        end
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
    --   tempTrigger(substring, fn[, expirationCount])             — literal substring match
    --   tempRegexTrigger(regex, fn[, expirationCount])            — PCRE match
    --   tempExactMatchTrigger(exact, fn[, expirationCount])       — full-line equality
    --   tempBeginOfLineTrigger(prefix, fn[, expirationCount])     — literal prefix (startsWith, not regex ^)
    -- expirationCount: positive N fires N times then auto-kills; -1/0/omitted = unlimited.
    local _sub = __mudix_tempTrigger
    function tempTrigger(pattern, fn, expirationCount)
        return _sub(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempTrigger", 2)), expirationCount)
    end
    local _re = __mudix_tempRegexTrigger
    function tempRegexTrigger(pattern, fn, expirationCount)
        return _re(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempRegexTrigger", 2)), expirationCount)
    end
    local _ex = __mudix_tempExactMatchTrigger
    function tempExactMatchTrigger(pattern, fn, expirationCount)
        return _ex(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempExactMatchTrigger", 2)), expirationCount)
    end
    local _bol = __mudix_tempBeginOfLineTrigger
    function tempBeginOfLineTrigger(pattern, fn, expirationCount)
        return _bol(pattern, __mudix_register_cb(__mudix_to_fn(fn, "tempBeginOfLineTrigger", 2)), expirationCount)
    end
    -- tempPromptTrigger(fn[, expirationCount]) — fires whenever the server sends
    -- a prompt (no pattern). The callback is arg #1, so __mudix_to_fn looks there.
    local _prompt = __mudix_tempPromptTrigger
    function tempPromptTrigger(fn, expirationCount)
        return _prompt(__mudix_register_cb(__mudix_to_fn(fn, "tempPromptTrigger", 1)), expirationCount)
    end
    -- tempLineTrigger(from, howMany, code|fn) — position-based, no pattern. Fires
    -- on `howMany` lines starting `from` lines ahead (from=1 = next line), then
    -- self-expires. The code/function to run is arg #3.
    local _line = __mudix_tempLineTrigger
    function tempLineTrigger(from, howMany, fn)
        return _line(from, howMany, __mudix_register_cb(__mudix_to_fn(fn, "tempLineTrigger", 3)))
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

-- Mudlet setCmdLineAction([cmdLineName,] fn, [args...]). With a cmdLineName
-- the binding targets a userwindow's per-window command line (enabled via
-- enableCommandLine); without one (or "main") it targets the main command
-- bar. The action receives the typed text plus any trailing varargs.
--
-- Mudlet strictly requires a function value, but a long-standing community
-- pattern (visible in older Arkadia / Polish-MUD scripts) is to pass the
-- string name of a global function: `setCmdLineAction("win", "myHandler")`.
-- We treat such a string — a bare Lua identifier whose global resolves to a
-- function — as that function, so those scripts run without modification.
-- A non-identifier string falls through to __mudix_to_fn's loadstring path.
do
    local _set = __mudix_setCmdLineAction
    local _reset = __mudix_resetCmdLineAction
    local function resolveFnArg(v, who, argN)
        if type(v) == 'string' and v:match('^[%w_][%w_%.]*$') then
            local g = _G[v]
            if type(g) == 'function' then return g end
        end
        return __mudix_to_fn(v, who, argN)
    end
    function setCmdLineAction(...)
        local n = select('#', ...)
        if n == 0 then
            error("setCmdLineAction: missing function argument", 2)
        end
        local first = select(1, ...)
        local windowName, fn, extras
        -- Disambiguate (name, fn, ...) from (fn, ...) by argument count and
        -- second-arg shape: when arg 1 is a string AND arg 2 is also present
        -- and is a function / string, treat arg 1 as the cmdLineName.
        if type(first) == 'string' and n >= 2 then
            windowName = first
            fn = select(2, ...)
            extras = { select(3, ...) }
        else
            fn = first
            extras = { select(2, ...) }
        end
        if fn == nil then
            return _set(0, windowName)
        end
        local f = resolveFnArg(fn, "setCmdLineAction", windowName and 2 or 1)
        if #extras > 0 then
            local trailing = extras
            local inner = f
            f = function(text) return inner(text, unpack(trailing)) end
        end
        return _set(__mudix_register_cb(f), windowName)
    end
    function resetCmdLineAction(cmdLineName)
        return _reset(cmdLineName)
    end
end

-- echoLink / insertLink / setLink: convert Lua function cmd → stored ref + string command.
do
    local _fns = {}
    local _id  = 0
    function __mudix_call_link(id) _fns[id]() end

    -- For echoLink / insertLink: cmd is at slot 3 when arg 4 is a string (window form),
    -- otherwise at slot 2 (no-window form, with optional useCurrentFormat at slot 4).
    local function wrapLink(rawFn)
        return function(...)
            local args = {...}
            local n = #args
            local ci = (n >= 4 and type(args[4]) == 'string') and 3 or 2
            if type(args[ci]) == 'function' then
                _id = _id + 1
                local id = _id
                _fns[id] = args[ci]
                args[ci] = '__mudix_call_link(' .. id .. ')'
            end
            return rawFn(unpack(args))
        end
    end
    echoLink = wrapLink(echoLink)
    insertLink = wrapLink(insertLink)

    -- setLink: cmd is arg 2 with a window prefix (3 args), arg 1 without (2 args).
    local _rawSetLink = setLink
    setLink = function(...)
        local args = {...}
        local n = #args
        local ci = (n >= 3) and 2 or 1
        if type(args[ci]) == 'function' then
            _id = _id + 1
            local id = _id
            _fns[id] = args[ci]
            args[ci] = '__mudix_call_link(' .. id .. ')'
        end
        return _rawSetLink(unpack(args))
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

-- insertPopup: identical overload handling + table flatten to echoPopup, but
-- inserts the popup span at the cursor instead of appending. cinsertPopup /
-- dinsertPopup / hinsertPopup (GUIUtils.lua) route here via xEcho with the
-- commands/hints as Lua tables.
--   insertPopup(text, {cmds}, {hints})               -- 3 args, no window
--   insertPopup(text, {cmds}, {hints}, useFmt)        -- 4 args, no window
--   insertPopup(window, text, {cmds}, {hints})        -- 4 args, with window
--   insertPopup(window, text, {cmds}, {hints}, fmt)   -- 5 args, full form
do
    local _raw = insertPopup
    local SEP = '\1'
    insertPopup = function(...)
        local n = select('#', ...)
        local a1, a2, a3, a4, a5 = ...
        local win, text, cmds, hints, fmt
        if n <= 2 then
            return
        elseif n == 3 then
            win, text, cmds, hints, fmt = "main", a1, a2, a3, nil
        elseif n == 4 then
            if type(a2) == 'table' then
                win, text, cmds, hints, fmt = "main", a1, a2, a3, a4
            else
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

-- setPopup([window,] {commands}, {hints}): attach a right-click popup to the
-- current selection. Flatten the command/hint tables to \x01 strings.
--   setPopup({cmds}, {hints})           -- no window
--   setPopup(window, {cmds}, {hints})   -- with window (string first arg)
do
    local _raw = setPopup
    local SEP = '\1'
    setPopup = function(a, b, c)
        local win, cmds, hints
        if type(a) == 'string' then
            win, cmds, hints = a, b, c
        else
            win, cmds, hints = "main", a, b
        end
        local cs, hs = {}, {}
        if type(cmds) == 'table' then
            for _, x in ipairs(cmds) do cs[#cs+1] = tostring(x) end
        end
        if type(hints) == 'table' then
            for _, x in ipairs(hints) do hs[#hs+1] = tostring(x) end
        end
        return _raw(win, table.concat(cs, SEP), table.concat(hs, SEP))
    end
end

-- sendMSDP(variable [, value, ...]): pack the variadic values into a \x01
-- string so the JS binding gets a stable shape regardless of wasmoon's
-- vararg handling. An empty value list concats to "" → no MSDP_VAL groups.
do
    local _raw = __mudix_sendMSDP
    function sendMSDP(variable, ...)
        local vals = {...}
        local parts = {}
        for i = 1, select('#', ...) do parts[i] = tostring(vals[i]) end
        return _raw(tostring(variable or ""), table.concat(parts, '\1'))
    end
end

-- Mudlet `playSoundFile`. Accepts either:
--   playSoundFile(filename [, volume])     -- positional
--   playSoundFile({name=..., volume=..., fadein=..., fadeout=..., start=...,
--                  loops=..., key=..., tag=...})
-- Volume is 0..100. Filename resolves against the profile VFS (e.g.
-- "media/hit.wav") or may be an absolute http(s):// URL.
function playSoundFile(a, b)
    if type(a) == 'table' then
        return __playSoundFile(a)
    end
    return __playSoundFile({ name = tostring(a or ''), volume = b })
end

-- Mudlet `playMusicFile`. Table-arg only:
--   playMusicFile({name=..., volume=..., fadein=..., fadeout=..., start=...,
--                  loops=..., key=..., tag=..., ["continue"]=true|false})
-- When `continue=true` and a track with the same key (or name when no key) is
-- already playing, the call is a no-op. Otherwise the previous matching track
-- is stopped and the new one starts.
function playMusicFile(opts)
    if type(opts) ~= 'table' then return false end
    return __playMusicFile(opts)
end

-- Mudlet `loadSoundFile`. Preloads a sound so the first playSoundFile has no
-- decode latency. Accepts:
--   loadSoundFile(name [, url])            -- positional
--   loadSoundFile({name=..., url=...})     -- table
-- mudix resolves `name` against the profile VFS (or treats it as a URL); the
-- optional `url` is accepted for Mudlet compatibility and used only when no
-- name is supplied.
function loadSoundFile(a, b)
    if type(a) == 'table' then
        return __loadSoundFile({ name = tostring(a.name or a.url or '') })
    end
    return __loadSoundFile({ name = tostring(a or b or '') })
end

-- Mudlet `getPlayingSounds([filter])`. Returns a 1-indexed array of currently
-- playing sound effects: { {name=, key=, tag=, volume=}, ... }. Accepts an
-- optional filter as either positional (name[,key][,tag]) or a table. JS hands
-- back a 0-indexed array (wasmoon convention); re-index to 1-based here.
function getPlayingSounds(a, b, c)
    local filter
    if type(a) == 'table' then
        filter = { name = a.name, key = a.key, tag = a.tag }
    else
        filter = { name = a, key = b, tag = c }
    end
    local raw = __getPlayingSounds(filter)
    local out = {}
    if type(raw) == 'table' then
        for _, v in pairs(raw) do
            out[#out + 1] = { name = v.name, key = v.key, tag = v.tag, volume = v.volume }
        end
    end
    return out
end

-- Mudlet registerMapInfo(label, function). The callback runs every time the
-- map widget repaints; its multi-return (text, isBold, isItalic, r, g, b)
-- becomes the rendered line. New contributors land disabled — caller must
-- enableMapInfo() to show them. Re-registering the same label replaces the
-- callback (JS frees the prior __mudix_cb slot).
do
    local _raw = __mudix_registerMapInfo
    function registerMapInfo(label, fn)
        if type(label) ~= 'string' or label == '' then
            error("registerMapInfo: bad argument #1 type (non-empty string expected, got " .. type(label) .. ")", 2)
        end
        if type(fn) ~= 'function' then
            error("registerMapInfo: bad argument #2 type (function expected, got " .. type(fn) .. ")", 2)
        end
        return _raw(label, __mudix_register_cb(fn))
    end
end

-- Mudlet killMapInfo / enableMapInfo / disableMapInfo. Each returns true on
-- success or (false, errMsg) when the label isn't registered.
function killMapInfo(label)
    if __killMapInfo(label) then return true end
    return false, "killMapInfo: could not find map info called '" .. tostring(label) .. "'"
end
function enableMapInfo(label)
    if __enableMapInfo(label) then return true end
    return false, "enableMapInfo: could not find map info called '" .. tostring(label) .. "'"
end
function disableMapInfo(label)
    if __disableMapInfo(label) then return true end
    return false, "disableMapInfo: could not find map info called '" .. tostring(label) .. "'"
end

-- JS-readable result slots for a single registerMapInfo callback invocation.
-- The MapPanel re-evaluator drives one dispatch per enabled contributor and
-- reads these globals immediately after each call — Lua coroutines share
-- globals, so the chunk run inside runChunk writes to the same _G we read.
__mudix_mapinfo_text = nil
__mudix_mapinfo_bold = false
__mudix_mapinfo_italic = false
__mudix_mapinfo_r = nil
__mudix_mapinfo_g = nil
__mudix_mapinfo_b = nil
function __mudix_dispatch_mapinfo(id, roomId, selectionSize, areaId, displayedAreaId)
    __mudix_mapinfo_text = nil
    __mudix_mapinfo_bold = false
    __mudix_mapinfo_italic = false
    __mudix_mapinfo_r = nil
    __mudix_mapinfo_g = nil
    __mudix_mapinfo_b = nil
    local fn = __mudix_cb[id]
    if type(fn) ~= 'function' then return end
    local ok, text, isBold, isItalic, r, g, b = pcall(fn, roomId, selectionSize, areaId, displayedAreaId)
    if not ok then
        if type(showHandlerError) == 'function' then
            showHandlerError("registerMapInfo callback", tostring(text))
        end
        return
    end
    if text == nil or text == '' then return end
    __mudix_mapinfo_text = tostring(text)
    __mudix_mapinfo_bold = isBold == true
    __mudix_mapinfo_italic = isItalic == true
    if type(r) == 'number' then __mudix_mapinfo_r = r end
    if type(g) == 'number' then __mudix_mapinfo_g = g end
    if type(b) == 'number' then __mudix_mapinfo_b = b end
end

-- Mudlet `stopMusic([{name=..., key=..., tag=..., fadeout=...}])`.
-- With no filters, stops every music track. fadeout (ms) overrides the
-- per-track fadeout for this stop call.
function stopMusic(opts)
    __stopMusic(opts)
end

-- ── Text-to-speech array / nil-returning wrappers ──────────────────────────
-- The simple tts* functions (ttsSpeak, ttsQueue, ttsSetRate, ...) are plain JS
-- globals. The three below need re-shaping: wasmoon pushes JS arrays 0-indexed,
-- so the list returns are walked into a 1-based Lua table, and ttsGetCurrentLine
-- maps its `false` (not speaking) sentinel to Mudlet's (nil, reason) tuple.

local function __tts_to_list(raw)
    local out = {}
    if type(raw) == 'table' then
        local i = 0
        while raw[i] ~= nil do
            out[#out + 1] = raw[i]
            i = i + 1
        end
        if #out == 0 then
            for _, v in ipairs(raw) do out[#out + 1] = v end
        end
    end
    return out
end

-- Mudlet ttsGetVoices() → 1-based table of available voice names.
function ttsGetVoices()
    return __tts_to_list(__ttsGetVoices())
end

-- Mudlet ttsGetQueue([index]) → with an index, the queued text at that 1-based
-- position (or false when out of bounds); without one, the whole queue as a
-- 1-based table.
function ttsGetQueue(index)
    if index ~= nil then
        return __ttsGetQueue(index)
    end
    return __tts_to_list(__ttsGetQueue())
end

-- Mudlet ttsGetCurrentLine() → the text being spoken, or (nil, reason) when the
-- engine is idle or errored.
function ttsGetCurrentLine()
    local line = __ttsGetCurrentLine()
    if line == false then
        return nil, "not speaking any text"
    end
    return line
end
