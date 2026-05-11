// Qt::CursorShape enum (mirrors src/scripting/lua/mudlet-lua/CursorShapes.lua)
// → CSS cursor keyword. -1 ('Reset') is handled by the caller and not in the
// table. Drag* shapes degrade to plain 'move'/'copy'/'alias' since the DOM has
// no exact equivalents. Blank → 'none' hides the cursor entirely.
export const QT_CURSOR_TO_CSS: Record<number, string> = {
    0: 'default',         // Arrow
    1: 'default',         // UpArrow            (no good DOM match)
    2: 'crosshair',       // Cross
    3: 'wait',            // Wait
    4: 'text',            // IBeam
    5: 'ns-resize',       // ResizeVertical
    6: 'ew-resize',       // ResizeHorizontal
    7: 'nesw-resize',     // ResizeTopRight
    8: 'nwse-resize',     // ResizeTopLeft
    9: 'move',            // ResizeAll
    10: 'none',           // Blank
    11: 'col-resize',     // VerticalSplit
    12: 'row-resize',     // HorizontalSplit
    13: 'pointer',        // PointingHand
    14: 'not-allowed',    // Forbidden
    15: 'help',           // WhatsThis
    16: 'progress',       // Busy
    17: 'grab',           // OpenHand
    18: 'grabbing',       // ClosedHand
    19: 'copy',           // DragCopy
    20: 'move',           // DragMove
    21: 'alias',          // DragLink
};

/** Reverse map of Mudlet's `mudlet.cursor` table (CursorShapes.lua). Used so
 *  setLabelCursor accepts the string name directly without requiring the
 *  bundled GUIUtils.lua wrapper to be loaded. -1 ('Reset') clears the cursor.
 */
export const QT_CURSOR_NAME_TO_INT: Record<string, number> = {
    Reset: -1,
    Arrow: 0,
    UpArrow: 1,
    Cross: 2,
    Wait: 3,
    IBeam: 4,
    ResizeVertical: 5,
    ResizeHorizontal: 6,
    ResizeTopRight: 7,
    ResizeTopLeft: 8,
    ResizeAll: 9,
    Blank: 10,
    VerticalSplit: 11,
    HorizontalSplit: 12,
    PointingHand: 13,
    Forbidden: 14,
    WhatsThis: 15,
    Busy: 16,
    OpenHand: 17,
    ClosedHand: 18,
    DragCopy: 19,
    DragMove: 20,
    DragLink: 21,
};
