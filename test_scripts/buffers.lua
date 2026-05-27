-- ============================================================
--  Test: createBuffer / copy / paste / appendBuffer
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

  cecho("\n<cyan>== createBuffer / copy / paste / appendBuffer ==<reset>\n")

  -- 1) createBuffer makes an OFF-SCREEN console; windowType proves it ------
  createBuffer("tb")
  clearWindow("tb")                       -- reset so re-runs stay deterministic
  check("windowType('tb') reports buffer", windowType("tb"), "buffer")

  -- 2) Formatted output goes INTO the buffer, never opens a panel ----------
  cecho("tb", "<red>Hello <green>World<reset>\n")
  check("getCurrentLine('tb')", getCurrentLine("tb"), "Hello World")

  -- 3) select + copy the buffer line, then appendBuffer into MAIN ----------
  selectCurrentLine("tb")
  check("getSelection('tb')", getSelection("tb"), "Hello World")
  copy("tb")
  cecho("\n<cyan>-> appendBuffer('main') should print red 'Hello' + green 'World':<reset>\n")
  appendBuffer("main")                    -- VISUAL: colors preserved in main

  -- 4) appendBuffer into a VISIBLE miniconsole ----------------------------
  createMiniConsole("tb_view", 10, 80, 400, 60)
  clearWindow("tb_view")
  appendBuffer("tb_view")                 -- VISUAL: same line in the miniconsole

  -- 5) paste APPENDS when the cursor is on the last line ------------------
  createBuffer("tb2")
  clearWindow("tb2")
  cecho("tb2", "<blue>line-A<reset>\n")
  paste("tb2")
  check("paste appended new line", getCurrentLine("tb2"), "Hello World")

  -- 6) paste INSERTS at the cursor when above the last line ---------------
  createBuffer("tb3")
  clearWindow("tb3")
  cecho("tb3", "<magenta>AAAA<reset>\n")
  cecho("tb3", "BBBB\n")
  moveCursor("tb3", 2, 0)                  -- line 0 ("AAAA"), column 2
  paste("tb3")
  check("paste inserted mid-line", getCurrentLine("tb3"), "AAHello WorldAA")

  -- 7) copy from MAIN -> appendBuffer back to a buffer --------------------
  cecho("\n<yellow>marker-line-for-copy<reset>\n")
  selectCurrentLine("main")
  copy()
  createBuffer("tb4")
  clearWindow("tb4")
  appendBuffer("tb4")
  check("copy(main) -> appendBuffer('tb4')", getCurrentLine("tb4"), "marker-line-for-copy")

  -- 8) clearWindow empties an off-screen buffer ---------------------------
  clearWindow("tb")
  check("clearWindow('tb') empties buffer", getCurrentLine("tb"), "")

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
