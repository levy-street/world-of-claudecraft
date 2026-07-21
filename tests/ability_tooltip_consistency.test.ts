// Tooltip-vs-effects consistency guard.
//
// Every ability description is prose over LIVE effect data: the placeholders
// ($d damage, $o over-time total, $b buff value, $t duration) resolve from the
// rank-resolved effects at render time (src/ui/hud.ts + src/ui/ability_damage.ts).
// This suite is the drift net behind the 2026-07 tooltip audit (PRD: tooltips
// must match actual effects):
//   1. every placeholder used in a description is RESOLVABLE for that ability
//      at every rank (an unresolvable one renders an empty string, the old
//      Earthquake/Consecration/Sunder Armor bug);
//   2. only the four supported placeholders appear;
//   3. every bare number hardcoded in a description matches the resolved
//      effect/def data at EVERY rank, so a rank-2+ tooltip can never contradict
//      what the cast actually does (the old "absorbing 48 damage" / "attack
//      power by 20" class of bug). A number that drifts with rank must use a
//      placeholder instead.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import { ABILITIES, CLASSES } from '../src/sim/data';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import {
  abilityBuffValue,
  abilityDurationValue,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilitySecondaryEffect,
  abilityTemporalHourglassValues,
} from '../src/ui/ability_damage';

// Numbers in prose this guard cannot derive from data, each with its source of
// truth. Keep this list SHORT and justified; prefer a placeholder in the
// description over a new entry here.
const NUMBER_ALLOWLIST: Record<string, number[]> = {
  // "generating 9 rage and stunning it for 1 sec": both are constants in the
  // charge arm of effect_dispatch.ts, not effect fields.
  charge: [9, 1],
  bear_charge: [9, 1],
  // "30% more threat": the stance threat multiplier inside threatModifier.
  // Bear form's "armor +90%" is the recalcPlayerStats multiplier (1.9) in
  // entity.ts, not the form effect's value.
  defensive_stance: [30],
  // Battle Stance's rage multiplier is applied by resourceGainMultiplier.
  battle_stance: [10],
  // Valor Roar's Protection-only damage reduction is applied when the party
  // maximum-health aura is created, rather than stored on its shared effect.
  rallying_cry: [5],
  bear_form: [30, 90],
  // "compelled to attack you for 3 sec": the taunt compel window in threat.ts.
  taunt: [3],
  holy_taunt: [3],
  growl: [3],
  // "attack power +8 plus 2 per level": the cat-form AP constants in
  // recalcPlayerStats (entity.ts), not effect fields.
  cat_form: [8, 2],
  // "for 30 sec": the sunder aura duration hardcoded in effect_dispatch.ts.
  faerie_fire: [30],
  expose_armor: [30],
  sunder_armor: [30],
  // "Conjures 2 ...": the stack size hardcoded in casting_lifecycle.ts.
  conjure_water: [2],
  conjure_food: [2],
  // Patch Up's dead-pet revive fraction is owned by the pet lifecycle branch;
  // the living-pet HoT remains fully data-driven by the ability effect.
  revive_pet: [35],
};

// Every resolved rank of every class ability (deduped by rank).
function resolvedRanks(cls: PlayerClass): Map<string, KnownAbility[]> {
  const byId = new Map<string, KnownAbility[]>();
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const known of abilitiesKnownAt(cls, level)) {
      const list = byId.get(known.def.id) ?? [];
      if (!list.some((k) => k.rank === known.rank)) list.push(known);
      byId.set(known.def.id, list);
    }
  }
  return byId;
}

// All numbers a description may legitimately cite for one resolved rank: every
// numeric leaf of the resolved effects and the def, plus derived forms readers
// see (percent from a fraction or multiplier, minutes from seconds, a channel's
// tick cadence).
function trueNumbers(known: KnownAbility): Set<number> {
  const out = new Set<number>();
  const add = (v: number) => {
    if (!Number.isFinite(v)) return;
    out.add(v);
    out.add(Math.round(v * 100) / 100);
  };
  const collect = (value: unknown) => {
    if (typeof value === 'number') {
      add(value);
      if (value > 0 && value < 1) {
        add(value * 100); // fraction as percent: 0.4 -> "40%"
        add((1 - value) * 100); // slow multiplier as reduction: 0.5 -> "slowing by 50%"
      }
      if (value > 1 && value <= 3) {
        add((value - 1) * 100); // multiplier as increase: 1.9 -> "+90%"
        add(value * 100); // multiplier as weapon-damage percent: 1.5 -> "150% weapon damage"
      }
      if (value >= 60 && value % 60 === 0) add(value / 60); // seconds as minutes
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
    }
  };
  // The RESOLVED effects only: collecting from def.effects/def.ranks would let a
  // rank-1 number pass as "true" at rank 3, the exact drift this test exists to
  // catch. The rest of the def (range, cooldown, channel, combo riders, ...) is
  // rank-invariant and fair game for prose.
  collect(known.effects);
  const { effects: _effects, ranks: _ranks, ...defStatics } = known.def;
  collect(defStatics);
  add(known.cost);
  add(known.castTime);
  add(known.cooldown);
  const ch = known.def.channel;
  if (ch && ch.ticks > 0) add(ch.duration / ch.ticks);
  return out;
}

// Bare numbers in the prose, with every $-placeholder stripped first so the
// placeholder letters and their substitutions never count.
function proseNumbers(description: string): number[] {
  return (description.replace(/\$[a-z]/g, ' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const PLACEHOLDERS = /\$([a-zA-Z])/g;
const SUPPORTED = new Set(['d', 'o', 'b', 't', 'h', 'e', 'p', 'g', 's', 'a']);

describe('ability descriptions match their resolved effects', () => {
  const classes = Object.keys(CLASSES) as PlayerClass[];

  it('uses only supported dynamic placeholders', () => {
    for (const a of Object.values(ABILITIES)) {
      for (const m of a.description.matchAll(PLACEHOLDERS)) {
        expect(SUPPORTED.has(m[1]), `${a.id}: unknown placeholder $${m[1]}`).toBe(true);
      }
      // Brace-form tokens are reserved for the translated catalog; the sim
      // source uses the $-form so the entity-i18n fallback path always works.
      expect(a.description, `${a.id}: use $-placeholders in the sim source`).not.toMatch(
        /\{[A-Za-z0-9_]+\}/,
      );
    }
  });

  it('every placeholder resolves at every rank (no empty tooltip numbers)', () => {
    for (const cls of classes) {
      for (const [id, ranks] of resolvedRanks(cls)) {
        const desc = ABILITIES[id].description;
        for (const known of ranks) {
          const at = `${cls}.${id} rank ${known.rank}`;
          if (desc.includes('$d')) {
            expect(
              abilityPrimaryEffect(known) ?? abilitySecondaryEffect(known),
              `${at}: $d has no effect to read`,
            ).toBeTruthy();
          }
          if (desc.includes('$o')) {
            expect(abilityOverTimeEffect(known), `${at}: $o has no dot/hot`).toBeTruthy();
          }
          if (desc.includes('$b')) {
            expect(abilityBuffValue(known), `${at}: $b has no buff value`).not.toBeNull();
          }
          if (desc.includes('$t')) {
            expect(abilityDurationValue(known), `${at}: $t has no timed effect`).not.toBeNull();
          }
          if (/\$(?:h|e|p|g|s|a)/.test(desc)) {
            expect(
              abilityTemporalHourglassValues(known),
              `${at}: Hourglass placeholders have no temporalHourglass effect`,
            ).not.toBeNull();
          }
        }
      }
    }
  });

  it('hardcoded numbers hold at every rank (drifting numbers must be placeholders)', () => {
    const failures: string[] = [];
    for (const cls of classes) {
      for (const [id, ranks] of resolvedRanks(cls)) {
        const desc = ABILITIES[id].description;
        const cited = proseNumbers(desc);
        if (!cited.length) continue;
        const allow = new Set(NUMBER_ALLOWLIST[id] ?? []);
        for (const n of cited) {
          if (allow.has(n)) continue;
          const staleRanks = ranks.filter((known) => !trueNumbers(known).has(n));
          if (staleRanks.length) {
            failures.push(
              `${cls}.${id}: "${desc}" cites ${n}, not true at rank(s) ${staleRanks
                .map((k) => k.rank)
                .join(', ')}`,
            );
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
