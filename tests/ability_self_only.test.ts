// Truth table for the "Self only" tooltip classifier (src/ui/hud/action_bar/ability_self_only.ts).
//
// A spellbook/action-bar tooltip shows a "Self only" requirement line when an
// ability can ONLY ever be cast on the caster. That cannot be read off
// `requiresTarget` alone: a hostile self-centered AoE (Frost Nova, Thunder Clap,
// Arcane Explosion) also leaves `requiresTarget` false, so the classifier keys off
// the effect TYPES and excludes ground-targeted casts. This pins the real content
// data so a future ability or an edit to the allowlist can't silently mislabel.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import {
  isSelfOnlyAbility,
  SELF_ONLY_EFFECT_TYPES,
} from '../src/ui/hud/action_bar/ability_self_only';

describe('isSelfOnlyAbility', () => {
  // Pin the allowlist to literals: growing or shrinking it is a deliberate change
  // that should re-green this, not slip through.
  it('gates on exactly the caster-only effect types', () => {
    expect([...SELF_ONLY_EFFECT_TYPES].sort()).toEqual(
      [
        'absorb',
        'dismissPet',
        'gainResource',
        'imbue',
        'lifeTap',
        'selfBuff',
        'selfDamagePctMax',
        'summonDemon',
      ].sort(),
    );
  });

  // Real abilities, one per self-only effect type, plus the classes the line must
  // NOT appear on. Expectations are hand-set from game knowledge, not derived from
  // the function under test.
  const TRUTH: Array<[string, boolean]> = [
    // Self-only beneficial/self-centered casts, covering every allowlisted type.
    ['frost_armor', true], // selfBuff
    ['evasion', true], // selfBuff
    ['ice_barrier', true], // absorb
    ['instant_poison', true], // imbue
    ['life_tap', true], // lifeTap
    ['adrenaline_rush', true], // gainResource
    ['bloodrage', true], // selfDamagePctMax + gainResource
    ['summon_imp', true], // summonDemon
    ['dismiss_pet', true], // dismissPet
    // Empty-effects bag abilities are special-cased elsewhere, so `[].every(...)`
    // must NOT read as self-only. This is the regression the fix pins.
    ['conjure_water', false],
    ['conjure_food', false],
    // Patch Up acts on the hunter's companion, not the hunter.
    ['revive_pet', false], // hot
    // Hostile self-centered AoEs: `requiresTarget` false but not caster-only.
    ['frost_nova', false], // aoeRoot
    ['arcane_explosion', false], // aoeDamage
    ['thunder_clap', false], // aoeDamage + aoeAttackSpeed
    // Ground-targeted cast: aimed at a world point, never self-only.
    ['rain_of_fire', false], // targetMode: 'position'
    // Friendly-target buffs: land on the friendly branch, not self-only.
    ['mark_of_the_wild', false], // requiresTarget + targetType friendly
    ['blessing_of_might', false], // requiresTarget + targetType friendly
    ['arcane_intellect', false], // buffTarget, not in the allowlist
  ];

  it.each(TRUTH)('%s -> self-only %s', (id, expected) => {
    const def = ABILITIES[id];
    expect(def, `missing test fixture ability ${id}`).toBeDefined();
    expect(isSelfOnlyAbility(def)).toBe(expected);
  });

  // The regression class, not just the three named cases: no empty-effects ability
  // may ever be reported self-only.
  it('never reports an empty-effects ability as self-only', () => {
    const offenders = Object.values(ABILITIES).filter(
      (def) => def.effects.length === 0 && isSelfOnlyAbility(def),
    );
    expect(offenders.map((d) => d.id)).toEqual([]);
  });

  // Guard the reachability the other way: the "Self only" path is actually taken
  // by real content, so the classifier isn't accidentally always-false.
  it('classifies at least one real ability as self-only', () => {
    expect(Object.values(ABILITIES).some(isSelfOnlyAbility)).toBe(true);
  });
});
