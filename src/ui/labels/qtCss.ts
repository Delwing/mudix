import type React from 'react';

// Qt's QSS dialect overlaps with CSS but isn't identical. This translator
// converts the subset Mudlet scripts commonly emit (gradients, unitless
// lengths) into DOM-renderable CSS. Properties we don't recognize pass through
// untouched and end up applied verbatim — the browser silently drops anything
// it doesn't understand.

// Properties whose values are lengths, where Qt allows unitless numbers but
// the browser requires explicit units. Each numeric token without a unit gets
// "px" appended; tokens with a unit (px, %, em, …) are left alone.
const LENGTH_PROPS = new Set([
    'border-radius',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-width',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'top', 'left', 'right', 'bottom',
    'width', 'height',
    'min-width', 'min-height', 'max-width', 'max-height',
    'font-size', 'letter-spacing', 'word-spacing',
]);

export function cssTextToStyle(css: string): React.CSSProperties {
    return declarationsToStyle(stripRulesetBraces(css));
}

// Parse a Qt-style stylesheet that mixes flat declarations and selector
// rulesets. Returns the flat declarations (everything in the base block or in a
// `QLabel { … }` rule) as inline style, plus a list of scoped rules keyed by
// CSS pseudo-class for state selectors like `QLabel::hover`, `QLabel:pressed`,
// etc. Caller is expected to inject scoped rules into a `<style>` element
// targeting the specific label via a unique selector prefix.
export interface QtMargin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export function cssTextToParts(css: string): {
    inline: React.CSSProperties;
    scoped: Array<{ pseudo: string; declarations: string }>;
    margin?: QtMargin;
} {
    if (css.indexOf('{') < 0) {
        const { style, margin } = declarationsToStyleWithMargin(css);
        return { inline: style, scoped: [], margin };
    }
    const inlineDecls: string[] = [];
    const scoped: Array<{ pseudo: string; declarations: string }> = [];
    for (const rule of splitRulesets(css)) {
        const pseudo = qtSelectorToPseudo(rule.selector);
        if (pseudo === '') inlineDecls.push(rule.body);
        else if (pseudo !== null) scoped.push({ pseudo, declarations: rule.body });
        // Unknown selectors (other widget types, descendant rules) are dropped —
        // they wouldn't have applied to a QLabel in Mudlet either.
    }
    const { style, margin } = declarationsToStyleWithMargin(inlineDecls.join(';'));
    return { inline: style, scoped, margin };
}

// Translate a Qt selector ("QLabel", "QLabel:hover", "QLabel::hover",
// "QLabel:!hover", ":hover", "*") into the CSS pseudo-class suffix to apply.
// Empty string = no pseudo (applies as inline). null = drop the rule.
function qtSelectorToPseudo(sel: string): string | null {
    const trimmed = sel.trim();
    if (!trimmed) return null;
    if (trimmed === '*' || /^QLabel$/i.test(trimmed)) return '';
    // Strip optional widget-type prefix (e.g., QLabel:hover → :hover). We only
    // accept QLabel or no prefix; other widget types don't render here.
    const m = trimmed.match(/^(QLabel)?(:{1,2}!?[\w-]+)$/i);
    if (!m) return null;
    let pseudo = m[2];
    // Qt's `::state` is equivalent to `:state` for pseudo-classes; CSS requires
    // single colon. (Real pseudo-elements like `::before` aren't Qt states.)
    if (pseudo.startsWith('::')) pseudo = pseudo.slice(1);
    // Qt's `:!state` is the negation; map to CSS `:not(:state)`.
    if (pseudo.startsWith(':!')) pseudo = ':not(:' + pseudo.slice(2) + ')';
    // Map Qt-specific state names to their CSS equivalents.
    const QT_TO_CSS: Record<string, string> = {
        ':pressed': ':active',
        ':!pressed': ':not(:active)',
    };
    return QT_TO_CSS[pseudo] ?? pseudo;
}

// Apply Qt→CSS translations on a flat declaration block and return inline
// styles. Used for both the base block and `QLabel { … }` rule bodies.
function declarationsToStyle(css: string): React.CSSProperties {
    return declarationsToStyleWithMargin(css).style;
}

// Same as declarationsToStyle but also extracts Qt margin as geometry-inset
// data. Margin in Qt's QSS insets the visible area within the widget's
// geometry, but CSS margin on an absolutely-positioned div *offsets* the box —
// so we pull margin out of the inline style and hand it back as numbers so
// LabelOverlay can apply it as left/top/width/height adjustments.
function declarationsToStyleWithMargin(css: string): {
    style: React.CSSProperties;
    margin?: QtMargin;
} {
    const out: Record<string, string> = {};
    const margin: Partial<QtMargin> = {};
    for (const decl of splitDeclarations(css)) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const key = decl.slice(0, i).trim().toLowerCase();
        const val = stripOuterQuotes(decl.slice(i + 1).trim());
        if (!key || !val) continue;
        if (key === 'qproperty-alignment') {
            Object.assign(out, qtAlignmentToFlex(val));
            continue;
        }
        if (key === 'margin' || key === 'margin-top' || key === 'margin-right'
            || key === 'margin-bottom' || key === 'margin-left') {
            applyMarginDeclaration(margin, key, val);
            continue;
        }
        const [outKey, outVal] = translateDeclaration(key, val);
        const camel = outKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[camel] = outVal;
    }
    const fullMargin: QtMargin | undefined = (
        margin.top !== undefined || margin.right !== undefined
        || margin.bottom !== undefined || margin.left !== undefined
    ) ? {
        top: margin.top ?? 0,
        right: margin.right ?? 0,
        bottom: margin.bottom ?? 0,
        left: margin.left ?? 0,
    } : undefined;
    return { style: out as React.CSSProperties, margin: fullMargin };
}

// Parse a single margin declaration into the QtMargin accumulator. Handles
// shorthand (1–4 values) and the per-side `margin-top` etc. forms.
function applyMarginDeclaration(out: Partial<QtMargin>, key: string, val: string): void {
    if (key === 'margin') {
        const nums = val.split(/\s+/).map(parseMarginToken).filter((n): n is number => n !== null);
        if (nums.length === 1) {
            out.top = out.right = out.bottom = out.left = nums[0];
        } else if (nums.length === 2) {
            out.top = out.bottom = nums[0];
            out.left = out.right = nums[1];
        } else if (nums.length === 3) {
            out.top = nums[0];
            out.left = out.right = nums[1];
            out.bottom = nums[2];
        } else if (nums.length === 4) {
            [out.top, out.right, out.bottom, out.left] = nums;
        }
        return;
    }
    const n = parseMarginToken(val);
    if (n === null) return;
    const side = key.slice('margin-'.length) as keyof QtMargin;
    out[side] = n;
}

function parseMarginToken(tok: string): number | null {
    const m = tok.match(/^(-?\d+(?:\.\d+)?)(px)?$/);
    return m ? parseFloat(m[1]) : null;
}

// Translate a Qt-style stylesheet meant for a userwindow (`QWidget { … }`) into
// a single scoped CSS string targeting the panel viewport via `scope` (an
// attribute selector). Mudlet's `setUserWindowStyleSheet` styles the window
// widget — most commonly the `QWidget` selector with `padding`, `background-*`,
// etc. We translate Qt units / gradients and rewrite selectors so a script
// writing the QSS Mudlet expects gets the equivalent DOM effect (e.g. padding
// pushes the text console inward, while sibling labels can still span the full
// rect). Rules targeting other widget types are dropped — there's no per-child
// Qt hierarchy to address in this DOM.
export function userWindowQssToScopedCss(qss: string, scope: string): string {
    if (!qss.trim()) return '';
    const rules: string[] = [];
    if (qss.indexOf('{') < 0) {
        const decls = qtDeclarationsToCss(qss);
        return decls ? `${scope} { ${decls} }` : '';
    }
    for (const rule of splitRulesets(qss)) {
        const pseudo = qtWidgetSelectorToPseudo(rule.selector);
        if (pseudo === null) continue;
        const decls = qtDeclarationsToCss(rule.body);
        if (!decls) continue;
        rules.push(`${scope}${pseudo} { ${decls} }`);
    }
    return rules.join('\n');
}

// Translate Mudlet's `setCmdLineStyleSheet(name, qss)` body into scoped CSS
// targeting the per-window command-line `<input>` selected by `scope`. Mudlet
// scripts most commonly write `QPlainTextEdit { ... }` (the underlying Qt
// widget Mudlet uses) or `QWidget { ... }` / no selector / `*`. Pseudo states
// on those selectors (`:hover`, `:focus`) project to the same input. Rules
// targeting any other Qt widget type are dropped — there is no equivalent
// child widget in the DOM input.
export function cmdLineQssToScopedCss(qss: string, scope: string): string {
    if (!qss.trim()) return '';
    const rules: string[] = [];
    if (qss.indexOf('{') < 0) {
        const decls = qtDeclarationsToCss(qss);
        return decls ? `${scope} { ${decls} }` : '';
    }
    for (const rule of splitRulesets(qss)) {
        const pseudo = qtCmdLineSelectorToPseudo(rule.selector);
        if (pseudo === null) continue;
        const decls = qtDeclarationsToCss(rule.body);
        if (!decls) continue;
        rules.push(`${scope}${pseudo} { ${decls} }`);
    }
    return rules.join('\n');
}

// Sibling of qtWidgetSelectorToPseudo for the command-line case. Adds
// QPlainTextEdit / QLineEdit / QTextEdit to the set of selectors that resolve
// to the input itself.
function qtCmdLineSelectorToPseudo(sel: string): string | null {
    const trimmed = sel.trim();
    if (!trimmed) return '';
    if (trimmed === '*' || /^(QWidget|QPlainTextEdit|QLineEdit|QTextEdit)$/i.test(trimmed)) return '';
    const m = trimmed.match(/^(QWidget|QPlainTextEdit|QLineEdit|QTextEdit)?(:{1,2}!?[\w-]+)$/i);
    if (!m) return null;
    let pseudo = m[2];
    if (pseudo.startsWith('::')) pseudo = pseudo.slice(1);
    if (pseudo.startsWith(':!')) pseudo = ':not(:' + pseudo.slice(2) + ')';
    const QT_TO_CSS: Record<string, string> = {
        ':pressed': ':active',
        ':!pressed': ':not(:active)',
    };
    return QT_TO_CSS[pseudo] ?? pseudo;
}

// Sibling of qtSelectorToPseudo for the userwindow case: `QWidget`, `*`, or an
// empty (base-block) selector all map to the scope itself; state pseudos like
// `QWidget:hover` become scoped `:hover`. Anything else returns null and the
// caller drops the rule.
function qtWidgetSelectorToPseudo(sel: string): string | null {
    const trimmed = sel.trim();
    if (!trimmed) return '';
    if (trimmed === '*' || /^QWidget$/i.test(trimmed)) return '';
    const m = trimmed.match(/^(QWidget)?(:{1,2}!?[\w-]+)$/i);
    if (!m) return null;
    let pseudo = m[2];
    if (pseudo.startsWith('::')) pseudo = pseudo.slice(1);
    if (pseudo.startsWith(':!')) pseudo = ':not(:' + pseudo.slice(2) + ')';
    const QT_TO_CSS: Record<string, string> = {
        ':pressed': ':active',
        ':!pressed': ':not(:active)',
    };
    return QT_TO_CSS[pseudo] ?? pseudo;
}

// CSS.escape polyfill for attribute selector values — IE/older Safari don't
// expose it, and window/label names can contain hyphens/spaces/quotes a script
// writer might choose. Cheap identifier-only fallback when CSS.escape is gone.
export function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return s.replace(/["\\\n\r]/g, '\\$&');
}

// Translate a flat declaration block into a CSS declaration string (Qt → CSS
// for values like QLinearGradient and unitless lengths). Used to serialize a
// scoped pseudo-state ruleset body for injection into a `<style>` element.
export function qtDeclarationsToCss(css: string): string {
    const out: string[] = [];
    for (const decl of splitDeclarations(css)) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const key = decl.slice(0, i).trim().toLowerCase();
        const val = stripOuterQuotes(decl.slice(i + 1).trim());
        if (!key || !val) continue;
        if (key === 'qproperty-alignment') {
            for (const [k, v] of Object.entries(qtAlignmentToFlex(val))) {
                out.push(`${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}: ${v}`);
            }
            continue;
        }
        const [outKey, outVal] = translateDeclaration(key, val);
        out.push(`${outKey}: ${outVal}`);
    }
    return out.join('; ');
}

// Shared Qt→CSS rewrites that aren't structural (alignment is structural and
// handled at the call site so it can emit multiple declarations).
function translateDeclaration(key: string, val: string): [string, string] {
    if (/QLinearGradient\s*\(/i.test(val)) val = translateLinearGradient(val);
    // Qt accepts a brush (incl. gradients) for `background-color`; CSS only
    // allows a solid <color> there. Rename to `background` so gradients paint.
    if (key === 'background-color' && /-gradient\s*\(/.test(val)) key = 'background';
    if (LENGTH_PROPS.has(key)) val = ensurePxUnits(val);
    return [key, val];
}

// Qt scripts often quote values that CSS expects bare — `background-color:
// 'red'`, `qproperty-alignment: 'AlignLeft | AlignTop'`. Qt's QSS parser is
// lenient and unwraps the quotes; the browser drops the declaration entirely
// when it sees the quoted form for a non-string value. We strip matching outer
// quotes so the value lands as a real color/keyword. (Values that legitimately
// need quotes in CSS — font-family lists with spaces, `content` strings — are
// extremely rare in the QSS scripts we translate, so the conservative trade-off
// is to always strip rather than maintain a property allowlist.)
function stripOuterQuotes(val: string): string {
    if (val.length < 2) return val;
    const first = val[0];
    const last = val[val.length - 1];
    if ((first === "'" || first === '"') && first === last) {
        return val.slice(1, -1).trim();
    }
    return val;
}

// Translate a Qt `qproperty-alignment` value (`AlignLeft | AlignVCenter`, etc.)
// into the flexbox properties that produce the same effect on the `.label`
// flex container.
//
// Our `.label` is `display: flex; flex-direction: column`, so main-axis is
// vertical (controlled by `justify-content`) and cross-axis is horizontal
// (controlled by `align-items`). Setting a horizontal alignment also un-
// stretches the cross-axis sizing (the inner echo div shrinks to content
// width), which mirrors Qt: explicit horizontal alignment pins the document
// to one edge instead of letting it span the full widget width.
function qtAlignmentToFlex(val: string): Record<string, string> {
    const flags = val.split('|').map(s => s.trim().toLowerCase());
    const has = (name: string) => flags.includes(name.toLowerCase());
    const out: Record<string, string> = {};

    // Vertical → main axis (column direction).
    if (has('AlignCenter') || has('AlignVCenter')) out.justifyContent = 'center';
    else if (has('AlignBottom')) out.justifyContent = 'flex-end';
    else if (has('AlignTop')) out.justifyContent = 'flex-start';

    // Horizontal → cross axis. When the script names a horizontal anchor we
    // pin to it (and thus stop stretching); when it doesn't, stretch stays so
    // HTML alignment (`<center>`, `align="left"`) drives the rendered position
    // within the full-width inner div.
    if (has('AlignCenter') || has('AlignHCenter')) out.alignItems = 'center';
    else if (has('AlignRight')) out.alignItems = 'flex-end';
    else if (has('AlignLeft')) out.alignItems = 'flex-start';

    return out;
}

// Pull out base-level declarations from a stylesheet that may also have
// selector rulesets. Used by cssTextToStyle for back-compat callers that don't
// care about scoped state rules.
function stripRulesetBraces(css: string): string {
    if (css.indexOf('{') < 0) return css;
    const inline: string[] = [];
    for (const rule of splitRulesets(css)) {
        if (rule.selector === '' || /^QLabel$/i.test(rule.selector.trim())) {
            inline.push(rule.body);
        }
    }
    return inline.join(';');
}

// Walk a stylesheet of the form `[base decls;] selector { decls; } selector { … }`.
// Returns each piece as { selector, body }. Base-level declarations come back
// with selector === ''. Brace-aware so nested `()` in values (e.g. gradients)
// don't get confused for ruleset boundaries.
function splitRulesets(css: string): Array<{ selector: string; body: string }> {
    const out: Array<{ selector: string; body: string }> = [];
    let i = 0;
    let chunkStart = 0;
    while (i < css.length) {
        const c = css[i];
        if (c === '(') {
            const close = matchingClose(css, i);
            if (close < 0) break;
            i = close + 1;
            continue;
        }
        if (c === '{') {
            const selector = css.slice(chunkStart, i);
            const close = matchingBrace(css, i);
            const end = close < 0 ? css.length : close;
            out.push({ selector, body: css.slice(i + 1, end) });
            i = end + 1;
            chunkStart = i;
            continue;
        }
        i++;
    }
    if (chunkStart < css.length) {
        const tail = css.slice(chunkStart).trim();
        if (tail) out.push({ selector: '', body: tail });
    }
    return out;
}

function matchingBrace(s: string, openIdx: number): number {
    let depth = 1;
    for (let i = openIdx + 1; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// Paren-aware split on `;` so semicolons inside e.g. QLinearGradient() don't
// terminate a declaration. (Qt's gradient syntax doesn't use semicolons today,
// but this keeps us safe if Qt-style nested function values ever do.)
function splitDeclarations(css: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ';' && depth === 0) {
            out.push(css.slice(start, i));
            start = i + 1;
        }
    }
    if (start < css.length) out.push(css.slice(start));
    return out;
}

// QLinearGradient(x1: a, y1: b, x2: c, y2: d, stop: 0 color1, stop: 0.5 color2, …)
//   → linear-gradient(<angle>deg, color1 0%, color2 50%, …)
//
// Qt and CSS share a y-down coordinate frame, but CSS angles are measured from
// the positive Y axis going clockwise (0deg = to top, 90deg = to right, 180deg
// = to bottom, 270deg = to left). The direction vector (dx, dy) maps to angle
// atan2(dx, -dy).
function translateLinearGradient(val: string): string {
    const start = val.search(/QLinearGradient\s*\(/i);
    if (start < 0) return val;
    const openIdx = val.indexOf('(', start);
    const closeIdx = matchingClose(val, openIdx);
    if (closeIdx < 0) return val;

    const inner = val.slice(openIdx + 1, closeIdx);
    const parts = splitTopLevel(inner, ',').map(s => s.trim()).filter(Boolean);

    const coords: Record<string, number> = {};
    const stops: Array<[number, string]> = [];
    for (const part of parts) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const key = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (key === 'stop') {
            const m = value.match(/^([\d.]+)\s+(.+)$/);
            if (m) stops.push([parseFloat(m[1]), m[2].trim()]);
        } else if (key === 'x1' || key === 'y1' || key === 'x2' || key === 'y2') {
            const n = parseFloat(value);
            if (!Number.isNaN(n)) coords[key] = n;
        }
    }

    if (stops.length === 0) return val;

    const dx = (coords.x2 ?? 0) - (coords.x1 ?? 0);
    const dy = (coords.y2 ?? 1) - (coords.y1 ?? 0);
    let angle = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
    if (angle < 0) angle += 360;

    const stopStrs = stops.map(([off, color]) => `${color} ${Math.round(off * 100)}%`);
    const replacement = `linear-gradient(${angle}deg, ${stopStrs.join(', ')})`;
    return val.slice(0, start) + replacement + val.slice(closeIdx + 1);
}

function matchingClose(s: string, openIdx: number): number {
    let depth = 1;
    for (let i = openIdx + 1; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevel(s: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === sep && depth === 0) {
            out.push(s.slice(start, i));
            start = i + 1;
        }
    }
    if (start <= s.length) out.push(s.slice(start));
    return out;
}

// Add "px" to any pure numeric token (e.g. "1 solid black" → "1px solid black",
// "7" → "7px"). Tokens with an existing unit/percent/identifier are untouched.
function ensurePxUnits(val: string): string {
    return val
        .split(/(\s+)/)
        .map(tok => (/^-?\d+(?:\.\d+)?$/.test(tok) ? tok + 'px' : tok))
        .join('');
}
