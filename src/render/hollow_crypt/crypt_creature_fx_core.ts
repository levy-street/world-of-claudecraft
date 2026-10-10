// Pure plan for the Hollow Crypt's hero creature effects (crypt_creature_fx.ts):
// the Ossuary Drake's Barrowflame Breath (the inhale over the bar, the torrent,
// the ground fire over the cone, the scorch it leaves), its tail sweep and its
// wing buffet, its landing blast; the Chapel Gargoyle's awakening, its dive's
// impact shockwave and its petrifying Stone Shriek.
//
// Every footprint comes from the sim's own templates, so the fire fills the cone
// the sim tests and the shockwave reaches the ring it hits. Anchors on the
// creature (the drake's and the Knellwyrm's jaws, the gargoyle's head) are
// measured off the art-guide models' authored clips at the key frame each effect
// plays on, in yards at the visual's authored size, scaled by the entity's own
// scale.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';

/** Sim facing convention: 0 = +z, a yaw rotates +z toward +x. */
export interface CreatureAnchor {
  /** Yards ahead of the entity along its facing. */
  forward: number;
  /** Yards over the floor. */
  up: number;
}

/** Creatures whose breath the crypt effects paint: the renderer skips its
 *  generic fire cone for them (the drake's torrent, ground fire and scorch
 *  here; the Bone Brute's Marrow Crush, a physical smash, is a ground crack
 *  down its cone in crypt_bone_fx.ts, never fire). */
export function paintsOwnBreath(templateId: string): boolean {
  return templateId === 'crypt_ossuary_drake' || templateId === 'crypt_bone_brute';
}

/** Where the drake's jaws hang while it draws the fire up (the bar: the head
 *  reared high) and while it pours it out (the play-out: the jaws thrust low over
 *  the cone's apex), at its authored size (Breath clip, frames 56 and 66). */
export const DRAKE_JAWS_INHALE: CreatureAnchor = { forward: 1.0, up: 14.5 };
export const DRAKE_JAWS_EXHALE: CreatureAnchor = { forward: 5.7, up: 4.9 };
/** The Knellwyrm's jaws as it pours the same breath (its own Breath clip, frame
 *  70: a lower, longer reach than the drake's), at its authored size. */
export const KNELLWYRM_JAWS_EXHALE: CreatureAnchor = { forward: 6.5, up: 3.0 };
/** The gargoyle's head as it rears to shriek (Screech clip). */
export const GARGOYLE_HEAD_SCREECH: CreatureAnchor = { forward: 1.44, up: 3.47 };

/** The torrent's timeline after the bar lands, in seconds. */
export const BREATH_TORRENT = { ramp: 0.12, hold: 1.35, fade: 0.45 } as const;
/** How long the scorched cone smoulders after the torrent. */
export const BREATH_SCORCH_SECONDS = 8;

/** The drake's breath footprint, straight off its template. */
export function drakeBreathCone(): { range: number; arcDeg: number } {
  const b = MOBS.crypt_ossuary_drake?.breathCone;
  return { range: b?.range ?? 0, arcDeg: b?.arcDeg ?? 0 };
}

/** The tail sweep's rear cone and the wing buffet's ring, off the template. */
export function drakeStrikeShapes(): {
  tail: { range: number; arcDeg: number };
  gust: { radius: number };
} {
  const kit = MOBS.crypt_ossuary_drake?.trashKit;
  return {
    tail: { range: kit?.tailLash?.range ?? 0, arcDeg: kit?.tailLash?.arcDeg ?? 0 },
    gust: { radius: kit?.wingGust?.radius ?? 0 },
  };
}

/** The Stone Shriek's reach, off the template. */
export function gargoyleShriekRadius(): number {
  return MOBS.crypt_chapel_gargoyle?.trashKit?.screech?.radius ?? 0;
}

/** Torrent strength in [0, 1] `t` seconds after the bar landed (0 before and after). */
export function torrentEnvelope(t: number): number {
  const { ramp, hold, fade } = BREATH_TORRENT;
  if (t < 0 || t > ramp + hold + fade) return 0;
  if (t < ramp) return t / ramp;
  if (t < ramp + hold) return 1;
  return 1 - (t - ramp - hold) / fade;
}

/** Total torrent seconds. */
export function torrentSeconds(): number {
  return BREATH_TORRENT.ramp + BREATH_TORRENT.hold + BREATH_TORRENT.fade;
}

/** The scorch's glow and char in [0, 1] `t` seconds after the torrent began. */
export function scorchPhase(t: number): { char: number; embers: number } {
  const total = torrentSeconds();
  if (t < 0) return { char: 0, embers: 0 };
  const grow = Math.min(1, t / (BREATH_TORRENT.ramp + 0.5));
  const after = Math.max(0, t - total);
  const fade = Math.max(0, 1 - after / BREATH_SCORCH_SECONDS);
  return {
    char: grow * fade,
    embers: grow * Math.max(0, 1 - after / (BREATH_SCORCH_SECONDS * 0.6)),
  };
}

/** An anchor on a creature at world (x, z) with `facing`, over `floorY`, at `scale`. */
export function anchorWorld(
  a: CreatureAnchor,
  x: number,
  floorY: number,
  z: number,
  facing: number,
  scale: number,
): { x: number; y: number; z: number } {
  return {
    x: x + Math.sin(facing) * a.forward * scale,
    y: floorY + a.up * scale,
    z: z + Math.cos(facing) * a.forward * scale,
  };
}

/** A small stateless hash in [0, 1). */
export function fxHash(n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * A spot inside a cone (local, apex at the origin, opening along +z), picked
 * by index: area-uniform in radius, stratified in angle, so the ground fire
 * covers the whole footprint from the apex to the rim. `minR` keeps spots off
 * the apex (the drake's own chest stands there).
 */
export function coneSpot(
  i: number,
  n: number,
  range: number,
  arcDeg: number,
  minR = 0,
): { x: number; z: number; r: number; a: number } {
  const half = (Math.min(360, arcDeg) * Math.PI) / 360;
  const u = (i + fxHash(i * 3.1 + 0.7)) / n;
  const r = Math.sqrt(minR * minR + (range * range - minR * minR) * fxHash(i * 7.3 + 1.9));
  const a = -half + 2 * half * ((u * 0.618034 * n) % 1);
  return { x: Math.sin(a) * r, z: Math.cos(a) * r, r, a };
}

/** Is a local point (apex origin, +z forward) inside the cone? */
export function inConeLocal(x: number, z: number, range: number, arcDeg: number): boolean {
  const r = Math.hypot(x, z);
  if (r > range) return false;
  if (r < 1e-6) return true;
  return Math.abs(Math.atan2(x, z)) <= (Math.min(360, arcDeg) * Math.PI) / 360 + 1e-9;
}

/** A shockwave ring's radius and strength `t` seconds in: it races out to
 *  `reach` over `seconds`, easing out, and fades as it goes. */
export function shockwave(
  t: number,
  reach: number,
  seconds: number,
): { radius: number; alpha: number; done: boolean } {
  if (t >= seconds) return { radius: reach, alpha: 0, done: true };
  const k = Math.max(0, t) / seconds;
  const ease = 1 - (1 - k) ** 3;
  return { radius: reach * (0.08 + 0.92 * ease), alpha: (1 - k) ** 1.4, done: false };
}

/** Did a creature just touch down? It had been up (`wasUp` yards over the
 *  floor at the last sample) and is now at the floor. */
export function touchedDown(wasUp: number, nowUp: number, minDrop = 2.5): boolean {
  return wasUp >= minDrop && nowUp <= 0.35;
}

/** The tail sweep's arc angle `t` seconds after it lands: it whips across the
 *  rear cone from one edge to the other (relative to straight behind). */
export function tailSweepAngle(t: number, arcDeg: number, seconds = 0.32): number {
  const half = (arcDeg * Math.PI) / 360;
  const k = Math.min(1, Math.max(0, t / seconds));
  const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  return -half + 2 * half * ease;
}

/** The Barrowflame's ghost-fire ramp as (heat, r, g, b) stops: a fire's
 *  temperature ladder shifted to grave-light (sooty green-black, grave-green,
 *  spectral green, pale green-white, a white-hot core). Warm, never cyan: blue
 *  never leads red past the embers, so it reads as flame, not ice. The shader
 *  (crypt_creature_fx.ts) is generated from these stops. */
export const GHOST_FIRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.15, 0.02, 0.05, 0.02],
  [0.33, 0.07, 0.3, 0.09],
  [0.52, 0.28, 0.82, 0.3],
  [0.72, 0.64, 1.0, 0.56],
  [0.88, 0.88, 1.0, 0.84],
  [1.0, 1.0, 1.0, 0.97],
];

/** GLSL `vec3 ghostRamp(float h)` built from GHOST_FIRE_RAMP. */
export function ghostFireRampGlsl(): string {
  const f = (v: number) => v.toFixed(3);
  let prev = 0;
  const lines = GHOST_FIRE_RAMP.map(([h, r, g, b], i) => {
    const from = i === 0 ? 'vec3(0.0)' : 'c';
    const line = `  ${i === 0 ? 'vec3 c' : 'c'} = mix(${from}, vec3(${f(r)}, ${f(g)}, ${f(b)}), smoothstep(${f(prev)}, ${f(h)}, h));`;
    prev = h;
    return line;
  });
  return `vec3 ghostRamp(float h) {\n${lines.join('\n')}\n  return c;\n}\n`;
}
