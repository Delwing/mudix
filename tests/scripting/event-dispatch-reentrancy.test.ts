// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';

// Mudlet parity (Host::raiseEvent): an event raised while another event is
// still dispatching is queued and delivered after the in-flight dispatch
// completes — never nested inside it.
//
// Regression: EleUI2's install flow. installPackage(url) downloads the
// .mpackage; the sysDownloadDone handler installs the package, whose init
// raises sysInstallPackage; that handler runs the package's GitUpdater, which
// registers its own sysDownloadDone handler. With synchronous nested dispatch
// the new handler was appended to the very list the outer sysDownloadDone
// dispatch was iterating and received the in-flight event — GitUpdater took
// the package's own install download for a finished update and uninstalled
// the package it belonged to.
describe('event dispatch — events raised mid-dispatch are deferred', () => {
  let t: TestRuntime;
  let errors: string[];
  let off: () => void;

  beforeEach(async () => {
    t = await createTestRuntime();
    errors = [];
    off = t.session.events.on('script.log', (text: string, level: string) => {
      if (level === 'error') errors.push(text);
    });
  });

  afterEach(() => {
    off();
    t.dispose();
  });

  it('raiseEvent inside a handler dispatches after the current event finishes', () => {
    t.run(`
      order = {}
      registerAnonymousEventHandler('outerEvt', function()
        order[#order + 1] = 'outer-begin'
        raiseEvent('innerEvt')
        order[#order + 1] = 'outer-end'
      end)
      registerAnonymousEventHandler('innerEvt', function()
        order[#order + 1] = 'inner'
      end)
    `);
    t.rt.emitEvent('outerEvt', []);
    expect(t.run(`return table.concat(order, ',')`)).toBe('outer-begin,outer-end,inner');
    expect(errors).toHaveLength(0);
  });

  it('deferred events dispatch in FIFO order with their arguments', () => {
    t.run(`
      got = {}
      registerAnonymousEventHandler('fifoOuter', function()
        raiseEvent('fifoChild', 'first')
        raiseEvent('fifoChild', 'second')
      end)
      registerAnonymousEventHandler('fifoChild', function(_, arg)
        got[#got + 1] = arg
      end)
    `);
    t.rt.emitEvent('fifoOuter', []);
    expect(t.run(`return table.concat(got, ',')`)).toBe('first,second');
    expect(errors).toHaveLength(0);
  });

  it('a handler registered from a nested event does not receive the in-flight event', () => {
    // Mirrors the EleUI2 flow: 'download' handler triggers a nested 'install'
    // event whose handler registers a NEW 'download' handler (GitUpdater).
    // That handler must not be called with the download that installed it.
    t.run(`
      updaterSeen = {}
      registerAnonymousEventHandler('download', function()
        raiseEvent('install')
      end)
      registerAnonymousEventHandler('install', function()
        registerAnonymousEventHandler('download', function(_, path)
          updaterSeen[#updaterSeen + 1] = path
        end)
      end)
    `);
    t.rt.emitEvent('download', ['EleUI2.mpackage']);
    expect(t.run('return #updaterSeen')).toBe(0);

    // A later download IS seen by the updater handler.
    t.rt.emitEvent('download', ['update.mpackage']);
    expect(t.run('return updaterSeen[1]')).toBe('update.mpackage');
    expect(t.run('return #updaterSeen')).toBe(1);
    expect(errors).toHaveLength(0);
  });
});
