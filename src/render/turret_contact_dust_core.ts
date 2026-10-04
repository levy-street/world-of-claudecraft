// Fire and Fly contact dust, the pure half: what a thrown monster kicks up where
// it meets the world. A ground contact (a bounce, the landing, a body bowled
// over) rolls a ring of dust out along the ground and heaves a cloud up, and a
// hard one throws clods; the slide after a landing ploughs a trail of dust
// behind the body; a trunk sheds bark chips and a puff where the body struck
// it. Everything scales with the contact's speed and the body's size, so a
// yeti's landing heaves far more dust than a wolf's. The puffs are the
// cannon's own closed-form puffs (cannon_puff_core.ts) launched into a burst of
// its pool (cannon_puff_burst_core.ts), so they draw in its one instanced quad.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a
// hash of the monster and the contact); a contact launches its puffs once into
// pooled records, and nothing here runs per frame.

import { DT } from '../sim/types';
import type { CannonPuffBurst } from './cannon_puff_burst_core';
import {
  CANNON_DIRT_GRAVITY,
  CANNON_PUFF_STYLES,
  type CannonPuff,
  cannonHash01,
  cannonTierAlpha,
  PUFF,
} from './cannon_puff_core';

export type TurretContactKind = 'bounce' | 'land' | 'wall' | 'bowl';

export interface TurretContact {
  kind: TurretContactKind;
  /** The body that met the world (for a knock, the struck one): with `seq`, the seed of every spread. */
  id: number;
  seq: number;
  /** The contact: the body's feet on the ground, or its feet where it met the trunk. */
  x: number;
  y: number;
  z: number;
  /** Speed into the ground or the trunk, or for a knock the flyer's speed across (yd/s). */
  speed: number;
  /** Unit horizontal direction the body leaves the contact in; zero when it has none. */
  dirX: number;
  dirZ: number;
  height: number;
  radius: number;
}

export function newTurretContact(): TurretContact {
  return {
    kind: 'bounce',
    id: 0,
    seq: 0,
    x: 0,
    y: 0,
    z: 0,
    speed: 0,
    dirX: 0,
    dirZ: 0,
    height: 1,
    radius: 0.5,
  };
}

/** A slide, as far as the trail reads it: the engine's skid segment. */
export interface TurretSlideInput {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly decel: number;
  readonly start: number;
  readonly end: number;
}

/** Cosmetic puff counts per contact, from the static preset (the low preset sheds these). */
export interface TurretContactCounts {
  /** Dust rolling out along the ground. */
  ring: number;
  /** Heavier dust heaving up. */
  rise: number;
  /** Clods thrown by a hard contact. */
  clods: number;
  /** Dust along a slide. */
  trail: number;
  /** Bark chips off a trunk. */
  chips: number;
}

const FULL_COUNTS: Readonly<TurretContactCounts> = {
  ring: 10,
  rise: 2,
  clods: 8,
  trail: 6,
  chips: 6,
};
const LOW_COUNTS: Readonly<TurretContactCounts> = {
  ring: 5,
  rise: 1,
  clods: 3,
  trail: 2,
  chips: 3,
};

export function turretContactCounts(low: boolean): Readonly<TurretContactCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

/** The most puffs one contact launches (a ground contact's ring, cloud and clods, or a landing's ring, cloud and trail). */
export const TURRET_CONTACT_PUFFS =
  FULL_COUNTS.ring + FULL_COUNTS.rise + Math.max(FULL_COUNTS.clods, FULL_COUNTS.trail);
/** Bursts alive at once: a wave's worth of bodies bouncing through a second of dust. */
export const TURRET_CONTACT_BURSTS = 24;

/** The smallest monster's height (yd): its dust is the unit the others scale from. */
export const TURRET_CONTACT_REF_HEIGHT = 1.2;
/** Contact speed (yd/s) at which the dust reaches full power (a first bounce from a core hit). */
export const TURRET_CONTACT_HARD_SPEED = 16;
/** A contact at least this fast (yd/s) throws clods: a hard landing, not a settling hop. */
export const TURRET_CLOD_SPEED = 9;
/** Seconds a contact seen late is aged by, at most: the frames it was already on screen. */
export const TURRET_CONTACT_MAX_LAG = 0.1;

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** How big a body is against the smallest one, from its height. */
export function turretContactScale(height: number): number {
  const k = height / TURRET_CONTACT_REF_HEIGHT;
  return Number.isFinite(k) ? Math.min(3, Math.max(0.5, k)) : 1;
}

/** 0..1 how hard a contact is, from its speed. */
export function turretContactPower(speed: number): number {
  return clamp01((speed - 1) / (TURRET_CONTACT_HARD_SPEED - 1));
}

/** The seconds a contact is aged by when first seen `ticks` after it happened. */
export function turretContactLag(ticks: number): number {
  return Math.min(TURRET_CONTACT_MAX_LAG, Math.max(0, ticks * DT));
}

function launch(
  p: CannonPuff,
  kind: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  drag: number,
  gravity: number,
  size0: number,
  size1: number,
  life: number,
  delay: number,
  rot: number,
  spin: number,
  floorY: number,
): number {
  p.kind = kind;
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.drag = drag;
  p.gravity = gravity;
  p.size0 = size0;
  p.size1 = size1;
  p.life = life;
  p.delay = delay;
  p.rot = rot;
  p.spin = spin;
  p.floorY = floorY;
  p.alpha = 1;
  return delay + life;
}

function groundOr(ground: (x: number, z: number) => number, x: number, z: number, y: number) {
  const g = ground(x, z);
  return Number.isFinite(g) ? g : y;
}

const DUST_ALPHA = CANNON_PUFF_STYLES[PUFF.dust].alpha;
const SHOCK_ALPHA = CANNON_PUFF_STYLES[PUFF.shock].alpha;

/** Dust rolled out along the ground by a contact of `weight`: a few for a soft one, the whole ring for a hard one. */
function ringPuffs(counts: Readonly<TurretContactCounts>, weight: number): number {
  return Math.max(Math.min(2, counts.ring), Math.ceil(counts.ring * weight));
}

/** Dust heaved up by a contact of `power`: one puff for a settling hop. */
function risePuffs(counts: Readonly<TurretContactCounts>, power: number): number {
  return power > 0.3 ? counts.rise : Math.min(1, counts.rise);
}

/** Seconds until a chip thrown up at `vy` from `y0` comes down on `floor`. */
function fallTime(vy: number, y0: number, floor: number): number {
  const g = CANNON_DIRT_GRAVITY;
  const disc = vy * vy + 2 * g * Math.max(0, y0 - floor);
  return (vy + Math.sqrt(disc)) / g;
}

/**
 * Launches a contact's puffs into `burst` from index 0 (its `count` and `life`
 * are set; `at` is the caller's). The ground is read a few times per contact,
 * never per frame.
 */
export function turretContactBurstInto(
  burst: CannonPuffBurst,
  c: Readonly<TurretContact>,
  counts: Readonly<TurretContactCounts>,
  ground: (x: number, z: number) => number,
): void {
  const out = burst.puffs;
  const cap = out.length;
  const seed = Math.imul(c.id | 0, 0x2545) ^ (c.seq | 0);
  const h = (i: number, j: number): number => cannonHash01(seed, i * 16 + j);
  const k = turretContactScale(c.height);
  const p = turretContactPower(c.speed);
  const heading = Math.hypot(c.dirX, c.dirZ);
  const dx = heading > 1e-6 ? c.dirX / heading : 0;
  const dz = heading > 1e-6 ? c.dirZ / heading : 0;
  let n = 0;
  let life = 0;
  if (c.kind === 'wall') {
    // The trunk stands behind the body as it rebounds: the chips fly out with it.
    const ox = c.x - dx * c.radius;
    const oz = c.z - dz * c.radius;
    const oy = c.y + 0.45 * c.height;
    const floor = groundOr(ground, ox, oz, c.y) + 0.05;
    const chips = Math.min(cap, Math.ceil(counts.chips * (0.4 + 0.6 * p)));
    for (let i = 0; i < chips && n < cap; i++) {
      const a = (h(i, 0) - 0.5) * 2.4;
      const sx = dx * Math.cos(a) - dz * Math.sin(a);
      const sz = dz * Math.cos(a) + dx * Math.sin(a);
      const out1 = 1.5 + 3 * h(i, 1);
      const vy = 1.2 + 2.6 * h(i, 2);
      const land = fallTime(vy, oy, floor);
      life = Math.max(
        life,
        launch(
          out[n++],
          PUFF.bark,
          ox,
          oy + (h(i, 3) - 0.5) * 0.4 * c.height,
          oz,
          sx * out1,
          vy,
          sz * out1,
          0,
          CANNON_DIRT_GRAVITY,
          (0.12 + 0.12 * h(i, 4)) * Math.sqrt(k),
          (0.1 + 0.1 * h(i, 4)) * Math.sqrt(k),
          land + 0.35,
          0.01 * i,
          h(i, 5) * TAU,
          (h(i, 6) - 0.5) * 12,
          floor,
        ),
      );
    }
    const puffs = Math.min(counts.rise, cap - n);
    const puffAlpha = cannonTierAlpha(DUST_ALPHA, FULL_COUNTS.rise, puffs);
    for (let i = 0; i < puffs; i++) {
      const idx = 20 + i;
      life = Math.max(
        life,
        launch(
          out[n++],
          PUFF.dust,
          ox,
          oy,
          oz,
          dx * (0.8 + 0.8 * h(idx, 0)),
          0.3 + 0.4 * h(idx, 1),
          dz * (0.8 + 0.8 * h(idx, 0)),
          2,
          -0.2,
          0.3 * k,
          (0.8 + 0.6 * p) * k,
          0.75 + 0.3 * h(idx, 2),
          0.02,
          h(idx, 3) * TAU,
          (h(idx, 4) - 0.5) * 0.6,
          NO_FLOOR,
        ),
      );
      out[n - 1].alpha = puffAlpha;
    }
    burst.count = n;
    burst.life = life;
    return;
  }
  const g = groundOr(ground, c.x, c.z, c.y);
  // A small soft landing rolls a few puffs; a heavy or hard one, the whole ring.
  const weight = clamp01((0.3 + 0.7 * p) * (0.6 + 0.4 * k));
  const ring = Math.min(cap, ringPuffs(counts, weight));
  const ringAlpha = cannonTierAlpha(SHOCK_ALPHA, ringPuffs(FULL_COUNTS, weight), ring);
  const reach = (0.4 + 1.1 * p) * k;
  const roll = 4.5;
  for (let i = 0; i < ring && n < cap; i++) {
    const a = ((i + 0.6 * h(i, 0)) / ring) * TAU;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const speed = reach * roll * (0.75 + 0.5 * h(i, 1));
    life = Math.max(
      life,
      launch(
        out[n++],
        PUFF.shock,
        c.x + sa * 0.3 * k,
        g + 0.22 * k,
        c.z + ca * 0.3 * k,
        sa * speed + dx * 1.5 * p,
        0.2 + (0.4 + 0.5 * h(i, 6)) * p,
        ca * speed + dz * 1.5 * p,
        roll,
        0,
        (0.5 + 0.3 * p) * k,
        (1.1 + 1.2 * p) * k * (0.85 + 0.3 * h(i, 2)),
        0.55 + 0.5 * p + 0.2 * h(i, 3),
        0,
        h(i, 4) * TAU,
        (h(i, 5) - 0.5) * 0.8,
        NO_FLOOR,
      ),
    );
    out[n - 1].alpha = ringAlpha;
  }
  const rise = Math.min(cap - n, risePuffs(counts, p));
  const riseAlpha = cannonTierAlpha(DUST_ALPHA, risePuffs(FULL_COUNTS, p), rise);
  for (let i = 0; i < rise; i++) {
    const idx = 20 + i;
    const side = (h(idx, 0) - 0.5) * 1.2;
    life = Math.max(
      life,
      launch(
        out[n++],
        PUFF.dust,
        c.x + dx * 0.3 * k + dz * side * 0.3 * k,
        g + 0.3 * k,
        c.z + dz * 0.3 * k - dx * side * 0.3 * k,
        dx * (0.6 + 1.2 * p) + dz * side,
        0.8 + 1.4 * p,
        dz * (0.6 + 1.2 * p) - dx * side,
        1.8,
        -0.25,
        0.5 * k,
        (1.2 + 1.4 * p) * k,
        0.9 + 0.6 * p + 0.2 * h(idx, 1),
        0.03,
        h(idx, 2) * TAU,
        (h(idx, 3) - 0.5) * 0.5,
        NO_FLOOR,
      ),
    );
    out[n - 1].alpha = riseAlpha;
  }
  if (c.kind !== 'land' && c.speed >= TURRET_CLOD_SPEED) {
    const hard = clamp01(
      (c.speed - TURRET_CLOD_SPEED) / (TURRET_CONTACT_HARD_SPEED - TURRET_CLOD_SPEED),
    );
    const clods = Math.min(
      cap - n,
      counts.clods,
      Math.ceil(counts.clods * (0.4 + 0.6 * hard) * Math.min(1.3, 0.7 + 0.3 * k)),
    );
    for (let i = 0; i < clods; i++) {
      const idx = 30 + i;
      const a = ((i + h(idx, 0)) / Math.max(1, clods)) * TAU;
      const out1 = 1 + 2.5 * h(idx, 1);
      const vx = Math.sin(a) * out1 + dx * 1.5;
      const vz = Math.cos(a) * out1 + dz * 1.5;
      const vy = 3.5 + 3 * p + 2 * h(idx, 2);
      const y0 = g + 0.15 * k;
      const guess = (2 * vy) / CANNON_DIRT_GRAVITY;
      const floor = groundOr(ground, c.x + vx * guess, c.z + vz * guess, g) + 0.06;
      life = Math.max(
        life,
        launch(
          out[n++],
          PUFF.dirt,
          c.x,
          y0,
          c.z,
          vx,
          vy,
          vz,
          0,
          CANNON_DIRT_GRAVITY,
          (0.14 + 0.12 * h(idx, 3)) * Math.sqrt(k),
          (0.12 + 0.1 * h(idx, 3)) * Math.sqrt(k),
          fallTime(vy, y0, floor) + 0.3,
          0.01 * (i % 3),
          h(idx, 4) * TAU,
          (h(idx, 5) - 0.5) * 10,
          floor,
        ),
      );
    }
  }
  burst.count = n;
  burst.life = life;
}

/**
 * Appends to `burst` the dust a slide ploughs up behind a body of `height`: a
 * puff every stretch of the slide, dropped the moment the body passes there
 * (its delay), sized by the speed the body still has. `from` is the tick the
 * burst's age 0 stands for; the slide's own start may precede it. A preset
 * that drops fewer spaces them wider at the same opacity: they lie where the
 * body has already been, so they never stack over it.
 */
export function turretSlideTrailInto(
  burst: CannonPuffBurst,
  slide: TurretSlideInput,
  height: number,
  seed: number,
  from: number,
  counts: Readonly<TurretContactCounts>,
  ground: (x: number, z: number) => number,
): void {
  const out = burst.puffs;
  const v = Math.hypot(slide.vx, slide.vz);
  const room = Math.min(counts.trail, out.length - burst.count);
  const seconds = Math.max(0, slide.end - slide.start) * DT;
  if (!(v > 1e-6) || room <= 0 || !(seconds > 0)) return;
  const a = slide.decel;
  const ux = slide.vx / v;
  const uz = slide.vz / v;
  const k = turretContactScale(height);
  const total = v * seconds - 0.5 * a * seconds * seconds;
  const spacing = Math.max(0.45 * k, total / room);
  const offset = (from - slide.start) * DT;
  const hh = (i: number, j: number): number => cannonHash01(seed ^ 0x51d3, i * 8 + j);
  let life = burst.life;
  let n = burst.count;
  for (let i = 1; i <= room; i++) {
    const d = i * spacing;
    if (d > total) break;
    const disc = Math.max(0, v * v - 2 * a * d);
    const s = a > 1e-6 ? (v - Math.sqrt(disc)) / a : d / v;
    const speed = Math.max(0, v - a * s);
    const x = slide.x + ux * d;
    const z = slide.z + uz * d;
    life = Math.max(
      life,
      launch(
        out[n++],
        PUFF.shock,
        x + (hh(i, 0) - 0.5) * 0.3 * k,
        groundOr(ground, x, z, slide.y) + 0.15 * k,
        z + (hh(i, 1) - 0.5) * 0.3 * k,
        ux * speed * 0.35,
        0.35 + 0.02 * speed,
        uz * speed * 0.35,
        3,
        0,
        0.3 * k,
        (0.55 + 0.07 * speed) * k * (0.85 + 0.3 * hh(i, 2)),
        0.6 + 0.2 * hh(i, 3),
        s - offset,
        hh(i, 4) * TAU,
        (hh(i, 5) - 0.5) * 0.8,
        NO_FLOOR,
      ),
    );
  }
  burst.count = n;
  burst.life = life;
}
