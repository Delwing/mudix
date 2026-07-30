// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MudSession } from '../../src/mud/MudSession';
import { AliasEngine } from '../../src/mud/aliases/AliasEngine';
import { TriggerEngine } from '../../src/mud/triggers/TriggerEngine';
import { TimerEngine } from '../../src/mud/timers/TimerEngine';
import { KeyEngine } from '../../src/mud/keybindings/KeyEngine';
import { ScriptingAPI } from '../../src/scripting/ScriptingAPI';

// Issue #20: an `<a href="send:...">` echoed into a Geyser label did nothing.
// The label overlay now routes anchor clicks to LabelManager.activateLink,
// which ScriptingAPI backs with Mudlet's TLabel::slot_linkActivated behaviour.
// The scheme-parsing half lives in ui/labelLinks; this covers the wiring and
// what each scheme actually does. (node env, like the OSC 8 suite: happy-dom
// can't fetch the pcre2 WASM ScriptingAPI's imports pull in.)

// Build a bare ScriptingAPI (no Lua runtime / socket) and capture every effect
// a label link can have.
function makeApi() {
  const w = globalThis as { window?: unknown };
  if (typeof w.window === 'undefined') {
    w.window = { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {} };
  }
  const session = new MudSession();
  const api = new ScriptingAPI(
    session, new AliasEngine(), new TriggerEngine(), new TimerEngine(), new KeyEngine(),
    'test-connection',
  );
  const sent: string[] = [];
  const urls: string[] = [];
  const lua: string[] = [];
  const prompted: string[] = [];
  (api as unknown as { send: (c: string) => void }).send = (c) => { sent.push(c); };
  (api as unknown as { openUrl: (u: string) => boolean }).openUrl = (u) => { urls.push(u); return true; };
  api.setHost({ ...api.engineHost, runLinkCode: (code: string) => { lua.push(code); } });
  session.events.on('script.setcmd', (text) => { prompted.push(text); });
  return { api, session, sent, urls, lua, prompted };
}

describe('label link activation', () => {
  it('is wired onto the session LabelManager, so a label click sends the command', () => {
    const { api, session, sent } = makeApi();
    api.labels.create('helpLabel', { x: 0, y: 0, width: 10, height: 10, fillBackground: false });
    session.labels.activateLink('helpLabel', 'send:help topics');
    expect(sent).toEqual(['help topics']);
  });

  it('stages prompt: links in the command bar instead of sending them', () => {
    const { api, sent, prompted } = makeApi();
    api.activateLabelLink('prompt:cast fireball');
    expect(sent).toEqual([]);
    expect(prompted).toEqual(['cast fireball']);
  });

  it('opens web links and runs a scheme-less href as Lua', () => {
    const { api, urls, lua } = makeApi();
    api.activateLabelLink('https://mudlet.org/');
    api.activateLabelLink('doStuff()');
    expect(urls).toEqual(['https://mudlet.org/']);
    expect(lua).toEqual(['doStuff()']);
  });

  it('does nothing at all for a rejected scheme', () => {
    const { api, sent, urls, lua, prompted } = makeApi();
    api.activateLabelLink('javascript:alert(1)');
    expect([...sent, ...urls, ...lua, ...prompted]).toEqual([]);
  });
});
