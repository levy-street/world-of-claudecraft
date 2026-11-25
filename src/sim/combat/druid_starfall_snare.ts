// Starfall Snare, the Starwarden Raiment (Moongrove Season 2 PvP) 4pc: the
// wearer's first Skyfall or Wildbolt on a target held by the wearer's own
// Gripping Roots is instant and deals 20% more damage. The 2pc makes Gripping
// Roots instant, so the set reads as one combo: root, step back, land a free
// strike, Skyfall to start a Moontide cycle or Wildbolt to start a Suntide one.
//
// "First" is per Gripping Roots application: whichever of the two used the snare
// marks that target spent in the wearer's procState icds (keyed by target id,
// lasting as long as the root has left, so it expires on its own), and the
// next Gripping Roots cast on that target clears the mark. procState is
// server-side bookkeeping, never an aura, so nothing extra shows on the HUD.
//
// Both are projectiles: their damage lands AFTER onCastCompleted ran. So the
// completed cast also ARMS the bonus for that target (a short-lived icd), and
// the impact consumes it. A hit that resolves before the cast-completed hook
// (no travel) takes the bonus directly and marks the target spent itself.
//
// Three hooks, all deterministic and rng-free:
//   cast time  casting_lifecycle.ts startCast (the Brineward target-aware seam)
//   damage     effect_dispatch.ts directDamage
//   bookkeeping talent_procs.ts onCastCompleted (after the damage resolved)

import {
  VANGUARD_BALANCE_4PC_SKYFALL_DMG_MULT,
  VANGUARD_BALANCE_SET_ID,
} from '../content/vanguard_set_bonuses_b';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { wearsSetBonus } from './set_bonus_wearer';

/** The spells the snare pays for: Skyfall and Wildbolt, the first one cast. */
const SNARE_SPELL_IDS: ReadonlySet<string> = new Set(['starfire', 'wrath']);
const GRIPPING_ROOTS_ID = 'entangling_roots';
const GRIPPING_ROOTS_AURA_ID = `${GRIPPING_ROOTS_ID}_root`;
const SPENT_KEY_PREFIX = 'dru_starfall_snare_spent_';
const ARMED_KEY_PREFIX = 'dru_starfall_snare_armed_';
/** How long an armed (in-flight) snared cast keeps its bonus. */
const ARMED_SECONDS = 5;

function spentKey(target: Entity): string {
  return `${SPENT_KEY_PREFIX}${target.id}`;
}

function armedKey(target: Entity): string {
  return `${ARMED_KEY_PREFIX}${target.id}`;
}

function icds(caster: Entity): Record<string, number> {
  if (!caster.procState) caster.procState = { counters: {}, icds: {} };
  return caster.procState.icds;
}

/** The caster's own Gripping Roots still holding this target, if any. */
function ownRoot(caster: Entity, target: Entity): Aura | undefined {
  return target.auras.find(
    (aura) =>
      aura.kind === 'root' && aura.id === GRIPPING_ROOTS_AURA_ID && aura.sourceId === caster.id,
  );
}

/** Is the snare live for this Skyfall or Wildbolt on this target right now? */
export function starfallSnareActive(
  ctx: SimContext,
  caster: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): boolean {
  if (!SNARE_SPELL_IDS.has(abilityId) || !target || target.dead || target.id === caster.id) {
    return false;
  }
  if (!ownRoot(caster, target)) return false;
  if (caster.procState?.icds[spentKey(target)] !== undefined) return false;
  return wearsSetBonus(ctx, caster, VANGUARD_BALANCE_SET_ID, 4);
}

/** Skyfall's or Wildbolt's cast time: 0 while the snare is live on its target. */
export function starfallSnareCastTime(
  ctx: SimContext,
  caster: Entity,
  abilityId: string,
  target: Entity | null,
  castTime: number,
): number {
  if (castTime <= 0) return castTime;
  return starfallSnareActive(ctx, caster, abilityId, target) ? 0 : castTime;
}

/** Read-only: would this Skyfall or Wildbolt into this target get the bonus now
 *  (an armed in-flight one, or a live snare)? For tests and readouts; the
 *  damage hook below is the one that spends it. */
export function starfallSnarePending(
  ctx: SimContext,
  caster: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): boolean {
  if (!SNARE_SPELL_IDS.has(abilityId) || !target) return false;
  if (caster.procState?.icds[armedKey(target)] !== undefined) return true;
  return starfallSnareActive(ctx, caster, abilityId, target);
}

/** The direct damage multiplier: an armed (in-flight) snared Skyfall or Wildbolt
 *  consumes its arm; a hit with no travel takes the live snare and marks the
 *  target spent. 1 otherwise. */
export function starfallSnareDamageMult(
  ctx: SimContext,
  caster: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): number {
  if (!SNARE_SPELL_IDS.has(abilityId) || !target) return 1;
  const armed = armedKey(target);
  if (caster.procState?.icds[armed] !== undefined) {
    delete caster.procState.icds[armed];
    return VANGUARD_BALANCE_4PC_SKYFALL_DMG_MULT;
  }
  if (!starfallSnareActive(ctx, caster, abilityId, target)) return 1;
  const root = ownRoot(caster, target);
  icds(caster)[spentKey(target)] = root ? root.remaining : ARMED_SECONDS;
  return VANGUARD_BALANCE_4PC_SKYFALL_DMG_MULT;
}

/** After a completed cast: a snared Skyfall or Wildbolt marks its target spent for the
 *  rest of that root and arms the bonus for its projectile; a fresh Gripping
 *  Roots clears both marks. */
export function starfallSnareOnCast(
  ctx: SimContext,
  caster: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (!target) return;
  if (abilityId === GRIPPING_ROOTS_ID) {
    if (caster.procState) {
      delete caster.procState.icds[spentKey(target)];
      delete caster.procState.icds[armedKey(target)];
    }
    return;
  }
  if (!starfallSnareActive(ctx, caster, abilityId, target)) return;
  const root = ownRoot(caster, target);
  if (!root) return;
  const marks = icds(caster);
  marks[spentKey(target)] = root.remaining;
  marks[armedKey(target)] = ARMED_SECONDS;
}
