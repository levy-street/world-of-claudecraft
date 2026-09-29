// The cannon shot's billboard particles, the pure half: every puff of the
// muzzle, the shell's trail and the blast (the flash, the fireball, the dust
// cloud, the ground shock ring of dust, the thrown dirt, the sparks), and the
// bark chips a thrown body knocks off a trunk, is a closed-form flight from a
// launch record, so a frame evaluates each live puff from its age alone and
// nothing integrates. The Three consumer is cannon_puff_mesh.ts (one instanced
// draw on a premultiplied blend, so a puff can be additive fire, alpha-blended
// dust, or fade from one to the other).
//
// Sized for the distance a blast is seen from: the shared Vfx point cloud is
// tuned for melee range (a 0.5 yd sprite is 8 px at the 38 yd a blast sits from
// the turret's camera), so a cannon's dust, fire and dirt carry their own sizes.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a hash
// of the shot and the puff's index) and allocation-free per frame.

/** Atlas cells of the puff texture, a 2 by 2 grid (cannonPuffAtlasTexels). */
export const CANNON_PUFF_SPRITE = { smoke: 0, glow: 1, spark: 2, clod: 3 } as const;

/** Draw passes: alpha-blended dust behind, then the heavier smoke and dirt, then light. */
export const CANNON_PUFF_LAYERS = 3;

export const PUFF = {
  flash: 0,
  flame: 1,
  fireball: 2,
  dust: 3,
  shock: 4,
  dirt: 5,
  spark: 6,
  smoke: 7,
  trailSmoke: 8,
  trailSpark: 9,
  glow: 10,
  bark: 11,
} as const;

export type CannonPuffKind = (typeof PUFF)[keyof typeof PUFF];

export const CANNON_PUFF_KINDS = 12;

interface PuffStyleSpec {
  sprite: number;
  layer: number;
  /** Colour stops (sRGB hex, then a gain for light above 1) at u = 0, `mid` and 1. */
  stops: readonly [number, number, number, number, number, number];
  mid: number;
  /** Peak opacity, where it peaks (share of the life) and where it starts to fade. */
  alpha: number;
  attack: number;
  fadeFrom: number;
  /** Additive share at the start and the end, crossing over between u0 and u1. */
  add0: number;
  add1: number;
  addU0: number;
  addU1: number;
  /** How much a top-lit gradient shades it (smoke and dust read as lit volumes). */
  shade: number;
  /** Self-lit share (ignores the scene light) at the start and the end, crossing
   *  over between u0 and u1; defaults to the additive share. */
  glow?: readonly [number, number, number, number];
}

export interface CannonPuffStyle {
  readonly sprite: number;
  readonly layer: number;
  /** Linear RGB stops, gain applied: 9 floats (u = 0, mid, 1). */
  readonly rgb: Float32Array;
  readonly mid: number;
  readonly alpha: number;
  readonly attack: number;
  readonly fadeFrom: number;
  readonly add0: number;
  readonly add1: number;
  readonly addU0: number;
  readonly addU1: number;
  readonly shade: number;
  readonly glow0: number;
  readonly glow1: number;
  readonly glowU0: number;
  readonly glowU1: number;
}

const S = CANNON_PUFF_SPRITE;

/** The palette of a heavy, dirty cannon blast, kind by kind (indexed by PUFF). */
const STYLE_SPECS: readonly PuffStyleSpec[] = [
  // flash: a white-yellow pop, gone in a tenth of a second.
  {
    sprite: S.glow,
    layer: 2,
    stops: [0xfff6dc, 5, 0xffe2a0, 3.5, 0xffb35a, 1.5],
    mid: 0.4,
    alpha: 1,
    attack: 0,
    fadeFrom: 0.2,
    add0: 1,
    add1: 1,
    addU0: 0,
    addU1: 1,
    shade: 0,
  },
  // flame: the muzzle's tongue, yellow-orange.
  {
    sprite: S.glow,
    layer: 2,
    stops: [0xffd98a, 3.2, 0xff9a3a, 2.2, 0xd8581a, 1],
    mid: 0.45,
    alpha: 1,
    attack: 0,
    fadeFrom: 0.35,
    add0: 1,
    add1: 1,
    addU0: 0,
    addU1: 1,
    shade: 0,
  },
  // fireball: an orange bloom that cools into dark rising smoke.
  {
    sprite: S.smoke,
    layer: 1,
    stops: [0xffc870, 2, 0xd08048, 1.2, 0x3a3634, 1],
    mid: 0.24,
    alpha: 0.95,
    attack: 0.05,
    fadeFrom: 0.5,
    add0: 0.3,
    add1: 0,
    addU0: 0.08,
    addU1: 0.35,
    shade: 0.7,
    glow: [1, 0, 0.2, 0.45],
  },
  // dust: the big brown-grey cloud that lingers.
  {
    sprite: S.smoke,
    layer: 0,
    stops: [0xc2b6a4, 1, 0xb5ab9d, 1, 0xa7a199, 1],
    mid: 0.4,
    alpha: 0.7,
    attack: 0.1,
    fadeFrom: 0.35,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.8,
  },
  // shock: the beige dust ring rolling out along the ground.
  {
    sprite: S.smoke,
    layer: 0,
    stops: [0xe2cdaa, 1, 0xd2c0a2, 1, 0xbcae98, 1],
    mid: 0.5,
    alpha: 0.5,
    attack: 0.08,
    fadeFrom: 0.25,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.55,
  },
  // dirt: dark clods thrown up and falling back.
  {
    sprite: S.clod,
    layer: 1,
    stops: [0x7a5a3c, 1, 0x81603f, 1, 0x86664a, 1],
    mid: 0.5,
    alpha: 1,
    attack: 0.02,
    fadeFrom: 0.78,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.5,
  },
  // spark: hot embers, white-yellow cooling to red.
  {
    sprite: S.spark,
    layer: 2,
    stops: [0xffe7b0, 4, 0xffa040, 2.6, 0xe0441a, 1.2],
    mid: 0.35,
    alpha: 1,
    attack: 0,
    fadeFrom: 0.45,
    add0: 1,
    add1: 1,
    addU0: 0,
    addU1: 1,
    shade: 0,
  },
  // smoke: the grey-brown puff the muzzle breathes out.
  {
    sprite: S.smoke,
    layer: 0,
    stops: [0xb5aa9c, 1, 0xaba398, 1, 0xa39d95, 1],
    mid: 0.4,
    alpha: 0.7,
    attack: 0.08,
    fadeFrom: 0.3,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.75,
  },
  // trailSmoke: the thin grey wake behind the shell.
  {
    sprite: S.smoke,
    layer: 0,
    stops: [0xc2bbb2, 1, 0xb4aea6, 1, 0xaaa59f, 1],
    mid: 0.4,
    alpha: 0.5,
    attack: 0.18,
    fadeFrom: 0.25,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.6,
  },
  // trailSpark: warm sparks shed by the hot shell.
  {
    sprite: S.spark,
    layer: 2,
    stops: [0xffd690, 3.2, 0xff8a30, 2.2, 0xc8401a, 1],
    mid: 0.4,
    alpha: 1,
    attack: 0,
    fadeFrom: 0.3,
    add0: 1,
    add1: 1,
    addU0: 0,
    addU1: 1,
    shade: 0,
  },
  // glow: the hot orange halo around the dark iron shell.
  {
    sprite: S.glow,
    layer: 2,
    stops: [0xffa24a, 2.4, 0xff8a34, 2.4, 0xff8a34, 2.4],
    mid: 0.5,
    alpha: 0.9,
    attack: 0,
    fadeFrom: 1,
    add0: 1,
    add1: 1,
    addU0: 0,
    addU1: 1,
    shade: 0,
  },
  // bark: red-brown chips knocked off a trunk a thrown body hits.
  {
    sprite: S.clod,
    layer: 1,
    stops: [0x8a4a2c, 1, 0x7a4026, 1, 0x6a3822, 1],
    mid: 0.5,
    alpha: 1,
    attack: 0.02,
    fadeFrom: 0.75,
    add0: 0,
    add1: 0,
    addU0: 0,
    addU1: 1,
    shade: 0.5,
  },
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function buildStyle(spec: PuffStyleSpec): CannonPuffStyle {
  const rgb = new Float32Array(9);
  for (let s = 0; s < 3; s++) {
    const hex = spec.stops[s * 2];
    const gain = spec.stops[s * 2 + 1];
    rgb[s * 3] = srgbToLinear(((hex >> 16) & 255) / 255) * gain;
    rgb[s * 3 + 1] = srgbToLinear(((hex >> 8) & 255) / 255) * gain;
    rgb[s * 3 + 2] = srgbToLinear((hex & 255) / 255) * gain;
  }
  const { stops: _stops, glow, ...rest } = spec;
  return {
    ...rest,
    rgb,
    glow0: glow ? glow[0] : spec.add0,
    glow1: glow ? glow[1] : spec.add1,
    glowU0: glow ? glow[2] : spec.addU0,
    glowU1: glow ? glow[3] : spec.addU1,
  };
}

export const CANNON_PUFF_STYLES: readonly CannonPuffStyle[] = STYLE_SPECS.map(buildStyle);

/** A uniform draw in [0, 1) from two integers (a stateless hash, no random source). */
export function cannonHash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** One puff's launch: written once when its event starts, read back every frame. */
export interface CannonPuff {
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Velocity damping (1/s): smoke slows to a drift, a spark keeps its speed. */
  drag: number;
  /** Downward pull (yd/s^2); negative rises (hot smoke). */
  gravity: number;
  size0: number;
  size1: number;
  life: number;
  /** Seconds after the event before it shows. */
  delay: number;
  rot: number;
  spin: number;
  /** It never sinks below this height (dirt and sparks come to rest on the ground). */
  floorY: number;
}

export function newCannonPuff(): CannonPuff {
  return {
    kind: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    drag: 0,
    gravity: 0,
    size0: 0,
    size1: 0,
    life: 1,
    delay: 0,
    rot: 0,
    spin: 0,
    floorY: Number.NEGATIVE_INFINITY,
  };
}

/** A puff on one frame: where, how big, its colour and opacity, how additive. */
export interface CannonPuffFrame {
  x: number;
  y: number;
  z: number;
  size: number;
  rot: number;
  r: number;
  g: number;
  b: number;
  a: number;
  add: number;
  /** Self-lit share: 1 ignores the scene light, 0 takes it fully. */
  glow: number;
  sprite: number;
  shade: number;
  layer: number;
  kind: number;
}

export function newCannonPuffFrame(): CannonPuffFrame {
  return {
    x: 0,
    y: 0,
    z: 0,
    size: 0,
    rot: 0,
    r: 0,
    g: 0,
    b: 0,
    a: 0,
    add: 0,
    glow: 0,
    sprite: 0,
    shade: 0,
    layer: 0,
    kind: 0,
  };
}

/** Distance covered by a start speed `v0` under damping `k` after `t` seconds. */
function travel(v0: number, k: number, t: number): number {
  return k > 1e-6 ? (v0 * (1 - Math.exp(-k * t))) / k : v0 * t;
}

/** Height gained from a start speed `vy` under damping `k` and pull `g` after `t`. */
function rise(vy: number, k: number, g: number, t: number): number {
  if (k <= 1e-6) return vy * t - 0.5 * g * t * t;
  return ((vy + g / k) * (1 - Math.exp(-k * t))) / k - (g / k) * t;
}

/** Puff `p` `age` seconds after its event; false before its delay and after its life. */
export function cannonPuffInto(p: CannonPuff, age: number, out: CannonPuffFrame): boolean {
  const t = age - p.delay;
  if (!(t >= 0) || t >= p.life) return false;
  const style = CANNON_PUFF_STYLES[p.kind];
  if (!style) return false;
  const u = t / p.life;
  out.x = p.x + travel(p.vx, p.drag, t);
  out.z = p.z + travel(p.vz, p.drag, t);
  out.y = Math.max(p.floorY, p.y + rise(p.vy, p.drag, p.gravity, t));
  const grow = 1 - (1 - u) * (1 - u);
  out.size = p.size0 + (p.size1 - p.size0) * grow;
  out.rot = p.rot + p.spin * t;
  const rgb = style.rgb;
  const seg = u < style.mid ? 0 : 1;
  const w =
    seg === 0 ? (style.mid > 0 ? u / style.mid : 1) : (u - style.mid) / (1 - style.mid || 1);
  const a = seg * 3;
  out.r = rgb[a] + (rgb[a + 3] - rgb[a]) * w;
  out.g = rgb[a + 1] + (rgb[a + 4] - rgb[a + 1]) * w;
  out.b = rgb[a + 2] + (rgb[a + 5] - rgb[a + 2]) * w;
  const attack = style.attack > 0 ? clamp01(u / style.attack) : 1;
  const fade = style.fadeFrom < 1 ? 1 - smoothstep((u - style.fadeFrom) / (1 - style.fadeFrom)) : 1;
  out.a = style.alpha * attack * fade;
  const span = style.addU1 - style.addU0;
  const cross = span > 0 ? smoothstep((u - style.addU0) / span) : 1;
  out.add = style.add0 + (style.add1 - style.add0) * cross;
  const glowSpan = style.glowU1 - style.glowU0;
  const glowCross = glowSpan > 0 ? smoothstep((u - style.glowU0) / glowSpan) : 1;
  out.glow = style.glow0 + (style.glow1 - style.glow0) * glowCross;
  out.sprite = style.sprite;
  out.shade = style.shade;
  out.layer = style.layer;
  out.kind = p.kind;
  return true;
}

/** Cosmetic puff counts the static preset sets (the low preset sheds these). */
export interface CannonPuffCounts {
  dust: number;
  dirt: number;
  sparks: number;
  smoke: number;
}

export const CANNON_FIREBALL_PUFFS = 8;
export const CANNON_SHOCK_PUFFS = 22;
export const CANNON_MUZZLE_FLAMES = 3;

/** The blast puffs every tier draws: the flash, the fireball and the shock ring. */
export const CANNON_BLAST_FIXED_PUFFS = 1 + CANNON_FIREBALL_PUFFS + CANNON_SHOCK_PUFFS;
/** The muzzle puffs every tier draws: the flash and the flame tongue. */
export const CANNON_MUZZLE_FIXED_PUFFS = 1 + CANNON_MUZZLE_FLAMES;

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
): void {
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
}

/**
 * How big a blast reads: 1 for a clean miss, up to 1.3 for a core hit (the
 * strongest falloff among the bodies it struck).
 */
export function cannonBlastPower(
  hits: readonly { readonly falloff: number }[] | undefined,
): number {
  let best = 0;
  if (hits) for (const hit of hits) if (hit.falloff > best) best = hit.falloff;
  return 1 + 0.3 * clamp01(best);
}

/** Pull on a thrown clod (yd/s^2): a 16 yd/s throw peaks near 5 yd. */
export const CANNON_DIRT_GRAVITY = 26;

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;

/**
 * Launches the blast's puffs at (x, y, z) into `out` from index 0 and returns
 * how many: the flash, the fireball and the shock ring (every tier), then the
 * dust cloud, the dirt and the sparks (`counts`). `radius` is the blast radius
 * the ring rolls out to; `power` scales the sizes (cannonBlastPower). The ground
 * is sampled once per ring puff and per clod, never per frame.
 */
export function cannonBlastPuffs(
  out: CannonPuff[],
  seed: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  power: number,
  counts: Readonly<CannonPuffCounts>,
  ground: (x: number, z: number) => number,
): number {
  let n = 0;
  const h = (i: number, k: number): number => cannonHash01(seed, i * 16 + k);
  const floorAt = (px: number, pz: number): number => {
    const g = ground(px, pz);
    return Number.isFinite(g) ? g : y;
  };
  // The flash: a big white-yellow pop just over the blast.
  launch(
    out[n++],
    PUFF.flash,
    x,
    y + 1,
    z,
    0,
    0,
    0,
    0,
    0,
    3.4 * power,
    4.6 * power,
    0.12,
    0,
    h(0, 0) * TAU,
    0,
    NO_FLOOR,
  );
  // The fireball: orange puffs bursting out and up, cooling into smoke that rises.
  for (let i = 0; i < CANNON_FIREBALL_PUFFS; i++) {
    const a = ((i + 0.6 * h(1 + i, 0)) / CANNON_FIREBALL_PUFFS) * TAU;
    const out1 = 1.6 + 2.2 * h(1 + i, 1);
    const up = 2.2 + 2.6 * h(1 + i, 2);
    launch(
      out[n++],
      PUFF.fireball,
      x + Math.sin(a) * 0.35,
      y + 0.55 + 0.4 * h(1 + i, 3),
      z + Math.cos(a) * 0.35,
      Math.sin(a) * out1,
      up,
      Math.cos(a) * out1,
      2.6,
      -1.6,
      1.1 * power,
      (3.4 + 1 * h(1 + i, 4)) * power,
      0.85 + 0.35 * h(1 + i, 5),
      0.015 * i,
      h(1 + i, 6) * TAU,
      (h(1 + i, 7) - 0.5) * 1.2,
      NO_FLOOR,
    );
  }
  // The shock ring: dust rolling out along the ground past the blast radius.
  const ringFloor = floorAt(x, z);
  for (let i = 0; i < CANNON_SHOCK_PUFFS; i++) {
    const idx = 10 + i;
    const a = ((i + 0.5 * h(idx, 0)) / CANNON_SHOCK_PUFFS) * TAU;
    const reach = radius * (1 + 0.2 * h(idx, 1));
    const k = 4.2;
    const g = Math.max(
      ringFloor,
      floorAt(x + Math.sin(a) * reach * 0.7, z + Math.cos(a) * reach * 0.7),
    );
    launch(
      out[n++],
      PUFF.shock,
      x + Math.sin(a) * 0.6,
      g + 0.55,
      z + Math.cos(a) * 0.6,
      Math.sin(a) * reach * k,
      0.4,
      Math.cos(a) * reach * k,
      k,
      0,
      1 * power,
      (2.2 + 0.6 * h(idx, 2)) * power,
      0.75 + 0.2 * h(idx, 3),
      0.01,
      h(idx, 4) * TAU,
      (h(idx, 5) - 0.5) * 0.8,
      NO_FLOOR,
    );
  }
  // The dust cloud: big brown-grey puffs heaving up and lingering.
  for (let i = 0; i < counts.dust; i++) {
    const idx = 40 + i;
    const a = h(idx, 0) * TAU;
    const off = radius * 0.3 * Math.sqrt(h(idx, 1));
    const outward = 0.8 + 2.2 * h(idx, 2);
    launch(
      out[n++],
      PUFF.dust,
      x + Math.sin(a) * off,
      y + 0.5 + 0.6 * h(idx, 3),
      z + Math.cos(a) * off,
      Math.sin(a) * outward,
      2.4 + 2.6 * h(idx, 4),
      Math.cos(a) * outward,
      1.7,
      -0.35,
      (2 + 0.8 * h(idx, 5)) * power,
      (5.5 + 2 * h(idx, 6)) * power,
      1.4 + 0.55 * h(idx, 7),
      0.04 + 0.08 * h(idx, 8),
      h(idx, 9) * TAU,
      (h(idx, 10) - 0.5) * 0.5,
      NO_FLOOR,
    );
  }
  // The dirt: dark clods thrown 3 to 5 yd up, landing around the blast.
  for (let i = 0; i < counts.dirt; i++) {
    const idx = 80 + i;
    const a = ((i + h(idx, 0)) / Math.max(1, counts.dirt)) * TAU;
    const speed = 1.5 + 4.5 * h(idx, 1);
    const vy = 9.5 + 6.5 * h(idx, 2);
    const land = (2 * vy) / CANNON_DIRT_GRAVITY;
    launch(
      out[n++],
      PUFF.dirt,
      x + Math.sin(a) * 0.4,
      y + 0.3,
      z + Math.cos(a) * 0.4,
      Math.sin(a) * speed,
      vy,
      Math.cos(a) * speed,
      0,
      CANNON_DIRT_GRAVITY,
      (0.32 + 0.3 * h(idx, 3)) * power,
      (0.28 + 0.24 * h(idx, 3)) * power,
      1.15 + 0.35 * h(idx, 4),
      0.01 * (i % 4),
      h(idx, 5) * TAU,
      (h(idx, 6) - 0.5) * 9,
      floorAt(x + Math.sin(a) * speed * land, z + Math.cos(a) * speed * land) + 0.12,
    );
  }
  // The sparks: hot embers flung out fast, falling as they cool.
  for (let i = 0; i < counts.sparks; i++) {
    const idx = 120 + i;
    const a = h(idx, 0) * TAU;
    const speed = 5 + 8 * h(idx, 1);
    const up = 0.35 + 0.65 * h(idx, 2);
    launch(
      out[n++],
      PUFF.spark,
      x,
      y + 0.8,
      z,
      Math.sin(a) * speed * (1 - 0.5 * up),
      speed * up,
      Math.cos(a) * speed * (1 - 0.5 * up),
      1.1,
      16,
      (0.42 + 0.2 * h(idx, 3)) * power,
      0.1,
      0.35 + 0.35 * h(idx, 4),
      0.02 * h(idx, 5),
      0,
      0,
      ringFloor + 0.05,
    );
  }
  return n;
}

/**
 * Launches the muzzle's puffs into `out` from index 0 and returns how many: a
 * flash at the tip and a flame tongue along the barrel's unit axis (dx, dy, dz)
 * on every tier, then `smoke` grey-brown puffs breathed forward that drift up
 * and fade over about a second.
 */
export function cannonMuzzlePuffs(
  out: CannonPuff[],
  seed: number,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  smoke: number,
): number {
  let n = 0;
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x5bd1, i * 16 + k);
  launch(
    out[n++],
    PUFF.flash,
    x + dx * 0.25,
    y + dy * 0.25,
    z + dz * 0.25,
    0,
    0,
    0,
    0,
    0,
    2.6,
    3.2,
    0.08,
    0,
    h(0, 0) * TAU,
    0,
    NO_FLOOR,
  );
  for (let i = 0; i < CANNON_MUZZLE_FLAMES; i++) {
    const at = 0.5 + 0.7 * i;
    const size = 1.7 - 0.35 * i;
    launch(
      out[n++],
      PUFF.flame,
      x + dx * at,
      y + dy * at,
      z + dz * at,
      dx * 7,
      dy * 7,
      dz * 7,
      6,
      0,
      size,
      size * 1.3,
      0.09 + 0.02 * i,
      0,
      h(1 + i, 0) * TAU,
      0,
      NO_FLOOR,
    );
  }
  // A side axis, level and square to the barrel, spreads the smoke into a cloud.
  const len = Math.hypot(dx, dz);
  const sx = len > 1e-6 ? dz / len : 1;
  const sz = len > 1e-6 ? -dx / len : 0;
  for (let i = 0; i < smoke; i++) {
    const idx = 8 + i;
    const at = 0.4 + 1.3 * h(idx, 0);
    const push = 2.6 + 3 * h(idx, 1);
    const side = (h(idx, 2) - 0.5) * 2.4;
    launch(
      out[n++],
      PUFF.smoke,
      x + dx * at,
      y + dy * at,
      z + dz * at,
      dx * push + sx * side,
      dy * push + 0.7 + 0.8 * h(idx, 3),
      dz * push + sz * side,
      2.1,
      -0.45,
      1 + 0.4 * h(idx, 4),
      2.6 + 0.9 * h(idx, 5),
      1 + 0.35 * h(idx, 6),
      0.02 + 0.04 * h(idx, 7),
      h(idx, 8) * TAU,
      (h(idx, 9) - 0.5) * 0.9,
      NO_FLOOR,
    );
  }
  return n;
}

/** The shell's wake: a grey smoke puff every `spacing` yards of the arc, a
 *  warm spark on every other one. */
export const CANNON_TRAIL = {
  spacing: 0.6,
  smokeLife: 0.55,
  sparkLife: 0.22,
} as const;

/**
 * Writes drop `k` of a shell's wake into `out`, dropped at (x, y, z) on the
 * arc: a smoke puff that swells and lifts a little, or a spark that scatters. `seed` is the shot, so a wake is the same every time it is drawn.
 */
export function cannonTrailPuffInto(
  out: CannonPuff,
  seed: number,
  k: number,
  spark: boolean,
  x: number,
  y: number,
  z: number,
): CannonPuff {
  // Called per wake puff per frame: no closure, the hash is inlined.
  const salt = seed ^ 0x2c9f;
  const base = k * 8;
  if (spark) {
    const a = cannonHash01(salt, base + 0) * TAU;
    const s = 1 + 2 * cannonHash01(salt, base + 1);
    launch(
      out,
      PUFF.trailSpark,
      x,
      y,
      z,
      Math.sin(a) * s,
      0.5 + s * cannonHash01(salt, base + 2),
      Math.cos(a) * s,
      0.5,
      9,
      0.34,
      0.08,
      CANNON_TRAIL.sparkLife,
      0,
      0,
      0,
      NO_FLOOR,
    );
  } else {
    launch(
      out,
      PUFF.trailSmoke,
      x + (cannonHash01(salt, base + 0) - 0.5) * 0.15,
      y + (cannonHash01(salt, base + 1) - 0.5) * 0.15,
      z + (cannonHash01(salt, base + 2) - 0.5) * 0.15,
      (cannonHash01(salt, base + 3) - 0.5) * 0.4,
      0.35,
      (cannonHash01(salt, base + 4) - 0.5) * 0.4,
      1.5,
      -0.3,
      0.42,
      1.05 + 0.3 * cannonHash01(salt, base + 5),
      CANNON_TRAIL.smokeLife,
      0,
      cannonHash01(salt, base + 6) * TAU,
      (cannonHash01(salt, base + 7) - 0.5) * 1.4,
      NO_FLOOR,
    );
  }
  return out;
}

/** The glow around the shell `age` seconds into its flight: a hot, flickering halo. */
export function cannonShellGlowInto(
  x: number,
  y: number,
  z: number,
  age: number,
  out: CannonPuffFrame,
): CannonPuffFrame {
  const style = CANNON_PUFF_STYLES[PUFF.glow];
  const flicker = 1 + 0.12 * Math.sin(30 * age) + 0.06 * Math.sin(53 * age + 1.3);
  out.x = x;
  out.y = y;
  out.z = z;
  out.size = 1.3 * flicker;
  out.rot = age * 4;
  out.r = style.rgb[0];
  out.g = style.rgb[1];
  out.b = style.rgb[2];
  out.a = style.alpha;
  out.add = 1;
  out.glow = 1;
  out.sprite = style.sprite;
  out.shade = 0;
  out.layer = style.layer;
  out.kind = PUFF.glow;
  return out;
}

/** What a lit puff multiplies its colour by, per unit of scene light, how much
 *  of the light's tint it keeps, and the least it takes (tuned by eye against
 *  the Amberfall test site's amber dusk and its night). */
export const CANNON_PUFF_LIGHT = {
  gain: 1.35,
  saturation: 0.25,
  floor: 0.1,
  ceiling: 1.2,
} as const;

/**
 * The light an alpha-blended puff takes (linear RGB into `out`), from the
 * scene's hemisphere (sky and ground colours times its intensity) and sun
 * (colour times intensity): a billboard faces sideways, so it takes the sky and
 * the ground in a 65 to 35 mix and about half the sun, over PI as three's
 * Lambert does. The tint is partly washed toward grey (dust scatters light, a
 * deep amber sun would otherwise stain it red) and the level is floored and
 * capped, so smoke darkens with the night without vanishing.
 */
export function cannonPuffLightInto(
  sky: { r: number; g: number; b: number },
  groundColor: { r: number; g: number; b: number },
  hemi: number,
  sun: { r: number; g: number; b: number },
  sunIntensity: number,
  out: { r: number; g: number; b: number },
): void {
  const { gain, saturation, floor, ceiling } = CANNON_PUFF_LIGHT;
  const k = gain / Math.PI;
  const r = k * ((0.65 * sky.r + 0.35 * groundColor.r) * hemi + 0.5 * sun.r * sunIntensity);
  const g = k * ((0.65 * sky.g + 0.35 * groundColor.g) * hemi + 0.5 * sun.g * sunIntensity);
  const b = k * ((0.65 * sky.b + 0.35 * groundColor.b) * hemi + 0.5 * sun.b * sunIntensity);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const level = Math.min(ceiling, Math.max(floor, lum));
  const scale = lum > 1e-6 ? level / lum : 0;
  out.r = level + (r * scale - level) * saturation;
  out.g = level + (g * scale - level) * saturation;
  out.b = level + (b * scale - level) * saturation;
  if (lum <= 1e-6) {
    out.r = level;
    out.g = level;
    out.b = level;
  }
}

const ATLAS_GRID = 2;

/**
 * The puff atlas, `cell` texels per sprite on a 2 by 2 grid, row 0 at the
 * bottom (texture v up): a lumpy smoke cloud, a soft glow with a hot core, a
 * tight spark, and a ragged dirt clod lit from above. RGB carries the sprite's
 * own light and texture, alpha its coverage; the puff's colour multiplies both.
 */
export function cannonPuffAtlasTexels(cell: number): Uint8Array {
  const size = cell * ATLAS_GRID;
  const data = new Uint8Array(size * size * 4);
  const noise = (u: number, v: number, cells: number, salt: number): number => {
    const x = (u * 0.5 + 0.5) * cells;
    const y = (v * 0.5 + 0.5) * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const at = (i: number, j: number): number => cannonHash01(i * 131 + salt, j);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  const fbm = (u: number, v: number, salt: number): number =>
    0.55 * noise(u, v, 4, salt) +
    0.3 * noise(u, v, 9, salt + 17) +
    0.15 * noise(u, v, 19, salt + 41);
  const write = (cx: number, cy: number, i: number, j: number, r: number, a: number): void => {
    const at = ((cy * cell + j) * size + cx * cell + i) * 4;
    data[at] = Math.round(255 * clamp01(r));
    data[at + 1] = Math.round(255 * clamp01(r));
    data[at + 2] = Math.round(255 * clamp01(r));
    data[at + 3] = Math.round(255 * clamp01(a));
  };
  for (let j = 0; j < cell; j++) {
    for (let i = 0; i < cell; i++) {
      const u = ((i + 0.5) / cell) * 2 - 1;
      const v = ((j + 0.5) / cell) * 2 - 1;
      const r = Math.hypot(u, v);
      const edge = 1 - smoothstep((r - 0.82) / 0.16);
      const angle = Math.atan2(v, u);
      // Smoke: a soft billow whose outline and thickness follow a low noise, so
      // the edge frays into lumps and wisps and no two rotations look alike.
      const billow = fbm(u * 0.8, v * 0.8, 5);
      const dens = billow * 1.5 + 0.3 - 1.3 * r * r;
      const smokeA = smoothstep(dens / 0.5) * (0.72 + 0.28 * fbm(u * 2.2, v * 2.2, 47)) * edge;
      const smokeLit =
        0.62 + 0.3 * smoothstep(dens / 0.9) + 0.2 * (fbm(u * 1.8, v * 1.8, 29) - 0.5);
      write(0, 0, i, j, smokeLit, smokeA);
      // Glow: a soft falloff with a hot core.
      const glowA = clamp01((1 - smoothstep(r)) ** 2.2 + 0.7 * Math.exp(-r * r * 30)) * edge;
      write(1, 0, i, j, 1, glowA);
      // Spark: a tight point with a faint halo.
      const sparkA = clamp01(Math.exp(-r * r * 40) + 0.3 * Math.exp(-r * r * 7)) * edge;
      write(0, 1, i, j, 1, sparkA);
      // Clod: a ragged dark lump, lit from above.
      const rim =
        0.6 +
        0.08 * Math.sin(angle * 2 + 1.1) +
        0.05 * Math.sin(angle * 3 + 2.3) +
        0.16 * (fbm(u * 1.4, v * 1.4, 97) - 0.5);
      const clodA = 1 - smoothstep((r - rim + 0.04) / 0.07);
      const lit = 0.6 + 0.32 * clamp01(v * 0.5 + 0.5) + 0.3 * (fbm(u * 2, v * 2, 61) - 0.5);
      write(1, 1, i, j, lit, clodA);
    }
  }
  return data;
}
