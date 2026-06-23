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
