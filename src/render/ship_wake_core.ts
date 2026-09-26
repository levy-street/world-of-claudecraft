// The sailing ship's wake and bow splash as plain particle math (the Three
// painter is ship_wake.ts). Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts): no three.js, no DOM, no Math.random (a small
// seeded generator of its own), so a Vitest drives it frame by frame.
//
// Two emitters ride the hull, at its authored sockets (the GLB's
// Socket_Wake under the stern and Socket_BowSplash at the stem):
//  - the wake: flat foam laid on the water under the stern, spreading out to
//    both sides into the V a hull leaves, lingering a few seconds and fading
//    as the ship draws away (the particles stay where they were laid: the
//    wake is in the world, never dragged with the ship);
//  - the bow splash: short-lived spray thrown up and out from the stem,
//    falling back under gravity.
// Both emit in proportion to the ship's speed, so a moored or creeping ship
// leaves nothing and a ship at cruise leaves a full trail. Everything is
// cosmetic (graphics settings stay gameplay-neutral): a lower tier emits
// fewer particles, nothing a player acts on depends on it.

/** Seconds a wake foam patch lingers, and a spray droplet flies. */
export const WAKE_LIFETIME_S = 5;
export const SPRAY_LIFETIME_S = 0.75;
/** Particles per second at `WAKE_FULL_SPEED` (the rates scale with speed). */
export const WAKE_RATE = 28;
export const SPRAY_RATE = 26;
/** Speed (yards per second) at which both emitters run at their full rate. */
export const WAKE_FULL_SPEED = 16;
/** Below this speed nothing is emitted (a moored ship's idle bob). */
export const WAKE_MIN_SPEED = 1.2;
const SPRAY_GRAVITY = 9;

export interface WakeParticles {
  capacity: number;
  /** world position, velocity, age and lifetime per slot (age >= life: free) */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  age: Float32Array;
  life: Float32Array;
  /** 0 wake foam, 1 bow spray */
  kind: Uint8Array;
  /** next slot to reuse, fractional emission carried between frames, rng */
  next: number;
  wakeDebt: number;
  sprayDebt: number;
  seed: number;
  /** live particles after the last step */
  live: number;
}

export function newWakeParticles(capacity: number): WakeParticles {
  const life = new Float32Array(capacity);
  const age = new Float32Array(capacity).fill(1);
  return {
    capacity,
    px: new Float32Array(capacity),
    py: new Float32Array(capacity),
    pz: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    vz: new Float32Array(capacity),
    age,
    life,
    kind: new Uint8Array(capacity),
    next: 0,
    wakeDebt: 0,
    sprayDebt: 0,
    seed: 0x9e3779b9,
    live: 0,
  };
}

/** A uniform number in [0, 1) from the particles' own generator. */
function rand(p: WakeParticles): number {
  // xorshift32: deterministic, allocation free
  let x = p.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  p.seed = x >>> 0;
  return p.seed / 4294967296;
}

/** The emitting hull this frame: its pose, speed and socket spots. */
export interface WakeEmitter {
  x: number;
  z: number;
  rot: number;
  /** waterline height (world Y) */
  baseY: number;
  speed: number;
  /** sockets in the hull frame (x port, z bow) */
  sternX: number;
  sternZ: number;
  bowX: number;
  bowY: number;
  bowZ: number;
  /** half the hull's beam at the stern, where the wake spreads from */
  sternHalfBeam: number;
}

function spawn(
  p: WakeParticles,
  kind: 0 | 1,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  life: number,
): void {
  const i = p.next;
  p.next = (p.next + 1) % p.capacity;
  p.px[i] = x;
  p.py[i] = y;
  p.pz[i] = z;
  p.vx[i] = vx;
  p.vy[i] = vy;
  p.vz[i] = vz;
  p.age[i] = 0;
  p.life[i] = life;
  p.kind[i] = kind;
}

/**
 * Advance every particle `dt` seconds and emit this frame's new ones from
 * `ship` (null: emit nothing, let the rest fade). `rateScale` thins the
 * emission on lower graphics tiers.
 */
export function stepWakeParticles(
  p: WakeParticles,
  ship: WakeEmitter | null,
  dt: number,
  rateScale = 1,
): void {
  const step = Math.max(0, Math.min(0.25, dt));
  let live = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.age[i] >= p.life[i]) continue;
    p.age[i] += step;
    if (p.age[i] >= p.life[i]) continue;
    if (p.kind[i] === 1) p.vy[i] -= SPRAY_GRAVITY * step;
    else {
      // foam slows as it spreads
      const drag = Math.max(0, 1 - 0.6 * step);
      p.vx[i] *= drag;
      p.vz[i] *= drag;
    }
    p.px[i] += p.vx[i] * step;
    p.py[i] += p.vy[i] * step;
    p.pz[i] += p.vz[i] * step;
    live++;
  }
  p.live = live;
  if (!ship || ship.speed < WAKE_MIN_SPEED || step <= 0) {
    p.wakeDebt = 0;
    p.sprayDebt = 0;
    return;
  }
  const share = Math.min(1, ship.speed / WAKE_FULL_SPEED) * Math.max(0, rateScale);
  const c = Math.cos(ship.rot);
  const s = Math.sin(ship.rot);
  // the hull's axes in the world: bow (sin rot, cos rot), port (cos rot, -sin rot)
  const fwdX = s;
  const fwdZ = c;
  const portX = c;
  const portZ = -s;
  p.wakeDebt += WAKE_RATE * share * step;
  while (p.wakeDebt >= 1) {
    p.wakeDebt -= 1;
    const side = rand(p) < 0.5 ? -1 : 1;
    const lx = ship.sternX + side * ship.sternHalfBeam * (0.2 + 0.6 * rand(p));
    const lz = ship.sternZ - rand(p) * 1.5;
    const spread = side * (0.6 + 1.4 * rand(p)) * share;
    spawn(
      p,
      0,
      ship.x + lx * portX + lz * fwdX,
      ship.baseY + 0.06,
      ship.z + lx * portZ + lz * fwdZ,
      portX * spread - fwdX * 0.4,
      0,
      portZ * spread - fwdZ * 0.4,
      WAKE_LIFETIME_S * (0.7 + 0.3 * rand(p)),
    );
  }
  p.sprayDebt += SPRAY_RATE * share * step;
  while (p.sprayDebt >= 1) {
    p.sprayDebt -= 1;
    const side = rand(p) < 0.5 ? -1 : 1;
    const out = side * (1.2 + 1.8 * rand(p));
    const up = 1.4 + 1.8 * rand(p) * share;
    spawn(
      p,
      1,
      ship.x + ship.bowX * portX + ship.bowZ * fwdX,
      ship.baseY + ship.bowY + 0.2,
      ship.z + ship.bowX * portZ + ship.bowZ * fwdZ,
      portX * out + fwdX * ship.speed * 0.5,
      up,
      portZ * out + fwdZ * ship.speed * 0.5,
      SPRAY_LIFETIME_S * (0.6 + 0.4 * rand(p)),
    );
  }
}

/** A particle's brightness this frame (0 free .. 1 fresh): foam fades
 *  linearly, spray flashes in and out. */
export function wakeParticleAlpha(p: WakeParticles, i: number): number {
  const life = p.life[i];
  const age = p.age[i];
  if (age >= life || life <= 0) return 0;
  const t = age / life;
  if (p.kind[i] === 1) return Math.min(1, t * 6) * (1 - t);
  return (1 - t) * Math.min(1, t * 4 + 0.25);
}
