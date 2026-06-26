// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import { useAppStore } from '../../src/storage/appStore';

// loadProfile opens another profile in a new browser tab (one profile per tab)
// and connects. It looks the connection up by name, then window.open's a deep
// link `?profile=<id>&connect=1`. Here we mock window.location + window.open so
// we can assert the URL it builds and the boolean it returns.
describe('loadProfile', () => {
  let env: TestRuntime;
  let opened: { url: string; target: string }[];
  let openResult: unknown;

  beforeEach(async () => {
    env = await createTestRuntime();
    opened = [];
    openResult = {}; // truthy WindowProxy stand-in
    const w = globalThis.window as unknown as {
      location: { href: string };
      open: (url: string, target: string) => unknown;
    };
    w.location = { href: 'https://app.example/' };
    w.open = (url: string, target: string) => { opened.push({ url, target }); return openResult; };

    // A second connection to load. createTestRuntime seeds 'test-connection'
    // (name 'Test') as the active profile.
    useAppStore.setState(s => ({
      connections: [
        ...s.connections.filter(c => c.id !== 'other-profile'),
        { id: 'other-profile', name: 'Other', url: 'ws://localhost' },
      ],
    }));
  });

  afterEach(() => {
    env.dispose();
    useAppStore.setState(s => ({ connections: s.connections.filter(c => c.id !== 'other-profile') }));
  });

  it('opens the named profile in a new tab with connect=1 and returns true', () => {
    const ok = env.run('return loadProfile("Other")');
    expect(ok).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].target).toBe('_blank');
    const url = new URL(opened[0].url);
    expect(url.searchParams.get('profile')).toBe('other-profile');
    expect(url.searchParams.get('connect')).toBe('1');
  });

  it('returns false and warns for an unknown profile name', () => {
    const ok = env.run('return loadProfile("Nope")');
    expect(ok).toBe(false);
    expect(opened).toHaveLength(0);
    expect(env.mainOutput.join('')).toContain('no profile named "Nope"');
  });

  it('returns false when targeting the profile already open in this tab', () => {
    const ok = env.run('return loadProfile("Test")');
    expect(ok).toBe(false);
    expect(opened).toHaveLength(0);
  });

  it('returns false when the popup is blocked (window.open → null)', () => {
    openResult = null;
    const ok = env.run('return loadProfile("Other")');
    expect(ok).toBe(false);
  });
});
