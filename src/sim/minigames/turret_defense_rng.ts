// Stateless private draws for Fire and Fly (the camp_private_rng pattern): each
// draw builds an Rng from a hash of the session seed, a stream and the draw
// site's own keys, so the session stays plain data and never touches the world
// stream. A host that holds a private salt (the realm server) keys every draw
// with it: the 32-bit seed alone is small enough to brute-force from a couple of
// observed spawns, so a client that never sees the salt cannot replay the run.

import { Rng } from '../rng';
import type { PrivateSalt } from '../types';

export const TURRET_STREAM = {
  spawnAngle: 1,
  spawnGap: 2,
  throwDeviation: 3,
  barrelBearing: 4,
  barrelRadius: 5,
  barrelThrow: 6,
  arrivalSide: 7,
  shockwaveThrow: 8,
  bombletThrow: 9,
} as const;

/** 64 bits derived once per run from the salt and the seed; never on any view or wire. */
export type TurretRunKey = readonly [number, number];

/** What a draw site reads: the run seed, keyed when the host holds a salt. */
export interface TurretDrawSource {
  readonly seed: number;
  readonly runKey?: TurretRunKey;
}

const RUN_KEY_DOMAIN = 0x7475726b;

function mixAll(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const n of values) {
    h = (h ^ (n >>> 0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rotl(x: number, b: number): number {
  return ((x << b) | (x >>> (32 - b))) >>> 0;
}

/** HalfSipHash-2-4 rounds on 32-bit lanes: a 64-bit key, whole 32-bit message words. */
export function turretKeyedHash(k0: number, k1: number, words: readonly number[]): number {
  let v0 = k0 >>> 0;
  let v1 = k1 >>> 0;
  let v2 = (0x6c796765 ^ k0) >>> 0;
  let v3 = (0x74656462 ^ k1) >>> 0;
  const round = (): void => {
    v0 = (v0 + v1) >>> 0;
    v1 = rotl(v1, 5) ^ v0;
    v0 = rotl(v0, 16);
    v2 = (v2 + v3) >>> 0;
    v3 = rotl(v3, 8) ^ v2;
    v0 = (v0 + v3) >>> 0;
    v3 = rotl(v3, 7) ^ v0;
    v2 = (v2 + v1) >>> 0;
    v1 = rotl(v1, 13) ^ v2;
    v2 = rotl(v2, 16);
  };
  for (const word of words) {
    const m = word >>> 0;
    v3 ^= m;
    round();
    round();
    v0 ^= m;
  }
  const tail = ((words.length * 4) & 0xff) << 24;
  v3 ^= tail;
  round();
  round();
  v0 ^= tail;
  v2 ^= 0xff;
  round();
  round();
  round();
  round();
  return (v1 ^ v3) >>> 0;
}

/** The run's draw key: every salt bit and the seed, folded once at seat time. */
export function turretRunKey(salt: PrivateSalt, seed: number): TurretRunKey {
  const [s0, s1] = salt;
  return [
    turretKeyedHash(s0, s1, [seed, RUN_KEY_DOMAIN, 0]),
    turretKeyedHash(s0, s1, [seed, RUN_KEY_DOMAIN, 1]),
  ];
}

/**
 * The session seed from one world rng draw taken at seat time (a uniform in [0, 1)): the
 * farming hidden pre-roll, so no value a client sees derives it. A replay passes the seed
 * (online, it also needs the same boot's salt).
 */
export function turretSessionSeed(worldDraw: number): number {
  return Math.floor(worldDraw * 0x100000000) >>> 0;
}

/** One uniform value in [0, 1) for a draw site. */
export function turretDraw(source: TurretDrawSource, stream: number, a: number, b = 0): number {
  const key = source.runKey;
  const hash = key
    ? turretKeyedHash(key[0], key[1], [stream, a, b])
    : mixAll([source.seed, stream, a, b]);
  return new Rng(hash).next();
}
