// Pure plan for the Gravewyrm Sanctum's gate looks (sanctum_gates.ts): which
// rig each gate kind wears, the gates' own slow clocks (a shatter, a hoist, a
// chain falling across the gulf run longer than the gate memory's reveal),
// the Rime and Tithe Gates' shards (the kit's voronoi cells, ported from
// build_gravewyrm_sanctum_kit.py so a stand-in shard and Kit_IceWall_* share
// one frame) and their fall, the Chain Stair grate's lift and slam, the Chain
// Bridge's chain from hanging slack in the crevasse to taut along the sim's
// own walkway, and the rite ward's guttering.
//
// Three-free, DOM-free, deterministic (no Math.random, no wall clock).

import { GRAVEWYRM_SANCTUM_FIELD } from '../../sim/content/gravewyrm_sanctum_layout';
import { pathHeightUnbounded } from '../../sim/instances/authored_field/height';
import type { FieldPathSurface } from '../../sim/instances/authored_field/types';
import type { DungeonGateKind } from '../../sim/types';
import { sanctumHash, smooth01 } from './sanctum_plan_core';

export type SanctumGateRigKind = 'iceWall' | 'chainGate' | 'chainBridge' | 'riteWard';

/** The rig a Sanctum gate kind wears (null for a kind this dungeon never uses). */
export function sanctumGateRig(kind: DungeonGateKind): SanctumGateRigKind | null {
  if (kind === 'ice_wall') return 'iceWall';
  if (kind === 'chain_gate') return 'chainGate';
  if (kind === 'chain_bridge') return 'chainBridge';
  if (kind === 'rite_ward') return 'riteWard';
  return null;
}

// ---- the gates' own clocks -------------------------------------------------------------

/** How long each rig's opening plays (seconds), and its closing (a seal
 *  slams: the grate drops in under half a second). */
export const SANCTUM_GATE_SECONDS: Readonly<
  Record<SanctumGateRigKind, { open: number; close: number }>
> = {
  iceWall: { open: 3.8, close: 1.2 },
  chainGate: { open: 4.2, close: 0.45 },
  chainBridge: { open: 6.5, close: 4 },
  riteWard: { open: 2.6, close: 0.6 },
};

/**
 * One rig's progress toward open (1) or shut (0) on its own clock, from the
 * gate memory's view. First sight snaps: a gate the memory never saw moving
 * stands where it is; one caught mid-reveal plays from the far end.
 */
export class SanctumGateClock {
  private from: number | null = null;
  private wasOpen = false;
  private k = 0;
  private target = 0;

  constructor(private readonly seconds: { open: number; close: number }) {}

  step(openness: number, since: number, open: boolean): number {
    if (this.from === null) {
      this.from = openness > 0 && openness < 1 ? (open ? 0 : 1) : open ? 1 : 0;
      this.wasOpen = open;
    } else if (open !== this.wasOpen) {
      this.from = this.k;
      this.wasOpen = open;
    }
    const target = open ? 1 : 0;
    this.target = target;
    const span = open ? this.seconds.open : this.seconds.close;
    const t = Math.min(1, Math.max(0, since / span));
    // The clock runs the whole way in `span`, from wherever it stood.
    this.k = this.from + (target - this.from) * t;
    return this.k;
  }

  /** Does the current state play a reveal (false when first sight snapped
   *  it in place)? A one-shot burst fires only on a played reveal. */
  get played(): boolean {
    return this.from !== null && this.from !== this.target;
  }
}

// ---- the ice wall -----------------------------------------------------------------------

/** The kit's ice wall (Kit_IceWall_A..G share its frame: the base centre,
 *  front toward +z in the game): 14 wide, 9 tall, 2.4 thick, cut in seven
 *  voronoi cells. */
export const ICE_WALL = {
  half: 7,
  height: 9,
  thick: 2.4,
  seeds: [
    [-4.6, 2.2],
    [-1.4, 1.6],
    [2.2, 2.4],
    [5.2, 1.4],
    [-3.6, 6.4],
    [0.6, 5.6],
    [4.2, 6.8],
  ] as const,
} as const;

export const ICE_WALL_PIECES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => `Kit_IceWall_${l}`);

/** Clip a convex polygon by the half-plane n.(p - m) <= 0. */
function clip(
  poly: [number, number][],
  m: [number, number],
  n: [number, number],
): [number, number][] {
  const out: [number, number][] = [];
  const side = (p: [number, number]) => (p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if (sa <= 0 !== sb <= 0) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** The cell of shard `i` in the wall's front rectangle (x across, y up), a
 *  convex polygon: the kit's _voronoi_cell. */
export function iceWallCell(i: number): [number, number][] {
  let poly: [number, number][] = [
    [-ICE_WALL.half, 0],
    [ICE_WALL.half, 0],
    [ICE_WALL.half, ICE_WALL.height],
    [-ICE_WALL.half, ICE_WALL.height],
  ];
  const [sx, sy] = ICE_WALL.seeds[i];
  for (const [j, [tx, ty]] of ICE_WALL.seeds.entries()) {
    if (j === i) continue;
    poly = clip(poly, [(sx + tx) / 2, (sy + ty) / 2], [tx - sx, ty - sy]);
  }
  return poly;
}

/** A cell's centroid (vertex mean, as the kit takes it). */
export function iceWallCellCentre(i: number): [number, number] {
  const poly = iceWallCell(i);
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** The shatter's beats on the wall's clock k (0 shut, 1 open): cracks race
 *  over the face first, then the shards let go. */
export const ICE_WALL_CRACK_END = 0.3;
export const ICE_WALL_FALL_START = 0.24;

/** How far the cracks have raced over the face (0..1). */
export function iceWallCracks(k: number): number {
  return smooth01(k / ICE_WALL_CRACK_END);
}

export interface ShardPose {
  /** Offset of the shard's centre from where it stands in the wall. */
  dx: number;
  dy: number;
  dz: number;
  /** Tumble: an axis (unit, in the wall's frame) and an angle (radians). */
  ax: number;
  ay: number;
  az: number;
  angle: number;
  /** 0 standing in the wall, 1 lying in the rubble. */
  fall: number;
}

/**
 * Shard `i`'s pose on the wall's clock k. The top shards let go first; each
 * topples forward or back off the wall's line, drops under gravity, skids to
 * the side of the passage and lies broken half sunk in the snow, so the way
 * through is clear (open = rubble at the sides).
 */
export function iceWallShardPose(i: number, k: number): ShardPose {
  const [cx, cy] = iceWallCellCentre(i);
  const delay = ICE_WALL_FALL_START + (1 - cy / ICE_WALL.height) * 0.18 + sanctumHash(i, 41) * 0.08;
  const s = Math.max(0, Math.min(1, (k - delay) / (1 - delay)));
  // Free fall: the drop accelerates (s squared), the drift eases out.
  const side = cx >= 0 ? 1 : -1;
  const restX = side * (ICE_WALL.half + 0.6 + sanctumHash(i, 43) * 2.4) - cx;
  const fwd = (sanctumHash(i, 47) > 0.5 ? 1 : -1) * (1.6 + sanctumHash(i, 53) * 2.6);
  const restY = -cy - 0.6 - sanctumHash(i, 59) * 0.9;
  const drift = 1 - (1 - s) ** 2;
  const angle = drift * (1.1 + sanctumHash(i, 61) * 0.9);
  // Tip about an axis along the wall (forward or back) with some twist.
  const twist = (sanctumHash(i, 67) - 0.5) * 0.8;
  const l = Math.hypot(1, twist, 0.3);
  return {
    dx: restX * drift,
    dy: restY * s * s + Math.sin(Math.PI * s) * 0.8,
    dz: fwd * drift,
    ax: (fwd > 0 ? 1 : -1) / l,
    ay: twist / l,
    az: (side * 0.3) / l,
    angle,
    fall: s,
  };
}

// ---- the chain gate ---------------------------------------------------------------------

/** The kit grate (Kit_ChainGate): 10.4 wide, 9.1 tall, foot centre closed,
 *  lifting eyes at x +-4.4, y 8.6; its posts (Kit_ChainGatePost) at x +-5.6. */
export const CHAIN_GATE = {
  half: 5.2,
  height: 9.1,
  eyeX: 4.4,
  eyeY: 8.6,
  postX: 5.6,
  postH: 11.2,
  /** How high the grate's foot rides when it is open (clear head room). */
  travel: 6.4,
  /** The stone lintel over the posts the grate rises into. */
  lintelY: 11.2,
  lintelH: 4.6,
} as const;

/** The grate's lift on its clock (0 down, 1 fully raised): a slow hoist that
 *  starts with a jerk (the chains take the weight). When it closes (a seal)
 *  the same curve runs backward fast: it drops and slams. */
export function chainGateLift(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  // A first jerk (the first tenth lifts it a hand), then a steady hoist.
  return t < 0.12 ? (t / 0.12) * 0.04 : 0.04 + 0.96 * smooth01((t - 0.12) / 0.88);
}

// ---- the chain bridge -------------------------------------------------------------------

const bridgeSurface = GRAVEWYRM_SANCTUM_FIELD.surfaces.find(
  (s) => s.id === 'chain_bridge' && s.kind === 'path',
) as FieldPathSurface | undefined;

/** The walking deck's ends along z (the chain overlaps the terrace rim and
 *  the Thaw Works' rim) and the link pitch of the Smith's chain (Kit_ChainLink:
 *  9.25 long, 6 wide, pitch 6.25, alternate links a quarter turn). */
export const CHAIN_BRIDGE_DECK = {
  fromZ: -3,
  toZ: 30,
  x: 0,
  pitch: 6.25,
  linkLength: 9.25,
  linkHalfWidth: 3,
  /** The link bar's thickness (the standing links' worn tops are flush with
   *  the deck; a flat link lies its bar's half below it). */
  bar: 1.5,
  /** The rime crust's width over the chain (the walk is the sim's 9 wide
   *  path; the crust's lumpy flanks spill past the links). */
  crustHalfWidth: 4.6,
} as const;

/** The sim's walkway height under the deck's centre line at z (the exact
 *  height a player stands at on the open bridge). */
export function chainBridgeDeckHeight(z: number): number {
  if (!bridgeSurface) return 30;
  return pathHeightUnbounded(bridgeSurface, CHAIN_BRIDGE_DECK.x, z);
}

interface DeckSample {
  z: number;
  y: number;
  s: number;
}

let deckTable: DeckSample[] | null = null;

function deck(): DeckSample[] {
  if (deckTable) return deckTable;
  const out: DeckSample[] = [];
  const steps = 132;
  let s = 0;
  let pz: number = CHAIN_BRIDGE_DECK.fromZ;
  let py = chainBridgeDeckHeight(pz);
  for (let i = 0; i <= steps; i++) {
    const z =
      CHAIN_BRIDGE_DECK.fromZ + ((CHAIN_BRIDGE_DECK.toZ - CHAIN_BRIDGE_DECK.fromZ) * i) / steps;
    const y = chainBridgeDeckHeight(z);
    s += Math.hypot(z - pz, y - py);
    out.push({ z, y, s });
    pz = z;
    py = y;
  }
  deckTable = out;
  return out;
}

/** The open deck's length along the chain (yards). */
export function chainBridgeLength(): number {
  const d = deck();
  return d[d.length - 1].s;
}

/** The open deck's point (z, y) at arc length s along it. */
export function chainBridgeDeckAt(s: number): { z: number; y: number } {
  const d = deck();
  if (s <= 0) return { z: d[0].z, y: d[0].y };
  for (let i = 1; i < d.length; i++) {
    if (d[i].s >= s) {
      const a = d[i - 1];
      const b = d[i];
      const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
      return { z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  const last = d[d.length - 1];
  return { z: last.z, y: last.y };
}

/** The number of links along the chain (the first anchored at the terrace). */
export function chainBridgeLinkCount(): number {
  return Math.floor(chainBridgeLength() / CHAIN_BRIDGE_DECK.pitch) + 1;
}

/** The share of the clock the chain spends swinging across before it pulls
 *  taut (it lands on the far rim at this beat: the first clang). */
export const CHAIN_BRIDGE_LAND = 0.6;

/** Where the chain leaves the Lock Terrace (z just past the rim): the links
 *  before it lie sunk in the terrace floor, the rest swing from here. */
export const CHAIN_BRIDGE_PIVOT_Z = 3;

/** Arc length of the pivot along the open deck. */
export function chainBridgePivotS(): number {
  const d = deck();
  for (const p of d) if (p.z >= CHAIN_BRIDGE_PIVOT_Z) return p.s;
  return 0;
}

/**
 * A point of the chain's top line at arc length s on the bridge's clock k (0
 * hanging slack from the Lock Terrace's rim straight down into the crevasse,
 * 1 taut along the walkway). Returns (z, y) in the instance frame; the chain
 * lies in the x = 0 plane. The links before the pivot lie in the terrace
 * floor at every k; past it, swinging, the far links lag behind the near ones
 * (a whip); landed, it bows in a sag that hauls out taut with a last shudder.
 */
export function chainBridgePoint(s: number, k: number): { z: number; y: number } {
  const sR = chainBridgePivotS();
  if (s <= sR) return chainBridgeDeckAt(s);
  const L = chainBridgeLength();
  const r = chainBridgeDeckAt(sR);
  const end = chainBridgeDeckAt(L);
  const arm = s - sR;
  const span = Math.max(1e-6, L - sR);
  const rho = Math.max(0, Math.min(1, arm / span));
  const reach = Math.atan2(end.y - r.y, end.z - r.z);
  const sag0 = 7.5;
  if (k < CHAIN_BRIDGE_LAND) {
    const u = Math.max(0, k) / CHAIN_BRIDGE_LAND;
    // Ease in hard (it is hauled up from the depth), ease out as it lands.
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    const ang = -Math.PI / 2 + (reach + Math.PI / 2) * e - 0.9 * e * (1 - e) * rho;
    const sag = sag0 * e * 4 * rho * (1 - rho);
    return { z: r.z + Math.cos(ang) * arm, y: r.y + Math.sin(ang) * arm - sag };
  }
  const v = Math.min(1, (k - CHAIN_BRIDGE_LAND) / (1 - CHAIN_BRIDGE_LAND));
  const w = smooth01(v);
  const straightZ = r.z + Math.cos(reach) * arm;
  const straightY = r.y + Math.sin(reach) * arm - sag0 * 4 * rho * (1 - rho);
  const open = chainBridgeDeckAt(s);
  // The last shudder as it snaps taut (dies out exactly at the seat).
  const shudder = Math.sin(v * Math.PI * 3) * (1 - v) ** 2 * 1.4 * 4 * rho * (1 - rho);
  return {
    z: straightZ + (open.z - straightZ) * w,
    y: straightY + (open.y - straightY) * w - shudder,
  };
}

/** The rime crust's grow on the bridge clock (0 bare chain, 1 the frozen
 *  walkway): it frosts over once the chain is taut. */
export function chainBridgeCrust(k: number): number {
  return smooth01((k - 0.9) / 0.1);
}

// ---- the rite ward ----------------------------------------------------------------------

/** The ward's charge (0 out, 1 burning) from its clock k (1 open): it
 *  gutters, flaring and dying in stutters, then goes out. */
export function riteWardCharge(k: number, t: number): number {
  const o = Math.max(0, Math.min(1, k));
  if (o >= 1) return 0;
  const stutter = 0.5 + 0.5 * Math.sin(t * 37 + Math.sin(t * 13) * 2);
  return (1 - o) * (1 - o * 0.7 * stutter);
}
