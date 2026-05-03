----------------------------------------------------------------------------------
--- Mudlet stdlib — selected functions from Other.lua
--- Source: https://github.com/Mudlet/Mudlet/blob/development/src/mudlet-lua/lua/Other.lua
--- Kept verbatim so this file can be updated by replacing it with upstream content.
----------------------------------------------------------------------------------

-- enforce uniform locale so scripts don't get
-- tripped up on number representation differences (. vs ,)
os.setlocale("C")

mudlet = mudlet or {}
mudlet.supports = {
  coroutines = true,
  mmcp = true,
  namedPatterns = true,
  osVersion = true
}

--- @see send
function sendAll(...)
  local time = 0
  local args = { ... }
  local echo = true

  if type(args[#args]) == 'boolean' then
    echo = table.remove(args, #args)
  end
  if type(args[1]) == 'number' then
    time = table.remove(args, 1)
    for i, v in ipairs(args) do
      if type(v) == 'string' then
        tempTimer(time*i, function() send(v, echo) end, false)
      end
    end
    return
  end
  for i, v in ipairs(args) do
    send(v, echo)
  end
end


--- local functions used for pausing/resuming a speedwalk
local speedwalkTimerID
local speedwalkDelay
local speedwalkList
local speedwalkShow

--- Stops a speedwalk and clears the walklist
function stopSpeedwalk()
  local active = pauseSpeedwalk()
  if active then
    speedwalkList = {}
    raiseEvent("sysSpeedwalkStopped")
    return true
  end
  return nil, "stopSpeedwalk(): no active speedwalk found"
end



--- pauses a running speedwalk, but leaves the walklist intact in case you want to resume
function pauseSpeedwalk()
  if speedwalkTimerID then
    killTimer(speedwalkTimerID)
    speedwalkTimerID = false
    raiseEvent("sysSpeedwalkPaused")
    return true
  end
  return nil, "pauseSpeedwalk(): no active speedwalk found"
end



--- Resumes a paused speedwalk
function resumeSpeedwalk()
  if speedwalkTimerID then
    return nil, "resumeSpeedwalk(): attempted to resume an already running speedwalk"
  end
  if not speedwalkList or table.is_empty(speedwalkList) then
    return nil, "resumeSpeedwalk(): attempted to resume a speedwalk but no active speedwalk found"
  end
  speedwalktimer(speedwalkList, speedwalkDelay, speedwalkShow)
  raiseEvent("sysSpeedwalkResumed")
  return true
end


--- <b><u>TODO</u></b> speedwalktimer()
function speedwalktimer(walklist, walkdelay, show)
  send(walklist[1], show)
  table.remove(walklist, 1)
  if #walklist > 0 then
    speedwalkTimerID = tempTimer(walkdelay, function()
      speedwalktimer(walklist, walkdelay, show)
    end)
  else
    raiseEvent("sysSpeedwalkFinished")
  end
end



--- <b><u>TODO</u></b> speedwalk(dirString, backwards, delay, optional show)
function speedwalk(dirString, backwards, delay, show)
  dirString = dirString:lower()
  local walkdelay = delay
  if show ~= false then show = true end
  speedwalkShow = show
  speedwalkDelay = delay
  local walklist = {}
  local long_dir = {north = 'n', south = 's', east = 'e', west = 'w', up = 'u', down = 'd'}
  for k,v in pairs(long_dir) do
    dirString = dirString:gsub(k,v)
  end
  local reversedir = {
    n = "s",
    en = "sw",
    e = "w",
    es = "nw",
    s = "n",
    ws = "ne",
    w = "e",
    wn = "se",
    u = "d",
    d = "u",
    ni = "out",
    tuo = "in"
  }
  raiseEvent("sysSpeedwalkStarted")
  if not backwards then
    for count, direction in string.gmatch(dirString, "([0-9]*)([neswudio][ewnu]?t?)") do
      count = (count == "" and 1 or count)
      for i = 1, count do
        if delay then
          walklist[#walklist + 1] = direction
        else
          send(direction, show)
        end
      end
    end
  else
    for direction, count in string.gmatch(dirString:reverse(), "(t?[ewnu]?[neswudio])([0-9]*)") do
      count = (count == "" and 1 or count:reverse())
      for i = 1, count do
        if delay then
          walklist[#walklist + 1] = reversedir[direction]
        else
          send(reversedir[direction], show)
        end
      end
    end
  end
  if walkdelay then
    speedwalkList = walklist
    speedwalktimer(walklist, walkdelay, show)
  end
end



--- <b><u>TODO</u></b> _comp(a, b)
function _comp(a, b)
  if type(a) ~= type(b) then
    return false
  end
  if type(a) == 'table' then
    local a_size = 0
    for k, v in pairs(a) do
      a_size = a_size + 1
      if not b[k] then
        return false
      end
      if not _comp(v, b[k]) then
        return false
      end
    end
    if a_size ~= table.size(b) then
      return false
    end
  else
    if a ~= b then
      return false
    end
  end
  return true
end

--- exposes _comp as compare as it's a global, has been for years, and is also
--- extremely useful. But documenting it as _comp is inconsistent with the rest
--- of the API
compare = _comp


--- @return true or false
function xor(a, b)
  if (a and (not b)) or (b and (not a)) then
    return true
  else
    return false
  end
end


function deleteFull()
  deleteLine()
  tempLineTrigger(1, 1, [[if isPrompt() then deleteLine() end]])
end

function deleteMultiline(maxLines)
  local multimatchesSize = table.size(multimatches)
  if multimatchesSize == 0 then
    return nil, "does not appear to be run during a multiline trigger match, please try again."
  end
  maxLines = maxLines or multimatchesSize
  local firstMatch = multimatches[1][1]:patternEscape()
  for i = 1, maxLines do
    local content = getCurrentLine()
    deleteLine()
    if content:find(firstMatch) then
      return true
    end
    moveCursorUp()
  end
  return true
end
