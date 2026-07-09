import { describe, it, expect } from 'vitest';
import { parseSvgIntrinsicSize } from '../../src/ui/labels/backgroundImageSize';

describe('parseSvgIntrinsicSize', () => {
    it('prefers explicit width/height attributes over the viewBox', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 128 128"></svg>';
        expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 24, height: 32 });
    });

    it('falls back to the viewBox extent when width/height are absent (Qt defaultSize behaviour)', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"></svg>';
        expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 128, height: 128 });
    });

    it('tolerates comma-separated viewBox values', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,64,48"></svg>';
        expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 64, height: 48 });
    });

    it('treats a percentage width/height as no intrinsic size, falling back to viewBox', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 40 20"></svg>';
        expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 40, height: 20 });
    });

    it('returns null when there is no width/height and no viewBox', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
        expect(parseSvgIntrinsicSize(svg)).toBeNull();
    });

    it('returns null for unparseable input', () => {
        expect(parseSvgIntrinsicSize('not an svg')).toBeNull();
    });
});
