// The Mirefen tavern's seats (the generic seat vocabulary is ../seat_anchor.ts): every
// place a body can sit, derived from the furniture in TAVERN_PROPS so a seat can never
// drift from the bench, settle, chair or stool the model draws there. Data-as-code, built
// once at module load, deterministic.
//
// Per piece of furniture:
//  - the five cushioned benches round the hearth pit: two places each, facing the fire;
//  - the long table's benches: three places on the room side, two on the wall side (the
//    wall leaves no room behind it, so those two stand at the bench's ends);
//  - the booths' settles (the wall booth, the two window booths) and the settle before the
//    wall fire: two places each, leaning back against the settle's high back; a booth's
//    sitters stand at its open end and slide in along the gap between settle and table;
//  - the four chairs round the square table: relaxed against their backs, facing it;
//  - the dice table's three stools and the bard's stool on the stage: upright;
//  - the four bar stools on the platform: the high pose, facing the counter;
//  - the nook's bench round the tower wall: two places on each of its five runs, facing
//    the middle of the tower;
//  - a bench on the porch: facing the road;
//  - the terrace's benches outside on the cobbles (content/mirefen_tavern_grounds.ts): two
//    places each, facing their trestle table, on the terrain under them (`baseY`).
//
// A seat's STAND spot (where the body stands while seated, see seat_anchor.ts) is chosen by
// a deterministic search over candidate points round the seat (for a backless bench in
// front of or behind it, for a chair or stool beside it), kept clear of every piece of
// furniture's footprint and of the walls by a body's radius and apart from every other
// stand spot. tests/mirefen_tavern_seats.test.ts proves each against the live collider grid.
// A seat whose sitter must come in round something (a booth's inner place, the wall bench's
// ends) also names the `via` point the drawn body walks through on its way in and out.
//
// Frame: TAVERN_PROPS are in the tavern's local yards (content/mirefen_tavern.ts header);
// everything exported here is in world yards, facing in the sim's atan2(dx, dz).

import type { SeatAnchor, SeatKind, SeatPose } from '../seat_anchor';
import {
  TAVERN_BAR_PLATFORM,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_PIT,
  TAVERN_PORCH,
  TAVERN_PROPS,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_YAW,
  type TavernLevel,
  type TavernProp,
  tavernToWorld,
} from './mirefen_tavern';
import { TAVERN_FORECOURT } from './mirefen_tavern_grounds';

/** How much a cushion raises a seat over its board (tavern_furnish.py): the hearth's and
 *  the nook's benches wear a 0.1 cushion, the settles a 0.13 one. */
const BENCH_CUSHION = 0.1;
const SETTLE_CUSHION = 0.13;
/** A settle's seat board overhangs its carcass by this much at the front
 *  (tavern_furnish.py, the board to `hd + 0.05`). */
const SETTLE_BOARD_LIP = 0.05;
/** Every seat's anchor stands this far behind the seat's FRONT edge: the chair clips'
 *  hanging calves (the rig is chibi, its feet hang well over the floor from a 0.9 seat) sit
 *  just in front of the anchor, so the front edge must clear them (sit_anims.glb, measured
 *  on the shipped bodies: calves' backs at 0.12 to 0.16 in front of the anchor). */
const SEAT_EDGE_TO_ANCHOR = 0.11;
/** The standing frames of the sit-down and stand-up clips put the body this far in front of
 *  the anchor; where something stands closer (a booth's table, a bar's counter) the body
 *  steps in from as far as there is room, keeping a torso's half depth clear. */
const PRESIT_AUTHORED = 0.62;
const PRESIT_MIN = 0.3;
const PRESIT_BODY_CLEAR = 0.22;
/** A body's radius plus a hair: how clear of furniture and walls a stand spot must be. */
const STAND_CLEARANCE = 0.56;
/** How far apart two stand spots must be (over twice the hold radius). */
const STAND_SPACING = 0.7;
/** How far apart the candidates for a booth's two places stand along its open end. */
const BOOTH_QUEUE = 0.75;

/** The floor a level stands on, over the ground floor (mirefen_tavern.ts tavernLevelY). */
function levelY(level: TavernLevel): number {
  if (level === 'pit') return -TAVERN_PIT.depth;
  if (level === 'stage') return TAVERN_STAGE.lift;
  return level === 'platform' ? TAVERN_BAR_PLATFORM.lift : 0;
}

/** The floor a piece stands on: its level's, or the terrain under it for a piece outside
 *  (mirefen_tavern.ts tavernPropBaseY). */
function floorOf(prop: TavernProp): number {
  return prop.baseY ?? levelY(prop.level);
}

interface V2 {
  x: number;
  z: number;
}

const add = (a: V2, b: V2, s = 1): V2 => ({ x: a.x + b.x * s, z: a.z + b.z * s });
const neg = (a: V2): V2 => ({ x: -a.x, z: -a.z });
const dot = (a: V2, b: V2): number => a.x * b.x + a.z * b.z;
const unit = (d: V2): V2 => {
  const l = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / l, z: d.z / l };
};
const toward = (from: V2, to: V2): V2 => unit({ x: to.x - from.x, z: to.z - from.z });
/** The sitter's right hand, turned from its forward (local +x is the right of a body
 *  facing local -z). */
const rightOf = (f: V2): V2 => ({ x: -f.z, z: f.x });

/** A prop's local axes (three.js rotation.y): its own +x and +z in the tavern's frame. */
function axes(rot: number): { ax: V2; az: V2 } {
  return {
    ax: { x: Math.cos(rot), z: -Math.sin(rot) },
    az: { x: Math.sin(rot), z: Math.cos(rot) },
  };
}

/** A local direction as a world facing (local (dx, dz) is world (dz, -dx)). */
function worldFacing(d: V2): number {
  return Math.atan2(d.z, -d.x);
}

/** The tavern's walkable air for a standing body: the hall inside its walls, the nook
 *  inside the tower, the porch between its parapets, the forecourt's cobbles before the
 *  front's stone base. */
function insideWalkable(p: V2): boolean {
  const c = STAND_CLEARANCE;
  const h = TAVERN_HALL;
  if (
    p.x > h.x0 + h.wall + c &&
    p.x < h.x1 - h.wall - c &&
    p.z > h.z0 + h.wall + c &&
    p.z < h.z1 - h.wall - c
  ) {
    return true;
  }
  const t = TAVERN_TOWER;
  if (Math.hypot(p.x - t.x, p.z - t.z) < t.rIn - c && p.z < h.z0) return true;
  const po = TAVERN_PORCH;
  if (p.x > po.x0 + 0.2 + c && p.x < po.x1 - 0.2 - c && p.z > po.z0 + c && p.z < po.z1 - 0.1) {
    return true;
  }
  // the forecourt, clear of the stone base and the porch's parapets and steps
  if (p.z > h.z1 + c && Math.abs(p.x) > po.x1 + 0.2 + c) {
    return TAVERN_FORECOURT.some((r) => p.x > r[0] && p.x < r[1] && p.z > r[2] && p.z < r[3]);
  }
  return false;
}

/** How far a point stands outside a prop's footprint (0 inside it). */
function gapTo(prop: TavernProp, p: V2): number {
  if (prop.r !== undefined) return Math.max(0, Math.hypot(p.x - prop.x, p.z - prop.z) - prop.r);
  const { ax, az } = axes(prop.rot);
  const d = { x: p.x - prop.x, z: p.z - prop.z };
  const u = Math.max(0, Math.abs(dot(d, ax)) - (prop.hw ?? 0.5));
  const v = Math.max(0, Math.abs(dot(d, az)) - (prop.hd ?? 0.5));
  return Math.hypot(u, v);
}

/** A prop's half extent along a direction (its support distance). */
function reach(prop: TavernProp, dir: V2): number {
  if (prop.r !== undefined) return prop.r;
  const { ax, az } = axes(prop.rot);
  return Math.abs(dot(dir, ax)) * (prop.hw ?? 0.5) + Math.abs(dot(dir, az)) * (prop.hd ?? 0.5);
}

/** One seat, in the local frame, before its stand spot is chosen. */
interface LocalSeat {
  id: string;
  group: string;
  kind: SeatKind;
  pose: SeatPose;
  at: V2;
  forward: V2;
  seatY: number;
  floorY: number;
  candidates: V2[];
  via?: V2;
  /** The furniture the seat is part of (its own footprint never blocks its pre-sit spot). */
  own: TavernProp;
  pick: { at: V2; rot: number; hw: number; hd: number; top: number };
}

/** Candidates in the given directions from a seat, each at a few distances and nudged
 *  sideways a little, nearest first. */
function candidatesToward(at: V2, dirs: readonly V2[], near: number): V2[] {
  const out: V2[] = [];
  for (const d of dirs) {
    const side = rightOf(d);
    for (const dist of [near, near + 0.2, near + 0.4, near + 0.7]) {
      for (const shift of [0, 0.3, -0.3, 0.6, -0.6]) out.push(add(add(at, d, dist), side, shift));
    }
  }
  return out;
}

/** A bench's or settle's depth: its half extent across its long axis. */
function depthOf(prop: TavernProp): number {
  return Math.min(prop.hw ?? 0.5, prop.hd ?? 0.5);
}

function isNookBench(prop: TavernProp): boolean {
  const t = TAVERN_TOWER;
  return prop.kind === 'bench' && Math.hypot(prop.x - t.x, prop.z - t.z) < t.rIn;
}

function seatTop(prop: TavernProp): number {
  const cushioned = prop.kind === 'bench' && (prop.level === 'pit' || isNookBench(prop));
  const cushion = cushioned ? BENCH_CUSHION : prop.kind === 'settle' ? SETTLE_CUSHION : 0;
  return floorOf(prop) + prop.height + cushion;
}

/** A bench or settle's `n` places along its long axis, `spacing` apart, facing `forward`
 *  (unit, local), each anchored just behind the seat's front edge (`front` along forward
 *  from the furniture's middle line); stand candidates in `dirs` (relative to forward:
 *  'front' | 'back'), measured from the furniture's own edges. */
function lineSeats(
  prop: TavernProp,
  group: string,
  n: number,
  spacing: number,
  forward: V2,
  kind: SeatKind,
  pose: SeatPose,
  front: number,
  dirs: readonly ('front' | 'back')[],
): LocalSeat[] {
  const { ax, az } = axes(prop.rot);
  const alongX = (prop.hw ?? 0.5) >= (prop.hd ?? 0.5);
  const long = alongX ? ax : az;
  const half = Math.max(prop.hw ?? 0.5, prop.hd ?? 0.5);
  const depth = Math.min(prop.hw ?? 0.5, prop.hd ?? 0.5);
  const floorY = floorOf(prop);
  const top = seatTop(prop);
  const out: LocalSeat[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : (i - (n - 1) / 2) * spacing;
    const mid = add({ x: prop.x, z: prop.z }, long, u);
    const at = add(mid, forward, front - SEAT_EDGE_TO_ANCHOR);
    const candidates: V2[] = [];
    for (const d of dirs) {
      candidates.push(
        ...(d === 'front'
          ? candidatesToward(mid, [forward], front + STAND_CLEARANCE)
          : candidatesToward(mid, [neg(forward)], depth + STAND_CLEARANCE)),
      );
    }
    out.push({
      id: `${group}_${i}`,
      group,
      kind,
      pose,
      at,
      forward,
      seatY: top,
      floorY,
      candidates,
      own: prop,
      pick: {
        at: mid,
        rot: prop.rot + (alongX ? 0 : Math.PI / 2),
        hw: half / n,
        hd: depth,
        top: top - floorY + (kind === 'settle' ? 1.8 : 0.35),
      },
    });
  }
  return out;
}

/** A single-place seat (a chair or a stool), facing `forward`; stands beside it first
 *  (a chair is pulled out sideways), or behind a bar stool (away from the counter). */
function oneSeat(
  prop: TavernProp,
  group: string,
  forward: V2,
  kind: SeatKind,
  pose: SeatPose,
): LocalSeat {
  const r = prop.r ?? 0.45;
  const floorY = floorOf(prop);
  const top = seatTop(prop);
  const centre = { x: prop.x, z: prop.z };
  // a chair's seat is square to its facing, a stool's round: both reach r in front
  const at = add(centre, forward, r - SEAT_EDGE_TO_ANCHOR);
  const right = rightOf(forward);
  const dirs =
    kind === 'barStool'
      ? [neg(forward), right, neg(right)]
      : [right, neg(right), neg(forward), forward];
  return {
    id: group,
    group,
    kind,
    pose,
    at,
    forward,
    seatY: top,
    floorY,
    candidates: candidatesToward(centre, dirs, r + STAND_CLEARANCE),
    own: prop,
    pick: {
      at: centre,
      rot: 0,
      hw: r,
      hd: r,
      top: top - floorY + (kind === 'chair' ? 1.4 : 0.3),
    },
  };
}

/** A booth's places (a settle facing its table across the booth): the stand spots queue
 *  out from the booth's open end on the line of the gap between settle and table, the
 *  place nearer the open end first, and each names the gap's mouth as its `via`. */
function boothEntry(prop: TavernProp, table: TavernProp, seats: LocalSeat[]): void {
  const { ax, az } = axes(prop.rot);
  const centre = { x: prop.x, z: prop.z };
  const front = (prop.hd ?? 0.45) + 0.05;
  const tableNear = dot({ x: table.x - prop.x, z: table.z - prop.z }, az) - reach(table, az);
  const gapMid = add(centre, az, (front + tableNear) / 2);
  // the open end: the settle's end toward the hall's middle
  const hallMiddle = { x: 0, z: 0 };
  const along = dot(toward(centre, hallMiddle), ax) >= 0 ? ax : neg(ax);
  const half = prop.hw ?? 1.25;
  const mouth = add(gapMid, along, half + 0.15);
  const order = seats
    .map((s, i) => ({ i, d: dot({ x: s.at.x - prop.x, z: s.at.z - prop.z }, along) }))
    .sort((a, b) => b.d - a.d);
  order.forEach(({ i }, k) => {
    const queue: V2[] = [];
    for (let q = k; q < k + 4; q++) {
      const base = add(gapMid, along, half + STAND_CLEARANCE + q * BOOTH_QUEUE);
      // straight out of the gap, else stepped aside toward the room either way
      for (const shift of [0, -0.4, 0.4, -0.8, 0.8]) queue.push(add(base, az, shift));
    }
    seats[i].candidates = [...queue, ...seats[i].candidates];
    seats[i].via = mouth;
  });
}

/** Every seat, in the local frame, in a fixed order. */
function localSeats(): LocalSeat[] {
  const out: LocalSeat[] = [];
  const pitCentre = { x: TAVERN_PIT.x, z: TAVERN_PIT.z };
  const towerCentre = { x: TAVERN_TOWER.x, z: TAVERN_TOWER.z };
  const tables = TAVERN_PROPS.filter(
    (p) => p.kind === 'table' || p.kind === 'roundTable' || p.kind === 'terraceTable',
  );
  const nearestTable = (p: V2): TavernProp =>
    tables.reduce((best, t) =>
      Math.hypot(t.x - p.x, t.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? t : best,
    );
  const counter = TAVERN_PROPS.find((p) => p.kind === 'counter' && (p.hw ?? 0) > (p.hd ?? 0));
  const n: Record<string, number> = {};
  const next = (key: string): string => {
    n[key] = (n[key] ?? -1) + 1;
    return `tavern_${key}_${n[key]}`;
  };
  for (const prop of TAVERN_PROPS) {
    const at = { x: prop.x, z: prop.z };
    if (prop.kind === 'bench' && prop.level === 'pit') {
      const f = toward(at, pitCentre);
      const d = depthOf(prop);
      out.push(...lineSeats(prop, next('hearth'), 2, 1.3, f, 'bench', 'upright', d, ['front']));
    } else if (isNookBench(prop)) {
      const f = toward(at, towerCentre);
      const d = depthOf(prop);
      out.push(...lineSeats(prop, next('nook'), 2, 1.7, f, 'bench', 'upright', d, ['front']));
    } else if (prop.kind === 'terraceBench') {
      // the terrace's benches, facing their trestle table across the cobbles; the table
      // leaves no room in front, so the body stands behind the bench and steps over it
      const table = nearestTable(at);
      const f = { x: 0, z: Math.sign(table.z - prop.z) || 1 };
      const d = depthOf(prop);
      out.push(
        ...lineSeats(prop, next('terrace'), 2, 1.3, f, 'bench', 'upright', d, ['back', 'front']),
      );
    } else if (prop.kind === 'bench' && prop.z > TAVERN_HALL.z1) {
      // the porch's bench, its back to the front wall, facing the road
      const places = Math.max(prop.hw ?? 0.5, prop.hd ?? 0.5) >= 1.1 ? 2 : 1;
      const f = { x: 0, z: 1 };
      const d = depthOf(prop);
      out.push(...lineSeats(prop, next('porch'), places, 1.2, f, 'bench', 'upright', d, ['front']));
    } else if (prop.kind === 'bench') {
      // the long table's benches, facing the table beside them
      const table = nearestTable(at);
      const f = { x: Math.sign(table.x - prop.x) || 1, z: 0 };
      const h = TAVERN_HALL;
      const againstWall = prop.x - (prop.hw ?? 0.5) < h.x0 + h.wall + 2 * STAND_CLEARANCE;
      const places = againstWall ? 2 : 3;
      const spacing = againstWall ? 1.8 : 1.3;
      const seats = lineSeats(
        prop,
        next('longbench'),
        places,
        spacing,
        f,
        'bench',
        'upright',
        depthOf(prop),
        ['back', 'front'],
      );
      if (againstWall) {
        // no room behind (the wall) or in front (the table): stand off the bench's ends
        // and come in along the gap between bench and table
        const half = Math.max(prop.hw ?? 0.5, prop.hd ?? 0.5) + STAND_CLEARANCE;
        const gap =
          (prop.hw ?? 0.35) +
          (Math.abs(table.x - prop.x) - reach(table, f) - (prop.hw ?? 0.35)) / 2;
        for (const [i, sign] of [
          [0, -1],
          [1, 1],
        ] as const) {
          const end = { x: prop.x, z: prop.z + sign * half };
          seats[i].candidates = [
            ...candidatesToward(end, [{ x: 0, z: sign }], 0),
            ...seats[i].candidates,
          ];
          seats[i].via = { x: prop.x + f.x * gap, z: prop.z + sign * (half - STAND_CLEARANCE) };
        }
      }
      out.push(...seats);
    } else if (prop.kind === 'settle') {
      const { az } = axes(prop.rot);
      const front = (prop.hd ?? 0.45) + SETTLE_BOARD_LIP;
      const spacing = (prop.hw ?? 1.5) >= 1.5 ? 1.4 : 1.1;
      const seats = lineSeats(prop, next('settle'), 2, spacing, az, 'settle', 'relaxed', front, [
        'front',
      ]);
      const table = nearestTable(at);
      if (Math.hypot(table.x - prop.x, table.z - prop.z) < 2.2) boothEntry(prop, table, seats);
      out.push(...seats);
    } else if (prop.kind === 'chair') {
      out.push(oneSeat(prop, next('chair'), toward(at, nearestTable(at)), 'chair', 'relaxed'));
    } else if (prop.kind === 'stool' && prop.level === 'platform') {
      const f = { x: 0, z: counter ? Math.sign(counter.z - prop.z) || -1 : -1 };
      out.push(oneSeat(prop, next('barstool'), f, 'barStool', 'high'));
    } else if (prop.kind === 'stool') {
      // the dice table's stools face it; the bard's stool on the stage faces the room
      const f = prop.level === 'stage' ? { x: 0, z: 1 } : toward(at, nearestTable(at));
      out.push(oneSeat(prop, next('stool'), f, 'stool', 'upright'));
    }
  }
  return out;
}

/** Each seat's stand spot: its first candidate clear of the furniture and the walls and
 *  apart from every spot already taken (a hair of slack on the spacing, so two candidates
 *  laid exactly one spacing apart both qualify). */
function chooseStandSpots(seats: LocalSeat[]): V2[] {
  const taken: V2[] = [];
  return seats.map((seat) => {
    const spot = seat.candidates.find(
      (c) =>
        insideWalkable(c) &&
        TAVERN_PROPS.every((prop) => gapTo(prop, c) >= STAND_CLEARANCE - 1e-6) &&
        taken.every((t) => Math.hypot(t.x - c.x, t.z - c.z) >= STAND_SPACING - 1e-6),
    );
    if (!spot) throw new Error(`mirefen_tavern_seats: no stand spot for ${seat.id}`);
    taken.push(spot);
    return spot;
  });
}

/** How far in front of its anchor a seat's sitter stands to sit down and after getting up:
 *  the clips' own distance where the floor in front is open, else as far as there is room
 *  before any other furniture (a booth's table, the bar's counter). */
function preSitDistance(seat: LocalSeat): number {
  for (let d = PRESIT_AUTHORED; d > PRESIT_MIN; d -= 0.01) {
    const p = add(seat.at, seat.forward, d);
    const clear = TAVERN_PROPS.every(
      (prop) => prop === seat.own || gapTo(prop, p) >= PRESIT_BODY_CLEAR,
    );
    if (clear) return Math.round(d * 100) / 100;
  }
  return PRESIT_MIN;
}

function toWorld(seat: LocalSeat, stand: V2): SeatAnchor {
  const w = tavernToWorld(seat.at.x, seat.at.z);
  const s = tavernToWorld(stand.x, stand.z);
  const p = tavernToWorld(seat.pick.at.x, seat.pick.at.z);
  const floorY = TAVERN_FLOOR_Y + seat.floorY;
  const out: SeatAnchor = {
    id: seat.id,
    group: seat.group,
    kind: seat.kind,
    pose: seat.pose,
    x: w.x,
    z: w.z,
    seatY: TAVERN_FLOOR_Y + seat.seatY,
    floorY,
    facing: worldFacing(seat.forward),
    standX: s.x,
    standZ: s.z,
    presit: preSitDistance(seat),
    pick: {
      x: p.x,
      z: p.z,
      hw: seat.pick.hw,
      hd: seat.pick.hd,
      rot: seat.pick.rot + TAVERN_YAW,
      y0: floorY,
      y1: floorY + seat.pick.top,
    },
  };
  if (seat.via) {
    const v = tavernToWorld(seat.via.x, seat.via.z);
    out.via = { x: v.x, z: v.z };
  }
  return out;
}

function buildSeats(): readonly SeatAnchor[] {
  const local = localSeats();
  const spots = chooseStandSpots(local);
  return Object.freeze(local.map((seat, i) => Object.freeze(toWorld(seat, spots[i]))));
}

/** Every seat in the tavern, in a fixed order. */
export const MIREFEN_TAVERN_SEATS: readonly SeatAnchor[] = buildSeats();
