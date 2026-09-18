// IWorld.entityRosterVersion: the cheap "did the roster change" read that lets
// a per-frame consumer skip its whole-roster walk. Both worlds bump it on every
// entity add or drop and on nothing else, so a consumer keyed on it re-walks
// exactly when membership changed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pruneMissingEntities } from '../src/net/despawn_grace';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { addEntityToRoster, dropEntityFromRoster } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const wire = (id: number, x: number, k = 'mob', tid = 'ridge_stalker') => ({
  id,
  k,
  tid,
  nm: 'Runner',
  lv: 1,
  x,
  y: 0,
  z: 0,
  f: 0,
  hp: 100,
  mhp: 100,
});

function selfWire(id: number) {
  return {
    ...wire(id, 0, 'player', 'warrior'),
    res: 0,
    mres: 100,
    rtype: 'mana',
    xp: 0,
    copper: 0,
    inv: [],
    equip: {},
    qlog: [],
    qdone: [],
    cds: {},
    gcd: 0,
    stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
  };
}

describe('Sim.entityRosterVersion', () => {
  it('bumps on an add and on a drop, and on nothing else', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior' });
    const before = sim.entityRosterVersion;
    const mob = createMob(990001, MOBS.ridge_stalker, 3, { x: 5, y: 0, z: 5 });
    addEntityToRoster(sim.ctx, mob);
    expect(sim.entityRosterVersion).toBe(before + 1);
    // A move, a rebucket and a stat change are not roster changes.
    mob.pos.x += 3;
    sim.rebucket(mob);
    mob.hp -= 1;
    expect(sim.entityRosterVersion).toBe(before + 1);
    dropEntityFromRoster(sim.ctx, mob.id);
    expect(sim.entityRosterVersion).toBe(before + 2);
    // Dropping an id that is not on the roster changes nothing.
    dropEntityFromRoster(sim.ctx, mob.id);
    expect(sim.entityRosterVersion).toBe(before + 2);
  });

  it('is exposed on the SimContext view and stays in step with the Sim field', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior' });
    expect(sim.ctx.entityRosterVersion).toBe(sim.entityRosterVersion);
    addEntityToRoster(sim.ctx, createMob(990002, MOBS.ridge_stalker, 3, { x: 5, y: 0, z: 5 }));
    expect(sim.ctx.entityRosterVersion).toBe(sim.entityRosterVersion);
  });
});

describe('ClientWorld.entityRosterVersion', () => {
  it('bumps when a snapshot introduces an entity and when the grace drops one', () => {
    const c = bareClient(7);
    // biome-ignore lint/suspicious/noExplicitAny: driving the private snapshot intake (tests/CLAUDE.md idiom)
    const apply = (snap: unknown) => (c as any).applySnapshot(snap);
    apply({ t: 'snap', tick: 1, time: 0, self: selfWire(7), ents: [wire(21, 200)] });
    const afterJoin = c.entityRosterVersion;
    expect(c.entities.has(21)).toBe(true);
    expect(afterJoin).toBeGreaterThan(0);
    // The same two entities again: a move is not a roster change.
    apply({ t: 'snap', tick: 2, time: 0.05, self: selfWire(7), ents: [wire(21, 205)] });
    expect(c.entityRosterVersion).toBe(afterJoin);
    // A far entity missing from one snapshot is held under grace (no drop yet).
    apply({ t: 'snap', tick: 3, time: 0.1, self: selfWire(7), ents: [] });
    expect(c.entities.has(21)).toBe(true);
    expect(c.entityRosterVersion).toBe(afterJoin);
    // Once its grace runs out the drop bumps the version.
    // biome-ignore lint/suspicious/noExplicitAny: the grace clock is a private map
    (c as any).missingSince.set(21, -100_000);
    apply({ t: 'snap', tick: 4, time: 0.15, self: selfWire(7), ents: [] });
    expect(c.entities.has(21)).toBe(false);
    expect(c.entityRosterVersion).toBe(afterJoin + 1);
  });
});

describe('pruneMissingEntities', () => {
  const entity = (id: number, x: number): Entity =>
    createMob(id, MOBS.ridge_stalker, 3, { x, y: 0, z: 0 });

  it('drops a near miss at once, holds a far miss under grace, and counts the drops', () => {
    const entities = new Map<number, Entity>();
    const self = createMob(1, MOBS.ridge_stalker, 3, { x: 0, y: 0, z: 0 });
    entities.set(1, self);
    entities.set(2, entity(2, 10)); // near: drops without grace
    entities.set(3, entity(3, 500)); // far: held
    entities.set(4, entity(4, 500)); // far but seen: kept, timer cleared
    const missingSince = new Map<number, number>([[4, 10]]);
    const input = {
      entities,
      seen: new Set([4]),
      missingSince,
      playerId: 1,
      ownPlayerId: 1,
      spectating: null,
      now: 1000,
      graceMs: 600,
      immediateDropDistSq: 70 * 70,
    };
    expect(pruneMissingEntities(input)).toBe(1);
    expect([...entities.keys()]).toEqual([1, 3, 4]);
    expect(missingSince.get(3)).toBe(1000);
    expect(missingSince.has(4)).toBe(false);
    expect(pruneMissingEntities({ ...input, now: 1599 })).toBe(0);
    expect(pruneMissingEntities({ ...input, now: 1600 })).toBe(1);
    expect([...entities.keys()]).toEqual([1, 4]);
  });

  it('keeps the moderator own record while a spectate presents someone else', () => {
    const entities = new Map<number, Entity>();
    entities.set(1, entity(1, 0));
    entities.set(9, entity(9, 0));
    const missingSince = new Map<number, number>([[9, 0]]);
    expect(
      pruneMissingEntities({
        entities,
        seen: new Set(),
        missingSince,
        playerId: 1,
        ownPlayerId: 9,
        spectating: 'someone',
        now: 5000,
        graceMs: 600,
        immediateDropDistSq: 70 * 70,
      }),
    ).toBe(0);
    expect(entities.has(9)).toBe(true);
    expect(missingSince.has(9)).toBe(false);
  });
});

describe('the roster is written only where the version is bumped', () => {
  // Three per-frame consumers (view candidates, the meters party set, the
  // rift ambience) key on entityRosterVersion, so a direct entities.set or
  // entities.delete anywhere else would go stale in all three at once.
  const ALLOWED = new Set([
    'entity_roster.ts', // src/sim: addEntityToRoster / dropEntityFromRoster
    'despawn_grace.ts', // src/net: the online drop, counted by the caller
    'online.ts', // src/net: the online create, bumped on the next line
  ]);
  const WRITE = /\bentities\.(set|delete|clear)\(/;

  it.each(['src/sim', 'src/net'])(
    '%s writes the entity map only through the roster ops',
    (root) => {
      const offenders: string[] = [];
      const dir = fileURLToPath(new URL(`../${root}`, import.meta.url));
      for (const { file, full } of tsFilesUnder(dir)) {
        if (ALLOWED.has(file)) continue;
        const source = readFileSync(full, 'utf8');
        if (WRITE.test(source)) offenders.push(`${root}/${file}`);
      }
      expect(offenders).toEqual([]);
    },
  );

  it('scans through the shared walker only', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
