-- ============================================================
--  Test: table utilities
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

  cecho("\n<cyan>== table utilities ==<reset>\n")

  check("table.size (list)",  table.size({ 10, 20, 30 }),        3)
  check("table.size (map)",   table.size({ a = 1, b = 2, c = 3 }), 3)

  check("table.is_empty true",  table.is_empty({}),   true)
  check("table.is_empty false", table.is_empty({ 1 }), false)

  check("table.contains true",  table.contains({ "x", "y", "z" }, "y"), true)
  check("table.contains false", table.contains({ "x", "y", "z" }, "q"), false)

  check("table.index_of",      table.index_of({ "a", "b", "c" }, "b"), 2)
  check("table.index_of miss", table.index_of({ "a", "b" }, "z"),      nil)

  check("table.keys count", table.size(table.keys({ a = 1, b = 2 })), 2)

  -- deepcopy must be independent of the original
  local orig = { a = { 1, 2 }, b = 5 }
  local cp = table.deepcopy(orig)
  cp.a[1] = 99
  check("deepcopy independent", orig.a[1], 1)
  check("deepcopy preserves",   cp.b,      5)

  -- union / intersection / complement operate on key->value pairs
  local u = table.union({ a = 1 }, { b = 2 })
  check("union size", table.size(u), 2)
  check("union .a",   u.a,           1)
  check("union .b",   u.b,           2)

  local i = table.intersection({ a = 1, b = 2 }, { a = 1, c = 3 })
  check("intersection size", table.size(i), 1)
  check("intersection .a",   i.a,           1)

  local c = table.complement({ a = 1, b = 2 }, { a = 1 })
  check("complement size", table.size(c), 1)
  check("complement .b",   c.b,           2)

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
