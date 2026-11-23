// The Gravewyrm Sanctum's trash mechanics pass (E:/woc/entregas/investigacion/
// MECANICAS_TRASH.md section 8, approved 2026-10-04) on the trash engine's
// generic keys: the Thawcaller's Thaw the Held over fallen Boneguard, the
// Scaleguard's Counterweight Lash and heroic Boiling Meltwater, the
// Goadsmith's Branding Iron and the meltwater pools that douse it, the Soul
// Brazier's Topple Brazier, the Rime Whelp's Rime Breath freezing at five
// stacks, the Ogre's Ice Slab, the Glacier Splinter's Fracture; plus the
// quench pools' placement and /dev trashkit. Driven through tickTrashKits
// inside a real claimed Sanctum (the Sanctum trash test's shape).

import { afterEach, describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { GRAVEWYRM_SANCTUM_SPAWNS } from '../src/sim/content/gravewyrm_sanctum';
import { GRAVEWYRM_HEIGHTS, QUENCH_POOLS } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEON_FLOOR_Y, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { clearCombatWallStateForTest, combatWallsAt } from '../src/sim/instances/combat_wall_state';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickBreathConeBar } from '../src/sim/mob/mob_cast_bars';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import { BRAND_FIZZLED, BRAND_QUENCHED, inQuenchZone } from '../src/sim/mob/trash_kit/brand';
import { spawnCombatWall } from '../src/sim/mob/trash_kit/combat_walls';
import { kitObjectsOf } from '../src/sim/mob/trash_kit/kit_objects';
import {
  SANCTUM_BOILING_MELTWATER,
  SANCTUM_BRANDED,
  SANCTUM_BRANDING_IRON,
  SANCTUM_CINDER_BREATH,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_CREEPING_RIME,
  SANCTUM_FRACTURE,
  SANCTUM_ICE_SLAB,
  SANCTUM_ICED_OVER,
  SANCTUM_RIME_BREATH,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
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
  me.pos = sim.ctx.groundPos(o.x, o.z + 42);
  me.prevPos = { ...me.pos };
  me.facing = 0;
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function pull(r: Room, mob: Entity, victim: Entity = r.me): Entity {
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = victim.id;
  mob.facing = Math.atan2(victim.pos.x - mob.pos.x, victim.pos.z - mob.pos.z);
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

function run(r: Room, seconds: number, mobs: Entity[]): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `M${cls}${dx}${dz}`);
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

function fx(r: Room, ability: string): Extract<SimEvent, { type: 'spellfx' }>[] {
  return r.events.filter(
    (e): e is Extract<SimEvent, { type: 'spellfx' }> =>
      e.type === 'spellfx' && e.ability === ability,
  );
}

/** Run until `mob` starts `castId` (the kit's timers pause while another bar
 *  runs, so the start time is the kit's own business). */
function runUntilCast(r: Room, mob: Entity, castId: string, mobs: Entity[], max = 30): void {
  for (let t = 0; t < max; t += DT) {
    if (mob.castingAbility === castId) return;
    run(r, DT, mobs);
  }
  throw new Error(`${mob.name} never started ${castId}`);
}

/** Chat as the room's player with a fresh chat-token bucket (the sim clock
 *  does not move between these commands). */
function dev(r: Room, line: string): void {
  r.sim.ctx.chatTokens.delete(r.me.id);
  r.sim.chat(line, r.me.id);
}

function kill(mob: Entity): void {
  mob.dead = true;
  mob.hp = 0;
  mob.inCombat = false;
}

afterEach(() => clearCombatWallStateForTest());

describe('the roster: every Sanctum trash type carries its new job', () => {
  it('wires each proposal of section 8 onto its template', () => {
    const k = (id: string) => MOBS[id].trashKit;
    expect(k('broodsworn_thawcaller')?.reanimate?.castId).toBe(SANCTUM_THAW_THE_HELD);
    expect(k('broodsworn_thawcaller')?.reanimate?.corpses).toEqual(['sanctum_boneguard']);
    expect(k('broodsworn_thawcaller')?.reanimate?.summon).toBe('raised_bonewalker');
    expect(k('sanctum_drakonid')?.tailLash?.castId).toBe(SANCTUM_COUNTERWEIGHT_LASH);
    expect(k('sanctum_drakonid')?.breathPool?.heroicOnly).toBe(true);
    expect(k('broodsworn_goadsmith')?.brand?.castId).toBe(SANCTUM_BRANDING_IRON);
    expect(k('soul_brazier')?.usable?.castId).toBe(SANCTUM_TOPPLE_BRAZIER);
    expect(k('rime_whelp')?.cone?.freezeStack?.maxStacks).toBe(5);
    expect(k('ogre_sledge_hauler')?.toss?.leavesWall?.objectTemplate).toBe(SANCTUM_ICE_SLAB);
    expect(k('ogre_sledge_hauler')?.toss?.leavesWall?.seconds).toBe(15);
    expect(k('glacier_splinter')?.split?.castId).toBe(SANCTUM_FRACTURE);
  });

  it('kicks the rite and the brand, never the lash or the Rime Breath (dodge those)', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_THAW_THE_HELD]?.school).toBe('shadow');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_BRANDING_IRON]?.school).toBe('fire');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_COUNTERWEIGHT_LASH]).toBeUndefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SANCTUM_RIME_BREATH]).toBeUndefined();
  });

  it('pairs the Boneguard with a Thawcaller in the packs the design names (g1, g5)', () => {
    for (const pack of ['g1', 'g5']) {
      const ids = GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.packId === pack).map((s) => s.mobId);
      expect(ids).toContain('sanctum_boneguard');
      expect(ids).toContain('broodsworn_thawcaller');
    }
  });
});

describe('the Broodsworn Thawcaller: Thaw the Held', () => {
  it('raises a fallen Boneguard where it lies after a 3 s rite on the corpse, once', () => {
    const r = room();
    const thaw = engage(r, 'broodsworn_thawcaller', 0, 8);
    const guard = engage(r, 'sanctum_boneguard', 4, 4);
    kill(guard);
    runUntilCast(r, thaw, SANCTUM_THAW_THE_HELD, [thaw]);
    expect(thaw.castTargetId).toBe(guard.id);
    expect(thaw.channeling).toBe(true);
    expect(thaw.castTotal).toBe(3);
    run(r, 3.1, [thaw]);
    const risen = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e): e is Entity => e?.templateId === 'raised_bonewalker');
    expect(risen).toHaveLength(1);
    expect(Math.hypot(risen[0].pos.x - guard.pos.x, risen[0].pos.z - guard.pos.z)).toBeLessThan(
      0.01,
    );
    expect(risen[0].hp).toBe(Math.round(risen[0].maxHp * 0.6));
    expect(risen[0].aggroTargetId).toBe(r.me.id);
    expect(guard.kitReanimated).toBe(true);
    // The corpse keeps its loot (the rite drags the spirit up, not the body).
    expect(r.sim.ctx.entities.has(guard.id)).toBe(true);
    // Never twice.
    run(r, 20, [thaw, ...risen]);
    expect(
      r.inst.mobIds.filter((id) => r.sim.ctx.entities.get(id)?.templateId === 'raised_bonewalker'),
    ).toHaveLength(1);
  });

  it('a kick wastes the rite: no Bonewalker climbs out', () => {
    const r = room();
    const thaw = engage(r, 'broodsworn_thawcaller', 0, 8);
    const guard = engage(r, 'sanctum_boneguard', 4, 4);
    kill(guard);
    runUntilCast(r, thaw, SANCTUM_THAW_THE_HELD, [thaw]);
    r.sim.ctx.cancelCast(thaw);
    run(r, 3.5, [thaw]);
    expect(
      r.inst.mobIds.some((id) => r.sim.ctx.entities.get(id)?.templateId === 'raised_bonewalker'),
    ).toBe(false);
    expect(guard.kitReanimated).toBeUndefined();
  });

  it('ignores corpses it was not given, and corpses out of reach', () => {
    const r = room();
    const thaw = engage(r, 'broodsworn_thawcaller', 0, 8);
    const ogre = engage(r, 'ogre_sledge_hauler', 3, 3);
    const farGuard = engage(r, 'sanctum_boneguard', 0, 8 + 31);
    kill(ogre);
    kill(farGuard);
    run(r, 10, [thaw]);
    expect(fx(r, SANCTUM_THAW_THE_HELD)).toHaveLength(0);
    expect(thaw.castingAbility).not.toBe(SANCTUM_THAW_THE_HELD);
  });
});

describe('the Sanctum Scaleguard: Counterweight Lash and Boiling Meltwater', () => {
  it('lashes whoever stands behind it after a 1 s bar; its flanks and its front are spared', () => {
    const r = room();
    // The Scaleguard faces the tank (me) from 3 yd north.
    const scale = engage(r, 'sanctum_drakonid', 0, 3);
    const behind = addPlayer(r, 'mage', 0, 7);
    const flank = addPlayer(r, 'priest', 3.5, 3);
    runUntilCast(r, scale, SANCTUM_COUNTERWEIGHT_LASH, [scale]);
    expect(scale.castTotal).toBe(1);
    run(r, 1.05, [scale]);
    expect(dealt(r, behind.id, 'Counterweight Lash')).toHaveLength(1);
    const lash = dealt(r, behind.id, 'Counterweight Lash')[0];
    expect(lash).toBeGreaterThanOrEqual(120);
    expect(lash).toBeLessThanOrEqual(140);
    expect(dealt(r, flank.id, 'Counterweight Lash')).toEqual([]);
    expect(dealt(r, r.me.id, 'Counterweight Lash')).toEqual([]);
  });

  it('on heroic the Cinder Breath leaves Boiling Meltwater in front of it; never on normal', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const r = room(difficulty);
      const scale = engage(r, 'sanctum_drakonid', 0, 3);
      const breath = MOBS.sanctum_drakonid.breathCone;
      if (!breath) throw new Error('no breath');
      scale.castingAbility = SANCTUM_CINDER_BREATH;
      scale.castTotal = breath.castTime;
      scale.castRemaining = DT;
      tickBreathConeBar(r.sim.ctx, scale, breath);
      const pools = kitObjectsOf(r.sim.ctx, r.inst, 'hazard');
      if (difficulty === 'normal') {
        expect(pools).toHaveLength(0);
        continue;
      }
      expect(pools).toHaveLength(1);
      expect(pools[0].templateId).toBe(SANCTUM_BOILING_MELTWATER);
      // 4.5 yd out along its facing (toward the tank at its south).
      const ahead = Math.hypot(pools[0].pos.x - scale.pos.x, pools[0].pos.z - scale.pos.z);
      expect(ahead).toBeCloseTo(4.5, 3);
      // It scalds whoever stands in it, on the heroic multiplier.
      const inPool = addPlayer(r, 'mage', 0, 3 - 4.5);
      inPool.pos = r.sim.ctx.groundPos(pools[0].pos.x, pools[0].pos.z);
      run(r, 1, [scale]);
      const scalds = dealt(r, inPool.id, 'Boiling Meltwater');
      expect(scalds).toHaveLength(1);
      expect(scalds[0]).toBeGreaterThan(38);
    }
  });
});

describe('the Broodsworn Goadsmith: Branding Iron and the meltwater pools', () => {
  it('brands a player it can see (never the tank while another stands in reach)', () => {
    const r = room();
    const goad = engage(r, 'broodsworn_goadsmith', 0, 6);
    const mage = addPlayer(r, 'mage', 8, 0);
    runUntilCast(r, goad, SANCTUM_BRANDING_IRON, [goad]);
    expect(goad.castTargetId).toBe(mage.id);
    run(r, 2.05, [goad]);
    const brand = mage.auras.find((a) => a.id === SANCTUM_BRANDED);
    expect(brand?.kind).toBe('dot');
    expect(brand?.value).toBe(30);
    expect(brand?.tickInterval).toBe(2);
    expect(brand?.remaining).toBeCloseTo(12, 6);
    expect(r.me.auras.some((a) => a.id === SANCTUM_BRANDED)).toBe(false);
  });

  it('a branded player who steps into a meltwater pool puts it out at once', () => {
    const r = room();
    const o = instanceOrigin(DUNGEONS[DUNGEON].index, r.inst.slot);
    const goad = engage(r, 'broodsworn_goadsmith', 0, 6);
    const mage = addPlayer(r, 'mage', 8, 0);
    runUntilCast(r, goad, SANCTUM_BRANDING_IRON, [goad]);
    run(r, 2.05, [goad]);
    expect(mage.auras.some((a) => a.id === SANCTUM_BRANDED)).toBe(true);
    // Walk to the sledge park's pool.
    const pool = QUENCH_POOLS[4];
    mage.pos = r.sim.ctx.groundPos(o.x + pool.x + 1, o.z + pool.z);
    expect(inQuenchZone(r.inst, mage.pos.x, mage.pos.z)).toBe(true);
    run(r, DT, [goad]);
    expect(mage.auras.some((a) => a.id === SANCTUM_BRANDED)).toBe(false);
    expect(fx(r, BRAND_QUENCHED).some((e) => e.targetId === mage.id)).toBe(true);
  });

  it('a victim out of sight when the bar ends (behind an Ice Slab) is spared: it fizzles', () => {
    const r = room();
    const goad = engage(r, 'broodsworn_goadsmith', 0, 8);
    const mage = addPlayer(r, 'mage', 0, -2);
    runUntilCast(r, goad, SANCTUM_BRANDING_IRON, [goad]);
    expect(goad.castTargetId).toBe(mage.id);
    spawnCombatWall(
      r.sim.ctx,
      r.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      r.me.pos.x,
      r.me.pos.z + 3,
      0,
      15,
    );
    run(r, 2.05, [goad]);
    expect(mage.auras.some((a) => a.id === SANCTUM_BRANDED)).toBe(false);
    expect(fx(r, BRAND_FIZZLED)).toHaveLength(1);
  });

  it('the brand stays in the fumbled-dodge band unquenched: 180 over 12 s', () => {
    const def = MOBS.broodsworn_goadsmith.trashKit?.brand;
    if (!def) throw new Error('no brand');
    const total = (def.seconds / def.interval) * def.perTick;
    expect(total).toBe(180);
    // About 19 percent of the 950 health cloth reference (README section 7).
    expect(total / 950).toBeLessThan(0.2);
  });
});

describe('the quench pools (QUENCH_POOLS)', () => {
  it('lie on open, flat floor at their area height, clear of every collider', () => {
    const r = room();
    const o = instanceOrigin(DUNGEONS[DUNGEON].index, r.inst.slot);
    const heights = new Set<number>(Object.values(GRAVEWYRM_HEIGHTS));
    for (const q of QUENCH_POOLS) {
      for (const [dx, dz] of [
        [0, 0],
        [q.r * 0.8, 0],
        [-q.r * 0.8, 0],
        [0, q.r * 0.8],
        [0, -q.r * 0.8],
      ]) {
        const x = o.x + q.x + dx;
        const z = o.z + q.z + dz;
        const at = resolvePosition(r.sim.cfg.seed, x, z, 0.5);
        expect(Math.hypot(at.x - x, at.z - z), `pool ${q.x},${q.z} blocked`).toBeLessThan(1e-6);
      }
      const y = r.sim.ctx.groundPos(o.x + q.x, o.z + q.z).y - DUNGEON_FLOOR_Y;
      const near = [...heights].some((h) => Math.abs(y - h) < 1.5);
      expect(near, `pool ${q.x},${q.z} at height ${y}`).toBe(true);
    }
  });

  it('every Goadsmith pull has a pool within 14 yd', () => {
    const goads = GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.mobId === 'broodsworn_goadsmith');
    expect(goads.length).toBeGreaterThan(0);
    for (const g of goads) {
      // A patrol is judged along its walk (its points and their midpoints).
      const spots = g.patrol
        ? g.patrol.points.flatMap((p, i, all) => {
            const n = all[(i + 1) % all.length];
            return [p, { x: (p.x + n.x) / 2, z: (p.z + n.z) / 2 }];
          })
        : [{ x: g.x, z: g.z }];
      const nearest = Math.min(
        ...spots.flatMap((sp) => QUENCH_POOLS.map((q) => Math.hypot(q.x - sp.x, q.z - sp.z))),
      );
      expect(nearest, `goadsmith at ${g.x},${g.z}`).toBeLessThanOrEqual(14);
    }
  });
});

describe('the Soul Brazier a Pyre-Tender plants is usable', () => {
  it('a planted brazier can be toppled by a player', () => {
    const r = room();
    const tender = engage(r, 'broodsworn_pyre_tender', 0, 6);
    run(r, 3 + 1.5 + DT, [tender]);
    const brazier = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'soul_brazier');
    if (!brazier) throw new Error('no brazier planted');
    const kicker = addPlayer(r, 'mage', 0, 0);
    kicker.pos = r.sim.ctx.groundPos(brazier.pos.x - 2, brazier.pos.z);
    kicker.targetId = brazier.id;
    r.sim.interact(kicker.id);
    expect(kicker.castingAbility).toBe(SANCTUM_TOPPLE_BRAZIER);
  });
});

describe('the Rime Whelp: Rime Breath', () => {
  it('a short frontal puff at the one it fights; the fifth stack ices its victim over', () => {
    const r = room();
    const whelp = engage(r, 'rime_whelp', 0, 3);
    const side = addPlayer(r, 'mage', 5, 3);
    // Each breath a 0.6 s bar, every 7 s once the first is in.
    for (let i = 0; i < 4; i++) {
      runUntilCast(r, whelp, SANCTUM_RIME_BREATH, [whelp]);
      expect(whelp.castTotal).toBe(0.6);
      run(r, 0.65, [whelp]);
    }
    expect(dealt(r, r.me.id, 'Rime Breath')).toHaveLength(4);
    const chill = r.me.auras.find((a) => a.id === SANCTUM_CREEPING_RIME);
    expect(chill?.stacks).toBe(4);
    expect(chill?.value).toBeCloseTo(1 - 0.08 * 4, 9);
    runUntilCast(r, whelp, SANCTUM_RIME_BREATH, [whelp]);
    run(r, 0.65, [whelp]);
    expect(r.me.auras.some((a) => a.id === SANCTUM_ICED_OVER && a.kind === 'stun')).toBe(true);
    expect(r.me.auras.some((a) => a.id === SANCTUM_CREEPING_RIME)).toBe(false);
    expect(dealt(r, side.id, 'Rime Breath')).toEqual([]);
  });
});

describe('the Ogre Sledge-Hauler: the Ice Slab stays', () => {
  it('its toss leaves an Ice Slab wall where the ring was, for 15 s', () => {
    const r = room();
    const o = instanceOrigin(DUNGEONS[DUNGEON].index, r.inst.slot);
    const ogre = engage(r, 'ogre_sledge_hauler', 0, 4);
    const far = addPlayer(r, 'mage', 0, -14);
    runUntilCast(r, ogre, 'sanctum_ice_block_toss', [ogre]);
    const ring = ogre.trashKit?.toss;
    expect(ring).toBeDefined();
    run(r, 2.05, [ogre]);
    const walls = kitObjectsOf(r.sim.ctx, r.inst, 'wall');
    expect(walls).toHaveLength(1);
    expect(walls[0].templateId).toBe(SANCTUM_ICE_SLAB);
    expect(walls[0].name).toBe('Ice Slab');
    expect(
      Math.hypot(walls[0].pos.x - (ring?.x ?? 0), walls[0].pos.z - (ring?.z ?? 0)),
    ).toBeLessThan(1e-6);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(1);
    void far;
    run(r, 15, [ogre]);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'wall').length).toBeLessThanOrEqual(1);
    expect(r.sim.ctx.entities.has(walls[0].id)).toBe(false);
  });
});

describe('/dev trashkit', () => {
  it('drops a wall, spills both pools, brands and chills the caller, and jumps to a pool', () => {
    const r = room();
    dev(r, '/dev trashkit wall');
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'wall')).toHaveLength(1);
    dev(r, '/dev trashkit pool boiling');
    dev(r, '/dev trashkit pool soulfire');
    expect(
      kitObjectsOf(r.sim.ctx, r.inst, 'hazard')
        .map((e) => e.templateId)
        .sort(),
    ).toEqual([SANCTUM_BOILING_MELTWATER, 'sanctum_spilled_soulfire']);
    dev(r, '/dev trashkit freeze');
    expect(r.me.auras.find((a) => a.id === SANCTUM_CREEPING_RIME)?.stacks).toBe(1);
    dev(r, '/dev trashkit quench');
    expect(inQuenchZone(r.inst, r.me.pos.x, r.me.pos.z)).toBe(true);
    const splinter = engage(r, 'glacier_splinter', 3, 0);
    r.me.targetId = splinter.id;
    dev(r, '/dev trashkit split');
    run(r, DT, [splinter]);
    expect(splinter.kitSplit?.role).toBe('parent');
    dev(r, '/dev trashkit demo');
    expect(splinter.devTrashKit?.nova).toBeDefined();
  });
});
