import { describe, it, expect } from 'vitest';
import {
    cssTextToStyle,
    cssTextToParts,
    qtDeclarationsToCss,
    qtAlignmentToFlex,
    extractQtAlignment,
    extractQtScaledContents,
    userWindowQssToScopedCss,
    patchStyleSheetBackgroundColor,
    rewriteQtSelectors,
    QT_OBJECT_NAMES,
} from '../../src/ui/labels/qtCss';

// App/profile stylesheets: packages address Mudlet widgets by Qt objectName
// (`QWidget#widget_panel`) and themes style whole widget types (`QDockWidget`).
// Both parse as valid CSS but match nothing in the DOM, so they're redirected
// onto our `data-qt-object` hooks / mudix classes. Anything we don't recognise
// must pass through untouched — app stylesheets double as mudix's `.mudix-*`
// brand-styling surface.
describe('qtCss Qt selector rewrite', () => {
    it('redirects a Q<Type>#objectName selector onto the data-qt-object hook', () => {
        const out = rewriteQtSelectors('QWidget#widget_panel { padding: 0px; }');
        expect(out).toBe('[data-qt-object="widget_panel"] { padding: 0px }');
    });

    it('adds overflow clipping for a zero max-height collapse (Qt clips, CSS does not)', () => {
        // The real-world case: a package embedding the mapper in its own layout
        // collapses dlgMapper's control bar. Without overflow:hidden the DOM
        // keeps painting the overflowing buttons over the map.
        const out = rewriteQtSelectors(
            'QWidget#widget_panel { max-height: 0px; min-height: 0px; padding: 0px; border: none; }',
        );
        expect(out).toContain('[data-qt-object="widget_panel"]');
        expect(out).toContain('overflow: hidden');
        expect(out).toContain('max-height: 0px');
    });

    it('rewrites the bare #objectName form for names we publish, and only those', () => {
        // Qt's unitless `0` also picks up a unit on the way through.
        expect(rewriteQtSelectors(`#${QT_OBJECT_NAMES.mapperPanel} { padding: 0; }`))
            .toBe('[data-qt-object="widget_panel"] { padding: 0px }');
        // A genuine DOM id in a brand stylesheet must not be hijacked.
        expect(rewriteQtSelectors('#some-real-dom-id { padding: 0; }'))
            .toBe('#some-real-dom-id { padding: 0; }');
    });

    it('carries pseudo-states and compound selectors through the rewrite', () => {
        expect(rewriteQtSelectors('QToolButton#toolButton_mapperMenu:hover { color: red; }'))
            .toBe('[data-qt-object="toolButton_mapperMenu"]:hover { color: red }');
        expect(rewriteQtSelectors('QWidget#widget_panel, QToolButton#toolButton_togglePanel { padding: 0px; }'))
            .toBe('[data-qt-object="widget_panel"], [data-qt-object="toolButton_togglePanel"] { padding: 0px }');
    });

    it('maps QDockWidget (Mudlet user windows) onto both floating and docked chrome', () => {
        expect(rewriteQtSelectors('QDockWidget { background: #26192f; }'))
            .toBe('.script-window, .docked-panel { background: #26192f }');
        // Subcontrols land on the DOM node playing that part…
        expect(rewriteQtSelectors('QDockWidget::title { padding: 4px; }'))
            .toBe('.script-window-titlebar, .docked-panel-titlebar { padding: 4px }');
        // …and Qt pseudo-states distribute across every expansion, with
        // Qt-only spellings translated (`:pressed` → `:active`).
        expect(rewriteQtSelectors('QDockWidget:hover { color: red; }'))
            .toBe('.script-window:hover, .docked-panel:hover { color: red }');
        expect(rewriteQtSelectors('QDockWidget::close-button:pressed { color: red; }'))
            .toBe('.script-window-btn.close:active { color: red }');
    });

    it('translates Qt-only declaration values in rules it rewrote', () => {
        // Qt's rgba() alpha is 0–255; CSS wants 0–1.
        expect(rewriteQtSelectors('QDockWidget { background-color: rgba(20,20,20,230); }'))
            .toContain('rgba(20, 20, 20, 0.902)');
        // Unitless lengths are legal in Qt, not in CSS.
        expect(rewriteQtSelectors('QDockWidget { border-radius: 5; }'))
            .toContain('border-radius: 5px');
    });

    it('leaves an unmapped Qt widget type alone rather than guessing', () => {
        // QWidget deliberately isn't mapped — in Qt it matches *every* widget.
        expect(rewriteQtSelectors('QWidget { color: red; }'))
            .toBe('QWidget { color: red; }');
        expect(rewriteQtSelectors('QTabBar::tab:top:selected { color: red; }'))
            .toBe('QTabBar::tab:top:selected { color: red; }');
    });

    it('leaves CSS with no Qt selector byte-identical', () => {
        const css = '.mudix-toolbar { background: #222; }\n.mudix-output a:hover { color: #8cf; }';
        expect(rewriteQtSelectors(css)).toBe(css);
        // Untouched rules keep their own semantics — no overflow fix-up.
        const zero = '.mudix-thing { max-height: 0px; }';
        expect(rewriteQtSelectors(zero)).toBe(zero);
        expect(rewriteQtSelectors('')).toBe('');
    });

    it('does not mistake a # inside a declaration value for a selector', () => {
        expect(rewriteQtSelectors('QWidget#widget_panel { background: #26192f; color: #e5ae69; }'))
            .toBe('[data-qt-object="widget_panel"] { background: #26192f; color: #e5ae69 }');
    });

    it('strips comments, which real Mudlet themes are full of', () => {
        // A commented-out declaration must not survive as a broken one — the
        // declaration splitter would otherwise emit `/*font-size: 13px` verbatim.
        const out = rewriteQtSelectors('QDockWidget { /*font-size: 13px;*/ color: #e5ae69; }');
        expect(out).not.toContain('font-size');
        expect(out).toContain('color: #e5ae69');
    });
});

describe('qtCss rgba alpha normalization', () => {
    it('rescales Qt 0–255 alpha to CSS 0–1 on a solid background-color', () => {
        // background-color stays `background` only for gradients; a flat color
        // keeps its key but the alpha must be rescaled (200/255 ≈ 0.7843).
        const style = cssTextToStyle('background-color: rgba(0,0,0,200)') as Record<string, string>;
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0.7843)');
    });

    it('rescales alpha on border-color (Qt convention)', () => {
        const style = cssTextToStyle('border-color: rgba(0,0,0,140)') as Record<string, string>;
        expect(style.borderColor).toBe('rgba(0, 0, 0, 0.549)');
    });

    it('leaves a CSS-style fractional alpha untouched', () => {
        const style = cssTextToStyle('background-color: rgba(10,20,30,0.5)') as Record<string, string>;
        expect(style.backgroundColor).toBe('rgba(10,20,30,0.5)');
    });

    it('leaves alpha 0 (fully transparent) and 1 untouched', () => {
        expect((cssTextToStyle('background-color: rgba(1,2,3,0)') as Record<string, string>).backgroundColor)
            .toBe('rgba(1,2,3,0)');
        expect((cssTextToStyle('background-color: rgba(1,2,3,1)') as Record<string, string>).backgroundColor)
            .toBe('rgba(1,2,3,1)');
    });

    it('rescales alpha inside a translated linear gradient (MS-GUI gauge front)', () => {
        const qss = 'background-color: QLinearGradient(x1: 0, y1: 0, x2: 0, y2: 1,'
            + 'stop:0 rgba(160,240,250,180), stop:1 rgba(60,180,210,180))';
        const style = cssTextToStyle(qss) as Record<string, string>;
        // Gradient → CSS `background`; both stops rescaled (180/255 ≈ 0.7059).
        expect(style.background).toContain('linear-gradient');
        expect(style.background).toContain('rgba(160, 240, 250, 0.7059)');
        expect(style.background).toContain('rgba(60, 180, 210, 0.7059)');
        expect(style.background).not.toContain(',180)');
    });

    it('preserves a fully-transparent stop in a gradient (MS-GUI food gauge back)', () => {
        const qss = 'background-color: QLinearGradient(x1: 0, y1: 0, x2: 1, y2: 0,'
            + 'stop:0 rgba(250,250,250,0), stop:.5 rgba(250,250,250,80))';
        const style = cssTextToStyle(qss) as Record<string, string>;
        expect(style.background).toContain('rgba(250,250,250,0)');
        expect(style.background).toContain('rgba(250, 250, 250, 0.3137)'); // 80/255
    });

    it('rescales alpha in scoped pseudo-state declarations too', () => {
        const css = qtDeclarationsToCss('background-color: rgba(255,0,0,128)');
        expect(css).toBe('background-color: rgba(255, 0, 0, 0.502)');
    });

    it('rescales alpha through the userwindow QSS path', () => {
        const out = userWindowQssToScopedCss('QWidget { background-color: rgba(20,20,20,230) }', '.scope');
        expect(out).toContain('rgba(20, 20, 20, 0.902)');
    });

    it('handles cssTextToParts inline declarations', () => {
        const { inline } = cssTextToParts('background-color: rgba(0,0,0,200); color: white');
        expect((inline as Record<string, string>).backgroundColor).toBe('rgba(0, 0, 0, 0.7843)');
    });
});

describe('qtCss Qt border-image translation', () => {
    // Qt (and Mudlet packages) use `border-image: url(x)` with no cuts as a
    // "background that scales with the widget" idiom — EleUI2 paints all its
    // window chrome this way. CSS border-image with no slice paints nothing.
    it('translates the no-cut form to a stretched background', () => {
        const style = cssTextToStyle(
            'border-image: url(/__vfs/abc/EleUI2/imgs/UI_BG.png) round',
        ) as Record<string, string>;
        expect(style.backgroundImage).toBe('url(/__vfs/abc/EleUI2/imgs/UI_BG.png)');
        expect(style.backgroundSize).toBe('100% 100%');
        expect(style.backgroundRepeat).toBe('no-repeat');
        expect(style.backgroundOrigin).toBe('border-box');
        expect(style.borderImage).toBeUndefined();
    });

    it('skips stray tokens the way Qt does (EleUI2 writes a CSS-ism "fill")', () => {
        const style = cssTextToStyle(
            'border-image: url(/__vfs/abc/imgs/UI_Window.png) fill',
        ) as Record<string, string>;
        expect(style.backgroundImage).toBe('url(/__vfs/abc/imgs/UI_Window.png)');
        expect(style.backgroundSize).toBe('100% 100%');
    });

    it('translates explicit cuts to a CSS 9-slice border-image with fill', () => {
        const style = cssTextToStyle(
            'border-image: url(frame.png) 4 8 4 8 stretch stretch',
        ) as Record<string, string>;
        expect(style.borderImage).toBe('url(frame.png) 4 8 4 8 fill / 4px 8px 4px 8px stretch stretch');
        expect(style.backgroundImage).toBeUndefined();
    });

    it('expands a single cut value margin-style and defaults repeat to stretch', () => {
        const style = cssTextToStyle('border-image: url(frame.png) 6') as Record<string, string>;
        expect(style.borderImage).toBe('url(frame.png) 6 6 6 6 fill / 6px 6px 6px 6px stretch');
    });

    it('all-zero cuts behave like the no-cut stretch idiom', () => {
        const style = cssTextToStyle('border-image: url(bg.png) 0 0 0 0') as Record<string, string>;
        expect(style.backgroundImage).toBe('url(bg.png)');
        expect(style.backgroundSize).toBe('100% 100%');
    });

    it('passes a border-image without a url() through untouched', () => {
        const style = cssTextToStyle('border-image: none') as Record<string, string>;
        expect(style.borderImage).toBe('none');
    });

    it('translates inside scoped pseudo-state declarations (qtDeclarationsToCss)', () => {
        const css = qtDeclarationsToCss('border-image: url(hover.png)');
        expect(css).toContain('background-image: url(hover.png)');
        expect(css).toContain('background-size: 100% 100%');
    });

    it('slices by the border widths declared in the same block (EleUI2 window frame)', () => {
        // The real stylesheet EleUI2 puts on Adjustable.Container's adjLabel:
        // Qt slices the frame image by the border widths so the title bar and
        // corners keep their native thickness, and the negative padding pulls
        // the title text up into the frame's title-bar zone.
        const { inline } = cssTextToParts(
            'border-top: 85px solid transparent;border-bottom:50px;border-left:115px;'
            + 'border-right:115px;border-image: url(/__vfs/abc/EleUI2/imgs/UI_Window.png) fill;'
            + 'padding-top:-95px;',
        );
        const style = inline as Record<string, string>;
        expect(style.borderImage).toBe(
            'url(/__vfs/abc/EleUI2/imgs/UI_Window.png) 85 115 50 115 fill / 85px 115px 50px 115px stretch',
        );
        expect(style.backgroundImage).toBeUndefined();
        // Real borders are folded into content-inset padding; the negative
        // Qt padding is combined and clamped (85 − 95 → 0).
        expect(style.borderTop).toBeUndefined();
        expect(style.paddingTop).toBe('0px');
        expect(style.paddingRight).toBe('115px');
        expect(style.paddingBottom).toBe('50px');
        expect(style.paddingLeft).toBe('115px');
    });

    it('handles the EleUI2 config-frame style (uniform border, round repeat)', () => {
        const { inline } = cssTextToParts(
            'border: 25px solid transparent;border-image: url(/__vfs/abc/EleUI2/imgs/UI_BG.png) round;'
            + 'padding-top:-20px;',
        );
        const style = inline as Record<string, string>;
        expect(style.borderImage).toBe(
            'url(/__vfs/abc/EleUI2/imgs/UI_BG.png) 25 25 25 25 fill / 25px 25px 25px 25px round',
        );
        expect(style.paddingTop).toBe('5px'); // 25 − 20
        expect(style.paddingRight).toBe('25px');
    });

    it('consumes a bare border-style so no phantom browser border paints', () => {
        const { inline } = cssTextToParts(
            'border-style: solid; border-image: url(bg.png)',
        );
        const style = inline as Record<string, string>;
        expect(style.borderStyle).toBeUndefined();
        expect(style.backgroundImage).toBe('url(bg.png)');
    });

    it('leaves border declarations alone when there is no border-image', () => {
        const { inline } = cssTextToParts('border: 2px solid red; padding-top: -5px');
        const style = inline as Record<string, string>;
        expect(style.border).toBe('2px solid red');
        expect(style.paddingTop).toBe('-5px'); // dropped by the browser, as before
    });

    it('marks scoped pseudo-state declarations !important so they beat the inline base', () => {
        // EleUI2's config rows: base block paints a transparent background as
        // inline style; the ::hover rule adds the FF7 finger cursor image and
        // must override it.
        const css = qtDeclarationsToCss(
            'background-image : url("/__vfs/abc/EleUI2/imgs/FF7Cursor.png"); background-repeat:no-repeat;'
            + 'background-position:left center;',
            true,
        );
        expect(css).toContain('background-image: url("/__vfs/abc/EleUI2/imgs/FF7Cursor.png") !important');
        expect(css).toContain('background-repeat: no-repeat !important');
        expect(css).toContain('background-position: left center !important');
    });
});

describe('patchStyleSheetBackgroundColor', () => {
    it('replaces an existing background-color declaration in place, keeping the rest of the rule', () => {
        // EleUI2's EMCO tab switcher: setStyleSheet(activeTabCSS) paints a dark
        // red background with a gold border, then setColor(activeTabBGColor)
        // (green by default) is expected to retint just the background — as
        // real Mudlet's Host::setBackgroundColor does via an in-place regex
        // patch — not get silently dropped in favor of the stylesheet.
        const css = [
            'QLabel{',
            'background-color: #4d0000;',
            'border-style: outset;',
            'border-color: "#996600";',
            '}',
        ].join('\n');
        const patched = patchStyleSheetBackgroundColor(css, 0, 180, 0, 255);
        expect(patched).toContain('background-color: rgba(0, 180, 0, 255);');
        expect(patched).not.toContain('#4d0000');
        expect(patched).toContain('border-style: outset;');
        expect(patched).toContain('border-color: "#996600";');
    });

    it('patches every occurrence, including pseudo-state rules', () => {
        const css = 'QLabel{background-color: #4d0000;} QLabel::hover{background-color: #b30000;}';
        const patched = patchStyleSheetBackgroundColor(css, 0, 180, 0, 255);
        const matches = patched.match(/background-color: rgba\(0, 180, 0, 255\);/g) ?? [];
        expect(matches.length).toBe(2);
    });

    it('appends the declaration when the stylesheet has no background-color', () => {
        const patched = patchStyleSheetBackgroundColor('border-style: outset;', 10, 20, 30, 255);
        expect(patched).toBe('border-style: outset;\nbackground-color: rgba(10, 20, 30, 255);');
    });

    it('appends onto an empty stylesheet', () => {
        expect(patchStyleSheetBackgroundColor('', 1, 2, 3, 255)).toBe('background-color: rgba(1, 2, 3, 255);');
    });
});

describe('qtAlignmentToFlex', () => {
    // Mudlet labels are always rich text, so Qt maps the vertical flag to a box
    // offset (→ justify-content) and the horizontal flag to the document's
    // default block alignment (→ text-align, overridable by inner <center>).
    it('maps vertical flags to justify-content on the column axis', () => {
        expect(qtAlignmentToFlex('AlignTop')).toEqual({ justifyContent: 'flex-start' });
        expect(qtAlignmentToFlex('AlignVCenter')).toEqual({ justifyContent: 'center' });
        expect(qtAlignmentToFlex('AlignBottom')).toEqual({ justifyContent: 'flex-end' });
    });

    it('maps horizontal flags to text-align, never to align-items (keeps the doc full-width)', () => {
        expect(qtAlignmentToFlex('AlignLeft')).toEqual({ textAlign: 'left' });
        expect(qtAlignmentToFlex('AlignHCenter')).toEqual({ textAlign: 'center' });
        expect(qtAlignmentToFlex('AlignRight')).toEqual({ textAlign: 'right' });
        // No align-items in any output — an explicit horizontal anchor must not
        // shrink the inner div, or an inner <center> could no longer centre.
        for (const v of ['AlignLeft', 'AlignRight', 'AlignHCenter', 'AlignCenter']) {
            expect(qtAlignmentToFlex(v).alignItems).toBeUndefined();
        }
    });

    it('handles the combined AlignLeft | AlignTop and AlignCenter forms', () => {
        expect(qtAlignmentToFlex('AlignLeft | AlignTop')).toEqual({
            justifyContent: 'flex-start', textAlign: 'left',
        });
        // AlignCenter is HCenter | VCenter.
        expect(qtAlignmentToFlex('AlignCenter')).toEqual({
            justifyContent: 'center', textAlign: 'center',
        });
    });
});

describe('extractQtAlignment', () => {
    it('reads a quote-stripped value from a base-block declaration', () => {
        expect(extractQtAlignment("border: 0; qproperty-alignment: 'AlignLeft | AlignTop';"))
            .toBe('AlignLeft | AlignTop');
    });

    it('reads it from a QLabel { … } ruleset', () => {
        expect(extractQtAlignment('QLabel { qproperty-alignment: AlignCenter; }'))
            .toBe('AlignCenter');
    });

    it('returns undefined when the stylesheet has no alignment', () => {
        expect(extractQtAlignment('border-image: url(bg.png); padding-top: -95px;'))
            .toBeUndefined();
    });

    it('takes the last declaration when several are present (Qt in-order)', () => {
        expect(extractQtAlignment('qproperty-alignment: AlignTop; qproperty-alignment: AlignBottom;'))
            .toBe('AlignBottom');
    });
});

describe('extractQtScaledContents', () => {
    it('reads true from a base-block declaration', () => {
        expect(extractQtScaledContents('padding: 6px; qproperty-scaledContents: true;')).toBe(true);
    });

    it('reads it from a QLabel { … } ruleset', () => {
        expect(extractQtScaledContents('QLabel { qproperty-scaledContents: true; }')).toBe(true);
    });

    it('reads false explicitly', () => {
        expect(extractQtScaledContents('qproperty-scaledContents: false;')).toBe(false);
    });

    it('accepts the quoted / 1 / 0 forms', () => {
        expect(extractQtScaledContents("qproperty-scaledContents: 'true';")).toBe(true);
        expect(extractQtScaledContents('qproperty-scaledContents: 1;')).toBe(true);
        expect(extractQtScaledContents('qproperty-scaledContents: 0;')).toBe(false);
    });

    it('returns undefined when the stylesheet has no scaledContents', () => {
        expect(extractQtScaledContents('border: 0; padding: 6px;')).toBeUndefined();
    });

    it('takes the last declaration when several are present (Qt in-order)', () => {
        expect(extractQtScaledContents('qproperty-scaledContents: true; qproperty-scaledContents: false;'))
            .toBe(false);
    });

    it('is not emitted as a stray CSS property on the inline style', () => {
        const style = cssTextToStyle('padding: 6px; qproperty-scaledContents: true;') as Record<string, string>;
        expect(style.qpropertyScaledContents).toBeUndefined();
        expect(style.padding).toBe('6px');
    });
});
