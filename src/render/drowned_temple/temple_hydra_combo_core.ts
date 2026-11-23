// Pure plan for the Mere Hydra's Combined Breath visuals (temple_hydra_combo_fx.ts
// and the mouth charge and pours in temple_hydra.ts / temple_hydra_fx.ts): which
// element each head brings to a combo, the charge envelope over the 2 s bar,
// the Frostlocked Torrent's lane, the Ice Wall's rise and melt, the Venom
// Current's arrows and the Toxic Rime's countdown, all derived from the sim's
// own constants so the edge a player reads is the edge the sim tests.
//
// Three-free, DOM-free, deterministic, allocation-free where it runs per frame
// (the `*Into` forms fill a caller-owned record).

import {
  HYDRA_COMBO_ELEMENTS,
  HYDRA_COMBO_TUNING,
  HYDRA_ELEMENTS,
  HYDRA_TUNING,
  type HydraComboKind,
  type HydraElement,
  hydraComboOf,
  iceWallOfObject,
  inIceWallLee,
  type TsunamiSide,
  venomCurrentHeading,
} from '../../sim/encounters/drowned_temple/ids';

/** Each element's colour on the floor mark and in the mouth (linear RGB 0..1):
 *  frost a pale ice blue, venom a sea green, water the lagoon turquoise. */
export const COMBO_ELEMENT_RGB: Readonly<Record<HydraElement, readonly [number, number, number]>> =
  {
    frost: [0.72, 0.9, 1.0],
    venom: [0.5, 1.0, 0.36],
    tide: [0.25, 0.86, 0.92],
  };

/** The head (0..2) that wields element `el` (HYDRA_ELEMENTS index) given the
 *  heads' dead flags, or null: the sim's hydraElementOwners rule (its own head
 *  while it lives, else the next living head round), without allocating. */
export function elementOwner(el: number, dead: readonly boolean[]): number | null {
  for (let k = 0; k < 3; k++) {
    const h = (el + k) % 3;
    if (!dead[h]) return h;
  }
  return null;
}

/** Fill `out` with the elements head `head` (0 left, 1 centre, 2 right) brings
 *  to a combo, given the heads' dead flags: one for a pair, both for a lone
 *  survivor that carries them, none when it takes no part. */
export function comboHeadElementsInto(
  kind: HydraComboKind,
  head: number,
  dead: readonly boolean[],
  out: HydraElement[],
): HydraElement[] {
  out.length = 0;
  for (const el of HYDRA_COMBO_ELEMENTS[kind]) {
    if (elementOwner(el, dead) === head) out.push(HYDRA_ELEMENTS[el]);
  }
  return out;
}

/** The elements head `head` brings to a combo (a fresh array: tests and cold
 *  paths; the per-frame paths use comboHeadElementsInto). */
export function comboHeadElements(
  kind: HydraComboKind,
  head: number,
  dead: readonly boolean[],
): HydraElement[] {
  return comboHeadElementsInto(kind, head, dead, []);
}

/** The element a head pours in its combo bar's last half second (the water
 *  when it brings it, else its first element), or null. Allocation-free. */
export function comboPourElement(
  castId: string | null,
  head: number,
  dead: readonly boolean[],
): HydraElement | null {
  const kind = hydraComboOf(castId);
  if (!kind) return null;
  let first: HydraElement | null = null;
  for (const el of HYDRA_COMBO_ELEMENTS[kind]) {
    if (elementOwner(el, dead) !== head) continue;
    if (HYDRA_ELEMENTS[el] === 'tide') return 'tide';
    first ??= HYDRA_ELEMENTS[el];
  }
  return first;
}

/** The head (0..2) that wields the water now, or null. */
export function waterHead(dead: readonly boolean[]): number | null {
  return elementOwner(2, dead);
}

/** The highest crystal pulse (beats a second), and the calm (reduced motion)
 *  ceiling. */
export const RIME_PULSE_MAX = 3;
export const RIME_PULSE_CALM = 1.2;

/** The charge glow at a combo head's mouth over its bar, 0 to 1: it swells
 *  through the bar and flares in its last fifth. */
export function comboChargeEnvelope(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 0;
  const t = Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
  const swell = t * t * (3 - 2 * t);
  const flare = t > 0.8 ? (t - 0.8) / 0.2 : 0;
  return Math.min(1, 0.15 + 0.7 * swell + 0.15 * flare);
}

/** How full a combo's floor mark is (0 as the bar opens, 1 as it lands). */
export function comboFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/** The Frostlocked Torrent's lane: from the water head's foot along its locked
 *  facing, the Crushing Torrent's own length and half width (the sim lands the
 *  freeze in exactly this lane). */
export interface ComboLane {
  x: number;
  z: number;
  yaw: number;
  length: number;
  halfWidth: number;
}

export function frostlockLaneInto(x: number, z: number, yaw: number, out: ComboLane): ComboLane {
  out.x = x;
  out.z = z;
  out.yaw = yaw;
  out.length = HYDRA_TUNING.torrentLength;
  out.halfWidth = HYDRA_TUNING.torrentHalfWidth;
  return out;
}

/** The Ice Wall's height (yards) and how long it takes to rise and melt. */
export const ICE_WALL_HEIGHT = 4.2;
export const ICE_WALL_RISE_SECONDS = 0.4;
export const ICE_WALL_MELT_SECONDS = 0.6;
/** The wall's authored length (yards): every Frostlocked Torrent leaves one
 *  this long (the torrent's lane less the gap at the head). */
export const ICE_WALL_LENGTH = HYDRA_TUNING.torrentLength - HYDRA_COMBO_TUNING.wallStart;

/** The wall's rise, 0 to 1, `age` seconds after it was first seen: a fast rise
 *  that overshoots a touch and settles (ice punching up out of the lane). */
export function iceWallRise(age: number): number {
  if (age <= 0) return 0;
  const t = Math.min(1, age / ICE_WALL_RISE_SECONDS);
  const c = 1.6;
  const back = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  return Math.max(0, back);
}

/** A melting wall's remaining height and opacity, 1 to 0 over the melt. */
export function iceWallMelt(age: number): number {
  return Math.max(0, 1 - age / ICE_WALL_MELT_SECONDS);
}

/** Which side of the wall a wave from `side` leaves in its lee: +1 when the
 *  shelter is on the wall's +normal side (normal = its heading turned a
 *  quarter right, toward +x for a wall running +z), else -1. */
export function iceWallLeeSign(wallYaw: number, waveFacing: number): number {
  const nx = Math.cos(wallYaw);
  const nz = -Math.sin(wallYaw);
  const rx = Math.sin(waveFacing);
  const rz = Math.cos(waveFacing);
  return nx * rx + nz * rz >= 0 ? 1 : -1;
}

/** Is a spot (instance-local) in the lee of the mirrored wall object (its
 *  middle, facing and scale) against a wave from `side`: the sim's own test. */
export function inMirroredWallLee(
  midX: number,
  midZ: number,
  facing: number,
  length: number,
  side: TsunamiSide,
  x: number,
  z: number,
): boolean {
  return inIceWallLee(iceWallOfObject(midX, midZ, facing, length), side, x, z);
}

/** A Venom Current arrow: where it starts (the pool, instance-local), the
 *  heading it slides on and how far. */
export interface CurrentArrow {
  x: number;
  z: number;
  yaw: number;
  length: number;
}

export function currentArrowInto(localX: number, localZ: number, out: CurrentArrow): CurrentArrow {
  out.x = localX;
  out.z = localZ;
  out.yaw = venomCurrentHeading(localX, localZ);
  out.length = HYDRA_COMBO_TUNING.currentSlide;
  return out;
}

/** How much of a sliding pool's arrow is still ahead of it, given how far it
 *  has slid from where it was first seen (0 to 1). */
export function currentArrowLeft(slid: number): number {
  return Math.min(1, Math.max(0, 1 - slid / HYDRA_COMBO_TUNING.currentSlide));
}

/** A Toxic Rime crystal's look `age` seconds after it froze: the crystals
 *  grow in the first half second, the glow climbs toward the burst and the
 *  pulse quickens (a visual countdown over rimeSeconds). */
export interface RimeLook {
  grow: number;
  glow: number;
  /** Pulses a second. */
  pulse: number;
}

export function rimeLookInto(age: number, out: RimeLook, calm = false): RimeLook {
  const total = HYDRA_COMBO_TUNING.rimeSeconds;
  const k = Math.min(1, Math.max(0, age / total));
  const g = Math.min(1, Math.max(0, age / 0.5));
  out.grow = 1 - (1 - g) ** 3;
  out.glow = 0.2 + 0.8 * k * k;
  out.pulse = calm ? 0.6 + (RIME_PULSE_CALM - 0.6) * k : 1 + (RIME_PULSE_MAX - 1) * k;
  return out;
}

/** Advance a pulse's phase (radians) by `hz` over `dt`, wrapped to one turn:
 *  the shader reads sin(phase), so a pulse whose rate changes never jumps. */
export function advancePhase(phase: number, hz: number, dt: number): number {
  const p = phase + hz * dt * Math.PI * 2;
  return p >= Math.PI * 2 ? p % (Math.PI * 2) : p;
}

/** The camera kick for a burst at distance `d` (yards) from the local player:
 *  `near` within `nearR`, `far` within `farR`, nothing beyond. */
export function burstShake(
  d: number,
  nearR: number,
  near: number,
  farR: number,
  far: number,
): number {
  if (d <= nearR) return near;
  if (d <= farR) return far;
  return 0;
}
