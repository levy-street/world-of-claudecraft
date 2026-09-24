// The per-cast resolved ability: an authored AbilityDef after ranks, talents,
// set bonuses and the cast-time empowerments have had their say. Every field
// past `def` is cast-scoped state the resolve pipeline (sim.ts resolveAbility
// and the casting lifecycle's copy-on-write consumes) stamps for THIS press.
// Type-only; lives beside sim.ts rather than in it so the coordinator does not
// grow with every new per-cast marker.
import type { AbilityOutputScaling } from './ability_output_scaling';
import type { AbilityDef, AbilityEffect } from './types';

export interface ResolvedAbility {
  def: AbilityDef;
  outputScaling?: AbilityOutputScaling;
  rank: number;
  cost: number;
  castTime: number;
  cooldown: number; // base def.cooldown, after talent cooldown modifiers
  /** Cooldown map key when a cooldown-carrying transform shares the base
   *  button's clock (one slot, one clock); absent for every other resolve. */
  cooldownId?: string;
  effects: AbilityEffect[];
  threatFlat: number; // classic bonus threat on a successful use
  threatMult: number; // classic multiplier on this ability's damage-threat
  castWhileMoving?: boolean; // talent-granted mobility (def.castWhileMoving covers baseline)
  damagePushbackImmune?: boolean; // talent-granted immunity to damage-driven cast pushback
  ignoreStealthRequirement?: boolean; // Cheap Trick: the resolved ability drops requiresStealth
  // Set when a next_cast_free/next_execute_free empowerment (e.g. Borrowed Tempo)
  // zeroed this cast's cost: a spendsCombo finisher cast this way banks its combo
  // points instead of spending them (issue #2426), since "free" means the whole
  // cast, not just the resource bill. Never set by a next_cast_cheap/next_cast_instant
  // consume (those only discount cost/cast time, e.g. Knife's Dividend/Formrush).
  freeCast?: boolean;
  // Nature's Boon window power on THIS cast (combat/druid_natures_boon.ts), stamped
  // on the resolved copy before the window is spent. runEffects folds it into the
  // cast-scoped heal multiplier so the printed percent reaches the WHOLE heal, Spell
  // Power rider included, not just the authored base. Absent (1) on every other cast.
  naturesBoonPower?: number;
  charges?: number; // authored stored uses; undefined means one use
  bonusCharges?: number; // talent-added uses, kept distinct from native maxCharges
  /** Individual Temporal Echo conversion after worn-set resolution. */
  echoConvertSingle?: number;
  /** Destruction-only cast-time reservation; consumed once even if a projectile resists/fizzles. */
  ruinousBrandCopy?: { targetId: number; value: number };
  /** 1-based authoritative charge stage for hold-to-charge spells. */
  empowerLevel?: number;
  hunterApex?: boolean;
  hunterOverdraw?: boolean;
  hunterRhythm?: boolean;
}
