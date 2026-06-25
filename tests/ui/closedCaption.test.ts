import { describe, it, expect } from 'vitest';
import { formatClosedCaption } from '../../src/ui/sound/closedCaption';

// Mirrors Mudlet's TMedia::printClosedCaption text. The format is the contract:
// screen-reader / HoH users read these lines, so keep the shape stable.
describe('formatClosedCaption', () => {
    it('uses an explicit caption verbatim with the action', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'media/rain.wav', caption: 'Rain on the roof', action: 'plays' }))
            .toBe('[Rain on the roof plays]');
        expect(formatClosedCaption({ kind: 'music', name: 'x', caption: 'Battle theme', action: 'stops' }))
            .toBe('[Battle theme stops]');
    });

    it('synthesizes from kind + bare filename when no caption', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'media/hit.wav', action: 'plays' }))
            .toBe('[sound "hit.wav" plays]');
        expect(formatClosedCaption({ kind: 'video', name: 'cutscene.mp4', action: 'stops' }))
            .toBe('[video "cutscene.mp4" stops]');
    });

    it('strips directory segments (both slash styles) to the filename', () => {
        expect(formatClosedCaption({ kind: 'music', name: 'deep/nested/path/score.ogg', action: 'plays' }))
            .toBe('[music "score.ogg" plays]');
        expect(formatClosedCaption({ kind: 'sound', name: 'C:\\sfx\\boom.wav', action: 'plays' }))
            .toBe('[sound "boom.wav" plays]');
    });

    it('includes the media key when present (and no explicit caption)', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'media/step.wav', key: 'footstep', action: 'plays' }))
            .toBe('[sound footstep "step.wav" plays]');
    });

    it('prefers an explicit caption over the key/filename synthesis', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'media/step.wav', key: 'footstep', caption: 'A footstep', action: 'plays' }))
            .toBe('[A footstep plays]');
    });

    it('treats a blank/whitespace caption as absent', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'a/b.wav', caption: '   ', action: 'plays' }))
            .toBe('[sound "b.wav" plays]');
    });

    it('falls back to the whole name when there is no path separator', () => {
        expect(formatClosedCaption({ kind: 'sound', name: 'ding.wav', action: 'stops' }))
            .toBe('[sound "ding.wav" stops]');
    });
});
