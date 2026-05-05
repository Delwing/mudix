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

// ── mudix.gauges ──────────────────────────────────────────────────────────────

const MUDIX_GAUGES: Completion[] = [
    fn('create',   '(name, opts)',                        'Create a gauge. opts: { parent?, x, y, width, height, text?, r?, g?, b?, orientation? }'),
    fn('setValue', '(name, current, max, text?)',         'Set gauge fill ratio'),
    fn('setText',  '(name, html)',                        'Set gauge text (HTML allowed)'),
    fn('setColor', '(name, r, g, b)',                     'Set gauge fill color'),
    fn('move',     '(name, x, y)',                        'Move a gauge'),
    fn('resize',   '(name, width, height)',               'Resize a gauge'),
    fn('show',     '(name)',                              'Show a hidden gauge'),
    fn('hide',     '(name)',                              'Hide a gauge'),
    fn('destroy',  '(name)',                              'Destroy a gauge'),
    fn('setStyleSheet', '(name, cssFront?, cssBack?, cssText?)', 'Apply CSS to gauge layers'),
    fn('has',      '(name) → bool',                      'Check if a gauge exists'),
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
    fn('printerror',   '(text)',        'Print an error message'),
    fn('on',           '(event, fn)',   "Register event handler. Events: 'connect' 'disconnect' 'output' 'gmcp'"),
    fn('off',          '(event, fn)',   'Remove a previously registered event handler'),
    ns('windows',  'Window management API'),
    ns('timers',   'Timer API'),
    ns('aliases',  'Alias API'),
    ns('triggers', 'Trigger API'),
    ns('keys',     'Keybinding API'),
    ns('gauges',   'Gauge overlay API'),
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
    fn('createMiniConsole', '([parent,] name, x, y, w, h) → bool', 'Create a positioned floating text panel; calling again repositions it'),
    fn('clearWindow',     '([name])',      'Clear window contents'),
    fn('setUserWindowTitle', '(name, title)', 'Set user window title'),
    fn('hideWindow',      '(name)',        'Hide a userwindow or label'),
    fn('showWindow',      '(name)',        'Show a userwindow or label'),
    fn('moveWindow',      '(name, x, y)',  'Move a userwindow or label to a pixel position'),
    fn('resizeWindow',    '(name, w, h)',  'Resize a userwindow or label'),
    fn('setBackgroundColor', '(name, r, g, b [, a])', 'Set a label background color (rgba 0..255). Implicitly enables fillBackground.'),
    fn('getMainWindowSize', '() → w, h',   'Browser window inner width and height in pixels'),
    // Cmd line
    fn('appendCmdLine', '(text)',          'Append to command bar'),
    fn('printCmdLine',  '(text)',          'Set command bar contents'),
    // Cursor / line inspection
    fn('getCurrentLine',  '([window])',    'Get current trigger line text'),
    fn('getLineNumber',   '([window])',    'Get cursor line number'),
    fn('getLineCount',    '([window])',    'Get total line count'),
    fn('getColumnNumber', '([window])',    'Get cursor column'),
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
    fn('tempTrigger',    '(pattern, fn) → id', 'Create a temporary trigger'),
    fn('killTrigger',    '(id)',           'Remove a trigger'),
    fn('tempLineTrigger','(linesAhead, count, code)', 'Trigger N lines ahead'),
    // Keys
    fn('tempKey',        '(modifier, key, fn) → id',  'Create a temporary keybinding. modifier: Qt bitflag (0=none, 67108864=Ctrl, 33554432=Shift, 134217728=Alt). key: Qt::Key int or web code string'),
    fn('killKey',        '(id)',                       'Remove a keybinding'),
    // Events
    // File system
    fn('getMudixProfilePath', '() → string',        'Returns the VFS profile root path for this connection'),
    fn('getMudletHomeDir',   '() → string',        'Mudlet-compatible alias for getMudixProfilePath()'),
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
    fn('setLabelClickCallback','(name, fn)',
       'Install a click handler on a label. fn may be a function or a Lua code string (compiled with loadstring). Replacing the callback leaks the prior closure in the registry.'),
    // rex
    ns('rex', 'PCRE-compatible regex module: rex.match(), rex.find(), rex.new()'),
    // Globals / tables
    variable('gmcp',         'GMCP state table — auto-populated from server packets'),
    variable('matches',      'Regex captures in trigger/alias context: [full, cap1, cap2, ...]'),
    variable('line',         'Current trigger line text'),
    variable('multimatches', 'Multiline trigger captures'),
    variable('color_table',  'Mudlet color table: { colorName = {r, g, b} }'),
    ns('mudix', 'mudix namespace — scripting API'),
];

// ── Global completions (everything available at top level) ────────────────────

const GLOBAL_COMPLETIONS: Completion[] = [
    ...LUA_KEYWORDS,
    ...LUA_GLOBALS,
    ...MUDLET_GLOBALS,
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
    ...MUDIX_TOP     .map(c => [`mudix.${c.label}`,          c] as [string, Completion]),
    ...MUDIX_WINDOWS .map(c => [`mudix.windows.${c.label}`,  c] as [string, Completion]),
    ...MUDIX_TIMERS  .map(c => [`mudix.timers.${c.label}`,   c] as [string, Completion]),
    ...MUDIX_ALIASES .map(c => [`mudix.aliases.${c.label}`,  c] as [string, Completion]),
    ...MUDIX_TRIGGERS.map(c => [`mudix.triggers.${c.label}`, c] as [string, Completion]),
    ...MUDIX_KEYS    .map(c => [`mudix.keys.${c.label}`,     c] as [string, Completion]),
    ...MUDIX_GAUGES  .map(c => [`mudix.gauges.${c.label}`,   c] as [string, Completion]),
    ...STRING_EXT    .map(c => [`string.${c.label}`,         c] as [string, Completion]),
    ...TABLE_EXT     .map(c => [`table.${c.label}`,          c] as [string, Completion]),
    ...MATH_EXT      .map(c => [`math.${c.label}`,           c] as [string, Completion]),
]);

// ── Namespace map: prefix → completions for that sub-namespace ────────────────
// Order matters: more specific prefixes must come first.

const NAMESPACE_MAP: Array<[string, Completion[]]> = [
    ['io.',   IO_COMPLETIONS],
    ['lfs.',  LFS_COMPLETIONS],
    ['mudix.windows.',  MUDIX_WINDOWS],
    ['mudix.timers.',   MUDIX_TIMERS],
    ['mudix.aliases.',  MUDIX_ALIASES],
    ['mudix.triggers.', MUDIX_TRIGGERS],
    ['mudix.keys.',     MUDIX_KEYS],
    ['mudix.gauges.',   MUDIX_GAUGES],
    ['mudix.',          MUDIX_TOP],
    ['string.',         STRING_EXT],
    ['table.',          TABLE_EXT],
    ['math.',           MATH_EXT],
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
