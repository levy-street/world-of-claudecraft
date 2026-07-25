import { describe, expect, it } from 'vitest';
import { DUNGEONS } from '../src/sim/data';
import { enterDungeon, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  isSourceCavePos,
  SOURCE_CAVE_DOOR_ID,
  SOURCE_CAVE_DUNGEON_ID,
  SOURCE_CAVE_WELL_BANTER_LINES,
} from '../src/sim/source_cave';
import type { Entity } from '../src/sim/types';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

function makeSim(
  opts: { seed?: number; lockoutNowMs?: () => number; raidResetMs?: (n: number) => number } = {},
): AnySim {
  return new Sim({
    seed: opts.seed ?? 1234,
    playerClass: 'warrior',
    noPlayer: true,
    lockoutNowMs: opts.lockoutNowMs,
    raidResetMs: opts.raidResetMs,
  }) as AnySim;
}

function teleport(sim: AnySim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedCave(sim: AnySim) {
  return sim.instances.find(
    (i: { dungeonId: string; partyKey: string | null }) =>
      i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
}

describe('source cave: level gate', () => {
  it('denies entry below level 20 with a matched deny message', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(19, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    const p = sim.entities.get(pid) as Entity;
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    const events = sim.drainEvents() as { type: string; text?: string }[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You must reach level 20 to enter The Source Cave.',
      ),
    ).toBe(true);
    expect(claimedCave(sim)).toBeUndefined();
  });

  it('allows entry at exactly level 20', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    expect(claimedCave(sim)).toBeDefined();
  });
});

describe('the cave keeps its own level gate after v0.29 dropped the generic one', () => {
  // upstream release/v0.29.0 removed DungeonDef.minLevel gating from enterDungeon
  // entirely (any level may walk into a static dungeon). The Source Cave's access
  // rule is CAVE-owned (cave.def.minLevel in source_cave/dungeon.ts, a Phase 3
  // product decision), so it must survive that removal independently.
  it('denies an under-level player through the generic enterDungeon entry point', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Bob');
    sim.setPlayerLevel(4, pid);
    expect(enterDungeon(sim.ctx, SOURCE_CAVE_DUNGEON_ID, pid)).toBe(false);
    const events = sim.drainEvents() as { type: string; text?: string }[];
    expect(
      events.some(
        (e) => e.type === 'error' && /You must reach level \d+ to enter/.test(e.text ?? ''),
      ),
    ).toBe(true);
  });
});

describe('source cave: daily lockout', () => {
  it('entry is allowed before any lockout has been granted', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    expect(claimedCave(sim)).toBeDefined();
    const events = sim.drainEvents() as { type: string }[];
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('denies entry while locked, with a matched deny message', () => {
    const now = 1_000_000;
    const sim = makeSim({
      lockoutNowMs: () => now,
      raidResetMs: () => now + 24 * 3600 * 1000,
    });
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const meta = sim.resolve(pid).meta;
    meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, now + 5 * 3600 * 1000);

    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    expect(claimedCave(sim)).toBeUndefined();
    const events = sim.drainEvents() as { type: string; text?: string }[];
    expect(
      events.some((e) => e.type === 'error' && e.text === 'You are locked out of The Source Cave.'),
    ).toBe(true);
  });

  it('lockout expiry (driven by the injected clock) restores entry', () => {
    let now = 1_000_000;
    const sim = makeSim({
      lockoutNowMs: () => now,
      raidResetMs: () => now + 24 * 3600 * 1000,
    });
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const meta = sim.resolve(pid).meta;
    meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, now + 5 * 3600 * 1000);

    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    expect(claimedCave(sim)).toBeUndefined();
    sim.drainEvents();

    now += 5 * 3600 * 1000 + 1;
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    expect(claimedCave(sim)).toBeDefined();
    expect(meta.raidLockouts.has(SOURCE_CAVE_DUNGEON_ID)).toBe(false);
  });

  it('allows entry at the exact expiry instant (pins <= over <)', () => {
    let now = 1_000_000;
    const sim = makeSim({
      lockoutNowMs: () => now,
      raidResetMs: () => now + 24 * 3600 * 1000,
    });
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const meta = sim.resolve(pid).meta;
    const until = now + 5 * 3600 * 1000;
    meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, until);

    now = until;
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    expect(claimedCave(sim)).toBeDefined();
    expect(meta.raidLockouts.has(SOURCE_CAVE_DUNGEON_ID)).toBe(false);
  });
});

describe('source cave: enter/leave round trip through the door', () => {
  it('a level-20 player can interact through the well and back out', () => {
    // The well requires interacting through its banter gate (well_banter.ts),
    // not a walk-in teleport; see tests/source_cave_well_banter.test.ts for the
    // gate itself. This test only pins the round trip still works end to end.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(pid) as Entity;
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z);

    for (let i = 0; i <= SOURCE_CAVE_WELL_BANTER_LINES.length; i++) sim.interact(pid);
    const inst = claimedCave(sim);
    expect(inst).toBeDefined();

    const exit = sim.entities.get(inst.exitId) as Entity;
    teleport(sim, p, exit.pos.x, exit.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
  });
});
