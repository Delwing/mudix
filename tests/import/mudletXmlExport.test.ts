import { describe, it, expect } from 'vitest';
import { serializeMudletXml, type SerializeInput } from '../../src/import/mudletXmlExport';
import { parseMudletXml } from '../../src/import/mudletXmlImport';
import type { ScriptNode, TimerNode, TriggerNode } from '../../src/storage/schema';

const EMPTY: SerializeInput = { scripts: [], aliases: [], triggers: [], timers: [], keys: [], buttons: [] };

function trigger(p: Partial<TriggerNode>): TriggerNode {
    return {
        id: 't', name: 'T', enabled: true, isGroup: false, parentId: null,
        patterns: [{ text: 'HP: (\\d+)', type: 'regex' }],
        code: 'echo("x")', language: 'lua', fireLength: 0, multipleMatches: false,
        multiline: false, delta: 0, isFilter: false, ...p,
    };
}

describe('serializeMudletXml — Mudlet format', () => {
    it('emits trigger flags as ATTRIBUTES, not child elements (the Mudlet shape)', () => {
        const xml = serializeMudletXml({ ...EMPTY, triggers: [trigger({ enabled: false, multiline: true, isFilter: true })] });
        // attributes Mudlet reads
        expect(xml).toContain('isActive="no"');
        expect(xml).toContain('isMultiline="yes"');
        expect(xml).toContain('isFilterTrigger="yes"');
        expect(xml).toContain('isTempTrigger="no"');
        expect(xml).toContain('isColorTriggerFg="no"');
        // NOT the old broken element form
        expect(xml).not.toContain('<isMultiline>');
        expect(xml).not.toContain('<isTempTrigger>');
    });

    it('emits the trigger child elements Mudlet expects, including color fields', () => {
        const xml = serializeMudletXml({ ...EMPTY, triggers: [trigger({})] });
        for (const tag of ['name', 'script', 'triggerType', 'conditonLineDelta', 'mStayOpen',
            'mCommand', 'packageName', 'mFgColor', 'mBgColor', 'mSoundFile',
            'colorTriggerFgColor', 'colorTriggerBgColor', 'regexCodeList', 'regexCodePropertyList']) {
            expect(xml).toContain(`<${tag}`);
        }
    });

    it('round-trips trigger flags through mudix import (export → import preserves them)', () => {
        const xml = serializeMudletXml({ ...EMPTY, triggers: [trigger({ multiline: true, multipleMatches: true, isFilter: true })] });
        const back = parseMudletXml(xml).triggers[0];
        expect(back).toMatchObject({ multiline: true, multipleMatches: true, isFilter: true });
    });

    it('orders script children name → packageName → script → eventHandlerList', () => {
        const script: ScriptNode = {
            id: 's', name: 'S', enabled: true, isGroup: false, parentId: null,
            code: '-- x', language: 'lua', eventHandlers: ['sysLoadEvent'],
        };
        const xml = serializeMudletXml({ ...EMPTY, scripts: [script] });
        expect(xml.indexOf('<packageName')).toBeLessThan(xml.indexOf('<script>'));
        expect(xml.indexOf('<script>')).toBeLessThan(xml.indexOf('<eventHandlerList'));
    });

    it('emits timer flags isTempTimer/isOffsetTimer as attributes', () => {
        const timer: TimerNode = {
            id: 'tm', name: 'Tm', enabled: true, isGroup: false, parentId: null,
            seconds: 5, code: '', language: 'lua', repeat: true,
        };
        const xml = serializeMudletXml({ ...EMPTY, timers: [timer] });
        expect(xml).toContain('isTempTimer="no"');
        expect(xml).toContain('isOffsetTimer="no"');
        expect(xml).not.toContain('<isTempTimer>');
    });
});
