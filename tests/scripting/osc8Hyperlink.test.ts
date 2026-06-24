// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { MudSession } from '../../src/mud/MudSession';
import { AliasEngine } from '../../src/mud/aliases/AliasEngine';
import { TriggerEngine } from '../../src/mud/triggers/TriggerEngine';
import { TimerEngine } from '../../src/mud/timers/TimerEngine';
import { KeyEngine } from '../../src/mud/keybindings/KeyEngine';
import { ScriptingAPI } from '../../src/scripting/ScriptingAPI';

// Build a bare ScriptingAPI (no Lua runtime / socket) and capture sends.
function makeApi(): { api: ScriptingAPI; sent: string[] } {
  const w = globalThis as { window?: unknown };
  if (typeof w.window === 'undefined') {
    w.window = { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {} };
  }
  const api = new ScriptingAPI(
    new MudSession(), new AliasEngine(), new TriggerEngine(), new TimerEngine(), new KeyEngine(),
    'test-connection',
  );
  const sent: string[] = [];
  (api as unknown as { send: (c: string) => void }).send = (c: string) => { sent.push(c); };
  return { api, sent };
}

describe('createOsc8Hyperlink — OSC 8 extension query never leaks into commands', () => {
  let api: ScriptingAPI;
  let sent: string[];
  beforeAll(() => { ({ api, sent } = makeApi()); });

  it('strips ?config={…} from a send: command (regression: no JSON in the command)', () => {
    const hl = api.createOsc8Hyperlink('send:attack?config={"style":{"color":"red"},"tooltip":"hit"}');
    expect(hl).toBeTruthy();
    expect(hl?.title).toBe('attack'); // clean command, not "attack?config=…"
    sent.length = 0;
    hl?.onClick?.(new Event('click') as MouseEvent);
    expect(sent).toEqual(['attack']);
  });

  it('strips the whole query from a prompt: command', () => {
    const hl = api.createOsc8Hyperlink('prompt:cast fireball?preset=warn&config={"s":{"c":"red"}}');
    expect(hl?.title).toBe('cast fireball');
  });

  it('leaves a bare send: link unchanged', () => {
    const hl = api.createOsc8Hyperlink('send:look');
    expect(hl?.title).toBe('look');
  });

  it('keeps user query params on web links but drops config/preset', () => {
    const hl = api.createOsc8Hyperlink('https://mudlet.org/?id=42&lang=en&config={"style":{"bold":true}}');
    expect(hl?.title).toBe('https://mudlet.org/?id=42&lang=en');
  });

  it('still drops disallowed schemes', () => {
    expect(api.createOsc8Hyperlink('javascript:alert(1)?config={}')).toBeUndefined();
  });
});
