// Which button the Proving Shore teaches each class to press on a target.
//
// The island's combat lessons cannot say "press 1" and mean it for everyone:
// a mage's first real press is a 30 yd cast on slot 2, a rogue's is a melee
// strike, and a warrior's Reaver Strike costs rage they do not have until
// they have already swung. The coach card, the floating bubble and the
// effigy quests all need the same answer, so it is DERIVED here from the
// live class kit rather than written down three times and left to drift.
//
// Derived, deliberately: a kit edit (a new level-1 ability, a learnLevel
// move, a rebalance) changes what the island teaches in the same breath.
// The alternative, a hand-written class -> ability map, is exactly the
// shape that goes stale silently.
//
// Pure sim: no DOM, no Three, no rng, no wall clock. Driven directly by
// tests/starting_attack.test.ts.

import { ABILITIES, abilitiesKnownAt, CLASSES } from '../content/classes';
import type { PlayerClass } from '../types';

/** Effect types that make an ability an ATTACK for teaching purposes: it
 *  takes health off a hostile target. Buffs, heals, imbues and summons are
 *  all real level-1 buttons, but none of them is what "hit the effigy"
 *  means. */
const DAMAGE_EFFECTS: ReadonlySet<string> = new Set([
  'directDamage',
  'weaponDamage',
  'weaponStrike',
  'finisherDamage',
  'dot',
]);

export interface StartingAttack {
  /** The ability the island names, or null when the class has nothing but
   *  the melee autoattack toggle to press. */
  abilityId: string | null;
  /** The action-bar slot the lesson points at. Slot 0 is the Attack toggle
   *  (key 1), so a class with no level-1 attack is sent there. */
  slot: 'slot0' | 'slot1';
  /** True when the taught press is the plain autoattack toggle rather than
   *  an authored ability. */
  isAutoAttack: boolean;
  /** True when the ability cannot be pressed from a standing start because
   *  its resource begins empty (a fresh warrior has 0 rage). The lesson has
   *  to hand that resource over or teach the swing that builds it, rather
   *  than pointing at a button that greys out. */
  needsResourceFirst: boolean;
  /** Resource the ability bills, when it bills one at all. */
  resourceCost: number;
}

/** Resources a level-1 character starts EMPTY and has to build in combat.
 *  Mana, energy and focus all start full, so only rage strands a lesson. */
const STARTS_EMPTY: ReadonlySet<string> = new Set(['rage']);

/** True when this ability is a hostile damage press. */
export function isAttackAbility(abilityId: string): boolean {
  const def = ABILITIES[abilityId];
  if (!def) return false;
  if (def.targetType === 'friendly') return false;
  return (def.effects ?? []).some((e) => DAMAGE_EFFECTS.has(e.type));
}

/**
 * The attack a fresh level-1 character of this class can actually press.
 *
 * Preference order is the order the lesson wants to teach in: a press that
 * lands NOW beats one that queues on the next swing, and one the player can
 * afford beats one they cannot. Stealth openers are skipped outright (a
 * rogue is not stealthed when they walk up to an effigy), as are abilities
 * that spend a combo resource they have not built.
 */
export function startingAttackFor(cls: PlayerClass): StartingAttack {
  const known = abilitiesKnownAt(cls, 1).map((k) => k.def);
  const attacks = known.filter((d) => d && isAttackAbility(d.id));
  const usable = attacks.filter((d) => !d.requiresStealth && !d.spendsCombo);
  // An instant, affordable press first; then anything at all.
  const immediate = usable.find((d) => !d.onNextSwing && !STARTS_EMPTY.has(resourceOf(cls)));
  const chosen = immediate ?? usable[0] ?? null;
  if (!chosen) {
    return {
      abilityId: null,
      slot: 'slot0',
      isAutoAttack: true,
      needsResourceFirst: false,
      resourceCost: 0,
    };
  }
  const cost = chosen.cost ?? 0;
  return {
    abilityId: chosen.id,
    // Slot 0 is the Attack toggle; every authored ability the island teaches
    // sits on the first assignable slot after it.
    slot: 'slot1',
    isAutoAttack: false,
    needsResourceFirst: cost > 0 && STARTS_EMPTY.has(resourceOf(cls)),
    resourceCost: cost,
  };
}

function resourceOf(cls: PlayerClass): string {
  return CLASSES[cls].resourceType;
}
