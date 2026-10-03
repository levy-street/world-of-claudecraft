// Pure plan for the Gravewyrm Sanctum's creature effects and telegraphs
// (sanctum_fx.ts and its siblings): which cast paints which floor shape, how
// big, in which threat colour and how it fills (every number read from the
// sim's own templates and tuning, so the edge a player dodges is the edge the
// sim tests), the encounter objects' looks (the Ice Block Toss ring, the
// spilled soulfire), the Trample lane's length (recomputed from the
// instance-local start exactly as the sim measured it), the palette of the
// Ice Tomb (design section 8) and the timelines of the creature effects.
//
// Three-free, DOM-free, deterministic.

import { DUNGEONS, instanceOrigin, instanceSlotForZ, MOBS } from '../../sim/data';
import {
  BONEGUARD_ID,
  BONEWALKER_ID,
  GLACIER_SPLINTER_ID,
  GOADSMITH_ID,
  PYRE_TENDER_ID,
  RIME_WHELP_ID,
  SANCTUM_DUNGEON,
  SANCTUM_OBJECT_TEMPLATES,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_TOSS_RING,
  SCALEGUARD_ID,
  SLEDGE_HAULER_ID,
  SLEDGE_TUSKER_ID,
  SOUL_BRAZIER_ID,
  THAWCALLER_ID,
  TUSKER_TRAMPLE,
  TUSKER_TUNING,
  TUSKER_TUSK_SWEEP,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import { trampleReach } from '../../sim/encounters/gravewyrm_sanctum/sledge_tusker';
import {
  SANCTUM_CINDER_BREATH,
  SANCTUM_GOAD,
  SANCTUM_WARMING_RITE,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

// ---- palette -------------------------------------------------------------------

/** The Ice Tomb's palette (design section 8). Telegraphs stay brighter than
 *  all of it and never share the aurora's hues at floor level. */
export const SANCTUM_PALETTE = {
  glacier: 0x7fc4e8,
  deepIce: 0x2e6f9e,
  rime: 0xeef6fa,
  slate: 0x4a5058,
  runeBlue: 0x5ab8ff,
  oldIron: 0x3a3d42,
  pyre: 0xe8862e,
  soot: 0x1a1614,
  soulGreen: 0x8fd6a0,
  soulViolet: 0x7a58b8,
} as const;

/** The Sanctum's element accents (motes and fill fronts only, never the rim). */
export const SANCTUM_ACCENTS = {
  ...TELEGRAPH_ACCENTS,
  /** The cult's stolen souls burning: violet-green. */
  soulfire: 0xa6ffcf,
  /** The Scaleguard's cinders and the goad's red-hot iron. */
  ember: 0xffb070,
  /** Glacier ice and rime. */
  rime: 0xd6f3ff,
} as const;

/** A colour as linear-ish 0..1 floats (the particle pools take rgb floats). */
export function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// ---- telegraphs ------------------------------------------------------------------

export type SanctumTelegraphShape = 'cone' | 'lane' | 'sigil';

export interface SanctumTelegraphSpec {
  shape: SanctumTelegraphShape;
  /** Yards: the cone's reach from the caster's centre, the sigil's radius (a
   *  lane's length is measured per bar: tramplePaintLength). */
  range: number;
  /** Degrees of the cone's arc. */
  arcDeg: number;
  /** A lane's half width (yards). */
  halfWidth?: number;
  /** The threat colour (TELEGRAPH_THREAT_COLORS). */
  color: number;
  /** The element accent of the motes and the fill front. */
  accent: number;
}

/** The Sledge Tusker's drawn body radius (its template's bodyRadius): the
 *  sweep's reach and the lane's run are measured from its centre past it. */
export function tuskerBodyRadius(): number {
  return MOBS[SLEDGE_TUSKER_ID]?.bodyRadius ?? 3.5;
}

/** Every Sanctum cast that paints the floor while its bar runs. */
export function sanctumTelegraphSpecs(): Readonly<Record<string, SanctumTelegraphSpec>> {
  const breath = MOBS[SCALEGUARD_ID]?.breathCone;
  const body = tuskerBodyRadius();
  return {
    // Cinder Breath: a 90 degree cone of cinders across the Scaleguard's
    // front. Avoidable damage: orange, ember motes.
    [SANCTUM_CINDER_BREATH]: {
      shape: 'cone',
      range: breath?.range ?? 0,
      arcDeg: breath?.arcDeg ?? 0,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.ember,
    },
    // Tusk Sweep: the tusks sweep a 120 degree cone 10 yd past the Tusker's
    // body (the sim tests range + body from its centre) and throw: orange.
    [TUSKER_TUSK_SWEEP]: {
      shape: 'cone',
      range: TUSKER_TUNING.sweepRange + body,
      arcDeg: TUSKER_TUNING.sweepArcDeg,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.rime,
    },
    // Trample: the lane the charge runs down. Its hit and the knockdown land
    // on everyone in it as the bar ends: orange (damage first), rime motes.
    [TUSKER_TRAMPLE]: {
      shape: 'lane',
      range: TUSKER_TUNING.trampleLength + body,
      arcDeg: 0,
      halfWidth: TUSKER_TUNING.trampleHalfWidth,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.rime,
    },
    // The two kicks: a glyph turning under the caster's feet.
    [SANCTUM_WARMING_RITE]: {
      shape: 'sigil',
      range: 2.2,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: SANCTUM_ACCENTS.soulfire,
    },
    [SANCTUM_GOAD]: {
      shape: 'sigil',
      range: 2.2,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: SANCTUM_ACCENTS.ember,
    },
  };
}

/**
 * The Trample lane's painted length from the Tusker's centre: the sim runs the
 * lane from its instance-local start along its locked facing until the road
 * ends (trampleReach, at most 30 yd), and tests it `body` yards further (the
 * charge's leading edge). `x`, `z` are world coordinates in the Sanctum.
 */
export function tramplePaintLength(x: number, z: number, yaw: number): number {
  const def = DUNGEONS[SANCTUM_DUNGEON];
  const body = tuskerBodyRadius();
  if (!def) return TUSKER_TUNING.trampleLength + body;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return trampleReach(x - o.x, z - o.z, yaw, TUSKER_TUNING.trampleLength) + body;
}

// ---- encounter objects -------------------------------------------------------------

export interface SanctumObjectSpec {
  color: number;
  accent: number;
  /** Seconds the edge takes to fill (its moment is at 1); 0 = a standing
   *  zone drawn full from its first frame. */
  fillSeconds: number;
  /** Seconds it stands (the burning patches go out on their own clock). */
  seconds?: number;
}

/** The Sanctum's encounter objects' floor circles (their radius rides `scale`). */
export function sanctumObjectSpecs(): Readonly<Record<string, SanctumObjectSpec>> {
  const toss = MOBS[SLEDGE_HAULER_ID]?.trashKit?.toss;
  return {
    // The block's landing ring, painted under its victim the moment the bar
    // opens: it fills over the 2 s bar and the block lands at 1.
    [SANCTUM_TOSS_RING]: {
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.rime,
      fillSeconds: toss?.castTime ?? 2,
    },
    // A spilled brazier's soulfire burning on the ice: a standing zone.
    [SANCTUM_SOULFIRE_PATCH]: {
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.soulfire,
      fillSeconds: 0,
      seconds: TUSKER_TUNING.patchSeconds,
    },
  };
}

/** A timed edge's fill `age` seconds in (1 at its moment, or at once). */
export function objectFill(age: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return Math.min(1, Math.max(0, age / seconds));
}

/** A standing zone's fade in and out over its life (a patch flares up as it
 *  spills and gutters over its last second); 1 while it simply burns. */
export function patchPresence(age: number, seconds: number): number {
  const rise = Math.min(1, Math.max(0, age / 0.35));
  const left = seconds - age;
  const fall = seconds > 0 ? Math.min(1, Math.max(0.25, left / 1)) : 1;
  return rise * fall;
}

/** Is this template one the Sanctum draws itself (a ring, a patch, a story
 *  marker)? The story markers draw nothing here: the Calving Face reads them. */
export function isSanctumObject(templateId: string): boolean {
  return SANCTUM_OBJECT_TEMPLATES.has(templateId);
}

/** The Sanctum's own mob templates (a scan that sees one is in the Sanctum). */
export const SANCTUM_FX_MOBS: ReadonlySet<string> = new Set([
  SLEDGE_TUSKER_ID,
  THAWCALLER_ID,
  GOADSMITH_ID,
  PYRE_TENDER_ID,
  SOUL_BRAZIER_ID,
  RIME_WHELP_ID,
  SLEDGE_HAULER_ID,
  GLACIER_SPLINTER_ID,
  SCALEGUARD_ID,
]);

// ---- timelines -------------------------------------------------------------------

/** Seconds a Soul Brazier's pulse ring takes to race out to its reach. */
export const STOKE_PULSE_SECONDS = 0.9;

/** A Soul Brazier's pulse `elapsed` seconds in: its radius out to `reach` and
 *  its brightness. */
export function stokePulse(elapsed: number, reach: number): { radius: number; alpha: number } {
  const t = Math.min(1, Math.max(0, elapsed / STOKE_PULSE_SECONDS));
  const ease = 1 - (1 - t) * (1 - t);
  return { radius: Math.max(0.2, reach * ease), alpha: (1 - t) * (0.35 + 0.65 * (1 - t)) };
}

/** The reach a Soul Brazier quickens its allies within (its template). */
export function stokeReach(): number {
  return MOBS[SOUL_BRAZIER_ID]?.trashKit?.stoke?.radius ?? 10;
}

/**
 * The thrown ice block's flight over the toss's bar `fill` (0..1): hidden
 * until the hauler lets go (RELEASE), then a lob from its hands to the ring,
 * landing as the bar ends. Returns null while it is still in its hands, else
 * the share of the way along the ground and the height over the straight line
 * (yards, a parabola peaking at `apex`).
 */
export const BLOCK_RELEASE = 0.6;
export function blockFlight(fill: number, apex: number): { along: number; lift: number } | null {
  if (fill < BLOCK_RELEASE) return null;
  const t = Math.min(1, (fill - BLOCK_RELEASE) / (1 - BLOCK_RELEASE));
  return { along: t, lift: 4 * apex * t * (1 - t) };
}

/** A Glacier Splinter's corpse building to its Shatter: the inner rune-iron
 *  glow climbs and quickens over the fuse. */
export function shatterBuild(elapsed: number, delay: number): { glow: number; rate: number } {
  const t = delay > 0 ? Math.min(1, Math.max(0, elapsed / delay)) : 1;
  return { glow: 0.25 + 0.75 * t * t, rate: 3 + 15 * t };
}

/** The Shatter's fuse (its template's death-burst delay). */
export function shatterDelay(): number {
  return MOBS[GLACIER_SPLINTER_ID]?.trashKit?.deathBurst?.delay ?? 2;
}

/** The Shatter's reach (its template). */
export function shatterRadius(): number {
  return MOBS[GLACIER_SPLINTER_ID]?.trashKit?.deathBurst?.radius ?? 6;
}

/** The Hoarfrost Pop's reach (its template). */
export function hoarfrostRadius(): number {
  return MOBS[RIME_WHELP_ID]?.trashKit?.deathBurst?.radius ?? 3;
}

/** The Tusker's enrage glow: a slow, heavy breath (0.75..1.15). */
export function enrageBreath(clock: number): number {
  return 0.95 + 0.2 * Math.sin(clock * 3.1);
}

/** The fury a Goad leaves on its ally: a hot pulse (0.6..1). */
export function goadedPulse(clock: number): number {
  return 0.8 + 0.2 * Math.sin(clock * 9);
}

// ---- soulfire --------------------------------------------------------------------

/** The cult's soulfire as (heat, r, g, b) stops: violet smoke at the edges,
 *  violet into a sickly soul-green, a pale green core (never white: it must
 *  read violet-green against the snow). The flame shader
 *  is generated from these stops (rampGlsl). */
export const SOULFIRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.12, 0.06, 0.02, 0.1],
  [0.3, 0.34, 0.1, 0.6],
  [0.48, 0.5, 0.24, 0.86],
  [0.66, 0.3, 0.78, 0.52],
  [0.84, 0.5, 0.96, 0.62],
  [1.0, 0.78, 1.0, 0.82],
];

/** The cult's pyres and the Scaleguard's cinders: soot, pyre red, orange,
 *  a yellow-white core. */
export const PYRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.12, 0.04, 0.02, 0.01],
  [0.32, 0.42, 0.08, 0.02],
  [0.52, 0.91, 0.36, 0.08],
  [0.72, 1.0, 0.62, 0.22],
  [0.88, 1.0, 0.86, 0.55],
  [1.0, 1.0, 0.97, 0.85],
];

/** The heat a flame puff is born with (a flame pool reads `color[0]`): held
 *  in the ramp's middle so the soulfire burns violet-green and the pyre
 *  orange, never bloomed to white. */
export const FLAME_HEAT: readonly [number, number, number] = [0.6, 0, 0];

/** GLSL `vec3 <name>(float h)` built from a ramp's stops. */
export function rampGlsl(
  stops: readonly (readonly [number, number, number, number])[],
  name: string,
): string {
  const f = (v: number) => v.toFixed(3);
  let prev = 0;
  const lines = stops.map(([h, r, g, b], i) => {
    const from = i === 0 ? 'vec3(0.0)' : 'c';
    const line = `  ${i === 0 ? 'vec3 c' : 'c'} = mix(${from}, vec3(${f(r)}, ${f(g)}, ${f(b)}), smoothstep(${f(prev)}, ${f(h)}, h));`;
    prev = h;
    return line;
  });
  return `vec3 ${name}(float h) {\n${lines.join('\n')}\n  return c;\n}\n`;
}

// ---- particles and rings -----------------------------------------------------------

/** Which pooled particle draw a puff lands in: soft smoke and snow (normal
 *  blending), glowing motes and sparks (additive), or licking flames through
 *  the soulfire or the pyre ramp (additive, upright tongues). */
export type SanctumPool = 'smoke' | 'glow' | 'soulfire' | 'pyre';

export interface SanctumPuffOptions {
  speed: number;
  up?: number;
  life: number;
  size: readonly [number, number];
  /** rgb 0..1 (a flame pool reads `color[0]` as its heat). */
  color: readonly [number, number, number];
  alpha: number;
  pool?: SanctumPool;
  drag?: number;
  dir?: readonly [number, number, number];
  spread?: number;
  gravity?: number;
  /** Scatter the births over a disc of this radius. */
  radius?: number;
}

/** A shock ring racing out: its radius and brightness `elapsed` seconds in. */
export function shockRingLook(
  elapsed: number,
  radius: number,
  seconds: number,
): { radius: number; alpha: number } {
  const t = Math.max(0, Math.min(1, seconds > 0 ? elapsed / seconds : 1));
  const ease = 1 - (1 - t) ** 3;
  return { radius: radius * (0.12 + ease), alpha: (1 - t) ** 1.3 };
}

/** Gravity on a thrown ice shard (yards a second squared). */
export const SHARD_GRAVITY = 22;
/** Seconds a fallen shard lies on the ice before it melts away. */
export const SHARD_REST = 1.6;

// ---- the bodies' drawn sizes ---------------------------------------------------------

/** The height each Sanctum body is DRAWN at, in yards, at its template's sim
 *  scale (characters/sanctum_creature_looks.ts draws them so; every one stands
 *  clearly past a 2.6 yd player). The fx place their fires, tethers and glows
 *  on these. */
export const SANCTUM_DRAWN_HEIGHTS: Readonly<Record<string, number>> = {
  [BONEGUARD_ID]: 4.6,
  [BONEWALKER_ID]: 3.7,
  [SCALEGUARD_ID]: 4.4,
  [THAWCALLER_ID]: 4.4,
  [GOADSMITH_ID]: 4.6,
  [PYRE_TENDER_ID]: 4.4,
  [SOUL_BRAZIER_ID]: 2.4,
  [RIME_WHELP_ID]: 3.2,
  [SLEDGE_HAULER_ID]: 5.8,
  [GLACIER_SPLINTER_ID]: 5.4,
};

/** A body's drawn height at sim `scale` (2.6 yd a scale for anything else). */
export function sanctumDrawnHeight(templateId: string, scale: number): number {
  const drawn = SANCTUM_DRAWN_HEIGHTS[templateId];
  const base = MOBS[templateId]?.scale ?? 1;
  return drawn !== undefined ? (drawn * scale) / base : 2.6 * scale;
}
