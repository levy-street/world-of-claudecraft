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
  gutPunchCastTicks: number[];
  lowBlowCastTicks: number[];
}

function duelRig() {
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
  return { sim, a, b, rogue, target };
}

function runStunlock(): StunlockResult {
  const { sim, a, b, rogue, target } = duelRig();
  rogue.resource = rogue.maxResource;
  sim.castAbility('stealth', a);
  sim.tick();

  // What a Gut Punch costs this build (the energy cooldowns fire only to cover it).
  const gutPunchCost = resolvedGutPunch(STUNLOCK_ROWS).cost;
  let gutPunches = 0;
  let stunnedTicks = 0;
  let chain = 0;
  let longestChain = 0;
  const gutPunchCastTicks: number[] = [];
  const lowBlowCastTicks: number[] = [];
  const totalTicks = FIGHT_SECONDS * TICKS_PER_SECOND;
  for (let t = 0; t < totalTicks; t++) {
    // A passive punching bag: never dies, never fights back.
    target.hp = target.maxHp;
    rogue.autoAttack = false;
    rogue.facing = 0;
    const gutPunchCooldownBefore = rogue.cooldowns.get('cheap_shot') ?? 0;
    const lowBlowCooldownBefore = rogue.cooldowns.get('kidney_shot') ?? 0;

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
    // Track committed casts, including misses and GCD-queued casts, by their
    // newly armed cooldown rather than by whether the target gained a stun.
    if ((rogue.cooldowns.get('cheap_shot') ?? 0) > gutPunchCooldownBefore) {
      gutPunchCastTicks.push(t);
    }
    if ((rogue.cooldowns.get('kidney_shot') ?? 0) > lowBlowCooldownBefore) {
      lowBlowCastTicks.push(t);
    }
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
    gutPunchCastTicks,
    lowBlowCastTicks,
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
    expect(plain.cost).toBe(50);
    expect(plain.ignoreStealthRequirement).not.toBe(true);
    expect(plain.effects).toContainEqual({ type: 'stun', duration: 4 });
  });

  it.each(['open', 'stealth', 'gloam'] as const)(
    'casts at zero Energy but cannot bypass the cooldown with %s access',
    (access) => {
      const { sim, a, b, rogue, target } = duelRig();
      rogue.resource = 0;
      sim.castAbility('cheap_shot', a);
      expect(rogue.cooldowns.get('cheap_shot')).toBe(10);
      expect(rogue.resource).toBe(0);
      expect(stunRemaining(target)).toBe(4);
      expect(rogue.comboPoints).toBe(2);

      for (let i = 0; i < Math.ceil(GCD / DT) + 1; i++) {
        rogue.autoAttack = false;
        sim.tick();
      }
      if (access === 'stealth') {
        sim.castAbility('vanish', a);
        sim.targetEntity(b, a);
        expect(rogue.auras.some((aura) => aura.kind === 'stealth')).toBe(true);
      } else if (access === 'gloam') {
        rogue.auras = rogue.auras.filter((aura) => aura.id !== 'gloam');
        rogue.auras.push({
          id: 'gloam',
          name: 'Gloam',
          kind: 'gloam',
          remaining: 60,
          duration: 60,
          value: 0,
          sourceId: rogue.id,
          school: 'physical',
          stacks: 3,
        });
      }
      const remaining = stunRemaining(target);
      const cooldown = rogue.cooldowns.get('cheap_shot');
      expect(cooldown).toBeGreaterThan(0);
      rogue.resource = 0;
      sim.castAbility('cheap_shot', a);
      expect(rogue.cooldowns.get('cheap_shot')).toBe(cooldown);
      expect(stunRemaining(target)).toBe(remaining);
      expect(rogue.comboPoints).toBe(2);
      if (access === 'gloam') {
        expect(rogue.auras.find((aura) => aura.id === 'gloam')?.stacks).toBe(3);
      }

      for (
        let tick = 0;
        tick < 10 * TICKS_PER_SECOND && rogue.cooldowns.has('cheap_shot');
        tick++
      ) {
        rogue.autoAttack = false;
        sim.tick();
      }
      expect(rogue.cooldowns.has('cheap_shot')).toBe(false);
      rogue.resource = 0;
      sim.castAbility('cheap_shot', a);
      expect(rogue.cooldowns.get('cheap_shot')).toBe(10);
      expect(rogue.resource).toBe(0);
      expect(stunRemaining(target)).toBe(4);
      expect(rogue.comboPoints).toBe(4);
      if (access === 'gloam') {
        expect(rogue.auras.some((aura) => aura.id === 'gloam')).toBe(false);
        expect(rogue.auras.some((aura) => aura.id === 'veilstrike')).toBe(true);
      }
    },
  );

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
    // The accepted base has a SEVEN-second five-point Low Blow (2 + 5),
    // rather than the contributor branch's six seconds (1 + 5). Pin that
    // independent premise before using the 4 + 7 + 4 = 15 sec control budget.
    const mods = computeTalentModifiers('rogue', { spec: 'subtlety', rows: STUNLOCK_ROWS }, 20);
    const lowBlow = abilitiesKnownAt('rogue', 20, mods).find((k) => k.def.id === 'kidney_shot');
    expect(lowBlow?.cooldown).toBe(20);
    expect(lowBlow?.effects).toContainEqual({ type: 'finisherStun', base: 2, perCombo: 1 });
    // Over this 120 sec fight: at most twelve 4 sec Gut Punches and six
    // 7 sec Low Blows cover 90 sec (75%). No chain can bridge the remaining
    // gap before Low Blow returns. Allow one observation tick on chain length.
    // Measured here: 73.4167% uptime and a 14.85 sec longest chain.
    expect(after.uptime).toBeLessThanOrEqual(0.75);
    expect(after.longestChainSeconds).toBeLessThanOrEqual(15 + DT);
    expect(after.gutPunchCastTicks.length).toBeGreaterThan(0);
    expect(after.gutPunchCastTicks.length).toBeLessThanOrEqual(FIGHT_SECONDS / 10);
    expect(after.lowBlowCastTicks.length).toBeGreaterThan(0);
    expect(after.lowBlowCastTicks.length).toBeLessThanOrEqual(FIGHT_SECONDS / 20);
    for (const [ticks, seconds] of [
      [after.gutPunchCastTicks, 10],
      [after.lowBlowCastTicks, 20],
    ] as const) {
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(seconds * TICKS_PER_SECOND);
      }
    }
    // One Gut Punch per cooldown window at most over the fight.
    expect(after.gutPunches).toBeLessThanOrEqual(FIGHT_SECONDS / 10 + 1);
  });
});
