-- Minimal penlight `pl.tablex` shim — busted.core/context/execute only use
-- tablex.copy (a shallow copy). Vendoring full penlight would drag in pl.compat
-- and a large io/os surface we don't need.
local tablex = {}

function tablex.copy(t)
  local r = {}
  for k, v in pairs(t) do r[k] = v end
  return r
end

return tablex
