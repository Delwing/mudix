-- ============================================================
--  Test: date / time (getEpoch / shms / getTime)
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

  cecho("\n<cyan>== date / time ==<reset>\n")

  -- getEpoch -> seconds since 1970. Any real run is well past 1.5e9 (mid-2017).
  local epoch = getEpoch()
  checkTrue("getEpoch is a number", type(epoch) == "number")
  checkTrue("getEpoch is plausible (> 1.5e9)", epoch > 1500000000)

  -- shms(seconds) -> hh, mm, ss strings. 3661s = 1h 1m 1s.
  local hh, mm, ss = shms(3661)
  check("shms hours",   hh, "01")
  check("shms minutes", mm, "01")
  check("shms seconds", ss, "01")

  -- getTime() -> table of local time components
  local t = getTime()
  checkTrue("getTime returns a table", type(t) == "table")
  checkTrue("getTime.year is sane",  type(t.year) == "number" and t.year >= 2000)
  checkTrue("getTime.month 1..12",   type(t.month) == "number" and t.month >= 1 and t.month <= 12)
  checkTrue("getTime.day 1..31",     type(t.day) == "number" and t.day >= 1 and t.day <= 31)
  checkTrue("getTime.hour 0..23",    type(t.hour) == "number" and t.hour >= 0 and t.hour <= 23)
  checkTrue("getTime.min 0..59",     type(t.min) == "number" and t.min >= 0 and t.min <= 59)

  -- getTime(true) -> formatted string
  local s = getTime(true)
  checkTrue("getTime(true) is a non-empty string", type(s) == "string" and #s > 0)

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
