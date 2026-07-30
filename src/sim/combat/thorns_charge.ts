// Charge-limited thorns bookkeeping (Lightning Shield and any future
// charge-gated reflect aura). Kept as a pure leaf so a Vitest can pin the
// charge-consume and internal-cooldown rules without standing up a live Sim.
//
// A classic-era Lightning Shield is not an always-on thorns coat: it carries a
// fixed number of charges, each charge reflects one melee hit, and an internal
// cooldown keeps a fast attacker from burning every charge in a single flurry.
// Legacy thorns auras (druid Thorns, and the separate innate mob spiked-hide
// path) leave `charges`/`icd`/`icdMax` undefined and so stay unlimited and
// ungated, exactly as before.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { CAST_COMPLETE_EPS, DT } from '../types';
import { onThornsReflect } from './talent_procs';

export interface ThornsState {
  charges?: number; // remaining charges; undefined => unlimited (legacy thorns)
  icd?: number; // internal cooldown remaining, seconds
  icdMax?: number; // configured internal cooldown, seconds
}

// True while the aura still has a charge to spend (or is unlimited).
export function thornsHasCharge(a: ThornsState): boolean {
  return a.charges === undefined || a.charges > 0;
}

// True once a charge-limited aura is fully spent and should be removed.
export function thornsDepleted(a: ThornsState): boolean {
  return a.charges !== undefined && a.charges <= 0;
}

// Advance the per-aura internal cooldown one sim tick toward ready. No-op for
// auras without an internal cooldown.
export function tickThornsCooldown(a: ThornsState): void {
  if (a.icd && a.icd > 0) a.icd = Math.max(0, a.icd - DT);
}

// Decide whether a melee hit triggers the thorns reaction right now, recording
// the consequences: a triggered hit consumes one charge and arms the internal
// cooldown. Returns true when the attacker should take the reflected damage.
export function consumeThornsCharge(a: ThornsState): boolean {
  if (!thornsHasCharge(a)) return false;
  if ((a.icd ?? 0) > CAST_COMPLETE_EPS) return false; // still on internal cooldown
  if (a.charges !== undefined) a.charges -= 1;
  if (a.icdMax) a.icd = a.icdMax;
  return true;
}

// Reflect every charge-limited thorns aura on `defender` back onto `attacker`,
// consuming a charge and arming the internal cooldown for each one that fires,
// then dropping any aura whose charges are now spent. Shared by the player
// auto-attack reaction and the mob swing reaction so both gate identically.
export function applyThornsReaction(ctx: SimContext, defender: Entity, attacker: Entity): void {
  for (const a of defender.auras) {
    if (a.kind === 'thorns' && consumeThornsCharge(a)) {
      // Reflect (Thorns / Lightning Shield) is incidental, not a direct attack:
      // pass direct=false so it never walks the mob's leash anchor (else a kited
      // mob meleeing a shielded player would be re-anchored and never leash home).
      ctx.dealDamage(
        defender,
        attacker,
        a.value,
        false,
        a.school,
        a.name,
        'hit',
        true,
        undefined,
        false,
      );
      if (defender.kind === 'player') onThornsReflect(ctx, defender, a.id);
    }
  }
  for (let i = defender.auras.length - 1; i >= 0; i--) {
    const a = defender.auras[i];
    if (a.kind === 'thorns' && thornsDepleted(a)) {
      defender.auras.splice(i, 1);
      ctx.emit({ type: 'aura', targetId: defender.id, name: a.name, gained: false });
    }
  }
}
