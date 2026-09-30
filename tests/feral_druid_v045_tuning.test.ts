// The v0.45 Wildfang tuning pass, one suite per change:
//   1. Slinkstrike reaches 0 to 25 yd
//   2. Scratch: a Cat Form sweep, 1 combo point and 1 Old Blood per landed hit
//   3. fall damage no longer breaks Stalk or the rogue stealths
//   4. Nature's Boon's Wildbloom arm is 50% stronger (Oakhide stays 25%)
//   5. Lynxblood and Red Haze are off the global cooldown
import { describe, expect, it } from 'vitest';
import { OLD_BLOOD_ID, OLD_BLOOD_STAGES } from '../src/sim/combat/druid_engines';
import {
  NATURES_BOON_ABILITIES,
  NATURES_BOON_ID,
  NATURES_BOON_POWER,
  NATURES_BOON_WILDBLOOM_POWER,
  naturesBoonPowerFor,
} from '../src/sim/combat/druid_natures_boon';
import { weaponSweepTargets } from '../src/sim/combat/druid_scratch';
import {
  FALL_SAFE_STEALTH_AURA_IDS,
  FALLING_DAMAGE_LABEL,
  fallDamageKeepsStealth,
  STALK_AURA_ID,
} from '../src/sim/combat/stealth_fall';
import { SPEC_BASELINES } from '../src/sim/content/spec_baselines';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AbilityEffect, Aura, Entity } from '../src/sim/types';

type Spec = 'balance' | 'feral' | 'restoration';

function rig(spec: Spec) {
  const sim = new Sim({ seed: 45, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

// biome-ignore lint/suspicious/noExplicitAny: the SimContext shape is internal to Sim.
function rawCtx(sim: Sim): any {
  return (sim as unknown as { ctx: unknown }).ctx;
}

function testAura(player: Entity, id: string, kind: Aura['kind']): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

let nextMobId = 9950;
function spawnMob(sim: Sim, dx: number, dz: number): Entity {
  const player = sim.player;
  const mob = createMob(nextMobId++, MOBS.forest_wolf, 20, {
    x: player.pos.x + dx,
    y: player.pos.y,
    z: player.pos.z + dz,
  });
  mob.templateId = 'forest_wolf';
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

/** Force every melee swing to land so the per-hit counts are exact. */
function alwaysLand(sim: Sim, run: () => void): void {
  // biome-ignore lint/suspicious/noExplicitAny: reaching the Rng behind SimContext.
  const rng = rawCtx(sim).rng as any;
  const realRoll = rng.next.bind(rng);
  // A high roll clears miss, dodge, parry, and block on the melee hit table
  // (the table walks up from 0), landing an ordinary or critical hit.
  rng.next = () => 0.999;
  try {
    run();
  } finally {
    rng.next = realRoll;
  }
}

function shiftIntoCat(sim: Sim): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('cat_form');
  for (let tick = 0; tick < 40; tick++) sim.tick();
  sim.player.resource = sim.player.maxResource;
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

describe('1. Slinkstrike reaches 0 to 25 yd', () => {
  it('authors the 0 to 25 yd band', () => {
    expect(ABILITIES.pounce.range).toBe(25);
    expect(ABILITIES.pounce.minRange).toBe(0);
  });

  it('stuns a target 20 yd away from stealth through the real cast', () => {
    const { sim, player } = rig('feral');
    player.auras.push(testAura(player, 'cat_form', 'form_cat'));
    player.auras.push(testAura(player, STALK_AURA_ID, 'stealth'));
    player.stealthed = true;
    const mob = spawnMob(sim, 0, 20);
    sim.targetEntity(mob.id);
    player.facing = 0;

    sim.castAbility('pounce');
    for (let tick = 0; tick < 4; tick++) sim.tick();

    expect(mob.auras.some((entry) => entry.kind === 'stun')).toBe(true);
    expect(player.comboPoints).toBe(1);
  });
});

describe('2. Scratch', () => {
  it('is a Cat Form builder every druid learns, with the Rendclaw damage profile and price', () => {
    const def: AbilityDef = ABILITIES.scratch;
    const claw: AbilityDef = ABILITIES.claw;
    expect(def).toBeDefined();
    expect(def.name).toBe('Scratch');
    expect(def.class).toBe('druid');
    expect(def.requiresForm).toBe('cat');
    expect(def.awardsCombo).toBe(1);
    // Baseline like Rendclaw: every druid, no spec gate, castable with no
    // target, and it lives in the spellbook (the class kit). Learned at 8,
    // the first ding past the early-curve cap, not Rendclaw's 5.
    expect(def.learnLevel).toBe(8);
    expect(def.specs).toBeUndefined();
    expect(def.requiresTarget).toBe(false);
    expect(CLASSES.druid.abilities).toContain('scratch');
    // Same cost and the same flat bonus at every rank, plus the sweep.
    expect(def.cost).toBe(claw.cost);
    const bonus = (effects: readonly AbilityEffect[]): (number | null)[] =>
      effects.map((eff) => (eff.type === 'weaponStrike' ? eff.bonus : null));
    expect(bonus(def.effects)).toEqual(bonus(claw.effects));
    expect(def.effects).toEqual([{ type: 'weaponStrike', bonus: 25, sweepRadius: 6 }]);
    expect(def.ranks?.map((r) => [r.level, r.cost, bonus(r.effects)])).toEqual(
      claw.ranks?.map((r) => [r.level, r.cost, bonus(r.effects)]),
    );
  });

  it("carries Rendclaw's Wildfang baseline damage row", () => {
    const feral = SPEC_BASELINES.druid?.feral;
    const row = (id: string) => feral?.ability?.find((entry) => entry.ability === id);
    expect(row('claw')?.dmgPct).toBe(0.15);
    expect(row('scratch')).toEqual({ ...row('claw'), ability: 'scratch' });
  });

  it('collects only live hostiles inside the 6 yd sweep', () => {
    const { sim, player } = rig('feral');
    const near = spawnMob(sim, 2, 0);
    const edge = spawnMob(sim, 0, 5.5);
    const far = spawnMob(sim, 0, 7.5);
    const hit = weaponSweepTargets(rawCtx(sim), player, 6).map((entity) => entity.id);
    expect(hit).toContain(near.id);
    expect(hit).toContain(edge.id);
    expect(hit).not.toContain(far.id);
  });

  it('awards 1 combo point and 1 Old Blood per landed hit, capped at 3 Old Blood', () => {
    const { sim, player } = rig('feral');
    shiftIntoCat(sim);
    const mobs = [spawnMob(sim, 2, 0), spawnMob(sim, -2, 0), spawnMob(sim, 0, 2)];
    const far = spawnMob(sim, 0, 20);
    const hpBefore = mobs.map((mob) => mob.hp);

    alwaysLand(sim, () => {
      sim.castAbility('scratch');
      sim.tick();
    });

    mobs.forEach((mob, i) => {
      expect(mob.hp).toBeLessThan(hpBefore[i]);
    });
    expect(far.hp).toBe(far.maxHp);
    expect(player.comboPoints).toBe(3);
    expect(stacks(player, OLD_BLOOD_ID)).toBe(OLD_BLOOD_STAGES);

    // A fourth and fifth enemy push the shared pool to its 5 cap; Old Blood
    // stays at its 3-stage cap.
    spawnMob(sim, 1, 1);
    spawnMob(sim, -1, -1);
    player.comboPoints = 0;
    player.resource = player.maxResource;
    for (let tick = 0; tick < 40; tick++) sim.tick();
    alwaysLand(sim, () => {
      sim.castAbility('scratch');
      sim.tick();
    });
    expect(player.comboPoints).toBe(5);
    expect(stacks(player, OLD_BLOOD_ID)).toBe(OLD_BLOOD_STAGES);
  });

  it('pays combo points but no Old Blood outside Wildfang', () => {
    const { sim, player } = rig('balance');
    shiftIntoCat(sim);
    spawnMob(sim, 2, 0);
    spawnMob(sim, -2, 0);
    alwaysLand(sim, () => {
      sim.castAbility('scratch');
      sim.tick();
    });
    expect(player.comboPoints).toBe(2);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);
  });

  it('goes off with nobody in reach: energy spent, no combo, no auto-attack', () => {
    const { sim, player } = rig('feral');
    shiftIntoCat(sim);
    const before = player.resource;
    const events = (() => {
      sim.castAbility('scratch');
      return sim.tick();
    })();
    expect(player.resource).toBeLessThan(before);
    expect(player.comboPoints).toBe(0);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(player.autoAttack).toBe(false);
  });

  it('never turns on auto-attack, even when it lands', () => {
    const { sim, player } = rig('feral');
    shiftIntoCat(sim);
    spawnMob(sim, 2, 0);
    alwaysLand(sim, () => {
      sim.castAbility('scratch');
      sim.tick();
    });
    expect(player.comboPoints).toBe(1);
    expect(player.autoAttack).toBe(false);
  });

  it('spots a stealthed enemy in the sweep even when the swing misses', () => {
    const { sim, player } = rig('feral');
    shiftIntoCat(sim);
    const lurker = spawnMob(sim, 2, 0);
    lurker.auras.push(testAura(lurker, 'stealth', 'stealth'));
    lurker.stealthed = true;
    const outside = spawnMob(sim, 0, 12);
    outside.auras.push(testAura(outside, 'stealth', 'stealth'));
    outside.stealthed = true;

    // A roll of 0 lands every swing on the bottom of the hit table: a miss.
    // biome-ignore lint/suspicious/noExplicitAny: reaching the Rng behind SimContext.
    const rng = rawCtx(sim).rng as any;
    const realRoll = rng.next.bind(rng);
    rng.next = () => 0;
    try {
      sim.castAbility('scratch');
      sim.tick();
    } finally {
      rng.next = realRoll;
    }

    expect(lurker.hp).toBe(lurker.maxHp);
    expect(lurker.auras.some((aura) => aura.kind === 'stealth')).toBe(false);
    expect(lurker.stealthed).toBe(false);
    // Outside the 6 yd sweep nothing is spotted.
    expect(outside.auras.some((aura) => aura.kind === 'stealth')).toBe(true);
    expect(outside.stealthed).toBe(true);
  });

  it('refuses outside Cat Form and bills nothing', () => {
    const { sim, player } = rig('feral');
    const mob = spawnMob(sim, 2, 0);
    const before = player.resource;
    sim.castAbility('scratch');
    sim.tick();
    expect(mob.hp).toBe(mob.maxHp);
    expect(player.comboPoints).toBe(0);
    expect(player.resource).toBeGreaterThanOrEqual(before);
  });
});

describe('3. A fall keeps Stalk and the rogue stealths', () => {
  it('only a null-source Falling hit on a Stalk aura keeps the stealth', () => {
    const { player } = rig('feral');
    player.auras.push(testAura(player, STALK_AURA_ID, 'stealth'));
    expect(fallDamageKeepsStealth(null, player, FALLING_DAMAGE_LABEL)).toBe(true);
    // Any other label, or a real attacker, still breaks it.
    expect(fallDamageKeepsStealth(null, player, 'Fatigue')).toBe(false);
    expect(fallDamageKeepsStealth(player, player, FALLING_DAMAGE_LABEL)).toBe(false);
  });

  it('covers exactly Stalk, Duskveil, and Smokefade', () => {
    const { player } = rig('feral');
    expect([...FALL_SAFE_STEALTH_AURA_IDS].sort()).toEqual(['prowl', 'stealth', 'vanish']);
    // The ids are the real stealth abilities' own ids (the bare selfBuff id).
    expect(ABILITIES.stealth.name).toBe('Duskveil');
    expect(ABILITIES.vanish.name).toBe('Smokefade');
    for (const id of ['stealth', 'vanish']) {
      const rogue = { ...player, auras: [testAura(player, id, 'stealth')] };
      expect(fallDamageKeepsStealth(null, rogue, FALLING_DAMAGE_LABEL), id).toBe(true);
    }
    // Every other stealth-kind aura keeps the old rule and breaks on a fall.
    for (const id of ['greater_invisibility', 'invisibility']) {
      const other = { ...player, auras: [testAura(player, id, 'stealth')] };
      expect(fallDamageKeepsStealth(null, other, FALLING_DAMAGE_LABEL), id).toBe(false);
    }
  });

  it("a real rogue's Duskveil survives fall damage through the damage funnel", () => {
    const sim = new Sim({ seed: 45, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    const rogue = sim.player;
    sim.castAbility('stealth');
    for (let tick = 0; tick < 5; tick++) sim.tick();
    expect(rogue.auras.find((aura) => aura.kind === 'stealth')?.id).toBe('stealth');

    rawCtx(sim).dealDamage(null, rogue, 50, false, 'physical', FALLING_DAMAGE_LABEL, 'hit', true);
    expect(rogue.hp).toBeLessThan(rogue.maxHp);
    expect(rogue.stealthed).toBe(true);

    const mob = spawnMob(sim, 2, 0);
    rawCtx(sim).dealDamage(mob, rogue, 50, false, 'physical', 'Bite', 'hit', true);
    expect(rogue.stealthed).toBe(false);
  });

  it('a real Stalk survives fall damage through the damage funnel', () => {
    const { sim, player } = rig('feral');
    sim.castAbility('prowl');
    for (let tick = 0; tick < 5; tick++) sim.tick();
    const stalk = player.auras.find((aura) => aura.kind === 'stealth');
    expect(stalk?.id).toBe(STALK_AURA_ID);

    rawCtx(sim).dealDamage(null, player, 50, false, 'physical', FALLING_DAMAGE_LABEL, 'hit', true);
    expect(player.hp).toBeLessThan(player.maxHp);
    expect(player.auras.some((aura) => aura.kind === 'stealth')).toBe(true);
    expect(player.stealthed).toBe(true);

    // Any other damage still breaks it.
    const mob = spawnMob(sim, 2, 0);
    rawCtx(sim).dealDamage(mob, player, 50, false, 'physical', 'Bite', 'hit', true);
    expect(player.auras.some((aura) => aura.kind === 'stealth')).toBe(false);
    expect(player.stealthed).toBe(false);
  });
});

describe("4. Nature's Boon: Wildbloom 50% stronger", () => {
  it('reads 1.5 for an armed Wildbloom and 1.25 for an armed Oakhide', () => {
    expect(NATURES_BOON_WILDBLOOM_POWER).toBe(1.5);
    expect(NATURES_BOON_POWER).toBe(1.25);
    const window = {
      id: NATURES_BOON_ID,
      kind: 'next_cast_free',
      empowerAbilities: [...NATURES_BOON_ABILITIES],
    };
    const bear = { kind: 'form_bear' };
    expect(naturesBoonPowerFor([window], 'rejuvenation')).toBe(1.5);
    expect(naturesBoonPowerFor([window, bear], 'barkskin')).toBe(1.25);
    // No window, no bonus.
    expect(naturesBoonPowerFor([], 'rejuvenation')).toBe(1);
  });
});

describe('5. Lynxblood and Red Haze are off the global cooldown', () => {
  it('authors both offGcd', () => {
    expect(ABILITIES.tigers_fury.offGcd).toBe(true);
    expect(ABILITIES.berserk.offGcd).toBe(true);
  });

  it('Lynxblood starts no global cooldown and never waits on one', () => {
    const { sim, player } = rig('feral');
    shiftIntoCat(sim);
    player.resource = 0;
    expect(player.gcdRemaining).toBe(0);
    sim.castAbility('tigers_fury');
    expect(player.gcdRemaining).toBe(0);
    expect(player.auras.some((aura) => aura.id === 'tigers_fury')).toBe(true);
    // Pressed while another GCD is running, it still fires.
    const fresh = rig('feral');
    shiftIntoCat(fresh.sim);
    fresh.player.gcdRemaining = 1;
    fresh.sim.castAbility('tigers_fury');
    expect(fresh.player.auras.some((aura) => aura.id === 'tigers_fury')).toBe(true);
  });
});
