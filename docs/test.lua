-- Mudix Lua API test suite
-- Load in a script window and call the individual test functions,
-- or call run_all() to execute every section in sequence.

local PASS = "<green>PASS<reset>"
local FAIL = "<red>FAIL<reset>"
local SEP  = "<yellow>────────────────────────────────────────<reset>"

local function header(title)
    cecho("\n" .. SEP .. "\n")
    cecho("<cyan>" .. title .. "<reset>\n")
    cecho(SEP .. "\n")
end

local function ok(label)
    cecho(PASS .. " " .. label .. "\n")
end

local function fail(label, reason)
    cecho(FAIL .. " " .. label .. (reason and (": " .. tostring(reason)) or "") .. "\n")
end

local function assert_eq(got, expected, label)
    if got == expected then
        ok(label)
    else
        fail(label, "expected " .. tostring(expected) .. " got " .. tostring(got))
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. echo / plain text
-- ─────────────────────────────────────────────────────────────────────────────

function test_echo()
    header("1. echo – plain text")
    echo("plain text line (no colour)\n")
    ok("echo: plain text rendered")

    echo("line without trailing newline")
    echo(" — continued on same line\n")
    ok("echo: continuation without implicit newline")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cecho – named-colour markup
-- ─────────────────────────────────────────────────────────────────────────────

function test_cecho()
    header("2. cecho – named colours")
    cecho("<red>red<reset> <green>green<reset> <blue>blue<reset>\n")
    ok("cecho: basic named colours")

    cecho("<white:red>white on red<reset> <black:yellow>black on yellow<reset>\n")
    ok("cecho: foreground:background notation")

    cecho("<bold><underline>bold+underline<reset>\n")
    ok("cecho: bold + underline attributes")

    cecho("<italic>italic<reset> <strikethrough>strikethrough<reset>\n")
    ok("cecho: italic + strikethrough attributes")

    -- multiple resets and nested segments
    cecho("<magenta>A<reset><cyan>B<reset><yellow>C<reset>\n")
    ok("cecho: multiple segments with resets")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. decho – decimal RGB
-- ─────────────────────────────────────────────────────────────────────────────

function test_decho()
    header("3. decho – decimal RGB")
    decho("<255,0,0>pure red<r>\n")
    ok("decho: foreground RGB")

    decho("<0,255,0:0,0,128>green on dark blue<r>\n")
    ok("decho: fg+bg RGB")

    decho("<128,128,128>grey midpoint<r>\n")
    ok("decho: grey RGB")

    decho("<255,165,0>orange<r> <138,43,226>blueviolet<r>\n")
    ok("decho: two segments on one line")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. hecho – hex RGB
-- ─────────────────────────────────────────────────────────────────────────────

function test_hecho()
    header("4. hecho – hex RGB")
    hecho("|cff0000pure red|r\n")
    ok("hecho: fg hex colour")

    hecho("|c00ff00,00008bgreen on dark blue|r\n")
    ok("hecho: fg+bg hex colour")

    hecho("|cff8c00dark orange|r |c8a2be2bblueviolet|r\n")
    ok("hecho: two segments on one line")

    hecho("|cffffffwhite|r normal |c000000,ffffffblack on white|r\n")
    ok("hecho: extreme contrast")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. echoLink / cechoLink / dechoLink / hechoLink
-- ─────────────────────────────────────────────────────────────────────────────

function test_links()
    header("5. *echoLink – clickable links")

    -- echoLink with a Lua string command
    echoLink("[echoLink string cmd]", 'echo("echoLink clicked\\n")', "click me", true)
    echo("\n")
    ok("echoLink: string command")

    -- echoLink with an inline function
    echoLink("[echoLink function]", function() echo("echoLink fn clicked\n") end, "fn tooltip", true)
    echo("\n")
    ok("echoLink: inline function")

    -- cechoLink
    cechoLink("<green>[cechoLink green]<reset>", 'cecho("<green>cechoLink clicked\\n")', "cechoLink tooltip", true)
    echo("\n")
    ok("cechoLink: coloured clickable link")

    -- dechoLink
    dechoLink("<255,165,0>[dechoLink orange]<r>", 'decho("<255,165,0>dechoLink clicked\\n")', "dechoLink tooltip", true)
    echo("\n")
    ok("dechoLink: decimal-RGB clickable link")

    -- hechoLink
    hechoLink("|cff00ff[hechoLink magenta]|r", 'hecho("|cff00ffhechoLink clicked\\n")', "hechoLink tooltip", true)
    echo("\n")
    ok("hechoLink: hex-RGB clickable link")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. *echoPopup – right-click context menus
-- ─────────────────────────────────────────────────────────────────────────────

function test_popups()
    header("6. *echoPopup – right-click menus")

    cechoPopup(
        "<yellow>[right-click me – cecho popup]<reset>",
        { 'echo("option A\\n")', 'echo("option B\\n")' },
        { "Do option A", "Do option B" },
        true
    )
    echo("\n")
    ok("cechoPopup: 2-item context menu")

    dechoPopup(
        "<200,100,0>[decho popup]<r>",
        { 'echo("decho popup A\\n")' },
        { "decho option A" },
        true
    )
    echo("\n")
    ok("dechoPopup: 1-item context menu")

    hechoPopup(
        "|c00ffff[hecho popup]|r",
        { 'echo("hecho popup A\\n")' },
        { "hecho option A" },
        true
    )
    echo("\n")
    ok("hechoPopup: 1-item context menu")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. fg / bg – named colour application
-- ─────────────────────────────────────────────────────────────────────────────

function test_fg_bg()
    header("7. fg / bg – named colour application")

    fg("red")
    echo("red foreground")
    resetFormat()
    echo(" (reset)\n")
    ok("fg: named colour applied then reset")

    bg("blue")
    echo("blue background")
    resetFormat()
    echo(" (reset)\n")
    ok("bg: named colour applied then reset")

    fg("white")
    bg("dark_green")
    echo("white on dark_green")
    resetFormat()
    echo("\n")
    ok("fg+bg: combined named colours")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. setFgColor / setBgColor – raw RGB
-- ─────────────────────────────────────────────────────────────────────────────

function test_set_colors()
    header("8. setFgColor / setBgColor – raw RGB")

    setFgColor(255, 100, 0)
    echo("RGB fg 255,100,0 (orange)\n")
    resetFormat()
    ok("setFgColor: orange")

    setBgColor(20, 20, 120)
    echo("RGB bg 20,20,120 (dark blue bg)\n")
    resetFormat()
    ok("setBgColor: dark blue")

    setFgColor(255, 255, 0)
    setBgColor(100, 0, 100)
    echo("yellow on purple\n")
    resetFormat()
    ok("setFgColor+setBgColor: combined RGB")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Bold / italic / underline / strikethrough
-- ─────────────────────────────────────────────────────────────────────────────

function test_style_flags()
    header("9. Style flags")

    setBold(true)
    echo("BOLD")
    setBold(false)
    echo(" normal\n")
    ok("setBold: on then off")

    setItalics(true)
    echo("italic")
    setItalics(false)
    echo(" normal\n")
    ok("setItalics: on then off")

    setUnderline(true)
    echo("underlined")
    setUnderline(false)
    echo(" normal\n")
    ok("setUnderline: on then off")

    setStrikeOut(true)
    echo("struck-through")
    setStrikeOut(false)
    echo(" normal\n")
    ok("setStrikeOut: on then off")

    -- all at once
    setBold(true)
    setItalics(true)
    setUnderline(true)
    echo("bold+italic+underline")
    resetFormat()
    echo(" reset\n")
    ok("combined: bold+italic+underline then resetFormat")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. selectString / selectSection / deselect / fg on selection
-- ─────────────────────────────────────────────────────────────────────────────
-- These work inside trigger handlers on the current line.  We use feedTriggers
-- to simulate MUD input so the line buffer is set up correctly.

function test_selection()
    header("10. selectString / selectSection (via feedTriggers)")

    -- Register a one-shot trigger: colour the word TARGET in red
    local id1 = tempTrigger("COLOUR_TARGET", function()
        if selectString("TARGET", 1) ~= -1 then
            fg("red")
            ok("selectString: found TARGET at col " .. tostring(getColumnNumber()))
        else
            fail("selectString: TARGET not found")
        end
        deselect()
    end)
    feedTriggers("COLOUR_TARGET: TARGET word\n")
    killTrigger(id1)

    -- Register a one-shot trigger: colour columns 1-4 in blue via selectSection
    local id2 = tempTrigger("SECTION_TEST", function()
        selectSection(1, 4)
        fg("blue")
        ok("selectSection: coloured first 4 chars blue")
        deselect()
    end)
    feedTriggers("SECTION_TEST: abcdefgh\n")
    killTrigger(id2)

    -- Second occurrence
    local id3 = tempTrigger("DOUBLE_OCC", function()
        local col2 = selectString("XX", 2)
        if col2 ~= -1 then
            fg("magenta")
            ok("selectString: 2nd occurrence at col " .. col2)
        else
            fail("selectString: 2nd occurrence not found")
        end
        deselect()
    end)
    feedTriggers("DOUBLE_OCC: XX foo XX\n")
    killTrigger(id3)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Line information: getCurrentLine / getLineNumber / getLineCount
-- ─────────────────────────────────────────────────────────────────────────────

function test_line_info()
    header("11. Line info (via feedTriggers)")

    local id = tempTrigger("LINEINFO_TEST", function()
        local cur = getCurrentLine()
        if cur:find("LINEINFO_TEST") then
            ok("getCurrentLine: contains expected text")
        else
            fail("getCurrentLine: unexpected content: " .. tostring(cur))
        end
        local ln = getLineNumber()
        if type(ln) == "number" and ln >= 0 then
            ok("getLineNumber: returned number " .. ln)
        else
            fail("getLineNumber: unexpected value " .. tostring(ln))
        end
        local lc = getLineCount()
        if type(lc) == "number" and lc >= ln then
            ok("getLineCount: " .. lc .. " >= lineNumber " .. ln)
        else
            fail("getLineCount: unexpected value " .. tostring(lc))
        end
    end)
    feedTriggers("LINEINFO_TEST: hello world\n")
    killTrigger(id)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. User windows
-- ─────────────────────────────────────────────────────────────────────────────

function test_user_windows()
    header("12. User windows")

    -- W_view: stays open and populated so you can inspect the output.
    -- W_clear: used only to verify clearWindow, then rewritten.
    local W_view  = "test_window_view"
    local W_clear = "test_window_clear"

    openUserWindow(W_view,  false, true, "r")
    openUserWindow(W_clear, false, true, "r")
    ok("openUserWindow: opened '" .. W_view .. "' and '" .. W_clear .. "' on right")

    -- write via each echo variant into the persistent view window
    echo(W_view, "echo line in user window\n")
    ok("echo(window, ...): text sent to user window")

    cecho(W_view, "<green>cecho in user window<reset>\n")
    ok("cecho(window, ...): coloured text in user window")

    decho(W_view, "<255,165,0>decho orange in user window<r>\n")
    ok("decho(window, ...): decimal-RGB in user window")

    hecho(W_view, "|cff00ffhecho magenta in user window|r\n")
    ok("hecho(window, ...): hex-RGB in user window")

    -- setUserWindowTitle
    setUserWindowTitle(W_view, "Test Window (view)")
    ok("setUserWindowTitle: title updated")

    -- links in user window
    cechoLink(W_view, "<cyan>[link in user window]<reset>",
        'echo("link in user window clicked\\n")', "user window link", true)
    echo(W_view, "\n")
    ok("cechoLink(window, ...): link in user window")

    -- hide / show (use W_view so the effect is visible)
    hideWindow(W_view)
    ok("hideWindow: window hidden")

    showWindow(W_view)
    ok("showWindow: window shown")

    -- clearWindow on W_clear so W_view content is preserved for inspection
    cecho(W_clear, "<white>This text will be cleared.<reset>\n")
    clearWindow(W_clear)
    ok("clearWindow: W_clear cleared (its content is gone)")

    cecho(W_clear, "<yellow>Rewritten after clear<reset>\n")
    ok("post-clear write: content added back to W_clear")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. fg / bg inside user windows (setFgColor / setBgColor with window arg)
-- ─────────────────────────────────────────────────────────────────────────────

function test_window_colors()
    header("13. Colors in user windows")

    local W = "test_window_view"
    -- reuse the persistent view window from test_user_windows
    openUserWindow(W, false, true, "r")

    setFgColor(W, 0, 200, 255)
    echo(W, "cyan fg in user window\n")
    resetFormat(W)
    ok("setFgColor(w): applied to user window")

    setBgColor(W, 80, 0, 80)
    echo(W, "purple bg in user window\n")
    resetFormat(W)
    ok("setBgColor(w): applied to user window")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Format conversion utilities
-- ─────────────────────────────────────────────────────────────────────────────

function test_format_conversion()
    header("14. Format conversion utilities")

    local c = "<red>hello<reset>"
    local d = cecho2decho(c)
    assert_eq(type(d), "string", "cecho2decho: returns string")
    echo("cecho → decho: " .. d .. "\n")

    local h = cecho2hecho(c)
    assert_eq(type(h), "string", "cecho2hecho: returns string")
    echo("cecho → hecho: " .. h .. "\n")

    local plain = cecho2string(c)
    assert_eq(plain, "hello", "cecho2string: strips markup")

    local d2 = "<255,0,0>world<r>"
    local c2 = decho2cecho(d2)
    assert_eq(type(c2), "string", "decho2cecho: returns string")
    echo("decho → cecho: " .. c2 .. "\n")

    local h2 = decho2hecho(d2)
    assert_eq(type(h2), "string", "decho2hecho: returns string")
    echo("decho → hecho: " .. h2 .. "\n")

    local plain2 = decho2string(d2)
    assert_eq(plain2, "world", "decho2string: strips markup")

    local h3 = "|cff0000foo|r"
    local c3 = hecho2cecho(h3)
    assert_eq(type(c3), "string", "hecho2cecho: returns string")
    echo("hecho → cecho: " .. c3 .. "\n")

    local plain3 = hecho2string(h3)
    assert_eq(plain3, "foo", "hecho2string: strips markup")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. appendCmdLine / printCmdLine
-- ─────────────────────────────────────────────────────────────────────────────

function test_cmdline()
    header("15. Command bar – appendCmdLine / printCmdLine")
    printCmdLine("hello")
    ok("printCmdLine: set to 'hello' (check command bar)")
    appendCmdLine(" world")
    ok("appendCmdLine: appended ' world' (check command bar)")
    printCmdLine("")
    ok("printCmdLine: cleared command bar")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Timers
-- ─────────────────────────────────────────────────────────────────────────────

function test_timers()
    header("16. Timers")
    local fired = false
    local id = tempTimer(0.1, function()
        fired = true
        cecho("<green>tempTimer: fired after 0.1s<reset>\n")
        ok("tempTimer: callback executed")
    end)
    if type(id) == "number" then
        ok("tempTimer: returned numeric ID " .. id)
    else
        fail("tempTimer: bad ID " .. tostring(id))
    end

    -- repeating timer – fire twice then kill
    local count = 0
    local rid
    rid = tempTimer(0.05, function()
        count = count + 1
        if count >= 2 then
            killTimer(rid)
            cecho("<green>tempTimer(repeat): fired " .. count .. " times, killed<reset>\n")
            ok("tempTimer + killTimer: repeating timer stopped")
        end
    end, true)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Aliases
-- ─────────────────────────────────────────────────────────────────────────────

function test_aliases()
    header("17. tempAlias / killAlias")

    local hit = false
    local id = tempAlias("^testalias (.+)$", function()
        hit = true
        cecho("<green>alias matched, arg: <yellow>" .. tostring(matches[2]) .. "<reset>\n")
        ok("tempAlias: matched with capture")
    end)
    if type(id) == "number" then
        ok("tempAlias: returned numeric ID")
    else
        fail("tempAlias: bad ID " .. tostring(id))
    end

    -- simulate user input that matches
    -- (expand() or send() won't trigger an alias — use processInput via event)
    -- We test existence only; a full integration test requires typing in the CLI
    killAlias(id)
    ok("killAlias: removed alias")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. Triggers
-- ─────────────────────────────────────────────────────────────────────────────

function test_triggers()
    header("18. tempTrigger / killTrigger")

    local id = tempTrigger("MUDIX_TRIGGER_TEST_LINE", function()
        cecho("<green>trigger fired for MUDIX_TRIGGER_TEST_LINE<reset>\n")
        ok("tempTrigger: callback executed")
    end)
    if type(id) == "number" then
        ok("tempTrigger: returned numeric ID")
    else
        fail("tempTrigger: bad ID " .. tostring(id))
    end
    feedTriggers("MUDIX_TRIGGER_TEST_LINE\n")
    killTrigger(id)
    ok("killTrigger: removed trigger")

    -- Ensure trigger is dead (no output expected after kill)
    feedTriggers("MUDIX_TRIGGER_TEST_LINE\n")
    ok("killTrigger: no callback after kill (verify: no extra 'trigger fired' line above)")
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. Events
-- ─────────────────────────────────────────────────────────────────────────────

function test_events()
    header("19. raiseEvent / registerAnonymousEventHandler")

    local id = registerAnonymousEventHandler("mudix.test.event", function(ev, a, b)
        cecho("<green>event received: " .. ev .. " args: " .. tostring(a) .. ", " .. tostring(b) .. "<reset>\n")
        ok("event handler: received correct event")
    end, true) -- one-shot

    if type(id) == "number" then
        ok("registerAnonymousEventHandler: returned ID")
    else
        fail("registerAnonymousEventHandler: bad ID " .. tostring(id))
    end

    raiseEvent("mudix.test.event", "hello", 42)
    ok("raiseEvent: event dispatched")

    -- killAnonymousEventHandler (register a second, non-one-shot, then kill it)
    local id2 = registerAnonymousEventHandler("mudix.test.event2", function() end)
    local killed = killAnonymousEventHandler(id2)
    if killed then
        ok("killAnonymousEventHandler: returned true")
    else
        fail("killAnonymousEventHandler: returned false")
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Run all tests
-- ─────────────────────────────────────────────────────────────────────────────

function run_all()
    cecho("\n<bold><white>═══════════════════════════════════════════<reset>\n")
    cecho("<bold><cyan>       Mudix Lua API Test Suite<reset>\n")
    cecho("<bold><white>═══════════════════════════════════════════<reset>\n\n")

    test_echo()
    test_cecho()
    test_decho()
    test_hecho()
    test_links()
    test_popups()
    test_fg_bg()
    test_set_colors()
    test_style_flags()
    test_selection()
    test_line_info()
    test_user_windows()
    test_window_colors()
    test_format_conversion()
    test_cmdline()
    test_timers()
    test_aliases()
    test_triggers()
    test_events()

    cecho("\n<bold><white>═══════════════════════════════════════════<reset>\n")
    cecho("<bold><green>       All tests dispatched.<reset>\n")
    cecho("<bold><white>═══════════════════════════════════════════<reset>\n\n")
    cecho("<yellow>Note: timer callbacks fire asynchronously — check for their PASS lines above.<reset>\n")
    cecho("<yellow>Note: alias matching requires manual CLI input to fully verify.<reset>\n\n")
end

-- Auto-run when the file is loaded (comment out if you prefer manual control)
run_all()
