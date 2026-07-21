// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MxpParser } from '../../../src/mud/protocol/mxp';

const ESC = '\x1b';
const SECURE = `${ESC}[1z`; // SOUND/MUSIC are secure-only tags

function makeParser() {
  const sent: string[] = [];
  const parser = new MxpParser({ send: (raw) => sent.push(raw) });
  return { parser, sent };
}

describe('MxpParser — SOUND / MUSIC (MXP audio)', () => {
  it('parses a SOUND tag with all fields into an MspCommand', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<sound zap.wav V=80 L=2 P=50 T=combat U=http://x/snd/>`);
    expect(r.sounds).toEqual([
      { kind: 'sound', file: 'zap.wav', volume: 80, loops: 2, priority: 50, type: 'combat', url: 'http://x/snd/' },
    ]);
    expect(r.plain).toBe(''); // the tag itself renders nothing
  });

  it('parses a MUSIC tag with continue and infinite loop', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<music theme.mp3 V=40 L=-1 C=1 T=ambient>`);
    expect(r.sounds).toEqual([
      { kind: 'music', file: 'theme.mp3', volume: 40, loops: -1, continueIfPlaying: true, type: 'ambient' },
    ]);
  });

  it('takes the filename from the first positional and omits absent fields', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<sound hit.wav>`);
    expect(r.sounds).toEqual([{ kind: 'sound', file: 'hit.wav' }]);
  });

  it('accepts FNAME as a named attribute', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<sound fname=hit.wav V=100>`);
    expect(r.sounds?.[0]).toEqual({ kind: 'sound', file: 'hit.wav', volume: 100 });
  });

  it('normalises Off / off to the canonical stop token', () => {
    const { parser } = makeParser();
    expect(parser.parseLine(`${SECURE}<sound Off>`).sounds).toEqual([{ kind: 'sound', file: 'Off' }]);
    expect(parser.parseLine(`${SECURE}<music off>`).sounds).toEqual([{ kind: 'music', file: 'Off' }]);
  });

  it('clamps volume and priority to 0..100', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<sound zap.wav V=150 P=-5>`);
    expect(r.sounds?.[0]).toMatchObject({ volume: 100, priority: 0 });
  });

  it('ignores priority on MUSIC and continue on SOUND', () => {
    const { parser } = makeParser();
    const music = parser.parseLine(`${SECURE}<music a.mp3 P=50>`).sounds?.[0];
    expect(music).not.toHaveProperty('priority');
    const sound = parser.parseLine(`${SECURE}<sound a.wav C=1>`).sounds?.[0];
    expect(sound).not.toHaveProperty('continueIfPlaying');
  });

  it('only sets continueIfPlaying when C=1', () => {
    const { parser } = makeParser();
    expect(parser.parseLine(`${SECURE}<music a.mp3 C=0>`).sounds?.[0]).not.toHaveProperty('continueIfPlaying');
  });

  it('ignores a fileless SOUND/MUSIC tag', () => {
    const { parser } = makeParser();
    expect(parser.parseLine(`${SECURE}<sound>`).sounds).toBeUndefined();
    expect(parser.parseLine(`${SECURE}<music V=50>`).sounds).toBeUndefined();
  });

  it('does not fire in open (non-secure) line mode', () => {
    const { parser } = makeParser();
    // No secure prefix → default open mode; SOUND is a secure-only tag.
    const r = parser.parseLine(`<sound zap.wav>`);
    expect(r.sounds).toBeUndefined();
  });

  it('advertises +sound and +music (not -) in the SUPPORT reply', () => {
    const { parser, sent } = makeParser();
    parser.parseLine(`${SECURE}<support>`);
    const reply = sent.join('\n');
    expect(reply).toContain('+sound');
    expect(reply).toContain('+music');
    expect(reply).not.toContain('-sound');
    expect(reply).not.toContain('-music');
  });
});
