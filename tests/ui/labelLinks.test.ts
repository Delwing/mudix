import { describe, it, expect, beforeEach } from 'vitest';
import { classifyLabelLink, labelLinkHref } from '../../src/ui/labels/labelLinks';
import { LabelManager } from '../../src/ui/labels/LabelManager';

// Issue #20: `<a href="send:...">` echoed into a Geyser label did nothing —
// the anchor was injected into the DOM with no handler, so the browser tried
// (and failed) to navigate to an unknown scheme. Mudlet routes these through
// TLabel::slot_linkActivated; these tests lock in the same scheme rules. The
// ScriptingAPI end of the wiring is covered in scripting/labelLinkActivation.

describe('classifyLabelLink', () => {
    it('sends a send: payload verbatim (no percent-decoding, Qt hands it through raw)', () => {
        expect(classifyLabelLink('send:help topics')).toEqual({ kind: 'send', command: 'help topics' });
        expect(classifyLabelLink('send:cast%20fireball')).toEqual({ kind: 'send', command: 'cast%20fireball' });
    });

    it('stages a prompt: payload', () => {
        expect(classifyLabelLink('prompt:cast fireball')).toEqual({ kind: 'prompt', command: 'cast fireball' });
    });

    it('treats the scheme case-insensitively', () => {
        expect(classifyLabelLink('SEND:look')).toEqual({ kind: 'send', command: 'look' });
        expect(classifyLabelLink('Prompt:look')).toEqual({ kind: 'prompt', command: 'look' });
    });

    it('opens http/https links with the full URL', () => {
        expect(classifyLabelLink('https://mudlet.org/')).toEqual({ kind: 'url', url: 'https://mudlet.org/' });
        expect(classifyLabelLink('http://mudlet.org/')).toEqual({ kind: 'url', url: 'http://mudlet.org/' });
    });

    it('runs a scheme-less href as Lua', () => {
        expect(classifyLabelLink('doStuff()')).toEqual({ kind: 'lua', code: 'doStuff()' });
    });

    it('ignores every other scheme rather than falling through to Lua', () => {
        // The security point of the ordering: an unknown scheme must NOT reach
        // the Lua branch, or `javascript:`/`file:` hrefs would execute.
        expect(classifyLabelLink('javascript:alert(1)')).toBeNull();
        expect(classifyLabelLink('file:///etc/passwd')).toBeNull();
        expect(classifyLabelLink('ftp://example.org/')).toBeNull(); // labels take no ftp (Mudlet parity)
        expect(classifyLabelLink('')).toBeNull();
    });
});

describe('labelLinkHref', () => {
    it('finds the enclosing anchor from a nested click target', () => {
        const root = document.createElement('div');
        root.innerHTML = '<a href="send:help topics"><span id="inner">Help</span></a>';
        expect(labelLinkHref(root.querySelector('#inner'))).toBe('send:help topics');
    });

    it('reads the raw attribute, not the resolved .href property', () => {
        // `.href` would resolve against the page URL and percent-encode the
        // space, mangling the command the MUD receives.
        const root = document.createElement('div');
        root.innerHTML = '<a href="send:help topics">Help</a>';
        const a = root.querySelector('a')!;
        expect(labelLinkHref(a)).toBe('send:help topics');
        expect(labelLinkHref(a)).not.toContain('%20');
    });

    it('returns null off a link, or for a non-element target', () => {
        const root = document.createElement('div');
        root.innerHTML = '<a>no href</a><b id="plain">text</b>';
        expect(labelLinkHref(root.querySelector('#plain'))).toBeNull();
        expect(labelLinkHref(root.querySelector('a'))).toBeNull();
        expect(labelLinkHref(null)).toBeNull();
    });
});

describe('LabelManager link activation', () => {
    let manager: LabelManager;
    let activated: string[];

    beforeEach(() => {
        manager = new LabelManager();
        activated = [];
        manager.setLinkActivator((href) => { activated.push(href); });
        manager.create('helpLabel', { x: 0, y: 0, width: 100, height: 20, fillBackground: false });
    });

    it('forwards the clicked href to the activator', () => {
        manager.activateLink('helpLabel', 'send:help topics');
        expect(activated).toEqual(['send:help topics']);
    });

    it('records visited links only once a visited color is configured', () => {
        manager.activateLink('helpLabel', 'send:one');
        expect(manager.get('helpLabel')?.visitedLinks).toBeUndefined();

        manager.setLinkStyle('helpLabel', 'cyan', 'magenta', true);
        manager.activateLink('helpLabel', 'send:one');
        manager.activateLink('helpLabel', 'send:two');
        expect([...manager.get('helpLabel')!.visitedLinks!]).toEqual(['send:one', 'send:two']);
    });

    it('still activates a link on a label that no longer exists', () => {
        manager.destroy('helpLabel');
        manager.activateLink('helpLabel', 'send:look');
        expect(activated).toEqual(['send:look']);
    });
});
