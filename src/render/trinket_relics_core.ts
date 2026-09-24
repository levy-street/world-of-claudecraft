// Pure decisions for the Crucible raid trinket relics (src/render/trinket_relics.ts
// paints them): which worn trinket states an entity shows, where the Kindling
// Orb floats, how the Forgefather's hammer swings, how a Kindling bolt flies,
// how the Last Flame Lantern flickers and where its light ends. Three-, DOM-
// and i18n-free, deterministic (phases come from entity ids and the caller's
// clock, never a random draw), allocation-free on the per-frame paths: every
// writer fills caller-owned storage.
//
// Gameplay-neutral by construction. The one actionable read here is the
// lantern's light: a heal on an ally inside it splashes, so the circle is
// drawn at the sim's exact radius (TRINKET_SPECS, never a render constant) on
// every graphics tier. Everything else (orb, hammer, embers) is cosmetic and
// may thin with the quality level.

import { TRINKET_AURA, TRINKET_SPECS } from '../sim/content/trinkets';
import type { Aura } from '../sim/types';

/** The display ids the sim stamps on the relic cues (src/sim/combat/trinkets.ts). */
export const TRINKET_RELIC_CUE = Object.freeze({
  temper: 'trinket_forgefathers_temper',
  kindlingOrb: 'trinket_kindling_orb',
  kindlingBolt: 'trinket_kindling_orb_bolt',
  fletching: 'trinket_molten_fletching',
  lantern: 'trinket_last_flame_lantern',
  heart: 'trinket_heart_of_the_crucible',
});

function useRadius(itemId: string, fallback: number): number {
  const use = TRINKET_SPECS[itemId]?.use as { radius?: number } | undefined;
  return typeof use?.radius === 'number' ? use.radius : fallback;
}

/** The lantern's light, in yards: the sim's own splash radius. */
export const LANTERN_LIGHT_RADIUS = useRadius('last_flame_lantern', 12);

// Relic flags an entity's auras raise (a bit set, so a scan allocates nothing).
export const RELIC_ORB = 1;
export const RELIC_TEMPER = 2;
export const RELIC_PIERCE = 4;
export const RELIC_IGNITE = 8;
export const RELIC_LANTERN = 16;

type RelicAura = Pick<Aura, 'id' | 'remaining' | 'duration' | 'value2' | 'value3'>;

/** What the relic painter reads off one entity this frame. */
export interface RelicScan {
  flags: number;
  /** Kindling Orb aura: seconds left and total (0 when absent). */
  orbRemaining: number;
  orbDuration: number;
  /** Lantern: where it stands and how long it burns (valid with RELIC_LANTERN). */
  lanternX: number;
  lanternZ: number;
  lanternRemaining: number;
  lanternDuration: number;
}

export function createRelicScan(): RelicScan {
  return {
    flags: 0,
    orbRemaining: 0,
    orbDuration: 0,
    lanternX: 0,
    lanternZ: 0,
    lanternRemaining: 0,
    lanternDuration: 0,
  };
}

/** Fills `out` from an aura list. The lantern needs its position (value2 and
 *  value3 on the wearer's aura, see placeLantern in the sim); an aura without
 *  one is not a lantern the painter can place. */
export function scanRelicAuras(auras: readonly RelicAura[], out: RelicScan): RelicScan {
  out.flags = 0;
  out.orbRemaining = 0;
  out.orbDuration = 0;
  for (let i = 0; i < auras.length; i++) {
    const aura = auras[i];
    if (aura.remaining <= 0) continue;
    switch (aura.id) {
      case TRINKET_AURA.kindlingOrb:
        out.flags |= RELIC_ORB;
        out.orbRemaining = aura.remaining;
        out.orbDuration = Math.max(aura.duration, aura.remaining);
        break;
      case TRINKET_AURA.temper:
        out.flags |= RELIC_TEMPER;
        break;
      case TRINKET_AURA.pierce:
        out.flags |= RELIC_PIERCE;
        break;
      case TRINKET_AURA.ignite:
        out.flags |= RELIC_IGNITE;
        break;
      case TRINKET_AURA.lantern:
        if (typeof aura.value2 === 'number' && typeof aura.value3 === 'number') {
          out.flags |= RELIC_LANTERN;
          out.lanternX = aura.value2;
          out.lanternZ = aura.value3;
          out.lanternRemaining = aura.remaining;
          out.lanternDuration = Math.max(aura.duration, aura.remaining);
        }
        break;
    }
  }
  return out;
}

// ---- appear / vanish ---------------------------------------------------------

const APPEAR_SEC = 0.35;
const VANISH_SEC = 0.45;

/** 0..1 presence of a timed relic: grows in over its first moments and
 *  shrinks away over its last, so it never pops. */
export function relicPresence(remaining: number, duration: number): number {
  if (!(remaining > 0) || !(duration > 0)) return 0;
  const age = Math.max(0, duration - remaining);
  const grow = Math.min(1, age / APPEAR_SEC);
  const fade = Math.min(1, remaining / VANISH_SEC);
  // ease-out on both ends
  const g = 1 - (1 - grow) * (1 - grow);
  const f = 1 - (1 - fade) * (1 - fade);
  return Math.min(g, f);
}

// ---- Kindling Orb --------------------------------------------------------------

export interface OrbPose {
  /** World-space position. */
  x: number;
  y: number;
  z: number;
  /** Self spin about the vertical axis, radians. */
  spin: number;
  /** Tumble about its own horizontal axis, radians. */
  tumble: number;
}

export function createOrbPose(): OrbPose {
  return { x: 0, y: 0, z: 0, spin: 0, tumble: 0 };
}

// Beside the right shoulder, a little behind it. In the wearer's frame +Z is
// its facing (a view group's yaw rotates local +Z onto it) and, Y being up,
// -X is its right hand side.
export const ORB_SIDE = -0.62;
export const ORB_BACK = -0.18;
export const ORB_LIFT = 0.28;
const ORB_BOB = 0.075;

/** The orb's hover pose next to a wearer whose shoulder anchor sits at
 *  (sx, sy, sz) and who faces `yaw`. Phase comes from the entity id, so two
 *  orbs side by side never bob in lockstep. */
export function writeOrbPose(
  out: OrbPose,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  timeSec: number,
  entityId: number,
  reducedMotion: boolean,
): OrbPose {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // local (ORB_SIDE, ORB_BACK) rotated by yaw about +Y
  out.x = sx + ORB_SIDE * c + ORB_BACK * s;
  out.z = sz - ORB_SIDE * s + ORB_BACK * c;
  if (reducedMotion) {
    out.y = sy + ORB_LIFT;
    out.spin = 0;
    out.tumble = 0;
    return out;
  }
  const phase = (Math.abs(entityId) % 23) * 0.41;
  out.y = sy + ORB_LIFT + Math.sin(timeSec * 2.2 + phase) * ORB_BOB;
  out.spin = timeSec * 0.9 + phase;
  out.tumble = Math.sin(timeSec * 0.7 + phase) * 0.35;
  return out;
}

// ---- Kindling bolt -------------------------------------------------------------

export const KINDLING_BOLT_SPEED = 26;
const BOLT_MIN_SEC = 0.12;
const BOLT_MAX_SEC = 0.7;

/** Flight time of a bolt over `distance` yards. */
export function kindlingBoltDuration(distance: number): number {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  return Math.min(BOLT_MAX_SEC, Math.max(BOLT_MIN_SEC, d / KINDLING_BOLT_SPEED));
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Position along a bolt's flight at progress t (0..1): a straight line with a
 *  shallow lob that peaks mid-flight, scaled to the distance. */
export function writeKindlingBoltPoint(out: Point3, from: Point3, to: Point3, t: number): Point3 {
  const k = Math.min(1, Math.max(0, t));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lob = Math.min(1.2, dist * 0.06) * 4 * k * (1 - k);
  out.x = from.x + dx * k;
  out.y = from.y + dy * k + lob;
  out.z = from.z + dz * k;
  return out;
}

// ---- Forgefather's hammer ------------------------------------------------------

/** The spectral hammer's whole life, seconds. */
export const HAMMER_LIFE_SEC = 0.9;
/** When the face meets the anvil of the air: the burst fires here. */
export const HAMMER_STRIKE_SEC = 0.34;
const HAMMER_RAISED = -0.9;
const HAMMER_STRUCK = 1.75;

export interface HammerPose {
  /** Swing angle about the wearer-local X axis, radians (raised is negative). */
  swing: number;
  /** 0..1 uniform scale (grow in, shrink out). */
  scale: number;
  /** 0..1 glow of the hot face (flares at the strike). */
  heat: number;
}

export function createHammerPose(): HammerPose {
  return { swing: 0, scale: 0, heat: 0 };
}

/** Grip-to-face length of the hammer model, in model units (the GLB's head
 *  centre sits this far up the haft; build_trinket_relics.py). */
export const HAMMER_HEAD_UP = 0.58;

/** Where the hammer head sits relative to its grip pivot, in the wearer's
 *  frame, for a swing angle and model scale: forward (+Z) and up (+Y). */
export function writeHammerHeadOffset(
  out: { forward: number; up: number },
  swing: number,
  scale: number,
): void {
  const length = HAMMER_HEAD_UP * scale;
  out.forward = Math.sin(swing) * length;
  out.up = Math.cos(swing) * length;
}

/** Writes the hammer pose at `age` seconds; returns false once it has gone. */
export function writeHammerPose(out: HammerPose, age: number, reducedMotion: boolean): boolean {
  if (!(age >= 0) || age >= HAMMER_LIFE_SEC) {
    out.scale = 0;
    return false;
  }
  if (reducedMotion) {
    out.swing = HAMMER_STRUCK;
  } else if (age < HAMMER_STRIKE_SEC) {
    // wind-up hang, then an accelerating drop (ease-in cubic)
    const k = age / HAMMER_STRIKE_SEC;
    out.swing = HAMMER_RAISED + (HAMMER_STRUCK - HAMMER_RAISED) * k * k * k;
  } else {
    // a small rebound off the strike, settling back
    const k = (age - HAMMER_STRIKE_SEC) / (HAMMER_LIFE_SEC - HAMMER_STRIKE_SEC);
    out.swing = HAMMER_STRUCK - Math.sin(k * Math.PI) * 0.22 * (1 - k);
  }
  const grow = Math.min(1, age / 0.12);
  const fade = Math.min(1, (HAMMER_LIFE_SEC - age) / 0.25);
  out.scale = Math.min(grow, fade);
  const sinceStrike = age - HAMMER_STRIKE_SEC;
  out.heat =
    sinceStrike < 0
      ? 0.55 + 0.45 * (age / HAMMER_STRIKE_SEC)
      : Math.max(0.35, 1 - sinceStrike * 2.2);
  return true;
}

// ---- Last Flame Lantern --------------------------------------------------------

/** Flame flicker: a 0.8..1.2 scale on the flame, deterministic per lantern. */
export function lanternFlicker(timeSec: number, ownerId: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const p = (Math.abs(ownerId) % 19) * 0.53;
  return 1 + Math.sin(timeSec * 11.3 + p) * 0.09 + Math.sin(timeSec * 17.9 + p * 1.7) * 0.07;
}

/** The light circle's radial profile: (radius fraction, alpha) stops from the
 *  lantern outward. A faint warm fill, a bright rim AT the splash radius (the
 *  edge a healer reads), then nothing: the rim's outer falloff stays inside a
 *  tenth of a yard of the radius so the read never overstates the area. */
export const LANTERN_LIGHT_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.14],
  [0.55, 0.08],
  [0.9, 0.12],
  [0.975, 0.5],
  [1, 0.62],
  [1.008, 0],
];

/** Alpha multiplier of the light circle over the lantern's life: fades in with
 *  its presence, never below a readable floor while the light is up. */
export function lanternLightAlpha(remaining: number, duration: number): number {
  const p = relicPresence(remaining, duration);
  return p <= 0 ? 0 : Math.max(0.35, p);
}

// ---- embers (cosmetic particle budget) ------------------------------------------

/** Ember particles per second a relic state emits at vfx quality `q` (0..1).
 *  Purely cosmetic, so it thins with the quality level down to a trickle. */
export function relicEmberRate(kind: 'orb' | 'temper' | 'pierce' | 'ignite', q: number): number {
  const base = kind === 'orb' ? 7 : kind === 'pierce' ? 8 : kind === 'temper' ? 6 : 4;
  const quality = Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 1;
  return base * (0.3 + 0.7 * quality);
}

/** Advances an emission accumulator: returns how many particles to spawn this
 *  frame and leaves the fractional remainder in `acc.value`. */
export function drainEmission(acc: { value: number }, rate: number, dt: number): number {
  if (!(rate > 0) || !(dt > 0)) return 0;
  acc.value += rate * Math.min(dt, 0.25);
  const n = Math.floor(acc.value);
  acc.value -= n;
  return Math.min(n, 4);
}
