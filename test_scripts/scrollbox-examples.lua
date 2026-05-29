-- ─────────────────────────────────────────────────────────────────────────────
-- Mudix ScrollBox examples
--
-- createScrollBox([parent,] name, x, y, w, h) makes an absolutely-positioned,
-- scrollable overlay container on a viewport (the main window by default, or a
-- userwindow / another scroll box for nesting). A scroll box is TRANSPARENT and
-- has no border, so an empty one is invisible — you see it once a child widget
-- with some background is created INSIDE it.
--
-- To put a widget inside a box, pass the box's NAME as the widget's parent:
--   createLabel(boxName, labelName, x, y, w, h, fillBackground)
--   createCommandLine(boxName, cmdName, x, y, w, h)
--   createScrollBox(boxName, innerName, x, y, w, h)   -- nested box
-- (coordinates are relative to the box's top-left.)
--
-- The usual window verbs target boxes by name:
--   moveWindow / resizeWindow / showWindow / hideWindow / raiseWindow / lowerWindow
-- deleteScrollBox(name) tears it down and fires sysScrollBoxDeleted(name).
--
-- Load this in a script and call the example functions, or sb_demo_all().
-- sb_cleanup() removes everything the examples create.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. A scroll box with labels parented INTO it (note the box name as the first
--    createLabel arg — that's what makes the labels render inside the box).
function sb_basic()
    createScrollBox("sbBasic", 40, 40, 260, 160)

    -- A filled label that covers the box, giving it a visible background.
    createLabel("sbBasic", "sbBasicBg", 0, 0, 260, 160, true)
    setBackgroundColor("sbBasicBg", 30, 30, 40, 255)
    setLabelStyleSheet("sbBasicBg", "qproperty-alignment: 'AlignLeft | AlignTop'; padding: 6px; color: #cdf;")
    echo("sbBasicBg", "Scroll box 'sbBasic'\n(labels parented into it)")

    -- A second label positioned within the box.
    createLabel("sbBasic", "sbBasicTag", 8, 90, 180, 26, false)
    setBackgroundColor("sbBasicTag", 80, 40, 40, 230)
    echo("sbBasicTag", " a nested label ")
end

-- 2. A scroll box hosting an overlay command line.
function sb_with_cmdline()
    createScrollBox("sbInput", 320, 40, 280, 130)
    createLabel("sbInput", "sbInputBg", 0, 0, 280, 130, true)
    setBackgroundColor("sbInputBg", 20, 35, 20, 255)
    setLabelStyleSheet("sbInputBg", "qproperty-alignment: 'AlignLeft | AlignTop'; padding: 6px; color: #cfc;")
    echo("sbInputBg", "A box with its own command line below:")

    createCommandLine("sbInput", "sbInputCmd", 8, 90, 264, 26)
    setCmdLineAction("sbInputCmd", function(text)
        cecho("<cyan>[sbInput]<reset> you typed: " .. text .. "\n")
    end)
end

-- 3. The idiomatic way: Geyser.ScrollBox parents child Geyser widgets for you —
--    children with `container = box` render (and scroll) inside it.
function sb_geyser()
    sbGeyser = Geyser.ScrollBox:new({
        name = "sbGeyser",
        x = 40, y = 230, width = 300, height = 200,
    })

    Geyser.Label:new({
        name = "sbGeyserTitle",
        x = 0, y = 0, width = "100%", height = 30,
        color = "#222233",
        message = "<center><b>Geyser.ScrollBox</b></center>",
        fgColor = "white",
    }, sbGeyser)

    Geyser.Label:new({
        name = "sbGeyserBody",
        x = 0, y = 34, width = "100%", height = 162,
        color = "#1b1b22",
        message = "Children added with container = sbGeyser\nlive inside this box.",
        fgColor = "#99ccff",
    }, sbGeyser)
end

-- 4. Nested scroll boxes: an inner box created with the outer box as its parent.
function sb_nested()
    createScrollBox("sbOuter", 360, 230, 320, 220)
    createLabel("sbOuter", "sbOuterBg", 0, 0, 320, 220, true)
    setBackgroundColor("sbOuterBg", 25, 25, 25, 255)
    setLabelStyleSheet("sbOuterBg", "qproperty-alignment: 'AlignLeft | AlignTop'; padding: 4px; color: #aaa;")
    echo("sbOuterBg", "Outer box")

    -- parent = "sbOuter" → the inner box is created inside the outer one.
    createScrollBox("sbOuter", "sbInner", 24, 36, 220, 150)
    createLabel("sbInner", "sbInnerBg", 0, 0, 220, 150, true)
    setBackgroundColor("sbInnerBg", 45, 45, 65, 255)
    setLabelStyleSheet("sbInnerBg", "qproperty-alignment: 'AlignCenter'; color: #ddf;")
    echo("sbInnerBg", "Inner box (nested)")
end

-- 4b. OVERFLOW: a box whose children are taller than the box, so a real
--     scrollbar appears. The content box grows to the extent of the children;
--     scroll the box to reveal the lower rows.
function sb_scroll()
    local rows = 14
    local rowH = 30
    createScrollBox("sbScroll", 700, 150, 230, 170)   -- 170px tall...
    -- A backdrop sized to ALL the rows so the whole scroll area is coloured.
    createLabel("sbScroll", "sbScrollBg", 0, 0, 230, rows * rowH, true)
    setBackgroundColor("sbScrollBg", 18, 22, 30, 255)
    for i = 1, rows do                                 -- ...but 14*30 = 420px of rows
        local n = "sbScrollRow" .. i
        createLabel("sbScroll", n, 6, (i - 1) * rowH + 3, 200, rowH - 6, true)
        setBackgroundColor(n, 30 + i * 6, 40, 70, 255)
        echo(n, "  row " .. i .. " of " .. rows .. " — scroll me ↓")
    end
    cecho("<cyan>sbScroll:<reset> " .. rows .. " rows in a 170px box — drag the scrollbar.\n")
end

-- 5. Drive a box with the window verbs (move / resize / show / hide / raise).
function sb_controls()
    if not sbGeyser then sb_geyser() end
    moveWindow("sbGeyser", 60, 250)        -- reposition
    resizeWindow("sbGeyser", 340, 240)     -- resize
    raiseWindow("sbGeyser")                -- bring to front
    cecho("<green>sbGeyser moved/resized/raised. windowType = " .. tostring(windowType("sbGeyser")) .. "<reset>\n")
    tempTimer(1.5, [[ hideWindow("sbGeyser"); cecho("<yellow>sbGeyser hidden<reset>\n") ]])
    tempTimer(3.0, [[ showWindow("sbGeyser"); cecho("<yellow>sbGeyser shown again<reset>\n") ]])
end

-- 6. Listen for teardown, then delete a box.
function sb_delete_demo()
    registerAnonymousEventHandler("sysScrollBoxDeleted", function(_, name)
        cecho("<magenta>sysScrollBoxDeleted:<reset> " .. name .. "\n")
    end)
    createScrollBox("sbScratch", 700, 40, 140, 90)
    createLabel("sbScratch", "sbScratchBg", 0, 0, 140, 90, true)
    setBackgroundColor("sbScratchBg", 60, 30, 60, 255)
    echo("sbScratchBg", "deleting in 1s…")
    tempTimer(1.0, [[ deleteLabel("sbScratchBg"); deleteScrollBox("sbScratch") ]])
end

-- Run every example.
function sb_demo_all()
    sb_basic()
    sb_with_cmdline()
    sb_geyser()
    sb_nested()
    sb_scroll()
    sb_controls()
    sb_delete_demo()
    cecho("<cyan>All scroll-box examples created. Call sb_cleanup() to remove them.<reset>\n")
end

-- Remove everything the examples create.
function sb_cleanup()
    for _, n in ipairs({ "sbBasicBg", "sbBasicTag", "sbInputBg", "sbInnerBg", "sbOuterBg", "sbScratchBg", "sbScrollBg" }) do
        pcall(deleteLabel, n)
    end
    for i = 1, 14 do pcall(deleteLabel, "sbScrollRow" .. i) end
    pcall(deleteCommandLine, "sbInputCmd")
    for _, n in ipairs({ "sbBasic", "sbInput", "sbInner", "sbOuter", "sbScratch", "sbScroll" }) do
        pcall(deleteScrollBox, n)
    end
    if sbGeyser then pcall(function() sbGeyser:hide() end); sbGeyser = nil end
    pcall(deleteScrollBox, "sbGeyser")
    cecho("<green>scroll-box examples cleaned up.<reset>\n")
end
