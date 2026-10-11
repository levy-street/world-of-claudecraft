// Pure plan for the Smith's great chains (design sections 3 and 4): four
// chains as thick as a ship's mast run from the rings atop the four seal
// pillars on the Lock Terrace, high over the gulf, the Thaw Works, the vault
// and the shore, and INTO the Calving Face at its four chain entries. Each
// hangs in a shallow catenary (render only, high above every walkway). As
// Korgath's chains break (the face's stage 2, `chains` of them), a chain
// tears out of the ice and falls: its free end swings down into the gulf
// and it hangs slack from its pillar's ring, over the terrace rim, into the
// crevasse.
//
// Three-free, DOM-free, deterministic.

import { LOCK_TERRACE, SEAL_PILLARS } from '../../sim/content/gravewyrm_sanctum_layout';
import { faceChainEntries } from './sanctum_face_core';

export type Vec3 = [number, number, number];

/** The drawn scale of the kit's Kit_ChainLink on these runs (the kit link is
 *  9.8 long on a 6.25 pitch, the Chain Bridge's walking scale; strung across
 *  the cirque from twelve-yard pillars it read as a cartoon chain, so these
 *  run at about six yards a link, still as thick as a mast). */
export const CHAIN_LINK_SCALE = 0.62;
/** The chain link's pitch along the run (yards; every other link a quarter
 *  turn). */
export const CHAIN_PITCH = 6.25 * CHAIN_LINK_SCALE;
/** The seal pillars' drawn scale (the kit pillar is 15 tall on a 2.7 plinth
 *  radius; the sim's collider is r 2.2, h 12). */
export const PILLAR_SCALE = 0.82;
/** Height of a pillar's chain ring over the terrace (just under its crown). */
export const PILLAR_RING_HEIGHT = 15 * PILLAR_SCALE - 0.8;
/** How far a slack chain hangs into the crevasse before it is lost to sight. */
const HANG_FLOOR = -78;

/** Which face entry each pillar's chain runs into (kit order a to d, face
 *  frame west to east as seen from the lake), chosen so no two chains cross
 *  in plan: the western pillars (hammer north-west, bellows south-west) run
 *  to the western entries. Index = SEAL_PILLARS index. */
const ENTRY_OF_PILLAR = [2, 1, 0, 3] as const;

/** The order the chains fall out of the ice as `chains` counts up (the sim
 *  gives a count, not which chain: a fixed, readable order, west to east). */
export const CHAIN_FALL_ORDER = [3, 0, 1, 2] as const;

export interface ChainRun {
  pillar: string;
  /** The ring on the pillar's top (instance-local). */
  ring: Vec3;
  /** Where it runs into the ice. */
  entry: Vec3;
  /** Which kit crack (0..3 = 2a..2d) races from its entry. */
  crack: number;
  /** The slack chain's rest path: ring, terrace rim, down into the gulf. */
  rim: Vec3;
  hangEnd: Vec3;
}

/** The four chain runs (pillar order). */
export function planChainRuns(): ChainRun[] {
  const entries = faceChainEntries();
  return SEAL_PILLARS.map((p, i) => {
    const e = ENTRY_OF_PILLAR[i];
    const entry = entries[e];
    const ring: Vec3 = [p.x, LOCK_TERRACE.h + PILLAR_RING_HEIGHT, p.z];
    // Toward its entry, across the terrace's rim and into the gulf.
    const dx = entry[0] - LOCK_TERRACE.x;
    const dz = entry[2] - LOCK_TERRACE.z;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l;
    const uz = dz / l;
    // From the ring, along the bearing, to the terrace's rim circle.
    const px = p.x - LOCK_TERRACE.x;
    const pz = p.z - LOCK_TERRACE.z;
    const b = px * ux + pz * uz;
    const c = px * px + pz * pz - (LOCK_TERRACE.r + 0.6) ** 2;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    const rim: Vec3 = [p.x + ux * t, LOCK_TERRACE.h + 0.5, p.z + uz * t];
    const hangEnd: Vec3 = [rim[0] + ux * 6, HANG_FLOOR, rim[2] + uz * 6];
    return { pillar: p.id, ring, entry, crack: e, rim, hangEnd };
  });
}

/** A point on the taut run: a catenary-like sag between the ring and the
 *  entry (`sag` yards at the middle). */
export function tautPoint(run: ChainRun, u: number, sag: number): Vec3 {
  const [ax, ay, az] = run.ring;
  const [bx, by, bz] = run.entry;
  const y = ay + (by - ay) * u - sag * 4 * u * (1 - u);
  return [ax + (bx - ax) * u, y, az + (bz - az) * u];
}

/** The taut run's length (a fine polyline). */
export function runLength(run: ChainRun, sag: number): number {
  let len = 0;
  let prev = tautPoint(run, 0, sag);
  for (let i = 1; i <= 64; i++) {
    const p = tautPoint(run, i / 64, sag);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  return len;
}

/** The sag of a taut chain over its span: shallow (they are held taut by the
 *  seal), so they stay far above every walkway. */
export function chainSag(run: ChainRun): number {
  const span = Math.hypot(run.entry[0] - run.ring[0], run.entry[2] - run.ring[2]);
  return span * 0.022;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The chain's polyline at fall progress `k` (0 taut into the ice, 1 hanging
 * slack): the free end leaves the face and swings down and back toward the
 * terrace in an arc while the middle drops; at rest it runs ring, rim, gulf.
 * `n` + 1 points from the ring to the free end.
 */
export function chainPath(run: ChainRun, k: number, n: number): Vec3[] {
  const sag = chainSag(run);
  const out: Vec3[] = [];
  if (k <= 0) {
    for (let i = 0; i <= n; i++) out.push(tautPoint(run, i / n, sag));
    return out;
  }
  // The rest shape: ring to rim (a short drape), then straight down.
  const restLen = runLength(run, sag);
  const drape = Math.hypot(
    run.rim[0] - run.ring[0],
    run.rim[1] - run.ring[1],
    run.rim[2] - run.ring[2],
  );
  const rest = (s: number): Vec3 => {
    const d = s * restLen;
    if (d <= drape) {
      const u = d / Math.max(0.001, drape);
      const p = lerp3(run.ring, run.rim, u);
      p[1] -= Math.sin(Math.PI * u) * 1.2;
      return p;
    }
    const down = d - drape;
    const fall = run.rim[1] - run.hangEnd[1];
    if (down <= fall) return lerp3(run.rim, run.hangEnd, down / fall);
    // Past the floor of sight: the rest of the chain is lost in the deep.
    return [run.hangEnd[0], run.hangEnd[1] - (down - fall), run.hangEnd[2]];
  };
  // Blend: the free end swings on a great arc (out, down, back), the body
  // follows with a lag along its length (the near end moves last).
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const taut = tautPoint(run, s, sag);
    const lag = Math.max(0, Math.min(1, (k * 1.35 - (1 - s) * 0.35) / 1));
    const e = lag * lag * (3 - 2 * lag);
    const p = lerp3(taut, rest(s), e);
    // The swing bows the falling body down below the straight blend.
    p[1] -= Math.sin(Math.PI * e) * 40 * s;
    out.push(p);
  }
  return out;
}

export interface LinkPose {
  /** The link's middle. */
  p: Vec3;
  /** Its long axis (unit). */
  dir: Vec3;
  /** Its roll about the long axis: alternate links a quarter turn. */
  roll: number;
}

/** Links laid along a polyline every `pitch` yards from its start. */
export function linksAlong(path: readonly Vec3[], pitch: number = CHAIN_PITCH): LinkPose[] {
  const out: LinkPose[] = [];
  let carry = pitch / 2;
  let index = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    const dir: Vec3 = [dx / len, dy / len, dz / len];
    let d = carry;
    while (d <= len) {
      const t = d / len;
      out.push({
        p: [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t],
        dir,
        roll: index % 2 === 0 ? 0 : Math.PI / 2,
      });
      index++;
      d += pitch;
    }
    carry = d - len;
  }
  return out;
}
