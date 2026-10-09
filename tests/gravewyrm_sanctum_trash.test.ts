// The Gravewyrm Sanctum trash (src/sim/content/gravewyrm_sanctum.ts) on the
// trash kit's Sanctum mechanics (src/sim/mob/trash_kit/sanctum_kit.ts: the
// Goadsmith's Goad, the Ogre Sledge-Hauler's Ice Block Toss, the Soul
// Brazier's stoke) and the shared kit keys (Warming Rite as an interruptible
// mend, the slowing Hoarfrost Pop and the Glacier Splinter's Shatter as death
// bursts, the Scaleguard's Cinder Breath cone), plus the Sledge Tusker's
// showpiece kit (src/sim/encounters/gravewyrm_sanctum/sledge_tusker.ts) and the
// Calving Face's story steps (story.ts). Driven through tickTrashKits /
// tickSanctumEncounters inside a real claimed Sanctum (the Wildheart trash
// test's shape).

import { describe, expect, it } from 'vitest';
import { GRAVEWYRM_SANCTUM_SPAWNS } from '../src/sim/content/gravewyrm_sanctum';
import { STORY_MARKERS } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { handleGravewyrmSanctumDevChat } from '../src/sim/dev/gravewyrm_sanctum_dev';
import {
  SANCTUM_DEED_IDS,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_TOSS_RING,
  SLEDGE_TUSKER_ID,
  sanctumFaceStage,
  sanctumStoryStepOf,
  storyStep,
  TUSKER_TUNING as T,
  TUSKER_ENRAGE,
  TUSKER_KNOCKDOWN,
  TUSKER_SPILL_LOG,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
  tickSanctumEncounters,
  trampleReach,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import { DEATH_BURST_RING, sweepOrphanBurstRings } from '../src/sim/mob/trash_kit/death_burst';
import {
  SANCTUM_CINDER_BREATH,
  SANCTUM_GOAD,
  SANCTUM_GOADED,
  SANCTUM_HOARFROST_POP,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_PLANT_BRAZIER,
  SANCTUM_SHATTER,
  SANCTUM_STOKED,
  SANCTUM_WARMING_RITE,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

const DUNGEON = 'gravewyrm_sanctum';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  events: SimEvent[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal'): Room {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev sanctum enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  // The middle of the Thaw Works' upper terrace, a wide flat floor (the mob AI
  // never runs here, so nothing else pulls).
  me.pos = sim.ctx.groundPos(o.x, o.z + 42);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function pull(r: Room, mob: Entity): Entity {
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
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

function run(r: Room, seconds: number, mobs: Entity[], encounters = false): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    if (encounters) tickSanctumEncounters(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `S${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

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

/** The claim's own Sledge Tusker, brought to the terrace beside the player. */
function tusker(r: Room, dx = 0, dz = 9): Entity {
  const s = r.inst.mobIds
    .map((id) => r.sim.ctx.entities.get(id))
    .find((e): e is Entity => e?.templateId === SLEDGE_TUSKER_ID);
  if (!s) throw new Error('no tusker');
  s.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  s.prevPos = { ...s.pos };
  s.dungeonPatrol = undefined;
  return pull(r, s);
}

describe('Sanctum trash: the cast table and the roster (design section 5.1)', () => {
  it('kicks Warming Rite and Goad, never the brazier plant, the breath or the toss', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_WARMING_RITE]?.school).toBe('shadow');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_GOAD]?.school).toBe('fire');
    for (const id of [SANCTUM_PLANT_BRAZIER, SANCTUM_CINDER_BREATH, SANCTUM_ICE_BLOCK_TOSS])
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[id], id).toBeUndefined();
  });

  it('gives every Sanctum trash type its one readable job', () => {
    const breath = MOBS.sanctum_drakonid.breathCone;
    expect([breath?.castId, breath?.castTime, breath?.arcDeg, breath?.range]).toEqual([
      SANCTUM_CINDER_BREATH,
      2,
      90,
      8,
    ]);
    expect(MOBS.sanctum_boneguard.charge?.name).toBe('Onrush');
    const rite = MOBS.broodsworn_thawcaller.trashKit?.mend;
    expect([rite?.castId, rite?.castTime, rite?.healPct]).toEqual([SANCTUM_WARMING_RITE, 2.5, 0.3]);
    const goad = MOBS.broodsworn_goadsmith.trashKit?.goad;
    expect([goad?.castTime, goad?.damagePct, goad?.seconds]).toEqual([2, 0.3, 8]);
    const plant = MOBS.broodsworn_pyre_tender.trashKit?.call;
    expect([plant?.castId, plant?.summon, plant?.every]).toEqual([
      SANCTUM_PLANT_BRAZIER,
      'soul_brazier',
      15,
    ]);
    const stoke = MOBS.soul_brazier.trashKit?.stoke;
    expect([stoke?.radius, stoke?.hastePct]).toEqual([10, 0.15]);
    expect(MOBS.soul_brazier.moveSpeed).toBe(0);
    expect(MOBS.rime_whelp.elite).toBeUndefined();
    const pop = MOBS.rime_whelp.trashKit?.deathBurst;
    expect([pop?.castId, pop?.radius, pop?.slow?.seconds]).toEqual([SANCTUM_HOARFROST_POP, 3, 2]);
    const toss = MOBS.ogre_sledge_hauler.trashKit?.toss;
    expect([toss?.castTime, toss?.radius]).toEqual([2, 5]);
    expect(MOBS.ogre_sledge_hauler.enrage?.belowHpPct).toBe(0.3);
    const shatter = MOBS.glacier_splinter.trashKit?.deathBurst;
    expect([shatter?.castId, shatter?.delay, shatter?.radius]).toEqual([SANCTUM_SHATTER, 2, 6]);
    expect(MOBS.sledge_tusker.ccImmune).toBe(true);
    expect(MOBS.sledge_tusker.trashKit).toBeUndefined();
  });

  it('every trash creature stands somewhere in the route; the brazier only as an add', () => {
    const placed = new Set(GRAVEWYRM_SANCTUM_SPAWNS.map((s) => s.mobId));
    for (const id of [
      'sanctum_boneguard',
      'sanctum_drakonid',
      'broodsworn_thawcaller',
      'broodsworn_goadsmith',
      'broodsworn_pyre_tender',
      'rime_whelp',
      'ogre_sledge_hauler',
      'glacier_splinter',
      SLEDGE_TUSKER_ID,
    ])
      expect(placed.has(id), id).toBe(true);
    expect(placed.has('soul_brazier')).toBe(false);
  });

  it('draws every new creature clearly bigger than a player, the Tusker as big as a house', () => {
    for (const id of [
      'broodsworn_thawcaller',
      'broodsworn_goadsmith',
      'broodsworn_pyre_tender',
      'soul_brazier',
      'rime_whelp',
      'ogre_sledge_hauler',
      'glacier_splinter',
    ])
      expect(MOBS[id].scale, id).toBeGreaterThanOrEqual(1.6);
    expect(MOBS.sledge_tusker.scale).toBeGreaterThanOrEqual(2.8);
    expect(MOBS.sledge_tusker.bodyRadius).toBeGreaterThanOrEqual(3.5);
  });
});

describe('the Broodsworn Goadsmith: Goad', () => {
  it('drives an ally into a fury after a 2 s bar, never itself while another stands bare', () => {
    const r = room();
    const smith = engage(r, 'broodsworn_goadsmith', 6, 0);
    const ogre = engage(r, 'ogre_sledge_hauler', 4, 4);
    const def = MOBS.broodsworn_goadsmith.trashKit?.goad;
    if (!def) throw new Error('goad');
    run(r, def.first + 0.05, [smith, ogre]);
    expect(smith.castingAbility).toBe(SANCTUM_GOAD);
    expect(smith.castTargetId).toBe(ogre.id);
    run(r, def.castTime + 0.1, [smith, ogre]);
    const fury = ogre.auras.find((a) => a.id === SANCTUM_GOADED);
    expect(fury?.kind).toBe('buff_dmg_done');
    expect(fury?.value).toBeCloseTo(0.3, 10);
    expect(smith.auras.some((a) => a.id === SANCTUM_GOADED)).toBe(false);
  });

  it('an interrupt wastes it', () => {
    const r = room();
    const smith = engage(r, 'broodsworn_goadsmith', 6, 0);
    const ogre = engage(r, 'ogre_sledge_hauler', 4, 4);
    const def = MOBS.broodsworn_goadsmith.trashKit?.goad;
    if (!def) throw new Error('goad');
    run(r, def.first + 0.05, [smith, ogre]);
    expect(smith.castingAbility).toBe(SANCTUM_GOAD);
    r.sim.ctx.cancelCast(smith);
    run(r, def.castTime + 0.2, [smith, ogre]);
    expect(ogre.auras.some((a) => a.id === SANCTUM_GOADED)).toBe(false);
  });
});

describe('the Broodsworn Thawcaller: Warming Rite', () => {
  it('heals a hurt ally for 30 percent after a 2.5 s bar', () => {
    const r = room();
    const caller = engage(r, 'broodsworn_thawcaller', 6, 0);
    const ogre = engage(r, 'ogre_sledge_hauler', 4, 4);
    ogre.hp = Math.floor(ogre.maxHp * 0.4);
    const def = MOBS.broodsworn_thawcaller.trashKit?.mend;
    if (!def) throw new Error('rite');
    run(r, def.first + 0.05, [caller, ogre]);
    expect(caller.castingAbility).toBe(SANCTUM_WARMING_RITE);
    const before = ogre.hp;
    run(r, def.castTime + 0.1, [caller, ogre]);
    expect(ogre.hp).toBeGreaterThanOrEqual(before + Math.round(ogre.maxHp * 0.3) - 1);
  });
});

describe('the Ogre Sledge-Hauler: Ice Block Toss', () => {
  it('paints a ring under the farthest player and lands on whoever stays in it', () => {
    const r = room();
    const ogre = engage(r, 'ogre_sledge_hauler', 3, 0);
    const far = addPlayer(r, 'mage', -20, 0);
    const def = MOBS.ogre_sledge_hauler.trashKit?.toss;
    if (!def) throw new Error('toss');
    run(r, def.first + 0.05, [ogre]);
    expect(ogre.castingAbility).toBe(SANCTUM_ICE_BLOCK_TOSS);
    const rings = objectsOf(r, SANCTUM_TOSS_RING);
    expect(rings).toHaveLength(1);
    expect(rings[0].scale).toBe(5);
    expect(Math.hypot(rings[0].pos.x - far.pos.x, rings[0].pos.z - far.pos.z)).toBeLessThan(0.01);
    run(r, def.castTime + 0.1, [ogre]);
    const hits = dealt(r, far.id, 'Ice Block Toss');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(150);
    expect(hits[0]).toBeLessThanOrEqual(180);
    expect(dealt(r, r.me.id, 'Ice Block Toss')).toHaveLength(0);
    expect(objectsOf(r, SANCTUM_TOSS_RING)).toHaveLength(0);
  });

  it('a player who steps out of the ring is spared', () => {
    const r = room();
    const ogre = engage(r, 'ogre_sledge_hauler', 3, 0);
    const far = addPlayer(r, 'mage', -20, 0);
    const def = MOBS.ogre_sledge_hauler.trashKit?.toss;
    if (!def) throw new Error('toss');
    run(r, def.first + 0.05, [ogre]);
    far.pos = r.sim.ctx.groundPos(far.pos.x - 8, far.pos.z);
    run(r, def.castTime + 0.1, [ogre]);
    expect(dealt(r, far.id, 'Ice Block Toss')).toHaveLength(0);
  });

  it('a toss that never lands leaves no ring behind', () => {
    const r = room();
    const ogre = engage(r, 'ogre_sledge_hauler', 3, 0);
    addPlayer(r, 'mage', -20, 0);
    const def = MOBS.ogre_sledge_hauler.trashKit?.toss;
    if (!def) throw new Error('toss');
    run(r, def.first + 0.05, [ogre]);
    expect(objectsOf(r, SANCTUM_TOSS_RING)).toHaveLength(1);
    r.sim.ctx.handleDeath(ogre, r.me);
    // The kit itself lifts it when the pull ends (no encounter sweep needed).
    run(r, 0.2, [], false);
    expect(objectsOf(r, SANCTUM_TOSS_RING)).toHaveLength(0);
  });
});

describe('the Broodsworn Pyre-Tender and her Soul Braziers', () => {
  it('plants a brazier whose soulfire quickens every ally near it', () => {
    const r = room();
    const tender = engage(r, 'broodsworn_pyre_tender', 6, 0);
    const smith = engage(r, 'broodsworn_goadsmith', 6, 5);
    const far = engage(r, 'broodsworn_goadsmith', 6, 30);
    const def = MOBS.broodsworn_pyre_tender.trashKit?.call;
    if (!def) throw new Error('plant');
    run(r, def.first + def.castTime + 0.1, [tender, smith, far]);
    const braziers = tender.summonedIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e): e is Entity => e?.templateId === 'soul_brazier');
    expect(braziers).toHaveLength(1);
    run(r, 2.2, [tender, smith, far, ...braziers]);
    const haste = smith.auras.find((a) => a.id === SANCTUM_STOKED);
    expect(haste?.kind).toBe('buff_haste');
    expect(haste?.value).toBeCloseTo(1.15, 10);
    expect(far.auras.some((a) => a.id === SANCTUM_STOKED)).toBe(false);
    // Its tender falls: the brazier gutters out.
    r.sim.ctx.handleDeath(tender, r.me);
    run(r, 0.2, braziers);
    expect(braziers[0].dead).toBe(true);
  });
});

describe('the Rime Whelp and the Glacier Splinter: their deaths', () => {
  it('a Rime Whelp pops at once in a 3 yd ring that chills', () => {
    const r = room();
    const whelp = engage(r, 'rime_whelp', 2, 0);
    run(r, 0.1, [whelp]);
    r.sim.ctx.handleDeath(whelp, r.me);
    run(r, 0.1, [whelp]);
    const hits = dealt(r, r.me.id, 'Hoarfrost Pop');
    expect(hits).toHaveLength(1);
    expect(r.me.auras.find((a) => a.id === `${SANCTUM_HOARFROST_POP}_slow`)?.kind).toBe('slow');
  });

  it('a Glacier Splinter shatters 2 s after it falls, on whoever stays near the body', () => {
    const r = room();
    const splinter = engage(r, 'glacier_splinter', 3, 0);
    run(r, 0.1, [splinter]);
    r.sim.ctx.handleDeath(splinter, r.me);
    run(r, 1.5, [splinter]);
    expect(dealt(r, r.me.id, 'Shatter')).toHaveLength(0);
    // The burst builds as a ring on the floor where it fell, sized to its reach.
    const rings = objectsOf(r, DEATH_BURST_RING);
    expect(rings).toHaveLength(1);
    expect(rings[0].scale).toBe(MOBS.glacier_splinter.trashKit?.deathBurst?.radius);
    expect(splinter.deathBurst?.objectId).toBe(rings[0].id);
    run(r, 0.7, [splinter]);
    expect(dealt(r, r.me.id, 'Shatter')).toHaveLength(1);
    // It goes off once and lifts its ring.
    expect(objectsOf(r, DEATH_BURST_RING)).toHaveLength(0);
    expect(r.sim.ctx.entities.has(rings[0].id)).toBe(false);
    run(r, 2, [splinter]);
    expect(dealt(r, r.me.id, 'Shatter')).toHaveLength(1);
  });

  it('a burst ring whose mob left the world before it went off is swept off the floor', () => {
    const r = room();
    const splinter = engage(r, 'glacier_splinter', 3, 0);
    run(r, 0.1, [splinter]);
    r.sim.ctx.handleDeath(splinter, r.me);
    run(r, 0.5, [splinter]);
    const ring = objectsOf(r, DEATH_BURST_RING)[0];
    expect(ring).toBeDefined();
    // The body leaves the claim (a despawn) before its fuse runs out.
    r.inst.mobIds.splice(r.inst.mobIds.indexOf(splinter.id), 1);
    r.sim.ctx.dropEntity(splinter.id);
    expect(sweepOrphanBurstRings(r.sim.ctx, r.inst)).toBe(1);
    expect(objectsOf(r, DEATH_BURST_RING)).toHaveLength(0);
    expect(r.sim.ctx.entities.has(ring.id)).toBe(false);
    // A ring whose mob still lies there is never swept.
    const other = engage(r, 'glacier_splinter', 3, 0);
    run(r, 0.1, [other]);
    r.sim.ctx.handleDeath(other, r.me);
    run(r, 0.5, [other]);
    expect(sweepOrphanBurstRings(r.sim.ctx, r.inst)).toBe(0);
    expect(objectsOf(r, DEATH_BURST_RING)).toHaveLength(1);
  });
});

describe('the Sledge Tusker (design section 5.3)', () => {
  it('Tusk Sweep: a 1.5 s bar, then the frontal cone throws whoever stands in it', () => {
    const r = room();
    const t = tusker(r);
    const behind = addPlayer(r, 'mage', 0, 20);
    run(r, T.sweepFirst + 0.05, [t], true);
    expect(t.castingAbility).toBe(TUSKER_TUSK_SWEEP);
    run(r, T.sweepCast + 0.05, [t], true);
    const hits = dealt(r, r.me.id, 'Tusk Sweep');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(T.sweepMin);
    expect(hits[0]).toBeLessThanOrEqual(T.sweepMax);
    expect(dealt(r, behind.id, 'Tusk Sweep')).toHaveLength(0);
  });

  it('Trample: a lane to the farthest player, everyone in it knocked down, then the charge', () => {
    const r = room();
    const t = tusker(r, 0, 0);
    r.me.pos = r.sim.ctx.groundPos(t.pos.x + 4, t.pos.z);
    const far = addPlayer(r, 'mage', -4, -20);
    const aside = addPlayer(r, 'priest', 12, -10);
    run(r, T.trampleFirst + 0.05, [t], true);
    expect(t.castingAbility).toBe(TUSKER_TRAMPLE);
    expect(t.castTargetId).toBe(far.id);
    const st = t.sanctumFight;
    expect(st?.kind === 'tusker' ? st.lane?.length : 0).toBeGreaterThan(10);
    const from = { ...t.pos };
    run(r, T.trampleCast + 0.05, [t], true);
    expect(dealt(r, far.id, 'Trample')).toHaveLength(1);
    expect(far.auras.some((a) => a.id === TUSKER_KNOCKDOWN)).toBe(true);
    expect(dealt(r, aside.id, 'Trample')).toHaveLength(0);
    run(r, T.trampleRun + 0.1, [t], true);
    expect(Math.hypot(t.pos.x - from.x, t.pos.z - from.z)).toBeGreaterThan(10);
  });

  it('Cold Cargo: a kill with no Trample landed earns the deed; a landed Trample loses it', () => {
    const earned = (r: Room) =>
      r.sim.players.get(r.me.id)?.deedsEarned.has(SANCTUM_DEED_IDS.sledgeTusker) ?? false;
    const r = room();
    const t = tusker(r, 0, 0);
    run(r, 1, [t], true);
    r.sim.ctx.dealDamage(r.me, t, 1e7, false, 'physical', 'Test', 'hit', false);
    run(r, 0.1, [], true);
    expect(t.dead).toBe(true);
    expect(earned(r)).toBe(true);

    const g = room();
    const t2 = tusker(g, 0, 0);
    g.me.pos = g.sim.ctx.groundPos(t2.pos.x + 4, t2.pos.z);
    addPlayer(g, 'mage', -4, -20);
    run(g, T.trampleFirst + T.trampleCast + 0.1, [t2], true);
    expect(t2.sanctumFight?.kind === 'tusker' && t2.sanctumFight.trampleLanded).toBe(true);
    g.sim.ctx.dealDamage(g.me, t2, 1e7, false, 'physical', 'Test', 'hit', false);
    run(g, 0.1, [], true);
    expect(t2.dead).toBe(true);
    expect(earned(g)).toBe(false);
  });

  it('the Trample lane stops short of a drop', () => {
    // From the middle of the works terrace straight south: the terrace's edge
    // (z 28) stops the lane well short of 30 yd.
    expect(trampleReach(20, 42, Math.PI, 30)).toBeLessThanOrEqual(15);
    expect(trampleReach(0, 42, Math.PI / 2, 30)).toBe(30);
  });

  it('Spilled Braziers: at half health three soulfire patches burn where the sledge tips', () => {
    const r = room();
    const t = tusker(r);
    run(r, 0.1, [t], true);
    t.hp = Math.floor(t.maxHp * 0.49);
    run(r, 0.1, [t], true);
    const patches = objectsOf(r, SANCTUM_SOULFIRE_PATCH);
    expect(patches).toHaveLength(3);
    expect(r.events.some((e) => e.type === 'log' && e.text === TUSKER_SPILL_LOG)).toBe(true);
    // Stand in one: it burns each second.
    r.me.pos = { ...patches[0].pos };
    run(r, 2.05, [t], true);
    expect(dealt(r, r.me.id, 'Spilled Braziers').length).toBeGreaterThanOrEqual(2);
    // They go out after 10 s, even if the Tusker falls first.
    r.sim.ctx.handleDeath(t, r.me);
    run(r, T.patchSeconds, [], true);
    expect(objectsOf(r, SANCTUM_SOULFIRE_PATCH)).toHaveLength(0);
  });

  it('its soulfire patches keep burning out while the fight pauses on a lost target', () => {
    const r = room();
    const t = tusker(r);
    run(r, 0.1, [t], true);
    t.hp = Math.floor(t.maxHp * 0.49);
    run(r, 0.1, [t], true);
    expect(objectsOf(r, SANCTUM_SOULFIRE_PATCH)).toHaveLength(3);
    // The tank drops: in combat, chasing, no target (the paused hold).
    for (let k = 0; k < (T.patchSeconds + 0.5) / DT; k++) {
      t.inCombat = true;
      t.aiState = 'chase';
      t.aggroTargetId = null;
      tickSanctumEncounters(r.sim.ctx);
    }
    expect(objectsOf(r, SANCTUM_SOULFIRE_PATCH)).toHaveLength(0);
  });

  it('enrages under a fifth of its health', () => {
    const r = room();
    const t = tusker(r);
    run(r, 0.1, [t], true);
    t.hp = Math.floor(t.maxHp * 0.19);
    run(r, 0.1, [t], true);
    expect(t.auras.find((a) => a.id === TUSKER_ENRAGE)?.value).toBeCloseTo(T.enrageDamage, 10);
  });
});

describe('the Calving Face: its crack steps ride the story markers', () => {
  it('spawns one marker per spot at step 0, and the Tusker death raises them all to 1', () => {
    const r = room();
    const markers = r.inst.objectIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e): e is Entity => e !== undefined && sanctumStoryStepOf(e.templateId) !== null);
    expect(markers).toHaveLength(STORY_MARKERS.length);
    for (const m of markers) expect(sanctumStoryStepOf(m.templateId)).toBe(0);
    r.sim.chat('/dev sanctum kill pa', r.me.id);
    run(r, 0.1, [], true);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(1);
    for (const m of markers) expect(sanctumStoryStepOf(m.templateId)).toBe(1);
    // Korgath then Velkhar: steps 6 and 7, and the latch never falls back.
    r.sim.chat('/dev sanctum kill korgath', r.me.id);
    run(r, 0.1, [], true);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(6);
    r.sim.chat('/dev sanctum kill velkhar', r.me.id);
    run(r, 0.1, [], true);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(7);
  });

  it('maps a crack step onto the five render stages of the design', () => {
    expect(sanctumFaceStage(0)).toEqual({ stage: 0, chains: 0 });
    expect(sanctumFaceStage(1)).toEqual({ stage: 1, chains: 0 });
    expect(sanctumFaceStage(3)).toEqual({ stage: 2, chains: 2 });
    expect(sanctumFaceStage(6)).toEqual({ stage: 3, chains: 4 });
    expect(sanctumFaceStage(7)).toEqual({ stage: 4, chains: 4 });
    expect(sanctumFaceStage(8)).toEqual({ stage: 5, chains: 4 });
  });
});

describe('/dev sanctum', () => {
  it('enters, jumps to every area on its floor, sets the face, and resets', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false, devCommands: true });
    // Straight to the handler: the chat seam's rate limit would drop a burst.
    const dev = (line: string) => handleGravewyrmSanctumDevChat(sim.ctx, line, sim.player.id);
    expect(dev('/dev sanctum enter')).toBe(true);
    const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
    expect(inst?.dungeonId).toBe(DUNGEON);
    if (!inst) return;
    const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
    for (const area of [
      'court',
      'tusker',
      'serac',
      'anchor',
      'korgath',
      'works',
      'velkhar',
      'korzul',
    ]) {
      dev(`/dev sanctum tp ${area}`);
      const p = sim.player.pos;
      expect(Math.abs(p.x - o.x), area).toBeLessThan(115);
      expect(p.y, area).toBeGreaterThan(-1);
    }
    dev('/dev sanctum face 5');
    expect(storyStep(sim.ctx, inst)).toBe(5);
    dev('/dev sanctum reset');
    const fresh = claimedInstanceAt(sim.ctx, sim.player.pos);
    expect(fresh?.dungeonId).toBe(DUNGEON);
    if (fresh) expect(storyStep(sim.ctx, fresh)).toBe(0);
  });
});
