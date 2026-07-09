import { describe, it, expect } from 'vitest';
import { LabelManager } from '../../src/ui/labels/LabelManager';

describe('LabelManager.setBackgroundImageSize', () => {
    it('fills in the resolved size for the label\'s current background image', () => {
        const m = new LabelManager();
        m.create('sigil', { x: 0, y: 0, width: 48, height: 48, fillBackground: false });
        m.setBackgroundImage('sigil', 'vfs://sigil.svg');
        expect(m.setBackgroundImageSize('sigil', 'vfs://sigil.svg', 128, 128)).toBe(true);
        expect(m.list('main').find(l => l.name === 'sigil')?.backgroundImage)
            .toEqual({ url: 'vfs://sigil.svg', width: 128, height: 128 });
    });

    it('ignores a stale resolution once the image has changed to a different url', () => {
        const m = new LabelManager();
        m.create('sigil', { x: 0, y: 0, width: 48, height: 48, fillBackground: false });
        m.setBackgroundImage('sigil', 'vfs://old.svg');
        m.setBackgroundImage('sigil', 'vfs://new.svg');
        // The async resolution for the old url lands after the label moved on.
        expect(m.setBackgroundImageSize('sigil', 'vfs://old.svg', 128, 128)).toBe(false);
        expect(m.list('main').find(l => l.name === 'sigil')?.backgroundImage)
            .toEqual({ url: 'vfs://new.svg' });
    });

    it('no-ops for an unknown label', () => {
        const m = new LabelManager();
        expect(m.setBackgroundImageSize('missing', 'vfs://x.svg', 1, 1)).toBe(false);
    });
});
