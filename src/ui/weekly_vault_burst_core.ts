// Pure choreography for the weekly vault opening: the timeline the reveal
// controller stamps onto the stage, and the individual ray / star / streak /
// ring layout it mints as DOM. DOM-free and deterministic (a fixed hash, never
// Math.random) so the variety is identical on every repaint and every host, and
// the show is unit-tested directly. The CSS (src/styles/components.css, weekly
// rewards section) reads every number through the --vault-* custom properties
// minted here; it never retypes one.

/** Milestones of one opening, in ms after the `vault-is-open` class lands. */
export interface VaultTimeline {
  /** Light starts leaking around the door seam (from the inside). */
  chargeMs: number;
  /** The door begins its heavy swing. */
  swingMs: number;
  /** Rays, stars, streaks and rings may start firing. */
  burstMs: number;
  /** The door has swung far enough to show the doorway (about two thirds of
   *  the way on its own curve). The loot never starts before this; the styles
   *  test proves it against the door keyframes. */
  doorClearMs: number;
  /** The door has finished swinging (its last keyframe before the settle). */
  doorOpenMs: number;
  /** The loot icon and name pop in from the centre, as soon as the doorway
   *  shows and while the burst is still going, covering the strokes there. */
  lootMs: number;
  /** How long the loot pop takes. */
  lootFadeMs: number;
  /** Every burst element has faded by here. */
  settleMs: number;
  /** The reveal is complete: the host enables the loot for inspection. */
  revealMs: number;
}

/** The doorway shows about two thirds of the way through the swing, and the
 *  loot pops the moment it does. (A duration, not a price: the bank/vault
 *  family price scan carries an anchored allowance for this one literal.) */
const DOOR_CLEAR_MS = 1000;

export const VAULT_TIMELINE: Readonly<VaultTimeline> = Object.freeze({
  chargeMs: 0,
  swingMs: 320,
  burstMs: 560,
  doorClearMs: DOOR_CLEAR_MS,
  doorOpenMs: 1760,
  lootMs: DOOR_CLEAR_MS,
  lootFadeMs: 420,
  settleMs: 2900,
  revealMs: 3000,
});

/** The star / streak particle box, as a percentage of the illustration. Each
 *  particle travels in multiples of its own box, so the core converts
 *  illustration percentages into box percentages with this ratio. */
export const VAULT_PARTICLE_BOX = 10;

export type VaultRayTier = 'wide' | 'mid' | 'thin';

export interface VaultRay {
  /** Origin, % of the illustration. */
  x: number;
  y: number;
  /** Direction, degrees (CSS rotate: 0 = right, positive = clockwise). */
  angle: number;
  /** Length and thickness, % of the illustration. */
  length: number;
  width: number;
  /** Start and life, ms after the open class. The head shoots out over the
   *  first third of the life, then the tail follows it out (the stroke trims
   *  outward from the centre; it never fades in place). */
  delay: number;
  duration: number;
  /** Slow fan-out over the ray's life, degrees. */
  drift: number;
  /** Opacity: wide soft rays sit under the crisp thin ones. */
  peak: number;
  tier: VaultRayTier;
}

export interface VaultStar {
  /** Destination offset from the centre, % of the illustration. */
  x: number;
  y: number;
  /** Diameter, % of the illustration. */
  size: number;
  delay: number;
  duration: number;
  /** One twinkle half-period, ms. */
  twinkleMs: number;
  /** How many half-periods the twinkle runs: always inside the star's life. */
  twinkles: number;
  /** Total rotation while it travels, degrees. */
  spin: number;
}

export interface VaultStreak {
  x: number;
  y: number;
  angle: number;
  /** Length, % of the illustration. */
  length: number;
  delay: number;
  duration: number;
}

export interface VaultRing {
  delay: number;
  duration: number;
  /** Final scale relative to the ring's resting diameter. */
  scale: number;
}

export interface VaultBurstLayout {
  rays: VaultRay[];
  stars: VaultStar[];
  streaks: VaultStreak[];
  rings: VaultRing[];
}

const RAY_COUNT = 30;
const STAR_COUNT = 14;
const STREAK_COUNT = 18;
/** Golden-angle spacing: evenly spread around the circle, never on a grid. */
const GOLDEN_ANGLE = 137.508;
const RAY_TIERS: readonly VaultRayTier[] = ['wide', 'mid', 'thin'];

/** Deterministic jitter in [0, 1): an integer hash, so every host and every
 *  repaint minting the same index gets the same value. */
function jitter(index: number, salt: number): number {
  let x = (Math.imul(index + 1, 374761393) + Math.imul(salt + 1, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
/** A value inside [min, max] at jitter t. */
const within = (t: number, min: number, max: number) => min + t * (max - min);

function ray(index: number, burstMs: number): VaultRay {
  const tier = RAY_TIERS[index % RAY_TIERS.length];
  const j = (salt: number) => jitter(index, salt);
  const angle = Math.round((index * GOLDEN_ANGLE + 12) % 360);
  // Per tier: thickness, length and life as [min, max] ranges (% and ms).
  const size =
    tier === 'wide'
      ? {
          width: within(j(1), 8, 13),
          length: within(j(2), 52, 74),
          duration: within(j(3), 1350, 1900),
          peak: 0.75,
        }
      : tier === 'mid'
        ? {
            width: within(j(1), 3.5, 6),
            length: within(j(2), 68, 94),
            duration: within(j(3), 1050, 1600),
            peak: 0.95,
          }
        : {
            width: within(j(1), 1.4, 2.6),
            length: within(j(2), 84, 114),
            duration: within(j(3), 900, 1400),
            peak: 1,
          };
  return {
    x: round1(50 + (j(4) - 0.5) * 10),
    y: round1(50 + (j(5) - 0.5) * 10),
    angle,
    length: round1(size.length),
    width: round1(size.width),
    delay: burstMs + Math.round(j(6) * 300),
    duration: Math.round(size.duration),
    drift: round1((3 + j(7) * 5) * (index % 2 ? 1 : -1)),
    peak: size.peak,
    tier,
  };
}

function star(index: number, burstMs: number, settleMs: number): VaultStar {
  const j = (salt: number) => jitter(index + 100, salt);
  const angle = ((index * GOLDEN_ANGLE + 30) % 360) * (Math.PI / 180);
  const distance = 26 + j(1) * 36;
  const delay = burstMs + 40 + Math.round(j(2) * 380);
  const duration = Math.min(1450 + Math.round(j(3) * 800), settleMs - delay);
  const twinkleMs = 160 + Math.round(j(5) * 180);
  return {
    x: round1(Math.cos(angle) * distance),
    y: round1(Math.sin(angle) * distance),
    size: round1(4 + j(4) * 5),
    delay,
    duration,
    twinkleMs,
    twinkles: Math.max(1, Math.floor(duration / twinkleMs)),
    spin: round1((20 + j(6) * 50) * (index % 2 ? 1 : -1)),
  };
}

function streak(index: number, burstMs: number, settleMs: number): VaultStreak {
  const j = (salt: number) => jitter(index + 200, salt);
  const angle = Math.round((index * GOLDEN_ANGLE + 75) % 360);
  const radians = angle * (Math.PI / 180);
  const distance = 28 + j(1) * 32;
  const delay = burstMs + Math.round(j(2) * 260);
  const duration = Math.min(1050 + Math.round(j(3) * 750), settleMs - delay);
  return {
    x: round1(Math.cos(radians) * distance),
    y: round1(Math.sin(radians) * distance),
    angle,
    length: round1(5 + j(4) * 9),
    delay,
    duration,
  };
}

/** The whole burst: every element carries its own start, life, reach and
 *  drift, so nothing fires in lockstep and the stars outlive the streaks,
 *  which outlive most rays. Everything settles before the host's reveal. */
export function weeklyVaultBurstLayout(timeline: VaultTimeline = VAULT_TIMELINE): VaultBurstLayout {
  const { burstMs, settleMs } = timeline;
  return {
    rays: Array.from({ length: RAY_COUNT }, (_, index) => ray(index, burstMs)),
    stars: Array.from({ length: STAR_COUNT }, (_, index) => star(index, burstMs, settleMs)),
    streaks: Array.from({ length: STREAK_COUNT }, (_, index) => streak(index, burstMs, settleMs)),
    rings: [
      { delay: burstMs + 100, duration: 950, scale: 2.3 },
      { delay: burstMs + 360, duration: 1350, scale: 3.1 },
    ],
  };
}

const ms = (value: number) => `${Math.round(value)}ms`;
const pct = (value: number) => `${round1(value)}%`;
const deg = (value: number) => `${round1(value)}deg`;
/** Illustration percent to particle-box percent. */
const box = (value: number) => pct((value * 100) / VAULT_PARTICLE_BOX);

/** The milestones the stylesheet reads. The swing start lives inside the
 *  door's own keyframes, the door-clear gate is proven against those
 *  keyframes by the styles test, and the settle bound is enforced by the
 *  layout, so none of the three is stamped (every stamped var is read). */
export function vaultTimelineVars(
  timeline: VaultTimeline = VAULT_TIMELINE,
): Record<string, string> {
  return {
    '--vault-t-charge': ms(timeline.chargeMs),
    '--vault-t-burst': ms(timeline.burstMs),
    '--vault-t-open': ms(timeline.doorOpenMs),
    '--vault-t-loot': ms(timeline.lootMs),
    '--vault-t-loot-fade': ms(timeline.lootFadeMs),
  };
}

export function vaultRayVars(r: VaultRay): Record<string, string> {
  return {
    '--vault-ray-x': pct(r.x),
    '--vault-ray-y': pct(r.y),
    '--vault-ray-angle': deg(r.angle),
    '--vault-ray-length': pct(r.length),
    '--vault-ray-width': pct(r.width),
    '--vault-ray-delay': ms(r.delay),
    '--vault-ray-duration': ms(r.duration),
    '--vault-ray-drift': deg(r.drift),
    '--vault-ray-peak': String(r.peak),
  };
}

export function vaultStarVars(s: VaultStar): Record<string, string> {
  return {
    '--vault-star-x': box(s.x),
    '--vault-star-y': box(s.y),
    '--vault-star-size': box(s.size),
    '--vault-star-delay': ms(s.delay),
    '--vault-star-duration': ms(s.duration),
    '--vault-star-twinkle': ms(s.twinkleMs),
    '--vault-star-twinkles': String(s.twinkles),
    '--vault-star-spin': deg(s.spin),
  };
}

export function vaultStreakVars(s: VaultStreak): Record<string, string> {
  return {
    '--vault-streak-x': box(s.x),
    '--vault-streak-y': box(s.y),
    '--vault-streak-angle': deg(s.angle),
    '--vault-streak-length': box(s.length),
    '--vault-streak-delay': ms(s.delay),
    '--vault-streak-duration': ms(s.duration),
  };
}

export function vaultRingVars(r: VaultRing): Record<string, string> {
  return {
    '--vault-ring-delay': ms(r.delay),
    '--vault-ring-duration': ms(r.duration),
    '--vault-ring-scale': String(r.scale),
  };
}
