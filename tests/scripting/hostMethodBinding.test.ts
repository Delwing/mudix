// @vitest-environment node
//
// node, not happy-dom: TriggerEngine pulls in pcre2-wasm, which loads its WASM
// from the filesystem here instead of trying a streaming fetch.
import { describe, it, expect } from 'vitest';
import { ScriptingAPI } from '../../src/scripting/ScriptingAPI';
import { NULL_ENGINE_HOST, type EngineHost } from '../../src/scripting/EngineHost';
import { MudSession } from '../../src/mud/MudSession';
import { AliasEngine } from '../../src/mud/aliases/AliasEngine';
import { TriggerEngine } from '../../src/mud/triggers/TriggerEngine';
import { TimerEngine } from '../../src/mud/timers/TimerEngine';
import { KeyEngine } from '../../src/mud/keybindings/KeyEngine';

/**
 * EngineHost is satisfied by ScriptingEngine's *prototype* methods, which —
 * unlike the closure fields they replaced — carry no binding of their own.
 * Anywhere the API hands a host member out as a value rather than calling it,
 * `this` is lost and the method faults on its first field access.
 *
 * That is exactly what happened to the label-stylesheet path: it received
 * `this.host.rewriteCss` detached, and ScriptingEngine.rewriteCss dereferences
 * this.vfs, so setLabelStyleSheet died with
 *   "Cannot read properties of undefined (reading 'vfs')"
 * from any script that styled a label (sysLoadEvent, restart_ui, …).
 */

/** A host shaped like the real engine: prototype methods that need `this`. */
class HostWithState {
    private readonly marker = '/vfs-resolved/';
    rewriteCss(css: string): string {
        // Mirrors ScriptingEngine.rewriteCss dereferencing this.vfs — throws
        // outright when called unbound.
        return css.replace('PLACEHOLDER/', this.marker);
    }
}

function makeApi() {
    const session = new MudSession();
    const api = new ScriptingAPI(
        session, new AliasEngine(), new TriggerEngine(), new TimerEngine(), new KeyEngine(),
        'host-binding-test',
    );
    return { api, session };
}

describe('host methods survive being handed out as values', () => {
    it('label stylesheets reach a this-dependent rewriteCss', () => {
        const { api, session } = makeApi();
        const engineish = new HostWithState();
        const host: EngineHost = Object.assign(
            Object.create(Object.getPrototypeOf(engineish) as object) as EngineHost,
            NULL_ENGINE_HOST,
            engineish,
        );
        // Keep rewriteCss on the prototype (unbound) exactly as the real engine has it.
        (host as unknown as { rewriteCss: unknown }).rewriteCss =
            HostWithState.prototype.rewriteCss;
        api.setHost(host);

        api.labels.create('styled', { x: 0, y: 0, width: 10, height: 10, fillBackground: false });

        // The regression threw here rather than returning a value.
        expect(() => api.labels.setStyleSheet('styled', 'background: url(PLACEHOLDER/bg.png);'))
            .not.toThrow();
        expect(session.labels.getStyleSheet('styled')).toContain('/vfs-resolved/bg.png');

        session.destroy();
    });

    it('an unbound host still yields the CSS untouched rather than throwing', () => {
        const { api, session } = makeApi();
        api.setHost(null);

        api.labels.create('plain', { x: 0, y: 0, width: 10, height: 10, fillBackground: false });
        expect(() => api.labels.setStyleSheet('plain', 'color: red;')).not.toThrow();
        expect(session.labels.getStyleSheet('plain')).toContain('color: red;');

        session.destroy();
    });
});
