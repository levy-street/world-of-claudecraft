// Pure plan of the Masterless Strength's quarter kits' look (final_kit_fx.ts
// paints it; docs/design/raid/smith_heart.md section 7.5). Presentation only:
// every radius, timer and reach is read off the sim's own tuning and the
// objects' templates (encounters/smith_heart/final_ids.ts), never tuned here.
//
//   - which of the fight's objects a template is (`finalObjectKind`);
//   - each footprint's look on the shared floor telegraph (`FINAL_FOOTPRINTS`:
//     its threat colour and its element accent, on every tier);
//   - the timed footprints' fill (`timedFill`) and the anvil's fall and the
//     whirls', orbs' and roots' motion (`anvilDrop`, `whirlSpin`, `orbBob`,
//     `rootRise`);
//   - the vein palette, the cues the painter claims (no generic burst doubles
//     them), the floor rungs (`FINAL_KIT_FLOOR`: never tied with FinalFx's
//     particles or HeatFx's fist and lanes, which share the Anvil), the pools.
//
// Three-free, DOM-free, deterministic.

import { HEART_ROOM, SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import {
  FINAL_CUES,
  FINAL_OBJECTS,
  finalTimedOf,
  poolOf,
  FINAL_TUNING as T,
  whirlOf,
  windOf,
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
  | 'emberPool'
  | 'forgePool'
  | 'crack'
  | 'windWarn'
  | 'windBlow'
  | 'orb'
  | 'tremor'
  | 'anvil';

/** Which of the final's objects a template is, or null. */
export function finalObjectKind(templateId: string): FinalObjectKind | null {
  if (!templateId.startsWith('sh_final_')) return null;
  const w = whirlOf(templateId);
  if (w) return w === 'warn' ? 'whirlWarn' : 'whirl';
  const p = poolOf(templateId);
  if (p) return p === 'ember' ? 'emberPool' : 'forgePool';
  const wind = windOf(templateId);
  if (wind) return wind.state === 'warn' ? 'windWarn' : 'windBlow';
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
  ]) {
    const s = finalTimedOf(prefix, templateId);
    if (s !== null) return s;
  }
  return windOf(templateId)?.seconds ?? 0;
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
  fire: [1.0, 0.62, 0.22] as const,
  fireCore: [1.0, 0.9, 0.62] as const,
  frost: [0.72, 0.9, 1.0] as const,
  storm: [0.72, 0.62, 1.0] as const,
  stone: [0.62, 0.5, 0.32] as const,
  dust: [0.42, 0.38, 0.33] as const,
} as const;

/** How each footprint draws on the shared floor telegraph (every tier): its
 *  threat colour (the threat, never the school) and its element accent. The
 *  Anvil and the Storm Orbs take the soak's gold (the Hammer Council's
 *  precedent): stand IN them. */
export const FINAL_FOOTPRINTS = {
  whirl: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xffb060 },
  pool: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xff8a3a },
  crack: { color: TELEGRAPH_THREAT_COLORS.lethal, accent: 0xbfe6ff },
  tremor: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xe8c070 },
  orb: { color: FINAL_KIT_COLORS.soak, accent: 0xc8b8ff },
  anvil: { color: FINAL_KIT_COLORS.soak, accent: 0xffe2a0 },
  ember: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xff9a3a },
  drawn: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
  bolt: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
  rim: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
} as const;

/** The footprints' radii (yards), the sim's own. */
export const FINAL_REACH = {
  whirl: T.whirlR,
  ember: T.emberR,
  forge: T.forgeFireR,
  crack: T.iceR,
  orb: T.orbR,
  tremor: T.tremorR,
  anvil: T.anvilR,
  drawn: T.drawnReach,
  bolt: T.boltJump,
  /** The rim's band the gale strikes in: from here to the rim. */
  rimInner: HEART_ROOM.r - T.rimBand,
  rimOuter: HEART_ROOM.r,
} as const;

// ---- the timelines -------------------------------------------------------------------

/** A timed footprint's fill `age` seconds into a `seconds` warning. */
export function timedFill(age: number, seconds: number): number {
  return seconds > 0 ? clamp01(age / seconds) : 1;
}

/** Weight of the Anvil's fall over its bar: how high the great anvil hangs
 *  over its mark (yards; it drops the last fifth) and how hot its underside
 *  glows. */
export function anvilDrop(fill: number): { height: number; glow: number } {
  const f = clamp01(fill);
  const high = 26;
  const fall = f < 0.8 ? 0 : ((f - 0.8) / 0.2) ** 2;
  return {
    height: high * (1 - fall) + 3 * (1 - smooth(f / 0.8)) * (1 - fall),
    glow: 0.3 + 0.7 * f,
  };
}

/** A Fire Whirl's turn (radians) and its height at render time `t`, its
 *  warning `warn` 0..1 (it rises out of the floor as the warning runs). */
export function whirlSpin(t: number, warn: number): { angle: number; height: number } {
  return { angle: t * 7, height: 1.5 + 6.5 * smooth(warn) };
}

/** A Storm Orb's bob and crackle at render time `t`, `left` 0..1 of its
 *  life still to run (it crackles harder as it nears its burst). */
export function orbBob(t: number, left: number): { y: number; crackle: number } {
  return { y: 1.4 + 0.25 * Math.sin(t * 3.1), crackle: 0.35 + 0.65 * (1 - clamp01(left)) };
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

/** The kit's encounter rungs on the Anvil: the gale's rim band, the
 *  footprints (their curtains two rungs up), the particles; clear of
 *  FinalFx's engine particles (ENGINE_PARTICLE_STEPS) and of HeatFx's fist
 *  and lanes (the Heat's ladder, 4 to 21), which draw on the same floor. */
export const FINAL_KIT_FLOOR = {
  rim: 22,
  footprint: 23,
  footprintCurtain: 25,
  particles: { ring: 24, smoke: 26, fire: 27, glow: 28 },
  marks: 29,
} as const;

/** Every rung the kit draws on (the tests pin them untied). */
export function finalKitRungs(): number[] {
  const F = FINAL_KIT_FLOOR;
  return [F.rim, F.footprint, F.footprintCurtain, ...Object.values(F.particles), F.marks];
}

/** FinalFx's own particle rungs (the engine's defaults). */
export const FINAL_FX_PARTICLE_RUNGS: readonly number[] = Object.values(ENGINE_PARTICLE_STEPS);

/** The pools (fixed, allocated at build). */
export const FINAL_KIT_POOLS = {
  footprints: 28,
  whirls: 6,
  orbs: 6,
  ice: 10,
  shells: 6,
  arcs: 16,
  arcSegments: 5,
  rootSpikes: 10,
} as const;
