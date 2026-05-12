-- luasql.sqlite3 shim backed by the main-thread sqlite-wasm bridge in
-- LuaRuntime.ts. Mudlet's DB.lua expects this module to look like the real
-- LuaSQL binding:
--   local luasql = require "luasql.sqlite3"
--   local env  = luasql.sqlite3()
--   local conn = env:connect(path)
--   local cur, err = conn:execute(sql)            -- cursor for SELECT
--   local n = conn:execute("INSERT ...")          -- rowcount otherwise
--   local row = cur:fetch({}, "a")                -- assoc-mode row, or nil
--   cur:close(); conn:close(); env:close()
--
-- The JS bridge functions (__sql_*) are synchronous — they return a value
-- directly, no Promise / __await dance.

local function make_cursor(rows, columns)
    local pos = 0
    local n = #rows
    local cur = {}

    function cur:fetch(t, mode)
        pos = pos + 1
        if pos > n then return nil end
        t = t or {}
        local row = rows[pos]
        if mode == "a" then
            for i = 1, #columns do
                t[columns[i]] = row[i]
            end
        else
            for i = 1, #columns do
                t[i] = row[i]
            end
        end
        return t
    end

    function cur:close() return true end

    function cur:getcolnames()
        local r = {}
        for i = 1, #columns do r[i] = columns[i] end
        return r
    end

    return cur
end

local function make_conn(conn_id)
    local conn = {}

    function conn:execute(sql)
        local result = __sql_exec(conn_id, sql)
        if result == nil then
            return nil, "sqlite returned nil"
        end
        if result.kind == "error" then
            return nil, result.message
        elseif result.kind == "rows" then
            -- Rows arrive as a Lua source literal (`{{...},{...},...}`) rather
            -- than a pre-pushed table. Avoids wasmoon's per-cell pushTable cost
            -- on big fetches — one boundary crossing for the source string, one
            -- in-wasm Lua parse, no JS round-trip per value.
            local fn, parse_err = loadstring("return " .. result.rowsSrc, "sql_rows")
            if not fn then
                return nil, "sql rows parse error: " .. tostring(parse_err)
            end
            local ok, rows = pcall(fn)
            if not ok then
                return nil, "sql rows eval error: " .. tostring(rows)
            end
            return make_cursor(rows, result.columns)
        else
            return result.changes or 0
        end
    end

    function conn:escape(s)
        return __sql_escape(s)
    end

    function conn:close()
        __sql_close(conn_id)
        return true
    end

    function conn:commit() return true end
    function conn:rollback() return true end
    function conn:setautocommit() return true end

    return conn
end

local function make_env()
    local env = {}

    function env:connect(path)
        local conn_id = __sql_open(path)
        if conn_id == nil then
            return nil, "failed to open " .. tostring(path)
        end
        return make_conn(conn_id)
    end

    function env:close() return true end

    return env
end

local mod = {
    sqlite3 = function() return make_env() end,
}

-- Populate both package.preload (so `require("luasql.sqlite3")` works) and
-- package.loaded (so DB.lua's `if package.loaded[...]` check passes without a
-- prior require).
package.preload["luasql.sqlite3"] = function() return mod end
package.loaded["luasql.sqlite3"] = mod
