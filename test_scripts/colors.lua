-- ============================================================
--  Test: color utilities (cecho2string / ansi2string / closestColor / color_table)
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

  cecho("\n<cyan>== color utilities ==<reset>\n")

  -- cecho2string strips Mudlet <color> tags, leaving plain text
  check("cecho2string strips tags", cecho2string("<red>Hello <green>World<reset>"), "Hello World")

  -- ansi2string strips raw ANSI escape codes ("\27" == ESC)
  check("ansi2string strips ANSI", ansi2string("\27[31mred\27[0m text"), "red text")

  -- color_table maps names -> {r, g, b}
  checkTrue("color_table.red exists", type(color_table.red) == "table")
  check("color_table.red R", color_table.red[1], 255)
  check("color_table.red G", color_table.red[2], 0)
  check("color_table.red B", color_table.red[3], 0)
  check("color_table.white R", color_table.white[1], 255)
  check("color_table.black R", color_table.black[1], 0)

  -- closestColor returns the name of the nearest named color; whatever name it
  -- picks for pure red must itself map back to {255, 0, 0}
  local redName = closestColor(255, 0, 0)
  checkTrue("closestColor returns a string", type(redName) == "string")
  checkTrue("closestColor(255,0,0) -> pure red",
            color_table[redName] and color_table[redName][1] == 255
            and color_table[redName][2] == 0 and color_table[redName][3] == 0)

  local blackName = closestColor(0, 0, 0)
  checkTrue("closestColor(0,0,0) -> pure black",
            color_table[blackName] and color_table[blackName][1] == 0
            and color_table[blackName][2] == 0 and color_table[blackName][3] == 0)

  cecho(string.format("\n<cyan>== Results: <green>%d passed<reset>, <red>%d failed<reset> <cyan>==<reset>\n",
                      pass, fail))
end
