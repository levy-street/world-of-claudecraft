export type MeleeContactStyle =
  'edge' | 'split' | 'crush' | 'pierce' | 'cross' | 'reap' | 'serrated';
export interface MeleeImpactProfile {
  /** Fraction of the actual recipient's displayed height; independent of the weapon arc. */
  height: number;
  style: MeleeContactStyle;
  angle: number;
  span: number;
  width: number;
  force: number;
  contacts: number;
  bleeding: boolean;
}

function contact(
  height: number,
  style: MeleeContactStyle,
  angle: number,
  span: number,
  width: number,
  force: number,
  bleeding = false,
  contacts = 1,
): MeleeImpactProfile {
  return { height, style, angle, span, width, force, bleeding, contacts };
}

/** Impact grammar follows each named action, not a shared caster-school flash. */
export const MELEE_IMPACTS: Readonly<Record<string, MeleeImpactProfile>> = {
  heroic_strike: contact(0.58, 'edge', -0.95, 1.25, 0.075, 0.95),
  slam: contact(0.56, 'crush', 0.1, 1.45, 0.12, 1.4),
  mortal_strike: contact(0.63, 'split', -0.35, 1.65, 0.12, 1.65),
  execute: contact(0.7, 'split', 0.18, 2.05, 0.16, 2.1, true),
  breachmaker: contact(0.57, 'pierce', 0.05, 1.45, 0.095, 1.4),
  overpower: contact(0.57, 'edge', 1.15, 1.35, 0.075, 1.05),
  victory_rush: contact(0.61, 'cross', 0.8, 1.55, 0.095, 1.3),
  raging_gale: contact(0.56, 'cross', -0.8, 1.8, 0.12, 1.55, true, 2),
  red_harvest: contact(0.51, 'reap', -0.18, 2.2, 0.14, 2, true, 3),
  bloodthirst: contact(0.56, 'reap', 0.5, 1.35, 0.085, 1.15, true),
  cleave: contact(0.52, 'edge', 0.08, 1.85, 0.095, 1.25),
  revenge: contact(0.54, 'cross', -0.45, 1.55, 0.09, 1.3),
  hamstring: contact(0.2, 'edge', 0.15, 0.9, 0.05, 0.65),
  pummel: contact(0.73, 'crush', 0.1, 0.8, 0.08, 0.85),
  sunder_armor: contact(0.57, 'split', 0.3, 1.15, 0.08, 1.15),
  whirlwind: contact(0.52, 'edge', 0.1, 1.55, 0.08, 1.2),
  bladestorm: contact(0.58, 'cross', 0.6, 1.9, 0.12, 1.55),
  shield_slam: contact(0.55, 'crush', 0, 1.6, 0.14, 1.7),
  sinister_strike: contact(0.56, 'serrated', -0.72, 1.35, 0.07, 1.2, true),
  backstab: contact(0.6, 'pierce', -0.2, 1.25, 0.065, 1.2, true),
  ambush: contact(0.65, 'split', -0.45, 1.7, 0.095, 1.65, true),
  eviscerate: contact(0.48, 'reap', 0.28, 1.85, 0.11, 1.7, true),
  rupture: contact(0.51, 'serrated', 0.25, 1.5, 0.075, 1.25, true),
  ghostly_strike: contact(0.6, 'edge', -0.6, 1.4, 0.075, 1.3),
  hemorrhage: contact(0.53, 'reap', -0.3, 1.6, 0.09, 1.4, true),
  garrote: contact(0.74, 'edge', 0.04, 0.8, 0.045, 1.1, true),
  venomrend: contact(0.5, 'serrated', -0.4, 1.55, 0.085, 1.4, true),
  raptor_strike: contact(0.58, 'edge', -1.05, 1.55, 0.095, 1.25, true),
  wing_clip: contact(0.23, 'reap', -0.12, 1.4, 0.075, 0.9, true),
  mongoose_bite: contact(0.58, 'pierce', 1.1, 1.6, 0.1, 1.5, true),
  bloodhook: contact(0.57, 'pierce', 0.15, 1.2, 0.085, 1.15, true),
  body_blow: contact(.48,'crush',.12,1.25,.11,1.45),
  knockout_blow: contact(.7,'crush',.4,1.65,.14,1.8),
  gouge: contact(.78,'pierce',0,.65,.035,.65),
  cheap_shot: contact(.42,'crush',.15,.9,.07,.8),
  maul: contact(.55,'crush',.28,1.8,.12,1.5),
  marrowbreak: contact(.57,'crush',-.2,2.1,.15,1.85),
  swipe: contact(.5,'cross',.15,1.9,.1,1.2,true),
  bash: contact(.64,'crush',.12,1.2,.1,1.25),
};

/** Label-only periodic/consumption outcomes must never replay a new weapon action.
 * Stable ID-bearing primary hits retain their action, even on the same victim. */
export function isBleedContinuation(
  id: string | undefined,
  primaryId?: string | null,
): boolean {
  return (
    !primaryId &&
    (id === 'garrote' ||
      id === 'rupture' ||
      id === 'hemorrhage' ||
      id === 'venomrend' ||
      id === 'mongoose_bite')
  );
}

export function meleeImpactProfile(id: string): MeleeImpactProfile | undefined {
  return MELEE_IMPACTS[id];
}

/** Each real contact of a compound attack visits a deliberate anatomical band. */
export function meleeContactHeight(
  profile: MeleeImpactProfile,
  beat: number,
): number {
  if (profile.style === 'reap')
    return profile.height + [0, 0.13, -0.055][beat % 3];
  if (profile.style === 'cross') return profile.height + (beat % 2 ? 0.08 : 0);
  return profile.height;
}

/** Open contact-plane paths. None draws a ground radius or a closed circle. */
export function meleeContactPoint(
  profile: MeleeImpactProfile,
  u: number,
  beat: number,
  strand: number,
  out: { x: number; y: number; z: number },
): void {
  const t = u - 0.5,
    span = profile.span;
  let x = t * span,
    y = 0,
    z = Math.sin(u * Math.PI) * 0.055;
  if (profile.style === 'split') {
    y = t * span;
    x =
      Math.sin(u * 19 + strand) * 0.065 * Math.sin(u * Math.PI) + strand * 0.12;
  } else if (profile.style === 'crush') {
    x = (strand % 2 ? -1 : 1) * (0.06 + u * span * 0.48);
    y = Math.sin(strand * 2.3) * u * span * 0.38 + Math.sin(u * 16) * u * 0.05;
    z = u * 0.25;
  } else if (profile.style === 'pierce') {
    x = (strand % 2 ? -1 : 1) * u * span * 0.22;
    y = Math.cos(strand * 2.2) * u * span * 0.22;
    z = t * span * 0.65;
  } else if (profile.style === 'serrated') {
    y = Math.sin(u * 31) * 0.035 * Math.sin(u * Math.PI) + strand * 0.085;
    z += Math.sin(u * 5) * 0.04;
  } else if (profile.style === 'reap') {
    y = Math.sin(u * Math.PI) * span * 0.17 - 0.12;
    x *= beat % 2 ? -1 : 1;
  } else if (profile.style === 'cross')
    y = t * span * (beat % 2 ? -1 : 1) * 0.45;
  const angle = profile.angle + (profile.style === 'reap' ? beat * 0.28 : 0);
  out.x = x * Math.cos(angle) - y * Math.sin(angle);
  out.y = x * Math.sin(angle) + y * Math.cos(angle);
  out.z = z;
}
