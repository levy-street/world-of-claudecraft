// The Wildheart Basin trash (src/sim/content/wildheart.ts) on the trash kit's
// Basin mechanics (src/sim/mob/trash_kit/wildheart_kit.ts: the Sunbone Totem's
// pulse and the Spore Toad's death cloud) and the shared kit keys (Ancestral
// Sap as an interruptible mend, Plant Totem, Pounce, the Entangling Lash lane
// with its root, the Ravager's enrage), plus the Great Saurian's showpiece kit
// (src/sim/encounters/wildheart_basin/great_saurian.ts): Tail Swipe, the
// Earthshaking Stomp, the Howdah Rider and the Enrage. Driven through
// tickTrashKits / tickWildheartEncounters inside a real claimed Basin.

import { describe, expect, it } from 'vitest';
import { WILDHEART_BASIN_SPAWNS } from '../src/sim/content/wildheart';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  GREAT_SAURIAN_ID,
  HOWDAH_HEXCALLER_ID,
  SAURIAN_ENRAGE,
  SAURIAN_HOWDAH_BREAK,
  SAURIAN_HOWDAH_LOG,
  SAURIAN_KNOCKDOWN,
  SAURIAN_RIDER_LANDS,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  SAURIAN_TUNING as T,
  tickWildheartEncounters,
  WILDHEART_SPORE_CLOUD,
} from '../src/sim/encounters/wildheart_basin';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_ENTANGLED,
  WILDHEART_ENTANGLING_LASH,
  WILDHEART_PLANT_TOTEM,
  WILDHEART_POUNCE,
  WILDHEART_SPORE_BURST,
  WILDHEART_TOTEM_PULSE,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

const DUNGEON = 'wildheart_basin';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  events: SimEvent[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal'): Room {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev wildheart enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no wildheart claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  // The middle of the Central Island, a wide flat bench (the mob AI never runs
  // here, so nothing else pulls).
  me.pos = sim.ctx.groundPos(o.x, o.z + 16);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function engage(r: Room, templateId: string, dx = 6, dz = 0): Entity {
  const mob = createMob(r.sim.ctx.nextId++, MOBS[templateId], MOBS[templateId].minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, DUNGEON, r.inst.difficulty);
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  return pull(r, mob);
}

function pull(r: Room, mob: Entity): Entity {
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
}

function run(r: Room, seconds: number, mobs: Entity[], encounters = false): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    if (encounters) tickWildheartEncounters(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `W${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

/** Damage an ability dealt to one target in the recorded events. */
function dealt(r: Room, targetId: number, ability: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === ability,
    )
    .map((e) => e.amount);
}

function objectsOf(r: Room, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e !== undefined && e.templateId === templateId);
}

/** The claim's own Great Saurian, brought to the bench beside the player. */
function saurian(r: Room, dx = 0, dz = 8): Entity {
  const s = r.inst.mobIds
    .map((id) => r.sim.ctx.entities.get(id))
    .find((e): e is Entity => e?.templateId === GREAT_SAURIAN_ID);
  if (!s) throw new Error('no saurian');
  s.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  s.prevPos = { ...s.pos };
  return pull(r, s);
}

describe('Wildheart trash: the cast table and the roster (design section 4.1)', () => {
  it('kicks Ancestral Sap, never the totem plant or the lash', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[WILDHEART_ANCESTRAL_SAP]?.school).toBe('nature');
    for (const id of [WILDHEART_PLANT_TOTEM, WILDHEART_ENTANGLING_LASH, SAURIAN_STOMP])
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[id], id).toBeUndefined();
  });

  it('gives every Basin trash type its one readable job', () => {
    expect(MOBS.wildheart_stalker.petSpell?.name).toBe('Razorvine Spear');
    expect(MOBS.wildheart_ravager.cleave?.name).toBe('Tusk Sweep');
    expect(MOBS.wildheart_ravager.bleed?.name).toBe('Bloodmane Rend');
    expect(MOBS.wildheart_ravager.enrage?.belowHpPct).toBe(0.3);
    const sap = MOBS.wildheart_hexcaller.trashKit?.mend;
    expect([sap?.castId, sap?.castTime]).toEqual([WILDHEART_ANCESTRAL_SAP, 2]);
    expect(MOBS.wildheart_hexcaller.mendAlly).toBeUndefined();
    const plant = MOBS.sunbone_totem_binder.trashKit?.call;
    expect([plant?.castId, plant?.summon, plant?.every]).toEqual([
      WILDHEART_PLANT_TOTEM,
      'sunbone_totem',
      15,
    ]);
    const pulse = MOBS.sunbone_totem.trashKit?.pulse;
    expect([pulse?.every, pulse?.healPct]).toEqual([2, 0.03]);
    expect(MOBS.sunbone_totem.moveSpeed).toBe(0);
    expect(MOBS.basin_raptor.elite).toBeUndefined();
    expect(MOBS.basin_raptor.trashKit?.leap?.castId).toBe(WILDHEART_POUNCE);
    const cloud = MOBS.spore_toad.trashKit?.deathCloud;
    expect([cloud?.castId, cloud?.radius, cloud?.seconds]).toEqual([WILDHEART_SPORE_BURST, 4, 6]);
    const lash = MOBS.vine_lasher.trashKit?.line;
    expect([lash?.castId, lash?.castTime, lash?.length, lash?.root]).toEqual([
      WILDHEART_ENTANGLING_LASH,
      1.5,
      20,
      2,
    ]);
    expect(MOBS.great_saurian.ccImmune).toBe(true);
    expect(MOBS.great_saurian.trashKit).toBeUndefined();
  });

  it('every trash creature stands somewhere in the route; the totem and rider only as adds', () => {
    const placed = new Set(WILDHEART_BASIN_SPAWNS.map((s) => s.mobId));
    for (const id of [
      'wildheart_stalker',
      'wildheart_ravager',
      'wildheart_hexcaller',
      'sunbone_totem_binder',
      'basin_raptor',
      'spore_toad',
      'vine_lasher',
      GREAT_SAURIAN_ID,
    ])
      expect(placed.has(id), id).toBe(true);
    expect(placed.has('sunbone_totem')).toBe(false);
    expect(placed.has(HOWDAH_HEXCALLER_ID)).toBe(false);
  });

  it('draws every creature clearly bigger than a player, the Saurian as big as a house', () => {
    for (const id of [
      'wildheart_stalker',
      'wildheart_ravager',
      'wildheart_hexcaller',
      'sunbone_totem_binder',
      'basin_raptor',
      'spore_toad',
      'vine_lasher',
      HOWDAH_HEXCALLER_ID,
    ])
      expect(MOBS[id].scale, id).toBeGreaterThanOrEqual(1.6);
    expect(MOBS.great_saurian.scale).toBeGreaterThanOrEqual(3);
    expect(MOBS.great_saurian.bodyRadius).toBeGreaterThanOrEqual(4);
  });
});

describe('the Sunbone Hexcaller: Ancestral Sap', () => {
  it('heals a hurt packmate after a 2 s bar', () => {
    const r = room();
    const hex = engage(r, 'wildheart_hexcaller', 6, 0);
    const ravager = engage(r, 'wildheart_ravager', 4, 4);
    ravager.hp = Math.floor(ravager.maxHp * 0.4);
    const def = MOBS.wildheart_hexcaller.trashKit?.mend;
    if (!def) throw new Error('sap');
    run(r, def.first + 0.05, [hex, ravager]);
    expect(hex.castingAbility).toBe(WILDHEART_ANCESTRAL_SAP);
    expect(hex.castTargetId).toBe(ravager.id);
    const before = ravager.hp;
    run(r, def.castTime + 0.1, [hex, ravager]);
    expect(ravager.hp).toBeGreaterThanOrEqual(before + Math.round(ravager.maxHp * 0.12) - 1);
  });

  it('an interrupt wastes it', () => {
    const r = room();
    const hex = engage(r, 'wildheart_hexcaller', 6, 0);
    const ravager = engage(r, 'wildheart_ravager', 4, 4);
    ravager.hp = Math.floor(ravager.maxHp * 0.4);
    const def = MOBS.wildheart_hexcaller.trashKit?.mend;
    if (!def) throw new Error('sap');
    run(r, def.first + 0.05, [hex, ravager]);
    expect(hex.castingAbility).toBe(WILDHEART_ANCESTRAL_SAP);
    r.sim.ctx.cancelCast(hex);
    const before = ravager.hp;
    run(r, def.castTime + 0.2, [hex, ravager]);
    expect(ravager.hp).toBe(before);
  });
});

describe('the Sunbone Totem-Binder and its totems', () => {
  it('plants a totem beside it that mends every ally near it 3 percent each 2 s', () => {
    const r = room();
    const binder = engage(r, 'sunbone_totem_binder', 6, 0);
    const ravager = engage(r, 'wildheart_ravager', 6, 5);
    const far = engage(r, 'wildheart_ravager', 6, 30);
    ravager.hp = Math.floor(ravager.maxHp * 0.5);
    far.hp = Math.floor(far.maxHp * 0.5);
    const def = MOBS.sunbone_totem_binder.trashKit?.call;
    if (!def) throw new Error('plant');
    run(r, def.first + def.castTime + 0.1, [binder, ravager, far]);
    const totems = () =>
      binder.summonedIds
        .map((id) => r.sim.ctx.entities.get(id))
        .filter((e): e is Entity => e?.templateId === 'sunbone_totem' && !e.dead);
    expect(totems()).toHaveLength(1);
    const totem = totems()[0];
    expect(Math.hypot(totem.pos.x - binder.pos.x, totem.pos.z - binder.pos.z)).toBeLessThan(3);
    const before = ravager.hp;
    const farBefore = far.hp;
    run(r, 2.05, [binder, ravager, far, totem]);
    const beat = Math.round(ravager.maxHp * 0.03);
    expect(ravager.hp - before).toBeGreaterThanOrEqual(beat - 1);
    expect(far.hp).toBe(farBefore);
    expect(
      r.events.some(
        (e) =>
          e.type === 'spellfx' && e.sourceId === totem.id && e.ability === WILDHEART_TOTEM_PULSE,
      ),
    ).toBe(true);
    // Two totems at most.
    run(r, def.every * 3, [binder, ravager, far, ...totems()]);
    expect(totems().length).toBe(2);
  });

  it('a totem crumbles once its binder is dead, so it never strands a fight', () => {
    const r = room();
    const binder = engage(r, 'sunbone_totem_binder', 6, 0);
    const def = MOBS.sunbone_totem_binder.trashKit?.call;
    if (!def) throw new Error('plant');
    run(r, def.first + def.castTime + 0.1, [binder]);
    const totem = r.sim.ctx.entities.get(binder.summonedIds[0]) as Entity;
    expect(totem.dead).toBe(false);
    r.sim.ctx.handleDeath(binder, r.me);
    run(r, 0.2, [totem]);
    expect(totem.dead).toBe(true);
  });

  it('a killed totem stops mending', () => {
    const r = room();
    const binder = engage(r, 'sunbone_totem_binder', 6, 0);
    const ravager = engage(r, 'wildheart_ravager', 6, 5);
    const def = MOBS.sunbone_totem_binder.trashKit?.call;
    if (!def) throw new Error('plant');
    run(r, def.first + def.castTime + 0.1, [binder, ravager]);
    const totem = r.sim.ctx.entities.get(binder.summonedIds[0]) as Entity;
    r.sim.ctx.handleDeath(totem, r.me);
    ravager.hp = Math.floor(ravager.maxHp * 0.5);
    const before = ravager.hp;
    run(r, 4.1, [binder, ravager]);
    expect(ravager.hp).toBe(before);
  });
});

describe('the Basin Raptor: Pounce', () => {
  it('leaps onto the farthest caster within 25 yd and holds on', () => {
    const r = room();
    const raptor = engage(r, 'basin_raptor', 3, 0);
    const mage = addPlayer(r, 'mage', 3, 18);
    const def = MOBS.basin_raptor.trashKit?.leap;
    if (!def) throw new Error('pounce');
    run(r, def.first + def.seconds + 0.2, [raptor]);
    expect(Math.hypot(raptor.pos.x - mage.pos.x, raptor.pos.z - mage.pos.z)).toBeLessThan(3);
    expect(raptor.forcedTargetId).toBe(mage.id);
    expect(
      r.events.some(
        (e) =>
          e.type === 'spellfx' &&
          e.sourceId === raptor.id &&
          e.fx === 'windup' &&
          e.ability === WILDHEART_POUNCE,
      ),
    ).toBe(true);
  });
});

describe('the Spore Toad: Spore Burst', () => {
  it('bursts into a 4 yd cloud where it falls that poisons whoever stands in it for 6 s', () => {
    const r = room();
    const toad = engage(r, 'spore_toad', 3, 0);
    const near = addPlayer(r, 'warrior', 3, 2);
    const far = addPlayer(r, 'mage', 3, 7);
    run(r, 0.1, [toad]);
    r.sim.ctx.handleDeath(toad, r.me);
    run(r, DT, [toad]);
    const cloud = objectsOf(r, WILDHEART_SPORE_CLOUD);
    expect(cloud).toHaveLength(1);
    expect(cloud[0].scale).toBe(4);
    run(r, 6, [toad]);
    const hits = dealt(r, near.id, 'Spore Burst');
    expect(hits).toHaveLength(6);
    for (const h of hits) {
      expect(h).toBeGreaterThanOrEqual(40);
      expect(h).toBeLessThanOrEqual(50);
    }
    expect(dealt(r, far.id, 'Spore Burst')).toHaveLength(0);
    // The cloud fades and never ticks again.
    expect(objectsOf(r, WILDHEART_SPORE_CLOUD)).toHaveLength(0);
    run(r, 3, [toad]);
    expect(dealt(r, near.id, 'Spore Burst')).toHaveLength(6);
  });
});

describe('death clouds and bursts', () => {
  it('a template carries a death cloud or a death burst, never both (one record)', () => {
    for (const [id, t] of Object.entries(MOBS)) {
      if (t.trashKit?.deathCloud) expect(t.trashKit.deathBurst, id).toBeUndefined();
    }
  });

  it('a cloud whose toad left the world before it faded is swept off the floor', () => {
    const r = room();
    const toad = engage(r, 'spore_toad', 3, 0);
    run(r, 0.1, [toad]);
    r.sim.ctx.handleDeath(toad, r.me);
    run(r, DT, [toad]);
    expect(objectsOf(r, WILDHEART_SPORE_CLOUD)).toHaveLength(1);
    r.sim.ctx.dropEntity(toad.id);
    run(r, DT, [], true);
    expect(objectsOf(r, WILDHEART_SPORE_CLOUD)).toHaveLength(0);
  });
});

describe('the Vine Lasher: Entangling Lash', () => {
  it('locks a lane at the bar start and roots whoever stands in it when it lands', () => {
    const r = room();
    const lasher = engage(r, 'vine_lasher', 0, -8);
    const inLane = addPlayer(r, 'mage', 0, 6);
    const aside = addPlayer(r, 'priest', 6, 6);
    const def = MOBS.vine_lasher.trashKit?.line;
    if (!def) throw new Error('lash');
    run(r, def.first + 0.05, [lasher]);
    expect(lasher.castingAbility).toBe(WILDHEART_ENTANGLING_LASH);
    run(r, def.castTime + 0.05, [lasher]);
    // The lane points at one of the two players lined up with it (hashed); the
    // one beside the lane is never caught.
    const caught = [r.me, inLane].filter((p) => dealt(r, p.id, 'Entangling Lash').length > 0);
    expect(caught.length).toBeGreaterThanOrEqual(1);
    for (const p of caught) {
      const root = p.auras.find((a) => a.id === WILDHEART_ENTANGLED);
      expect(root?.kind).toBe('root');
      expect(root?.remaining).toBeGreaterThan(1.8);
    }
    expect(dealt(r, aside.id, 'Entangling Lash')).toHaveLength(0);
    expect(aside.auras.some((a) => a.id === WILDHEART_ENTANGLED)).toBe(false);
  });
});

describe('the Great Saurian (section 4.3)', () => {
  it('Tail Swipe: a 1 s bar, then the rear 120 degree cone takes 180 to 220 and a throw', () => {
    const r = room();
    const s = saurian(r, 0, 8);
    // It faces the player (south of it); one player stands behind it, one beside.
    s.facing = Math.atan2(r.me.pos.x - s.pos.x, r.me.pos.z - s.pos.z);
    const behind = addPlayer(r, 'mage', 0, 16);
    const beside = addPlayer(r, 'priest', 9, 8);
    const start = { ...behind.pos };
    run(r, T.tailFirst + 0.05, [s], true);
    expect(s.castingAbility).toBe(SAURIAN_TAIL_SWIPE);
    run(r, T.tailCast + 0.05, [s], true);
    const hits = dealt(r, behind.id, 'Tail Swipe');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(T.tailMin);
    expect(hits[0]).toBeLessThanOrEqual(T.tailMax);
    expect(Math.hypot(behind.pos.x - start.x, behind.pos.z - start.z)).toBeGreaterThan(3);
    expect(dealt(r, beside.id, 'Tail Swipe')).toHaveLength(0);
    expect(dealt(r, r.me.id, 'Tail Swipe')).toHaveLength(0);
  });

  it('Earthshaking Stomp: a 2 s bar, then 12 yd round it, 160 to 200 and a 1 s knockdown', () => {
    const r = room();
    const s = saurian(r, 0, 8);
    // Beside it (out of the tail's rear cone) and far beside it.
    const near = addPlayer(r, 'mage', 7, 8);
    const far = addPlayer(r, 'priest', 22, 8);
    run(r, T.stompFirst + 0.05, [s], true);
    expect(s.castingAbility).toBe(SAURIAN_STOMP);
    expect(s.castTotal).toBe(T.stompCast);
    // It braces for the bar: the mob AI cannot walk it off the ring.
    const planted = { ...s.pos };
    s.pos.x += 3;
    run(r, DT, [s], true);
    expect(s.pos.x).toBe(planted.x);
    run(r, T.stompCast, [s], true);
    for (const p of [r.me, near]) {
      const hits = dealt(r, p.id, 'Earthshaking Stomp');
      expect(hits).toHaveLength(1);
      expect(hits[0]).toBeGreaterThanOrEqual(T.stompMin);
      expect(hits[0]).toBeLessThanOrEqual(T.stompMax);
      const down = p.auras.find((a) => a.id === SAURIAN_KNOCKDOWN);
      expect(down?.kind).toBe('stun');
    }
    expect(dealt(r, far.id, 'Earthshaking Stomp')).toHaveLength(0);
  });

  it('Howdah Rider: at half health the howdah breaks once and the rider saps the Saurian', () => {
    const r = room();
    const s = saurian(r, 0, 8);
    run(r, 0.1, [s], true);
    s.hp = Math.floor(s.maxHp * 0.49);
    run(r, DT, [s], true);
    const riders = () =>
      r.inst.mobIds
        .map((id) => r.sim.ctx.entities.get(id))
        .filter((e): e is Entity => e?.templateId === HOWDAH_HEXCALLER_ID);
    expect(r.events.some((e) => e.type === 'log' && e.text === SAURIAN_HOWDAH_LOG)).toBe(true);
    expect(
      r.events.some(
        (e) => e.type === 'spellfx' && e.sourceId === s.id && e.ability === SAURIAN_HOWDAH_BREAK,
      ),
    ).toBe(true);
    // The rider is mid-leap off the broken howdah: it lands on the model's
    // HowdahBreak beat, behind the Saurian's right flank, never at the break.
    expect(riders()).toHaveLength(0);
    run(r, T.riderLandDelay - 0.2, [s], true);
    expect(riders()).toHaveLength(0);
    run(r, 0.25, [s], true);
    expect(riders()).toHaveLength(1);
    const rider = riders()[0];
    expect(
      r.events.some(
        (e) => e.type === 'spellfx' && e.sourceId === rider.id && e.ability === SAURIAN_RIDER_LANDS,
      ),
    ).toBe(true);
    // Right of its facing and behind it, at the tuned offsets.
    const dx = rider.pos.x - s.pos.x;
    const dz = rider.pos.z - s.pos.z;
    const fwd = dx * Math.sin(s.facing) + dz * Math.cos(s.facing);
    const right = -dx * Math.cos(s.facing) + dz * Math.sin(s.facing);
    expect(fwd).toBeCloseTo(-T.riderLandBack, 1);
    expect(right).toBeCloseTo(T.riderLandRight, 1);
    expect(rider.aggroTargetId).toBe(r.me.id);
    // The rider's Ancestral Sap is channelled on the Saurian.
    const def = MOBS.howdah_hexcaller.trashKit?.mend;
    if (!def) throw new Error('rider sap');
    run(r, def.first + 0.05, [s, rider], true);
    expect(rider.castingAbility).toBe(WILDHEART_ANCESTRAL_SAP);
    expect(rider.castTargetId).toBe(s.id);
    const before = s.hp;
    run(r, def.castTime + 0.05, [s, rider], true);
    expect(s.hp).toBeGreaterThan(before);
    // It breaks once per pull, even back under half after the heal.
    s.hp = Math.floor(s.maxHp * 0.3);
    run(r, 1, [s, rider], true);
    expect(riders()).toHaveLength(1);
  });

  it('Enrage under a fifth: 30 percent more damage on its strikes', () => {
    const r = room();
    const s = saurian(r, 0, 8);
    s.facing = Math.atan2(r.me.pos.x - s.pos.x, r.me.pos.z - s.pos.z);
    const behind = addPlayer(r, 'mage', 0, 16);
    run(r, 0.1, [s], true);
    s.hp = Math.floor(s.maxHp * 0.15);
    run(r, DT, [s], true);
    expect(s.auras.find((a) => a.id === SAURIAN_ENRAGE)?.value).toBe(T.enrageDamage);
    run(r, T.tailFirst + T.tailCast + 0.1, [s], true);
    const hits = dealt(r, behind.id, 'Tail Swipe');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(Math.round(T.tailMin * 1.3));
    expect(hits[0]).toBeLessThanOrEqual(Math.round(T.tailMax * 1.3));
  });

  it('an evade resets the pull: the bar, the state and the enrage', () => {
    const r = room();
    const s = saurian(r, 0, 8);
    run(r, T.stompFirst + 0.05, [s], true);
    expect(s.castingAbility).toBe(SAURIAN_STOMP);
    s.hp = Math.floor(s.maxHp * 0.15);
    run(r, DT, [s], true);
    s.inCombat = false;
    s.aiState = 'evade';
    s.aggroTargetId = null;
    tickWildheartEncounters(r.sim.ctx);
    expect(s.castingAbility).toBeNull();
    expect(s.wildheartFight).toBeUndefined();
    expect(s.auras.some((a) => a.id === SAURIAN_ENRAGE)).toBe(false);
  });
});
