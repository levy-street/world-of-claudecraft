// The class power tuner's COVERAGE GUARD.
//
// The tuner promises the admin dashboard covers every aspect of every spell of
// every class, including classes reworked after it shipped. Nothing about a
// hand-written classification table makes that true on its own, so this suite
// walks the LIVE content tables and fails when reality outgrows the table:
//
//   - a numeric field on a live ability effect that `EFFECT_TUNED_FIELDS` does
//     not classify and `UNTUNED_EFFECT_FIELDS` does not explicitly excuse
//   - a numeric field on the AbilityDef itself in the same position
//   - an aura kind whose `value` nobody has decided the semantics of
//   - a class, spec, or ability missing from the catalog the dashboard renders
//
// When one of these fires on a rework, the fix is a row in
// `src/sim/tuning/ability_fields.ts`, not a change here.

import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import {
  AURA_VALUE_EFFECTS,
  abilityTuningKnobs,
  buildClassTuningCatalog,
  EFFECT_TUNED_FIELDS,
  isTunableEntryId,
  MAGNITUDE_AURA_KINDS,
  MARKER_AURA_KINDS,
  MULTIPLIER_AURA_KINDS,
  REFLECT_AURA_KINDS,
  TUNING_CHANNELS,
  UNTUNED_DEF_FIELDS,
  UNTUNED_EFFECT_FIELDS,
  UNTUNED_RANK_FIELDS,
} from '../src/sim/tuning';
import { type AbilityDef, type AbilityEffect, ALL_CLASSES } from '../src/sim/types';

// Every numeric leaf under `node`, as a dotted path with array hops collapsed
// to `[]` so it can be matched against the spec table's patterns.
function numericPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'number') return prefix ? [prefix] : [];
  if (Array.isArray(node)) {
    const seen = new Set<string>();
    for (const item of node) for (const path of numericPaths(item, `${prefix}[]`)) seen.add(path);
    return [...seen];
  }
  if (typeof node !== 'object' || node === null) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(...numericPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

function allEffects(def: AbilityDef): AbilityEffect[] {
  return [...def.effects, ...(def.ranks ?? []).flatMap((rank) => rank.effects)];
}

const allDefs = Object.values(ABILITIES);

describe('every numeric ability field is classified', () => {
  it('classifies every numeric field on every live effect', () => {
    const unclassified = new Set<string>();
    for (const def of allDefs) {
      for (const effect of allEffects(def)) {
        const table = EFFECT_TUNED_FIELDS[effect.type] ?? {};
        for (const path of numericPaths(effect)) {
          if (path === 'value' && AURA_VALUE_EFFECTS.has(effect.type)) continue;
          // the table writes array hops as `stages[].min`, the walk as `stages[].min` too
          if (path in table) continue;
          if (UNTUNED_EFFECT_FIELDS.has(`${effect.type}.${path}`)) continue;
          unclassified.add(`${effect.type}.${path}`);
        }
      }
    }
    expect([...unclassified].sort()).toEqual([]);
  });

  it('classifies every numeric field on the ability def itself', () => {
    // Fields the walker reaches, by the names it uses. Anything numeric on a
    // live def outside this set and UNTUNED_DEF_FIELDS is a new unclassified knob.
    const walked = new Set([
      'cost',
      'cooldown',
      'castTime',
      'range',
      'minRange',
      'spendResourceCap',
      'maxCharges',
      'awardsCombo',
      'requiresTargetHpBelow',
      'executeThreshold',
      'ruinCost',
      'soulFragmentCost',
      'channel.duration',
      'threat.flat',
      'threat.mult',
      'powerCoeffMult',
    ]);
    const skip = new Set(['effects', 'ranks']);
    const unclassified = new Set<string>();
    for (const def of allDefs) {
      for (const [key, value] of Object.entries(def)) {
        if (skip.has(key)) continue;
        for (const path of numericPaths(value, key)) {
          if (walked.has(path) || UNTUNED_DEF_FIELDS.has(path)) continue;
          unclassified.add(path);
        }
      }
    }
    expect([...unclassified].sort()).toEqual([]);
  });

  it('declares the semantics of every aura kind a live ability applies', () => {
    // Every live kind must be DECLARED in exactly one of the four sets. The
    // linear default in auraValueFieldSpec still exists as a runtime fallback,
    // but a kind reaching it undeclared fails here: the previous version of
    // this case ended its chain with Number.isFinite over an already-checked
    // number, which could only ever fail on NaN, i.e. never.
    const undecided = new Set<string>();
    for (const def of allDefs) {
      for (const effect of allEffects(def)) {
        if (!AURA_VALUE_EFFECTS.has(effect.type)) continue;
        const record = effect as unknown as Record<string, unknown>;
        const kind = record.kind;
        if (typeof kind !== 'string' || typeof record.value !== 'number') continue;
        const decided =
          MARKER_AURA_KINDS.has(kind) ||
          MULTIPLIER_AURA_KINDS.has(kind) ||
          REFLECT_AURA_KINDS.has(kind) ||
          MAGNITUDE_AURA_KINDS.has(kind);
        if (!decided) undecided.add(kind);
      }
    }
    expect([...undecided].sort()).toEqual([]);
  });

  it('keeps the four aura-kind sets disjoint', () => {
    const sets: [string, ReadonlySet<string>][] = [
      ['marker', MARKER_AURA_KINDS],
      ['multiplier', MULTIPLIER_AURA_KINDS],
      ['reflect', REFLECT_AURA_KINDS],
      ['magnitude', MAGNITUDE_AURA_KINDS],
    ];
    for (let a = 0; a < sets.length; a++) {
      for (let b = a + 1; b < sets.length; b++) {
        const overlap = [...sets[a][1]].filter((kind) => sets[b][1].has(kind));
        expect(overlap, `${sets[a][0]} overlaps ${sets[b][0]}`).toEqual([]);
      }
    }
  });

  it('never routes a multiplier aura through the plain-magnitude default', () => {
    // A multiplier around 1 scaled as a plain magnitude is the classic way this
    // table goes wrong: a 1.4 speed aura would become 2.1 instead of 1.56, and
    // a 0.5 stealth walk would become 0.05 at the slider floor instead of 0.95.
    // Both sides of 1 are suspicious; a share-shaped magnitude that legitimately
    // sits in the band is excused BY NAME below, with the reasoning at the row,
    // so a new sub-1 multiplier kind fails until somebody decides it. (The
    // previous version only looked above 1 and was structurally blind to
    // stealth's 0.5.)
    const EXCUSED_BAND_MAGNITUDES: ReadonlySet<string> = new Set<string>([
      // 0..1 SHARES consumed as fractions added onto a rate, never multiplied
      // in as a factor around 1. Consumption sites verified per row.
      'bleed_vuln', // bleedAmp += pctValue(value), auras.ts
      'buff_avatar', // damageDone += value, combat/damage.ts
      'buff_spelldmg', // spell damage share
      'die_by_sword', // bonusDodge += value / reduction += value
      'guardian_ward', // maxHp * value death-save restore
      'mortal_wound', // heal mult *= 1 - value, combat/heal.ts
      'overload', // amp = 1 + value, casting_lifecycle.ts
      'power_echo', // echo repeats the resolved amount at this share
      'sacred_form', // bonus += value, paladin_support.ts
      'shield_wall', // reduction share; paladinAegis damageReduction too
      'vuln_source', // amount *= 1 + sum(value), combat/damage.ts
      // additive chance/percentage shares from the stat and damage passes
      // (entity.ts recalcPlayerStats, combat/damage.ts): 0.2 block chance,
      // 0.15 dodge, a 0.2 damage-reduction share, never factors around 1
      'buff_block',
      'buff_dmg_done',
      'buff_dodge',
      'buff_dr',
      'buff_dr_phys',
      'buff_heal_done',
      'buff_healing_done',
      'buff_reckless',
      'buff_spellhaste', // the share variant; buff_spellhaste_mult is the multiplier one
    ]);
    const suspicious = new Set<string>();
    for (const def of allDefs) {
      for (const effect of allEffects(def)) {
        if (!AURA_VALUE_EFFECTS.has(effect.type)) continue;
        const record = effect as unknown as Record<string, unknown>;
        const kind = record.kind;
        const value = record.value;
        if (typeof kind !== 'string' || typeof value !== 'number') continue;
        if (MARKER_AURA_KINDS.has(kind) || MULTIPLIER_AURA_KINDS.has(kind)) continue;
        if (REFLECT_AURA_KINDS.has(kind)) continue;
        if (EXCUSED_BAND_MAGNITUDES.has(kind)) continue;
        // a movement/haste/form multiplier is authored near 1 on either side
        if (value > 0 && value < 2 && value !== 1 && !Number.isInteger(value)) {
          suspicious.add(`${kind}=${value}`);
        }
      }
    }
    expect([...suspicious].sort()).toEqual([]);
  });

  it('classifies every fraction-kind base as a real 0..1 share', () => {
    // fraction output clamps to [0, 1], so a percent-POINT base (armorPct: 30)
    // classified as a fraction collapses to 1 the moment any factor moves it:
    // exactly how veilboundMarch's +30% armor became +1% and Trueshot Aura's
    // +10% AP became +1%. A fraction row whose live base exceeds 1 is always
    // that same misclassification, so fail on it here.
    const offenders: string[] = [];
    for (const def of allDefs) {
      for (const site of abilityTuningKnobs(def, { includeInert: true })) {
        if (site.kind !== 'fraction') continue;
        if (site.value < 0 || site.value > 1) {
          offenders.push(`${def.id}.${site.path}=${site.value}`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('classifies every numeric field on every live rank', () => {
    // The walker reaches a rank's cost, castTime and threatFlat (plus its
    // effects, covered by the effect case above). Everything else numeric on an
    // AbilityRank must be excused in UNTUNED_RANK_FIELDS, or a rework could add
    // a sim-reachable rank number that is invisible to this guard and untunable.
    const walked = new Set(['cost', 'castTime', 'threatFlat']);
    const unclassified = new Set<string>();
    for (const def of allDefs) {
      for (const rank of def.ranks ?? []) {
        for (const [key, value] of Object.entries(rank)) {
          if (key === 'effects') continue;
          for (const path of numericPaths(value, key)) {
            if (walked.has(path) || UNTUNED_RANK_FIELDS.has(path)) continue;
            unclassified.add(path);
          }
        }
      }
    }
    expect([...unclassified].sort()).toEqual([]);
  });
});

describe('the catalog the dashboard renders', () => {
  const catalog = buildClassTuningCatalog();

  it('has a window for every class, with its specs', () => {
    expect(catalog.classes.map((entry) => entry.id)).toEqual([...ALL_CLASSES]);
    for (const entry of catalog.classes) {
      expect(entry.name).toBe(CLASSES[entry.id].name);
      const specs = TALENTS[entry.id].specs.map((spec) => spec.id);
      expect(entry.specs.map((spec) => spec.id)).toEqual(specs);
      expect(entry.abilities.length).toBeGreaterThan(0);
    }
  });

  it('lists every ability of every class exactly once', () => {
    const listed = catalog.classes.flatMap((entry) => entry.abilities.map((a) => a.id));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(Object.keys(ABILITIES).sort());
  });

  it('names the specs that can cast each ability, or marks it unspecced', () => {
    for (const entry of catalog.classes) {
      for (const ability of entry.abilities) {
        if (ability.specs.length === 0) {
          // the only legitimate empty case: every spec excludes it outright
          expect(ability.source, `${ability.id} reaches no spec`).toBe('unspecced');
          const excluded = ABILITIES[ability.id].excludeSpecs ?? [];
          for (const spec of entry.specs) expect(excluded).toContain(spec.id);
          continue;
        }
        expect(ability.source).not.toBe('unspecced');
        for (const spec of ability.specs) {
          expect(entry.specs.some((s) => s.id === spec)).toBe(true);
        }
      }
    }
  });

  it('scopes a spec-gated ability to its own spec and no other', () => {
    const warrior = catalog.classes.find((entry) => entry.id === 'warrior');
    const gated = warrior?.abilities.filter((ability) => ability.source === 'spec') ?? [];
    expect(gated.length).toBeGreaterThan(0);
    for (const ability of gated) {
      const def = ABILITIES[ability.id];
      if (def.specs) expect(ability.specs).toEqual(def.specs.filter((s) => s !== undefined));
      // A level-scoped exclusion is a kit hand-off, so the excluded spec keeps
      // the ability (it casts it below excludeSpecsAtLevel); only an unscoped
      // exclusion actually removes it.
      if (def.excludeSpecs && def.excludeSpecsAtLevel === undefined) {
        for (const excluded of def.excludeSpecs) expect(ability.specs).not.toContain(excluded);
      }
    }
  });

  it('marks each spec signature as reachable only by that spec', () => {
    for (const entry of catalog.classes) {
      for (const spec of TALENTS[entry.id].specs) {
        const ability = entry.abilities.find((a) => a.id === spec.signature);
        expect(ability, `${entry.id} signature ${spec.signature}`).toBeDefined();
        expect(ability?.source).toBe('signature');
        expect(ability?.specs).toEqual([spec.id]);
      }
    }
  });

  it('offers only channels from the closed vocabulary, and only live ones', () => {
    for (const entry of catalog.classes) {
      for (const ability of entry.abilities) {
        for (const channel of ability.channels) {
          expect(TUNING_CHANNELS).toContain(channel.channel);
          expect(channel.sites.length).toBeGreaterThan(0);
        }
        const channels = ability.channels.map((c) => c.channel);
        expect(new Set(channels).size).toBe(channels.length);
      }
    }
  });

  it('agrees with the walker about what each ability exposes', () => {
    for (const entry of catalog.classes) {
      for (const ability of entry.abilities) {
        const fromWalker = abilityTuningKnobs(ABILITIES[ability.id]);
        const fromCatalog = ability.channels.flatMap((channel) =>
          channel.sites.map((site) => ({ channel: channel.channel, ...site })),
        );
        expect(fromCatalog.length).toBe(fromWalker.length);
      }
    }
  });

  it('carries every weapon whose white damage the sim reads', () => {
    // Every item with a WeaponInfo drives an auto-attack, so every one of them
    // must be tunable; a weapon missing here is white damage nobody can touch.
    const listed = new Set(catalog.weapons.map((weapon) => weapon.id));
    for (const item of Object.values(ITEMS)) {
      if (!(item as { weapon?: unknown }).weapon) continue;
      expect(listed.has(item.id), `weapon item ${item.id} is not tunable`).toBe(true);
    }
    // ...plus the per-class ranged profiles, which are kit rather than loot.
    for (const cls of ALL_CLASSES) {
      if (!CLASSES[cls].ranged) continue;
      expect(listed.has(`class_${cls}_ranged`), `${cls} ranged profile missing`).toBe(true);
    }
    expect(catalog.weapons.length).toBeGreaterThan(100);
  });

  it('gives every weapon both swing channels and an honest dps readout', () => {
    for (const weapon of catalog.weapons) {
      const channels = weapon.channels.map((channel) => channel.channel).sort();
      expect(channels, weapon.id).toEqual(['swing_damage', 'swing_speed']);
      expect(weapon.speed).toBeGreaterThan(0);
      const expected = Math.round(((weapon.min + weapon.max) / 2 / weapon.speed) * 100) / 100;
      expect(Math.abs(weapon.dps - expected), weapon.id).toBeLessThan(0.02);
    }
  });

  // The sanitizer drops any entry id it cannot trust, silently and by design (a
  // rotted document must never keep a realm from booting). That makes the id
  // pattern a real constraint on CONTENT: an ability or item whose id it rejects
  // would get a slider in the catalog that could never be saved. Pin it here so
  // the rejection surfaces as a red guard rather than a knob that does nothing.
  it('gives every tunable entry an id a document can actually store', () => {
    for (const classInfo of catalog.classes) {
      for (const ability of classInfo.abilities) {
        expect(isTunableEntryId(ability.id), `ability id ${ability.id} cannot be stored`).toBe(
          true,
        );
      }
    }
    for (const weapon of catalog.weapons) {
      expect(isTunableEntryId(weapon.id), `weapon id ${weapon.id} cannot be stored`).toBe(true);
    }
    // and the pin is decisive: an id shaped like the ones that would break it
    // really is rejected.
    expect(isTunableEntryId('worn-sword')).toBe(false);
    expect(isTunableEntryId('Worn_Sword')).toBe(false);
    expect(isTunableEntryId('a'.repeat(65))).toBe(false);
  });

  it('leaves sliders off the passives whose power lives in talent modifiers', () => {
    const knobless = catalog.classes
      .flatMap((entry) => entry.abilities)
      .filter((ability) => ability.channels.length === 0);
    // Every knobless ability must be one the engine never resolves numbers for:
    // a passive marker, or a pure command with no magnitude of its own.
    for (const ability of knobless) {
      const def = ABILITIES[ability.id];
      const hasMagnitude = allEffects(def).some(
        (effect) => numericPaths(effect).filter((p) => p !== 'value').length > 0,
      );
      expect(hasMagnitude, `${ability.id} has numbers but no sliders`).toBe(false);
    }
  });
});
