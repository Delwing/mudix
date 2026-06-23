// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import { useAppStore } from '../../src/storage/appStore';

const CONN = 'test-connection';

describe('setConfig / getConfig', () => {
    let h: TestRuntime;
    beforeAll(async () => { h = await createTestRuntime(); });
    afterAll(() => h.dispose());

    it('binds the base globals (Other.lua wrapper has something to capture)', () => {
        expect(h.run('return type(getConfig)')).toBe('function');
        expect(h.run('return type(setConfig)')).toBe('function');
    });

    it('round-trips a structured protocol toggle into profile.protocols', () => {
        h.run('setConfig("enableMSDP", true)');
        expect(useAppStore.getState().connectionProfile[CONN]?.protocols?.msdp).toBe(true);
        expect(h.run('return getConfig("enableMSDP")')).toBe(true);
        h.run('setConfig("enableMSDP", false)');
        expect(h.run('return getConfig("enableMSDP")')).toBe(false);
    });

    it('maps inverse "force off" keys to the negated protocol flag', () => {
        h.run('setConfig("specialForceMxpNegotiationOff", true)');
        expect(useAppStore.getState().connectionProfile[CONN]?.protocols?.mxp).toBe(false);
        expect(h.run('return getConfig("specialForceMxpNegotiationOff")')).toBe(true);
        expect(h.run('return getConfig("enableMXP")')).toBe(false);
    });

    it('routes autoClearInputLine to the autoClearInput field', () => {
        h.run('setConfig("autoClearInputLine", true)');
        expect(useAppStore.getState().connectionProfile[CONN]?.autoClearInput).toBe(true);
        expect(h.run('return getConfig("autoClearInputLine")')).toBe(true);
    });

    it('maps mapper keys to renderer settings', () => {
        h.run('setConfig("mapRoundRooms", true)');
        expect(useAppStore.getState().connectionProfile[CONN]?.mapper?.roomShape).toBe('roundedRectangle');
        expect(h.run('return getConfig("mapRoundRooms")')).toBe(true);
        h.run('setConfig("mapRoomSize", 1.5)');
        expect(h.run('return getConfig("mapRoomSize")')).toBe(1.5);
    });

    it('applies showSentText live to the session and persists it', () => {
        h.run('setConfig("showSentText", false)');
        expect(h.session.echoSentText).toBe(false);
        expect(h.run('return getConfig("showSentText")')).toBe(false);
        // Suppressed echo: echoCommand must not emit a 'message'.
        const before = h.mainOutput.length;
        h.session.echoCommand('look');
        expect(h.mainOutput.length).toBe(before);
        h.run('setConfig("showSentText", true)');
        expect(h.session.echoSentText).toBe(true);
    });

    it('persists unbacked keys for round-trip and validates enums', () => {
        // default before set
        expect(h.run('return getConfig("blankLinesBehaviour")')).toBe('show');
        expect(h.run('return setConfig("blankLinesBehaviour", "hide")')).toBe(true);
        expect(h.run('return getConfig("blankLinesBehaviour")')).toBe('hide');
        // out-of-range enum value is rejected
        expect(h.run('return setConfig("blankLinesBehaviour", "bogus")')).toBe(false);
        expect(h.run('return getConfig("blankLinesBehaviour")')).toBe('hide');
    });

    it('rejects writes to read-only keys and returns a value for them', () => {
        expect(h.run('return setConfig("logDirectory", "/x")')).toBe(false);
        expect(typeof h.run('return getConfig("logDirectory")')).toBe('string');
    });

    it('returns nil for unknown keys and false when setting them', () => {
        expect(h.run('return getConfig("totallyMadeUpKey")')).toBeNull();
        expect(h.run('return setConfig("totallyMadeUpKey", 1)')).toBe(false);
    });

    it('round-trips mapInfoColor as an {r,g,b,a} table with default alpha', () => {
        // Default before any set — Mudlet's mMapInfoBg {150,150,150,120}.
        expect(h.run('local c = getConfig("mapInfoColor"); return c[1]..","..c[2]..","..c[3]..","..c[4]'))
            .toBe('150,150,150,120');
        // Set with explicit alpha.
        expect(h.run('return setConfig("mapInfoColor", {10, 20, 30, 40})')).toBe(true);
        expect(useAppStore.getState().connectionProfile[CONN]?.config?.mapInfoColor)
            .toEqual({ r: 10, g: 20, b: 30, a: 40 });
        expect(h.run('local c = getConfig("mapInfoColor"); return c[1]..","..c[2]..","..c[3]..","..c[4]'))
            .toBe('10,20,30,40');
        // Alpha omitted defaults to 255.
        h.run('setConfig("mapInfoColor", {1, 2, 3})');
        expect(useAppStore.getState().connectionProfile[CONN]?.config?.mapInfoColor)
            .toEqual({ r: 1, g: 2, b: 3, a: 255 });
        // Out-of-range channel is rejected (Mudlet validates 0..255).
        expect(h.run('return setConfig("mapInfoColor", {300, 0, 0, 0})')).toBe(false);
        // Non-table value is rejected.
        expect(h.run('return setConfig("mapInfoColor", "nope")')).toBe(false);
    });

    it('supports the Other.lua table form and no-arg dump', () => {
        h.run('setConfig({ enableGMCP = false, f3SearchEnabled = true })');
        expect(h.run('return getConfig("enableGMCP")')).toBe(false);
        expect(h.run('return getConfig("f3SearchEnabled")')).toBe(true);
        // no-arg dump returns a table containing known keys
        const hasKey = h.run('local t = getConfig(); return t.enableGMCP ~= nil');
        expect(hasKey).toBe(true);
    });
});
