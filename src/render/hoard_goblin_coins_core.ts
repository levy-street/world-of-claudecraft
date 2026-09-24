// How the Coinsack Scurrier's gold LOOKS when it dies: the sack on its back
// bursts and the coins fly out, bounce, lie on the floor a while, then sink
// away. The payout itself is the sim's (src/sim/rift/hoard_goblin.ts pays every
// player in the room straight into their bags); this is only the show. No
// Three.js, no DOM: a Vitest imports this directly, and the adapter beside it
// (hoard_goblin_coins.ts) only copies these numbers onto an instanced mesh.

export const COIN_LOOK = Object.freeze({
  gold: 0xf2c14e,
  glow: 0x6b4a08,
  /** One coin, in yards: a little larger than life so it reads from the camera. */
  radius: 0.15,
  thickness: 0.035,
  count: 28,
  lowCount: 14,
  /** Where the sack rides: up the back, a step behind the body. */
  sackHeight: 1.35,
  sackBack: 0.35,
  gravity: 22,
  /** Launch speeds (yards per second). */
  upMin: 5,
  upMax: 8.5,
  outMin: 1.2,
  outMax: 4.2,
  /** Each bounce keeps this much of the fall speed, and this much of the slide. */
  restitution: 0.38,
  friction: 0.55,
  maxBounces: 2,
  /** A bounce slower than this lays the coin down instead. */
  settleSpeed: 1.2,
  /** Seconds a coin lies on the floor, then how long it takes to sink away. */
  restSec: 7,
  sinkSec: 1,
  /** A spent burst is let go after this long, whatever its coins are doing. */
  lifeSec: 9,
});

export interface Coin {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Tumble angles and their rates (radians, radians per second). */
  rx: number;
  ry: number;
  rz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  bounces: number;
  resting: boolean;
}

export function makeCoin(): Coin {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    bounces: 0,
    resting: false,
  };
}

/** A small seeded stream, so one burst always scatters the same way. */
export function coinRandom(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

/** Lay out one burst from the sack of a goblin standing at (x, z), facing
 *  `facing` (the sim's convention: atan2(dx, dz)). `still` (reduced motion)
 *  skips the flight: the coins are simply found lying round the body. */
export function spawnCoins(
  coins: Coin[],
  x: number,
  z: number,
  facing: number,
  ground: (x: number, z: number) => number,
  seed: number,
  still: boolean,
): void {
  const L = COIN_LOOK;
  const rand = coinRandom(seed);
  const sackX = x - Math.sin(facing) * L.sackBack;
  const sackZ = z - Math.cos(facing) * L.sackBack;
  const sackY = ground(x, z) + L.sackHeight;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    // Spread evenly round the ring, then jittered, so no side is ever bare.
    const angle = ((i + rand() * 0.8) / coins.length) * Math.PI * 2;
    const out = L.outMin + rand() * (L.outMax - L.outMin);
    c.bounces = 0;
    c.rx = rand() * Math.PI * 2;
    c.ry = rand() * Math.PI * 2;
    c.rz = rand() * Math.PI * 2;
    c.spinX = (rand() - 0.5) * 22;
    c.spinY = (rand() - 0.5) * 10;
    c.spinZ = (rand() - 0.5) * 22;
    if (still) {
      const reach = out * 0.45;
      c.x = sackX + Math.sin(angle) * reach;
      c.z = sackZ + Math.cos(angle) * reach;
      layDown(c, ground(c.x, c.z));
      continue;
    }
    c.x = sackX + (rand() - 0.5) * 0.3;
    c.z = sackZ + (rand() - 0.5) * 0.3;
    c.y = sackY + (rand() - 0.5) * 0.3;
    c.vx = Math.sin(angle) * out;
    c.vz = Math.cos(angle) * out;
    c.vy = L.upMin + rand() * (L.upMax - L.upMin);
    c.resting = false;
  }
}

function layDown(c: Coin, floor: number): void {
  c.y = floor + COIN_LOOK.thickness / 2;
  c.vx = 0;
  c.vy = 0;
  c.vz = 0;
  // Flat on the floor, keeping only its turn about the vertical.
  c.rx = 0;
  c.rz = 0;
  c.resting = true;
}

/** Advance one coin by dt: fall, tumble, bounce off the floor, then lie flat. */
export function stepCoin(c: Coin, dt: number, ground: (x: number, z: number) => number): void {
  if (c.resting) return;
  const L = COIN_LOOK;
  c.vy -= L.gravity * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.z += c.vz * dt;
  c.rx += c.spinX * dt;
  c.ry += c.spinY * dt;
  c.rz += c.spinZ * dt;
  const floor = ground(c.x, c.z);
  if (c.y > floor + L.thickness / 2 || c.vy > 0) return;
  const fall = -c.vy;
  if (c.bounces >= L.maxBounces || fall * L.restitution < L.settleSpeed) {
    layDown(c, floor);
    return;
  }
  c.bounces++;
  c.y = floor + L.thickness / 2;
  c.vy = fall * L.restitution;
  c.vx *= L.friction;
  c.vz *= L.friction;
  c.spinX *= 0.5;
  c.spinZ *= 0.5;
}

/** How big a coin draws `age` seconds after the burst: whole while it flies
 *  and lies, then shrinking into the floor, then gone. */
export function coinScale(age: number): number {
  const L = COIN_LOOK;
  if (age <= L.restSec) return 1;
  const t = (age - L.restSec) / L.sinkSec;
  return t >= 1 ? 0 : 1 - t * t;
}

/** The glint a coin throws at `age`: a bright flash as the sack bursts, then
 *  a slow twinkle while it lies (each coin on its own beat), gone as it sinks. */
export function coinGlint(age: number, index: number, time: number): number {
  const flash = age < 0.35 ? 1 - age / 0.35 : 0;
  if (age > COIN_LOOK.restSec) return flash;
  const beat = Math.sin(time * 2.3 + index * 2.39996);
  const twinkle = beat > 0.93 ? (beat - 0.93) / 0.07 : 0;
  return Math.max(flash, twinkle * 0.8);
}

export interface WatchedEntity {
  readonly id: number;
  readonly templateId?: string;
  readonly dead: boolean;
  readonly pos: { readonly x: number; readonly z: number };
  readonly facing: number;
}

export interface CoinBurst {
  id: number;
  x: number;
  z: number;
  facing: number;
}

/** Find goblins that died since the last look. `seen` remembers every goblin by
 *  id and whether it was already dead: only a LIVING goblin seen before and
 *  dead now bursts, so one already lying dead when you walk in stays quiet,
 *  and one that escapes (it simply vanishes) never bursts at all. `present`
 *  is scratch space a caller may pass to keep the poll allocation-free. */
export function goblinDeaths(
  entities: Iterable<WatchedEntity>,
  templateId: string,
  seen: Map<number, boolean>,
  out: CoinBurst[],
  present: Set<number> = new Set(),
): CoinBurst[] {
  out.length = 0;
  present.clear();
  for (const e of entities) {
    if (e.templateId !== templateId) continue;
    present.add(e.id);
    const before = seen.get(e.id);
    if (before === false && e.dead) {
      out.push({ id: e.id, x: e.pos.x, z: e.pos.z, facing: e.facing });
    }
    seen.set(e.id, e.dead);
  }
  for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
  return out;
}
