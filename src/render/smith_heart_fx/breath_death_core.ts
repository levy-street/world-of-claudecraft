// The Guardian of the Breath's death as numbers, "The storm loses its
// anchor": the pure half of breath_death_fx.ts. The counterpart of its
// entrance (breath_entrance_core.ts, "Calm before the storm": the still air
// drawn up into an eye of cloud, the funnel coming down, the burst, the great
// bolt): here the storm comes undone.
//
//   the pull     the winds stop howling and are sucked back into its body in
//                spiralling streams; the currents that are its body wind in
//                tight and fast
//   the arcs     lightning arcs wildly off it (piece to piece, to the floor,
//                up into the cloud), then sputters: shorter, dimmer, fewer
//   the unravel  the body loses cohesion: its currents fling out and thin,
//                it comes apart into drifting cloud, its stones drop
//   the clap     one last thunderclap: a bolt out of the cloud into its
//                heart, a flash, its light goes out
//   the clearing the clouds overhead part from the middle out, their torn
//                rims lit gold, and a shaft of clear light falls on the isle;
//                the wind over the isle dies down to stillness, the dust
//                settling in the light
//
// Presentation only: no camera, no input, nothing held back from loot or
// exit. A guardian first seen long dead shows the end state (the calm, no
// scene); a dev replay (`/dev heart breath death`) plays it on the living
// body and gives the wind back. Node-only (RENDER_PURE_CORES): no three.js,
// no DOM, deterministic (a hash, never rng).

import { BREATH_SOCKETS, type BreathSocketId, breathSocketIndex } from './breath_body_core';
import { SMITH_HEART_ENTRANCE_LOW_SHARE } from './entrance_budget_core';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const spike = (since: number, span: number) =>
  since < 0 ? 0 : Math.min(1, since / 0.05) * (1 - clamp01(since / span)) ** 2;

/** Deterministic hash in [0, 1). */
export function breathDeathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = breathDeathHash;

/** The scene's beats (seconds after it fell). */
export const BREATH_DEATH = {
  /** The streams of wind sucked home: the first leaves at `streamFrom`,
   *  each next `streamStagger` later, each taking `streamTravel`. */
  streamFrom: 0.05,
  streamStagger: 0.13,
  streamTravel: 1.45,
  /** The body's currents drawn tight by here. */
  pullTo: 2.2,
  /** The wild arcs from `wildFrom`, sputtering from `sputterFrom`, the last
   *  spark by `arcsTo`. */
  wildFrom: 0.25,
  sputterFrom: 2.4,
  arcsTo: 4.6,
  /** It comes apart into cloud between these. */
  unravelFrom: 3.0,
  unravelTo: 5.6,
  /** The last thunderclap. */
  clapAt: 5.3,
  /** The cloud overhead: gathered dark by `deckIn`, parting from `partFrom`
   *  to its widest by `partTo`, gone by `end`. */
  deckIn: 0.9,
  partFrom: 5.55,
  partTo: 7.9,
  /** The shaft of clear light: from `shaftFrom`, full by `shaftFull`, out
   *  over the scene's last `shaftFade` seconds. */
  shaftFrom: 5.7,
  shaftFull: 6.8,
  shaftFade: 2.4,
  /** The wind over the isle: full until `stillFrom`, still by `stillTo`. */
  stillFrom: 0.7,
  stillTo: 6.8,
  end: 9.6,
} as const;

const D = BREATH_DEATH;

/** The storm's shape over its foot (yards): the cloud deck's height and
 *  radius, the shaft's radius at the floor and at the deck, the heart's
 *  height the streams drive into (the core socket, at the model's rest). */
export const BREATH_DEATH_SHAPE = {
  deckH: 44,
  deckR: 74,
  shaftFoot: 8,
  shaftTop: 13,
  heartY: 11,
} as const;

/** The camera's thuds (none under reduced motion). */
export const BREATH_DEATH_SHAKES = {
  pull: { amount: 0.25, reach: 90 },
  clap: { amount: 0.95, reach: 120 },
} as const;

export function breathDeathShake(
  amount: number,
  reach: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= reach) return 0;
  return amount * (1 - (distance / reach) * 0.6);
}

/** Reduced motion keeps every flash and bolt, never a blaze or a flicker. */
export const BREATH_DEATH_CALM = { flash: 0.6, lightCap: 0.7 } as const;

export function breathDeathLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v * BREATH_DEATH_CALM.flash, BREATH_DEATH_CALM.lightCap) : v;
}

/** Did the scene cross `at` between `prev` and `t` (once, only for a scene
 *  seen crossing it)? */
export function breathDeathCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

// ---- the clock -----------------------------------------------------------------------------

/** A dev replay plays this long, then the wind comes back. */
export const BREATH_REPLAY_SECONDS = D.end + 0.6;

/** The scene's clock: seconds since it fell at `deadAt` (a corpse first seen
 *  dead is dated long past), or since a dev replay began at `replayAt` (-1
 *  none); -1 when neither (it blows). */
export function breathDeathTime(
  clock: number,
  deadAt: number,
  replayAt: number,
  dead: boolean,
): number {
  if (dead) return clock - deadAt;
  if (replayAt >= 0 && clock >= replayAt && clock - replayAt < BREATH_REPLAY_SECONDS)
    return clock - replayAt;
  return -1;
}

// ---- the body, through breath_death_state.ts -------------------------------------------------

/** What the body's air does through the scene (breath_body.ts rides it). */
export interface BreathDeathBodyLook {
  /** The look is on (its scene plays, or its husk lies). */
  active: boolean;
  /** The currents' density (1 whole, 0 gone). */
  wind: number;
  /** Their winding's share of its rest radius (under 1 drawn tight). */
  radius: number;
  /** Their speed's share. */
  spin: number;
  /** Their fling outward (1 none). */
  fling: number;
  /** The shiver through them. */
  shiver: number;
  /** The air drawn into its mouth (0..1). */
  drawIn: number;
  /** Its light (1 as in the fight, 0 out) and a flare over it. */
  glow: number;
  flare: number;
  /** The storm's hold on its colour and arcs (0..1). */
  storm: number;
  /** Arcs a second between its pieces (before the tier). */
  arcs: number;
  /** The stones and shards round it dropping (0 aloft, 1 down). */
  drop: number;
}

export function newBreathDeathBodyLook(): BreathDeathBodyLook {
  return {
    active: false,
    wind: 1,
    radius: 1,
    spin: 1,
    fling: 1,
    shiver: 0,
    drawIn: 0,
    glow: 1,
    flare: 0,
    storm: 0,
    arcs: 0,
    drop: 0,
  };
}

/** The body's look at scene time `t` (allocation free). */
export function breathDeathBodyLook(t: number, out: BreathDeathBodyLook): BreathDeathBodyLook {
  const tt = Math.max(0, t);
  out.active = true;
  const pull = smooth(0, D.pullTo, tt);
  const unravel = smooth(D.unravelFrom, D.unravelTo, tt);
  // Drawn in tight and fast, then flung out slack and fading.
  out.radius = 1 - 0.45 * pull + 1.3 * unravel;
  out.spin = 1 + 1.7 * pull * (1 - unravel) - 0.6 * unravel;
  out.fling = 1 + 1.6 * unravel;
  out.wind = 1 - unravel;
  out.shiver = 0.35 * pull * (1 - unravel) + 0.5 * breathDeathWild(tt);
  out.drawIn = pull * (1 - smooth(D.pullTo, D.unravelFrom, tt));
  const clap = spike(tt - D.clapAt, 0.7);
  out.flare = 0.6 * breathDeathWild(tt) + 1.4 * clap;
  out.glow = 1 - smooth(D.clapAt + 0.05, D.clapAt + 0.9, tt);
  out.storm =
    Math.max(breathDeathWild(tt), 1 - smooth(D.sputterFrom, D.arcsTo, tt)) * (tt > 0 ? 1 : 0);
  out.arcs = breathDeathArcRate(tt);
  out.drop = smooth(D.unravelFrom + 0.3, D.unravelFrom + 2, tt);
  return out;
}

/** The arcs' wildness (0..1): up fast, held, guttering through the
 *  sputter. */
export function breathDeathWild(t: number): number {
  return (
    smooth(D.wildFrom - 0.1, D.wildFrom + 0.4, t) * (1 - smooth(D.sputterFrom - 0.3, D.arcsTo, t))
  );
}

/** Arcs a second between the body's pieces at `t` (wild, then sputtering to
 *  none). */
export function breathDeathArcRate(t: number): number {
  if (t < D.wildFrom || t >= D.arcsTo) return 0;
  return (
    22 * breathDeathWild(t) +
    (t > D.sputterFrom ? 2.5 * (1 - smooth(D.sputterFrom, D.arcsTo, t)) : 0)
  );
}

// ---- the streams of wind sucked home ---------------------------------------------------------

/** One stream of wind: when it leaves, where from (heading about up off its
 *  facing, yards out and up) and how many turns it winds in. */
export interface BreathDeathStream {
  at: number;
  angle: number;
  r: number;
  h: number;
  turns: number;
}

export const BREATH_DEATH_STREAMS: readonly BreathDeathStream[] = Array.from(
  { length: 10 },
  (_, i) => ({
    at: D.streamFrom + D.streamStagger * i,
    angle: (i / 10) * Math.PI * 2 + (hash(i, 3) - 0.5) * 0.5,
    r: 24 + 12 * hash(i, 5),
    h: 2 + 22 * hash(i, 7),
    turns: 0.8 + 0.6 * hash(i, 11),
  }),
);

/** Where stream `s`'s head is at scene time `t`, off the guardian's foot
 *  (yards; y up), and how far along it is (`k` 0..1, -1 not yet left or
 *  home). Every stream winds the same way, tightening into its heart. */
export function breathStreamHead(
  s: BreathDeathStream,
  t: number,
  out: { x: number; y: number; z: number; k: number },
) {
  const k = (t - s.at) / D.streamTravel;
  if (k < 0 || k > 1) {
    out.k = -1;
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  // Slow at its far end, racing as it closes in.
  const e = k * k * (1.6 - 0.6 * k);
  const a = s.angle + s.turns * Math.PI * 2 * e;
  const r = s.r * (1 - e) ** 1.15 + 0.6;
  out.k = k;
  out.x = Math.sin(a) * r;
  out.z = Math.cos(a) * r;
  out.y = s.h + (BREATH_DEATH_SHAPE.heartY - s.h) * e;
  return out;
}

// ---- the lightning ---------------------------------------------------------------------------

/** One bolt off the body: when, how long it lives, from which socket, and
 *  where to (`floor`: a spot round its foot at `angle` and `r` yards; `sky`:
 *  up into the cloud; `body`: another socket), its strength. */
export interface BreathDeathArc {
  at: number;
  life: number;
  from: number;
  kind: 'floor' | 'sky' | 'body';
  to: number;
  angle: number;
  r: number;
  light: number;
}

const ARC_FROM: readonly BreathSocketId[] = [
  'heart',
  'clawL',
  'clawR',
  'crown',
  'spikeL',
  'spikeR',
  'tip',
  'handL',
  'handR',
  'mouth',
];

/** The wild arcs, then the sputter: shorter, dimmer, further apart. */
export const BREATH_DEATH_ARCS: readonly BreathDeathArc[] = (() => {
  const out: BreathDeathArc[] = [];
  let t = D.wildFrom;
  let i = 0;
  while (t < D.arcsTo - 0.05) {
    const sputter = t > D.sputterFrom;
    const roll = hash(i, 21);
    out.push({
      at: t,
      life: sputter ? 0.12 + 0.1 * hash(i, 23) : 0.3 + 0.25 * hash(i, 23),
      from: breathSocketIndex(ARC_FROM[Math.floor(hash(i, 25) * ARC_FROM.length)]),
      kind: roll < 0.5 ? 'floor' : roll < 0.75 ? 'sky' : 'body',
      to: breathSocketIndex(ARC_FROM[Math.floor(hash(i, 27) * ARC_FROM.length)]),
      angle: hash(i, 29) * Math.PI * 2,
      r: 7 + 12 * hash(i, 31),
      light: sputter ? 0.75 - 0.45 * clamp01((t - D.sputterFrom) / (D.arcsTo - D.sputterFrom)) : 1,
    });
    // Close together while wild, further and further apart as it gutters.
    t += sputter
      ? 0.22 +
        0.45 * clamp01((t - D.sputterFrom) / (D.arcsTo - D.sputterFrom)) * (0.6 + hash(i, 33))
      : 0.09 + 0.08 * hash(i, 33);
    i++;
  }
  return out;
})();

/** A bolt's light at `t` (0 none): re-struck while it lives, a single fading
 *  stroke under reduced motion. */
export function breathDeathArcLight(a: BreathDeathArc, t: number, reducedMotion: boolean): number {
  const since = t - a.at;
  if (since < 0 || since > a.life) return 0;
  const k = since / a.life;
  if (reducedMotion) return a.light * (1 - k);
  const beat = Math.floor(k * 3);
  return a.light * (1 - (k * 3 - beat) * 0.7) * (1 - beat * 0.2);
}

// ---- the sky -------------------------------------------------------------------------------

/** The cloud overhead and the light through it at `t`: the deck's strength,
 *  its hole (a share of its radius), the torn rims' gold, the shaft's
 *  strength, the thunderclap's flash. Allocation free. */
export function breathDeathSky(
  t: number,
  out: { deck: number; open: number; rim: number; shaft: number; clap: number },
) {
  if (t < 0) {
    out.deck = 0;
    out.open = 0;
    out.rim = 0;
    out.shaft = 0;
    out.clap = 0;
    return out;
  }
  const part = smooth(D.partFrom, D.partTo, t);
  out.open = part;
  out.deck = smooth(0, D.deckIn, t) * (1 - smooth(D.partTo - 0.4, D.end, t));
  out.rim = Math.sin(Math.PI * part) * (1 - smooth(D.partTo, D.end, t) * 0.5);
  out.shaft = smooth(D.shaftFrom, D.shaftFull, t) * (1 - smooth(D.end - D.shaftFade, D.end, t));
  out.clap = spike(t - D.clapAt, 0.6);
  return out;
}

/** The wind over the isle at `t` (1 the storm's, 0 stillness). */
export function breathArenaWind(t: number): number {
  if (t < 0) return 1;
  return 1 - smooth(D.stillFrom, D.stillTo, t);
}

/** The low tier's share of a plan: every k-th kept (the shape whole). */
export function breathDeathKept(i: number, share: number): boolean {
  if (share >= 1) return true;
  const k = Math.max(1, Math.round(1 / Math.max(0.05, share)));
  return i % k === 0;
}

/** The low tier's share of the particle rates (the entrances' own). */
export const BREATH_DEATH_LOW_SHARE = SMITH_HEART_ENTRANCE_LOW_SHARE;

// ---- the sounds ------------------------------------------------------------------------------

export interface BreathDeathSound {
  at: number;
  key: string;
  gain: number;
  rate: number;
}

/** The scene's sounds (the raid's own samples; its death line is the sim's
 *  and plays over them). */
export const BREATH_DEATH_SOUNDS: readonly BreathDeathSound[] = [
  { at: 0.02, key: 'heart_breath_inhale', gain: 1, rate: 1.2 },
  { at: 0.12, key: 'heart_breath_gather', gain: 0.8, rate: 0.95 },
  { at: 0.4, key: 'heart_breath_strike', gain: 0.7, rate: 1.05 },
  { at: 0.95, key: 'heart_breath_discharge', gain: 0.8, rate: 1.25 },
  { at: 1.35, key: 'heart_breath_strike', gain: 0.75, rate: 0.92 },
  { at: 1.9, key: 'heart_breath_fork', gain: 0.65, rate: 1.1 },
  { at: D.sputterFrom + 0.2, key: 'heart_breath_fork', gain: 0.45, rate: 1.35 },
  { at: D.unravelFrom, key: 'heart_breath_exhale', gain: 0.9, rate: 0.7 },
  { at: D.sputterFrom + 1.3, key: 'heart_breath_fork', gain: 0.32, rate: 1.5 },
  { at: D.clapAt - 0.12, key: 'heart_breath_tear', gain: 0.8, rate: 0.85 },
  { at: D.clapAt, key: 'heart_breath_strike', gain: 1, rate: 0.6 },
  { at: D.clapAt + 0.04, key: 'heart_breath_storm_break', gain: 1, rate: 0.68 },
  { at: D.partFrom + 0.3, key: 'heart_breath_calm', gain: 0.75, rate: 0.85 },
  { at: D.partFrom + 1.4, key: 'heart_breath_calm_land', gain: 0.5, rate: 0.75 },
];

/** The gestures (characters/smith_heart_boss_looks.ts binds the fall: its
 *  Death clip on the living body for a dev replay, held down). */
export const BREATH_DEATH_GESTURES = {
  fall: 'smith_heart_breath_death_fall',
} as const;

/** The particles' rates (a second, before the tier's share). */
export const BREATH_DEATH_RATES = {
  /** Each stream's trail, a yard of its head's path. */
  streamStep: 0.26,
  /** The cloud it unravels into. */
  cloud: 46,
  /** The wind's streaks over the isle at full. */
  wind: 70,
  /** The dust settling in the shaft of light. */
  motes: 40,
} as const;

/** The sockets the cloud unravels off (every one but the eyes). */
export const BREATH_DEATH_CLOUD_SOCKETS: readonly number[] = BREATH_SOCKETS.map((_, i) => i).filter(
  (i) => BREATH_SOCKETS[i].id !== 'eyeL' && BREATH_SOCKETS[i].id !== 'eyeR',
);

/** The socket the streams and the clap drive into. */
export const BREATH_DEATH_HEART = breathSocketIndex('core');
