// @vitest-environment node
//
// Exercises the REAL OutputRenderer DOM (see tests/createDomRuntime.ts). These
// verify behaviours that the plain (DOM-less) runtime can't: actual rendered
// HTML, popup menus opened from a right-click, and in-place re-renders.
//
// One runtime is shared across the file (beforeAll/afterAll) — each DOM runtime
// pairs a wasmoon Lua state with a happy-dom Window, and spinning up a fresh
// pair per test accumulates enough memory to get the worker OOM-killed.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDomRuntime, type DomTestRuntime } from '../createDomRuntime';

let env: DomTestRuntime;
beforeAll(async () => { env = await createDomRuntime(); });
afterAll(async () => {
  // The popup menu schedules `setTimeout(() => document.addEventListener(...), 0)`
  // for its dismiss handler. Let that 0ms timer fire (while `document` still
  // exists) BEFORE dispose() tears the DOM globals down — otherwise it runs
  // post-teardown, throws "document is not defined" in a timer callback, and
  // kills the worker.
  await new Promise((r) => setTimeout(r, 0));
  env.dispose();
});
beforeEach(() => {
  // Reset rendered output + the main console buffer between tests.
  env.controls.clear();
  env.session.consoles.get('main')?.clear();
  env.mainOutput.length = 0;
});

function lineEls(): Element[] {
  return [...env.outputWrapper.querySelectorAll('.output-msg .output-msg-content')];
}

describe('OutputRenderer DOM — basic echo', () => {
  it('renders an echoed line into the output wrapper', () => {
    env.run('cecho("<red>hello<reset>\\n")');
    expect(lineEls().map((e) => e.textContent)).toEqual(['hello']);
  });
});

describe('wrapLine — in-place DOM re-render', () => {
  it('re-renders a line whose buffer changed without a render, interpreting \\n', () => {
    env.run('cecho("hello\\n")');
    expect(lineEls()[0].textContent).toBe('hello');

    // Mutate the rendered line's buffer directly WITHOUT re-rendering — this is
    // the situation wrapLine exists for (e.g. an edit made mid-trigger where the
    // render is deferred). The DOM is now stale.
    const main = env.session.consoles.get('main')!;
    main.getBuffer()!.insert(5, '\nworld', {});
    expect(lineEls()[0].textContent).toBe('hello'); // still stale

    // wrapLine re-renders the shared buffer in place; pre-wrap shows the \n.
    expect(env.run('return (wrapLine("main", getLineCount() - 1))')).toBe(true);
    expect(lineEls()[0].textContent).toBe('hello\nworld');
  });
});

describe('setProfileStyleSheet — installs a <style> block in document.head', () => {
  it('creates a single profile-keyed style tag and replaces its content on re-call', () => {
    expect(env.run('return (setProfileStyleSheet(".foo { color: red; }"))')).toBe(true);
    const el = env.body.ownerDocument.getElementById('mudix-profile-stylesheet') as HTMLStyleElement | null;
    expect(el).toBeTruthy();
    expect(el!.tagName).toBe('STYLE');
    expect(el!.parentElement).toBe(env.body.ownerDocument.head);
    expect(el!.textContent).toBe('.foo { color: red; }');

    // A second call replaces the content in place — no duplicate tag.
    env.run('setProfileStyleSheet(".bar { color: blue; }")');
    const all = env.body.ownerDocument.querySelectorAll('#mudix-profile-stylesheet');
    expect(all.length).toBe(1);
    expect((all[0] as HTMLStyleElement).textContent).toBe('.bar { color: blue; }');

    // It's distinct from the setAppStyleSheet block (different ids coexist).
    env.run('setAppStyleSheet(".app { margin: 0; }")');
    expect(env.body.ownerDocument.getElementById('mudix-profile-stylesheet')).toBeTruthy();
    expect((env.body.ownerDocument.getElementById('mudix-profile-stylesheet') as HTMLStyleElement).textContent)
      .toBe('.bar { color: blue; }');
  });

  it('raises sysAppStyleSheetChange with tag "profile"', () => {
    // Wire api → runtime event routing exactly as ScriptingEngine does (the
    // bare test runtime doesn't set this up). Restored after the assertion.
    env.api.setEventRaiser((event, args) => env.rt.emitEvent(event, args));
    env.run([
      'sawCss, sawTag = nil, nil',
      'registerAnonymousEventHandler("sysAppStyleSheetChange", function(_, css, tag) sawCss = css; sawTag = tag end)',
      'setProfileStyleSheet(".x { top: 0; }")',
    ].join('\n'));
    expect(env.run('return sawTag')).toBe('profile');
    expect(env.run('return sawCss')).toBe('.x { top: 0; }');
    env.api.setEventRaiser(null);
  });
});

describe('echoPopup — right-click menu in the real DOM', () => {
  it('opens a popup on contextmenu and runs the chosen command', () => {
    env.run('clicked = nil');
    env.run('echoPopup("look\\n", {"clicked = \\"statue\\""}, {"Look at statue"})');

    // The clickable segment span (carries the contextmenu handler) is marked
    // data-output-clickable; the outer .output-msg-content span is not.
    const span = env.outputWrapper.querySelector('[data-output-clickable="true"]');
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe('look');

    // No menu until the user right-clicks.
    expect(env.body.querySelector('#mudix-popup-menu')).toBeNull();
    span!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    const menu = env.body.querySelector('#mudix-popup-menu');
    expect(menu).toBeTruthy();
    const items = [...menu!.querySelectorAll('div')];
    expect(items.map((i) => i.textContent)).toEqual(['Look at statue']);

    // Choosing the entry runs its command (wired to run as Lua).
    items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(env.run('return clicked')).toBe('statue');
  });
});
