// Orkadia orc war-camp dungeon (src/sim/content/orkadia.ts): a hand-authored
// classic DungeonDef placed in the Drakelands whose `orkadia` interior is the
// first open-field dungeon interior (outdoor ground with shared relief, the
// war-camp prop set, perimeter walls; see src/sim/orkadia_field.ts). Pins the
// content wiring (def fields, entrance zone, the eight orc mobs, the boss kit),
// the entry lifecycle (spawns the roster incl. the warlord), the live collider
// routing, the shared ground relief, and the Book of Deeds pair, so a future
// edit that drops any of them reds here.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { DEEDS } from '../src/sim/content/deeds';
import { ORKADIA_DUNGEON_DEFS, ORKADIA_MOBS } from '../src/sim/content/orkadia';
import {
  ARENA_X,
  BUILTIN_WORLD,
  DELVE_BAND_X_MIN,
  DUNGEONS,
  dungeonAt,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  MOBS,
  zoneAt,
} from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  ORKADIA_FIELD_BOUNDS,
  ORKADIA_FIELD_COLLIDER_SPECS,
  orkadiaFieldHeight,
} from '../src/sim/orkadia_field';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ORKADIA_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 77): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: ORKADIA_TEST_WORLD });
}

describe('Orkadia dungeon content', () => {
  it('registers the dungeon with the orc-themed interior and a Drakelands entrance', () => {
    const def = DUNGEONS.orkadia;
    expect(def).toBeDefined();
    expect(def.name).toBe('Orkadia');
    expect(def.interior).toBe('orkadia');
    expect(def.index).toBe(6);
    expect(def.suggestedPlayers).toBe(5);
    // The entrance door sits inside the Drakelands rectangle.
    expect(zoneAt(def.doorPos.x, def.doorPos.z).id).toBe('drakelands');
    // index is unique across the whole live dungeon table.
    const indices = Object.values(DUNGEONS).map((d) => d.index);
    expect(indices.filter((i) => i === def.index)).toHaveLength(1);
  });

  it('defines the complete eight-orc roster and reaches the global MOBS table', () => {
    expect(Object.keys(ORKADIA_MOBS).sort()).toEqual([
      'orkadia_axethrower',
      'orkadia_banner_captain',
      'orkadia_beast_handler',
      'orkadia_fel_shaman',
      'orkadia_grunt',
      'orkadia_marauder',
      'orkadia_siege_brute',
      'orkadia_warlord',
    ]);
    for (const id of Object.keys(ORKADIA_MOBS)) {
      expect(MOBS[id], `${id} reaches MOBS`).toBeDefined();
      expect(MOBS[id].family).toBe('humanoid');
    }
  });

  it('gives every specialist a distinct combat job and promotes two minibosses', () => {
    expect(MOBS.orkadia_axethrower.petSpell?.school).toBe('physical');
    expect(MOBS.orkadia_fel_shaman.petSpell?.school).toBe('shadow');
    expect(MOBS.orkadia_fel_shaman.mendAlly?.name).toBe('Bloodfire Mending');
    expect(MOBS.orkadia_beast_handler.bleed?.name).toBe('Hooked Chain');
    expect(MOBS.orkadia_beast_handler.warcry?.name).toBe('Hunting Cadence');
    expect(MOBS.orkadia_siege_brute.stomp?.name).toBe('Siegebreaker Stomp');
    expect(MOBS.orkadia_siege_brute.cleave?.name).toBe('Basalt Sweep');
    expect(MOBS.orkadia_banner_captain.rally?.name).toBe('Black Banner Rally');
    expect(MOBS.orkadia_banner_captain.wardAllies?.name).toBe('Ironwall Order');
    expect(MOBS.orkadia_siege_brute).toMatchObject({ elite: true, rare: true });
    expect(MOBS.orkadia_banner_captain).toMatchObject({ elite: true, rare: true });
  });

  it('makes the warlord a boss with a Warstomp nova and an enrage', () => {
    const boss = MOBS.orkadia_warlord;
    expect(boss.boss).toBe(true);
    expect(boss.ccImmune).toBe(true);
    expect(boss.aoePulse?.name).toBe('Warstomp');
    expect(boss.enrage?.belowHpPct).toBe(0.3);
    // trash grunts and marauders are NOT bosses.
    expect(MOBS.orkadia_grunt.boss).toBeUndefined();
    expect(MOBS.orkadia_marauder.boss).toBeUndefined();
  });

  it('spawns only orc mobs, and the warlord exactly once, sitting last on the dais', () => {
    const spawns = ORKADIA_DUNGEON_DEFS.orkadia.spawns;
    for (const s of spawns) expect(s.mobId.startsWith('orkadia_')).toBe(true);
    const bosses = spawns.filter((s) => s.mobId === 'orkadia_warlord');
    expect(bosses).toHaveLength(1);
    // the boss is the deepest spawn (largest z) in the run.
    const maxZ = Math.max(...spawns.map((s) => s.z));
    expect(bosses[0].z).toBe(maxZ);
  });

  it('keeps every combat spawn clear of the authored prop footprints', () => {
    for (const spawn of ORKADIA_DUNGEON_DEFS.orkadia.spawns) {
      const clearance = Math.min(
        ...ORKADIA_FIELD_COLLIDER_SPECS.map(
          (spec) => Math.hypot(spawn.x - spec.x, spawn.z - spec.z) - spec.r,
        ),
      );
      expect(clearance, `${spawn.mobId} at ${spawn.x},${spawn.z}`).toBeGreaterThan(4);
    }
  });

  it('spawns the full roster (including the warlord) when a party claims the instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, 'orkadia', pid)).toBe(true);
    const inst = (
      sim.instances as { dungeonId: string; partyKey: unknown; mobIds: number[] }[]
    ).find((i) => i.dungeonId === 'orkadia' && i.partyKey !== null);
    expect(inst, 'orkadia instance claimed').toBeDefined();
    const templates = inst!.mobIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e)
      .map((e) => e.templateId);
    expect(templates).toContain('orkadia_warlord');
    for (const id of Object.keys(ORKADIA_MOBS)) expect(templates).toContain(id);
    // every spawned mob is an orc.
    for (const t of templates) expect(t.startsWith('orkadia_')).toBe(true);
  });

  it('classifies its instance origin as a dungeon, not the arena band (pitch-black-room regression)', () => {
    // Root cause of the "Orkadia renders completely black, no lights" bug: index 6
    // puts the instance origin at ARENA_X + 300, past the arena anchor (ARENA_X)
    // but still west of the delve band. The old wide arena band (ARENA_X_MIN up to
    // the delve band) swallowed it, so dungeonAt() returned null: the renderer took
    // the arena branch and never built the interior (no geometry, no torch lights),
    // and the collider resolver routed the player against ARENA_COLLIDERS instead of
    // the Orkadia (Sanctum) set. The origin must classify as the Orkadia dungeon.
    const origin = instanceOrigin(DUNGEONS.orkadia.index, 0);
    expect(origin.x).toBeGreaterThan(ARENA_X); // sits past the arena anchor...
    expect(origin.x).toBeLessThan(DELVE_BAND_X_MIN); // ...but west of the delve band
    expect(dungeonAt(origin.x)?.id).toBe('orkadia');
    expect(dungeonAt(origin.x)?.interior).toBe('orkadia');
    expect(isArenaPos(origin.x)).toBe(false);
    expect(isDelvePos(origin.x)).toBe(false);
  });

  it('resolves collision against its own interior colliders, not the arena', () => {
    // A point buried in one of the field's prop footprints must be pushed back
    // out. Under the classification bug this position routed to ARENA_COLLIDERS
    // ~300u away and moved not at all (the player clipped straight through
    // Orkadia's walls into a black void). The probe derives from the live
    // collider table so the pin survives layout retunes.
    const origin = instanceOrigin(DUNGEONS.orkadia.index, 0);
    const spec = ORKADIA_FIELD_COLLIDER_SPECS.find((s) => s.kind === 'orkadia_watchtower')!;
    const wallPoint = { x: origin.x + spec.x + 0.4, z: origin.z + spec.z };
    const resolved = resolvePosition(1, wallPoint.x, wallPoint.z, 1);
    const moved = Math.hypot(resolved.x - wallPoint.x, resolved.z - wallPoint.z);
    expect(moved).toBeGreaterThan(0.5); // collision fired: the Orkadia colliders are live
  });

  it('shares the open-field relief between groundHeight and the placement domain', () => {
    // groundHeight inside the instance IS orkadiaFieldHeight on instance-local
    // coords: the arrival shelf is level, the boss terrace rises at the back,
    // and every spawn point sits inside the walkable field bounds.
    const origin = instanceOrigin(DUNGEONS.orkadia.index, 0);
    const at = (lx: number, lz: number) => groundHeight(origin.x + lx, origin.z + lz, 1);
    expect(at(0, -2)).toBeCloseTo(0, 5);
    for (const [lx, lz] of [
      [12, 80],
      [-30, 160],
      [0, 216],
      [40, 230],
    ] as const) {
      expect(at(lx, lz)).toBeCloseTo(orkadiaFieldHeight(lx, lz), 10);
    }
    expect(at(0, 216)).toBeGreaterThan(at(0, 110) + 2);
    for (const s of ORKADIA_DUNGEON_DEFS.orkadia.spawns) {
      expect(s.x).toBeGreaterThanOrEqual(ORKADIA_FIELD_BOUNDS.minX);
      expect(s.x).toBeLessThanOrEqual(ORKADIA_FIELD_BOUNDS.maxX);
      expect(s.z).toBeGreaterThanOrEqual(ORKADIA_FIELD_BOUNDS.minZ);
      expect(s.z).toBeLessThanOrEqual(ORKADIA_FIELD_BOUNDS.maxZ);
    }
  });

  it('authors the Book of Deeds clear pair targeting the dungeon', () => {
    expect(DEEDS.dgn_orkadia.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'orkadia',
      count: 1,
    });
    expect(DEEDS.dgn_orkadia_heroic.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'orkadia',
      difficulty: 'heroic',
      count: 1,
    });
    expect(DEEDS.dgn_orkadia.category).toBe('dungeon');
  });
});
