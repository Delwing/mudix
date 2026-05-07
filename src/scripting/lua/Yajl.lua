-- Mudlet's yajl module: JSON encode/decode for Lua.
-- Decoder is JS-bridged (JSON.parse + 1-indexed remap) via __yajl_parse__.
-- Encoder is pure Lua to sidestep wasmoon's LuaTable proxy semantics.

yajl = {}
-- Distinct sentinel for JSON null. Hand it to the JS bridge so the decoder
-- can splice this exact reference in wherever it sees JSON null.
yajl.null = setmetatable({}, { __tostring = function() return 'yajl.null' end })
__yajl_set_null__(yajl.null)

function yajl.to_value(s)
    return __yajl_parse__(s)
end

-- ── Encoder ────────────────────────────────────────────────────────────────

local function escape_str(s)
    s = s:gsub('\\', '\\\\')
         :gsub('"', '\\"')
         :gsub('\n', '\\n')
         :gsub('\r', '\\r')
         :gsub('\t', '\\t')
         :gsub('\b', '\\b')
         :gsub('\f', '\\f')
         :gsub('[%z\1-\31]', function(c)
             return string.format('\\u%04x', string.byte(c))
         end)
    return '"' .. s .. '"'
end

-- A table is JSON-array-shaped iff its keys are exactly {1..n} for some n>=0.
-- Sparse integer-keyed tables and mixed numeric/string keys fall through to
-- the object encoder (matching yajl's behavior).
local function is_array(t)
    local n, max_idx = 0, 0
    for k in pairs(t) do
        if type(k) ~= 'number' or k % 1 ~= 0 or k < 1 then return false end
        n = n + 1
        if k > max_idx then max_idx = k end
    end
    if n ~= max_idx then return false end
    return true, n
end

local encode
encode = function(v)
    if v == yajl.null then return 'null' end
    local tv = type(v)
    if tv == 'nil' then return 'null' end
    if tv == 'boolean' then return tostring(v) end
    if tv == 'number' then
        -- JSON has no NaN/Infinity; emit null to stay parseable.
        if v ~= v or v == math.huge or v == -math.huge then return 'null' end
        return tostring(v)
    end
    if tv == 'string' then return escape_str(v) end
    if tv == 'table' then
        local arr, n = is_array(v)
        if arr then
            if n == 0 then return '[]' end
            local parts = {}
            for i = 1, n do parts[i] = encode(v[i]) end
            return '[' .. table.concat(parts, ',') .. ']'
        end
        local parts = {}
        for k, val in pairs(v) do
            parts[#parts + 1] = escape_str(tostring(k)) .. ':' .. encode(val)
        end
        return '{' .. table.concat(parts, ',') .. '}'
    end
    return 'null'
end

function yajl.to_string(v)
    return encode(v)
end

-- Drop bridge globals so user code can't accidentally rely on them.
__yajl_set_null__ = nil