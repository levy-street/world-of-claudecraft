import { GLITCH_ABILITIES } from '../content/glitch';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity, Vec3 } from '../types';

// Glitch Instability (content: src/sim/content/glitch.ts). The bar starts empty
// and fills on the classic two-second regen tick from the Glitch's effects
// already running in the world:
//   - each Glitch damage-over-time effect it owns on an enemy adds
//     CORRUPTION_PER_EFFECT, plus CORRUPTION_PER_EFFECT_AGE_STEP for every
//     CORRUPTION_AGE_STEP_SECONDS that effect has been running (capped), so old
//     effects build more than fresh ones;
//   - each Glitch ground zone it has placed adds CORRUPTION_PER_ZONE.
// With nothing running and out of combat, the bar drains.
// Draws no rng; reads only the caster's own auras and zones.

export const CORRUPTION_PER_EFFECT = 1;
export const CORRUPTION_PER_EFFECT_AGE_STEP = 1;
export const CORRUPTION_AGE_STEP_SECONDS = 4;
export const CORRUPTION_MAX_AGE_STEPS = 3;
export const CORRUPTION_PER_ZONE = 2;
export const CORRUPTION_DECAY_OUT_OF_COMBAT = 5;
// Only effects within this reach of the Glitch count (a spatial query, so the
// tick never walks the whole entity table).
export const CORRUPTION_SCAN_RADIUS = 60;
// Feedback: each OTHER Glitch effect on a target amplifies the Glitch's
// damage to it by this fraction, up to FEEDBACK_MAX_EFFECTS effects.
export const FEEDBACK_PCT_PER_EFFECT = 0.04;
export const FEEDBACK_MAX_EFFECTS = 5;

function hasDot(def: AbilityDef): boolean {
  if (def.effects.some((e) => e.type === 'dot')) return true;
  return (def.ranks ?? []).some((r) => r.effects.some((e) => e.type === 'dot'));
}

// The aura ids that count as Glitch effects: every Glitch ability that applies
// a damage-over-time effect (a dot aura carries its ability id).
export const GLITCH_EFFECT_AURA_IDS: ReadonlySet<string> = new Set(
  Object.values(GLITCH_ABILITIES)
    .filter(hasDot)
    .map((def) => def.id),
);

const GLITCH_ZONE_ABILITY_IDS: ReadonlySet<string> = new Set(
  Object.values(GLITCH_ABILITIES)
    .filter((def) => def.effects.some((e) => e.type === 'groundAoE' && e.duration > 1))
    .map((def) => def.id),
);

export function isGlitchEffectAura(aura: Aura, sourceId: number): boolean {
  return aura.sourceId === sourceId && GLITCH_EFFECT_AURA_IDS.has(aura.id);
}

/** Instability one effect contributes per tick, from how long it has run. */
export function corruptionForEffectAge(elapsedSeconds: number): number {
  const steps = Math.min(
    CORRUPTION_MAX_AGE_STEPS,
    Math.floor(Math.max(0, elapsedSeconds) / CORRUPTION_AGE_STEP_SECONDS),
  );
  return CORRUPTION_PER_EFFECT + steps * CORRUPTION_PER_EFFECT_AGE_STEP;
}

/** Total Instability the Glitch would gain on this tick. */
export function glitchCorruptionGain(ctx: SimContext, p: Entity): number {
  let gain = 0;
  ctx.grid.forEachInRadius(p.pos.x, p.pos.z, CORRUPTION_SCAN_RADIUS, (e) => {
    if (e === p || e.dead) return;
    for (const a of e.auras) {
      if (isGlitchEffectAura(a, p.id)) gain += corruptionForEffectAge(a.duration - a.remaining);
    }
  });
  for (const zone of ctx.groundAoEs) {
    if (zone.sourceId === p.id && GLITCH_ZONE_ABILITY_IDS.has(zone.abilityId)) {
      gain += CORRUPTION_PER_ZONE;
    }
  }
  return gain;
}

/** The Instability arm of the two-second regen tick (combat/auras.ts updateRegen). */
export function regenGlitchCorruption(ctx: SimContext, p: Entity): void {
  const gain = glitchCorruptionGain(ctx, p);
  if (gain > 0) {
    p.resource = Math.min(p.maxResource, p.resource + gain);
  } else if (!p.inCombat) {
    p.resource = Math.max(0, p.resource - CORRUPTION_DECAY_OUT_OF_COMBAT);
  }
}

/** Damage multiplier for a Glitch hitting a target that already carries its effects. */
export function glitchFeedbackMult(source: Entity | null, target: Entity): number {
  if (!source || source.kind !== 'player' || source.resourceType !== 'corruption') return 1;
  let count = 0;
  for (const a of target.auras) if (isGlitchEffectAura(a, source.id)) count++;
  // The effect being ticked (or just applied) does not feed itself.
  const others = Math.max(0, Math.min(FEEDBACK_MAX_EFFECTS, count - 1));
  return 1 + others * FEEDBACK_PCT_PER_EFFECT;
}

/** Cascade: extend the caster's Glitch effects on enemies near the aim, keeping their age. */
export function applyGlitchCascade(
  ctx: SimContext,
  p: Entity,
  aim: Vec3,
  radius: number,
  seconds: number,
  ability: Pick<AbilityDef, 'id' | 'school'>,
): number {
  let extended = 0;
  ctx.grid.forEachInRadius(aim.x, aim.z, radius, (e) => {
    if (e === p || e.dead) return;
    for (const a of e.auras) {
      if (!isGlitchEffectAura(a, p.id)) continue;
      a.remaining += seconds;
      a.duration += seconds;
      extended++;
    }
  });
  ctx.emit({
    type: 'spellfxAt',
    x: aim.x,
    z: aim.z,
    school: ability.school,
    fx: 'nova',
    radius,
    sourceId: p.id,
    ability: ability.id,
  });
  return extended;
}
