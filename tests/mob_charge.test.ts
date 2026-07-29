// Heroic anti-kite mob charge (MobTemplate.charge + src/sim/mob/charge.ts):
// the warrior/guard melee mobs of the four heroic five-mans open with an
// Onrush-style gap closer (instant 0.5s stun, then a 3x-speed dash to melee).
// HEROIC-ONLY: the template field is inert until applyDungeonMobTuning stamps
// Entity.chargeEnabled on a heroic spawn, so normal spawns never charge, and
// every branch of the module draws ZERO rng, so the parity goldens are
// untouched by design.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  applyDungeonMobTuning,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { MOB_CHARGE_STUN_ID, tryStartMobCharge, updateMobChargeDash } from '../src/sim/mob/charge';
import { Sim } from '../src/sim/sim';
import { type Aura, dist2d, type Entity, MELEE_RANGE } from '../src/sim/types';

const SEED = 61234;

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// The nine heroic warrior/guard melee templates that carry the charge, and the
// exact record they all share (anti-kite band 5..30yd, 12s cooldown, 0.5s stun).
const CHARGE_TEMPLATE_IDS = [
  'crypt_shambler',
  'sexton_marrow',
  'bastion_revenant',
  'knight_commander_olen',
  'drowned_thrall',
  'sanctum_boneguard',
  'raised_bonewalker',
  'drowned_templeguard',
  'pearlguard_sentinel',
] as const;
const CHARGE_RECORD = {
  minRange: 5,
  maxRange: 30,
  cooldown: 12,
  stunDuration: 0.5,
  name: 'Onrush',
  school: 'physical',
} as const;
// Deliberately excluded: casters/acolytes, beasts/spiders/dragonkin, the ogre,
// all bosses, and every Nythraxis raid mob (keeps the raid parity golden
// untouched).
const NO_CHARGE_TEMPLATE_IDS = [
  'hollow_acolyte',
  'tidebound_acolyte',
  'pale_choir_acolyte',
  'choirmother_selthe',
  'grand_necromancer_velkhar',
  'bonechill_widow',
  'glimmerscale_lurker',
  'moonspawn',
  'sanctum_drakonid',
  'korgath_the_bound',
  'morthen',
  'vael_the_mistcaller',
  'ysolei',
  'korzul_the_gravewyrm',
  'nythraxis_scourge_of_thornpeak',
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
] as const;

function makeSim(): AnySim {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// Spawn a mob straight from the difficulty transform, the same template +
// entity-stamp pair a claimed instance applies (the harness pattern from
// tests/gravewyrm_normal_tuning.test.ts, plus the entity stamp).
function spawnTuned(
  sim: AnySim,
  id: number,
  tmplId: string,
  dungeonId: string,
  difficulty: 'normal' | 'heroic',
  x: number,
  z: number,
): AnyEntity {
  const tmpl = mobTemplateForDungeonDifficulty(MOBS[tmplId], dungeonId, difficulty);
  const mob = createMob(id, tmpl, tmpl.maxLevel, { x, y: 0, z }) as AnyEntity;
  applyDungeonMobTuning(mob, dungeonId, difficulty);
  (sim as any).addEntity(mob);
  return mob;
}

// Engage the mob on the player without any rng-drawing combat: seed the hate
// table and point the AI at them, exactly how a pull leaves the pair.
function engage(mob: AnyEntity, targetId: number): void {
  mob.inCombat = true;
  mob.aiState = 'chase';
  mob.aggroTargetId = targetId;
  mob.threat.set(targetId, 1000);
}

// An invulnerable (gm) player so heroic swings cannot end the scenario early;
// gm only no-ops dealDamage, auras (the charge stun) still land.
function addGmPlayer(sim: AnySim, x: number, z: number): { pid: number; player: AnyEntity } {
  const pid = sim.addPlayer('warrior', 'Kiter');
  const player = sim.entities.get(pid) as AnyEntity;
  player.gm = true;
  teleport(sim, player, x, z);
  return { pid, player };
}

function chargeStunOn(e: AnyEntity): Aura | undefined {
  return e.auras.find((a: Aura) => a.id === MOB_CHARGE_STUN_ID);
}

const testStun = (sourceId: number): Aura => ({
  id: 'test_stun',
  name: 'Test Stun',
  kind: 'stun',
  remaining: 10,
  duration: 10,
  value: 0,
  sourceId,
  school: 'physical',
});

const testRoot = (sourceId: number): Aura => ({
  id: 'test_root',
  name: 'Test Root',
  kind: 'root',
  remaining: 10,
  duration: 10,
  value: 0,
  sourceId,
  school: 'frost',
});

describe('charge template coverage (data contract)', () => {
  it('exactly the nine warrior/guard melee templates carry the shared charge record', () => {
    for (const id of CHARGE_TEMPLATE_IDS) {
      expect(MOBS[id]?.charge, `${id} carries charge`).toEqual(CHARGE_RECORD);
    }
    // Global scan: no template outside the nine may carry a charge (bosses and
    // every Nythraxis raid mob stay charge-free so the raid parity golden and
    // the boss-mechanic draw order are untouched).
    const allWithCharge = Object.values(MOBS)
      .filter((t) => t.charge)
      .map((t) => t.id)
      .sort();
    expect(allWithCharge).toEqual([...CHARGE_TEMPLATE_IDS].sort());
    for (const id of NO_CHARGE_TEMPLATE_IDS) {
      expect(MOBS[id], `${id} exists`).toBeTruthy();
      expect(MOBS[id]?.charge, `${id} must not charge`).toBeUndefined();
    }
  });

  it('applyDungeonMobTuning stamps chargeEnabled on heroic spawns only', () => {
    const heroic = { templateId: 'crypt_shambler' } as Entity;
    applyDungeonMobTuning(heroic, 'hollow_crypt', 'heroic');
    expect(heroic.chargeEnabled).toBe(true);

    const normal = { templateId: 'crypt_shambler' } as Entity;
    applyDungeonMobTuning(normal, 'hollow_crypt', 'normal');
    expect(normal.chargeEnabled).toBeUndefined();

    // A heroic spawn of a template WITHOUT charge is never stamped.
    const widow = { templateId: 'bonechill_widow' } as Entity;
    applyDungeonMobTuning(widow, 'hollow_crypt', 'heroic');
    expect(widow.chargeEnabled).toBeUndefined();
  });
});

describe('heroic charge through the full sim tick', () => {
  it('a heroic spawn at 20yd stuns its target the same tick and dashes to melee', () => {
    const sim = makeSim();
    const { pid, player } = addGmPlayer(sim, 20, 0);
    const mob = spawnTuned(sim, 9001, 'crypt_shambler', 'hollow_crypt', 'heroic', 0, 0);
    expect(mob.chargeEnabled).toBe(true);
    expect(mob.moveSpeed).toBe(8); // the heroic anti-kite floor the dash multiplies
    engage(mob, pid);

    const events = sim.tick() as any[];
    // The stun lands the SAME tick the charge fires (Onrush pairing), 0.5s, no DR.
    const stun = chargeStunOn(player);
    expect(stun).toBeTruthy();
    expect(stun!.name).toBe('Onrush');
    expect(stun!.duration).toBe(0.5);
    expect(stun!.kind).toBe('stun');
    // The announce mirrors the stomp "unleashes" line (localized client-side).
    expect(
      events.some((e) => e.type === 'log' && e.text === 'Crypt Shambler unleashes Onrush!'),
    ).toBe(true);
    expect(mob.mobChargeTargetId).toBe(pid);

    // Dash: 16yd to the arrive range at 3x8=24yd/s is under 0.8s. Base moveSpeed
    // (8yd/s) could cover at most 6.8yd in these 17 ticks, so arriving inside
    // melee range proves the 3x dash actually moved the mob.
    for (let i = 0; i < 16; i++) sim.tick();
    expect(dist2d(mob.pos, player.pos)).toBeLessThanOrEqual(MELEE_RANGE);
    expect(mob.mobChargeTargetId).toBeNull(); // dash ended on arrival
  });

  it('never triggers inside the 5yd minimum, and the cooldown is not consumed', () => {
    const sim = makeSim();
    const { pid, player } = addGmPlayer(sim, 3, 0);
    const mob = spawnTuned(sim, 9011, 'sanctum_boneguard', 'gravewyrm_sanctum', 'heroic', 0, 0);
    engage(mob, pid);

    for (let i = 0; i < 5; i++) sim.tick();
    expect(chargeStunOn(player)).toBeUndefined();
    expect(mob.mobChargeTargetId ?? null).toBeNull();

    // The charge was withheld, not spent: stepping out to 20yd fires it at once.
    teleport(sim, player, mob.pos.x + 20, mob.pos.z);
    sim.tick();
    expect(chargeStunOn(player)).toBeTruthy();
  });

  it('never triggers beyond the 30yd maximum; fires only once inside the band', () => {
    const sim = makeSim();
    const { pid, player } = addGmPlayer(sim, 40, 0);
    const mob = spawnTuned(sim, 9021, 'drowned_templeguard', 'drowned_temple', 'heroic', 0, 0);
    engage(mob, pid);

    // Chasing at 8yd/s the mob closes 0.4yd/tick: the first 10 ticks stay far
    // outside the band (>= 36yd) and must not charge.
    for (let i = 0; i < 10; i++) {
      sim.tick();
      expect(chargeStunOn(player), `tick ${i} at >30yd`).toBeUndefined();
    }
    // Keep chasing: the charge must fire on the tick the gap enters the band.
    let firedAt = -1;
    for (let i = 0; i < 100 && firedAt < 0; i++) {
      const before = dist2d(mob.pos, player.pos);
      sim.tick();
      if (chargeStunOn(player)) {
        firedAt = i;
        expect(before).toBeLessThanOrEqual(31); // one chase step above the band edge
        expect(before).toBeGreaterThanOrEqual(5);
      }
    }
    expect(firedAt).toBeGreaterThanOrEqual(0);
  });

  it('a NORMAL spawn of the same template never charges from 20yd', () => {
    const sim = makeSim();
    const { pid, player } = addGmPlayer(sim, 20, 0);
    const mob = spawnTuned(sim, 9031, 'crypt_shambler', 'hollow_crypt', 'normal', 0, 0);
    expect(mob.chargeEnabled).toBeUndefined();
    engage(mob, pid);

    // 3 seconds covers the whole approach through the 5..30 band into melee:
    // no stun, no dash state, ever.
    for (let i = 0; i < 60; i++) {
      const events = sim.tick() as any[];
      expect(chargeStunOn(player)).toBeUndefined();
      expect(mob.mobChargeTargetId ?? null).toBeNull();
      expect(events.some((e) => e.type === 'log' && String(e.text).includes('Onrush'))).toBe(false);
    }
  });
});

describe('charge module semantics (direct SimContext calls)', () => {
  function moduleSetup() {
    const sim = makeSim();
    const mob = spawnTuned(sim, 9101, 'crypt_shambler', 'hollow_crypt', 'heroic', 0, 0);
    const victim = createMob(9102, MOBS.forest_wolf, 5, { x: 20, y: 0, z: 0 }) as AnyEntity;
    (sim as any).addEntity(victim);
    engage(mob, victim.id);
    return { sim, mob, victim };
  }

  it('respects the 12s cooldown: no second charge within 12s, ready again after', () => {
    const { sim, mob, victim } = moduleSetup();
    const triggerTicks: number[] = [];
    for (let i = 0; i < 246; i++) {
      // Hold the kite range at exactly 20yd so only the cooldown gates refiring.
      teleport(sim, victim, mob.pos.x + 20, mob.pos.z);
      const dashing = updateMobChargeDash(sim.ctx, mob);
      if (!dashing) {
        tryStartMobCharge(sim.ctx, mob);
        if (mob.mobChargeTargetId != null) triggerTicks.push(i);
      }
    }
    expect(triggerTicks.length).toBe(2);
    expect(triggerTicks[0]).toBe(0); // opens READY: fires on the first engaged tick
    // 12s = 240 engaged ticks (the +2 window absorbs float drift on the 0.05 steps).
    expect(triggerTicks[1]).toBeGreaterThanOrEqual(240);
    expect(triggerTicks[1]).toBeLessThanOrEqual(242);
  });

  it('a stunned or rooted mob cannot start a charge', () => {
    const { sim, mob, victim } = moduleSetup();
    mob.auras.push(testStun(victim.id));
    tryStartMobCharge(sim.ctx, mob);
    expect(mob.mobChargeTargetId ?? null).toBeNull();
    expect(chargeStunOn(victim)).toBeUndefined();

    mob.auras = [testRoot(victim.id)];
    tryStartMobCharge(sim.ctx, mob);
    expect(mob.mobChargeTargetId ?? null).toBeNull();
    expect(chargeStunOn(victim)).toBeUndefined();

    // Freed, the same setup fires immediately: the gates above were the blockers.
    mob.auras = [];
    tryStartMobCharge(sim.ctx, mob);
    expect(mob.mobChargeTargetId).toBe(victim.id);
    expect(chargeStunOn(victim)).toBeTruthy();
  });

  it('a stun landing mid-dash ends the dash', () => {
    const { sim, mob, victim } = moduleSetup();
    tryStartMobCharge(sim.ctx, mob);
    expect(mob.mobChargeTargetId).toBe(victim.id);
    updateMobChargeDash(sim.ctx, mob);
    updateMobChargeDash(sim.ctx, mob);
    expect(mob.mobChargeTargetId).toBe(victim.id); // still in flight
    mob.auras.push(testStun(victim.id));
    const posAtStun = { ...mob.pos };
    updateMobChargeDash(sim.ctx, mob); // detects the lockout and ends the dash
    expect(mob.mobChargeTargetId ?? null).toBeNull();
    expect(updateMobChargeDash(sim.ctx, mob)).toBe(false); // no longer owns movement
    // Position evidence, not just the ownership flag: the mob stopped
    // advancing on the cancel tick and on the tick after it.
    expect(mob.pos).toEqual(posAtStun);
  });

  it('a full charge (trigger + dash to arrival) draws ZERO rng', () => {
    const { sim, mob, victim } = moduleSetup();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    tryStartMobCharge(sim.ctx, mob);
    expect(mob.mobChargeTargetId).toBe(victim.id);
    for (let i = 0; i < 60 && mob.mobChargeTargetId != null; i++) {
      updateMobChargeDash(sim.ctx, mob);
    }
    sim.rng.setObserver(null);
    expect(mob.mobChargeTargetId ?? null).toBeNull(); // the dash actually completed
    expect(dist2d(mob.pos, victim.pos)).toBeLessThanOrEqual(MELEE_RANGE);
    expect(draws).toBe(0);

    // And the no-op path for a mob without the stamp is rng-silent too (the
    // per-tick call every engaged mob makes on normal difficulty).
    const normal = spawnTuned(sim, 9103, 'crypt_shambler', 'hollow_crypt', 'normal', 0, 40);
    engage(normal, victim.id);
    sim.rng.setObserver(() => {
      draws += 1;
    });
    updateMobChargeDash(sim.ctx, normal);
    tryStartMobCharge(sim.ctx, normal);
    sim.rng.setObserver(null);
    expect(normal.mobChargeTargetId ?? null).toBeNull();
    expect(draws).toBe(0);
  });
});
