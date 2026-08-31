// Shared rotation harness for the Chronomancy balance family
// (tests/chronomancy_balance_targets.test.ts, chronomancy_heal_parity.test.ts,
// chronomancy_cascade_aoe.test.ts; split from the single chronomancy_balance
// suite 2026-08-13 so the three describe-body measurement blocks stop sharing
// one file's wall clock). Fixtures and the policy runner moved here verbatim;
// the measurement blocks and their assertions live with their describes.
import { aetherSurgeStacks } from '../../src/sim/combat/chronomancy';
import { hasFreeCostFor } from '../../src/sim/combat/empower_next';
import { MOBS } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import { Sim } from '../../src/sim/sim';
import type { Entity, SimEvent } from '../../src/sim/types';
import { EMPTY_TEST_WORLD } from '../sim_shared';
import { expectDefined } from './defined';
import { placePlayerInOpenField } from './open_field';

export type Spec = 'arcane' | 'fire' | 'frost';

function makeMage(spec: Spec, level = 20, seed = 2) {
  // Seed 2 for the shared fixtures since the v0.32.0 merge (the expansion's
  // construction-time draws move the sampled rotations; same reason this
  // file previously hopped 41 to 1). The DPS-gap floor deliberately
  // does NOT ride one seed: it takes the min over several.
  // EMPTY_TEST_WORLD (no camps/npcs/ground objects): this harness measures a
  // bare mage against a dummy it spawns itself, so the ambient overworld mob
  // population is pure overhead, and worse, noise: any full-world change
  // (terrain, content, or otherwise) forks the shared rng stream through
  // ambient mob AI over the harness's long (up to 200s / 4000-tick) runs,
  // even though nothing here targets, spawns from, or asserts on ambient
  // content. Same trim already applied to tests/chronomancy.test.ts,
  // chronomancy_surge.test.ts, and chronomancy_buffs.test.ts.
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(level);
  placePlayerInOpenField(sim);
  sim.setSpec(spec);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addDummy(sim: Sim, dist = 6): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

function addAlly(sim: Sim): Entity {
  const p = sim.player;
  const id = sim.addPlayer('warrior', 'Tanque');
  const ally = expectDefined(sim.entities.get(id));
  ally.pos.x = p.pos.x + 4;
  ally.pos.z = p.pos.z;
  ally.maxHp = 1_000_000; // large: Echo heals never clamp (raw throughput)
  return ally;
}

export function free(p: Entity): boolean {
  const q = p as unknown as { castingAbility: string | null; gcdRemaining: number };
  return q.castingAbility == null && q.gcdRemaining <= 1e-6;
}

// A rotation policy returns the next {id, targetId} to cast when the player is
// free, or null to idle. Cost/OOM are checked by the runner.
export type Policy = (
  p: Entity,
  dummy: Entity,
  ally: Entity,
  tSec: number,
) => { id: string; targetId: number } | null;

export interface RunResult {
  oom: number; // seconds to OOM (Infinity if it survived the cap)
  dps: number; // dummy damage / active time
  echoHps: number; // effective Temporal Echo healing on the ally / active time
  netManaPerSec: number;
  seconds: number;
}

// Drive a policy from full mana until it cannot afford its next intended cast
// (OOM) or the cap elapses. The ally is pinned to 1 hp each tick so every Echo
// heal is fully EFFECTIVE (raw offensive HPS, zero overheal by construction).
export function runRotation(
  spec: Spec,
  policy: Policy,
  capSec: number,
  pinAllyLow: boolean,
  seed = 2,
): RunResult {
  const { sim, p } = makeMage(spec, 20, seed);
  const dummy = addDummy(sim);
  const ally = addAlly(sim);
  const mana0 = p.resource;
  const gearHitBonus = p.hitBonus;
  let damage = 0;
  let echoHeal = 0;
  let oomTick = -1;
  const ticks = Math.round(capSec * 20);
  for (let i = 0; i < ticks; i++) {
    if (pinAllyLow) ally.hp = 1;
    if (free(p)) {
      const next = policy(p, dummy, ally, i / 20);
      if (next) {
        // The Aether Surge free-cast proc covers the charged cost (consumed at
        // completion), so mirror the engine's affordability gate: free => 0.
        const cost = hasFreeCostFor(p, next.id) ? 0 : (sim.resolvedAbility(next.id)?.cost ?? 0);
        if (p.resource < cost) {
          oomTick = i;
          break;
        }
        // The owner-derived bands in this family were measured before an INSTANT
        // hostile spell took a resist roll. Hit-cap exactly those casts so the
        // harness keeps measuring rotation throughput under the same avoidance
        // profile; projectile spells keep the resist roll the bands were built on.
        p.hitBonus = sim.resolvedAbility(next.id)?.def.projectile === false ? 1 : gearHitBonus;
        sim.targetEntity(next.targetId);
        sim.castAbility(next.id);
      }
    }
    const evs: SimEvent[] = sim.tick();
    for (const e of evs) {
      if (e.type === 'damage' && e.sourceId === p.id && e.targetId === dummy.id) damage += e.amount;
      if (
        e.type === 'heal2' &&
        e.sourceId === p.id &&
        e.targetId === ally.id &&
        e.ability === 'Temporal Echo'
      )
        echoHeal += e.amount;
    }
  }
  const oom = oomTick < 0 ? Infinity : oomTick / 20;
  const active = oomTick < 0 ? capSec : oomTick / 20;
  return {
    oom,
    dps: damage / active,
    echoHps: echoHeal / active,
    netManaPerSec: (mana0 - p.resource) / active,
    seconds: active,
  };
}

// Keep Temporal Echo riding the ally (recast when it is missing/expired).
function needsEcho(ally: Entity): boolean {
  return !ally.auras.some((a) => a.id === 'temporal_echo');
}

// Choose the next Arcane spender: hover at few charges (build to 3, dump with
// Aether Darts). This is the pure offensive damage loop.
function spender(p: Entity, dummy: Entity): { id: string; targetId: number } {
  return aetherSurgeStacks(p) >= 3
    ? { id: 'arcane_missiles', targetId: dummy.id }
    : { id: 'arcane_surge', targetId: dummy.id };
}

// Conservative OFFENSIVE rotation: just the Arcane damage loop (Oleada + Dardos).
// The "how long can I sustain my damage" longevity number.
export const conservativeOffensive: Policy = (p, dummy) => spender(p, dummy);

// The same loop but KEEPING Temporal Echo up, so the offensive heal actually
// flows (used to read the Echo HPS the rotation delivers).
export const conservativeEcho: Policy = (p, dummy, ally) =>
  needsEcho(ally) ? { id: 'temporal_echo', targetId: ally.id } : spender(p, dummy);

// Conservative WITH occasional reactive heals: Echo up plus a Temporal Mend or
// Barrier roughly every 10s (alternating), on top of the damage loop.
export function conservativeReactive(): Policy {
  let lastHealAt = -100;
  return (p, dummy, ally, t) => {
    if (needsEcho(ally)) return { id: 'temporal_echo', targetId: ally.id };
    if (t - lastHealAt >= 18) {
      lastHealAt = t;
      return {
        id: Math.round(t / 18) % 2 === 0 ? 'temporal_barrier' : 'temporal_mend',
        targetId: ally.id,
      };
    }
    return spender(p, dummy);
  };
}

// Emergency: spam Aether Surge; charges climb to 4 and HOLD, each cast paying the
// full 4-charge mana wall. Pure burst, no upkeep.
export const emergency: Policy = (_p, dummy) => ({ id: 'arcane_surge', targetId: dummy.id });

// A DPS spec spamming its main filler at the dummy (mana natural), the DPS and
// longevity baseline.
export function nukeSpam(id: string): Policy {
  return (_p, dummy) => ({ id, targetId: dummy.id });
}

// Fire's sustained-rotation proxy: spend a Hot Streak on a free Pyroblast,
// otherwise Fireball (Ignite mastery rides along under the fire spec). A fairer
// Piro baseline than plain Fireball spam, which ignores the fire kit.
export const fireRotation: Policy = (p, dummy) => ({
  id: p.auras.some((a) => a.id === 'hot_streak') ? 'pyroblast' : 'fireball',
  targetId: dummy.id,
});
