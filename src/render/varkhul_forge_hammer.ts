import {
  VARKHUL_ANVILS_DECREE_CAST_ID,
  VARKHUL_FORGE_HAMMER_ABILITY_ID,
} from '../sim/encounters/varkhul';
import type { SimEvent } from '../sim/types';
import { groundHeight } from '../sim/world';

type SpellFxAtEvent = Extract<SimEvent, { type: 'spellfxAt' }>;

/** The Forging clip plays at this rate so its 1.633s loop fills the sim's 2s
 *  hammer cadence exactly. The manifest's attack/cast rows import it, and the
 *  spark delay below divides by it, so the three cannot drift apart. */
export const VARKHUL_FORGING_STRIKE_TIMESCALE = 0.815;
/** Where the hammer head arrests on the anvil inside the Forging clip,
 *  measured off the shipped GLB (FK sweep of the Hammer node: the fall ends
 *  at t=0.62s of 1.633s). */
export const VARKHUL_FORGING_IMPACT_CLIP_SECONDS = 0.62;
/** Strike event to anvil CONTACT, in played seconds: the render starts the
 *  Forging clip on the event, so the sparks wait out the raise-and-fall. */
export const VARKHUL_ANVIL_SPARK_DELAY_SECONDS =
  VARKHUL_FORGING_IMPACT_CLIP_SECONDS / VARKHUL_FORGING_STRIKE_TIMESCALE;
/** Hammer-head height at contact: 36 raw units of the clip's 88.48 raw rig
 *  height, at the manifest's 3u normalization and the template's 3.2 scale. */
export const VARKHUL_ANVIL_SPARK_HEIGHT = (36 / 88.48) * 3 * 3.2;

// Which boss spellfxAt emissions start an authored one-shot, keyed by ability
// and gated on the fx kind. The fx gate keeps multi-emission abilities from
// double-triggering: the Anvil's Decree strike is the 'nova' at the forge,
// while its falling meteors emit 'meteorImpact' under the same ability id.
// The Sweep release is deliberately NOT routed: its whole windup plays as a
// Slam cast clip (castByAbility), so a release one-shot would double-swing.
const VARKHUL_STRIKE_FX: Record<string, string> = {
  [VARKHUL_FORGE_HAMMER_ABILITY_ID]: 'burst',
  [VARKHUL_ANVILS_DECREE_CAST_ID]: 'nova',
};

export interface VarkhulForgeHammerAttackPlan {
  entityId: number;
  abilityId: string;
}

export function varkhulForgeHammerAttackPlan(
  event: Pick<SpellFxAtEvent, 'ability' | 'sourceId' | 'fx'>,
): VarkhulForgeHammerAttackPlan | null {
  if (event.ability === undefined || event.sourceId === undefined) return null;
  if (VARKHUL_STRIKE_FX[event.ability] !== event.fx) return null;
  return {
    entityId: event.sourceId,
    abilityId: event.ability,
  };
}

export function dispatchVarkhulForgeHammerAttack(
  event: Pick<SpellFxAtEvent, 'ability' | 'sourceId' | 'fx'>,
  triggerAttack: (entityId: number, abilityId: string) => void,
): boolean {
  const plan = varkhulForgeHammerAttackPlan(event);
  if (!plan) return false;
  triggerAttack(plan.entityId, plan.abilityId);
  return true;
}

export interface VarkhulAnvilSparkPlan {
  x: number;
  z: number;
  delaySeconds: number;
}

/** Every routed strike is a hammer blow on the anvil, so every one earns a
 *  spark shower at the CONTACT moment, not at the event (which starts the
 *  raise). Same fx gate as the attack plan: the decree's meteors share its
 *  ability id under 'meteorImpact' and must not spark the anvil. */
export function varkhulAnvilSparkPlan(
  event: Pick<SpellFxAtEvent, 'ability' | 'sourceId' | 'fx' | 'x' | 'z'>,
): VarkhulAnvilSparkPlan | null {
  if (!varkhulForgeHammerAttackPlan(event)) return null;
  return { x: event.x, z: event.z, delaySeconds: VARKHUL_ANVIL_SPARK_DELAY_SECONDS };
}

/** The narrow slice of Vfx the strike route needs; kept structural so the
 *  plan halves stay three-free and unit-testable. */
export interface VarkhulSparkSink {
  burstLater(
    seconds: number,
    x: number,
    y: number,
    z: number,
    school: string,
    count?: number,
    power?: number,
    color?: number,
  ): void;
}

/** One call site in the renderer's spellfxAt drain: start the authored swing
 *  AND schedule the anvil sparks for the hammer's contact moment. 'physical'
 *  school on purpose: the burst pool reads non-fire schools as spark showers
 *  (star/sparkle sprites) in the warm steel-spark color, which is exactly a
 *  hammer on an anvil; the strike event's own 'fire' school would render
 *  flame puffs instead. */
export function routeVarkhulForgeHammer(
  event: Pick<SpellFxAtEvent, 'ability' | 'sourceId' | 'fx' | 'x' | 'z'>,
  sparks: VarkhulSparkSink,
  seed: number,
  triggerAttack: (entityId: number, abilityId: string) => void,
): boolean {
  if (!dispatchVarkhulForgeHammerAttack(event, triggerAttack)) return false;
  const plan = varkhulAnvilSparkPlan(event);
  if (plan) {
    sparks.burstLater(
      plan.delaySeconds,
      plan.x,
      groundHeight(plan.x, plan.z, seed) + VARKHUL_ANVIL_SPARK_HEIGHT,
      plan.z,
      'physical',
      16,
      0.9,
    );
  }
  return true;
}
