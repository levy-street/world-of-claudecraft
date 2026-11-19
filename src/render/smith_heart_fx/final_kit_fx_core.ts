// Pure plan of the Masterless Strength's quarter kits' look (final_kit_fx.ts
// paints it; docs/design/raid/smith_heart.md section 7.5). Presentation only:
// every radius, timer and reach is read off the sim's own tuning and the
// objects' templates (encounters/smith_heart/final_ids.ts), never tuned here.
//
//   - which of the fight's objects a template is (`finalObjectKind`; the
//     woken stars' rises, strikes, Arcing Stone rings, blades and lines are
//     kinds too, painted with final_stars_fx.ts; the pillars themselves are
//     CouncilFx's, the council's own pillars);
//   - each footprint's look on the shared floor telegraph (`FINAL_FOOTPRINTS`:
//     its threat colour and its element accent, on every tier);
//   - the timed footprints' fill (`timedFill`) and the whirls', orbs' and
//     roots' motion (`whirlSpin`, `orbBob`, `rootRise`; the anvil's whole
//     look is final_anvil_core.ts's);
//   - the vein palette, the cues the painter claims (no generic burst doubles
//     them), the floor rungs (`FINAL_KIT_FLOOR`: never tied with FinalFx's
//     particles or HeatFx's fist and lanes, which share the Anvil), the pools,
//     the switch's shockwave (`shockWave`).
// Each footprint's element paint is final_telegraph_core.ts's.
//
// Three-free, DOM-free, deterministic.

import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import {
  FINAL_CUES,
  FINAL_OBJECTS,
  devilOf,
  finalBladeOf,
  finalLaneOf,
  finalPillarOf,
  finalTimedOf,
  poolOf,
  FINAL_TUNING as T,
  whirlOf,
} from '../../sim/encounters/smith_heart/final_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph';
import { ENGINE_PARTICLE_STEPS } from '../trash_engine_fx/engine_particles';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

// ---- the objects ---------------------------------------------------------------------

export type FinalObjectKind =
  | 'whirlWarn'
  | 'whirl'
  // The Breath's Dust Devils (Jose's playtest of 2026-11-19): the fire
  // tornado recoloured to wind.
  | 'devilWarn'
  | 'devil'
  | 'emberPool'
  | 'forgePool'
  | 'crack'
  | 'orb'
  | 'tremor'
  | 'anvil'
  // The woken stars (the rework of 2026-11-18).
  | 'rise'
  | 'strike'
  | 'arcRing'
  | 'blade'
  | 'lane'
  | 'pillar'
  | 'pillarCharged';

/** Which of the final's objects a template is, or null. */
export function finalObjectKind(templateId: string): FinalObjectKind | null {
  if (!templateId.startsWith('sh_final_')) return null;
  const w = whirlOf(templateId);
  if (w) return w === 'warn' ? 'whirlWarn' : 'whirl';
  const d = devilOf(templateId);
  if (d) return d === 'warn' ? 'devilWarn' : 'devil';
  const p = poolOf(templateId);
  if (p) return p === 'ember' ? 'emberPool' : 'forgePool';
  const pillar = finalPillarOf(templateId);
  if (pillar) return pillar === 'charged' ? 'pillarCharged' : 'pillar';
  if (finalBladeOf(templateId)) return 'blade';
  if (finalLaneOf(templateId)) return 'lane';
  if (finalTimedOf(FINAL_OBJECTS.risePrefix, templateId) !== null) return 'rise';
  if (finalTimedOf(FINAL_OBJECTS.strikePrefix, templateId) !== null) return 'strike';
  if (finalTimedOf(FINAL_OBJECTS.arcPrefix, templateId) !== null) return 'arcRing';
  if (finalTimedOf(FINAL_OBJECTS.crackPrefix, templateId) !== null) return 'crack';
  if (finalTimedOf(FINAL_OBJECTS.orbPrefix, templateId) !== null) return 'orb';
  if (finalTimedOf(FINAL_OBJECTS.tremorPrefix, templateId) !== null) return 'tremor';
  if (finalTimedOf(FINAL_OBJECTS.anvilPrefix, templateId) !== null) return 'anvil';
  return null;
}

/** A timed object's warning length (seconds), from its template. */
export function finalObjectSeconds(templateId: string): number {
  for (const prefix of [
    FINAL_OBJECTS.crackPrefix,
    FINAL_OBJECTS.orbPrefix,
    FINAL_OBJECTS.tremorPrefix,
    FINAL_OBJECTS.anvilPrefix,
    FINAL_OBJECTS.risePrefix,
    FINAL_OBJECTS.strikePrefix,
    FINAL_OBJECTS.arcPrefix,
  ]) {
    const s = finalTimedOf(prefix, templateId);
    if (s !== null) return s;
  }
  return 0;
}

// ---- the palette ----------------------------------------------------------------------

/** The four veins' light (hex), the soak's gold, frost, storm and the
 *  stone's ochre for the cosmetic layers. */
export const FINAL_KIT_COLORS = {
  heat: SMITH_HEART_VEIN_COLORS.heat,
  quench: SMITH_HEART_VEIN_COLORS.quench,
  breath: SMITH_HEART_VEIN_COLORS.breath,
  hammer: SMITH_HEART_VEIN_COLORS.hammer,
  soak: 0xffc94a,
  /** A Crossing Blade's line: the ice's own cold as it aims, white-hot ice
   *  locked (never the fire's orange: the coordinator's call of 2026-11-18). */
  iceLine: 0x58b8ff,
  iceLineLocked: 0xc8eeff,
  fire: [1.0, 0.62, 0.22] as const,
  fireCore: [1.0, 0.9, 0.62] as const,
  frost: [0.72, 0.9, 1.0] as const,
  storm: [0.72, 0.62, 1.0] as const,
  stone: [0.62, 0.5, 0.32] as const,
  dust: [0.42, 0.38, 0.33] as const,
  /** The Dust Devils' wind (the fire tornado recoloured): a white core, a
   *  pale sky blue body, a grey dust sheath. */
  windCore: [0.96, 0.98, 1.0] as const,
  wind: [0.66, 0.82, 1.0] as const,
  windDust: [0.62, 0.62, 0.6] as const,
} as const;

/** How each footprint draws on the shared floor telegraph (every tier): its
 *  threat colour (the threat, never the school) and its element accent. The
 *  Anvil and the Storm Orbs take the soak's gold (the Hammer Council's
 *  precedent): stand IN them. */
export const FINAL_FOOTPRINTS = {
  whirl: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xffb060 },
  /** A Dust Devil: the threat colour (it throws), a wind-white accent. */
  devil: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xdcecff },
  pool: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xff8a3a },
  crack: { color: TELEGRAPH_THREAT_COLORS.lethal, accent: 0xbfe6ff },
  tremor: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xe8c070 },
  orb: { color: FINAL_KIT_COLORS.soak, accent: 0xc8b8ff },
  anvil: { color: FINAL_KIT_COLORS.soak, accent: 0xffe2a0 },
  ember: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xff9a3a },
  drawn: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
  bolt: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
  /** The stars: a pillar's rise (step off), a Sky Strike (its storm-white
   *  spot, told from Leaping Bolt's violet reach by its colder white),
   *  Arcing Stone round a pillar (lethal-red edge: the big ring), a Crossing
   *  Blade's line (its frost). */
  rise: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xe8c070 },
  strike: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xeef4ff },
  arcRing: { color: TELEGRAPH_THREAT_COLORS.lethal, accent: 0xd8c8ff },
  // A Crossing Blade's line in the ice's own cold (the coordinator's call of
  // 2026-11-18, over the threat palette: the orange read as the Heat's fire):
  // an ice blue as it aims, a white-hot ice as it locks.
  lane: { color: FINAL_KIT_COLORS.iceLine, accent: 0xd8f2ff },
  laneLocked: { color: FINAL_KIT_COLORS.iceLineLocked, accent: 0xffffff },
  /** Crushed: you must stay out of the next Anvil. */
  crushed: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xe8c070 },
} as const;

/** The footprints' radii (yards), the sim's own. */
export const FINAL_REACH = {
  whirl: T.whirlR,
  devil: T.devilR,
  ember: T.emberR,
  forge: T.forgeFireR,
  crack: T.iceR,
  orb: T.orbR,
  tremor: T.tremorR,
  anvil: T.anvilR,
  drawn: T.drawnReach,
  bolt: T.boltJump,
  rise: T.riseKnockR,
  strike: T.skyR,
  arc: T.arcR,
  bladeHalf: T.bladeHalf,
  /** Crushed's mark under its player (a body's width: it marks who, not
   *  where). */
  crushed: 1.6,
} as const;

// ---- the timelines -------------------------------------------------------------------

/** A timed footprint's fill `age` seconds into a `seconds` warning. */
export function timedFill(age: number, seconds: number): number {
  return seconds > 0 ? clamp01(age / seconds) : 1;
}

/** A Fire Whirl's turn (radians) and its height at render time `t`, its
 *  warning `warn` 0..1 (it rises out of the floor as the warning runs: a
 *  fire tornado since the rework of 2026-11-18, some ten players tall). */
export function whirlSpin(t: number, warn: number): { angle: number; height: number } {
  return { angle: t * 7, height: 3 + 19 * smooth(warn) };
}

/** A fire tornado's funnel radius (a share of its lip's) at `h` 0..1 of its
 *  height: a narrow throat at the floor flaring wide at the top (the
 *  coordinator's review of 2026-11-18: the column read as loose tongues). */
export function tornadoProfile(h: number): number {
  const t = clamp01(h);
  return 0.16 + 0.84 * t ** 1.8;
}

/** The rocks and burning debris torn up and whirled round a tornado: piece
 *  `k` of `n` at render time `t` climbs the funnel round and round, flung out
 *  at its lip and dropped back to the foot. Its angle (radians), its height
 *  (0..1 of the funnel) and its spin. Fills `out`. */
export function tornadoDebris(
  t: number,
  k: number,
  n: number,
  seed: number,
  out: { angle: number; height: number; spin: number } = { angle: 0, height: 0, spin: 0 },
): { angle: number; height: number; spin: number } {
  const phase = k / Math.max(1, n);
  const climb = (t * (0.22 + 0.05 * ((k * 7) % 3)) + phase + seed * 0.13) % 1;
  out.height = climb;
  out.angle = t * (3.2 - 1.6 * climb) + phase * Math.PI * 2 + seed;
  out.spin = t * (2 + (k % 4));
  return out;
}

/** A Storm Orb's bob and crackle at render time `t`, `left` 0..1 of its
 *  life still to run (it crackles harder as it nears its burst). */
export function orbBob(t: number, left: number): { y: number; crackle: number } {
  return { y: 1.4 + 0.25 * Math.sin(t * 3.1), crackle: 0.35 + 0.65 * (1 - clamp01(left)) };
}

/** The switch's shockwave on the floor `age` seconds after it: its front
 *  (yards out from the crossing) and its strength, fading as it spreads over
 *  the whole Anvil. */
export function shockWave(age: number): { front: number; alpha: number } {
  const T_SHOCK = 1.5;
  if (age < 0 || age >= T_SHOCK) return { front: 0, alpha: 0 };
  const k = age / T_SHOCK;
  return { front: 4 + 92 * (1 - (1 - k) ** 2), alpha: (1 - k) ** 1.3 };
}

/** Taking Root's rock spikes round the boss's feet: how far up they stand
 *  (0..1) `left` seconds before the root lets go. */
export function rootRise(left: number, total = T.rootSeconds): number {
  if (left <= 0) return 0;
  const grown = total - left;
  return smooth(grown / 0.6) * smooth(left / 0.8);
}

// ---- the cues ------------------------------------------------------------------------

const CLAIMED: ReadonlySet<string> = new Set(Object.values(FINAL_CUES));

/** The cues the final's painters draw themselves (no generic burst, nova or
 *  beam doubles them). */
export function finalKitClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the floor -----------------------------------------------------------------------

/** The kit's encounter rungs on the Anvil: the element telegraphs' char
 *  (every multiply on one rung: they commute), their glows, their curtains,
 *  the switch's floor shockwave, a Crossing Blade's line (the shared lane:
 *  its curtain stands two rungs over, on the particles' ring rung, a wall
 *  off the floor, both additive), the particles, the marks over everything
 *  (the stars' floor rings ride the marks' rung); clear of FinalFx's engine particles
 *  (ENGINE_PARTICLE_STEPS) and of HeatFx's fist and lanes (the Heat's
 *  ladder: 4, 5, 8, 9, 12, 14, 16, 18, 21), which draw on the same floor.
 *  The chars sit under every glow but the Heat crater's, so a mark of one
 *  element never darkens another's light. */
export const FINAL_KIT_FLOOR = {
  telegraphChar: 13,
  telegraphGlow: 15,
  telegraphCurtain: 17,
  shock: 20,
  lane: 22,
  particles: { ring: 24, smoke: 26, fire: 27, glow: 28 },
  marks: 29,
} as const;

/** Every rung the kit draws on (the tests pin them untied). */
export function finalKitRungs(): number[] {
  const F = FINAL_KIT_FLOOR;
  return [
    F.telegraphChar,
    F.telegraphGlow,
    F.telegraphCurtain,
    F.shock,
    F.lane,
    ...Object.values(F.particles),
    F.marks,
  ];
}

/** FinalFx's own particle rungs (the engine's defaults). */
export const FINAL_FX_PARTICLE_RUNGS: readonly number[] = Object.values(ENGINE_PARTICLE_STEPS);

/** The pools (fixed, allocated at build). */
export const FINAL_KIT_POOLS = {
  whirls: 6,
  devils: 6,
  orbs: 6,
  ice: 10,
  shells: 6,
  arcs: 16,
  arcSegments: 5,
  rootSpikes: 10,
} as const;
