// The Class Power Tuner's admin-side view model, plus the two things that keep
// the dashboard honest about a surface it derives from the sim without being
// allowed to import it:
//
//   - the local value math is byte-equivalent to the sim's `scaleTuningValue`
//   - every channel and ability source in the sim's closed vocabularies has an
//     admin i18n label (the page builds those keys dynamically, so the admin
//     catalog's literal-key scan cannot see them)
//
// Node environment: this file tests plain helpers, no DOM.

import { describe, expect, it } from 'vitest';
import {
  buildTuningDocument,
  channelPreview,
  clampFactor,
  documentChannelCount,
  EMPTY_ABILITY_FILTER,
  EMPTY_WEAPON_FILTER,
  factorDeltaPercent,
  filterAbilities,
  filterWeapons,
  isNeutral,
  MIN_SWING_SECONDS,
  resetAbility,
  scaleTunedValue,
  TIME_TUNING_CHANNELS,
  TUNING_FACTOR_STEP,
  TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR,
  TUNING_NEUTRAL_FACTOR,
  tunedAbilityCount,
  tunedChannelCount,
  tunedWeaponCount,
  tuningDocumentKey,
  tuningFormState,
  weaponHands,
  weaponPreview,
} from '../../src/admin/class_tuning';
import { en as adminEn } from '../../src/admin/i18n.en';
import type { ClassTuningCatalog, TunerClassInfo, TunerWeaponInfo } from '../../src/admin/types';
import {
  buildClassTuningCatalog,
  MIN_SWING_SECONDS as SIM_MIN_SWING_SECONDS,
  applyWeaponTuning as simApplyWeaponTuning,
  weaponDps as simWeaponDps,
  TUNING_CHANNELS,
} from '../../src/sim/tuning';
import {
  TIME_TUNING_CHANNELS as SIM_TIME_TUNING_CHANNELS,
  TUNING_FACTOR_STEP as SIM_TUNING_FACTOR_STEP,
  TUNING_MAX_FACTOR as SIM_TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR as SIM_TUNING_MIN_FACTOR,
  TUNING_NEUTRAL_FACTOR as SIM_TUNING_NEUTRAL_FACTOR,
  clampTuningFactor as simClampTuningFactor,
  isNeutralFactor as simIsNeutralFactor,
  scaleTuningValue as simScaleTuningValue,
  type TuningValueKind,
} from '../../src/sim/tuning/channels';

const CLASS: TunerClassInfo = {
  id: 'druid',
  name: 'Druid',
  specs: [
    { id: 'balance', name: 'Balance', role: 'dps' },
    { id: 'feral', name: 'Feral', role: 'dps' },
    { id: 'restoration', name: 'Restoration', role: 'healer' },
  ],
  abilities: [
    {
      id: 'thorns',
      name: 'Briarguard',
      class: 'druid',
      school: 'nature',
      learnLevel: 6,
      specs: ['balance', 'feral', 'restoration'],
      source: 'base',
      passive: false,
      ranks: 3,
      channels: [
        {
          channel: 'damage_reflect',
          sites: [
            { path: 'effects[0].buffTarget.value', value: 3, kind: 'linear' },
            { path: 'ranks[0].effects[0].buffTarget.value', value: 6, kind: 'linear' },
            { path: 'ranks[1].effects[0].buffTarget.value', value: 9, kind: 'linear' },
          ],
        },
        {
          channel: 'resource_cost',
          sites: [{ path: 'cost', value: 20, kind: 'linear' }],
        },
      ],
    },
    {
      id: 'swiftmend',
      name: 'Swiftmend',
      class: 'druid',
      school: 'nature',
      learnLevel: 20,
      specs: ['restoration'],
      source: 'signature',
      passive: false,
      ranks: 1,
      channels: [{ channel: 'heal_direct', sites: [{ path: 'x', value: 100, kind: 'linear' }] }],
    },
  ],
};

const WEAPONS: TunerWeaponInfo[] = [
  {
    id: 'worn_sword',
    name: 'Pitted Shortsword',
    kind: 'item',
    hand: 'onehand',
    dagger: false,
    min: 2,
    max: 5,
    speed: 2,
    dps: 1.75,
    channels: [
      {
        channel: 'swing_damage',
        sites: [
          { path: 'min', value: 2, kind: 'linear' },
          { path: 'max', value: 5, kind: 'linear' },
        ],
      },
      { channel: 'swing_speed', sites: [{ path: 'speed', value: 2, kind: 'linear' }] },
    ],
  },
  {
    id: 'class_hunter_ranged',
    name: 'Hunter ranged',
    kind: 'classRanged',
    class: 'hunter',
    hand: 'ranged',
    dagger: false,
    min: 4,
    max: 8,
    speed: 2.5,
    dps: 2.4,
    channels: [
      {
        channel: 'swing_damage',
        sites: [
          { path: 'min', value: 4, kind: 'linear' },
          { path: 'max', value: 8, kind: 'linear' },
        ],
      },
      { channel: 'swing_speed', sites: [{ path: 'speed', value: 2.5, kind: 'linear' }] },
    ],
  },
];

const CATALOG: ClassTuningCatalog = { classes: [CLASS], weapons: WEAPONS };

/** The ability-scope slider state, which most cases below exercise. */
function abilityForm(document: Parameters<typeof tuningFormState>[1] = null) {
  return tuningFormState(CATALOG, document).abilities;
}

describe('slider state', () => {
  it('seeds every channel of every ability at neutral', () => {
    const form = abilityForm();
    expect(form.thorns).toEqual({ damage_reflect: 1, resource_cost: 1 });
    expect(form.swiftmend).toEqual({ heal_direct: 1 });
  });

  it('seeds every weapon profile at neutral too', () => {
    const weapons = tuningFormState(CATALOG, null).weapons;
    expect(weapons.worn_sword).toEqual({ swing_damage: 1, swing_speed: 1 });
    expect(weapons.class_hunter_ranged).toEqual({ swing_damage: 1, swing_speed: 1 });
  });

  it('lays a saved document over the neutral baseline', () => {
    const form = abilityForm({
      version: 1,
      abilities: { thorns: { damage_reflect: 0.8 } },
      weapons: {},
    });
    expect(form.thorns.damage_reflect).toBe(0.8);
    expect(form.thorns.resource_cost).toBe(1);
  });

  it('lays a saved weapon document over the neutral baseline', () => {
    const weapons = tuningFormState(CATALOG, {
      version: 1,
      abilities: {},
      weapons: { worn_sword: { swing_speed: 1.2 } },
    }).weapons;
    expect(weapons.worn_sword).toEqual({ swing_damage: 1, swing_speed: 1.2 });
  });

  it('drops a saved channel the catalog no longer exposes', () => {
    // A retired effect must not leave an invisible factor that a later save
    // would silently re-post against an ability that cannot use it.
    const form = abilityForm({
      version: 1,
      abilities: { thorns: { damage_finisher: 2 }, retired_spell: { cooldown: 2 } },
      weapons: {},
    });
    expect(form.thorns.damage_finisher).toBeUndefined();
    expect(form.retired_spell).toBeUndefined();
  });

  it('drops a saved weapon the catalog no longer carries', () => {
    const weapons = tuningFormState(CATALOG, {
      version: 1,
      abilities: {},
      weapons: { retired_blade: { swing_damage: 2 } },
    }).weapons;
    expect(weapons.retired_blade).toBeUndefined();
  });

  it('clamps a stored factor outside the slider range', () => {
    const form = abilityForm({
      version: 1,
      abilities: { thorns: { damage_reflect: 99, resource_cost: -5 } },
      weapons: {},
    });
    expect(form.thorns.damage_reflect).toBe(TUNING_MAX_FACTOR);
    expect(form.thorns.resource_cost).toBe(TUNING_MIN_FACTOR);
  });
});

describe('the document the page posts', () => {
  it('is sparse: neutral channels and untouched entries are omitted', () => {
    const form = tuningFormState(CATALOG, null);
    form.abilities.thorns.damage_reflect = 1.5;
    form.weapons.worn_sword.swing_speed = 1.2;
    expect(buildTuningDocument(form)).toEqual({
      version: 1,
      abilities: { thorns: { damage_reflect: 1.5 } },
      weapons: { worn_sword: { swing_speed: 1.2 } },
    });
  });

  it('is empty when nothing has moved', () => {
    const doc = buildTuningDocument(tuningFormState(CATALOG, null));
    expect(doc.abilities).toEqual({});
    expect(doc.weapons).toEqual({});
  });

  it('round-trips a saved document unchanged, so opening the page is not a diff', () => {
    const saved = {
      version: 1,
      abilities: { thorns: { damage_reflect: 0.75, resource_cost: 1.2 } },
      weapons: { class_hunter_ranged: { swing_damage: 0.9 } },
    };
    const form = tuningFormState(CATALOG, saved);
    expect(tuningDocumentKey(buildTuningDocument(form))).toBe(tuningDocumentKey(saved));
  });

  it('serializes stably regardless of key order', () => {
    const a = {
      version: 1,
      abilities: { thorns: { damage_reflect: 2, resource_cost: 1.5 } },
      weapons: { worn_sword: { swing_speed: 1.2, swing_damage: 0.8 } },
    };
    const b = {
      version: 1,
      abilities: { thorns: { resource_cost: 1.5, damage_reflect: 2 } },
      weapons: { worn_sword: { swing_damage: 0.8, swing_speed: 1.2 } },
    };
    expect(tuningDocumentKey(a)).toBe(tuningDocumentKey(b));
  });
});

describe('counting and resetting', () => {
  it('counts only the channels off neutral', () => {
    const form = abilityForm();
    expect(tunedChannelCount(form, 'thorns')).toBe(0);
    form.thorns.damage_reflect = 1.5;
    form.thorns.resource_cost = 0.5;
    expect(tunedChannelCount(form, 'thorns')).toBe(2);
    expect(tunedAbilityCount(form, CLASS)).toBe(1);
  });

  it('counts the tuned weapon profiles separately', () => {
    const weapons = tuningFormState(CATALOG, null).weapons;
    expect(tunedWeaponCount(weapons, WEAPONS)).toBe(0);
    weapons.worn_sword.swing_speed = 1.3;
    expect(tunedWeaponCount(weapons, WEAPONS)).toBe(1);
  });

  it('resets one ability without touching the others', () => {
    const form = abilityForm();
    form.thorns.damage_reflect = 2;
    form.swiftmend.heal_direct = 2;
    resetAbility(form, 'thorns');
    expect(form.thorns.damage_reflect).toBe(1);
    expect(form.swiftmend.heal_direct).toBe(2);
  });

  it('treats a factor within half a step of 1 as neutral', () => {
    expect(isNeutral(1)).toBe(true);
    expect(isNeutral(1.004)).toBe(true);
    expect(isNeutral(1.01)).toBe(false);
    expect(clampFactor(Number.NaN)).toBe(1);
  });
});

// The change history renders a stored document, not the live form, so it counts
// BOTH scopes: an abilities-only count reports a weapons-only change as "0
// sliders", which reads as an empty audit row.
describe('counting a stored document for the history readout', () => {
  it('counts both scopes', () => {
    expect(
      documentChannelCount({
        version: 1,
        abilities: { thorns: { damage_reflect: 1.5, resource_cost: 0.5 } },
        weapons: { worn_sword: { swing_damage: 0.8 } },
      }),
    ).toBe(3);
  });

  it('counts a weapons-only change', () => {
    expect(
      documentChannelCount({
        version: 1,
        abilities: {},
        weapons: { worn_sword: { swing_damage: 0.8, swing_speed: 1.2 } },
      }),
    ).toBe(2);
  });

  it('counts an abilities-only change', () => {
    expect(documentChannelCount({ version: 1, abilities: { thorns: { damage_reflect: 2 } } })).toBe(
      1,
    );
  });

  it('reads a row it cannot make sense of as zero rather than throwing', () => {
    expect(documentChannelCount(null)).toBe(0);
    expect(documentChannelCount({})).toBe(0);
    expect(documentChannelCount({ abilities: [], weapons: 'nonsense' })).toBe(0);
    expect(documentChannelCount({ abilities: { thorns: 4 } })).toBe(0);
  });
});

describe('filtering a class window', () => {
  const form = abilityForm();

  it('shows every ability with no filter', () => {
    expect(filterAbilities(CLASS, EMPTY_ABILITY_FILTER, form).map((a) => a.id)).toEqual([
      'thorns',
      'swiftmend',
    ]);
  });

  it('narrows to one spec', () => {
    const ids = filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, spec: 'balance' }, form).map(
      (a) => a.id,
    );
    expect(ids).toEqual(['thorns']);
  });

  it('matches on name and on id, case-insensitively', () => {
    expect(
      filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'briar' }, form).map((a) => a.id),
    ).toEqual(['thorns']);
    expect(
      filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'SWIFTMEND' }, form).map(
        (a) => a.id,
      ),
    ).toEqual(['swiftmend']);
    expect(filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'zzz' }, form)).toEqual([]);
  });

  it('narrows to the tuned abilities only', () => {
    const tuned = abilityForm();
    tuned.swiftmend.heal_direct = 1.5;
    const ids = filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, onlyTuned: true }, tuned).map(
      (a) => a.id,
    );
    expect(ids).toEqual(['swiftmend']);
  });
});

describe('the before/after readout', () => {
  it('shows the shipped numbers and what the slider makes them', () => {
    const preview = channelPreview(CLASS.abilities[0].channels[0], 2);
    expect(preview.base).toEqual([3, 6, 9]);
    expect(preview.tuned).toEqual([6, 12, 18]);
    expect(preview.unchanged).toBe(false);
  });

  it('reports an unmoved slider as unchanged', () => {
    expect(channelPreview(CLASS.abilities[0].channels[0], 1).unchanged).toBe(true);
  });

  it('dedupes repeated values and caps the readout', () => {
    const preview = channelPreview(
      {
        channel: 'damage_direct',
        sites: [
          { path: 'a', value: 5, kind: 'linear' },
          { path: 'b', value: 5, kind: 'linear' },
          { path: 'c', value: 7, kind: 'linear' },
        ],
      },
      1.5,
      2,
    );
    expect(preview.base).toEqual([5, 7]);
  });

  // Two sites can carry the same base on one channel with DIFFERENT kinds (a
  // linear bonus of 1 and a multiplier of 1). They answer the same factor with
  // different numbers, so deduping on the value alone would preview one of them
  // with the other's arithmetic.
  it('keeps two sites with the same base but different kinds apart', () => {
    const preview = channelPreview(
      {
        channel: 'spell_power',
        sites: [
          { path: 'weaponStrike.bonus', value: 1, kind: 'linear' },
          { path: 'weaponMult', value: 1, kind: 'multiplier' },
        ],
      },
      1.5,
    );
    expect(preview.base).toEqual([1, 1]);
    expect(preview.tuned).toEqual([2, 1.5]);
    expect(preview.unchanged).toBe(false);
  });

  it('renders the factor as a signed percentage', () => {
    expect(factorDeltaPercent(1.35)).toBe(35);
    expect(factorDeltaPercent(0.8)).toBe(-20);
    expect(factorDeltaPercent(1)).toBe(0);
  });
});

describe('filtering the weapons window', () => {
  const form = tuningFormState(CATALOG, null).weapons;

  it('lists every hand type the catalog carries', () => {
    expect(weaponHands(WEAPONS)).toEqual(['onehand', 'ranged']);
  });

  it('shows every weapon with no filter', () => {
    expect(filterWeapons(WEAPONS, EMPTY_WEAPON_FILTER, form).map((w) => w.id)).toEqual([
      'worn_sword',
      'class_hunter_ranged',
    ]);
  });

  it('narrows by hand type', () => {
    const ids = filterWeapons(WEAPONS, { ...EMPTY_WEAPON_FILTER, hand: 'ranged' }, form).map(
      (w) => w.id,
    );
    expect(ids).toEqual(['class_hunter_ranged']);
  });

  it('matches on name and id', () => {
    expect(
      filterWeapons(WEAPONS, { ...EMPTY_WEAPON_FILTER, search: 'PITTED' }, form).map((w) => w.id),
    ).toEqual(['worn_sword']);
    expect(
      filterWeapons(WEAPONS, { ...EMPTY_WEAPON_FILTER, search: 'hunter' }, form).map((w) => w.id),
    ).toEqual(['class_hunter_ranged']);
  });

  it('narrows to the tuned weapons only', () => {
    const tuned = tuningFormState(CATALOG, null).weapons;
    tuned.class_hunter_ranged.swing_damage = 0.8;
    const ids = filterWeapons(WEAPONS, { ...EMPTY_WEAPON_FILTER, onlyTuned: true }, tuned).map(
      (w) => w.id,
    );
    expect(ids).toEqual(['class_hunter_ranged']);
  });
});

describe('the weapon swing readout', () => {
  it('reports the shipped profile when nothing has moved', () => {
    const preview = weaponPreview(WEAPONS[0], { swing_damage: 1, swing_speed: 1 });
    expect(preview).toEqual({ min: 2, max: 5, speed: 2, dps: 1.75, unchanged: true });
  });

  it('scales the swing damage and recomputes dps', () => {
    const preview = weaponPreview(WEAPONS[0], { swing_damage: 2, swing_speed: 1 });
    expect(preview.min).toBe(4);
    expect(preview.max).toBe(10);
    expect(preview.speed).toBe(2);
    expect(preview.dps).toBe(3.5);
    expect(preview.unchanged).toBe(false);
  });

  it('treats a factor above 1 on the swing timer as a SLOWER weapon', () => {
    // The slider is labelled "swing timer", so 1.5x must mean 1.5x the seconds
    // between swings, which is a damage-per-second nerf.
    const preview = weaponPreview(WEAPONS[0], { swing_damage: 1, swing_speed: 1.5 });
    expect(preview.speed).toBe(3);
    expect(preview.dps).toBeLessThan(WEAPONS[0].dps);
  });

  it('never lets the swing timer fall below one sim tick', () => {
    const preview = weaponPreview(WEAPONS[0], { swing_damage: 1, swing_speed: 0.01 });
    expect(preview.speed).toBeGreaterThanOrEqual(MIN_SWING_SECONDS);
  });

  it('falls back to neutral when a factor is missing', () => {
    expect(weaponPreview(WEAPONS[0], undefined).unchanged).toBe(true);
  });
});

// The dashboard cannot import src/sim, so its copy of the value math would be
// free to drift. Pin it instead, the way permissions.ts is pinned. The pin
// covers EVERYTHING the page duplicates: the scale function (with and without
// a channel), the clamp, the neutral test, the slider constants, the swing
// floor, the time-channel set, and the whole weapon preview. A drift in any of
// them silently rewrites stored factors on the next unrelated save (the form
// clamps on load and savedKey is computed from the clamped form).
describe('the local value math mirrors the sim', () => {
  const kinds: TuningValueKind[] = ['linear', 'deviation', 'fraction', 'multiplier'];
  // -3 at 0.1 exercises the sign-preserving arm of the integer floor
  // (round(-0.3) is -0, so the result must be -1, not 0); -20 alone never
  // reached it. 0.5 at 2 and 3 crosses the deviation zero floor.
  const bases = [0, 0.25, 0.5, 1, 1.4, 2, 3, 9, 12.5, 100, 168, -3, -20];
  const factors = [0.1, 0.5, 0.7, 0.75, 1, 1.25, 1.5, 2, 3];

  it('agrees on every kind, base and factor', () => {
    for (const kind of kinds) {
      for (const base of bases) {
        for (const factor of factors) {
          expect(scaleTunedValue(base, factor, kind), `${kind} base=${base} factor=${factor}`).toBe(
            simScaleTuningValue(base, factor, kind),
          );
        }
      }
    }
  });

  it('agrees on every channel too, time channels included', () => {
    for (const channel of TUNING_CHANNELS) {
      for (const base of bases) {
        for (const factor of factors) {
          expect(
            scaleTunedValue(base, factor, 'linear', channel),
            `linear ${channel} base=${base} factor=${factor}`,
          ).toBe(simScaleTuningValue(base, factor, 'linear', channel));
        }
      }
    }
  });

  it('preserves the sign of a small negative whole base at the slider floor', () => {
    expect(scaleTunedValue(-3, 0.1, 'linear')).toBe(-1);
    expect(simScaleTuningValue(-3, 0.1, 'linear')).toBe(-1);
  });

  it('mirrors the slider constants and the swing floor', () => {
    expect(TUNING_MIN_FACTOR).toBe(SIM_TUNING_MIN_FACTOR);
    expect(TUNING_MAX_FACTOR).toBe(SIM_TUNING_MAX_FACTOR);
    expect(TUNING_FACTOR_STEP).toBe(SIM_TUNING_FACTOR_STEP);
    expect(TUNING_NEUTRAL_FACTOR).toBe(SIM_TUNING_NEUTRAL_FACTOR);
    expect(MIN_SWING_SECONDS).toBe(SIM_MIN_SWING_SECONDS);
    expect([...TIME_TUNING_CHANNELS].sort()).toEqual([...SIM_TIME_TUNING_CHANNELS].sort());
  });

  it('mirrors the factor clamp over the numeric domain', () => {
    const values = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -5,
      0,
      0.001,
      0.1,
      0.999,
      1,
      1.005,
      1.5,
      2.999,
      3,
      99,
    ];
    for (const value of values) {
      expect(clampFactor(value), `clamp ${value}`).toBe(simClampTuningFactor(value));
    }
  });

  it('mirrors the neutral test around the half-step boundary', () => {
    for (const value of [0.99, 0.995, 0.996, 1, 1.004, 1.005, 1.01, 1.2]) {
      expect(isNeutral(value), `neutral ${value}`).toBe(simIsNeutralFactor(value));
    }
  });

  it('previews a weapon exactly as the sim would tune it', () => {
    const profiles = [
      { min: 2, max: 5, speed: 2 },
      { min: 4, max: 8, speed: 2.5 },
      { min: 37, max: 61, speed: 3.4 },
    ];
    for (const profile of profiles) {
      for (const damage of factors) {
        for (const speed of factors) {
          const tuned = simApplyWeaponTuning(profile, {
            swing_damage: damage,
            swing_speed: speed,
          });
          const preview = weaponPreview(
            { ...WEAPONS[0], ...profile, dps: simWeaponDps(profile) },
            { swing_damage: damage, swing_speed: speed },
          );
          const label = `weapon ${JSON.stringify(profile)} dmg=${damage} spd=${speed}`;
          expect(preview.min, label).toBe(tuned.min);
          expect(preview.max, label).toBe(tuned.max);
          expect(preview.speed, label).toBe(tuned.speed);
          expect(preview.dps, label).toBe(simWeaponDps(tuned));
        }
      }
    }
  });
});

// The page builds these keys from the id (`tuning.channel.${channel}`), which
// the admin catalog's literal-key scan cannot see. Pin them against the live
// vocabulary so a new channel cannot ship a blank label.
describe('every vocabulary value has an admin label', () => {
  it('labels every tuning channel', () => {
    for (const channel of TUNING_CHANNELS) {
      const key = `tuning.channel.${channel}`;
      expect(adminEn[key as keyof typeof adminEn], key).toBeTruthy();
    }
  });

  it('labels every ability source the catalog can emit', () => {
    const sources = new Set(
      buildClassTuningCatalog().classes.flatMap((entry) =>
        entry.abilities.map((ability) => ability.source),
      ),
    );
    expect(sources.size).toBeGreaterThan(1);
    const keys: Record<string, string> = {
      base: 'tuning.sourceBase',
      spec: 'tuning.sourceSpec',
      signature: 'tuning.sourceSignature',
      row: 'tuning.sourceRow',
      unspecced: 'tuning.sourceUnspecced',
    };
    for (const source of sources) {
      const key = keys[source];
      expect(key, `no label key for source ${source}`).toBeTruthy();
      expect(adminEn[key as keyof typeof adminEn], key).toBeTruthy();
    }
  });

  it('labels every weapon hand the catalog can emit', () => {
    // The weapon cards and the hand filter both build `tuning.hand.${hand}`
    // dynamically, the same literal-scan blind spot as the channels above.
    const hands = new Set(buildClassTuningCatalog().weapons.map((weapon) => weapon.hand));
    expect(hands.size).toBeGreaterThan(1);
    for (const hand of hands) {
      const key = `tuning.hand.${hand}`;
      expect(adminEn[key as keyof typeof adminEn], key).toBeTruthy();
    }
  });
});
