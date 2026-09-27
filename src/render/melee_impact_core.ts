export type MeleeContactStyle =
  | 'edge'
  | 'split'
  | 'crush'
  | 'pierce'
  | 'cross'
  | 'reap'
  | 'serrated';
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
  mortal_strike: contact(0.63, 'split', Math.PI / 2 - 0.65, 1.65, 0.12, 1.65),
  deep_wounds: contact(0.63, 'serrated', -0.65, 1.2, 0.09, 0.6, true),
  execute: contact(0.7, 'split', Math.PI / 2 - 1.25, 2.05, 0.16, 2.1, true),
  breachmaker: contact(0.57, 'pierce', 0.05, 1.45, 0.095, 1.4),
  overpower: contact(0.57, 'edge', 1.15, 1.35, 0.075, 1.05),
  victory_rush: contact(0.61, 'cross', 0.8, 1.55, 0.095, 1.3),
  raging_gale: contact(0.56, 'cross', -0.8, 1.8, 0.12, 1.55, true, 2),
  red_harvest: contact(0.51, 'reap', -0.18, 2.2, 0.14, 2, true, 3),
  bloodthirst: contact(0.56, 'reap', 0.5, 1.35, 0.085, 1.15, true),
  cleave: contact(0.52, 'edge', 0.08, 1.85, 0.095, 1.25),
  revenge: contact(0.54, 'cross', -0.45, 1.55, 0.09, 1.3),
  thunder_clap: contact(0.35, 'crush', 0.15, 1.8, 0.13, 1.5),
  heroic_leap: contact(0.3, 'crush', 0.08, 1.8, 0.14, 1.65),
  faultline: contact(0.42, 'split', 0, 2.2, 0.16, 1.9),
  hamstring: contact(0.2, 'edge', 0.15, 0.9, 0.05, 0.65),
  pummel: contact(0.73, 'crush', 0.1, 0.8, 0.08, 0.85),
  sunder_armor: contact(0.57, 'split', 0.3, 1.15, 0.08, 1.15),
  whirlwind: contact(0.52, 'edge', 0.1, 1.55, 0.08, 1.2),
  bladestorm: contact(0.58, 'cross', 0.6, 1.9, 0.12, 1.55),
  shield_slam: contact(0.55, 'crush', 0, 1.6, 0.14, 1.7),
};

/** Label-only periodic/consumption outcomes must never replay a new weapon action.
 * Stable ID-bearing primary hits retain their action, even on the same victim. */
export function isBleedContinuation(id: string | undefined, primaryId?: string | null): boolean {
  return (
    !primaryId &&
    (id === 'deep_wounds' ||
      id === 'garrote' ||
      id === 'rupture' ||
      id === 'hemorrhage' ||
      id === 'venomrend' ||
      id === 'mongoose_bite')
  );
}

const HARVEST_CONTACTS = [-0.66, 0.58, 0].map((angle, beat) => ({
  ...MELEE_IMPACTS.red_harvest,
  height: MELEE_IMPACTS.red_harvest.height + [0, 0.13, -0.055][beat],
  angle,
}));

export function meleeImpactProfile(id: string, beat?: number): MeleeImpactProfile | undefined {
  if (id === 'red_harvest' && beat !== undefined && Number.isInteger(beat))
    return HARVEST_CONTACTS[beat] ?? MELEE_IMPACTS[id];
  return MELEE_IMPACTS[id];
}

/** Each real contact of a compound attack visits a deliberate anatomical band. */
export function meleeContactHeight(profile: MeleeImpactProfile, beat: number): number {
  if (profile.style === 'reap') return profile.height + [0, 0.13, -0.055][beat % 3];
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
    x = Math.sin(u * 19 + strand) * 0.065 * Math.sin(u * Math.PI) + strand * 0.12;
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
  } else if (profile.style === 'cross') y = t * span * (beat % 2 ? -1 : 1) * 0.45;
  const angle = profile.angle + (profile.style === 'reap' ? beat * 0.28 : 0);
  out.x = x * Math.cos(angle) - y * Math.sin(angle);
  out.y = x * Math.sin(angle) + y * Math.cos(angle);
  out.z = z;
}
