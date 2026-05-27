-- ============================================================
--  Test: selection / cursor / line access (driven on an off-screen buffer)
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

  cecho("\n<cyan>== selection / cursor / line access ==<reset>\n")

  -- Use a buffer so the contents are deterministic regardless of MUD output.
  createBuffer("tc")
  clearWindow("tc")
  cecho("tc", "Hello World\n")
  cecho("tc", "Second line\n")

  -- Cursor defaults to the last line.
  check("getCurrentLine = last line", getCurrentLine("tc"), "Second line")

  -- selectString returns the 0-based column of the Nth occurrence on the cursor line.
  -- "Second line": 'l' of "line" is at index 7.
  check("selectString('line') column", selectString("tc", "line", 1), 7)
  check("getSelection after select",   getSelection("tc"), "line")

  -- deselect clears it; getSelection then returns nil ("no selection").
  deselect("tc")
  check("getSelection after deselect", getSelection("tc"), nil)

  -- Move the cursor to line 0, column 0 and verify position + content.
  check("moveCursor returns true", moveCursor("tc", 0, 0), true)
  check("getLineNumber after move",   getLineNumber("tc"),   0)
  check("getColumnNumber after move", getColumnNumber("tc"), 0)
  check("getCurrentLine on line 0",   getCurrentLine("tc"), "Hello World")

  -- selectString now searches line 0. "World" starts at index 6.
  check("selectString('World') column", selectString("tc", "World", 1), 6)
  check("getSelection = World",          getSelection("tc"), "World")

  -- Missing substring returns -1 and leaves no selection.
  check("selectString miss returns -1", selectString("tc", "zzz", 1), -1)

  clearWindow("tc")

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
