// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharLoginModal } from '../../src/ui/CharLoginModal';

// The point of this modal is password-manager interop, which hinges on a real
// <form> with the right autocomplete/type attributes. Lock those in. (JSX is
// avoided so the file stays a plain .test.ts, matching the suite's include glob.)
const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(CharLoginModal, { onSubmit: () => {}, onCancel: () => {}, ...props } as never));

describe('CharLoginModal markup', () => {
    const html = render({ connectionName: 'The Last Outpost' });

    it('renders a real form', () => {
        expect(html).toContain('<form');
    });

    it('has a username input for password managers', () => {
        // HTML attribute names are case-insensitive; the SSR renderer emits
        // them camelCased, so match either spelling.
        expect(html).toMatch(/<input[^>]*autocomplete="username"/i);
        expect(html).toMatch(/<input[^>]*name="username"/i);
    });

    it('has a password input with current-password autocomplete', () => {
        expect(html).toMatch(/<input[^>]*type="password"/i);
        expect(html).toMatch(/<input[^>]*autocomplete="current-password"/i);
    });

    it('shows a server error when provided', () => {
        const withError = render({ error: 'Invalid credentials' });
        expect(withError).toContain('Invalid credentials');
        expect(withError).toContain('role="alert"');
    });

    it('has a remember-on-this-device checkbox', () => {
        expect(html).toMatch(/<input[^>]*type="checkbox"/i);
        expect(html).toContain('Remember on this device');
    });

    it('prefills saved account + password', () => {
        const prefilled = render({ initialAccount: 'rahjiii', initialPassword: 'hunter2' });
        expect(prefilled).toMatch(/value="rahjiii"/);
        expect(prefilled).toMatch(/value="hunter2"/);
    });

    it('shows the storage warning (script/XSS risk, not physical) when remember is on', () => {
        // initialPassword defaults the checkbox to checked, so the warning shows.
        const remembered = render({ initialAccount: 'a', initialPassword: 'b' });
        expect(remembered).toMatch(/unencrypted/i);
        expect(remembered).toMatch(/script running on this page|XSS/i);
        expect(remembered).not.toMatch(/shared computer/i);
    });
});
