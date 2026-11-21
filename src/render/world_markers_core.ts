// The raid's world markers on the floor, as pure decisions: the colour of each
// of the eight symbols, the size of the ground circle, where each pooled slot
// stands (and whether its floor drape must be rebuilt), the draped disc's
// vertex positions, the soft pulse, the flare's flicker (the beacon of light
// that rises from the circle), the floating symbol's bob, lift and distance
// scale (held inside a screen-size band, so it reads from across a raid room
// and never balloons up close), and what a graphics tier may shed. The Three
// half is world_markers.ts.
//
// The marks themselves come from IWorld.sharedMapMarks (the sim owns them:
// src/sim/social/shared_map_marks.ts); every mark carries its world point and
// the sim's floor height there, so this core never decides WHERE a mark is,
// only how its circle lies on the floor around that point.
//
// Positioning information a group plans around: every tier draws the circle,
// the rim, the beam that ties the symbol to its circle, and the symbol at the
// same size and height on its glow. A low tier sheds only cosmetic light: the
// soft fill, the turning runes, the rising motes, and half the strength of
// the floor pool and the beam (docs/design/graphics-settings-fairness.md).
//
// Three-, DOM- and i18n-free, deterministic (registered in RENDER_PURE_CORES).

/** The eight symbols' colours, in target-marker order (star, circle, diamond,
 *  triangle, moon, square, cross, skull): the same fills the target-marker
 *  icons paint (src/ui/icons.ts), so a world marker matches its button. */
export const WORLD_MARKER_COLORS: readonly number[] = [
  0xffe23a, 0xff8a2a, 0xd24bff, 0x37d72c, 0xcfe6ff, 0x23b5ff, 0xff3b30, 0xf4f4f4,
];

export const WORLD_MARKER_COUNT = WORLD_MARKER_COLORS.length;

/** The circle's radius (yards): the rim. Classic world markers read as a
 *  circle a few players can stand in. */
export const WORLD_MARKER_RADIUS = 1.6;

/** The disc reaches past the rim by this factor, for the soft outer halo. */
export const WORLD_MARKER_OUTER = 1.32;

/** Drape resolution: rings from the centre to the outer edge, and segments
 *  round. Enough that a step's edge reads as a clean fold, not a jag. */
export const WORLD_MARKER_RINGS = 8;
export const WORLD_MARKER_SEGMENTS = 48;

/** Vertices of one draped disc (the centre plus every ring). */
export const WORLD_MARKER_VERTS = 1 + WORLD_MARKER_RINGS * WORLD_MARKER_SEGMENTS;

/** Lift over the floor (yards) so the disc never z-fights the ground. */
export const WORLD_MARKER_LIFT = 0.045;

/** A drape sample further than this from the mark's own floor height (yards)
 *  is a wall top or a pit, not this floor: it holds the mark's height. */
export const WORLD_MARKER_DRAPE_REACH = 1.25;

/** The floating symbol's base height over the floor (yards): clearly over the
 *  head of a tall character, like a flare's symbol riding its beam. */
export const WORLD_MARKER_SYMBOL_LIFT = 3.2;
/** A symbol drawn larger than its near size (far off) rises by this share of
 *  the extra size, so its lower edge never sinks toward the circle. */
const SYMBOL_LIFT_PER_SIZE = 0.45;
/** The gentle bob: amplitude (yards) and rate (Hz). */
export const WORLD_MARKER_SYMBOL_BOB = 0.14;
const SYMBOL_BOB_HZ = 0.4;

/** The symbol's world size (yards) at a middling camera distance. */
export const WORLD_MARKER_SYMBOL_SIZE_NEAR = 1.75;
/** The screen-size band, as world yards per yard of camera distance at the
 *  world camera's default 60 degree vertical field of view (the screen's
 *  height at distance d is 2 d tan(30) = 1.155 d): MIN keeps the symbol at
 *  about 5.5% of the screen's height from across a room and MAX caps it near
 *  13% up close. worldMarkerSymbolSize rescales both for the live field of
 *  view, so a player who widens it keeps the same share of the screen. */
export const WORLD_MARKER_SYMBOL_SCREEN_MIN = 0.0635;
export const WORLD_MARKER_SYMBOL_SCREEN_MAX = 0.15;
/** The field of view the band is tuned at, and the range it accepts. */
export const WORLD_MARKER_CAMERA_FOV = 60;
const FOV_MIN = 20;
const FOV_MAX = 150;

/** The glow behind the symbol at full strength (opacity before the flicker). */
export const WORLD_MARKER_SYMBOL_GLOW_OPACITY = 0.85;
/** Each beam's streak phase step per symbol, so eight beams never ripple together. */
export const WORLD_MARKER_BEAM_PHASE = 0.79;

/** The beacon: the beam's height (yards) and its radii at the floor and top. */
export const WORLD_MARKER_BEAM_HEIGHT = 6.5;
export const WORLD_MARKER_BEAM_RADIUS_BOTTOM = 0.98;
export const WORLD_MARKER_BEAM_RADIUS_TOP = 0.72;
/** The glow behind the symbol, as a multiple of the symbol's size. */
export const WORLD_MARKER_SYMBOL_GLOW_SCALE = 2.1;

/** The flare's flicker: two unrelated rates over a steady base (0.86 to 1). */
const FLARE_BASE = 0.93;
const FLARE_A = 0.045;
const FLARE_A_HZ = 1.7;
const FLARE_B = 0.025;
const FLARE_B_HZ = 4.3;

const PULSE_HZ = 0.55;

/** Where one pooled slot's mark stands, as last drawn. */
export interface WorldMarkerSlotState {
  shown: boolean;
  x: number;
  y: number;
  z: number;
}

export function createWorldMarkerSlots(): WorldMarkerSlotState[] {
  return Array.from({ length: WORLD_MARKER_COUNT }, () => ({
    shown: false,
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
  }));
}

/** The world half of a mark this core reads (IWorld.sharedMapMarks rows). */
export interface WorldMarkerMark {
  symbol: number;
  wx: number;
  y: number;
  wz: number;
}

/** What one frame's sync must do for each slot (filled in place, no allocation). */
export const WorldMarkerChange = { None: 0, Show: 1, Move: 2, Hide: 3 } as const;
export type WorldMarkerChange = (typeof WorldMarkerChange)[keyof typeof WorldMarkerChange];

/**
 * Fold the live marks into the eight slots (one per symbol), writing each
 * slot's change into `changes` and the new placement into `slots`. A symbol
 * outside 0..7 or a non-finite point is ignored. Returns true when anything
 * changed, so an idle frame does nothing else.
 */
export function syncWorldMarkerSlots(
  slots: WorldMarkerSlotState[],
  marks: readonly WorldMarkerMark[],
  changes: WorldMarkerChange[],
): boolean {
  let any = false;
  for (let s = 0; s < WORLD_MARKER_COUNT; s++) changes[s] = WorldMarkerChange.None;
  let seen = 0;
  for (const m of marks) {
    const s = m.symbol;
    if (!Number.isInteger(s) || s < 0 || s >= WORLD_MARKER_COUNT) continue;
    if (!Number.isFinite(m.wx) || !Number.isFinite(m.y) || !Number.isFinite(m.wz)) continue;
    seen |= 1 << s;
    const slot = slots[s];
    if (slot.shown && slot.x === m.wx && slot.y === m.y && slot.z === m.wz) continue;
    changes[s] = slot.shown ? WorldMarkerChange.Move : WorldMarkerChange.Show;
    slot.shown = true;
    slot.x = m.wx;
    slot.y = m.y;
    slot.z = m.wz;
    any = true;
  }
  for (let s = 0; s < WORLD_MARKER_COUNT; s++) {
    const slot = slots[s];
    if (!slot.shown || seen & (1 << s)) continue;
    slot.shown = false;
    changes[s] = WorldMarkerChange.Hide;
    any = true;
  }
  return any;
}

/** A floor sampler: the floor height at (x, z) for a body standing near `refY`. */
export type WorldMarkerFloor = (x: number, z: number, refY: number) => number;

/**
 * Write one disc's draped vertex positions (x, y, z per vertex: the centre,
 * then ring by ring out to the halo's edge) round the mark at (cx, cy, cz).
 * Each vertex sits on the floor under it (lifted), so the circle folds over a
 * step instead of floating off it or sinking into it; a sample that leaves
 * the mark's floor (a wall top, a pit) holds the mark's own height.
 */
export function writeWorldMarkerDrape(
  out: Float32Array,
  cx: number,
  cy: number,
  cz: number,
  floor: WorldMarkerFloor,
): void {
  const at = (i: number, x: number, z: number): void => {
    const h = floor(x, z, cy);
    const y = Number.isFinite(h) && Math.abs(h - cy) <= WORLD_MARKER_DRAPE_REACH ? h : cy;
    out[i * 3] = x;
    out[i * 3 + 1] = y + WORLD_MARKER_LIFT;
    out[i * 3 + 2] = z;
  };
  at(0, cx, cz);
  const outer = WORLD_MARKER_RADIUS * WORLD_MARKER_OUTER;
  for (let r = 1; r <= WORLD_MARKER_RINGS; r++) {
    const radius = (outer * r) / WORLD_MARKER_RINGS;
    for (let k = 0; k < WORLD_MARKER_SEGMENTS; k++) {
      const a = (k / WORLD_MARKER_SEGMENTS) * Math.PI * 2;
      at(
        1 + (r - 1) * WORLD_MARKER_SEGMENTS + k,
        cx + Math.cos(a) * radius,
        cz + Math.sin(a) * radius,
      );
    }
  }
}

/** Each vertex's radius in rim units (1 = the rim) and angle (radians): the
 *  static attributes the ground shader draws its rings from. */
export function writeWorldMarkerPolar(radial: Float32Array, angle: Float32Array): void {
  radial[0] = 0;
  angle[0] = 0;
  for (let r = 1; r <= WORLD_MARKER_RINGS; r++) {
    for (let k = 0; k < WORLD_MARKER_SEGMENTS; k++) {
      const i = 1 + (r - 1) * WORLD_MARKER_SEGMENTS + k;
      radial[i] = (WORLD_MARKER_OUTER * r) / WORLD_MARKER_RINGS;
      angle[i] = (k / WORLD_MARKER_SEGMENTS) * Math.PI * 2;
    }
  }
}

/** The disc's triangle list (the centre fan, then a quad strip per ring). */
export function worldMarkerDiscIndex(): Uint16Array {
  const S = WORLD_MARKER_SEGMENTS;
  const out = new Uint16Array(S * 3 + (WORLD_MARKER_RINGS - 1) * S * 6);
  let o = 0;
  for (let k = 0; k < S; k++) {
    out[o++] = 0;
    out[o++] = 1 + ((k + 1) % S);
    out[o++] = 1 + k;
  }
  for (let r = 1; r < WORLD_MARKER_RINGS; r++) {
    const inner = 1 + (r - 1) * S;
    const outer = 1 + r * S;
    for (let k = 0; k < S; k++) {
      const k1 = (k + 1) % S;
      out[o++] = inner + k;
      out[o++] = inner + k1;
      out[o++] = outer + k;
      out[o++] = inner + k1;
      out[o++] = outer + k1;
      out[o++] = outer + k;
    }
  }
  return out;
}

/** The soft breathing of a mark's light (0.82 to 1), offset per symbol so
 *  eight marks never pulse in lockstep; steady under reduced motion. */
export function worldMarkerPulse(time: number, symbol: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 0.91 + 0.09 * Math.sin((time * PULSE_HZ + symbol * 0.125) * Math.PI * 2);
}

/** The flare's flicker (0.86 to 1): the beacon's light wavering like a lit
 *  flare, out of step per symbol; steady under reduced motion. */
export function worldMarkerFlare(time: number, symbol: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const p = symbol * 0.37;
  return (
    FLARE_BASE +
    FLARE_A * Math.sin((time * FLARE_A_HZ + p) * Math.PI * 2) +
    FLARE_B * Math.sin((time * FLARE_B_HZ + p * 2.3) * Math.PI * 2)
  );
}

/** How much wider the screen sees at `fovDeg` than at the tuned 60 degrees
 *  (tan of the half angles); a non-finite field of view reads as 60. */
function fovScale(fovDeg: number): number {
  const f = Number.isFinite(fovDeg)
    ? Math.min(FOV_MAX, Math.max(FOV_MIN, fovDeg))
    : WORLD_MARKER_CAMERA_FOV;
  return Math.tan((f * Math.PI) / 360) / Math.tan((WORLD_MARKER_CAMERA_FOV * Math.PI) / 360);
}

/** The symbol's world size at `distance` yards from a camera with vertical
 *  field of view `fovDeg`: the near size inside the screen band, else the
 *  band's edge, so it never balloons up close or shrinks to a speck far off. */
export function worldMarkerSymbolSize(
  distance: number,
  fovDeg: number = WORLD_MARKER_CAMERA_FOV,
): number {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const k = fovScale(fovDeg);
  return Math.min(
    d * WORLD_MARKER_SYMBOL_SCREEN_MAX * k,
    Math.max(WORLD_MARKER_SYMBOL_SIZE_NEAR, d * WORLD_MARKER_SYMBOL_SCREEN_MIN * k),
  );
}

/** The floating symbol's height over the floor at `time` for a symbol drawn
 *  `size` yards across: the base lift, raised for a symbol grown with
 *  distance, plus a slow bob (held still under reduced motion). */
export function worldMarkerSymbolLift(
  time: number,
  symbol: number,
  reducedMotion: boolean,
  size: number = WORLD_MARKER_SYMBOL_SIZE_NEAR,
): number {
  const grown = Number.isFinite(size) ? Math.max(0, size - WORLD_MARKER_SYMBOL_SIZE_NEAR) : 0;
  const base = WORLD_MARKER_SYMBOL_LIFT + grown * SYMBOL_LIFT_PER_SIZE;
  if (reducedMotion) return base;
  const phase = (time * SYMBOL_BOB_HZ + symbol * 0.17) * Math.PI * 2;
  return base + Math.sin(phase) * WORLD_MARKER_SYMBOL_BOB;
}

/** One symbol's pose for a frame, written in place (no allocation). */
export interface WorldMarkerSymbolPose {
  /** World height of the symbol and its glow. */
  y: number;
  /** World size of the symbol (yards). */
  size: number;
  /** World size of the glow behind it. */
  glowSize: number;
  /** The glow's opacity (with the flare's flicker). */
  glowOpacity: number;
}

export function createWorldMarkerSymbolPose(): WorldMarkerSymbolPose {
  return { y: 0, size: 0, glowSize: 0, glowOpacity: 0 };
}

/**
 * Pose the floating symbol of the mark standing at `slot` for a camera at
 * (camX, camY, camZ) with vertical field of view `fovDeg`: the size from the
 * distance to the symbol's resting point (so the bob never makes it breathe),
 * then the lift for that size and the bob, the glow's size and its flickering
 * opacity.
 */
export function worldMarkerSymbolPoseInto(
  out: WorldMarkerSymbolPose,
  camX: number,
  camY: number,
  camZ: number,
  fovDeg: number,
  slot: { x: number; y: number; z: number },
  time: number,
  symbol: number,
  reducedMotion: boolean,
): WorldMarkerSymbolPose {
  const dx = camX - slot.x;
  const dy = camY - (slot.y + WORLD_MARKER_SYMBOL_LIFT);
  const dz = camZ - slot.z;
  const size = worldMarkerSymbolSize(Math.sqrt(dx * dx + dy * dy + dz * dz), fovDeg);
  out.size = size;
  out.y = slot.y + worldMarkerSymbolLift(time, symbol, reducedMotion, size);
  out.glowSize = size * WORLD_MARKER_SYMBOL_GLOW_SCALE;
  out.glowOpacity =
    WORLD_MARKER_SYMBOL_GLOW_OPACITY * worldMarkerFlare(time, symbol, reducedMotion);
  return out;
}

/** The clock the beams' streaks and motes run on: held at 0 under reduced
 *  motion, so a still beam stays still. */
export function worldMarkerClock(time: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : time;
}

/** What a graphics tier draws. The circle, rim, beam and symbol (its size,
 *  height, bob and glow) are never shed; only cosmetic light is. */
export interface WorldMarkerLook {
  /** The soft fill and outer halo of the circle. */
  glow: boolean;
  /** The turning rune band inside the rim. */
  runes: boolean;
  /** The strength (0 to 1) of the beacon: the additive light pool on the
   *  floor and the beam of light rising from the circle to its symbol. */
  beam: number;
  /** The motes of light rising inside the beam. */
  motes: boolean;
}

export function worldMarkerLook(lowTier: boolean): WorldMarkerLook {
  return lowTier
    ? { glow: false, runes: false, beam: 0.5, motes: false }
    : { glow: true, runes: true, beam: 1, motes: true };
}
