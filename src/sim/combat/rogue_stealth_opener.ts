// Snapshot actual stealth before removal. Its weapon and flat opener bonuses
// replace Veiled Edge; Gloam or Veil access alone never qualifies.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const TRUE_STEALTH_OPENER_ABILITY_ID = 'ambush';
export const TRUE_STEALTH_OPENER_MULT = 2;

function specOf(ctx: SimContext, p: Entity): string | null {
  if (p.kind !== 'player') return null;
  const meta = ctx.players.get(p.id);
  return meta ? ctx.playerMods(meta).spec : null;
}

// Snapshot whether THIS cast is a genuine stealth opener, before the cast's
// own breakStealth call removes the stealth aura. Gated to Skulduggery
// (subtlety) and Lurker's Strike (ambush) only.
export function capturedTrueStealthAmbush(ctx: SimContext, p: Entity, abilityId: string): boolean {
  if (abilityId !== TRUE_STEALTH_OPENER_ABILITY_ID) return false;
  if (specOf(ctx, p) !== 'subtlety') return false;
  return p.auras.some((aura) => aura.kind === 'stealth');
}

// weaponMult factor for the weaponStrike case; 1 (no change) unless the cast
// was captured as a genuine stealth opener above. Pure, draws no rng.
export function trueStealthOpenerMultiplier(wasTrueStealthOpener: boolean): number {
  return wasTrueStealthOpener ? TRUE_STEALTH_OPENER_MULT : 1;
}

// Doubles the flat weaponStrike bonus the same way. Kept as its own function
// (rather than folding into the weaponMult site) since the effect's `bonus`
// and `weaponMult` are two separate locals at the call site, and `bonus` is
// an integer strike rider, not a multiplier.
export function trueStealthOpenerScaleBonus(wasTrueStealthOpener: boolean, bonus: number): number {
  return wasTrueStealthOpener ? Math.round(bonus * TRUE_STEALTH_OPENER_MULT) : bonus;
}
