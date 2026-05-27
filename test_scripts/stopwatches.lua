-- ============================================================
--  Test: stopwatches
-- ============================================================
do
  local pass, fail = 0, 0
  local function check(label, got, want)
    if got == want then
      pass = pass + 1
      cecho(string.format("  <green>[OK]<reset>   %s\n", label))
    else
      fail = fail + 1
      cecho(string.format("  <red>[FAIL]<reset> %s  <yellow>(got %q, want %q)<reset>\n",
                          label, tostring(got), tostring(want)))
    end
  end
  local function checkTrue(label, cond) check(label, not not cond, true) end
  local function checkNear(label, got, want, eps)
    eps = eps or 0.1
    if type(got) == "number" and math.abs(got - want) <= eps then
      pass = pass + 1
      cecho(string.format("  <green>[OK]<reset>   %s\n", label))
    else
      fail = fail + 1
      cecho(string.format("  <red>[FAIL]<reset> %s  <yellow>(got %s, want ~%s)<reset>\n",
                          label, tostring(got), tostring(want)))
    end
  end

  cecho("\n<cyan>== stopwatches ==<reset>\n")

  -- Fresh start: drop any leftover from a previous run.
  deleteStopWatch("sw_test")

  -- A NAMED watch defaults to autostart OFF, so elapsed only changes via adjust.
  local id = createStopWatch("sw_test")
  checkTrue("createStopWatch returns an id", type(id) == "number")

  -- Creating the same name again must fail (names are unique).
  check("duplicate name returns false", createStopWatch("sw_test"), false)

  resetStopWatch(id)
  checkNear("starts at zero", getStopWatchTime(id), 0)

  checkTrue("adjustStopWatch succeeds", adjustStopWatch(id, 5))
  checkNear("after +5s", getStopWatchTime(id), 5)

  adjustStopWatch(id, -2)
  checkNear("after -2s", getStopWatchTime(id), 3)

  -- Address by name as well as id.
  checkNear("getStopWatchTime by name", getStopWatchTime("sw_test"), 3)

  resetStopWatch(id)
  checkNear("after reset", getStopWatchTime(id), 0)

  -- getStopWatches includes our watch
  local all = getStopWatches()
  checkTrue("getStopWatches is a table", type(all) == "table")
  checkTrue("getStopWatches has our watch", all[id] ~= nil and all[id].name == "sw_test")

  -- delete, then it should be gone
  checkTrue("deleteStopWatch succeeds",  deleteStopWatch(id))
  check("time after delete is false",    getStopWatchTime(id), false)
  check("delete again returns false",    deleteStopWatch(id), false)

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
