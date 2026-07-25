// @vitest-environment jsdom

// The one plugin suite that needs a real DOM tree: woc.ui.panel builds panel
// nodes with document.createElement, so the host lifecycle (panels torn down
// on auto-disable) is only observable under jsdom. Timers are faked for the
// whole file so the host's shared 1s ticker never leaks a real interval.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import {
  buildPluginApi,
  PluginInstanceState,
  type PluginPanelHandle,
} from '../src/ui/plugins/plugin_api';
import type { PluginPlayerSnapshot } from '../src/ui/plugins/plugin_events_core';
import { PluginHost, type PluginHostDeps } from '../src/ui/plugins/plugin_host';
import type { InstalledRowWire } from '../src/ui/plugins/plugins_client';

const SNAPSHOT: PluginPlayerSnapshot = {
  id: 1,
  name: 'Aki',
  level: 5,
  hp: 50,
  hpMax: 80,
  xp: 100,
  xpNext: 1050,
  copper: 20,
  x: 1.5,
  z: -2.5,
};

/** The woc surface shape the tests poke at (buildPluginApi returns `object`). */
interface WocApi {
  apiVersion: number;
  meta: { slug: string; name: string; version: number };
  on(type: string, handler: unknown): void;
  off(type: string, handler: unknown): void;
  player(): PluginPlayerSnapshot | null;
  ui: {
    panel(opts?: { id?: string; title?: string }): PluginPanelHandle;
    toast(text: string): void;
    sound(cue: string): void;
  };
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): boolean;
    remove(key: string): void;
  };
  util: {
    esc(value: unknown): string;
    formatNumber(value: number): string;
    formatMoney(copper: number): string;
    formatDuration(seconds: number): string;
  };
}

interface Harness {
  host: PluginHost;
  layer: HTMLElement;
  toasts: string[];
  sounds: string[];
  autoDisabled: string[];
  deps: PluginHostDeps;
}

const hosts: PluginHost[] = [];

function makeHarness(overrides: Partial<PluginHostDeps> = {}): Harness {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const toasts: string[] = [];
  const sounds: string[] = [];
  const autoDisabled: string[] = [];
  const deps: PluginHostDeps = {
    panelLayer: () => layer,
    toast: (text) => {
      toasts.push(text);
    },
    sound: (cue) => {
      sounds.push(cue);
    },
    playerSnapshot: () => SNAPSHOT,
    onAutoDisabled: (name) => {
      autoDisabled.push(name);
    },
    ...overrides,
  };
  const host = new PluginHost(deps);
  hosts.push(host);
  return { host, layer, toasts, sounds, autoDisabled, deps };
}

function row(
  slug: string,
  source: string,
  overrides: Partial<InstalledRowWire> = {},
): InstalledRowWire {
  return {
    id: 1,
    slug,
    name: slug,
    summary: '',
    category: 'tools',
    version: 1,
    enabled: true,
    source,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const chatEvent: SimEvent = { type: 'chat', fromPid: 7, from: 'Aki', text: 'hello' };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  for (const host of hosts) host.stopAll();
  hosts.length = 0;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PluginHost.startOne', () => {
  it('executes the source with a frozen woc as its only name', () => {
    const h = makeHarness();
    const source = `
      woc.ui.toast('booted:' + [woc, woc.ui, woc.storage, woc.util, woc.meta]
        .every(Object.isFrozen));
    `;
    expect(h.host.startOne(row('meter', source))).toBe(true);
    expect(h.host.isRunning('meter')).toBe(true);
    expect(h.toasts).toEqual(['booted:true']);
  });

  it('returns false on a boot throw: the plugin is not running and nothing fires later', () => {
    const h = makeHarness();
    const source = `
      woc.on('enable', () => woc.ui.toast('enabled'));
      woc.on('chat', () => woc.ui.toast('chatted'));
      throw new Error('boom');
    `;
    expect(h.host.startOne(row('broken', source))).toBe(false);
    expect(h.host.isRunning('broken')).toBe(false);
    h.host.dispatchSimEvents([chatEvent]);
    expect(h.toasts).toEqual([]);
  });

  it('returns false on a syntax error in the source', () => {
    const h = makeHarness();
    expect(h.host.startOne(row('typo', 'this is (not js'))).toBe(false);
    expect(h.host.isRunning('typo')).toBe(false);
  });
});

describe('PluginHost.dispatchSimEvents', () => {
  it('routes a chat SimEvent to a chat handler with the mapped data', () => {
    const h = makeHarness();
    h.host.startOne(row('echo', `woc.on('chat', (d) => woc.ui.toast(JSON.stringify(d)));`));
    h.host.dispatchSimEvents([chatEvent]);
    expect(h.toasts).toHaveLength(1);
    expect(JSON.parse(h.toasts[0])).toEqual({
      from: 'Aki',
      fromPid: 7,
      channel: 'say',
      text: 'hello',
    });
  });

  it('does not fire handlers for events outside the plugin vocabulary', () => {
    const h = makeHarness();
    const source = `
      woc.on('chat', () => woc.ui.toast('chat'));
      woc.on('combat', () => woc.ui.toast('combat'));
    `;
    h.host.startOne(row('quiet', source));
    const unmapped: SimEvent[] = [
      { type: 'aura', targetId: 2, name: 'Rend', gained: true },
      { type: 'comboPoint', points: 2 },
      { type: 'vendor', action: 'sell' },
    ];
    h.host.dispatchSimEvents(unmapped);
    expect(h.toasts).toEqual([]);
  });
});

describe('auto-disable after repeated handler errors', () => {
  it('disables once after 5 throws: name reported, panels removed, no re-fire', () => {
    const h = makeHarness();
    const source = `
      woc.ui.panel({ id: 'meter', title: 'Meter' });
      woc.on('chat', () => { throw new Error('bad'); });
    `;
    h.host.startOne(row('bad-meter', source, { name: 'Bad Meter' }));
    expect(h.layer.querySelectorAll('.plugin-panel')).toHaveLength(1);

    for (let i = 0; i < 4; i++) h.host.dispatchSimEvents([chatEvent]);
    expect(h.autoDisabled).toEqual([]);
    expect(h.host.isRunning('bad-meter')).toBe(true);

    h.host.dispatchSimEvents([chatEvent]);
    expect(h.autoDisabled).toEqual(['Bad Meter']);
    expect(h.host.isRunning('bad-meter')).toBe(false);
    expect(h.layer.querySelectorAll('.plugin-panel')).toHaveLength(0);

    h.host.dispatchSimEvents([chatEvent]);
    expect(h.autoDisabled).toEqual(['Bad Meter']);
  });
});

describe('PluginHost.syncInstalled', () => {
  it('starts enabled rows and skips disabled ones', () => {
    const h = makeHarness();
    h.host.syncInstalled([
      row('alpha', `woc.ui.toast('alpha up');`),
      row('beta', `woc.ui.toast('beta up');`, { enabled: false }),
    ]);
    expect(h.host.isRunning('alpha')).toBe(true);
    expect(h.host.isRunning('beta')).toBe(false);
    expect(h.toasts).toEqual(['alpha up']);
  });

  it('restarts on a version bump: old disable handler fires, new source runs', () => {
    const h = makeHarness();
    const v1 = row(
      'alpha',
      `woc.on('disable', () => woc.ui.toast('v1 down')); woc.ui.toast('v1 up');`,
    );
    h.host.syncInstalled([v1]);
    expect(h.toasts).toEqual(['v1 up']);

    // Same version again: the reconcile leaves the running instance alone.
    h.host.syncInstalled([v1]);
    expect(h.toasts).toEqual(['v1 up']);

    h.host.syncInstalled([row('alpha', `woc.ui.toast('v2 up');`, { version: 2 })]);
    expect(h.toasts).toEqual(['v1 up', 'v1 down', 'v2 up']);
    expect(h.host.isRunning('alpha')).toBe(true);
  });

  it('stops a plugin whose row is gone', () => {
    const h = makeHarness();
    h.host.syncInstalled([row('alpha', `woc.on('disable', () => woc.ui.toast('down'));`)]);
    expect(h.host.isRunning('alpha')).toBe(true);
    h.host.syncInstalled([]);
    expect(h.host.isRunning('alpha')).toBe(false);
    expect(h.toasts).toEqual(['down']);
  });
});

describe('the shared 1s ticker', () => {
  it('delivers a player snapshot to tick handlers every 1000ms', () => {
    const h = makeHarness();
    h.host.startOne(row('ticker', `woc.on('tick', (d) => woc.ui.toast(JSON.stringify(d)));`));
    expect(h.toasts).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(h.toasts).toHaveLength(1);
    expect(JSON.parse(h.toasts[0])).toEqual(SNAPSHOT);
    vi.advanceTimersByTime(2000);
    expect(h.toasts).toHaveLength(3);
  });

  it('delivers nothing while the snapshot is null (out of world)', () => {
    const h = makeHarness({ playerSnapshot: () => null });
    h.host.startOne(row('ticker', `woc.on('tick', () => woc.ui.toast('tick'));`));
    vi.advanceTimersByTime(3000);
    expect(h.toasts).toEqual([]);
  });

  it('stopAll clears the interval: no ticks after teardown', () => {
    const h = makeHarness();
    h.host.startOne(row('ticker', `woc.on('tick', () => woc.ui.toast('tick'));`));
    vi.advanceTimersByTime(1000);
    expect(h.toasts).toHaveLength(1);
    h.host.stopAll();
    vi.advanceTimersByTime(5000);
    expect(h.toasts).toHaveLength(1);
  });
});

describe('storage caps via the api', () => {
  function makeApi(slug = 'slugx'): { api: WocApi; state: PluginInstanceState; h: Harness } {
    const h = makeHarness();
    const state = new PluginInstanceState(slug, 'SlugX', 1);
    const api = buildPluginApi(state, h.deps) as WocApi;
    return { api, state, h };
  }

  it('rejects a single value over the 8KB per-key cap, accepts one at the cap', () => {
    const { api } = makeApi();
    expect(api.storage.set('big', 'x'.repeat(9000))).toBe(false);
    expect(localStorage.getItem('wocplugin.slugx.k.big')).toBeNull();
    // 8190 chars + 2 JSON quotes = exactly 8192 bytes: allowed.
    expect(api.storage.set('fits', 'x'.repeat(8190))).toBe(true);
  });

  it('rejects a write that would push the plugin total over 64KB', () => {
    const { api } = makeApi();
    // 8 keys at exactly 8192 JSON bytes each fill the 64KB budget precisely.
    for (let i = 0; i < 8; i++) {
      expect(api.storage.set(`k${i}`, 'x'.repeat(8190))).toBe(true);
    }
    expect(api.storage.set('k8', 'x')).toBe(false);
    // Overwriting an existing key subtracts its current size first.
    expect(api.storage.set('k0', 'y'.repeat(8190))).toBe(true);
  });

  it('round-trips JSON and namespaces keys as wocplugin.<slug>.k.<key>', () => {
    const { api } = makeApi();
    const value = { a: 1, b: 'two', list: [1, 2, 3] };
    expect(api.storage.set('obj', value)).toBe(true);
    expect(api.storage.get('obj')).toEqual(value);
    expect(localStorage.getItem('wocplugin.slugx.k.obj')).toBe(JSON.stringify(value));
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.key(i)).toMatch(/^wocplugin\.slugx\.k\./);
    }
    api.storage.remove('obj');
    expect(api.storage.get('obj')).toBeNull();
    expect(localStorage.getItem('wocplugin.slugx.k.obj')).toBeNull();
  });
});

describe('api surface', () => {
  function makeApi(): { api: WocApi; state: PluginInstanceState; h: Harness } {
    const h = makeHarness();
    const state = new PluginInstanceState('surface', 'Surface', 3);
    const api = buildPluginApi(state, h.deps) as WocApi;
    return { api, state, h };
  }

  it('freezes woc and its ui/storage/util/meta facets', () => {
    const { api } = makeApi();
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.ui)).toBe(true);
    expect(Object.isFrozen(api.storage)).toBe(true);
    expect(Object.isFrozen(api.util)).toBe(true);
    expect(Object.isFrozen(api.meta)).toBe(true);
  });

  it('on() is a no-op for unknown event types and non-function handlers', () => {
    const { api, state } = makeApi();
    api.on('nonsense', () => {});
    api.on('chat', 42);
    api.on('chat', 'handler');
    expect(state.handlers.size).toBe(0);
  });

  it('caps handlers at 16 per event type', () => {
    const { api, state } = makeApi();
    for (let i = 0; i < 20; i++) api.on('chat', () => i);
    expect(state.handlers.get('chat')?.size).toBe(16);
  });

  it('caps panels at 4 and reuses the handle for a repeated id', () => {
    const { api } = makeApi();
    const first = api.ui.panel({ id: 'p1' });
    expect(api.ui.panel({ id: 'p1' })).toBe(first);
    api.ui.panel({ id: 'p2' });
    api.ui.panel({ id: 'p3' });
    api.ui.panel({ id: 'p4' });
    expect(() => api.ui.panel({ id: 'p5' })).toThrow('panel limit reached');
  });

  it('forwards only allowlisted sound cues', () => {
    const { api, h } = makeApi();
    api.ui.sound('coin');
    api.ui.sound('kaboom');
    api.ui.sound('alert');
    expect(h.sounds).toEqual(['coin', 'alert']);
  });

  it('util.esc escapes ampersand, angle brackets, and both quotes', () => {
    const { api } = makeApi();
    expect(api.util.esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(api.util.esc('<b>Bad & "Plugin"</b>')).toBe(
      '&lt;b&gt;Bad &amp; &quot;Plugin&quot;&lt;/b&gt;',
    );
  });
});
