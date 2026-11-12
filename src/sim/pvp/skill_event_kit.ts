// The skill event kit (owner brief, 2026-11-12): while a skill event runs, a
// fighter's normal abilities are locked. They fight with the event's own small
// kit (verbs resolved by the event's rule module, never AbilityDefs) plus ONE
// ability they chose from their own class: the keepsake. Full immunities and
// damage abilities can never be the keepsake, so the class adds a little help
// (movement, control or defence) and never the decisive blow.
//
// The cast lock follows the vehicle precedent (castAbility returns early); the
// state lives on the ActiveSkillEvent, so it ends with the event and nothing
// is persisted or restored.

import type { AbilityDef } from '../types';
import type { SkillEventKind } from './skill_event_rules';
import type { ActiveSkillEvent } from './skill_events';

/** The event kit's verbs, by event, in action bar order. */
export const SKILL_EVENT_VERBS: Readonly<Record<SkillEventKind, readonly string[]>> = {
  riposte: ['lunge', 'guard', 'feint', 'sidestep'],
  footprints: ['sweep', 'hush', 'pebble'],
  tongues: ['rite', 'sever', 'false_start', 'shove'],
  bankshot: ['bolt', 'brace', 'dash'],
  common_hand: [],
};

/** Never a keepsake: full immunities, death denial, a blocked hit (worth a whole
 *  heart here), the full self-heal and the vanishes (owner brief: "keep the full
 *  immunity ones off"). */
export const KEEPSAKE_EXCLUDED_IDS: ReadonlySet<string> = new Set([
  'ice_block',
  'valkyrs_calling',
  'sacred_bulwark',
  'faithforged_guard',
  'lay_on_hands',
  'vanish',
  'greater_invisibility',
]);

/** Effect types that deal damage: an ability carrying one is never a keepsake
 *  (the class helps with movement, control or defence, never the hit). */
const DAMAGE_EFFECTS: ReadonlySet<string> = new Set([
  'directDamage',
  'weaponStrike',
  'weaponDamage',
  'aoeDamage',
  'chainDamage',
  'finisherDamage',
  'groundAoE',
  'dot',
  'empoweredCone',
  'consumeDot',
  'aoeAttackPower',
  'sunder',
]);

/** Can this ability be a fighter's keepsake? Pure: reads the definition only. */
export function keepsakeEligible(def: AbilityDef): boolean {
  if (KEEPSAKE_EXCLUDED_IDS.has(def.id)) return false;
  const flags = def as AbilityDef & { passive?: boolean; hiddenFromPlayer?: boolean };
  if (flags.passive || flags.hiddenFromPlayer || def.onNextSwing) return false;
  return !def.effects.some((effect) => DAMAGE_EFFECTS.has(effect.type));
}

/** One fighter's kit state for the running event. */
export interface SkillEventKitState {
  keepsake: string | null;
  /** When each verb is ready again (sim seconds). */
  readyAt: Map<string, number>;
  /** Event-specific state, owned by the event's rule module. */
  riposte?: RiposteKitState;
}

export interface RiposteKitState {
  /** A lunge winding up: when it lands. */
  lungeAt: number | null;
  /** A raised guard: when it was raised and when it drops on its own. */
  guardFrom: number | null;
  guardUntil: number | null;
  /** Open after a guard held too long, or staggered by a riposte: no verbs. */
  openUntil: number;
  /** The last lunge (the anti-passive rule: no guard without one lately). */
  lastLungeAt: number;
}

export function kitFor(ev: ActiveSkillEvent, pid: number): SkillEventKitState {
  let kit = ev.kits.get(pid);
  if (!kit) {
    kit = { keepsake: null, readyAt: new Map() };
    ev.kits.set(pid, kit);
  }
  return kit;
}

/** Is `verb` off cooldown for this fighter at `now`? */
export function verbReady(kit: SkillEventKitState, verb: string, now: number): boolean {
  return (kit.readyAt.get(verb) ?? 0) <= now;
}
