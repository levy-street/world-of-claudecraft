// The Guardian of the Heat's living fire (Jose's review of 2026-11-06: the
// first pass's flames read as flat pale-yellow cards): the pure half of
// heat_flame_tongues.ts. Each burning socket of the model (heat_body_core.ts
// HEAT_SOCKETS) holds a few persistent tongues of fire, each a ribbon facing
// the camera round its own bent spine, so no card edge ever shows: its root on
// the socket, its tip licking up and trailing behind the bone's motion, its
// height breathing on its own clock. This module plans the tongues (which
// socket, where round it, how big, their seed), the lick (`tongueLean`), the
// breathing (`tongueFlicker`) and the fire's ramp (deep red at the edges,
// orange through the body, yellow only at the core), shared by the shader.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import { type HeatSocketId, heatBodyHash } from './heat_body_core';

/** One tongue of fire on a socket. `off` is its root's offset from the socket
 *  in the body's frame (yards: x its left, y up, z forward), `w` and `h` its
 *  width and height in yards, `seed` its own noise and clock. */
export interface HeatTongue {
  socket: HeatSocketId;
  off: readonly [number, number, number];
  w: number;
  h: number;
  seed: number;
  /** How hot it burns (its core's share of the ramp, 0..1). */
  heat: number;
}

/** The tongues each socket holds: how many, the ring they stand on round it
 *  (yards), their size and heat. The shoulders and the back sheet the biggest
 *  fire (the concept's flames pour off its shoulders), the fists blaze, the
 *  horns and the crown lick, the vortex's top wraps the belt. */
interface SocketFire {
  socket: HeatSocketId;
  count: number;
  ring: number;
  w: number;
  h: number;
  heat: number;
  /** Shed on the low tier (cosmetic; the low tier keeps `lowCount`). */
  lowCount: number;
}

const SOCKET_FIRE: readonly SocketFire[] = [
  { socket: 'shoulderL', count: 6, ring: 1.4, w: 2.9, h: 4.6, heat: 0.92, lowCount: 2 },
  { socket: 'shoulderR', count: 6, ring: 1.4, w: 2.9, h: 4.6, heat: 0.92, lowCount: 2 },
  { socket: 'back', count: 5, ring: 1.8, w: 3.4, h: 5.8, heat: 0.88, lowCount: 2 },
  { socket: 'fistL', count: 4, ring: 0.8, w: 2.2, h: 4.4, heat: 0.95, lowCount: 1 },
  { socket: 'fistR', count: 4, ring: 0.8, w: 2.2, h: 4.4, heat: 0.95, lowCount: 1 },
  { socket: 'hornL', count: 2, ring: 0.35, w: 1.4, h: 2.6, heat: 0.8, lowCount: 1 },
  { socket: 'hornR', count: 2, ring: 0.35, w: 1.4, h: 2.6, heat: 0.8, lowCount: 1 },
  { socket: 'crown', count: 3, ring: 0.5, w: 1.7, h: 3.4, heat: 0.85, lowCount: 1 },
  { socket: 'vortexHigh', count: 6, ring: 2.4, w: 2.6, h: 4.6, heat: 0.78, lowCount: 2 },
];

/** Every tongue, in a fixed order (the painter's instance order). */
export const HEAT_TONGUES: readonly HeatTongue[] = (() => {
  const out: HeatTongue[] = [];
  let n = 0;
  for (const f of SOCKET_FIRE) {
    for (let i = 0; i < f.count; i++) {
      const a = (i / f.count) * Math.PI * 2 + heatBodyHash(n, 41) * 1.2;
      const r = f.ring * (0.55 + 0.45 * heatBodyHash(n, 43));
      // Varied heights: many short licks under a few tall tongues.
      const k = 0.55 + 0.75 * heatBodyHash(n, 47) ** 1.6;
      out.push({
        socket: f.socket,
        off: [Math.cos(a) * r, (heatBodyHash(n, 53) - 0.35) * f.ring * 0.6, Math.sin(a) * r * 0.7],
        w: f.w * (0.8 + 0.4 * heatBodyHash(n, 59)),
        h: f.h * k,
        seed: heatBodyHash(n, 61),
        heat: f.heat * (0.9 + 0.1 * heatBodyHash(n, 67)),
      });
      n++;
    }
  }
  return out;
})();

/** Is tongue `i` kept on the low tier (each socket keeps its first few)? */
export const HEAT_TONGUE_LOW: readonly boolean[] = (() => {
  const out: boolean[] = [];
  for (const f of SOCKET_FIRE) for (let i = 0; i < f.count; i++) out.push(i < f.lowCount);
  return out;
})();

/** The most a tongue leans off upright (its tip's sideways reach as a share
 *  of its height): a whipped flame, never one lying flat. */
export const TONGUE_MAX_LEAN = 0.85;

/** How far a tongue fans out from its socket (its tip's outward reach as a
 *  share of its height, before its own seed varies it). */
export const TONGUE_SPLAY = 0.34;

/** Yards of tip trail per yard a second the socket moves. */
export const TONGUE_DRAG = 0.16;

/** The lick off a socket moving at (vx, vy, vz) yards a second: the tip's
 *  sideways offset as a share of the height (x, z; trailing behind the
 *  motion, capped at TONGUE_MAX_LEAN), and the height's stretch (a fist
 *  swung up stretches its fire, one coming down squashes it). */
export function tongueLean(
  vx: number,
  vy: number,
  vz: number,
  out: { x: number; z: number; stretch: number },
): { x: number; z: number; stretch: number } {
  let x = -vx * TONGUE_DRAG;
  let z = -vz * TONGUE_DRAG;
  const m = Math.hypot(x, z);
  if (m > TONGUE_MAX_LEAN) {
    x *= TONGUE_MAX_LEAN / m;
    z *= TONGUE_MAX_LEAN / m;
  }
  out.x = x;
  out.z = z;
  // Moving down drags the fire up behind it; up squashes it a little.
  out.stretch = Math.max(0.7, Math.min(1.5, 1 - vy * 0.03));
  return out;
}

/** A tongue's breathing `t` seconds in: its height's share (about 0.75 to
 *  1.2), off three incommensurate waves on its own seed, so no two tongues
 *  pulse together and none ever loops visibly. */
export function tongueFlicker(t: number, seed: number): number {
  const s = seed * 40;
  const v =
    Math.sin(t * 3.1 + s) * 0.5 +
    Math.sin(t * 7.3 + s * 1.7) * 0.3 +
    Math.sin(t * 12.9 + s * 2.3) * 0.2;
  return 0.97 + 0.22 * v;
}

/** The fire's ramp, by heat 0..1 (linear rgb): smoke-dark red at the frayed
 *  edges, deep red, orange through the body, amber, and yellow-white only at
 *  the hottest core (the review: "orange/red with yellow only at cores").
 *  The top stop stays under 1 so additive layers never stack to white. */
export const HEAT_FIRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.0, 0.0, 0.0, 0.0],
  [0.12, 0.28, 0.02, 0.0],
  [0.3, 0.72, 0.1, 0.01],
  [0.5, 0.98, 0.3, 0.03],
  [0.7, 1.0, 0.52, 0.09],
  [0.86, 1.0, 0.74, 0.28],
  [1.0, 1.0, 0.9, 0.62],
];

/** The ramp read on the CPU (tests, and any painter that tints by it). */
export function fireRamp(h: number, out: [number, number, number]): [number, number, number] {
  const R = HEAT_FIRE_RAMP;
  const x = Math.max(0, Math.min(1, h));
  out[0] = R[0][1];
  out[1] = R[0][2];
  out[2] = R[0][3];
  for (let i = 1; i < R.length; i++) {
    const [h0] = R[i - 1];
    const [h1, r, g, b] = R[i];
    const k = Math.max(0, Math.min(1, (x - h0) / (h1 - h0)));
    const s = k * k * (3 - 2 * k);
    out[0] += (r - out[0]) * s;
    out[1] += (g - out[1]) * s;
    out[2] += (b - out[2]) * s;
  }
  return out;
}

/** The ramp as GLSL (`vec3 <name>(float h)`), the same smoothstep chain. */
export function fireRampGlsl(name: string): string {
  const f = (v: number) => v.toFixed(3);
  const R = HEAT_FIRE_RAMP;
  const lines = [`  vec3 c = vec3(${f(R[0][1])}, ${f(R[0][2])}, ${f(R[0][3])});`];
  for (let i = 1; i < R.length; i++) {
    const [h1, r, g, b] = R[i];
    lines.push(
      `  c = mix(c, vec3(${f(r)}, ${f(g)}, ${f(b)}), smoothstep(${f(R[i - 1][0])}, ${f(h1)}, h));`,
    );
  }
  return `vec3 ${name}(float h) {\n${lines.join('\n')}\n  return c;\n}\n`;
}

// ---- the bursts: punchy, never a washed-out frame ------------------------------------------

/** The impacts' caps (the review: the slam washed the whole screen white): a
 *  flash is short and sized to the point it hits, never the frame; the
 *  shockwave is a ring on the floor at a share of the brightness, its filled
 *  wake faint. Shared by the body's blows and the Basalt Fist's crater. */
export const HEAT_BURST = {
  /** The flash's life (seconds) and its size (yards per unit of `big`). */
  flashLife: 0.16,
  flashSize: 4.5,
  /** Its peak opacity (additive). */
  flashPeak: 0.55,
  /** The shockwave ring: its reach per unit of `big`, its look. */
  ringReach: 9,
  ring: { wake: 0.18, crest: 0.16, strength: 0.6 },
  /** The dark basalt flung per unit of `big`. */
  debris: 7,
} as const;
