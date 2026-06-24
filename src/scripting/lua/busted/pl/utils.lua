-- Minimal penlight `pl.utils` shim. busted touches three entry points:
--   * busted.utils       -> .split  (exported but unused on the in-process path)
--   * busted.compatibility-> .execute (os.execute wrapper; never called by us)
--   * busted.fixtures    -> .readfile (only if a spec uses the `fixtures` API)
-- Each is implemented against the VFS-backed io rather than the host FS.
local utils = {}

-- split(s, re, plain, n) -> array of pieces. Defaults to whitespace runs, which
-- is enough for the few callers that exist; `re` is treated as a Lua pattern.
function utils.split(s, re, plain, n)
  s = tostring(s)
  re = re or '%s+'
  local res = {}
  local pat = plain and ('(.-)' .. re:gsub('[%(%)%.%%%+%-%*%?%[%]%^%$]', '%%%1')) or ('(.-)' .. re)
  local pos = 1
  local find = string.find
  while true do
    local a, b = find(s, re, pos)
    if not a then break end
    res[#res + 1] = s:sub(pos, a - 1)
    pos = b + 1
    if n and #res >= n - 1 then break end
  end
  res[#res + 1] = s:sub(pos)
  return res
end

-- execute(cmd) -> success, code. The browser has no shell; report failure
-- rather than pretend a command ran.
function utils.execute(_)
  return false, -1
end

-- readfile(path, is_bin) -> contents | nil, err. Reads through the VFS io shim.
function utils.readfile(filename, _)
  local f, err = io.open(filename, 'r')
  if not f then return nil, err end
  local contents = f:read('*a')
  f:close()
  return contents
end

return utils
