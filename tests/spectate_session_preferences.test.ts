import { afterEach, expect, it, vi } from 'vitest';
import { bareClient } from './helpers/bare_client';

afterEach(() => vi.unstubAllGlobals());

it('replays preferences changed while watching once the own snapshot releases the hold', () => {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const sent: Array<Record<string, unknown>> = [];
  const world = bareClient(1, {
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  });
  const wire = world as unknown as {
    onMessage(raw: string): void;
    applySnapshot(snapshot: unknown): void;
  };
  const self = (id: number, tid: string) => ({
    id,
    k: 'player',
    tid,
    nm: tid,
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
  });
  wire.applySnapshot({ t: 'snap', ents: [], self: self(1, 'warrior') });
  wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
  wire.applySnapshot({ t: 'snap', ents: [], self: self(2, 'mage') });
  world.setStopAutoAttackOnTargetSwitch(true);
  expect(sent).toEqual([]);
  wire.onMessage(JSON.stringify({ t: 'spectate', name: null }));
  expect(sent).toEqual([]);
  wire.applySnapshot({ t: 'snap', ents: [], self: self(1, 'warrior') });
  expect(sent).toEqual([{ t: 'cmd', cmd: 'stopAutoAttackOnTargetSwitch', enabled: true }]);
  wire.applySnapshot({ t: 'snap', ents: [], self: self(1, 'warrior') });
  expect(sent).toHaveLength(1);
});

it.each(['ordinary', 'active', 'exiting'])(
  'only restores reconnect camera facing after spectate (%s)',
  (mode) => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const world = bareClient(1, {
      reconnectAttempts: 1,
      spectating: mode === 'ordinary' ? null : 'Watched',
      spectateExitPending: mode === 'exiting',
    });
    const wire = world as unknown as {
      onMessage(raw: string): void;
      applySnapshot(snap: unknown): void;
    };
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    wire.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Me',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 1.25,
        hp: 100,
        mhp: 100,
      },
    });
    expect(world.consumeSpectateFacing()).toBe(mode !== 'ordinary' ? 1.25 : null);
    expect(world.consumeSpectateFacing()).toBeNull();
  },
);
