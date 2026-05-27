-- ============================================================
--  Test: string utilities
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

  cecho("\n<cyan>== string utilities ==<reset>\n")

  check("string.starts true",  string.starts("hello", "he"), true)
  check("string.starts false", string.starts("hello", "lo"), false)
  check("string.ends true",    string.ends("hello", "lo"),   true)
  check("string.ends false",   string.ends("hello", "he"),   false)

  check("string.trim",  string.trim("   spaced out   "), "spaced out")
  check("string.title", string.title("hello world"), "Hello world")  -- only 1st char

  check("string.cut (over)",  string.cut("abcdef", 3), "abc")
  check("string.cut (under)", string.cut("ab", 5),     "ab")

  local parts = string.split("a,b,c", ",")
  check("string.split count", #parts,    3)
  check("string.split [1]",   parts[1],  "a")
  check("string.split [3]",   parts[3],  "c")

  check("string.patternEscape",     string.patternEscape("a.b*c"),  "a%.b%*c")
  check("string.genNocasePattern",  string.genNocasePattern("ab"),  "[aA][bB]")

  -- f"" string interpolation (no locals needed — uses an inline expression)
  check("f interpolation", f"sum is {1 + 2}", "sum is 3")

  -- method-call forms also work on strings
  checkTrue("method :trim()", ("  x  "):trim() == "x")

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
