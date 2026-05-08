import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

// ── Completion item helpers ───────────────────────────────────────────────────

function fn(label: string, detail: string, info?: string): Completion {
    return { label, type: 'function', detail, info };
}
function variable(label: string, info?: string): Completion {
    return { label, type: 'variable', info };
}
function ns(label: string, info?: string): Completion {
    return { label, type: 'namespace', info };
}
function kw(label: string): Completion {
    return { label, type: 'keyword' };
}

// ── mudix.windows ─────────────────────────────────────────────────────────────

const MUDIX_WINDOWS: Completion[] = [
    fn('open',     '(id, options?)',   'Open a user window panel'),
    fn('write',    '(id, text)',       'Write raw ANSI text to a window'),
    fn('cecho',    '(id, text)',       'Write with Mudlet color tags to a window'),
    fn('decho',    '(id, text)',       'Write with decimal RGB colors to a window'),
    fn('hecho',    '(id, text)',       'Write with hex RGB colors to a window'),
    fn('clear',    '(id)',             'Clear a window'),
    fn('setTitle', '(id, title)',      'Set the title of a window'),
    fn('close',    '(id)',             'Close a window'),
    fn('has',      '(id) → boolean',  'Check if a window exists'),
];

// ── mudix.timers ──────────────────────────────────────────────────────────────

const MUDIX_TIMERS: Completion[] = [
    fn('after', '(seconds, fn, repeat?)', 'Create a timer; pass true as 3rd arg to repeat'),
    fn('kill',  '(id)',                   'Cancel a timer by id'),
];

// ── mudix.aliases ─────────────────────────────────────────────────────────────

const MUDIX_ALIASES: Completion[] = [
    fn('add',    '(pattern, fn) → id', 'Register a temporary alias; returns its id'),
    fn('remove', '(id)',               'Remove a temporary alias'),
];

// ── mudix.triggers ────────────────────────────────────────────────────────────

const MUDIX_TRIGGERS: Completion[] = [
    fn('add',    '(pattern, fn) → id', 'Register a temporary trigger; returns its id'),
    fn('remove', '(id)',               'Remove a temporary trigger'),
];

// ── mudix.keys ────────────────────────────────────────────────────────────────

const MUDIX_KEYS: Completion[] = [
    fn('add',    '(key, modifiers?, fn) → id', 'Register a keybinding. key: web code string (e.g. "F1", "KeyA"). modifiers: optional table e.g. {"ctrl","shift"}'),
    fn('remove', '(id)',                       'Remove a temporary keybinding'),
];

// ── io ────────────────────────────────────────────────────────────────────────

const IO_COMPLETIONS: Completion[] = [
    fn('open',  '(filename, mode?) → file',  'Open a file. mode: "r" (default), "w", "a", "r+", "w+", "a+"'),
    fn('close', '([file])',                   'Close a file handle'),
    fn('lines', '(filename, fmt?)',           'Iterate lines of a file'),
    fn('type',  '(obj) → string|nil',        'Return "file", "closed file", or nil'),
];

// ── lfs ───────────────────────────────────────────────────────────────────────

const LFS_COMPLETIONS: Completion[] = [
    fn('mkdir',      '(path) → true|nil,err',          'Create a directory (recursive)'),
    fn('rmdir',      '(path) → true|nil,err',          'Remove a directory'),
    fn('dir',        '(path) → iterator',              'Iterate directory entries'),
    fn('attributes', '(path, [attr]) → table|value',  'Get file/directory attributes (mode, size, modification, access)'),
    fn('currentdir', '() → string',                   'Get current working directory'),
    fn('chdir',      '(path) → true|nil,err',          'Change current working directory'),
    fn('touch',      '(path)',                         'Create file if it does not exist'),
];

// ── mudix (top-level) ─────────────────────────────────────────────────────────

const MUDIX_TOP: Completion[] = [
    fn('send',         '(text)',        'Send a command to the MUD'),
    fn('echo',         '(text)',        'Print plain text to main output'),
    fn('cecho',        '(text)',        'Print with Mudlet color tags  e.g. <red>text<reset>'),
    fn('decho',        '(text)',        'Print with decimal RGB colors  e.g. <255,0,0>text'),
    fn('hecho',        '(text)',        'Print with hex RGB colors  e.g. #FF0000text'),
    fn('fg',           '(colorName)',   'Set foreground color by name'),
    fn('bg',           '(colorName)',   'Set background color by name'),
    fn('resetFormat',  '()',            'Reset all text formatting'),
    fn('feedTriggers', '(text)',        'Feed text through the trigger pipeline'),
    fn('deleteLine',   '([window])',    'Delete the current trigger line'),
    fn('appendCmdLine','(text)',        'Append text to the command bar'),
    fn('printCmdLine', '(text)',        'Set the command bar contents'),
    fn('clearCmdLine', '()',            'Clear the command bar'),
    fn('printerror',   '(text)',        'Print an error message'),
    fn('on',           '(event, fn)',   "Register event handler. Events: 'connect' 'disconnect' 'output' 'gmcp'"),
    fn('off',          '(event, fn)',   'Remove a previously registered event handler'),
    ns('windows',  'Window management API'),
    ns('timers',   'Timer API'),
    ns('aliases',  'Alias API'),
    ns('triggers', 'Trigger API'),
    ns('keys',     'Keybinding API'),
];

// ── string extensions ─────────────────────────────────────────────────────────

const STRING_EXT: Completion[] = [
    fn('format',  '(fmt, ...) → string',         'Format a string (printf-style)'),
    fn('len',     '(s) → number',                'Length of string'),
    fn('sub',     '(s, i, j?) → string',         'Substring'),
    fn('find',    '(s, pattern, init?, plain?)', 'Find pattern in string'),
    fn('match',   '(s, pattern, init?)',         'Match pattern, return captures'),
    fn('gmatch',  '(s, pattern)',                'Iterator over all matches'),
    fn('gsub',    '(s, pattern, repl, n?)',      'Global substitution'),
    fn('byte',    '(s, i?, j?)',                 'Return numeric codes of characters'),
    fn('char',    '(...) → string',              'Build string from char codes'),
    fn('rep',     '(s, n, sep?) → string',       'Repeat string'),
    fn('lower',   '(s) → string',               'Convert to lowercase'),
    fn('upper',   '(s) → string',               'Convert to uppercase'),
    fn('reverse', '(s) → string',               'Reverse a string'),
    // Mudlet extensions
    fn('split',    '(s, sep) → table',   'Split string by separator'),
    fn('starts',   '(s, prefix) → bool', 'Check if string starts with prefix'),
    fn('ends',     '(s, suffix) → bool', 'Check if string ends with suffix'),
    fn('trim',     '(s) → string',       'Strip leading/trailing whitespace'),
    fn('contains', '(s, sub) → bool',   'Check if string contains substring'),
];

// ── table extensions ──────────────────────────────────────────────────────────

const TABLE_EXT: Completion[] = [
    fn('insert',   '(t, [pos,] v)',      'Insert element into table'),
    fn('remove',   '(t, [pos])',         'Remove element from table'),
    fn('concat',   '(t, sep?, i?, j?)', 'Concatenate table elements'),
    fn('sort',     '(t, comp?)',         'Sort table in-place'),
    fn('unpack',   '(t, i?, j?)',        'Unpack table into arguments'),
    fn('move',     '(a1, f, e, t, a2?)','Move table elements'),
    // Mudlet extensions
    fn('contains', '(t, val) → bool',   'Check if table contains a value'),
    fn('size',     '(t) → number',      'Count all entries in a table (incl. non-sequential)'),
];

// ── math ──────────────────────────────────────────────────────────────────────

const MATH_EXT: Completion[] = [
    fn('abs',        '(x)',       'Absolute value'),
    fn('ceil',       '(x)',       'Round up'),
    fn('floor',      '(x)',       'Round down'),
    fn('sqrt',       '(x)',       'Square root'),
    fn('max',        '(...)',     'Maximum value'),
    fn('min',        '(...)',     'Minimum value'),
    fn('random',     '(m?, n?)', 'Random number'),
    fn('randomseed', '(x)',      'Seed random number generator'),
    fn('sin',        '(x)',      'Sine'),
    fn('cos',        '(x)',      'Cosine'),
    fn('tan',        '(x)',      'Tangent'),
    fn('atan',       '(y, x?)', 'Arctangent'),
    fn('exp',        '(x)',      'e^x'),
    fn('log',        '(x, b?)', 'Logarithm'),
    fn('fmod',       '(x, y)',  'Floating-point modulo'),
    fn('huge',       '',        'Positive infinity (math.huge)'),
    fn('pi',         '',        'Pi constant'),
    fn('maxinteger', '',        'Maximum integer value'),
    fn('mininteger', '',        'Minimum integer value'),
    fn('type',       '(x)',     'Return "integer", "float", or false'),
    fn('tointeger',  '(x)',     'Convert to integer, or nil'),
];

// ── Lua keywords ──────────────────────────────────────────────────────────────

const LUA_KEYWORDS: Completion[] = [
    'and','break','do','else','elseif','end','false','for','function',
    'goto','if','in','local','nil','not','or','repeat','return',
    'then','true','until','while',
].map(kw);

// ── Standard global functions ─────────────────────────────────────────────────

const LUA_GLOBALS: Completion[] = [
    fn('assert',       '(v, msg?)',        'Raise error if v is falsy'),
    fn('error',        '(msg, level?)',    'Raise an error'),
    fn('ipairs',       '(t)',              'Iterator for sequential table'),
    fn('pairs',        '(t)',              'Iterator for all table keys'),
    fn('pcall',        '(fn, ...)',        'Protected call; returns ok, result'),
    fn('xpcall',       '(fn, handler, ...)','Protected call with error handler'),
    fn('select',       '(index, ...)',     'Select from varargs'),
    fn('setmetatable', '(t, mt)',          'Set metatable on table'),
    fn('getmetatable', '(t)',              'Get metatable'),
    fn('rawget',       '(t, k)',           'Get without __index'),
    fn('rawset',       '(t, k, v)',        'Set without __newindex'),
    fn('rawequal',     '(a, b)',           'Equality without metamethod'),
    fn('rawlen',       '(t)',              'Length without __len'),
    fn('tostring',     '(x)',              'Convert to string'),
    fn('tonumber',     '(x, base?)',       'Convert to number'),
    fn('type',         '(x)',              'Return type name'),
    fn('unpack',       '(t, i?, j?)',      'Unpack table (Lua 5.1 compat alias)'),
    fn('next',         '(t, k?)',          'Next key/value pair in table'),
    fn('require',      '(modname)',        'Load a module'),
    fn('print',        '(...)',            'Print to stdout (use echo() for MUD output)'),
    variable('_G',     'Global environment table'),
    variable('_VERSION', 'Lua version string'),
    ns('string', 'String library'),
    ns('table',  'Table library'),
    ns('math',   'Math library'),
    ns('io',     'I/O library'),
    ns('os',     'OS library'),
    ns('utf8',   'UTF-8 library'),
];

// ── Mudlet-compatible globals ─────────────────────────────────────────────────

const MUDLET_GLOBALS: Completion[] = [
    // Output
    fn('send',         '(text)',           'Send a command to the MUD'),
    fn('sendAll',      '(...)',            'Send multiple commands'),
    fn('sendGMCP',     '(message)',        'Send a GMCP message (e.g. `Module.Sub args`)'),
    fn('denyCurrentSend', '()',            'Inside a sysDataSendRequest handler, cancels the in-flight command'),
    fn('echo',         '([window,] text)', 'Print plain text (optional window name as 1st arg)'),
    fn('cecho',        '([window,] text)', 'Print with Mudlet color tags'),
    fn('decho',        '([window,] text)', 'Print with decimal RGB colors'),
    fn('hecho',        '([window,] text)', 'Print with hex RGB colors'),
    fn('fg',           '(colorName)',      'Set foreground color'),
    fn('bg',           '(colorName)',      'Set background color'),
    fn('resetFormat',  '()',               'Reset text formatting'),
    fn('feedTriggers', '(text)',           'Feed text through triggers'),
    fn('deleteLine',   '([window])',       'Delete current trigger line'),
    fn('insertText',   '(text)',           'Insert text at trigger cursor'),
    fn('display',      '(...)',             'Pretty-print each argument to output'),
    fn('printError',   '(text)',           'Print an error message'),
    // Windows
    fn('openUserWindow',  '(name, restoreLayout?, autoDock?, dockingArea?)', 'Open a user window'),
    fn('openMapWidget',   '([area | x, y, w, h])',                          'Open the map widget. No args: saved layout (right by default). One arg: dock area "f"/"l"/"r"/"t"/"b". Four args: floating at x,y with size w,h.'),
    fn('createMiniConsole', '([parent,] name, x, y, w, h) → bool', 'Create a positioned floating text panel; calling again repositions it'),
    fn('clearWindow',     '([name])',      'Clear window contents'),
    fn('setUserWindowTitle', '(name, title)', 'Set user window title'),
    fn('setUserWindowStyleSheet', '(name, css)', 'Apply Qt-style CSS to a userwindow. Not yet implemented; calls are ignored with a console warning.'),
    fn('hideWindow',      '(name)',        'Hide a userwindow or label'),
    fn('showWindow',      '(name)',        'Show a userwindow or label'),
    fn('moveWindow',      '(name, x, y)',  'Move a userwindow or label to a pixel position'),
    fn('resizeWindow',    '(name, w, h)',  'Resize a userwindow or label'),
    fn('setBackgroundColor', '([name,] r, g, b [, a])', 'Set a window background color (rgba 0..255). No name targets the main window. A name targets a userwindow, miniconsole, or label (labels also implicitly enable fillBackground).'),
    fn('getBackgroundColor', '([name]) → r, g, b, a', 'Get a window background color (rgba 0..255). No name returns the main window color; otherwise targets a userwindow, miniconsole, or label. Returns 0,0,0,255 when no color is set.'),
    fn('getMainWindowSize', '() → w, h',   'Main output area pixel size (live element box). Falls back to browser inner size if the main output is not mounted.'),
    fn('getUserWindowSize', '(name) → w, h', 'Userwindow / miniconsole pixel size. Reports the live rendered box when mounted, else the stored hint. Returns 0,0 when the window does not exist.'),
    fn('setFontSize',       '([window,] size) → bool',  'Set the output font size (1..99). No window arg targets the main output (persists in settings); a window name targets a userwindow or miniconsole.'),
    fn('getFontSize',       '([window]) → number|false','Get the configured output font size in pixels. No window arg returns the main size; a window name returns its override (or the main size if none).'),
    fn('setFont',           '([window,] family) → bool','Set the output font family. No window arg targets the main output (persists in settings as a system font); a window name targets a userwindow or miniconsole. Empty string clears the override.'),
    fn('getFont',           '([window]) → string|false','Get the configured output font family. No window arg returns the main font; a window name returns its override (or the main font if none).'),
    // Borders
    fn('setBorderTop',     '(size)',         'Carve a top border (in pixels) out of the main window for label placement.'),
    fn('setBorderBottom',  '(size)',         'Carve a bottom border (in pixels) out of the main window for label placement.'),
    fn('setBorderLeft',    '(size)',         'Carve a left border (in pixels) out of the main window for label placement.'),
    fn('setBorderRight',   '(size)',         'Carve a right border (in pixels) out of the main window for label placement.'),
    fn('setBorderSizes',   '(size | top, right, bottom, left)', 'Set all four border sizes at once. One arg = uniform; four args = CSS-style top/right/bottom/left.'),
    fn('getBorderTop',     '() → number',    'Pixel size of the main window top border.'),
    fn('getBorderBottom',  '() → number',    'Pixel size of the main window bottom border.'),
    fn('getBorderLeft',    '() → number',    'Pixel size of the main window left border.'),
    fn('getBorderRight',   '() → number',    'Pixel size of the main window right border.'),
    fn('getBorderSizes',   '() → {top, right, bottom, left}', 'Get all four main window border sizes as a table.'),
    fn('setBorderColor',   '(r, g, b [, a])','Fill the carved border area with an rgba color (0..255). Alpha defaults to 255.'),
    fn('resetBorderColor', '()',             'Clear the border fill color so the border area inherits the page background.'),
    // Cmd line
    fn('appendCmdLine', '(text)',          'Append to command bar'),
    fn('printCmdLine',  '(text)',          'Set command bar contents'),
    fn('clearCmdLine',  '()',              'Clear the command bar'),
    fn('addCommandLineMenuEvent',    '(uniqueName, event [, displayName])', 'Add a context-menu entry to the command bar; clicking raises event(text)'),
    fn('removeCommandLineMenuEvent', '(uniqueName)',                        'Remove a previously registered command-line menu entry'),
    fn('getCommandLineMenuEvents',   '() → {uniqueName = {event, display}}','Return all registered command-line menu entries'),
    // Packages
    fn('installPackage',   '(path|url)',    'Install a Mudlet .mpackage / .zip / .xml from a VFS path or URL'),
    fn('uninstallPackage', '(name)',        'Uninstall a previously installed package by name'),
    fn('getPackages',      '() → {name1, name2, ...}', 'Return a 1-indexed list of installed package names'),
    fn('unzipAsync',       '(zipPath, destDir)', 'Extract a zip into destDir; raises sysUnzipDone / sysUnzipError'),
    // Script toggling
    fn('enableScript',     '(name)',        'Enable a script by name'),
    fn('disableScript',    '(name)',        'Disable a script by name'),
    fn('permScript',       '(name, parent, code) → id',
        'Create a persistent Lua script under parent group (""=root). Returns the new id, or -1 if parent is given but no script group with that name exists.'),
    fn('setScript',        '(name, code, [pos]) → true|-1',
        'Replace the source of the pos-th (1-indexed, default 1) script named name. Returns true on success, -1 if no such script exists.'),
    // Trigger toggling
    fn('enableTrigger',    '(name)',        'Enable triggers (and groups) matching name; cascades to children'),
    fn('disableTrigger',   '(name)',        'Disable triggers (and groups) matching name; cascades to children'),
    fn('enableTimer',      '(name)',        'Enable timers (and groups) matching name; cascades to children'),
    fn('disableTimer',     '(name)',        'Disable timers (and groups) matching name; cascades to children'),
    fn('exists',           '(name, type) → number', 'Count items with the given name. type: "alias", "trigger", "timer", "key"/"keybind", "button", "script"'),
    // Cursor / line inspection
    fn('getCurrentLine',  '([window])',    'Get current trigger line text'),
    fn('getLineNumber',   '([window])',    'Get cursor line number'),
    fn('getLineCount',    '([window])',    'Get total line count'),
    fn('getLastLineNumber', '([window])',  'Get line number of the last line in the buffer'),
    fn('getColumnNumber', '([window])',    'Get cursor column'),
    fn('getColumnCount',  '([window]) → number', 'Get the column count of a window. Returns the wrap width set by setWindowWrap, or the measured fit-count of the rendered area when no wrap is set.'),
    fn('setWindowWrap',   '([window,] cols) → bool', 'Set the visual line-wrap width (in monospace columns) for a window. Pass 0 to clear. Without a window name targets "main".'),
    fn('getLines',        '([window,] from, to)',  'Get range of lines as table'),
    fn('isPrompt',        '()',            'True if current line is a MUD prompt'),
    fn('moveCursorUp',    '([window])',    'Move cursor up one line'),
    fn('moveCursorDown',  '([window])',    'Move cursor down one line'),
    fn('moveCursor',      '([window,] x, y)',              'Move cursor to position'),
    fn('selectString',    '([window,] text, occurrence)', 'Select Nth occurrence of text on current line; returns column index or -1'),
    fn('selectSection',   '([window,] from, length)',     'Select text by column position and length'),
    fn('deselect',        '([window])',                   'Clear the current selection'),
    // Timers
    fn('tempTimer',      '(seconds, fn, repeat?)', 'Create a timer (one-shot or repeating)'),
    fn('killTimer',      '(id)',           'Cancel a timer'),
    // Aliases
    fn('tempAlias',      '(pattern, fn) → id', 'Create a temporary alias'),
    fn('killAlias',      '(id)',           'Remove an alias'),
    // Triggers
    fn('tempTrigger',    '(pattern, fn, expirationCount?) → id', 'Create a temporary trigger. expirationCount: positive N auto-kills after N fires; omitted/<=0 = unlimited'),
    fn('tempRegexTrigger','(regex, fn, expirationCount?) → id', 'Create a temporary regex trigger. expirationCount: positive N auto-kills after N fires; omitted/<=0 = unlimited'),
    fn('killTrigger',    '(id)',           'Remove a trigger'),
    fn('tempLineTrigger','(linesAhead, count, code)', 'Trigger N lines ahead'),
    // Keys
    fn('tempKey',        '(modifier, key, fn) → id',  'Create a temporary keybinding. modifier: Qt bitflag (0=none, 67108864=Ctrl, 33554432=Shift, 134217728=Alt). key: Qt::Key int or web code string'),
    fn('killKey',        '(id)',                       'Remove a keybinding'),
    // Events
    // File system
    fn('getMudixProfilePath', '() → string',        'Returns the VFS profile root path for this connection'),
    fn('getMudletHomeDir',   '() → string',        'Mudlet-compatible alias for getMudixProfilePath()'),
    fn('getMudletVersion',   '([mode]) → version', 'Mudlet version. No arg → {major, minor, revision, build} table. "string" → "X.Y.Z". "major"/"minor"/"revision"/"build" → field. "table" → major, minor, revision as 3 return values'),
    fn('saveProfile',        '([location]) → true, path', 'Force pending profile data (VFS files, SQL snapshots) through to durable storage. zustand state auto-saves on every change so this is a no-op for triggers/aliases/scripts; useful after io.open/db: writes. The optional location arg is accepted for Mudlet compatibility but ignored.'),
    fn('loadRawFile',        '(path) → string',    'Read entire file from VFS and return its contents'),
    fn('loadfile',           '(filename)',          'Load a Lua file from VFS'),
    fn('dofile',             '(filename)',          'Load and execute a Lua file from VFS'),
    // Events
    fn('raiseEvent',                    '(name, ...)',       'Fire a named event'),
    fn('registerAnonymousEventHandler', '(name, fn) → id',  'Register an event handler, returns an ID'),
    fn('killAnonymousEventHandler',     '(id) → bool',       'Remove an event handler by ID'),
    // Formatting
    fn('setUnderline',      '(bool)',                          'Toggle underline text formatting'),
    fn('moveCursorEnd',     '([windowName])',                  'Move cursor to end of current line'),
    fn('openWebPage',       '(url)',                           'Open a URL in the browser'),
    // Links
    fn('echoLink',          '([window,] text, cmd, tooltip [, useCurrentFmt])', 'Echo clickable link text'),
    fn('cechoLink',         '([window,] colorText, cmd, tooltip [, useCurrentFmt])', 'Echo colored clickable link text'),
    // Map
    fn('centerview',           '(roomId)',                         'Center map on a room'),
    fn('loadMap',              '([location]) → bool',              'Load a Mudlet binary `.dat` map from a VFS path; persists to IndexedDB and re-renders the panel. With no path, reloads from already-stored bytes. Returns false on a missing/unreadable/unparseable file.'),
    fn('getRoomIDbyHash',      '(hash) → id|nil',                 'Look up a room ID by its hash string'),
    fn('createRoomID',         '() → id',                         'Get the next available room ID'),
    fn('addRoom',              '(id) → bool',                     'Create a new room'),
    fn('deleteRoom',           '(id)',                             'Delete a room'),
    fn('roomExists',           '(id) → bool',                     'Check if a room exists'),
    fn('getRoomName',          '(id) → name',                     'Get a room name'),
    fn('setRoomName',          '(id, name)',                       'Set a room name'),
    fn('getRoomArea',          '(id) → areaId',                   'Get the area a room belongs to'),
    fn('setRoomArea',          '(id, areaId)',                     'Move a room to an area'),
    fn('getRoomCoordinates',   '(id) → x, y, z',                  'Get room coordinates'),
    fn('setRoomCoordinates',   '(id, x, y, z)',                    'Set room coordinates'),
    fn('getRoomsByPosition',   '(areaId, x, y, z) → {0=id,...}',  'Get rooms at a position'),
    fn('setRoomIDbyHash',      '(id, hash)',                       'Set the hash for a room'),
    fn('getRoomHashByID',      '(id) → hash|nil',                  'Get the hash for a room'),
    fn('getRoomExits',         '(id) → {dir=toId}',               'Get room exits'),
    fn('setExit',              '(from, to, dir)',                   'Set an exit (dir 1-12, to=-1 removes)'),
    fn('getExitStubs',         '(id) → {dir,...}',                 'Get stub direction numbers'),
    fn('setExitStub',          '(id, dir, bool)',                   'Set or clear an exit stub'),
    fn('addSpecialExit',       '(from, to, cmd)',                   'Add a special/portal exit'),
    fn('removeSpecialExit',    '(from, cmd)',                       'Remove a special exit'),
    fn('getSpecialExitsSwap',  '(id) → {cmd=toId}',               'Get special exits (cmd→toId)'),
    fn('getDoors',             '(id) → {dir=val}',                 'Get doors on a room'),
    fn('setDoor',              '(id, dir, val)',                    'Set a door (0=none,1=open,2=closed,3=locked)'),
    fn('getRoomUserData',      '(id, key) → value',                'Get custom room data'),
    fn('setRoomUserData',      '(id, key, value)',                  'Set custom room data'),
    fn('getMapUserData',       '(key) → value',                    "Get a value from the map's free-form user-data dict (returns '' if unset)"),
    fn('setMapUserData',       '(key, value) → true',              "Set a value in the map's free-form user-data dict"),
    fn('clearMapUserData',     '(key) → bool',                     'Remove a key from map user-data; returns true if it existed'),
    fn('getAllMapUserData',    '() → {key=value}',                 'Get a snapshot of the entire map user-data dict'),
    fn('getRoomEnv',           '(id) → envId',                     'Get room environment'),
    fn('setRoomEnv',           '(id, envId)',                       'Set room environment'),
    fn('getRoomChar',          '(id) → char',                      'Get room symbol/character'),
    fn('setRoomChar',          '(id, char)',                        'Set room symbol/character'),
    fn('addAreaName',          '(name) → areaId',                  'Create a new area'),
    fn('deleteArea',           '(areaId)',                          'Delete an area and its rooms'),
    fn('getAreaTable',         '() → {name=id}',                   'Get all areas (name→id)'),
    fn('getRoomAreaName',      '(areaId) → name',                  'Get an area name'),
    fn('setAreaName',          '(areaId, name)',                    'Rename an area'),
    fn('getAreaRooms',         '(areaId) → {0=id,...}',            'Get all room IDs in an area'),
    fn('getRooms',             '() → {id=name}',                   'Get all rooms in the map (id→name)'),
    fn('addMapEvent',          '(uniqueName, eventName [, parent [, displayName [, ...args]]]) → bool',
       "Add an entry to the map's right-click context menu. On click, raises eventName with the right-clicked roomId as the first arg, followed by your extra args. Pass another entry's uniqueName as `parent` to nest as a submenu."),
    fn('removeMapEvent',       '(uniqueName) → bool',              'Remove a previously registered map context-menu entry. Returns true if the entry existed.'),
    fn('getMapEvents',         '() → {uniqueName = {event,parent,display,args}}',
       'Get all registered map context-menu entries.'),
    fn('setCustomEnvColor',    '(envID, r, g, b [, a])',           'Set a custom environment color used to paint rooms whose env matches envID'),
    fn('getCustomEnvColor',    '(envID) → r, g, b, a | nil',       'Return the registered RGBA for a custom env, or nil if none'),
    // Gauges
    fn('createGauge',         '([window,] name, w, h, x, y, text, r, g, b [, orientation])',
       'Create a gauge overlay. Color may also be a name. Orientation: horizontal (default), vertical, goofy (right→left), batty (top→bottom).'),
    fn('setGauge',            '(name, current, max [, text])',     'Set gauge fill ratio (current/max) and optional text'),
    fn('setGaugeText',        '(name, text [, r, g, b])',          'Set gauge text. Color args optional; accepts r,g,b or color name'),
    fn('moveGauge',           '(name, x, y)',                      'Move a gauge to a new position'),
    fn('resizeGauge',         '(name, width, height)',             'Resize a gauge'),
    fn('showGauge',           '(name)',                            'Show a hidden gauge'),
    fn('hideGauge',           '(name)',                            'Hide a gauge'),
    fn('destroyGauge',        '(name)',                            'Destroy a gauge'),
    fn('setGaugeStyleSheet',  '(name, css [, cssBack [, cssText]])', 'Apply CSS to gauge layers (front, back, text)'),
    // Labels
    fn('createLabel',         '([window,] name, x, y, w, h, fillBackground [, clickThrough]) → bool',
       'Create a positioned overlay label on the parent window (default "main"). fillBackground and clickThrough accept 0/1 or true/false. Returns true on success, false if a label with that name already exists.'),
    fn('deleteLabel',         '(name) → bool',                       'Destroy a label by name. Returns true if the label existed.'),
    fn('setLabelStyleSheet',  '(name, css)',                         'Apply a Qt-style CSS string to a label. Background-color/border/font-size/etc. translate; Qt-specific selectors are dropped.'),
    fn('setLabelClickCallback','(name, fn)',
       'Install a click handler on a label. fn may be a function or a Lua code string (compiled with loadstring). Replacing the callback leaks the prior closure in the registry.'),
    fn('setLabelToolTip',     '(name, text [, duration])',           'Set a tooltip on a label. duration is accepted for Mudlet compatibility but ignored (HTML title attribute has no per-tooltip duration).'),
    fn('resetLabelToolTip',   '(name)',                              'Clear a label tooltip.'),
    fn('enableClickthrough',  '(name)',                              'Make a label pass mouse events through to whatever is underneath.'),
    fn('disableClickthrough', '(name)',                              'Re-enable mouse interception on a label.'),
    fn('raiseLabel',          '(name)',                              'Raise a label above all other labels (z-index).'),
    fn('lowerLabel',          '(name)',                              'Lower a label below all other labels (z-index).'),
    fn('setLabelCursor',      '(name, shape)',                       'Set the mouse cursor over a label. shape is a Qt::CursorShape int (or string name; see mudlet.cursor). -1 resets.'),
    fn('resetLabelCursor',    '(name)',                              'Restore the default cursor on a label.'),
    // rex
    ns('rex', 'PCRE-compatible regex module: rex.match(), rex.find(), rex.new()'),
    // Globals / tables
    variable('gmcp',         'GMCP state table — auto-populated from server packets'),
    variable('matches',      'Regex captures in trigger/alias context: [full, cap1, cap2, ...]'),
    variable('line',         'Current trigger line text'),
    variable('multimatches', 'Multiline trigger captures'),
    variable('color_table',  'Mudlet color table: { colorName = {r, g, b} }'),
];

// ── Global completions (everything available at top level) ────────────────────

const GLOBAL_COMPLETIONS: Completion[] = [
    ...LUA_KEYWORDS,
    ...LUA_GLOBALS,
    ...MUDLET_GLOBALS,
];

// ── Reference groups (for the "?" reference panel) ────────────────────────────
// These map dotted prefixes onto the underlying completion arrays so the
// reference UI stays in sync with autocomplete without duplicating data.

export interface ReferenceGroup {
    title:   string;        // e.g. "mudix.windows", "string", "globals"
    prefix:  string;        // dotted prefix prepended when inserting (e.g. "mudix.windows.")
    entries: Completion[];
}

export const REFERENCE_GROUPS: ReferenceGroup[] = [
    { title: 'Mudlet globals',  prefix: '',                entries: MUDLET_GLOBALS },
    { title: 'Lua globals',     prefix: '',                entries: LUA_GLOBALS    },
    { title: 'string',          prefix: 'string.',         entries: STRING_EXT     },
    { title: 'table',           prefix: 'table.',          entries: TABLE_EXT      },
    { title: 'math',            prefix: 'math.',           entries: MATH_EXT       },
    { title: 'io',              prefix: 'io.',             entries: IO_COMPLETIONS },
    { title: 'lfs',             prefix: 'lfs.',            entries: LFS_COMPLETIONS },
];

// ── Hover lookup map: full dotted name → completion entry ────────────────────

export const HOVER_MAP = new Map<string, Completion>([
    // Global scope (bare names)
    ...[...LUA_KEYWORDS, ...LUA_GLOBALS, ...MUDLET_GLOBALS].map(
        c => [c.label, c] as [string, Completion]
    ),
    // Namespaced symbols
    ...IO_COMPLETIONS .map(c => [`io.${c.label}`,             c] as [string, Completion]),
    ...LFS_COMPLETIONS.map(c => [`lfs.${c.label}`,            c] as [string, Completion]),
    ...STRING_EXT    .map(c => [`string.${c.label}`,         c] as [string, Completion]),
    ...TABLE_EXT     .map(c => [`table.${c.label}`,          c] as [string, Completion]),
    ...MATH_EXT      .map(c => [`math.${c.label}`,           c] as [string, Completion]),
]);

// ── Namespace map: prefix → completions for that sub-namespace ────────────────
// Order matters: more specific prefixes must come first.

const NAMESPACE_MAP: Array<[string, Completion[]]> = [
    ['io.',     IO_COMPLETIONS],
    ['lfs.',    LFS_COMPLETIONS],
    ['string.', STRING_EXT],
    ['table.',  TABLE_EXT],
    ['math.',   MATH_EXT],
];

// ── Completion source ─────────────────────────────────────────────────────────

export function luaCompletionSource(context: CompletionContext): CompletionResult | null {
    for (const [prefix, completions] of NAMESPACE_MAP) {
        const escaped = prefix.replace(/\./g, '\\.');
        const m = context.matchBefore(new RegExp(escaped + '\\w*'));
        if (m) {
            return {
                from: m.from + prefix.length,
                options: completions,
                validFor: /^\w*/,
            };
        }
    }

    const word = context.matchBefore(/\w+/);
    if (!word && !context.explicit) return null;
    return {
        from: word ? word.from : context.pos,
        options: GLOBAL_COMPLETIONS,
        validFor: /^\w*/,
    };
}
