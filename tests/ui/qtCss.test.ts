import { describe, it, expect } from 'vitest';
import {
    cssTextToStyle,
    cssTextToParts,
    qtDeclarationsToCss,
    userWindowQssToScopedCss,
} from '../../src/ui/labels/qtCss';

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
