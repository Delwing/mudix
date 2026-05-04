import type { AliasNode, KeyNode, ScriptNode, TimerNode, TriggerNode, TriggerPattern, TriggerPatternType } from '../storage/schema';

// Qt::Key constants → browser KeyboardEvent.code
const QT_KEY_TO_CODE: Record<number, string> = {
    32: 'Space',
    48: 'Digit0', 49: 'Digit1', 50: 'Digit2', 51: 'Digit3', 52: 'Digit4',
    53: 'Digit5', 54: 'Digit6', 55: 'Digit7', 56: 'Digit8', 57: 'Digit9',
    65: 'KeyA', 66: 'KeyB', 67: 'KeyC', 68: 'KeyD', 69: 'KeyE', 70: 'KeyF',
    71: 'KeyG', 72: 'KeyH', 73: 'KeyI', 74: 'KeyJ', 75: 'KeyK', 76: 'KeyL',
    77: 'KeyM', 78: 'KeyN', 79: 'KeyO', 80: 'KeyP', 81: 'KeyQ', 82: 'KeyR',
    83: 'KeyS', 84: 'KeyT', 85: 'KeyU', 86: 'KeyV', 87: 'KeyW', 88: 'KeyX',
    89: 'KeyY', 90: 'KeyZ',
    16777216: 'Escape', 16777217: 'Tab', 16777219: 'Backspace',
    16777220: 'Enter', 16777221: 'NumpadEnter',
    16777222: 'Insert', 16777223: 'Delete',
    16777232: 'Home', 16777233: 'End',
    16777234: 'ArrowLeft', 16777235: 'ArrowUp',
    16777236: 'ArrowRight', 16777237: 'ArrowDown',
    16777238: 'PageUp', 16777239: 'PageDown',
    16777264: 'F1',  16777265: 'F2',  16777266: 'F3',  16777267: 'F4',
    16777268: 'F5',  16777269: 'F6',  16777270: 'F7',  16777271: 'F8',
    16777272: 'F9',  16777273: 'F10', 16777274: 'F11', 16777275: 'F12',
};

// Qt modifier flags
const QT_SHIFT = 33554432;
const QT_CTRL  = 67108864;
const QT_ALT   = 134217728;
const QT_META  = 268435456;

function qtModifiers(mod: number): string[] {
    const mods: string[] = [];
    if (mod & QT_SHIFT) mods.push('shift');
    if (mod & QT_CTRL)  mods.push('ctrl');
    if (mod & QT_ALT)   mods.push('alt');
    if (mod & QT_META)  mods.push('meta');
    return mods;
}

// Mudlet triggerType integer → our TriggerPatternType
const MUDLET_PATTERN_TYPES: TriggerPatternType[] = [
    'substring',    // 0
    'startOfLine',  // 1
    'regex',        // 2
    'exactMatch',   // 3
    'luaFunction',  // 4
    'lineSpacer',   // 5
    'colorTrigger', // 6
    'prompt',       // 7
];

function getText(el: Element, tag: string): string {
    return el.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? '';
}

function isYes(el: Element, attr: string): boolean {
    return el.getAttribute(attr) === 'yes';
}

function directChildren(el: Element, leaf: string, group: string): Element[] {
    const containerEl = Array.from(el.children).find(c => c.tagName === 'children');
    const container = containerEl ?? el;
    return Array.from(container.children).filter(c => c.tagName === leaf || c.tagName === group);
}

function isGroup(el: Element): boolean {
    return isYes(el, 'isFolder') || el.tagName.endsWith('Group');
}

// Timer: "HH:MM:SS.mmm" or "MM:SS.mmm" → seconds
function parseTimerTime(s: string): number {
    const parts = s.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(s) || 0;
}

export interface MudletImportResult {
    scripts: ScriptNode[];
    aliases: AliasNode[];
    triggers: TriggerNode[];
    timers: TimerNode[];
    keys: KeyNode[];
    warnings: string[];
}

function parseScripts(els: Element[], parentId: string | null, out: ScriptNode[]): void {
    for (const el of els) {
        const id = crypto.randomUUID();
        const group = isGroup(el);
        const handlerListEl = Array.from(el.children).find(c => c.tagName === 'eventHandlerList');
        const eventHandlers = Array.from(handlerListEl?.children ?? [])
            .filter(c => c.tagName === 'string')
            .map(s => s.textContent?.trim() ?? '').filter(Boolean);
        out.push({ id, parentId, isGroup: group, name: getText(el, 'name'), enabled: isYes(el, 'isActive'), code: getText(el, 'script'), language: 'lua', eventHandlers });
        if (group) parseScripts(directChildren(el, 'Script', 'ScriptGroup'), id, out);
    }
}

function parseAliases(els: Element[], parentId: string | null, out: AliasNode[]): void {
    for (const el of els) {
        const id = crypto.randomUUID();
        const group = isGroup(el);
        out.push({ id, parentId, isGroup: group, name: getText(el, 'name'), enabled: isYes(el, 'isActive'), pattern: getText(el, 'regex'), command: getText(el, 'command'), code: getText(el, 'script'), language: 'lua' });
        if (group) parseAliases(directChildren(el, 'Alias', 'AliasGroup'), id, out);
    }
}

function parseTriggers(els: Element[], parentId: string | null, out: TriggerNode[]): void {
    for (const el of els) {
        if (isYes(el, 'isTempTrigger')) continue;
        const id = crypto.randomUUID();
        const group = isGroup(el);

        const codeListEl = Array.from(el.children).find(c => c.tagName === 'regexCodeList');
        const propListEl = Array.from(el.children).find(c => c.tagName === 'regexCodePropertyList');
        const patternEls = Array.from(codeListEl?.children ?? []).filter(c => c.tagName === 'string');
        const typeEls    = Array.from(propListEl?.children ?? []).filter(c => c.tagName === 'integer');

        const patterns: TriggerPattern[] = patternEls.map((p, i) => {
            const typeIdx = parseInt(typeEls[i]?.textContent?.trim() ?? '0') || 0;
            return { text: p.textContent?.trim() ?? '', type: MUDLET_PATTERN_TYPES[typeIdx] ?? 'substring' };
        });
        if (patterns.length === 0 && !group) patterns.push({ text: '', type: 'substring' });

        out.push({
            id, parentId, isGroup: group,
            name: getText(el, 'name'),
            enabled: isYes(el, 'isActive'),
            patterns,
            code: getText(el, 'script'),
            language: 'lua',
            command: getText(el, 'mCommand'),
            fireLength: parseInt(getText(el, 'mStayOpen')) || 0,
            multipleMatches: isYes(el, 'isPerlSlashGOption'),
            multiline: isYes(el, 'isMultiline'),
            delta: parseInt(getText(el, 'conditonLineDelta')) || 0,
            isFilter: isYes(el, 'isFilterTrigger'),
        });
        if (group) parseTriggers(directChildren(el, 'Trigger', 'TriggerGroup'), id, out);
    }
}

function parseTimers(els: Element[], parentId: string | null, out: TimerNode[]): void {
    for (const el of els) {
        if (isYes(el, 'isTempTimer')) continue;
        const id = crypto.randomUUID();
        const group = isGroup(el);
        out.push({ id, parentId, isGroup: group, name: getText(el, 'name'), enabled: isYes(el, 'isActive'), seconds: parseTimerTime(getText(el, 'time')), code: getText(el, 'script'), language: 'lua', command: getText(el, 'command'), repeat: true });
        if (group) parseTimers(directChildren(el, 'Timer', 'TimerGroup'), id, out);
    }
}

function parseKeys(els: Element[], parentId: string | null, out: KeyNode[], warnings: string[]): void {
    for (const el of els) {
        const id = crypto.randomUUID();
        const group = isGroup(el);
        const qtKey = parseInt(getText(el, 'keyCode')) || 0;
        const qtMod = parseInt(getText(el, 'keyModifier')) || 0;
        const key = QT_KEY_TO_CODE[qtKey] ?? '';
        if (!group && !key && qtKey !== 0) {
            warnings.push(`Key "${getText(el, 'name')}": unknown Qt key code ${qtKey} — keybinding imported with no key set`);
        }
        out.push({ id, parentId, isGroup: group, name: getText(el, 'name'), enabled: isYes(el, 'isActive'), key, modifiers: qtModifiers(qtMod), code: getText(el, 'script'), language: 'lua', command: getText(el, 'command') });
        if (group) parseKeys(directChildren(el, 'Key', 'KeyGroup'), id, out, warnings);
    }
}

export function parseMudletXml(xml: string): MudletImportResult {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(`XML parse error: ${err.textContent?.split('\n')[0]}`);

    function pkgChildren(pkgTag: string, leaf: string, group: string): Element[] {
        return Array.from(doc.getElementsByTagName(pkgTag))
            .flatMap(pkg => Array.from(pkg.children).filter(c => c.tagName === leaf || c.tagName === group));
    }

    const result: MudletImportResult = { scripts: [], aliases: [], triggers: [], timers: [], keys: [], warnings: [] };
    parseScripts( pkgChildren('ScriptPackage',  'Script',  'ScriptGroup'),  null, result.scripts);
    parseAliases( pkgChildren('AliasPackage',   'Alias',   'AliasGroup'),   null, result.aliases);
    parseTriggers(pkgChildren('TriggerPackage', 'Trigger', 'TriggerGroup'), null, result.triggers);
    parseTimers(  pkgChildren('TimerPackage',   'Timer',   'TimerGroup'),   null, result.timers);
    parseKeys(    pkgChildren('KeyPackage',     'Key',     'KeyGroup'),      null, result.keys, result.warnings);
    return result;
}
