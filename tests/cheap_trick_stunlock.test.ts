import { afterEach, describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, GCD, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Cheap Trick (rogue row 11) lets Gut Punch skip Duskveil. Player stuns carry
// no PvP diminishing returns (src/sim/stun_dr.ts), so with no cooldown a
// Skulduggery rogue chained the 4 sec stun as fast as Energy allowed: Gut
// Punch between Low Blows, topped up by Quickened Blood, Ghostfoot Gambit and
// the Gloam veil, held a passive player stunned ~98% of a 120 sec duel. The
// talent now carries a 10 sec Gut Punch cooldown (stun length unchanged) and,
// with the cooldown as the limiter, Gut Punch costs no Energy under it.
//
// This suite runs that stunlock rotation in a REAL duel (two players, the live
// cast gates, the live energy economy) and pins the measured stun uptime and
// the longest unbroken chain, before and after the cooldown.

const DUEL_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const FIGHT_SECONDS = 120;
const TICKS_PER_SECOND = Math.round(1 / DT);

// The reported stunlock build's rows 11 to 20 (rows 5 and 8 do not feed the chain).
const STUNLOCK_ROWS = {
  11: 'rog_r11_cheap_trick',
  14: 'rog_r14_dusk_economy',
  17: 'rog_r17_ghostfoot_gambit',
  20: 'rog_r20_deathmark',
};

type AbilityMod = { ability: string; cooldownFlat?: number; costPct?: number };

function cheapTrickOption() {
  for (const row of CHOICE_ROWS.rogue.rows) {
    for (const option of row.options) if (option.id === 'rog_r11_cheap_trick') return option;
  }
  throw new Error('rog_r11_cheap_trick missing from the rogue choice rows');
}

function cheapTrickGutPunchMod(): AbilityMod {
  const mods = (cheapTrickOption().effect as { ability?: AbilityMod[] }).ability ?? [];
  const mod = mods.find((m) => m.ability === 'cheap_shot');
  if (!mod) throw new Error('Cheap Trick no longer modifies Gut Punch');
  return mod;
}

// The pre-fix arm strips the cooldown and the free cost off the live row option
// for one run, so the baseline exercises the exact talent bake the shipped build
// used to make.
const originalMod = { ...cheapTrickGutPunchMod() };
afterEach(() => {
  const mod = cheapTrickGutPunchMod();
  mod.cooldownFlat = originalMod.cooldownFlat;
  mod.costPct = originalMod.costPct;
});

function resolvedGutPunch(rows: Record<number, string>) {
  const mods = computeTalentModifiers('rogue', { spec: null, rows }, 20);
  const known = abilitiesKnownAt('rogue', 20, mods).find((k) => k.def.id === 'cheap_shot');
  if (!known) throw new Error('cheap_shot missing from the level 20 rogue kit');
  return known;
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(e);
}

function stunRemaining(e: Entity): number {
  let best = 0;
  for (const a of e.auras) if (a.kind === 'stun' && a.remaining > best) best = a.remaining;
  return best;
}

interface StunlockResult {
  uptime: number;
  longestChainSeconds: number;
  gutPunches: number;
}

function runStunlock(): StunlockResult {
  const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true, world: DUEL_WORLD });
  const a = sim.addPlayer('rogue', 'Rogue', { autoEquip: true });
  const b = sim.addPlayer('warrior', 'Dummy', { autoEquip: true });
  sim.setPlayerLevel(20, a);
  sim.setPlayerLevel(20, b);
  expect(sim.applyTalents({ spec: 'subtlety', rows: STUNLOCK_ROWS }, a)).toBe(true);
  const rogue = sim.entities.get(a);
  const target = sim.entities.get(b);
  if (!rogue || !target) throw new Error('duel players were not spawned');
  // facing 0 looks down +z, so the dummy stands 2 yd straight ahead in melee.
  teleport(sim, rogue, 0, -40);
  teleport(sim, target, 0, -38);
  rogue.facing = 0;

  sim.duelRequest(b, a);
  sim.duelAccept(b);
  const duels = (sim as unknown as { duels: Map<number, { state: string }> }).duels;
  for (let i = 0; i < 10 * TICKS_PER_SECOND && duels.get(a)?.state !== 'active'; i++) sim.tick();
  expect(duels.get(a)?.state).toBe('active');

  sim.targetEntity(b, a);
  rogue.resource = rogue.maxResource;
  sim.castAbility('stealth', a);
  sim.tick();

  // What a Gut Punch costs this build (the energy cooldowns fire only to cover it).
  const gutPunchCost = resolvedGutPunch(STUNLOCK_ROWS).cost;
  let gutPunches = 0;
  let stunnedTicks = 0;
  let chain = 0;
  let longestChain = 0;
  const totalTicks = FIGHT_SECONDS * TICKS_PER_SECOND;
  for (let t = 0; t < totalTicks; t++) {
    // A passive punching bag: never dies, never fights back.
    target.hp = target.maxHp;
    rogue.autoAttack = false;
    rogue.facing = 0;

    const remaining = stunRemaining(target);
    if (remaining <= DT * 1.5) {
      // Recast only as the stun ends: Low Blow whenever it is ready, else Gut
      // Punch, and spend the energy cooldowns only when short on Energy.
      const cdLowBlow = rogue.cooldowns.get('kidney_shot') ?? 0;
      const cdGutPunch = rogue.cooldowns.get('cheap_shot') ?? 0;
      if (cdLowBlow <= 0 && rogue.comboPoints >= 1) {
        sim.castAbility('kidney_shot', a);
      } else if (cdGutPunch <= 0) {
        const before = rogue.resource;
        if (before < gutPunchCost) {
          sim.castAbility('adrenaline_rush', a);
          if (rogue.resource < gutPunchCost) sim.castAbility('evasion', a);
          if (rogue.resource < gutPunchCost) sim.castAbility('vanish', a);
          // Smokefade drops the current target; pick the dummy straight back up.
          sim.targetEntity(b, a);
        }
        sim.castAbility('cheap_shot', a);
        if (stunRemaining(target) > remaining) gutPunches++;
      }
    } else if (remaining > GCD + 0.25 && rogue.resource >= 35 + gutPunchCost) {
      // While the target is held, build combo points with Red Ribbon only if
      // the next Gut Punch stays affordable.
      sim.castAbility('hemorrhage', a);
    }

    sim.tick();
    if (stunRemaining(target) > 0) {
      stunnedTicks++;
      chain++;
      if (chain > longestChain) longestChain = chain;
    } else {
      chain = 0;
    }
  }
  return {
    uptime: stunnedTicks / totalTicks,
    longestChainSeconds: longestChain / TICKS_PER_SECOND,
    gutPunches,
  };
}

describe('Cheap Trick Gut Punch cooldown', () => {
  it('resolves a free Gut Punch on a 10 sec cooldown only with Cheap Trick, stun unchanged', () => {
    const talented = resolvedGutPunch({ 11: 'rog_r11_cheap_trick' });
    expect(talented.cooldown).toBe(10);
    expect(talented.cost).toBe(0);
    expect(talented.ignoreStealthRequirement).toBe(true);
    expect(talented.effects).toContainEqual({ type: 'stun', duration: 4 });

    const plain = resolvedGutPunch({});
    expect(plain.cooldown).toBe(0);
    expect(plain.cost).toBe(60);
    expect(plain.effects).toContainEqual({ type: 'stun', duration: 4 });
  });

  it('reproduces the stunlock without the cooldown (the pre-fix build)', () => {
    const mod = cheapTrickGutPunchMod();
    mod.cooldownFlat = undefined;
    mod.costPct = undefined;
    const before = runStunlock();
    // Measured 98% stunned with a 70+ sec unbroken chain on this seed.
    expect(before.uptime).toBeGreaterThan(0.9);
    expect(before.longestChainSeconds).toBeGreaterThan(60);
  });

  it('breaks the stunlock with the cooldown: bounded uptime and real gaps', () => {
    const after = runStunlock();
    // Gut Punch every 10 sec plus Low Blow every 20 sec is at most 4 + 4 + 6 = 14
    // stunned seconds per 20 sec cycle (70%), with a guaranteed gap each cycle.
    // Measured 61% stunned, longest chain 9.9 sec, on this seed: a Gut Punch the
    // target dodges or parries still spends the cooldown, so real fights sit below 70%.
    expect(after.uptime).toBeLessThanOrEqual(0.72);
    expect(after.longestChainSeconds).toBeLessThanOrEqual(14.5);
    // One Gut Punch per cooldown window at most over the fight.
    expect(after.gutPunches).toBeLessThanOrEqual(FIGHT_SECONDS / 10 + 1);
  });
});
