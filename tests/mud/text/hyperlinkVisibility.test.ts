import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyVisibility, HyperlinkVisibilityController } from '../../../src/mud/text/hyperlinkVisibility';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const span = (): HTMLElement => document.createElement('span');
const click = (el: HTMLElement): void => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

describe('applyVisibility — timer/click actions', () => {
  it('reveal: starts hidden, reveals after the delay (from render)', () => {
    const el = span();
    applyVisibility(el, { action: 'reveal', delayMs: 5000 });
    expect(el.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(4999);
    expect(el.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(1);
    expect(el.style.visibility).toBe('visible');
  });

  it('reveal with no delay leaves the link visible', () => {
    const el = span();
    applyVisibility(el, { action: 'reveal', delayMs: 0 });
    expect(el.style.visibility).toBe('');
  });

  it('conceal: hides on click, after the delay', () => {
    const el = span();
    applyVisibility(el, { action: 'conceal', delayMs: 2000 });
    expect(el.style.visibility).toBe(''); // visible until clicked
    click(el);
    expect(el.style.visibility).toBe(''); // delay not elapsed
    vi.advanceTimersByTime(2000);
    expect(el.style.visibility).toBe('hidden');
  });

  it('conceal with zero delay hides immediately on click', () => {
    const el = span();
    applyVisibility(el, { action: 'conceal' });
    click(el);
    expect(el.style.visibility).toBe('hidden');
  });

  it('reveal-then-conceal: reveals after delay, then conceals on click', () => {
    const el = span();
    applyVisibility(el, { action: 'reveal-then-conceal', delayMs: 1000 });
    expect(el.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(1000);
    expect(el.style.visibility).toBe('visible');
    click(el);
    expect(el.style.visibility).toBe('hidden');
  });

  it('deletesEntireLine: conceal removes the whole output line', () => {
    const line = document.createElement('div');
    line.className = 'output-msg';
    const el = span();
    line.appendChild(el);
    document.body.appendChild(line);
    applyVisibility(el, { action: 'conceal', deletesEntireLine: true });
    click(el);
    expect(document.body.contains(line)).toBe(false);
  });
});

describe('HyperlinkVisibilityController — expire on session events', () => {
  it('arms only after click, then conceals on the second input (first is the command itself)', () => {
    const root = document.createElement('div');
    const el = span();
    root.appendChild(el);
    applyVisibility(el, { action: 'conceal', expireOnInput: true });

    // Not armed before the click.
    const ctrl = new HyperlinkVisibilityController(() => root);
    ctrl.onInput();
    expect(el.dataset.oscVisExpire).toBeUndefined();
    expect(el.style.visibility).toBe('');

    click(el); // arms (and would have sent the link's command)
    expect(el.dataset.oscVisExpire).toBe('input');

    ctrl.onInput(); // first input = the command's own echo → skipped
    expect(el.style.visibility).toBe('');
    ctrl.onInput(); // next real input → conceal
    expect(el.style.visibility).toBe('hidden');
  });

  it('expire on prompt fires once (after skipping the response prompt)', () => {
    const root = document.createElement('div');
    const el = span();
    root.appendChild(el);
    applyVisibility(el, { action: 'conceal', expireOnPrompt: true });
    click(el);
    const ctrl = new HyperlinkVisibilityController(() => root);
    ctrl.onPrompt(); // skipped
    expect(el.style.visibility).toBe('');
    ctrl.onPrompt(); // conceal
    expect(el.style.visibility).toBe('hidden');
    // fires once — the data attr is cleared
    expect(el.dataset.oscVisExpire).toBeUndefined();
  });

  it('expire with deletesEntireLine removes the line on the trigger', () => {
    const line = document.createElement('div');
    line.className = 'output-msg';
    const el = span();
    line.appendChild(el);
    document.body.appendChild(line);
    applyVisibility(el, { action: 'conceal', expireOnOutput: true, deletesEntireLine: true });
    click(el);
    const ctrl = new HyperlinkVisibilityController(() => document);
    ctrl.onOutput(); // skipped
    expect(document.body.contains(line)).toBe(true);
    ctrl.onOutput(); // removes the line
    expect(document.body.contains(line)).toBe(false);
  });

  it('ignores triggers that do not match the armed set', () => {
    const root = document.createElement('div');
    const el = span();
    root.appendChild(el);
    applyVisibility(el, { action: 'conceal', expireOnInput: true });
    click(el);
    const ctrl = new HyperlinkVisibilityController(() => root);
    ctrl.onPrompt(); ctrl.onPrompt(); ctrl.onOutput(); // wrong triggers
    expect(el.style.visibility).toBe('');
  });
});

describe('toDom wires visibility', () => {
  const ESC = '\x1b';
  const ST = `${ESC}\\`;
  it('a reveal link renders hidden and appears after its delay', () => {
    const buf = new AnsiAwareBuffer(
      `${ESC}]8;;send:x?config={"visibility":{"action":"reveal","delay":3000}}${ST}Soon${ESC}]8;;${ST}`,
    );
    const el = buf.toDom().querySelector('[data-output-clickable]') as HTMLElement;
    expect(el.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(3000);
    expect(el.style.visibility).toBe('visible');
  });
});
