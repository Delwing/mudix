-- Minimal penlight `pl.pretty` shim. busted.core calls pretty.write(message)
-- only to render a non-string error value that has no __tostring metamethod
-- (rare). A compact recursive serialiser is plenty for that diagnostic path.
local pretty = {}

local function quote(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\t' then return '\\t' end
    return string.format('\\%d', c:byte())
  end) .. '"'
end

local function serialize(v, seen, indent)
  local t = type(v)
  if t == 'string' then return quote(v) end
  if t == 'number' or t == 'boolean' or t == 'nil' then return tostring(v) end
  if t ~= 'table' then return '<' .. t .. '>' end
  if seen[v] then return '<cycle>' end
  seen[v] = true
  local parts = {}
  local nextIndent = indent .. '  '
  for k, val in pairs(v) do
    local key = type(k) == 'string' and k or ('[' .. tostring(k) .. ']')
    parts[#parts + 1] = nextIndent .. key .. ' = ' .. serialize(val, seen, nextIndent)
  end
  seen[v] = nil
  if #parts == 0 then return '{}' end
  return '{\n' .. table.concat(parts, ',\n') .. '\n' .. indent .. '}'
end

function pretty.write(v, _)
  return serialize(v, {}, '')
end

-- pretty.dump prints; we never use it on the in-process path, but provide it.
function pretty.dump(v)
  echo(pretty.write(v) .. '\n')
end

return pretty
