import { describe, expect, it, vi } from 'vitest';

import { COMMAND_NAMES } from '../src/world_api';

// Mock the db layer so no Postgres is needed: only the command-dispatch hop is
// under test here.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { GameServer } from '../server/game';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// The wire half of the backward Tab cycle. The rest of the suite pins the
// tokens structurally (command_schema re-derives the send/dispatch sets from
// source, command_facets pins the tag), which cannot tell `case 'tabPrev'`
// apart from a copy-paste that dispatches `sim.tabTarget(pid)`. That is the
// single most likely regression for a mirrored command, so this drives the real
// dispatch switch and asserts on the resolved target instead.

type SimInternals = { dropEntity(id: number): void };

function dispatch(server: GameServer, session: unknown, cmd: string): void {
  const raw = JSON.stringify({ t: 'cmd', cmd });
  (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
    session,
    JSON.parse(raw),
    raw,
    0,
  );
}

function spawnMob(sim: Sim, p: Entity, id: number, dz: number): Entity {
  const mob = createMob(id, MOBS.ridge_stalker, 13, { x: p.pos.x, y: p.pos.y, z: p.pos.z + dz });
  sim.addEntity(mob);
  return mob;
}

describe('tab target server dispatch', () => {
  it('keeps the shipped forward tab command wired through server dispatch', () => {
    const server = new GameServer();
    const session = server.join(
      { readyState: 1, send: () => {} } as never,
      97,
      97,
      'Alpha',
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    const sim = server.sim;
    const p = sim.entities.get(session.pid) as Entity;
    p.facing = 0; // facing +Z, toward the mob below
    sim.rebucket(p);
    for (const id of [...sim.entities.keys()]) {
      if (id !== p.id) (sim as unknown as SimInternals).dropEntity(id);
    }
    const near = spawnMob(sim, p, 900200, 8);

    expect(COMMAND_NAMES).toContain('tab');
    dispatch(server, session, 'tab');
    expect(p.targetId).toBe(near.id);
  });

  it('cmd tabPrev steps the target back, where cmd tab steps it forward', () => {
    const server = new GameServer();
    const session = server.join(
      { readyState: 1, send: () => {} } as never,
      97,
      97,
      'Alpha',
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    const sim = server.sim;
    const p = sim.entities.get(session.pid) as Entity;
    p.facing = 0; // facing +Z, toward the three mobs below
    sim.rebucket(p);
    // Isolate from world-spawned mobs so the cycle order is exactly ours.
    for (const id of [...sim.entities.keys()]) {
      if (id !== p.id) (sim as unknown as SimInternals).dropEntity(id);
    }
    // Three mobs, so an alias-to-tabTarget regression is distinguishable: with
    // only two, stepping forward and stepping back land on the same enemy.
    const near = spawnMob(sim, p, 900201, 8);
    const mid = spawnMob(sim, p, 900202, 14);
    const far = spawnMob(sim, p, 900203, 20);

    expect(COMMAND_NAMES).toContain('tabPrev');
    dispatch(server, session, 'tab');
    expect(p.targetId).toBe(near.id);
    dispatch(server, session, 'tab');
    expect(p.targetId).toBe(mid.id);

    // The assertion that kills the copy-paste: aliasing tabPrev to tabTarget
    // would land on `far` here.
    dispatch(server, session, 'tabPrev');
    expect(p.targetId).toBe(near.id);
    expect(p.targetId).not.toBe(far.id);

    // And it wraps backward within the cluster rather than falling off it.
    dispatch(server, session, 'tabPrev');
    expect(p.targetId).toBe(far.id);
  });
});
