// Balance regression guard, derived from the spell-balance framework
// (scripts/balance_report.mjs + scripts/dummy_sim.mjs). The framework's core rule
// is that a damaging NUKE's base damage should be roughly PROPORTIONAL to its cast
// time, so spamming any nuke yields comparable DPS and each spell's niche comes
// from its secondary effects (range / school / instant / DoT) rather than one
// being strictly better. A long-cast nuke earns a small burst premium.
//
// This pins the two outliers the framework caught and fixed (Pyroblast, Starfire)
// so a future damage edit cannot quietly make a slow nuke worthless again.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { GCD, MAX_LEVEL } from '../src/sim/types';

// Base damage per second of occupancy (avg hit / effective cast), ignoring Spell
// Power and crit (which scale every nuke about equally). The pure proportionality
// signal.
// The mage DPS kit is spec-gated since Chronomancy: resolve mage nukes under a
// fire-spec build (fire keeps every nuke this file compares).
const FIRE_MODS = computeTalentModifiers('mage', {
  ...emptyAllocation(),
  spec: 'fire',
} as never);
const HOLY_PALADIN_MODS = computeTalentModifiers('paladin', {
  ...emptyAllocation(),
  spec: 'holy',
} as never);

function nukeBaseDps(cls: PlayerClass, id: string): number {
  const mods = cls === 'mage' ? FIRE_MODS : undefined;
  const k = abilitiesKnownAt(cls, MAX_LEVEL, mods).find((a) => a.def.id === id)!;
  const dd = k.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
  const avg = (dd.min + dd.max) / 2;
  return avg / Math.max(k.castTime, GCD);
}

function averageHealing(known: KnownAbility): number {
  let total = 0;
  for (const effect of known.effects) {
    if (effect.type === 'heal') total += (effect.min + effect.max) / 2;
    if (effect.type === 'hot') total += effect.total;
  }
  return total;
}

function manaPerAverageHeal(
  cls: PlayerClass,
  id: string,
  mods?: ReturnType<typeof computeTalentModifiers>,
): number {
  const known = abilitiesKnownAt(cls, MAX_LEVEL, mods).find((a) => a.def.id === id);
  if (!known) throw new Error(`${cls} is missing ${id}`);
  return known.cost / averageHealing(known);
}

describe('nuke damage is proportional to cast time (the balance framework rule)', () => {
  it('Pyroblast (6s) is a hard-hitting nuke, not weaker per-second than Frostbolt', () => {
    const ratio = nukeBaseDps('mage', 'pyroblast') / nukeBaseDps('mage', 'frostbolt');
    // comparable to the filler, with up to a ~35% burst premium for the long,
    // interruptible, mana-hungry cast - and never the < 0.6 it used to be.
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.4);
  });

  it('Skyfall (3s) at least matches Wildbolt (shorter cast) per second', () => {
    // Only the floor survives the Balance rework (owner ruling 2026-08-09).
    // Skyfall is the spec engine now: each Moonwing cast builds Moontide and
    // the button transforms into Sunwake at 3, so its base is deliberately
    // super-proportional (~2.5x Wildbolt's per-second base; spell power
    // compresses the real ratio toward ~1.3). Wildbolt is the level-1 filler.
    // A CEILING here would fight that design; the floor still catches the
    // original bug this test was written for (the 3s cast hitting WEAKER per
    // second than the filler).
    const ratio = nukeBaseDps('druid', 'starfire') / nukeBaseDps('druid', 'wrath');
    expect(ratio).toBeGreaterThan(0.9);
    // Re-based, not removed (review 3050): the authored engine ratio measures
    // 2.48; a ceiling at 3.0 keeps runaway growth red without fighting the
    // Moontide design the old 1.3 bound predated.
    expect(ratio).toBeLessThan(3.0);
  });

  it('no mage single-target nuke is a strict trap (every nuke within band of the best)', () => {
    const ids = ['frostbolt', 'fireball', 'scorch', 'pyroblast'];
    const dps = ids.map((id) => nukeBaseDps('mage', id));
    const best = Math.max(...dps);
    for (let i = 0; i < ids.length; i++) {
      // every castable single-target nuke should be worth at least ~60% of the
      // best per-second; below that it is never worth a global cooldown.
      expect(dps[i] / best, `${ids[i]} vs best`).toBeGreaterThan(0.6);
    }
  });
});

describe('healer primary mana efficiency', () => {
  it('pins the tuned Mending Light rank costs', () => {
    const holyLight = ABILITIES.holy_light;
    expect([holyLight.cost, ...(holyLight.ranks ?? []).map((rank) => rank.cost)]).toEqual([
      25, 35, 50, 65,
    ]);
  });

  it('keeps Mending Light and Dawn’s Embrace similarly mana-efficient', () => {
    const mendingRatio = manaPerAverageHeal('paladin', 'holy_light', HOLY_PALADIN_MODS);
    const dawnRatio = manaPerAverageHeal('paladin', 'dawns_embrace', HOLY_PALADIN_MODS);

    expect(mendingRatio / dawnRatio).toBeGreaterThanOrEqual(0.9);
    expect(mendingRatio / dawnRatio).toBeLessThanOrEqual(1.1);
  });
});
