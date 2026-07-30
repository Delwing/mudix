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

// Parsing a Qt stylesheet (gradient / unit / selector handling) is pure in its
// source string, but it runs for every label on every overlay render — and
// during a Geyser split-resize drag the whole overlay re-renders many times a
// second while only geometry (not the stylesheet) changes. Memoize by source
// string so repeated renders reuse the parse instead of re-running the regex
// pipeline. Bounded so dynamically-generated stylesheets can't grow it without
// limit; the returned objects are treated as read-only by all callers, so it is
// safe to hand back a shared instance.
const CACHE_CAP = 1024;
function memoize<V>(cache: Map<string, V>, key: string, make: () => V): V {
    let hit = cache.get(key);
    if (hit === undefined) {
        hit = make();
        if (cache.size >= CACHE_CAP) cache.clear();
        cache.set(key, hit);
    }
    return hit;
}

const STYLE_CACHE = new Map<string, React.CSSProperties>();
export function cssTextToStyle(css: string): React.CSSProperties {
    return memoize(STYLE_CACHE, css, () => declarationsToStyle(stripRulesetBraces(css)));
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

export interface CssParts {
    inline: React.CSSProperties;
    scoped: Array<{ pseudo: string; declarations: string }>;
    margin?: QtMargin;
}

const PARTS_CACHE = new Map<string, CssParts>();
export function cssTextToParts(css: string): CssParts {
    return memoize(PARTS_CACHE, css, () => cssTextToPartsUncached(css));
}

function cssTextToPartsUncached(css: string): CssParts {
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
    for (const { key, val } of applyBorderImageBlockTransform(parseQtDeclarations(css))) {
        if (key === 'qproperty-alignment') {
            Object.assign(out, qtAlignmentToFlex(val));
            continue;
        }
        // qproperty-scaledContents is a Qt widget property, captured separately
        // (extractQtScaledContents) and applied to the background image at render
        // — it has no direct CSS declaration, so drop it here.
        if (key === 'qproperty-scaledcontents') continue;
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

// ── App/profile stylesheets: Qt objectName selectors ─────────────────────────
//
// `setAppStyleSheet` / `setProfileStyleSheet` install a QApplication-level
// stylesheet in Mudlet, so packages address individual Mudlet widgets by their
// Qt objectName — e.g. a package that embeds the mapper in its own layout does
//
//     QWidget#widget_panel { max-height: 0px; min-height: 0px; padding: 0px; }
//
// to collapse dlgMapper's control bar (`mapper.ui`, objectName `widget_panel`).
// That form is *syntactically* valid CSS — a `QWidget` type selector plus an id
// — so the browser parses it without complaint and it matches nothing, because
// no `<QWidget>` element exists. Qt also accepts the bare `#widget_panel` form.
//
// Themes go further and style whole widget *classes* — `QDockWidget { … }` for
// every user window, `QToolButton:hover { … }`, and so on.
//
// Two tables cover the two forms: {@link QT_OBJECT_NAMES} lists the Mudlet
// widgets that have a mudix DOM stand-in (each such node carries
// `data-qt-object="<objectName>"`), and {@link QT_TYPE_MAP} maps widget types and
// their subcontrols onto mudix selectors. {@link rewriteQtSelectors} applies both.
//
// The rewrite is deliberately surgical: only a `Q<Type>#name` prefix, a bare
// `#name` naming one of the widgets we expose, or a *mapped* widget type is
// touched. Anything else — an unmapped Qt type, a `.mudix-*` rule — passes
// through untouched, because app stylesheets are also mudix's documented
// brand-styling hook and already carry real CSS.

/** Qt objectNames (from Mudlet's `.ui` files) that mudix mirrors onto a DOM node
 *  via `data-qt-object`, so package stylesheets addressing them keep working.
 *  Reference these instead of writing the raw string at the render site. */
export const QT_OBJECT_NAMES = {
    /** dlgMapper's collapsible control bar — area picker, z-level buttons,
     *  options menu (`mapper.ui`: `widget_panel`). */
    mapperPanel: 'widget_panel',
    /** The arrow that shows/hides that bar (`mapper.ui`: `toolButton_togglePanel`). */
    mapperPanelToggle: 'toolButton_togglePanel',
    /** Area selector (`mapper.ui`: `comboBox_showArea`). */
    mapperAreaSelector: 'comboBox_showArea',
    /** Z-level up / down buttons (`mapper.ui`: `toolButton_shiftZup/down`). */
    mapperShiftZup: 'toolButton_shiftZup',
    mapperShiftZdown: 'toolButton_shiftZdown',
    /** The mapper's hamburger / options button (`mapper.ui`: `toolButton_mapperMenu`). */
    mapperMenu: 'toolButton_mapperMenu',
} as const;

const QT_OBJECT_NAME_SET: ReadonlySet<string> = new Set(Object.values(QT_OBJECT_NAMES));

/**
 * Qt *widget-type* selectors mapped onto the mudix DOM. Mudlet themes style
 * whole widget classes rather than named instances — `QDockWidget { … }` for
 * every user window, `QDockWidget::title { … }` for its title bars — so these
 * rules are what a pasted Mudlet app stylesheet actually spends most of its
 * lines on.
 *
 * `self` is the element(s) standing in for the widget; `sub` maps Qt subcontrols
 * (`::title`, `::close-button`) onto the DOM nodes that play those parts. A type
 * that isn't listed here is left alone — the selector stays in the sheet, inert,
 * exactly as it is today. Extending coverage is a table entry, not new code.
 *
 * Deliberately *not* mapped: bare `QWidget`, which in Qt matches every widget
 * and would repaint the entire app from one declaration block. That needs its
 * own decision about which mudix surfaces count as "every widget".
 */
const QT_TYPE_MAP: Record<string, { self: readonly string[]; sub?: Record<string, readonly string[]> }> = {
    // Mudlet user windows are QDockWidgets, floating or docked. mudix renders
    // the two as separate components with parallel chrome.
    QDockWidget: {
        self: ['.script-window', '.docked-panel'],
        sub: {
            title: ['.script-window-titlebar', '.docked-panel-titlebar'],
            'close-button': ['.script-window-btn.close'],
            'float-button': ['.script-window-btn.popout'],
        },
    },
};

// A Qt type selector: `QDockWidget`, `QDockWidget::title`, `QDockWidget:hover`,
// `QTabBar::tab:top:selected` — a type, an optional subcontrol, then any number
// of pseudo-states.
const QT_TYPE_SELECTOR_RE = /^(Q[A-Z][A-Za-z0-9_]*)(::[\w-]+)?((?::{1,2}!?[\w-]+)*)$/;

/** Translate one Qt pseudo-state token (`:hover`, `::hover`, `:!pressed`) into
 *  its CSS equivalent. Qt writes pseudo-classes with one or two colons; `:!x` is
 *  negation; `pressed` is CSS's `active`. */
function qtPseudoToCss(pseudo: string): string {
    let out = pseudo.startsWith('::') ? pseudo.slice(1) : pseudo;
    if (out.startsWith(':!')) out = `:not(:${out.slice(2)})`;
    return out === ':pressed' ? ':active'
        : out === ':not(:pressed)' ? ':not(:active)'
        : out;
}

/** Split a trailing pseudo-state run (`:top:selected`) into CSS tokens. */
function qtPseudoRunToCss(run: string): string {
    const tokens = run.match(/:{1,2}!?[\w-]+/g);
    return tokens ? tokens.map(qtPseudoToCss).join('') : '';
}

/** Expand one comma-separated Qt type selector into DOM selectors, or null when
 *  the type (or the named subcontrol) has no mudix stand-in. */
function expandQtTypeSelector(part: string): string | null {
    const m = part.trim().match(QT_TYPE_SELECTOR_RE);
    if (!m) return null;
    const entry = QT_TYPE_MAP[m[1]];
    if (!entry) return null;
    const targets = m[2] ? entry.sub?.[m[2].slice(2)] : entry.self;
    if (!targets || targets.length === 0) return null;
    const pseudo = qtPseudoRunToCss(m[3] ?? '');
    return targets.map(t => `${t}${pseudo}`).join(', ');
}

// `QWidget#name`, `QToolButton#name`, … — an unmistakably-Qt type prefix, so the
// id is safe to reinterpret as an objectName whatever it names.
const QT_TYPED_OBJECT_RE = /\bQ[A-Z][A-Za-z0-9_]*#([A-Za-z_][\w-]*)/g;
// Bare `#name` (Qt's other accepted form). Only rewritten for names we publish,
// so a genuine DOM id in a brand stylesheet is never hijacked.
const BARE_OBJECT_RE = /(^|[\s,>+~(])#([A-Za-z_][\w-]*)/g;
// Qt clips a widget to its geometry, so `max-height: 0` really does hide the
// widget *and its children*; the DOM keeps painting overflowing children unless
// told otherwise. Detected per-rule so `overflow: hidden` is only added where
// the stylesheet asked for a collapse.
const ZERO_MAX_SIZE_RE = /\bmax-(?:width|height)\s*:\s*0(?:\.0+)?(?:px)?\s*(?:;|$)/i;

function rewriteSelectorText(selector: string): string {
    // objectName forms first: they consume the `Q<Type>#name` prefix, so what
    // reaches the type pass below is a bare type selector or something we leave
    // alone.
    let out = selector.replace(QT_TYPED_OBJECT_RE, (_m, name: string) => `[data-qt-object="${cssEscape(name)}"]`);
    out = out.replace(BARE_OBJECT_RE, (m, lead: string, name: string) =>
        QT_OBJECT_NAME_SET.has(name) ? `${lead}[data-qt-object="${cssEscape(name)}"]` : m);
    // Widget-type forms, per comma-separated part. When no part maps to
    // anything, leave the selector exactly as it was: an unmapped Qt type stays
    // inert in the sheet, and — because the caller keys off whether the selector
    // changed — its declarations are left alone too.
    if (out.indexOf('Q') >= 0) {
        const parts = out.split(',');
        const expanded = parts.map(expandQtTypeSelector);
        if (expanded.some(e => e !== null)) {
            // Surrounding whitespace is part of the sheet's formatting (and the
            // space before `{`), so only the inter-part spacing is normalized.
            const lead = out.match(/^\s*/)?.[0] ?? '';
            const tail = out.match(/\s*$/)?.[0] ?? '';
            out = lead + parts.map((p, i) => expanded[i] ?? p.trim()).join(', ') + tail;
        }
    }
    return out;
}

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/**
 * Rewrite the Qt selectors in an app/profile-level stylesheet — objectName forms
 * (`QWidget#widget_panel`) and mapped widget types (`QDockWidget::title`) — onto
 * the DOM they correspond to in mudix. Returns the input unchanged when it holds
 * no Qt selector at all, which is the common case for CSS written against
 * mudix's own `.mudix-*` classes.
 *
 * A rule whose selector we rewrote also gets its *declarations* translated
 * (`qtDeclarationsToCss`): that body was written for Qt, so it may carry
 * `QLinearGradient(…)`, Qt's 0–255 `rgba()` alpha, or unitless lengths. Rules we
 * left alone keep their declarations verbatim. Comments are stripped up front —
 * they're inert, and an unbalanced brace or stray `#` inside one would otherwise
 * confuse the scan.
 */
export function rewriteQtSelectors(qss: string): string {
    // A rule needs a '{'; a rewritable selector needs either a '#' (objectName
    // form) or a Qt widget-type name.
    if (!qss || qss.indexOf('{') < 0) return qss;
    if (qss.indexOf('#') < 0 && !/\bQ[A-Z]/.test(qss)) return qss;
    const src = qss.indexOf('/*') < 0 ? qss : qss.replace(COMMENT_RE, '');
    const parts: string[] = [];
    let i = 0;
    let chunkStart = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '(') {
            const close = matchingClose(src, i);
            if (close < 0) break;
            i = close + 1;
            continue;
        }
        if (c === '{') {
            const selector = src.slice(chunkStart, i);
            const close = matchingBrace(src, i);
            const end = close < 0 ? src.length : close;
            const body = src.slice(i + 1, end);
            const rewritten = rewriteSelectorText(selector);
            let outBody = body;
            if (rewritten !== selector) {
                // Qt clips a widget to its geometry, so a zero max-height really
                // does hide it and its children; the DOM needs telling.
                const clip = ZERO_MAX_SIZE_RE.test(body) ? '; overflow: hidden' : '';
                outBody = ` ${qtDeclarationsToCss(body)}${clip} `;
            }
            parts.push(rewritten, '{', outBody, close < 0 ? '' : '}');
            i = end + 1;
            chunkStart = i;
            continue;
        }
        i++;
    }
    parts.push(src.slice(chunkStart));
    return parts.join('');
}

// CSS.escape polyfill for attribute selector values — IE/older Safari don't
// expose it, and window/label names can contain hyphens/spaces/quotes a script
// writer might choose. Cheap identifier-only fallback when CSS.escape is gone.
export function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return s.replace(/["\\\n\r]/g, '\\$&');
}

// Mirrors Mudlet's Host::setBackgroundColor for labels: rather than treating
// setColor/setBackgroundColor as independent of setStyleSheet, Mudlet patches
// the `background-color` declaration directly into whatever stylesheet is
// already on the label (regex-replacing every occurrence — base rule and any
// pseudo-state rules alike — or appending one if none exists). So whichever
// of setStyleSheet/setBackgroundColor was called most recently wins for that
// one property, while the rest of the stylesheet (border, radius, ...) stays
// intact. Packages commonly rely on this ordering (e.g. EMCO's tab switcher
// calls setStyleSheet then setColor to tint an otherwise-styled tab).
export function patchStyleSheetBackgroundColor(styleSheet: string, r: number, g: number, b: number, a: number): string {
    const decl = `background-color: rgba(${r}, ${g}, ${b}, ${a});`;
    if (styleSheet.includes('background-color')) {
        return styleSheet.replace(/background-color:[^;]*;/g, decl);
    }
    const sep = styleSheet && !styleSheet.endsWith('\n') ? '\n' : '';
    return styleSheet + sep + decl;
}

// Translate a flat declaration block into a CSS declaration string (Qt → CSS
// for values like QLinearGradient and unitless lengths). Used to serialize a
// scoped pseudo-state ruleset body for injection into a `<style>` element.
// `important` appends `!important` to every declaration: scoped pseudo-state
// rules (`QLabel::hover`) must beat the base block, which the label renders as
// INLINE style — without `!important` a hover rule can never override it (Qt
// resolves this by ordinary rule order within one stylesheet).
export function qtDeclarationsToCss(css: string, important = false): string {
    const out: string[] = [];
    const bang = important ? ' !important' : '';
    for (const { key, val } of applyBorderImageBlockTransform(parseQtDeclarations(css))) {
        if (key === 'qproperty-alignment') {
            for (const [k, v] of Object.entries(qtAlignmentToFlex(val))) {
                out.push(`${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}: ${v}${bang}`);
            }
            continue;
        }
        // Widget property applied to the background image at render, not a CSS
        // declaration — see extractQtScaledContents / declarationsToStyleWithMargin.
        if (key === 'qproperty-scaledcontents') continue;
        const [outKey, outVal] = translateDeclaration(key, val);
        out.push(`${outKey}: ${outVal}${bang}`);
    }
    return out.join('; ');
}

// ── Qt border-image ───────────────────────────────────────────────────────────
//
// Qt QSS `border-image: <url> [<cuts>{1,4}] [(stretch|repeat|round){1,2}]`
// slices the image into nine cells and — unlike CSS — always paints the middle
// cell. When the cut values are omitted, Qt slices by the widget's *border
// widths* declared alongside (EleUI2 pairs `border-top: 85px solid transparent`
// with `border-image: url(UI_Window.png)` so the frame's title bar and corners
// stay at their native thickness while the middle stretches). With neither cuts
// nor border widths the whole image stretches across the widget — the classic
// Mudlet "background that scales with the label" idiom.
//
// Reproducing that needs block-level context, so this pass runs over the whole
// parsed declaration list:
//   • cuts (explicit, else border widths) → CSS border-image-slice + `fill`
//     (CSS omits the middle cell by default) with the border widths as
//     border-image-width;
//   • all-zero cuts → a stretched CSS background;
//   • the real borders are folded away into padding: Qt insets the content by
//     border + padding, and Qt allows *negative* padding (EleUI2 pulls the
//     title text up into the frame's title bar with `padding-top: -95px`) which
//     CSS drops entirely. Emitting the combined inset as clamped padding keeps
//     the text where Qt puts it, and CSS border-image paints fine without real
//     borders since border-image-width is explicit.
// Qt's parser tolerates stray tokens (scripts write CSS-isms like `fill`);
// unknown tokens are skipped the same way.

interface QtDeclaration { key: string; val: string }

function parseQtDeclarations(css: string): QtDeclaration[] {
    const out: QtDeclaration[] = [];
    for (const decl of splitDeclarations(css)) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const key = decl.slice(0, i).trim().toLowerCase();
        const val = stripOuterQuotes(decl.slice(i + 1).trim());
        if (!key || !val) continue;
        out.push({ key, val });
    }
    return out;
}

// Margin-style shorthand expansion (1–4 values → top right bottom left).
function expandBoxShorthand(vals: number[]): [number, number, number, number] {
    const [t, r = t, b = t, l = r] = vals;
    return [t, r, b, l];
}

const SIDE_INDEX: Record<string, number> = { top: 0, right: 1, bottom: 2, left: 3 };

function parseLengths(val: string): number[] {
    const out: number[] = [];
    for (const tok of val.split(/\s+/)) {
        const m = tok.match(/^(-?\d+(?:\.\d+)?)(?:px)?$/);
        if (m) out.push(parseFloat(m[1]));
    }
    return out;
}

// Border declarations that this pass consumes when a border-image is present.
// Widths feed the slice grid; style/color are consumed too — Qt replaces the
// border painting with the image, and a leftover `border-style: solid` would
// otherwise paint a browser-default 3px border.
const BORDER_SIDE_RE = /^border-(top|right|bottom|left)$/;
const BORDER_SIDE_WIDTH_RE = /^border-(top|right|bottom|left)-width$/;
const BORDER_CONSUMED_RE = /^border(-(top|right|bottom|left))?(-(style|color))?$/;
const PADDING_SIDE_RE = /^padding-(top|right|bottom|left)$/;

function applyBorderImageBlockTransform(decls: QtDeclaration[]): QtDeclaration[] {
    let biIndex = -1;
    for (let i = decls.length - 1; i >= 0; i--) {
        if (decls[i].key === 'border-image' && /\burl\(/i.test(decls[i].val)) { biIndex = i; break; }
    }
    if (biIndex < 0) return decls;

    const widths: [number, number, number, number] = [0, 0, 0, 0];
    const pads: [number, number, number, number] = [0, 0, 0, 0];
    let sawBorder = false;
    let sawPadding = false;
    const consumed = new Set<number>();

    decls.forEach((d, i) => {
        let m: RegExpMatchArray | null;
        if (d.key === 'border' || d.key === 'border-width') {
            const nums = parseLengths(d.val);
            if (nums.length) {
                const ex = d.key === 'border' ? [nums[0]] : nums;
                const [t, r, b, l] = expandBoxShorthand(ex);
                widths[0] = t; widths[1] = r; widths[2] = b; widths[3] = l;
                sawBorder = true;
            }
            consumed.add(i);
        } else if ((m = d.key.match(BORDER_SIDE_RE)) || (m = d.key.match(BORDER_SIDE_WIDTH_RE))) {
            const nums = parseLengths(d.val);
            if (nums.length) { widths[SIDE_INDEX[m[1]]] = nums[0]; sawBorder = true; }
            consumed.add(i);
        } else if (BORDER_CONSUMED_RE.test(d.key)) {
            consumed.add(i);
        } else if (d.key === 'padding') {
            const nums = parseLengths(d.val);
            if (nums.length) {
                const [t, r, b, l] = expandBoxShorthand(nums);
                pads[0] = t; pads[1] = r; pads[2] = b; pads[3] = l;
                sawPadding = true;
            }
            consumed.add(i);
        } else if ((m = d.key.match(PADDING_SIDE_RE))) {
            const nums = parseLengths(d.val);
            if (nums.length) { pads[SIDE_INDEX[m[1]]] = nums[0]; sawPadding = true; }
            consumed.add(i);
        }
    });
    consumed.add(biIndex);

    const out = decls.filter((_, i) => !consumed.has(i));

    // Qt insets the label's content by border + padding per side (padding may
    // be negative); CSS padding can't go below zero, so clamp.
    if (sawBorder || sawPadding) {
        const sides = ['top', 'right', 'bottom', 'left'];
        sides.forEach((side, i) => {
            out.push({ key: `padding-${side}`, val: `${Math.max(0, widths[i] + pads[i])}px` });
        });
    }

    // Parse the border-image value itself: url, optional cuts, repeat keywords.
    const val = decls[biIndex].val;
    const urlMatch = val.match(/\burl\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/i);
    if (!urlMatch || urlMatch.index === undefined) return decls; // unreachable — biIndex required url()
    const url = urlMatch[0];
    const rest = val.slice(0, urlMatch.index) + val.slice(urlMatch.index + url.length);
    const cuts: number[] = [];
    const repeats: string[] = [];
    for (const tok of rest.trim().split(/\s+/)) {
        if (!tok) continue;
        if (/^\d+(?:\.\d+)?(?:px)?$/.test(tok)) cuts.push(parseFloat(tok));
        else if (/^(stretch|repeat|round|space)$/i.test(tok)) repeats.push(tok.toLowerCase());
    }

    const slice = cuts.length ? expandBoxShorthand(cuts) : widths;
    if (slice.every(c => c === 0)) {
        out.push({ key: 'background-image', val: url });
        out.push({ key: 'background-size', val: '100% 100%' });
        out.push({ key: 'background-repeat', val: 'no-repeat' });
        out.push({ key: 'background-origin', val: 'border-box' });
        return out;
    }
    const gridWidths = widths.some(w => w !== 0) ? widths : slice;
    const repeat = repeats.length ? repeats.join(' ') : 'stretch';
    out.push({
        key: 'border-image',
        val: `${url} ${slice.join(' ')} fill / ${gridWidths.map(w => `${w}px`).join(' ')} ${repeat}`,
    });
    return out;
}

// Shared Qt→CSS rewrites that aren't structural (alignment is structural and
// handled at the call site so it can emit multiple declarations).
function translateDeclaration(key: string, val: string): [string, string] {
    if (/QLinearGradient\s*\(/i.test(val)) val = translateLinearGradient(val);
    val = normalizeRgbaAlpha(val);
    // Qt accepts a brush (incl. gradients) for `background-color`; CSS only
    // allows a solid <color> there. Rename to `background` so gradients paint.
    if (key === 'background-color' && /-gradient\s*\(/.test(val)) key = 'background';
    if (LENGTH_PROPS.has(key)) val = ensurePxUnits(val);
    return [key, val];
}

// Qt's `rgba()` takes an 8-bit alpha (0–255, matching QColor), but CSS's legacy
// `rgba()` expects the 4th argument in 0–1 (a value outside that range is
// clamped, so `rgba(0,0,0,200)` paints fully opaque instead of ~78%). Mudlet
// QSS overwhelmingly uses the Qt convention, so any alpha > 1 is almost
// certainly an 0–255 value that needs rescaling to 0–1. We leave a fractional
// alpha (already CSS-style) and an alpha of exactly 0 or 1 untouched — those are
// unambiguous and identical under both conventions. Applied to whole values so
// `rgba()` stops inside a translated `linear-gradient(...)` are rescaled too.
function normalizeRgbaAlpha(val: string): string {
    if (val.indexOf('rgba') < 0) return val;
    return val.replace(
        /\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)/gi,
        (full, r, g, b, a) => {
            const alpha = parseFloat(a);
            if (alpha <= 1) return full;
            const scaled = Math.min(1, alpha / 255);
            // Trim to 4 decimals and drop trailing zeros for a tidy value.
            return `rgba(${r}, ${g}, ${b}, ${parseFloat(scaled.toFixed(4))})`;
        },
    );
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
// into the CSS that produces the same effect on the `.label` flex container.
//
// Every Mudlet label is rich text — `TLabel` forces `Qt::RichText` in its
// constructor — so Qt lays it out through a QTextDocument, and the two axes are
// handled quite differently (see QLabelPrivate in qlabel.cpp):
//
//   • Vertical: `layoutRect()` is the *only* place the alignment moves the
//     content, offsetting the text box down for AlignVCenter/AlignBottom. Our
//     `.label` is `display: flex; flex-direction: column`, so that maps to
//     `justify-content` on the main (vertical) axis.
//
//   • Horizontal: Qt feeds the alignment into the document's *default text
//     option* (`ensureTextLayouted`: `opt.setAlignment(align)`), i.e. it sets
//     the default block alignment — which inner HTML (`<center>`,
//     `align="left"`) overrides — while `doc->setTextWidth(documentRect()
//     .width())` keeps the document spanning the *full* content width. So it
//     maps to `text-align` (inherited by the echoed HTML, overridable
//     per-block), NOT to shrinking/pinning the box via `align-items`; the
//     inner div must stay stretched to full width for `<center>` to centre.
export function qtAlignmentToFlex(val: string): Record<string, string> {
    const flags = val.split('|').map(s => s.trim().toLowerCase());
    const has = (name: string) => flags.includes(name.toLowerCase());
    const out: Record<string, string> = {};

    // Vertical → main axis (column direction) via justify-content.
    if (has('AlignCenter') || has('AlignVCenter')) out.justifyContent = 'center';
    else if (has('AlignBottom')) out.justifyContent = 'flex-end';
    else if (has('AlignTop')) out.justifyContent = 'flex-start';

    // Horizontal → the document's default block alignment via text-align.
    if (has('AlignCenter') || has('AlignHCenter')) out.textAlign = 'center';
    else if (has('AlignRight')) out.textAlign = 'right';
    else if (has('AlignLeft')) out.textAlign = 'left';

    return out;
}

// Pull the value of a `qproperty-alignment` declaration out of a Qt stylesheet
// (base block or a `QLabel { … }` rule), quote-stripped like the QSS parser
// does — or undefined when none is present. Qt applies qproperty-* declarations
// as *widget properties*: they persist across a later setStyleSheet that omits
// them (unlike ordinary style, which is fully replaced). LabelManager captures
// this so a restyle that drops the alignment keeps the last one that was set —
// e.g. Adjustable.Container installs `AlignLeft | AlignTop`, then a theme like
// EleUI2 replaces the whole sheet without an alignment and the title stays
// top-aligned. Last declaration wins, mirroring Qt's in-order application.
export function extractQtAlignment(css: string): string | undefined {
    const blocks = css.indexOf('{') < 0
        ? [css]
        : splitRulesets(css)
            .filter(r => r.selector.trim() === '' || /^QLabel$/i.test(r.selector.trim()))
            .map(r => r.body);
    let found: string | undefined;
    for (const block of blocks) {
        for (const { key, val } of parseQtDeclarations(block)) {
            if (key === 'qproperty-alignment') found = val;
        }
    }
    return found;
}

// Pull the value of a `qproperty-scaledContents` declaration out of a Qt
// stylesheet (base block or a `QLabel { … }` rule) as a boolean — or undefined
// when none is present, so a restyle that omits it leaves the last value in
// place. Like qproperty-alignment, Qt applies qproperty-* as *widget
// properties* that persist across later stylesheets. When true, Qt's
// QLabel::setScaledContents scales the pixmap (setBackgroundImage) to fill the
// whole label instead of painting it at native size. Last declaration wins.
export function extractQtScaledContents(css: string): boolean | undefined {
    const blocks = css.indexOf('{') < 0
        ? [css]
        : splitRulesets(css)
            .filter(r => r.selector.trim() === '' || /^QLabel$/i.test(r.selector.trim()))
            .map(r => r.body);
    let found: boolean | undefined;
    for (const block of blocks) {
        for (const { key, val } of parseQtDeclarations(block)) {
            if (key === 'qproperty-scaledcontents') {
                const v = val.trim().toLowerCase();
                found = v === 'true' || v === '1';
            }
        }
    }
    return found;
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
