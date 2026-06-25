// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTestRuntime } from '../createTestRuntime';

// The Lua-side moveWindow/resizeWindow dedup (Bridge.lua) skips the JS crossing
// when geometry is unchanged. These guard that REAL moves still apply and a
// recycled name re-applies fresh after deletion.
describe('moveWindow/resizeWindow Lua-side dedup', () => {
    it('applies real moves/resizes and is a safe no-op when unchanged', async () => {
        const { session, run, dispose } = await createTestRuntime();
        const geo = () => {
            const l = session.labels.list('main').find(x => x.name === 'dd');
            return l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
        };

        run('createLabel("dd", 0, 0, 10, 10, 1)');
        run('moveWindow("dd", 30, 40); resizeWindow("dd", 100, 50)');
        expect(geo()).toEqual({ x: 30, y: 40, w: 100, h: 50 });

        // A different position must apply (not be wrongly skipped).
        run('moveWindow("dd", 31, 40)');
        expect(geo()).toMatchObject({ x: 31, y: 40 });

        // Repeating the same geometry is a no-op but leaves state correct.
        run('moveWindow("dd", 31, 40); resizeWindow("dd", 100, 50)');
        expect(geo()).toEqual({ x: 31, y: 40, w: 100, h: 50 });

        dispose();
    });

    it('re-applies geometry after a name is deleted and recreated', async () => {
        const { session, run, dispose } = await createTestRuntime();
        const geo = () => {
            const l = session.labels.list('main').find(x => x.name === 'rc');
            return l ? { x: l.x, y: l.y } : null;
        };
        run('createLabel("rc", 0, 0, 10, 10, 1); moveWindow("rc", 50, 60)');
        expect(geo()).toMatchObject({ x: 50, y: 60 });
        run('deleteLabel("rc")');
        // Recreate at a different spot, then move to the OLD cached coords — the
        // cache was invalidated on delete, so this must actually apply.
        run('createLabel("rc", 5, 5, 10, 10, 1); moveWindow("rc", 50, 60)');
        expect(geo()).toMatchObject({ x: 50, y: 60 });
        dispose();
    });
});
