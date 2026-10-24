// The fire a torched mudfin hut plays (q_deepfen_purge's firebottle; the sim's
// `worldObjectBurning` event): about ten seconds of flame across the thatch and
// walls that catches fast and burns down, then smoke rising off the hut as the
// fire goes out. Pure and deterministic (no Three, no DOM, no clock; randomness
// comes in from the caller): hut_fire_fx.ts times each fire, the pooled particle
// cloud (vfx.ts hutFire) spawns the particles this samples.

/** Seconds of flame from the moment the hut catches. */
export const HUT_FIRE_BURN_SECONDS = 10;
/** Seconds of smoke after the flames are out. */
export const HUT_FIRE_SMOKE_SECONDS = 7;
export const HUT_FIRE_TOTAL_SECONDS = HUT_FIRE_BURN_SECONDS + HUT_FIRE_SMOKE_SECONDS;

/** The flames climb to full over this long, and start dying back here. */
const CATCH_SECONDS = 1.2;
const DIE_DOWN_FROM = 6.5;
/** Smoke swells as the flames die (7 s to 10 s), holds, then thins out. */
const SMOKE_SWELL_FROM = 7;
const SMOKE_SWELL_SECONDS = 3;
const SMOKE_FADE_FROM = HUT_FIRE_BURN_SECONDS + 2;

/** Particles a second at full intensity (the cloud scales them by its quality). */
export const HUT_FIRE_RATES = { flame: 60, ember: 14, smoke: 9 } as const;

export type HutFireKind = keyof typeof HUT_FIRE_RATES;

/** How strongly each part of the fire burns at one moment, 0 to 1. */
export interface HutFireFrame {
  flame: number;
  ember: number;
  smoke: number;
  done: boolean;
}

/** A burning hut: ground position, solid wall radius and drawn height (yards). */
export interface HutFireBody {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

export type HutFireSprite = 'flame' | 'firePuff' | 'smoke' | 'glowSoft' | 'flash';

/** One particle, in the pooled cloud's spawn terms (vfx.ts spawn). */
export interface HutFireParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
  size: number;
  life: number;
  /** Negative is buoyant: the particle rises faster as it fades. */
  gravity: number;
  sprite: HutFireSprite;
  spin: number;
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** The fire's strength `age` seconds after the hut caught, written into `out`
 *  (the per-frame form: no allocation). */
export function hutFireFrameInto(age: number, out: HutFireFrame): HutFireFrame {
  out.flame = 0;
  out.ember = 0;
  out.smoke = 0;
  out.done = age >= HUT_FIRE_TOTAL_SECONDS;
  if (!(age >= 0) || out.done) return out;
  const flame =
    smoothstep(age / CATCH_SECONDS) *
    (1 - smoothstep((age - DIE_DOWN_FROM) / (HUT_FIRE_BURN_SECONDS - DIE_DOWN_FROM)));
  const swell = smoothstep((age - SMOKE_SWELL_FROM) / SMOKE_SWELL_SECONDS);
  const fade = 1 - smoothstep((age - SMOKE_FADE_FROM) / (HUT_FIRE_TOTAL_SECONDS - SMOKE_FADE_FROM));
  out.flame = flame;
  out.ember = flame;
  // a thin trail of smoke while it burns, the thick plume as it goes out
  out.smoke = Math.max(0.2 * flame, swell * fade);
  return out;
}

/** The fire's strength `age` seconds after the hut caught. */
export function hutFireFrame(age: number): HutFireFrame {
  return hutFireFrameInto(age, { flame: 0, ember: 0, smoke: 0, done: false });
}

/** Where the thatch is at a height fraction: the eaves overhang the wall at
 *  about 0.45 of the height, and the roof closes to a point at the top. */
function roofRadius(body: HutFireBody, heightFraction: number): number {
  const eave = body.radius * 1.2;
  if (heightFraction <= 0.45) return body.radius;
  return eave * Math.max(0, 1 - (heightFraction - 0.45) / 0.55);
}

/**
 * Fill `out` with one particle of `kind` on `body`, drawing every random
 * choice from `rand` (uniform [0, 1)). Flames and embers mostly lick off the
 * thatch, a few off the walls; smoke rises off the top of the roof.
 */
export function sampleHutFireParticle(
  kind: HutFireKind,
  body: HutFireBody,
  rand: () => number,
  out: HutFireParticle,
): void {
  const scale = body.height / 4;
  const angle = rand() * Math.PI * 2;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  if (kind === 'smoke') {
    const h = 0.72 + rand() * 0.3;
    const r = roofRadius(body, h) * rand() * 0.8;
    out.x = body.x + sin * r;
    out.y = body.y + h * body.height;
    out.z = body.z + cos * r;
    out.vx = sin * 0.25 + (rand() - 0.5) * 0.3;
    out.vy = 0.8 + rand() * 0.6;
    out.vz = cos * 0.25 + (rand() - 0.5) * 0.3;
    out.color = rand() < 0.5 ? 0x58524c : 0x4c4540;
    out.size = (1.6 + rand() * 1.2) * scale;
    out.life = 2.4 + rand() * 1.2;
    out.gravity = -0.15;
    out.sprite = 'smoke';
    out.spin = rand() * Math.PI * 2;
    return;
  }
  // most of the fire is in the thatch; the rest climbs the walls
  const onRoof = rand() < 0.8;
  const h = onRoof ? 0.42 + rand() * 0.5 : 0.06 + rand() * 0.34;
  const r = roofRadius(body, h) * (0.9 + rand() * 0.2);
  out.x = body.x + sin * r;
  out.y = body.y + h * body.height;
  out.z = body.z + cos * r;
  if (kind === 'ember') {
    out.vx = sin * (0.3 + rand() * 0.5) + (rand() - 0.5) * 0.6;
    out.vy = 2 + rand() * 2;
    out.vz = cos * (0.3 + rand() * 0.5) + (rand() - 0.5) * 0.6;
    out.color = rand() < 0.35 ? 0xffe487 : 0xff7a2a;
    out.size = 0.08 + rand() * 0.1;
    out.life = 1 + rand() * 0.8;
    out.gravity = -0.5;
    out.sprite = rand() < 0.3 ? 'flash' : 'glowSoft';
    out.spin = rand() * Math.PI * 2;
    return;
  }
  const outward = 0.2 + rand() * 0.3;
  out.vx = sin * outward + (rand() - 0.5) * 0.25;
  out.vy = 1.2 + rand() * 1.2;
  out.vz = cos * outward + (rand() - 0.5) * 0.25;
  const tone = rand();
  out.color = tone < 0.15 ? 0xfff0a0 : tone < 0.75 ? 0xffa52f : 0xff5a14;
  out.size = (0.9 + rand() * 0.8) * scale;
  out.life = 0.55 + rand() * 0.45;
  out.gravity = -0.4;
  out.sprite = rand() < 0.7 ? 'flame' : 'firePuff';
  out.spin = (rand() - 0.5) * 0.6;
}
