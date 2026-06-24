import { describe, it, expect, beforeEach } from 'vitest';
import {
  navigableLinks,
  focusAdjacentLink,
  handleLinkNavKeydown,
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
});
