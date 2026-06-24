import { describe, it, expect } from 'vitest';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';
import { HyperlinkPresetRegistry } from '../../../src/mud/text/hyperlinkConfig';

const ESC = '\x1b';
const ST = `${ESC}\\`;
const open = (uri: string) => `${ESC}]8;;${uri}${ST}`;
const close = `${ESC}]8;;${ST}`;

describe('OSC 8 config carried to the buffer at parse time', () => {
  it('stores the cleaned command + parsed config on the hyperlink', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:attack?config={"style":{"color":"red","bold":true},"tooltip":"hit"}')}Attack${close}`,
    );
    expect(buf.text).toBe('Attack');
    const hl = buf.getStateAt(0)?.hyperlink;
    expect(hl?.url).toBe('send:attack'); // query stripped
    expect(hl?.config?.style?.foreground).toEqual({ space: 'rgb', r: 255, g: 0, b: 0 });
    expect(hl?.config?.style?.bold).toBe(true);
    expect(hl?.config?.tooltip).toBe('hit');
  });

  it('carries the id= parameter for grouping', () => {
    const buf = new AnsiAwareBuffer(`${ESC}]8;id=grp;send:x${ST}A${close}`);
    expect(buf.getStateAt(0)?.hyperlink?.linkId).toBe('grp');
  });

  it('resolves a preset defined on an earlier buffer (shared registry)', () => {
    const reg = new HyperlinkPresetRegistry();
    new AnsiAwareBuffer(`${open('preset:btn?config={"s":{"c":"white","b":true}}')}${close}`, undefined, reg);
    const buf = new AnsiAwareBuffer(`${open('send:go?preset=btn')}Go${close}`, undefined, reg);
    const hl = buf.getStateAt(0)?.hyperlink;
    expect(hl?.config?.style?.bold).toBe(true);
    expect(hl?.config?.style?.foreground).toEqual({ space: 'rgb', r: 255, g: 255, b: 255 });
  });

  it('does not create a hyperlink for a preset definition itself', () => {
    const reg = new HyperlinkPresetRegistry();
    const buf = new AnsiAwareBuffer(`${open('preset:btn?config={"s":{"c":"white"}}')}${close}after`, undefined, reg);
    expect(buf.text).toBe('after');
    expect(buf.getStateAt(0)?.hyperlink).toBeUndefined();
  });
});

describe('toHtml renders OSC 8 link styling', () => {
  it('applies config.style colour/bold and emits data-link-id', () => {
    const buf = new AnsiAwareBuffer(
      `${ESC}]8;id=g1;send:x?config={"style":{"color":"#ff0000","bold":true}}${ST}X${close}`,
    );
    const html = buf.toHtml();
    expect(html).toContain('color: #ff0000');
    expect(html).toContain('font-weight: bold');
    expect(html).toContain('data-link-id="g1"');
  });

  it('emits underline variant + decoration-colour longhand', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:x?config={"style":{"underline":"wavy","text-decoration-color":"#00ff00"}}')}X${close}`,
    );
    const html = buf.toHtml();
    expect(html).toContain('text-decoration: underline');
    expect(html).toContain('text-decoration-style: wavy');
    expect(html).toContain('text-decoration-color: #00ff00');
  });

  it('config.style colour overrides the run\'s SGR colour', () => {
    // SGR green inside the link, but config says red → red wins.
    const buf = new AnsiAwareBuffer(`${open('send:x?config={"style":{"color":"red"}}')}${ESC}[32mX${close}`);
    const html = buf.toHtml();
    expect(html).toContain('color: #ff0000');
    expect(html).not.toContain('color: #00bb00');
  });
});

describe('toDom OSC 8 interactions', () => {
  it('applies base style and marks the link clickable', () => {
    const buf = new AnsiAwareBuffer(`${open('send:x?config={"style":{"color":"#0000ff"}}')}X${close}`);
    const span = buf.toDom().querySelector('[data-output-clickable]') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.style.cssText).toContain('#0000ff');
    expect(span.style.cssText).toContain('cursor: pointer');
  });

  it('swaps to the hover style on mouseenter and reverts on mouseleave', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:x?config={"style":{"color":"#0000ff","hover":{"color":"#ff0000"}}}')}X${close}`,
    );
    const span = buf.toDom().querySelector('span') as HTMLElement;
    span.dispatchEvent(new Event('mouseenter'));
    expect(span.style.cssText).toContain('#ff0000');
    span.dispatchEvent(new Event('mouseleave'));
    expect(span.style.cssText).toContain('#0000ff');
    expect(span.style.cssText).not.toContain('#ff0000');
  });

  it('hover propagates to every run sharing the same id', () => {
    // The `\e[1m` splits the link into two runs that share id=g.
    const buf = new AnsiAwareBuffer(
      `${ESC}]8;id=g;send:x?config={"style":{"color":"#0000ff","hover":{"color":"#ff0000"}}}${ST}A${ESC}[1mB${close}`,
    );
    const spans = Array.from(buf.toDom().querySelectorAll('[data-link-id="g"]')) as HTMLElement[];
    expect(spans.length).toBe(2);
    spans[0].dispatchEvent(new Event('mouseenter'));
    expect(spans[0].style.cssText).toContain('#ff0000');
    expect(spans[1].style.cssText).toContain('#ff0000');
    spans[1].dispatchEvent(new Event('mouseleave'));
    expect(spans[0].style.cssText).toContain('#0000ff');
    expect(spans[1].style.cssText).toContain('#0000ff');
  });

  it('renders a disabled link with a default cursor', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:x?config={"disabled":true,"style":{"color":"#888888"}}')}X${close}`,
    );
    const span = buf.toDom().querySelector('[data-output-clickable]') as HTMLElement;
    expect(span.style.cssText).toContain('cursor: default');
  });

  it('emits selection data + the selected style variant, applying initial selected', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:easy?config={"selection":{"group":"diff","value":"easy","exclusive":true,"selected":true},"style":{"selected":{"bg":"green"}}}')}Easy${close}`,
    );
    const span = buf.toDom().querySelector('[data-osc-group]') as HTMLElement;
    expect(span.dataset.oscGroup).toBe('diff');
    expect(span.dataset.oscValue).toBe('easy');
    expect(span.dataset.oscExclusive).toBe('true');
    expect(span.dataset.cssSelected).toContain('#008000'); // green selected bg
    expect(span.dataset.cssBase).toBeTruthy();
    // server pre-selected → the selected style is applied at render
    expect(span.style.cssText).toContain('#008000');
  });

  it('conceals a spoiler until the first click reveals it', () => {
    const buf = new AnsiAwareBuffer(
      `${open('send:x?config={"spoiler":true,"style":{"color":"#ffff00"}}')}42${close}`,
    );
    const span = buf.toDom().querySelector('[data-output-clickable]') as HTMLElement;
    expect(span.dataset.spoiler).toBe('hidden');
    expect(span.style.cssText).toContain('color: transparent');
    expect(span.style.cssText).toContain('background-color: #ffff00'); // block in the text colour
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(span.dataset.spoiler).toBe('shown');
    expect(span.style.cssText).not.toContain('transparent');
  });
});
