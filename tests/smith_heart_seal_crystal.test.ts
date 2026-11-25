// The heart seal crystal (src/sim/encounters/smith_heart/seal_crystal.ts, the
// object and the trigger; seal.ts, the charge, the burst and the kept portal
// bit; seal_burst.ts, the forced burst), driven through a real Sim claim. The
// ONE crystal at the Ring's dais centre replaces the old auto-opening seal:
// - a fresh claim holds one crystal, appended last to the dungeon's objects,
//   dark, pinned to the layout's footprint and to its combat wall;
// - READY (the markers' charge bit, 128) derives from all four veins lit AND
//   the Ring clear, and only then; the crystal is never lootable (there is no
//   press, the owner's call of 2026-11-18) and never re-armed by the generic
//   object sweep;
// - the PORTAL bit (16) stays 0 with the seal charged while nobody comes down
//   to the dais, however long it waits: the first tick a living player stands
//   in the middle circle (the dais, SEAL_CRYSTAL_TRIGGER_R) bursts it, or
//   `/dev heart portal` forces it; it lands at once on every marker and is KEPT
//   for the claim's life; a fresh claim is shut again;
// - the trigger: the circle's edge (inclusive), the dead, a released spirit, a
//   player of another claim, a raider already standing there when the charge
//   lands, and the pickup command each answer as they should;
// - while it stands the crystal is a solid wall (a round combat wall, offline
//   and in the online mirror), removed the very tick it bursts so the portal
//   at the centre is reachable; no body is ever held inside the circle;
// - the whole thing draws no rng and gives the same markers tick by tick.

import { afterEach, describe, expect, it } from 'vitest';
import { syncClientCombatWalls } from '../src/net/combat_wall_wire';
import { resolvePosition } from '../src/sim/colliders';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
  SMITH_HEART_SEAL_CRYSTAL_OBJECT,
  SMITH_HEART_SEAL_CRYSTAL_TEMPLATE,
} from '../src/sim/content/smith_heart';
import { SMITH_HEART_CHECKPOINTS } from '../src/sim/content/smith_heart_checkpoints';
import {
  EAST_STAIR,
  GRAND_STAIR,
  HEART_ARRIVAL,
  NORTH_STAIR,
  RING,
  RING_PORTAL,
  RING_PORTAL_LANDING,
  SEAL_CRYSTAL,
  SEAL_DAIS,
  SMITH_HEART_ANCHORS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
  WEST_STAIR,
} from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  burstSmithHeartSeal,
  isSealCrystalTemplate,
  SEAL_CRYSTAL_TRIGGER_R,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_PORTAL_HOP_TEXT,
  SMITH_HEART_PORTAL_OPEN_LOG,
  SMITH_HEART_READY_BIT,
  SMITH_HEART_SEAL_FULL,
  SMITH_HEART_VEIN_BITS,
  sealCrystalBurst,
  sealCrystalOf,
  sealCrystalTriggered,
  smithHeartPortalBitSet,
  smithHeartProgress,
  smithHeartReadyBitSet,
  smithHeartSealMaskOf,
  smithHeartSealTemplate,
  tickSmithHeartSeal,
} from '../src/sim/encounters/smith_heart';
import { BRIDGE_OBJECT } from '../src/sim/encounters/smith_heart/breath_bridge_ids';
import { writeSealMarkers } from '../src/sim/encounters/smith_heart/seal';
import {
  COMBAT_WALL_SHAPES,
  clearCombatWallStateForTest,
  combatWallsAt,
  isCombatWallTemplate,
} from '../src/sim/instances/combat_wall_state';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon, freeInstance } from '../src/sim/instances/dungeons';
import { entityLineOfSightClear } from '../src/sim/line_of_sight_elevation';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { Rng } from '../src/sim/rng';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

/** A spot on the dais, in the middle circle: outside the wall (the rim and a
 *  body's width), well inside the trigger's circle. */
const DAIS_Z = -(SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS + 1.5);
/** A spot on the Ring itself, far from the dais (its north, inside the claim). */
const RING_Z = RING.R;

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
const SPAWNS = DUNGEON.spawns;
const FULL_READY = SMITH_HEART_SEAL_FULL | SMITH_HEART_READY_BIT;
const BURST = FULL_READY | SMITH_HEART_PORTAL_BIT;
const RING_PACKS = SMITH_HEART_PACKS.ring as string[];
/** The Ring's own packs (four since the team's doc of 2026-11-17), put back
 *  after a test that rewrote the list. */
const RING_KEPT = [...RING_PACKS];

function makeSim(seed = 17): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WORLD, devCommands: true });
}

function claimsOf(sim: Sim): InstanceSlot[] {
  return sim.ctx.instances.filter(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  );
}

/** A claim with one raider at its entry, far from the dais. */
function setup(seed = 17): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = makeSim(seed);
  const pid = sim.addPlayer('warrior', 'Heartwalker');
  expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
  const [inst] = claimsOf(sim);
  // The Ring cleared: this file asks about the veins and the crystal (the
  // Ring's half of the rule is its own test below).
  killRing(sim, inst);
  sim.tick();
  return { sim, pid, inst };
}

function originOf(inst: InstanceSlot): { x: number; z: number } {
  return instanceOrigin(DUNGEON.index, inst.slot);
}

/** The vein's fight, by template: the Hammer's is the whole council. */
function veinKills(vein: SmithHeartVein): string[] {
  return vein === 'hammer' ? [...SMITH_HEART_COUNCIL] : [SMITH_HEART_GUARDIANS[vein]];
}

/** Kill every claim mob of the listed packs or templates (instant, no loot). */
function kill(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  SPAWNS.forEach((s, i) => {
    if (!ids.includes(s.packId ?? '') && !ids.includes(s.mobId)) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = 0;
    mob.dead = true;
    mob.aiState = 'dead';
    mob.inCombat = false;
  });
}

/** Kill the Ring's packs (this file's setup clears the Ring). */
function killRing(sim: Sim, inst: InstanceSlot): void {
  kill(sim, inst, RING_KEPT);
}

/** Stand Ring packs back up (their own test). */
function reviveRing(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  revive(sim, inst, ids);
}

/** Stand the listed bodies back up (a fight that begins again). */
function revive(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  SPAWNS.forEach((s, i) => {
    if (!ids.includes(s.packId ?? '') && !ids.includes(s.mobId)) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = mob.maxHp;
    mob.dead = false;
    mob.aiState = 'idle';
  });
}

function winVeins(sim: Sim, inst: InstanceSlot, veins: readonly SmithHeartVein[]): void {
  for (const v of veins) kill(sim, inst, veinKills(v));
  sim.tick();
}

/** Every seal marker's value (the crystal shares the prefix but parses to null). */
function markers(sim: Sim, inst: InstanceSlot): number[] {
  const out: number[] = [];
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) out.push(m);
  }
  return out;
}

/** Every marker of the claim carries exactly `value` (and there are several). */
function allAt(sim: Sim, inst: InstanceSlot, value: number): boolean {
  const all = markers(sim, inst);
  return all.length > 1 && all.every((m) => m === value);
}

function crystal(sim: Sim, inst: InstanceSlot): Entity {
  const c = sealCrystalOf(sim.ctx, inst);
  if (!c) throw new Error('no crystal');
  return c;
}

/** The crystal's wall in the slot's collision view, or undefined: the view
 *  carries colliders (no template), so it is told by its circle. */
function crystalWall(inst: InstanceSlot) {
  const o = originOf(inst);
  return combatWallsAt(o.x, o.z).find(
    (w) =>
      w.type === 'circle' &&
      Math.abs(w.x - SEAL_CRYSTAL.x) < 1e-6 &&
      Math.abs(w.z - SEAL_CRYSTAL.z) < 1e-6 &&
      Math.abs(w.r - SEAL_CRYSTAL.r) < 1e-9,
  );
}

function put(sim: Sim, pid: number, inst: InstanceSlot, x: number, z: number): void {
  const o = originOf(inst);
  displacePlayerForDev(sim.ctx, sim.ctx.entities.get(pid) as Entity, o.x + x, o.z + z);
}

function local(sim: Sim, pid: number, inst: InstanceSlot): { x: number; z: number } {
  const o = originOf(inst);
  const e = sim.ctx.entities.get(pid) as Entity;
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

function logs(events: SimEvent[], pid: number): string[] {
  return events.flatMap((e) => (e.type === 'log' && e.pid === pid ? [e.text] : []));
}

function opened(events: SimEvent[], pid: number): number {
  return logs(events, pid).filter((t) => t === SMITH_HEART_PORTAL_OPEN_LOG).length;
}

afterEach(() => {
  RING_PACKS.splice(0, RING_PACKS.length, ...RING_KEPT);
  clearDungeonGateStateForTest();
  clearCombatWallStateForTest();
});

describe('the crystal object', () => {
  it('is one claim object at the dais centre, appended LAST, never mistaken for a marker', () => {
    expect(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE).toBe('smith_heart_seal_crystal');
    expect(SEAL_CRYSTAL).toEqual({ x: 0, z: 0, r: 8.5 });
    const objects = DUNGEON.objects ?? [];
    expect(objects[objects.length - 1]).toBe(SMITH_HEART_SEAL_CRYSTAL_OBJECT);
    expect(SMITH_HEART_SEAL_CRYSTAL_OBJECT).toMatchObject({
      name: 'The Heart Seal Crystal',
      x: SEAL_CRYSTAL.x,
      z: SEAL_CRYSTAL.z,
      templateId: SMITH_HEART_SEAL_CRYSTAL_TEMPLATE,
      dungeonId: SMITH_HEART_DUNGEON,
      lootable: false,
    });
    expect(objects.filter((o) => o.templateId === SMITH_HEART_SEAL_CRYSTAL_TEMPLATE)).toHaveLength(
      1,
    );
    // It shares the markers' prefix but carries no value.
    expect(smithHeartSealMaskOf(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE)).toBeNull();
    expect(isSealCrystalTemplate(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE)).toBe(true);
    expect(isSealCrystalTemplate(smithHeartSealTemplate(0))).toBe(false);
  });

  it('its wall row is the footprint, round, drawn by the seal (never the ice slab)', () => {
    const row = COMBAT_WALL_SHAPES[SMITH_HEART_SEAL_CRYSTAL_TEMPLATE];
    expect(isCombatWallTemplate(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE)).toBe(true);
    expect(row.round).toBe(true);
    expect(row.ownLook).toBe(true);
    expect(row.hw).toBe(SEAL_CRYSTAL.r);
    expect(row.hd).toBe(SEAL_CRYSTAL.r);
    // As tall as the crystal stands (18.85 yd, render/smith_heart/ring_crystal_core.ts), so a
    // cast across the dais is stopped by it, not slipped over it.
    expect(row.height).toBeGreaterThanOrEqual(18.85);
  });

  it('the trigger is the middle circle: the dais the four stairs land on, round the wall', () => {
    expect(SEAL_CRYSTAL_TRIGGER_R).toBe(19);
    expect(SEAL_CRYSTAL_TRIGGER_R).toBe(SEAL_DAIS.r);
    // Every stair's foot is the dais's rim, so walking down any of them lands in it.
    for (const foot of [-GRAND_STAIR.foot, NORTH_STAIR.foot, EAST_STAIR.foot, WEST_STAIR.foot]) {
      expect(foot).toBe(SEAL_CRYSTAL_TRIGGER_R);
    }
    // A body pressed against the wall stands well inside it, and so does the dais spot here.
    expect(SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS).toBeLessThan(SEAL_CRYSTAL_TRIGGER_R - 5);
    expect(-DAIS_Z).toBeLessThan(SEAL_CRYSTAL_TRIGGER_R);
    // The Ring itself is nowhere near it.
    expect(RING.innerR).toBeGreaterThan(SEAL_CRYSTAL_TRIGGER_R * 3);
  });

  it('the charge is its own bit, past every other', () => {
    expect(SMITH_HEART_READY_BIT).toBe(128);
    expect(SMITH_HEART_PORTAL_BIT).toBe(16);
    expect(smithHeartReadyBitSet(SMITH_HEART_READY_BIT)).toBe(true);
    expect(smithHeartReadyBitSet(SMITH_HEART_SEAL_FULL | 16 | 32 | 64)).toBe(false);
    expect(smithHeartPortalBitSet(SMITH_HEART_READY_BIT)).toBe(false);
    expect(smithHeartSealMaskOf(smithHeartSealTemplate(255))).toBe(255);
    expect(smithHeartSealMaskOf('smith_heart_seal_256')).toBeNull();
  });

  it('a fresh claim holds one dark, inert crystal and its wall, and the markers are inert', () => {
    const { sim, inst } = setup();
    const c = crystal(sim, inst);
    const o = originOf(inst);
    // The last of the dungeon's objects the claim spawned; behind it only the
    // Wind Bridge's object, which the Breath's tick raises from the first tick
    // (breath_bridge.ts, 2026-11-25).
    const objects = DUNGEON.objects ?? [];
    expect(inst.objectIds[objects.length - 1]).toBe(c.id);
    expect(
      inst.objectIds
        .slice(objects.length)
        .map((id) => sim.ctx.entities.get(id)?.templateId)
        .sort(),
    ).toEqual([BRIDGE_OBJECT]);
    expect(c.templateId).toBe(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE);
    expect(c.name).toBe('The Heart Seal Crystal');
    expect(c.pos.x - o.x).toBeCloseTo(SEAL_CRYSTAL.x, 6);
    expect(c.pos.z - o.z).toBeCloseTo(SEAL_CRYSTAL.z, 6);
    expect(c.lootable).toBe(false);
    expect(c.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    expect(sealCrystalBurst(sim.ctx, inst)).toBe(false);
    // The wall stands from the first tick: a round row at the dais centre.
    expect(crystalWall(inst)).toMatchObject({
      type: 'circle',
      x: SEAL_CRYSTAL.x,
      z: SEAL_CRYSTAL.z,
      r: SEAL_CRYSTAL.r,
    });
    // The markers (one stands at this very spot) are inert anchors.
    const marks = inst.objectIds
      .map((id) => sim.ctx.entities.get(id) as Entity)
      .filter((e) => smithHeartSealMaskOf(e.templateId) !== null);
    expect(marks.length).toBeGreaterThan(1);
    for (const m of marks) {
      expect(m.lootable).toBe(false);
      expect(m.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    }
    // However long it waits, the generic object sweep never re-arms any of them.
    for (let i = 0; i < 200; i++) sim.tick();
    expect(c.lootable).toBe(false);
    expect(marks.every((m) => !m.lootable)).toBe(true);
  });
});

describe('READY derives from four veins and a clear Ring, and only then', () => {
  it('stays dark until the fourth vein, whichever one is last', () => {
    for (const last of SMITH_HEART_VEINS) {
      const { sim, inst } = setup();
      const others = SMITH_HEART_VEINS.filter((v) => v !== last);
      winVeins(sim, inst, others);
      expect(smithHeartProgress(sim.ctx, inst).ready, `without ${last}`).toBe(false);
      expect(markers(sim, inst).every((m) => !smithHeartReadyBitSet(m))).toBe(true);
      winVeins(sim, inst, [last]);
      expect(smithHeartProgress(sim.ctx, inst).ready, `with ${last}`).toBe(true);
      expect(allAt(sim, inst, FULL_READY)).toBe(true);
      // Charged, never lootable: there is nothing to press.
      expect(crystal(sim, inst).lootable).toBe(false);
      clearCombatWallStateForTest();
    }
  });

  it('a Ring with a pack still alive keeps the crystal dark, a clear one charges it', () => {
    // The Ring's four packs (the team's doc of 2026-11-17): one stands again.
    expect(RING_PACKS.length).toBe(4);
    const { sim, inst } = setup();
    reviveRing(sim, inst, ['r1']);
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const p = smithHeartProgress(sim.ctx, inst);
    expect(p.sealLit).toBe(true);
    expect(p.ringClear).toBe(false);
    expect(p.ready).toBe(false);
    expect(allAt(sim, inst, SMITH_HEART_SEAL_FULL)).toBe(true);
    kill(sim, inst, ['r1']);
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).ringClear).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).ready).toBe(true);
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    expect(crystal(sim, inst).lootable).toBe(false);
  });

  it('is derived like a vein: a fight that begins again darkens the crystal, a kill relights it', () => {
    const { sim, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    expect(smithHeartProgress(sim.ctx, inst).ready).toBe(true);
    revive(sim, inst, veinKills('heat'));
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).ready).toBe(false);
    expect(allAt(sim, inst, SMITH_HEART_SEAL_FULL & ~SMITH_HEART_VEIN_BITS.heat)).toBe(true);
    kill(sim, inst, veinKills('heat'));
    sim.tick();
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).not.toBeNull();
  });
});

describe('the portal bit is kept, and only a burst sets it', () => {
  it('stays shut with the seal charged while nobody comes down to the dais, however long it waits', () => {
    const { sim, pid, inst } = setup();
    // On the Ring, looking down on the dais: charged, and nobody in the circle.
    put(sim, pid, inst, 0, RING_Z);
    winVeins(sim, inst, SMITH_HEART_VEINS);
    let said = 0;
    for (let i = 0; i < 100; i++) said += opened(sim.tick(), pid);
    expect(smithHeartProgress(sim.ctx, inst).ready).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    expect(said).toBe(0);
    expect(sealCrystalOf(sim.ctx, inst)).not.toBeNull();
    expect(crystalWall(inst)).toBeDefined();
    // At the foot of the Grand Stair, a step short of the dais's rim: still shut.
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL_TRIGGER_R + 0.5));
    for (let i = 0; i < 5; i++) said += opened(sim.tick(), pid);
    expect(said).toBe(0);
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
  });

  it('a living player stepping into the middle circle bursts it that tick: every marker, one line, the crystal and its wall gone', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const o = originOf(inst);
    const wallsBefore = combatWallsAt(o.x, o.z).length;
    const c = crystal(sim, inst);
    expect(crystalWall(inst)).toBeDefined();
    put(sim, pid, inst, 0, DAIS_Z);
    // Nothing happens until the seal's tick sees them there.
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    const events = sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
    expect(sealCrystalBurst(sim.ctx, inst)).toBe(true);
    expect(sim.ctx.entities.has(c.id)).toBe(false);
    expect(inst.objectIds).not.toContain(c.id);
    // The wall went the same tick.
    expect(crystalWall(inst)).toBeUndefined();
    expect(combatWallsAt(o.x, o.z)).toHaveLength(wallsBefore - 1);
    // One line, once, to the raid.
    expect(opened(events, pid)).toBe(1);
    for (let i = 0; i < 20; i++) expect(opened(sim.tick(), pid)).toBe(0);
  });

  it('is kept for the claim: later ticks, a walk back out, a fight that begins again, a kill again', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    put(sim, pid, inst, 0, DAIS_Z);
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    put(sim, pid, inst, 0, RING_Z);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    // The veins and the charge are derived and follow the roster; the kept bit does not.
    revive(sim, inst, veinKills('quench'));
    sim.tick();
    expect(
      allAt(
        sim,
        inst,
        (SMITH_HEART_SEAL_FULL & ~SMITH_HEART_VEIN_BITS.quench) | SMITH_HEART_PORTAL_BIT,
      ),
    ).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    kill(sim, inst, veinKills('quench'));
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    // The crystal never stands again.
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
  });

  it("the seal's own tick retires the crystal of a claim whose markers carry the bit", () => {
    const { sim, inst } = setup();
    const c = crystal(sim, inst);
    // The kept bit is the one fact the tick follows, whoever wrote it.
    writeSealMarkers(sim.ctx, inst, SMITH_HEART_PORTAL_BIT);
    expect(sealCrystalOf(sim.ctx, inst)).toBe(c);
    sim.tick();
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
    expect(sim.ctx.entities.has(c.id)).toBe(false);
    expect(crystalWall(inst)).toBeUndefined();
    expect(allAt(sim, inst, SMITH_HEART_PORTAL_BIT)).toBe(true);
  });

  it('a fresh claim is shut again', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    put(sim, pid, inst, 0, DAIS_Z);
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    freeInstance(sim.ctx, inst);
    sim.tick();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    const [again] = claimsOf(sim);
    sim.tick();
    expect(allAt(sim, again, 0)).toBe(true);
    expect(smithHeartProgress(sim.ctx, again).portalOpen).toBe(false);
    const c = crystal(sim, again);
    expect(c.lootable).toBe(false);
    expect(crystalWall(again)).toBeDefined();
  });

  it('`/dev heart portal` is a forced burst: the bit, the wall and the crystal, at once, once', () => {
    const { sim, pid, inst } = setup();
    const o = originOf(inst);
    expect(smithHeartProgress(sim.ctx, inst).ready).toBe(false);
    const walls = combatWallsAt(o.x, o.z).length;
    expect(crystalWall(inst)).toBeDefined();
    expect(handleSmithHeartDevChat(sim.ctx, '/dev heart portal', pid)).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    expect(allAt(sim, inst, SMITH_HEART_PORTAL_BIT)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
    expect(crystalWall(inst)).toBeUndefined();
    expect(combatWallsAt(o.x, o.z)).toHaveLength(walls - 1);
    // The line went out once; a second verb has nothing left to burst.
    expect(opened(sim.tick(), pid)).toBe(1);
    expect(handleSmithHeartDevChat(sim.ctx, '/dev heart portal', pid)).toBe(true);
    expect(opened(sim.tick(), pid)).toBe(0);
    expect(burstSmithHeartSeal(sim.ctx, inst)).toBe(false);
    // The kept bit survives every later tick.
    for (let i = 0; i < 20; i++) sim.tick();
    expect(markers(sim, inst).every((m) => smithHeartPortalBitSet(m))).toBe(true);
  });
});

describe('the trigger', () => {
  it('a dark crystal never bursts, however long a raider stands in the circle', () => {
    const { sim, pid, inst } = setup();
    put(sim, pid, inst, 0, DAIS_Z);
    let said = 0;
    for (let i = 0; i < 40; i++) said += opened(sim.tick(), pid);
    // Three of the four veins is still dark.
    winVeins(sim, inst, ['hammer', 'breath', 'quench']);
    for (let i = 0; i < 40; i++) said += opened(sim.tick(), pid);
    expect(said).toBe(0);
    expect(local(sim, pid, inst).z).toBeCloseTo(DAIS_Z, 3);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    expect(sealCrystalOf(sim.ctx, inst)).not.toBeNull();
    expect(crystalWall(inst)).toBeDefined();
  });

  it('the circle is inclusive at its rim and not a hair past it', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const c = crystal(sim, inst);
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL_TRIGGER_R + 0.001));
    expect(sealCrystalTriggered(sim.ctx, c)).toBe(false);
    put(sim, pid, inst, 0, -SEAL_CRYSTAL_TRIGGER_R);
    expect(sealCrystalTriggered(sim.ctx, c)).toBe(true);
    // Round, not square: a diagonal step past the rim is outside it.
    const d = (SEAL_CRYSTAL_TRIGGER_R + 0.05) / Math.SQRT2;
    put(sim, pid, inst, d, -d);
    expect(sealCrystalTriggered(sim.ctx, c)).toBe(false);
    // Through the tick: a step short holds, the rim bursts.
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL_TRIGGER_R + 0.5));
    sim.tick();
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL_TRIGGER_R - 0.5));
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
  });

  it('needs a living player: a corpse and a released spirit in the circle burst nothing', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const c = crystal(sim, inst);
    const body = sim.ctx.entities.get(pid) as Entity;
    put(sim, pid, inst, 0, DAIS_Z);
    body.dead = true;
    body.hp = 0;
    expect(sealCrystalTriggered(sim.ctx, c)).toBe(false);
    sim.tick();
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    // The released spirit, set back in the circle.
    sim.releaseSpirit(pid);
    expect(body.ghost).toBe(true);
    put(sim, pid, inst, 0, DAIS_Z);
    expect(sealCrystalTriggered(sim.ctx, c)).toBe(false);
    sim.tick();
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBe(c);
    // The same body living again, on the same spot: it bursts (the gate is life, nothing else).
    body.dead = false;
    body.ghost = false;
    body.hp = body.maxHp;
    put(sim, pid, inst, 0, DAIS_Z);
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
  });

  it("each claim's circle is its own: a stranger at their dais bursts nothing of ours, and ours leaves theirs shut", () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    put(sim, pid, inst, 0, RING_Z);
    // A stranger's own claim, one slot over, with its own crystal.
    const stranger = sim.addPlayer('mage', 'Stranger');
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, stranger)).toBe(true);
    const theirs = claimsOf(sim).find((i) => i !== inst) as InstanceSlot;
    expect(theirs).toBeDefined();
    expect(theirs.slot).not.toBe(inst.slot);
    sim.tick();
    const mine = crystal(sim, inst);
    const strangers = crystal(sim, theirs);
    expect(mine.id).not.toBe(strangers.id);
    // Standing in THEIR circle they set off nothing of OURS (charged as ours is) ...
    put(sim, stranger, theirs, 0, DAIS_Z);
    expect(sealCrystalTriggered(sim.ctx, mine)).toBe(false);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    // ... and their own is dark, whatever our raid has done.
    expect(allAt(sim, theirs, 0)).toBe(true);
    // Our burst leaves theirs shut and tells only us.
    put(sim, pid, inst, 0, DAIS_Z);
    const events = sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    expect(opened(events, pid)).toBe(1);
    expect(opened(events, stranger)).toBe(0);
    expect(allAt(sim, theirs, 0)).toBe(true);
    expect(sealCrystalOf(sim.ctx, theirs)).toBe(strangers);
  });

  it('a raider already standing in the circle when the last vein lights bursts it on that tick', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, ['hammer', 'breath', 'quench']);
    put(sim, pid, inst, 0, DAIS_Z);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    kill(sim, inst, veinKills('heat'));
    const events = sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
    expect(opened(events, pid)).toBe(1);
  });

  it('a burst crystal is gone for good: walking out and back in sets off nothing more', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    put(sim, pid, inst, 0, DAIS_Z);
    expect(opened(sim.tick(), pid)).toBe(1);
    let said = 0;
    for (let round = 0; round < 3; round++) {
      put(sim, pid, inst, 0, RING_Z);
      for (let i = 0; i < 5; i++) said += opened(sim.tick(), pid);
      put(sim, pid, inst, 0, DAIS_Z);
      for (let i = 0; i < 5; i++) said += opened(sim.tick(), pid);
    }
    expect(said).toBe(0);
    expect(allAt(sim, inst, BURST)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBeNull();
  });

  it('the burst is the tick, never a press: the pickup command and the interact key do nothing to it', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const c = crystal(sim, inst);
    // In the circle, charged, before the seal's tick has seen them.
    put(sim, pid, inst, 0, DAIS_Z);
    expect(sim.pickUpObject(c.id, pid)).toBe(false);
    sim.interact(pid);
    expect(allAt(sim, inst, FULL_READY)).toBe(true);
    expect(sealCrystalOf(sim.ctx, inst)).toBe(c);
    // The tick is what bursts it.
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
  });

  it('draws no rng, in the trigger or in the tick', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    let draws = 0;
    const rng = sim.ctx.rng as Rng;
    rng.setObserver(() => {
      draws++;
    });
    try {
      expect(tickSmithHeartSeal(sim.ctx, inst)).toBe(FULL_READY);
      put(sim, pid, inst, 0, DAIS_Z);
      expect(tickSmithHeartSeal(sim.ctx, inst)).toBe(BURST);
      expect(tickSmithHeartSeal(sim.ctx, inst)).toBe(BURST);
    } finally {
      rng.setObserver(null);
    }
    expect(draws).toBe(0);
  });
});

describe('the wall', () => {
  it('stops a body at the circle, and a body already inside is pushed out, never held', () => {
    const { sim, pid, inst } = setup();
    const o = originOf(inst);
    const e = sim.ctx.entities.get(pid) as Entity;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    const dist = () => Math.hypot(e.pos.x - o.x, e.pos.z - o.z);
    // Walking straight at it from the south halts at the rim plus the body.
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL.r + 4));
    e.facing = 0;
    e.prevFacing = 0;
    meta.moveInput.forward = true;
    for (let i = 0; i < 80; i++) sim.tick();
    expect(dist()).toBeCloseTo(SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS, 2);
    // Standing at the exact centre when it is up (the worst case: the wall
    // appears round a body): the first step out carries it clear of the footprint.
    meta.moveInput.forward = false;
    put(sim, pid, inst, SEAL_CRYSTAL.x, SEAL_CRYSTAL.z);
    sim.tick();
    meta.moveInput.forward = true;
    e.facing = Math.PI / 2;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(dist()).toBeGreaterThanOrEqual(SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS - 1e-6);
    // And from just off the centre, walking any way at all.
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      meta.moveInput.forward = false;
      put(sim, pid, inst, 1, 1);
      sim.tick();
      meta.moveInput.forward = true;
      e.facing = facing;
      for (let i = 0; i < 40; i++) sim.tick();
      expect(dist(), `facing ${facing}`).toBeGreaterThanOrEqual(
        SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS - 1e-6,
      );
    }
    meta.moveInput.forward = false;
  });

  it('the collision view pushes a point out of the footprint, before the burst only', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const o = originOf(inst);
    const seed = sim.cfg.seed;
    const inside = resolvePosition(seed, o.x + 1, o.z + 0.5, PLAYER_BODY_RADIUS);
    expect(Math.hypot(inside.x - o.x, inside.z - o.z)).toBeGreaterThanOrEqual(
      SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS - 1e-6,
    );
    put(sim, pid, inst, 0, DAIS_Z);
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    const clear = resolvePosition(seed, o.x + 1, o.z + 0.5, PLAYER_BODY_RADIUS);
    expect(clear.x).toBeCloseTo(o.x + 1, 9);
    expect(clear.z).toBeCloseTo(o.z + 0.5, 9);
  });

  it('blocks sight across it while it stands, and not after it bursts', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const a = sim.ctx.entities.get(pid) as Entity;
    // A second body across the crystal (only its place matters to the sight test).
    const across = (): Entity =>
      ({ ...a, pos: { ...a.pos, z: a.pos.z + 2 * (SEAL_CRYSTAL.r + 3) } }) as Entity;
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL.r + 3));
    expect(entityLineOfSightClear(sim.cfg.seed, a, across())).toBe(false);
    // Standing in the circle, the next tick bursts it.
    sim.tick();
    expect(allAt(sim, inst, BURST)).toBe(true);
    expect(entityLineOfSightClear(sim.cfg.seed, a, across())).toBe(true);
  });

  it('walking down the Grand Stair bursts it at the rim, before the wall, and walks on into the portal', () => {
    const { sim, pid, inst } = setup();
    winVeins(sim, inst, SMITH_HEART_VEINS);
    const o = originOf(inst);
    const e = sim.ctx.entities.get(pid) as Entity;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    // At the Grand Stair's foot, outside the circle, walking north onto the dais.
    put(sim, pid, inst, 0, -(SEAL_CRYSTAL_TRIGGER_R + 4));
    e.facing = 0;
    e.prevFacing = 0;
    meta.moveInput.forward = true;
    let burstAt = Number.NaN;
    let hopped = false;
    let said: string[] = [];
    for (let i = 0; i < 200 && !hopped; i++) {
      said = said.concat(logs(sim.tick(), pid));
      if (Number.isNaN(burstAt) && smithHeartProgress(sim.ctx, inst).portalOpen) {
        burstAt = Math.hypot(e.pos.x - o.x, e.pos.z - o.z);
      }
      const at = local(sim, pid, inst);
      hopped = Math.hypot(at.x - HEART_ARRIVAL.x, at.z - HEART_ARRIVAL.z) < 1;
    }
    meta.moveInput.forward = false;
    // It burst as the walker crossed the rim, never needing them to reach the wall.
    expect(burstAt).toBeLessThanOrEqual(SEAL_CRYSTAL_TRIGGER_R);
    expect(burstAt).toBeGreaterThan(SEAL_CRYSTAL_TRIGGER_R - 1);
    expect(said.filter((t) => t === SMITH_HEART_PORTAL_OPEN_LOG)).toHaveLength(1);
    // The wall was gone by then, so the same walk carried them into the portal.
    expect(hopped).toBe(true);
    expect(said).toContain(SMITH_HEART_PORTAL_HOP_TEXT);
  });

  it('is mirrored by the online client from the entity alone, and leaves with it', () => {
    const { sim, pid, inst } = setup();
    const o = originOf(inst);
    const server = crystalWall(inst);
    expect(server).toBeDefined();
    const c = crystal(sim, inst);
    clearCombatWallStateForTest();
    expect(crystalWall(inst)).toBeUndefined();
    // The client's mirror: the entity fields the wire carries, and its own player.
    const me = sim.ctx.entities.get(pid) as Entity;
    const mirrored = new Map<number, Entity>([[c.id, { ...c }]]);
    syncClientCombatWalls({ entities: mirrored, player: me });
    expect(crystalWall(inst)).toEqual(server);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(1);
    // The burst drops the entity: the next publish clears the wall.
    mirrored.delete(c.id);
    syncClientCombatWalls({ entities: mirrored, player: me });
    expect(crystalWall(inst)).toBeUndefined();
  });

  it('is gone with its claim (a freed claim drops its walls from the collision view)', () => {
    const { sim, inst } = setup();
    expect(crystalWall(inst)).toBeDefined();
    freeInstance(sim.ctx, inst);
    sim.tick();
    expect(combatWallsAt(originOf(inst).x, originOf(inst).z)).toHaveLength(0);
  });

  it('no point a body can be set down at stands inside it: the checkpoints, the landings, the dev anchors', () => {
    const clear = SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS;
    const points = [
      ...Object.values(SMITH_HEART_CHECKPOINTS).map((c) => c.pos),
      RING_PORTAL_LANDING,
      SMITH_HEART_ANCHORS.entry,
      SMITH_HEART_ANCHORS.portal,
      SMITH_HEART_ANCHORS.ring,
      SMITH_HEART_ANCHORS.balcony,
    ];
    for (const p of points) {
      expect(Math.hypot(p.x - SEAL_CRYSTAL.x, p.z - SEAL_CRYSTAL.z)).toBeGreaterThan(clear);
    }
    // The portal's whole trigger stands under the crystal: nobody reaches it before the burst.
    expect(RING_PORTAL.r + PLAYER_BODY_RADIUS).toBeLessThan(SEAL_CRYSTAL.r);
  });
});

describe('determinism and text', () => {
  /** One scripted claim: the value of every marker and the crystal's flags, tick by tick. */
  function script(seed: number): unknown[] {
    const { sim, pid, inst } = setup(seed);
    const trace: unknown[] = [];
    const note = (t: number) => {
      const c = sealCrystalOf(sim.ctx, inst);
      trace.push([t, markers(sim, inst), c ? [c.id, c.lootable] : null, inst.objectIds.length]);
    };
    for (let t = 0; t < 60; t++) {
      if (t === 5) kill(sim, inst, veinKills('hammer'));
      if (t === 10) kill(sim, inst, veinKills('breath'));
      if (t === 15) kill(sim, inst, veinKills('quench'));
      if (t === 20) kill(sim, inst, veinKills('heat'));
      if (t === 30) put(sim, pid, inst, 0, DAIS_Z);
      if (t === 40) revive(sim, inst, veinKills('breath'));
      sim.tick();
      note(t);
    }
    return trace;
  }

  it('two identical claims give identical markers and crystal flags, tick by tick', () => {
    const a = script(17);
    clearCombatWallStateForTest();
    const b = script(17);
    expect(b).toEqual(a);
    // And the script really walked the whole story.
    const values = a.map((row) => (row as [number, number[]])[1][0]);
    expect(values).toContain(0);
    expect(values).toContain(FULL_READY);
    expect(values).toContain(BURST);
    expect(values[29]).toBe(FULL_READY);
    expect(values[30]).toBe(BURST);
  });

  it('the burst line is English the client re-localizes (an exact row)', () => {
    expect(SMITH_HEART_PORTAL_OPEN_LOG).toBe(
      'The heart seal crystal shatters, and a way down into the heart of the mountain whirls open in its place.',
    );
    expect(localizeSimText(SMITH_HEART_PORTAL_OPEN_LOG)).not.toBeNull();
    // The house rule: no en or em dash in player text.
    for (const code of [0x2013, 0x2014]) {
      expect(SMITH_HEART_PORTAL_OPEN_LOG.includes(String.fromCharCode(code))).toBe(false);
    }
  });
});
