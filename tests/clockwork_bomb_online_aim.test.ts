import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the live command path is
// under test (the gather_rare_event_online.test.ts idiom).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { itemUseAim } from '../server/item_use_wire';
import { ClientWorld } from '../src/net/online';
import type { SimEvent } from '../src/sim/types';

// Discord bug report "Clockwork Bomb still not working as intended": online,
// the bomb ignored the ground-aim reticle and burst 8 yards ahead of the
// player. The HUD handed the reticle point to useItem, but ClientWorld dropped
// it from the 'use' frame and the server passed no aim to the sim, so the sim
// always took its no-aim fallback. Offline (the local Sim) was never affected.

function liveSetup() {
  const server = new GameServer();
  const ws = { readyState: 1, send: () => {} };
  const session = server.join(ws as any, 71, 71, 'Bomber', 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  const p = server.sim.entities.get(session.pid);
  if (!p) throw new Error('missing entity');
  p.pos = { x: 0, y: p.pos.y, z: 0 };
  p.prevPos = { ...p.pos };
  p.facing = 0;
  server.sim.addItem('clockwork_shock_bomb', 1, session.pid);
  server.sim.tick();
  server.sim.drainEvents();
  return { server, session };
}

function bombBurst(events: SimEvent[]) {
  const burst = events.find((e) => e.type === 'spellfxAt' && e.ability === 'clockwork_shock_bomb');
  if (burst?.type !== 'spellfxAt') throw new Error('no bomb burst');
  return burst;
}

describe('Clockwork Shock Bomb ground aim over the live command path', () => {
  it('ClientWorld sends the reticle point on the use frame', () => {
    const sent: any[] = [];
    const client: any = Object.create(ClientWorld.prototype);
    client.cmd = (m: unknown) => sent.push(m);
    client.useItem('clockwork_shock_bomb', { aim: { x: 12, z: -7 } });
    expect(sent).toEqual([
      expect.objectContaining({ cmd: 'use', item: 'clockwork_shock_bomb', aim: { x: 12, z: -7 } }),
    ]);
  });

  it('an unaimed use keeps its old wire shape', () => {
    const sent: any[] = [];
    const client: any = Object.create(ClientWorld.prototype);
    client.cmd = (m: unknown) => sent.push(m);
    client.useItem('minor_healing_potion', { slotIndex: 3 });
    expect(JSON.parse(JSON.stringify(sent[0]))).toEqual({
      cmd: 'use',
      item: 'minor_healing_potion',
      slot: 3,
    });
  });

  it('the server lands the bomb at the aimed point, not ahead of the player', () => {
    const { server, session } = liveSetup();
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'use', item: 'clockwork_shock_bomb', aim: { x: 12, z: -7 } }),
    );
    const burst = bombBurst(server.sim.drainEvents());
    expect(burst.x).toBeCloseTo(12);
    expect(burst.z).toBeCloseTo(-7);
  });

  it('a far aim is clamped to the 30 yard throw range', () => {
    const { server, session } = liveSetup();
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'use', item: 'clockwork_shock_bomb', aim: { x: 100, z: 0 } }),
    );
    const burst = bombBurst(server.sim.drainEvents());
    expect(burst.x).toBeCloseTo(30);
    expect(burst.z).toBeCloseTo(0);
  });

  it('a malformed aim falls back to the forward throw', () => {
    const { server, session } = liveSetup();
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'use', item: 'clockwork_shock_bomb', aim: { x: 'a', z: 1 } }),
    );
    const burst = bombBurst(server.sim.drainEvents());
    expect(burst.x).toBeCloseTo(0);
    expect(burst.z).toBeCloseTo(8);
  });
});

describe('itemUseAim', () => {
  it('accepts a finite x/z point and strips extra fields', () => {
    expect(itemUseAim({ x: 1.5, z: -2, y: 9 })).toEqual({ x: 1.5, z: -2 });
  });

  it('refuses anything else', () => {
    expect(itemUseAim(undefined)).toBeUndefined();
    expect(itemUseAim(null)).toBeUndefined();
    expect(itemUseAim('1,2')).toBeUndefined();
    expect(itemUseAim({ x: 1 })).toBeUndefined();
    expect(itemUseAim({ x: Number.NaN, z: 0 })).toBeUndefined();
    expect(itemUseAim({ x: 0, z: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});
