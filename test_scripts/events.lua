-- ============================================================
--  Test: events (raiseEvent / register- & killAnonymousEventHandler)
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

  cecho("\n<cyan>== events ==<reset>\n")

  -- Handlers are invoked synchronously with (eventName, ...raisedArgs).
  local seen = {}
  local id = registerAnonymousEventHandler("mudixSelfTest", function(evt, a, b)
    seen.evt, seen.a, seen.b = evt, a, b
  end)
  checkTrue("register returns an id", type(id) == "number")

  raiseEvent("mudixSelfTest", 42, "hi")
  check("handler received event name", seen.evt, "mudixSelfTest")
  check("handler received arg #1",     seen.a,   42)
  check("handler received arg #2",     seen.b,   "hi")

  -- After kill, the handler must not fire again.
  checkTrue("killAnonymousEventHandler succeeds", killAnonymousEventHandler(id))
  seen = {}
  raiseEvent("mudixSelfTest", 99)
  check("handler removed (no fire)", seen.evt, nil)

  -- Named event handlers (keyed by user/handler name) behave the same.
  local namedSeen = {}
  registerNamedEventHandler("selfTest", "h1", "mudixNamedTest", function(evt, x)
    namedSeen.x = x
  end)
  raiseEvent("mudixNamedTest", 7)
  check("named handler fired", namedSeen.x, 7)
  checkTrue("deleteNamedEventHandler succeeds", deleteNamedEventHandler("selfTest", "h1"))
  namedSeen = {}
  raiseEvent("mudixNamedTest", 8)
  check("named handler removed", namedSeen.x, nil)

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
