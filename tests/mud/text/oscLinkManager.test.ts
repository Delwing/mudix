import { describe, it, expect } from 'vitest';
import { OscLinkManager } from '../../../src/mud/text/oscLinkManager';

describe('OscLinkManager state', () => {
  it('exclusive groups behave like radio buttons', () => {
    const m = new OscLinkManager();
    expect(m.toggleSelection('diff', 'easy', true)).toBe(true);
    expect(m.isSelected('diff', 'easy')).toBe(true);
    // selecting another value in the exclusive group deselects the first
    expect(m.toggleSelection('diff', 'hard', true)).toBe(true);
    expect(m.isSelected('diff', 'easy')).toBe(false);
    expect(m.isSelected('diff', 'hard')).toBe(true);
    // toggling the selected one off
    expect(m.toggleSelection('diff', 'hard', true)).toBe(false);
    expect(m.isSelected('diff', 'hard')).toBe(false);
  });

  it('non-exclusive groups behave like independent checkboxes', () => {
    const m = new OscLinkManager();
    expect(m.toggleSelection('buffs', 'str', false)).toBe(true);
    expect(m.toggleSelection('buffs', 'dex', false)).toBe(true);
    expect(m.isSelected('buffs', 'str')).toBe(true);
    expect(m.isSelected('buffs', 'dex')).toBe(true);
    expect(m.toggleSelection('buffs', 'str', false)).toBe(false);
    expect(m.isSelected('buffs', 'str')).toBe(false);
    expect(m.isSelected('buffs', 'dex')).toBe(true);
  });

  it('tracks visited keys', () => {
    const m = new OscLinkManager();
    expect(m.isVisited('look')).toBe(false);
    m.markVisited('look');
    expect(m.isVisited('look')).toBe(true);
  });

  it('clear() resets all state', () => {
    const m = new OscLinkManager();
    m.toggleSelection('g', 'v', true);
    m.markVisited('x');
    m.clear();
    expect(m.isSelected('g', 'v')).toBe(false);
    expect(m.isVisited('x')).toBe(false);
  });
});

describe('OscLinkManager.restyle (live DOM, cross-element)', () => {
  function radio(group: string, value: string): HTMLElement {
    const el = document.createElement('span');
    el.dataset.oscGroup = group;
    el.dataset.oscValue = value;
    el.dataset.oscExclusive = 'true';
    el.dataset.cssBase = 'color: #fff';
    el.dataset.cssSelected = 'background-color: #008000';
    el.style.cssText = el.dataset.cssBase;
    return el;
  }

  it('applies the selected style to the selected value and reverts the rest', () => {
    const m = new OscLinkManager();
    const root = document.createElement('div');
    const easy = radio('diff', 'easy');
    const hard = radio('diff', 'hard');
    root.append(easy, hard);

    m.toggleSelection('diff', 'easy', true);
    m.restyle(root);
    expect(easy.style.cssText).toContain('#008000');
    expect(hard.style.cssText).toContain('#fff');

    // exclusive switch: selecting hard reverts easy
    m.toggleSelection('diff', 'hard', true);
    m.restyle(root);
    expect(hard.style.cssText).toContain('#008000');
    expect(easy.style.cssText).toContain('#fff');
  });

  it('applies the visited style to a visited link', () => {
    const m = new OscLinkManager();
    const root = document.createElement('div');
    const el = document.createElement('span');
    el.dataset.oscVisit = 'send:look';
    el.dataset.cssBase = 'color: #fff';
    el.dataset.cssVisited = 'color: #888';
    el.style.cssText = el.dataset.cssBase;
    root.appendChild(el);

    m.restyle(root);
    expect(el.style.cssText).toContain('#fff');
    m.markVisited('send:look');
    m.restyle(root);
    expect(el.style.cssText).toContain('#888');
  });

  it('is a no-op without a root', () => {
    expect(() => new OscLinkManager().restyle(null)).not.toThrow();
  });
});
