import { describe, it, expect, beforeEach } from 'vitest';
import {
  navigableLinks,
  focusAdjacentLink,
  handleLinkNavKeydown,
  restoreFocusAfterLinkClick,
} from '../../src/ui/output/linkNavigation';

function link(label: string): HTMLElement {
  const el = document.createElement('span');
  el.dataset.outputClickable = 'true';
  el.tabIndex = -1;
  el.textContent = label;
  return el;
}

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('navigableLinks', () => {
  it('returns clickable links in document order, skipping concealed ones', () => {
    const a = link('a'), b = link('b'), c = link('c');
    b.style.visibility = 'hidden'; // concealed → skipped
    root.append(a, b, c);
    expect(navigableLinks(root)).toEqual([a, c]);
  });

  it('collapses a multicolour link (shared data-link-group) to one stop', () => {
    const run1 = link('Fla'), run2 = link('ming'), other = link('Go');
    run1.dataset.linkGroup = 'inst:1';   // two colour runs of one logical link
    run2.dataset.linkGroup = 'inst:1';
    other.dataset.linkGroup = 'inst:2';
    root.append(run1, run2, other);
    // Only the first run of each group is a navigation stop.
    expect(navigableLinks(root)).toEqual([run1, other]);
  });
});

describe('focusAdjacentLink', () => {
  it('Ctrl+] from nothing focuses the first; Ctrl+[ focuses the last', () => {
    const a = link('a'), b = link('b');
    root.append(a, b);
    expect(focusAdjacentLink(root, 1)).toBe(a);
    expect(document.activeElement).toBe(a);

    (document.activeElement as HTMLElement)?.blur();
    expect(focusAdjacentLink(root, -1)).toBe(b);
  });

  it('moves forward and wraps from last to first', () => {
    const a = link('a'), b = link('b'), c = link('c');
    root.append(a, b, c);
    a.focus();
    expect(focusAdjacentLink(root, 1)).toBe(b);
    expect(focusAdjacentLink(root, 1)).toBe(c);
    expect(focusAdjacentLink(root, 1)).toBe(a); // wrap
  });

  it('moves backward and wraps from first to last', () => {
    const a = link('a'), b = link('b');
    root.append(a, b);
    a.focus();
    expect(focusAdjacentLink(root, -1)).toBe(b); // wrap
    expect(focusAdjacentLink(root, -1)).toBe(a);
  });

  it('returns null when there are no links', () => {
    expect(focusAdjacentLink(root, 1)).toBeNull();
  });
});

describe('handleLinkNavKeydown', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  it('handles Ctrl+] (next) and Ctrl+[ (prev)', () => {
    const a = link('a'), b = link('b');
    root.append(a, b);
    a.focus();
    expect(handleLinkNavKeydown(key({ key: ']', ctrlKey: true }), root)).toBe(true);
    expect(document.activeElement).toBe(b);
    expect(handleLinkNavKeydown(key({ key: '[', ctrlKey: true }), root)).toBe(true);
    expect(document.activeElement).toBe(a);
  });

  it('accepts Cmd (metaKey) as well', () => {
    const a = link('a'), b = link('b');
    root.append(a, b);
    a.focus();
    expect(handleLinkNavKeydown(key({ key: ']', metaKey: true }), root)).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('ignores plain ] / [ and modified variants (Shift/Alt)', () => {
    root.append(link('a'), link('b'));
    expect(handleLinkNavKeydown(key({ key: ']' }), root)).toBe(false);
    expect(handleLinkNavKeydown(key({ key: ']', ctrlKey: true, shiftKey: true }), root)).toBe(false);
    expect(handleLinkNavKeydown(key({ key: 'x', ctrlKey: true }), root)).toBe(false);
  });

  it('Enter / Space activates the focused link (clicks it)', () => {
    const a = link('a');
    let clicks = 0;
    a.addEventListener('click', () => { clicks++; });
    root.append(a);
    a.focus();
    expect(handleLinkNavKeydown(key({ key: 'Enter' }), root)).toBe(true);
    expect(clicks).toBe(1);
    expect(handleLinkNavKeydown(key({ key: ' ' }), root)).toBe(true);
    expect(clicks).toBe(2);
  });

  it('Menu key / Shift+F10 opens the focused link\'s context menu', () => {
    const a = link('a');
    let ctx = 0;
    a.addEventListener('contextmenu', () => { ctx++; });
    root.append(a);
    a.focus();
    expect(handleLinkNavKeydown(key({ key: 'ContextMenu' }), root)).toBe(true);
    expect(handleLinkNavKeydown(key({ key: 'F10', shiftKey: true }), root)).toBe(true);
    expect(ctx).toBe(2);
  });

  it('does not activate when no link is focused', () => {
    const a = link('a');
    let clicks = 0;
    a.addEventListener('click', () => { clicks++; });
    root.append(a);
    a.blur();
    expect(handleLinkNavKeydown(key({ key: 'Enter' }), root)).toBe(false);
    expect(clicks).toBe(0);
  });

  it('skips activation if the key was already handled (defaultPrevented)', () => {
    const a = link('a');
    let clicks = 0;
    a.addEventListener('click', () => { clicks++; });
    root.append(a);
    a.focus();
    const e = key({ key: 'Enter', cancelable: true });
    e.preventDefault(); // e.g. a spoiler's own reveal handler already acted
    expect(handleLinkNavKeydown(e, root)).toBe(false);
    expect(clicks).toBe(0);
  });
});

describe('restoreFocusAfterLinkClick', () => {
  // A left-click reports detail >= 1; `element.click()` (how Enter/Space
  // activates a link) reports 0.
  const click = (target: EventTarget | null, detail = 1) => ({ detail, target });
  const flush = () => new Promise<void>(resolve => queueMicrotask(() => resolve()));

  let cmdLine: HTMLInputElement;
  beforeEach(() => {
    cmdLine = document.createElement('input');
    document.body.appendChild(cmdLine);
    cmdLine.focus();
  });

  it('hands focus back to the command line after a link steals it', async () => {
    const a = link('a');
    root.append(a);
    a.focus(); // what the browser does on mousedown — tabIndex -1 is mouse-focusable
    restoreFocusAfterLinkClick(click(a), () => cmdLine);
    await flush();
    expect(document.activeElement).toBe(cmdLine);
  });

  it('works when the click lands on a child of the link span', async () => {
    const a = link('a');
    const child = document.createElement('b');
    a.append(child);
    root.append(a);
    a.focus();
    restoreFocusAfterLinkClick(click(child), () => cmdLine);
    await flush();
    expect(document.activeElement).toBe(cmdLine);
  });

  it('ignores clicks that did not land on a link', async () => {
    const plain = document.createElement('span');
    root.append(plain);
    plain.focus();
    restoreFocusAfterLinkClick(click(plain), () => cmdLine);
    await flush();
    expect(document.activeElement).not.toBe(cmdLine);
  });

  it('leaves keyboard activation alone so Ctrl+] can carry on from the link', async () => {
    const a = link('a');
    root.append(a);
    a.focus();
    restoreFocusAfterLinkClick(click(a, 0), () => cmdLine);
    await flush();
    expect(document.activeElement).toBe(a);
  });

  it('does not disturb focus the link handler moved somewhere else', async () => {
    const a = link('a');
    const dialogField = document.createElement('input');
    root.append(a, dialogField);
    a.focus();
    restoreFocusAfterLinkClick(click(a), () => cmdLine);
    dialogField.focus(); // e.g. the link opened a dialog that focused itself
    await flush();
    expect(document.activeElement).toBe(dialogField);
  });
});
