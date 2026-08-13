// The class power tuner's pure core: channel math, the ability walker, the
// document sanitizer, and the install/restore round trip.
// Paired module: src/sim/tuning/ (see its index.ts for the feature summary).

import { afterEach, describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { ITEMS } from '../src/sim/data';
import { abilityPowerCoeffMult, directHitBonus } from '../src/sim/spell_scaling';
import {
  abilityTuningChannels,
  abilityTuningKnobs,
  activeClassTuning,
  applyAbilityTuning,
  applyClassTuning,
  applyWeaponTuning,
  clampTuningFactor,
  classRangedWeaponId,
  classTuningDocumentKey,
  countTunedChannels,
  emptyClassTuningDocument,
  installClassTuning,
  installedTunedAbilityIds,
  installedTunedWeaponIds,
  isEffectiveTuningSite,
  isNeutralFactor,
  isTunableEntryId,
  MIN_SWING_SECONDS,
  sanitizeClassTuningDocument,
  scaleTuningValue,
  TIME_TUNING_CHANNELS,
  TUNING_CHANNELS,
  TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR,
  uninstallClassTuning,
  WEAPON_TUNING_CHANNELS,
  weaponDps,
  weaponTuningKnobs,
} from '../src/sim/tuning';
import type { AbilityDef } from '../src/sim/types';

function def(partial: Partial<AbilityDef>): AbilityDef {
  return {
    id: 'probe',
    name: 'Probe',
    class: 'mage',
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    learnLevel: 1,
    effects: [],
    description: '',
    ...partial,
  };
}

afterEach(() => {
  // Every install mutates the process-wide ability table; restore the shipped
  // one so an ordering change cannot leak a tuned def into another suite.
  installClassTuning(emptyClassTuningDocument());
});

describe('tuning channel math', () => {
  it('scales a linear magnitude and keeps a whole number whole', () => {
    expect(scaleTuningValue(100, 1.25, 'linear')).toBe(125);
    expect(scaleTuningValue(9, 1.2, 'linear')).toBe(11); // 10.8 rounds, stays an integer
    expect(scaleTuningValue(1.5, 2, 'linear')).toBe(3);
    expect(scaleTuningValue(2.5, 1.1, 'linear')).toBe(2.75); // fractional base keeps decimals
  });

  it('moves a multiplier by its DEVIATION from 1, not by the number itself', () => {
    // a 50% snare buffed 20% must slow HARDER (0.4), not become a 0.6 speed-up
    expect(scaleTuningValue(0.5, 1.2, 'deviation')).toBe(0.4);
    // a 2x threat multiplier buffed 20% becomes 2.2, not 2.4
    expect(scaleTuningValue(2, 1.2, 'deviation')).toBe(2.2);
    // a neutral multiplier stays neutral at any factor
    expect(scaleTuningValue(1, TUNING_MAX_FACTOR, 'deviation')).toBe(1);
  });

  it('clamps a fraction to the whole, so a maxed slider cannot exceed 100%', () => {
    expect(scaleTuningValue(0.3, 2, 'fraction')).toBe(0.6);
    expect(scaleTuningValue(0.5, 3, 'fraction')).toBe(1);
    expect(scaleTuningValue(0.5, 0.1, 'fraction')).toBe(0.05);
  });

  it('clamps and rounds a factor, and falls back to neutral on junk', () => {
    expect(clampTuningFactor(1.234)).toBe(1.23);
    expect(clampTuningFactor(99)).toBe(TUNING_MAX_FACTOR);
    expect(clampTuningFactor(-4)).toBe(TUNING_MIN_FACTOR);
    expect(clampTuningFactor(Number.NaN)).toBe(1);
    expect(clampTuningFactor('nonsense')).toBe(1);
    expect(clampTuningFactor(null)).toBe(1);
    expect(isNeutralFactor(1)).toBe(true);
    expect(isNeutralFactor(1.02)).toBe(false);
  });

  it('reports a slider that provably cannot move anything as ineffective', () => {
    expect(isEffectiveTuningSite(0, 'linear')).toBe(false);
    expect(isEffectiveTuningSite(1, 'deviation')).toBe(false);
    expect(isEffectiveTuningSite(1, 'linear')).toBe(true);
    expect(isEffectiveTuningSite(0.5, 'deviation')).toBe(true);
  });

  // A count field that rounds to 0 is not a smaller number, it is a different
  // rule: `softCap` and `maxTargets` are read as `eff.x && ...` in
  // combat/effect_dispatch.ts, so 0 means "no limit at all" and a nerf slider
  // would land as an uncapped buff. Only a base of zero may come out as zero.
  it('never rounds a nonzero whole number down to zero', () => {
    expect(scaleTuningValue(4, TUNING_MIN_FACTOR, 'linear')).toBe(1);
    expect(scaleTuningValue(3, 0.1, 'linear')).toBe(1);
    expect(scaleTuningValue(2, 0.2, 'linear')).toBe(1);
    expect(scaleTuningValue(1, TUNING_MIN_FACTOR, 'linear')).toBe(1);
    // sign is kept, so a negative modifier cannot flip to no modifier
    expect(scaleTuningValue(-3, 0.1, 'linear')).toBe(-1);
    // a zero base is genuinely inert and stays zero
    expect(scaleTuningValue(0, TUNING_MIN_FACTOR, 'linear')).toBe(0);
    // the floor binds only where rounding would reach zero
    expect(scaleTuningValue(20, 0.1, 'linear')).toBe(2);
    // and it is a WHOLE-number rule: a fractional base still scales freely
    expect(scaleTuningValue(0.4, 0.1, 'linear')).toBe(0.04);
  });

  // Every count field on the `targets` channel shares one slider, so the floor
  // has to hold for the smallest authored count any of them ships.
  it('keeps every targets-channel count at one or more at the slider floor', () => {
    for (const base of [1, 2, 3, 4, 5, 8]) {
      expect(scaleTuningValue(base, TUNING_MIN_FACTOR, 'linear')).toBeGreaterThanOrEqual(1);
    }
  });

  // Live slows author `mult: 0.5`, so factor 2.0 lands exactly on the boundary
  // and 3.0 crosses it. An unclamped deviation would mint a NEGATIVE movement
  // multiplier: mobs pathing backwards, and a negative 1/mult escape window.
  it('floors a deviation at zero, so a tuned snare can stop but never reverse', () => {
    expect(scaleTuningValue(0.5, 2, 'deviation')).toBe(0);
    expect(scaleTuningValue(0.5, 3, 'deviation')).toBe(0);
    expect(scaleTuningValue(0.5, 1.9, 'deviation')).toBeCloseTo(0.05, 10);
    // above-1 multipliers are unaffected by the floor
    expect(scaleTuningValue(2, 3, 'deviation')).toBe(4);
  });

  // Seconds keep their precision: a whole-number time base must not make half
  // the slider a silent no-op (2s at 0.75 stayed 2s), and never round DOWN
  // through a nerf (a 2s swing at 0.7 snapping to 1s doubles the hit rate).
  it('exempts time channels from the whole-number snap', () => {
    expect(scaleTuningValue(2, 0.75, 'linear', 'cast_time')).toBe(1.5);
    expect(scaleTuningValue(2, 0.7, 'linear', 'swing_speed')).toBe(1.4);
    expect(scaleTuningValue(2, 1.24, 'linear', 'cast_time')).toBe(2.48);
    expect(scaleTuningValue(8, 0.9, 'linear', 'cooldown')).toBe(7.2);
    // a non-time channel keeps the integer rule
    expect(scaleTuningValue(2, 0.7, 'linear', 'targets')).toBe(1);
    for (const channel of TIME_TUNING_CHANNELS) {
      expect(scaleTuningValue(2, 0.75, 'linear', channel), channel).toBe(1.5);
    }
  });
});

describe('ability knob derivation', () => {
  it('routes a thorns aura value to the reflect-damage channel, across every rank', () => {
    const knobs = abilityTuningKnobs(ABILITIES.thorns).filter(
      (knob) => knob.channel === 'damage_reflect',
    );
    expect(knobs.map((knob) => knob.value)).toEqual([3, 6, 9]);
    expect(knobs.map((knob) => knob.path)).toEqual([
      'effects[0].buffTarget.value',
      'ranks[0].effects[0].buffTarget.value',
      'ranks[1].effects[0].buffTarget.value',
    ]);
  });

  it('separates a hybrid nuke plus DoT into distinct damage channels', () => {
    const channels = abilityTuningChannels(ABILITIES.moonfire);
    expect(channels).toContain('damage_direct');
    expect(channels).toContain('damage_dot');
    expect(channels).toContain('duration_effect');
    // A DoT's tick cadence is not a power lever, so it is never a knob.
    expect(abilityTuningKnobs(ABILITIES.moonfire).some((k) => k.path.endsWith('.interval'))).toBe(
      false,
    );
  });

  it('offers spell power only where something actually scales with power', () => {
    const scaling = def({ effects: [{ type: 'directDamage', min: 10, max: 20 }] });
    const inert = def({ effects: [{ type: 'taunt' }] });
    expect(abilityTuningChannels(scaling)).toContain('spell_power');
    expect(abilityTuningChannels(inert)).not.toContain('spell_power');
  });

  it('drops sliders that cannot move anything but keeps them for the raw walk', () => {
    const instant = def({ cooldown: 0, castTime: 0 });
    expect(abilityTuningChannels(instant)).not.toContain('cooldown');
    expect(
      abilityTuningKnobs(instant, { includeInert: true }).some((k) => k.channel === 'cooldown'),
    ).toBe(true);
  });

  it('walks nested and array-shaped effect fields', () => {
    const cone = def({
      effects: [
        {
          type: 'empoweredCone',
          angle: 60,
          stages: [
            { range: 10, min: 20, max: 30 },
            { range: 20, min: 40, max: 60 },
          ],
        },
      ],
    });
    // one field at a time across every stage: mins first, then maxes
    const damage = abilityTuningKnobs(cone).filter((k) => k.channel === 'damage_aoe');
    expect(damage.map((k) => k.value)).toEqual([20, 40, 30, 60]);
    const ranges = abilityTuningKnobs(cone).filter((k) => k.channel === 'range');
    expect(ranges.map((k) => k.path)).toContain('effects[0].empoweredCone.stages.0.range');
  });

  it('never offers a slider for a marker aura', () => {
    const stance = def({
      effects: [{ type: 'selfBuff', kind: 'battle_stance', value: 0, duration: 60 }],
    });
    expect(abilityTuningKnobs(stance).some((k) => k.path.endsWith('selfBuff.value'))).toBe(false);
  });
});

describe('applying tuning to one ability', () => {
  it('produces a tuned clone and leaves the shipped def untouched', () => {
    const shipped = ABILITIES.thorns;
    const before = JSON.stringify(shipped);
    const tuned = applyAbilityTuning(shipped, { damage_reflect: 2 });
    expect(tuned).not.toBe(shipped);
    expect(JSON.stringify(shipped)).toBe(before);
    expect((tuned.effects[0] as { value: number }).value).toBe(6);
    const ranks = tuned.ranks ?? [];
    expect((ranks[1].effects[0] as { value: number }).value).toBe(18);
    // an untouched channel keeps its authored number
    expect(tuned.cost).toBe(shipped.cost);
  });

  it('returns the same def object when nothing moves', () => {
    expect(applyAbilityTuning(ABILITIES.thorns, {})).toBe(ABILITIES.thorns);
    expect(applyAbilityTuning(ABILITIES.thorns, { damage_reflect: 1 })).toBe(ABILITIES.thorns);
    // a channel this ability does not expose changes nothing
    expect(applyAbilityTuning(ABILITIES.thorns, { damage_finisher: 2 })).toBe(ABILITIES.thorns);
  });

  it('moves each aspect independently: threat without damage, cooldown without cost', () => {
    const probe = def({
      cost: 30,
      cooldown: 10,
      threat: { flat: 100, mult: 2 },
      effects: [{ type: 'directDamage', min: 10, max: 20 }],
    });
    const tuned = applyAbilityTuning(probe, { threat: 1.5, cooldown: 0.5 });
    expect(tuned.threat).toEqual({ flat: 150, mult: 2.5 });
    expect(tuned.cooldown).toBe(5);
    expect(tuned.cost).toBe(30);
    expect(tuned.effects[0]).toEqual({ type: 'directDamage', min: 10, max: 20 });
  });

  it('scales the spell power coefficient through the shared scaling helper', () => {
    const probe = def({ castTime: 3.5, effects: [{ type: 'directDamage', min: 10, max: 20 }] });
    const base = directHitBonus(400, probe, probe.castTime);
    const tuned = applyAbilityTuning(probe, { spell_power: 1.5 });
    expect(abilityPowerCoeffMult(tuned)).toBe(1.5);
    expect(directHitBonus(400, tuned, tuned.castTime)).toBe(Math.round(base * 1.5));
  });
});

describe('weapon swing knobs', () => {
  const sword = { min: 2, max: 5, speed: 2 };

  it('exposes exactly the white-damage and swing-timer channels', () => {
    expect(weaponTuningKnobs(sword).map((knob) => `${knob.channel}:${knob.path}`)).toEqual([
      'swing_damage:min',
      'swing_damage:max',
      'swing_speed:speed',
    ]);
  });

  it('scales the damage roll without touching the timer', () => {
    const tuned = applyWeaponTuning(sword, { swing_damage: 2 });
    expect(tuned).toEqual({ min: 4, max: 10, speed: 2 });
    expect(sword).toEqual({ min: 2, max: 5, speed: 2 });
  });

  it('reads a factor above 1 on the timer as a SLOWER weapon', () => {
    // The channel is the swing TIMER, so scaling it up must lower dps.
    const tuned = applyWeaponTuning(sword, { swing_speed: 1.5 });
    expect(tuned.speed).toBe(3);
    expect(weaponDps(tuned)).toBeLessThan(weaponDps(sword));
  });

  it('never produces a swing timer below one sim tick', () => {
    const tuned = applyWeaponTuning({ min: 2, max: 5, speed: 0.1 }, { swing_speed: 0.1 });
    expect(tuned.speed).toBeGreaterThanOrEqual(MIN_SWING_SECONDS);
  });

  it('returns the same profile when nothing moves', () => {
    expect(applyWeaponTuning(sword, {})).toBe(sword);
    expect(applyWeaponTuning(sword, { swing_damage: 1, swing_speed: 1 })).toBe(sword);
    // an ability channel is not a weapon channel
    expect(applyWeaponTuning(sword, { damage_direct: 2 })).toBe(sword);
  });

  it('keeps the weapon-type flags a tuned profile still needs', () => {
    const dagger = { min: 2, max: 4, speed: 1.8, dagger: true };
    expect(applyWeaponTuning(dagger, { swing_damage: 2 }).dagger).toBe(true);
  });
});

describe('installing weapon tuning', () => {
  it('replaces a carried weapon profile in place and restores it exactly', () => {
    const shipped = ITEMS.worn_sword.weapon;
    installClassTuning({ weapons: { worn_sword: { swing_damage: 2, swing_speed: 1.5 } } });
    expect(ITEMS.worn_sword.weapon).toEqual({ min: 4, max: 10, speed: 3 });
    expect(installedTunedWeaponIds()).toEqual(['worn_sword']);

    installClassTuning(emptyClassTuningDocument());
    expect(ITEMS.worn_sword.weapon).toBe(shipped);
    expect(installedTunedWeaponIds()).toEqual([]);
  });

  it("tunes a class's own ranged profile (Auto Shot, wands) by its class id", () => {
    const shipped = CLASSES.hunter.ranged;
    const id = classRangedWeaponId('hunter');
    expect(id).toBe('class_hunter_ranged');
    installClassTuning({ weapons: { [id]: { swing_damage: 0.5 } } });
    expect(CLASSES.hunter.ranged?.min).toBe(Math.round((shipped?.min ?? 0) * 0.5));
    // the ranged rider fields survive the tune
    expect(CLASSES.hunter.ranged?.maxRange).toBe(shipped?.maxRange);

    installClassTuning(emptyClassTuningDocument());
    expect(CLASSES.hunter.ranged).toBe(shipped);
  });

  it('tunes abilities and weapons from one document without either leaking', () => {
    installClassTuning({
      abilities: { thorns: { damage_reflect: 2 } },
      weapons: { worn_sword: { swing_damage: 2 } },
    });
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(6);
    expect(ITEMS.worn_sword.weapon?.min).toBe(4);
    expect(installedTunedAbilityIds()).toEqual(['thorns']);
    expect(installedTunedWeaponIds()).toEqual(['worn_sword']);
  });

  it('ignores a weapon id that no longer exists', () => {
    expect(() =>
      installClassTuning({ weapons: { retired_blade: { swing_damage: 2 } } }),
    ).not.toThrow();
    expect(installedTunedWeaponIds()).toEqual([]);
  });

  // The tuned ranged profile is assigned straight onto the class, so the walker's
  // clone is what must carry the range band and the wand flag: nothing spreads
  // the shipped profile back over it.
  it('carries every rider field of a class ranged profile through the tune', () => {
    const shipped = CLASSES.mage.ranged;
    installClassTuning({ weapons: { class_mage_ranged: { swing_speed: 1.5 } } });
    const tuned = CLASSES.mage.ranged;
    expect(tuned?.speed).not.toBe(shipped?.speed);
    expect(tuned?.min).toBe(shipped?.min);
    expect(tuned?.maxRange).toBe(shipped?.maxRange);
    expect(tuned?.minRange).toBe(shipped?.minRange);
    expect(tuned?.wand).toBe(shipped?.wand);
  });
});

// The client installs at every `hello` and must hand the tables back when the
// session ends: they are process-wide, so a tab that leaves a tuned realm would
// otherwise keep its numbers for whatever runs next.
describe('uninstalling on the client', () => {
  it('restores the shipped tables exactly', () => {
    const shippedDef = ABILITIES.thorns;
    const shippedWeapon = ITEMS.worn_sword.weapon;
    installClassTuning({
      abilities: { thorns: { damage_reflect: 2 } },
      weapons: { worn_sword: { swing_damage: 2 } },
    });
    expect(ABILITIES.thorns).not.toBe(shippedDef);

    uninstallClassTuning();
    expect(ABILITIES.thorns).toBe(shippedDef);
    expect(ITEMS.worn_sword.weapon).toBe(shippedWeapon);
    expect(installedTunedAbilityIds()).toEqual([]);
    expect(installedTunedWeaponIds()).toEqual([]);
    expect(activeClassTuning()).toEqual(emptyClassTuningDocument());
  });

  it('is safe to call on a process that never installed anything', () => {
    const shipped = ABILITIES.thorns;
    expect(() => uninstallClassTuning()).not.toThrow();
    expect(ABILITIES.thorns).toBe(shipped);
  });
});

describe('the tuning document', () => {
  it('keeps well-formed rows and drops everything it cannot trust', () => {
    const doc = sanitizeClassTuningDocument({
      version: 1,
      abilities: {
        thorns: { damage_reflect: 1.5, not_a_channel: 2, cooldown: 'junk' },
        'Bad Id!': { cooldown: 2 },
        rip: { damage_dot: 1 }, // neutral: dropped, so the ability drops out too
        moonfire: { damage_direct: 500 }, // clamped to the ceiling
      },
    });
    expect(doc.abilities.thorns).toEqual({ damage_reflect: 1.5 });
    expect(doc.abilities['Bad Id!']).toBeUndefined();
    expect(doc.abilities.rip).toBeUndefined();
    expect(doc.abilities.moonfire).toEqual({ damage_direct: TUNING_MAX_FACTOR });
    expect(countTunedChannels(doc)).toBe(2);
  });

  it('returns an empty document for junk rather than throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], { abilities: 7 }]) {
      expect(sanitizeClassTuningDocument(junk).abilities).toEqual({});
    }
  });

  it('serializes stably regardless of key order, so an unchanged save is detectable', () => {
    const a = sanitizeClassTuningDocument({
      abilities: { thorns: { cooldown: 1.5, damage_reflect: 2 } },
    });
    const b = sanitizeClassTuningDocument({
      abilities: { thorns: { damage_reflect: 2, cooldown: 1.5 } },
    });
    expect(classTuningDocumentKey(a)).toBe(classTuningDocumentKey(b));
  });

  it('every channel in the vocabulary survives a sanitize round trip', () => {
    const abilities: Record<string, Record<string, number>> = { probe: {} };
    for (const channel of TUNING_CHANNELS) abilities.probe[channel] = 1.5;
    const doc = sanitizeClassTuningDocument({ abilities });
    expect(Object.keys(doc.abilities.probe).sort()).toEqual([...TUNING_CHANNELS].sort());
  });

  it('keeps the two scopes separate and tolerates a document with neither', () => {
    const doc = sanitizeClassTuningDocument({
      abilities: { thorns: { damage_reflect: 1.5 } },
      weapons: { worn_sword: { swing_speed: 1.2 }, 'Bad Id!': { swing_damage: 2 } },
    });
    expect(doc.abilities).toEqual({ thorns: { damage_reflect: 1.5 } });
    expect(doc.weapons).toEqual({ worn_sword: { swing_speed: 1.2 } });
    // A document written before the weapon scope existed still loads.
    expect(sanitizeClassTuningDocument({ abilities: {} }).weapons).toEqual({});
    expect(countTunedChannels(doc)).toBe(2);
  });
});

describe('applying a document to the ability table', () => {
  it('tunes only the named abilities and keeps the rest by reference', () => {
    const doc = sanitizeClassTuningDocument({ abilities: { thorns: { damage_reflect: 2 } } });
    const tuned = applyClassTuning(ABILITIES, doc);
    expect(tuned.thorns).not.toBe(ABILITIES.thorns);
    expect(tuned.rip).toBe(ABILITIES.rip);
    expect(ABILITIES.thorns.effects[0]).toEqual({
      type: 'buffTarget',
      kind: 'thorns',
      value: 3,
      duration: 600,
    });
  });

  it('ignores an ability id that no longer exists', () => {
    const doc = sanitizeClassTuningDocument({ abilities: { retired_spell: { cooldown: 2 } } });
    expect(() => applyClassTuning(ABILITIES, doc)).not.toThrow();
  });
});

describe('installing onto the shared ability table', () => {
  it('replaces the def in place and restores it exactly when cleared', () => {
    const shipped = ABILITIES.thorns;
    installClassTuning({ abilities: { thorns: { damage_reflect: 3 } } });
    expect(ABILITIES.thorns).not.toBe(shipped);
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(9);
    expect(installedTunedAbilityIds()).toEqual(['thorns']);

    installClassTuning(emptyClassTuningDocument());
    expect(ABILITIES.thorns).toBe(shipped);
    expect(installedTunedAbilityIds()).toEqual([]);
  });

  it('never compounds: re-installing starts from the shipped numbers', () => {
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(6);
  });

  it('drops an ability from the install when its document row goes away', () => {
    const shipped = ABILITIES.rip;
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 }, rip: { damage_dot: 2 } } });
    expect(installedTunedAbilityIds()).toEqual(['rip', 'thorns']);
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    expect(installedTunedAbilityIds()).toEqual(['thorns']);
    expect(ABILITIES.rip).toBe(shipped);
  });

  it('is deterministic: the same document always yields the same numbers', () => {
    const doc = { abilities: { moonfire: { damage_direct: 1.37, damage_dot: 0.66 } } };
    installClassTuning(doc);
    const first = JSON.stringify(ABILITIES.moonfire);
    installClassTuning(emptyClassTuningDocument());
    installClassTuning(doc);
    expect(JSON.stringify(ABILITIES.moonfire)).toBe(first);
  });
});

// A plain-object table answers 'constructor' TRUTHY through the prototype
// chain, so a stored row keyed on a reserved id would pass the `if (!shipped)`
// guard, hand the walker the Object function, and throw at EVERY boot until
// someone hand-edited the row out of Postgres. Reviewed as the round-two
// CRITICAL on PR #3337; all three layers below close it independently.
describe('reserved entry ids (the constructor boot brick)', () => {
  const RESERVED = ['constructor', '__proto__', 'prototype'];

  it('rejects every reserved id at the id gate', () => {
    for (const id of RESERVED) {
      expect(isTunableEntryId(id), id).toBe(false);
    }
    // and the pattern itself still admits ordinary ids
    expect(isTunableEntryId('constructor_probe')).toBe(true);
  });

  it('sanitizes reserved ids out of both scopes', () => {
    const doc = sanitizeClassTuningDocument({
      abilities: {
        constructor: { cooldown: 1.5 },
        prototype: { cooldown: 1.5 },
        thorns: { damage_reflect: 1.5 },
      },
      weapons: { constructor: { swing_damage: 2 }, worn_sword: { swing_damage: 2 } },
    });
    expect(Object.keys(doc.abilities)).toEqual(['thorns']);
    expect(Object.keys(doc.weapons)).toEqual(['worn_sword']);
    // __proto__ cannot even be written into a literal test fixture without
    // hitting the prototype setter, which is exactly why it is reserved too.
    const proto = sanitizeClassTuningDocument(
      JSON.parse('{"abilities":{"__proto__":{"cooldown":1.5}}}'),
    );
    expect(Object.keys(proto.abilities)).toEqual([]);
  });

  it('applies a hand-built document with a reserved id without touching the table', () => {
    // Bypasses the sanitizer on purpose: this pins the Object.hasOwn guard in
    // the apply path itself, the defense that holds even for a row stored by
    // an older build.
    const doc = {
      version: 1,
      abilities: { constructor: { cooldown: 1.5 } },
      weapons: {},
    };
    expect(() => applyClassTuning(ABILITIES, doc)).not.toThrow();
    const tuned = applyClassTuning(ABILITIES, doc);
    expect(Object.hasOwn(tuned, 'constructor')).toBe(false);
  });

  it('installs a document carrying reserved ids in both scopes as a no-op', () => {
    expect(() =>
      installClassTuning({
        abilities: { constructor: { cooldown: 1.5 } },
        weapons: { constructor: { swing_damage: 2 }, prototype: { swing_speed: 2 } },
      }),
    ).not.toThrow();
    expect(installedTunedAbilityIds()).toEqual([]);
    expect(installedTunedWeaponIds()).toEqual([]);
  });
});

describe('the weapon scope stores only the swing channels', () => {
  it('drops the 22 non-swing channels a hand-written document smuggles in', () => {
    const weapons: Record<string, Record<string, number>> = { worn_sword: {} };
    for (const channel of TUNING_CHANNELS) weapons.worn_sword[channel] = 1.5;
    const doc = sanitizeClassTuningDocument({ abilities: {}, weapons });
    expect(Object.keys(doc.weapons.worn_sword).sort()).toEqual([...WEAPON_TUNING_CHANNELS].sort());
    // the ability scope keeps the full vocabulary
    const abilities: Record<string, Record<string, number>> = { probe: {} };
    for (const channel of TUNING_CHANNELS) abilities.probe[channel] = 1.5;
    const full = sanitizeClassTuningDocument({ abilities });
    expect(Object.keys(full.abilities.probe).sort()).toEqual([...TUNING_CHANNELS].sort());
  });
});

describe('percent-point aura payloads scale as points, not 0..1 shares', () => {
  it("keeps Veilbound March's +30% armor linear under any factor", () => {
    const shipped = ABILITIES.veilbound_march;
    const buffed = applyAbilityTuning(shipped, { effect_magnitude: 1.1 });
    const march = buffed.effects.find((eff) => eff.type === 'veilboundMarch') as {
      armorPct: number;
      speedMult: number;
    };
    // 30 x 1.1 = 33 percent points; the old fraction rule clamped this to 1,
    // collapsing +30% armor to +1% the moment any factor moved it.
    expect(march.armorPct).toBe(33);
    // speedMult (1.4) still moves as a deviation on the same slider
    expect(march.speedMult).toBeCloseTo(1.44, 10);
  });

  it("keeps Trueshot Aura's +10% Attack Power linear under any factor", () => {
    const shipped = ABILITIES.trueshot_aura;
    const buffed = applyAbilityTuning(shipped, { effect_magnitude: 1.1 });
    const aura = buffed.effects.find((eff) => eff.type === 'aoeAllyAttackPower') as {
      apPct: number;
    };
    expect(aura.apPct).toBe(11);
  });
});

describe('stealth is a movement multiplier, not a plain magnitude', () => {
  it('moves the sneak-walk speed by its deviation from 1', () => {
    const probe = def({
      effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.5, duration: 3600 }],
    });
    // nerf slider (0.1x) relaxes the walk toward full speed...
    const relaxed = applyAbilityTuning(probe, { effect_magnitude: 0.1 });
    expect((relaxed.effects[0] as { value: number }).value).toBe(0.95);
    // ...and a buff slider (1.2x) slows it harder, never speeds it up
    const harder = applyAbilityTuning(probe, { effect_magnitude: 1.2 });
    expect((harder.effects[0] as { value: number }).value).toBe(0.4);
  });
});

describe("Aegis of the First Dawn's spell power knob", () => {
  it('offers the spell_power channel (its SP riders dominate at endgame)', () => {
    expect(abilityTuningChannels(ABILITIES.aegis_first_dawn)).toContain('spell_power');
  });

  it('moves the coefficient the aegis module reads through abilityPowerCoeffMult', () => {
    const tuned = applyAbilityTuning(ABILITIES.aegis_first_dawn, { spell_power: 1.5 });
    expect(abilityPowerCoeffMult(tuned)).toBe(1.5);
    expect(abilityPowerCoeffMult(ABILITIES.aegis_first_dawn)).toBe(1);
  });
});

describe('time channels through the walker', () => {
  it('scales a whole-number cast time fractionally', () => {
    const probe = def({ castTime: 2 });
    const tuned = applyAbilityTuning(probe, { cast_time: 0.75 });
    expect(tuned.castTime).toBe(1.5);
  });

  it("scales stampede's summoned-beast swing timer without the integer snap", () => {
    const probe = def({
      effects: [
        {
          type: 'hunterStampede',
          beasts: 3,
          duration: 12,
          attackInterval: 2,
          min: 10,
          max: 14,
          rangedPowerCoeff: 0.2,
        },
      ],
    });
    const tuned = applyAbilityTuning(probe, { swing_speed: 0.7 });
    const stampede = tuned.effects[0] as { attackInterval: number; beasts: number };
    // 1.4s, NOT the 1s snap that doubled the hit rate on a "-30%" slider
    expect(stampede.attackInterval).toBe(1.4);
    expect(stampede.beasts).toBe(3);
  });
});
