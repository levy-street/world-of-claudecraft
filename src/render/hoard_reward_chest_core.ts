// Pure plans for the Buried Hoard reward chest (src/render/hoard_reward_chest.ts):
// the arrival, the waiting chest that can barely hold what is inside it, and the
// opening. DOM-free and Three-free, so every timing and amount the ceremony is
// built on is a number a Node test can pin.
//
// One chest, four rarities: rarity never changes the model, only the colour and
// how hard everything pushes (CHEST_RARITY). Every other knob is in CHEST_TUNING.

export type ChestRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ChestRarityProfile {
  /** The light inside, and everything it touches. */
  color: number;
  /** Multiplies glow, light leak and the spawn flash. */
  intensity: number;
  /** Multiplies how many motes are alive. */
  particles: number;
  /** Multiplies the strength of the periodic surge. */
  pulse: number;
  /** Light rays escaping the lid. */
  rays: number;
}

export const CHEST_RARITY: Record<ChestRarity, ChestRarityProfile> = {
  common: { color: 0x9fd4ff, intensity: 0.8, particles: 0.7, pulse: 0.8, rays: 3 },
  rare: { color: 0x3d8bff, intensity: 1, particles: 1, pulse: 1, rays: 4 },
  epic: { color: 0xa855ff, intensity: 1.25, particles: 1.3, pulse: 1.25, rays: 5 },
  legendary: { color: 0xffb62e, intensity: 1.55, particles: 1.7, pulse: 1.5, rays: 7 },
};

export function chestRarity(value: string | undefined): ChestRarity {
  return value === 'common' || value === 'epic' || value === 'legendary' ? value : 'rare';
}

export const CHEST_TUNING = {
  /** Model scale in the world (the GLB is authored at 1.5 m wide). */
  CHEST_SCALE: 1.45,
  /** Hinge of the lid in model space (back top edge of the base). */
  HINGE_Y: 0.64,
  HINGE_Z: -0.48,
  /** The lid while it waits: a gap, never half open. */
  LID_IDLE_ANGLE: 5,
  LID_OPEN_ANGLE: 108,
  /** The waiting tremble: yards, and radians per second. */
  IDLE_SHAKE_AMOUNT: 0.011,
  IDLE_SHAKE_SPEED: 33,
  /** Seconds between surges (each one jittered), and their size. */
  PULSE_INTERVAL: 3.4,
  PULSE_STRENGTH: 1,
  INNER_GLOW_INTENSITY: 2.6,
  LIGHT_LEAK_INTENSITY: 1.25,
  /** Self-light on the wood, iron and brass, in their own colours. */
  BOUNCE_LIGHT: 0.32,
  /** Motes alive at rarity 'rare'. */
  PARTICLE_AMOUNT: 16,
  PARTICLE_SPEED: 1,
  /** Hard cap on motes, whatever the rarity. */
  PARTICLE_MAX: 30,
  SPAWN_DURATION: 1.05,
  SPAWN_FLASH_INTENSITY: 1,
  SPAWN_RING_SIZE: 3.4,
  OPEN_DURATION: 0.85,
} as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 11, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 0x1_0000_0000;
}

// ---------------------------------------------------------------- arrival

export interface ChestSpawnPlan {
  /** Ground pool of light, 0 to 1. */
  ground: number;
  /** How hard motes are being pulled in toward the spot, 0 to 1. */
  gather: number;
  /** The vertical burst the chest appears inside. */
  column: number;
  /** How much of the chest is there (its scale), 0 to 1. */
  reveal: number;
  /** The flash at the moment it becomes solid. */
  flash: number;
  /** The shockwave when it lands: opacity and radius (yards). */
  ring: number;
  ringRadius: number;
  /** Height above its resting place (yards) and its vertical squash. */
  lift: number;
  squash: number;
  done: boolean;
}

/** `age` in seconds since the boss fell. Under reduced motion the chest is
 *  simply there: no drop, no flash, the light fades in. */
export function chestSpawn(age: number, calm = false): ChestSpawnPlan {
  const total = CHEST_TUNING.SPAWN_DURATION;
  const t = Math.max(0, age) / total;
  if (calm) {
    const fade = smooth(t * 2);
    return {
      ground: fade,
      gather: 0,
      column: 0,
      reveal: 1,
      flash: 0,
      ring: 0,
      ringRadius: 0,
      lift: 0,
      squash: 1,
      done: t >= 0.5,
    };
  }
  // 0.00 energy gathers, 0.15 the pool appears, 0.30 the burst, 0.45 to 0.65 it
  // becomes solid, 0.65 to 0.90 it drops and settles.
  const reveal = smooth((t - 0.42) / 0.2);
  const landing = 0.74;
  const fall = clamp01((t - 0.6) / (landing - 0.6));
  const after = clamp01((t - landing) / (0.95 - landing));
  // A small, heavy settle: one compression, one tiny recovery, done.
  const squash = t < landing ? 1 : 1 - 0.07 * Math.sin(after * Math.PI) * (1 - after * 0.6);
  return {
    ground: smooth((t - 0.12) / 0.2),
    gather: smooth(t / 0.3) * (1 - smooth((t - 0.5) / 0.2)),
    column: smooth((t - 0.26) / 0.14) * (1 - smooth((t - 0.6) / 0.25)),
    reveal,
    flash: Math.max(0, 1 - Math.abs(t - 0.52) / 0.12) * CHEST_TUNING.SPAWN_FLASH_INTENSITY,
    ring: t < landing ? 0 : (1 - after) * 0.9,
    ringRadius: CHEST_TUNING.SPAWN_RING_SIZE * (0.25 + (1 - (1 - after) ** 3) * 0.75),
    lift: reveal <= 0 ? 0.55 : 0.55 * (1 - fall * fall),
    squash,
    done: t >= 1,
  };
}

// ---------------------------------------------------------------- waiting

export interface ChestIdlePlan {
  /** Lid angle in degrees, its tremble included. */
  lidAngle: number;
  /** Body tremble, yards. Always tiny: contained pressure, never a hop. */
  shakeX: number;
  shakeZ: number;
  /** The surge, 0 to 1: drives glow, leak and the lid at the same moment. */
  pulse: number;
  /** Multipliers for the inner light and the light leaking out. */
  glow: number;
  leak: number;
}

/** The surge envelope at time `t`: one swell per interval, each interval's
 *  swell nudged later by a hash of its index so the rhythm never reads as a loop. */
export function chestPulse(t: number): number {
  const interval = CHEST_TUNING.PULSE_INTERVAL;
  const cycle = Math.floor(t / interval);
  const offset = hash(cycle, 3) * interval * 0.35;
  const local = t - cycle * interval - offset;
  const length = 0.7;
  if (local < 0 || local > length) return 0;
  const s = Math.sin((local / length) * Math.PI);
  return s * s;
}

export function chestIdle(t: number, profile: ChestRarityProfile, calm = false): ChestIdlePlan {
  const pulse = calm ? 0 : chestPulse(t) * CHEST_TUNING.PULSE_STRENGTH * profile.pulse;
  const speed = CHEST_TUNING.IDLE_SHAKE_SPEED;
  // Two incommensurate sines per axis: irregular, and it never pops at a loop seam.
  const jx = Math.sin(t * speed) * 0.6 + Math.sin(t * speed * 1.618 + 1.3) * 0.4;
  const jz = Math.sin(t * speed * 0.87 + 2.1) * 0.6 + Math.sin(t * speed * 1.37 + 0.4) * 0.4;
  const amount = calm ? 0 : CHEST_TUNING.IDLE_SHAKE_AMOUNT * (0.35 + Math.min(1.5, pulse) * 0.9);
  const breathe = calm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.7);
  const lidJitter = calm ? 0 : (Math.sin(t * speed * 1.21 + 0.8) * 0.18 + pulse * 1.3) * 1;
  return {
    lidAngle: CHEST_TUNING.LID_IDLE_ANGLE + lidJitter,
    shakeX: jx * amount,
    shakeZ: jz * amount,
    pulse,
    glow: profile.intensity * (0.82 + 0.18 * breathe + 0.55 * pulse),
    leak: profile.intensity * (0.78 + 0.22 * breathe + 0.7 * pulse),
  };
}

// ---------------------------------------------------------------- opening

export interface ChestOpenPlan {
  lidAngle: number;
  /** The light let loose: a burst, settling to a steady spill. */
  glow: number;
  leak: number;
  burst: number;
  done: boolean;
}

export function chestOpen(age: number, profile: ChestRarityProfile, calm = false): ChestOpenPlan {
  const t = calm ? 1 : clamp01(Math.max(0, age) / CHEST_TUNING.OPEN_DURATION);
  // Ease out with a small overshoot: the lid is thrown back and rocks once.
  const c = 1.55;
  const eased = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  const from = CHEST_TUNING.LID_IDLE_ANGLE;
  const burst = calm ? 0 : Math.max(0, 1 - t / 0.45);
  return {
    lidAngle: from + (CHEST_TUNING.LID_OPEN_ANGLE - from) * eased,
    glow: profile.intensity * (0.75 + 1.4 * burst),
    leak: profile.intensity * (0.55 + 1.6 * burst),
    burst,
    done: t >= 1,
  };
}

// ---------------------------------------------------------------- motes and rays

export function chestMoteCount(profile: ChestRarityProfile): number {
  return Math.min(
    CHEST_TUNING.PARTICLE_MAX,
    Math.max(4, Math.round(CHEST_TUNING.PARTICLE_AMOUNT * profile.particles)),
  );
}

export interface ChestMotePose {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
}

/** Mote `index` at time `t`, in chest space (yards, origin on the floor under
 *  the chest). It is born inside, climbs through the lid gap, drifts outward and
 *  fades. Every mote has its own speed, size and birth time; a few are bright
 *  sparkles. `gather` (the arrival) reverses the flow: pulled IN toward the spot. */
export function chestMote(
  index: number,
  t: number,
  profile: ChestRarityProfile,
  gather: number,
  out: ChestMotePose,
): ChestMotePose {
  const speed = (0.28 + hash(index, 1) * 0.5) * CHEST_TUNING.PARTICLE_SPEED;
  const life = (t * speed + hash(index, 2)) % 1;
  const angle = hash(index, 4) * Math.PI * 2 + life * (hash(index, 5) - 0.5) * 2.4;
  const sparkle = hash(index, 6) > 0.82;
  const rise = life * (1.4 + hash(index, 7) * 1.5);
  const spread = 0.25 + life * life * (0.5 + hash(index, 8) * 0.9);
  const flow = 1 - gather;
  // Gathered motes sit on a wide ring and spiral in; free ones rise and spread.
  const radius = spread * flow + (2.6 * (1 - life) + 0.2) * gather;
  out.x = Math.cos(angle) * radius;
  out.z = Math.sin(angle) * radius * 0.7;
  out.y = (0.72 + rise) * flow + (0.2 + life * 1.1) * gather;
  const fade = Math.sin(life * Math.PI);
  out.size = (sparkle ? 0.085 : 0.035 + hash(index, 9) * 0.03) * (0.6 + 0.4 * fade);
  out.alpha = fade * (sparkle ? 1 : 0.7) * Math.min(1.4, profile.intensity);
  return out;
}

export interface ChestRayPose {
  /** Bearing round the chest (radians), lean away from vertical, and size. */
  yaw: number;
  lean: number;
  length: number;
  width: number;
  alpha: number;
}

/** Ray `index` of `count`: wedges of light fanning up out of the gap. Each one
 *  sways and breathes on its own clock, so they never look like fixed cones. */
export function chestRay(
  index: number,
  count: number,
  t: number,
  leak: number,
  out: ChestRayPose,
): ChestRayPose {
  const spreadAngle = Math.PI * 0.9;
  const base = count <= 1 ? 0 : (index / (count - 1) - 0.5) * spreadAngle;
  const sway = Math.sin(t * (0.5 + hash(index, 21) * 0.7) + hash(index, 22) * 6.28);
  const breathe = 0.6 + 0.4 * Math.sin(t * (1.1 + hash(index, 23) * 1.3) + hash(index, 24) * 6.28);
  out.yaw = base + sway * 0.12;
  out.lean = 0.28 + hash(index, 25) * 0.5 + sway * 0.06;
  out.length =
    (2.4 + hash(index, 26) * 1.8) * (0.8 + 0.2 * breathe) * Math.min(1.5, 0.6 + leak * 0.5);
  out.width = 0.95 + hash(index, 27) * 0.7;
  out.alpha = Math.min(1, leak * CHEST_TUNING.LIGHT_LEAK_INTENSITY * (0.4 + 0.4 * breathe));
  return out;
}
