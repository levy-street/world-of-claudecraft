// The seasonal city dressing's placement resolver: turns the declarative anchor
// rules (content/gourdlight_eve_decor.ts) into concrete pieces against the LIVE
// world, so a city rework moves the dressing with it and a new building never
// ends up with a pumpkin inside it.
//
// Every piece is anchored to something that moves with the city (a streetlamp
// from the sim's lamp plan, a trick-or-treat NPC, the event keeper and her
// stall, the town hub, the shoulders of the town's own roads) and then checked:
//   - ground pieces (pumpkins, gourds) must stand clear of every static collider
//     (`isBlocked`, the same query movement uses), off the painted road, off any
//     NPC's standing spot, out of water, and apart from each other. A candidate
//     that fails is NUDGED round a small spiral of offsets; one that never finds
//     a clear spot is dropped, never forced. Nothing lands inside the keeper's
//     stall (seasonal_decor_stall.ts, whose own footprint is checked the same way);
//   - an overhead garland strung between two lamps must clear every collider
//     along its whole run (sampled every yard), so it never cuts through a wall.
//
// Pure and deterministic: no rng (variety comes from hashing the anchor id), no
// clock, no Three. The renderer draws exactly this list; the test
// (tests/seasonal_decor_layout.test.ts) re-runs it against the shipped world and
// fails on any overlap, so the gate catches a city change that breaks it.
import { isBlocked, streetlampPlacements } from './colliders';
import { GOURDLIGHT_KEEPER_NPC, TRICK_OR_TREAT_NPC_IDS } from './content/gourdlight_eve';
import {
  GOURDLIGHT_DECOR_CITIES,
  type SeasonalCityDecorRule,
} from './content/gourdlight_eve_decor';
import { getActiveWorldContent, NPCS } from './data';
import { hash2 } from './rng';
import { resolveScarecrowField } from './seasonal/scarecrow_field';
import { insideStall, type SeasonalStall, stallLocalToWorld } from './seasonal_decor_stall';
import { type ResolvedKeeperPost, resolvedKeeperPosts } from './seasonal_keeper_posts';
import type { PlacedStreetlamp } from './streetlamp_layout';
import { STREETLAMP_COLLIDER_RADIUS, type StreetlampStyleId } from './streetlamp_style';
import { groundHeight, roadDistance, WATER_LEVEL } from './world';

export type SeasonalGroundKind =
  | 'pumpkin_lit'
  | 'pumpkin_small'
  | 'gourd'
  | 'garland_pole'
  | 'corn_shock'
  | 'hay_bale';

export type { SeasonalStall } from './seasonal_decor_stall';

export interface SeasonalGroundPiece {
  kind: SeasonalGroundKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** What it hangs off ('lamp:<i>', 'npc:<id>', 'folk:<id>', 'keeper', 'square:<zone>'). */
  anchor: string;
}

/** A paper lantern hung on a lamp post's bracket. */
export interface SeasonalLantern {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anchor: string;
}

/** An overhead leaf-and-lantern garland strung between two lamp posts, or from a
 *  lamp post across its road to a festival pole on the far side. */
export interface SeasonalGarland {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** How far the middle hangs below the straight line (yards). */
  sag: number;
  anchor: string;
}

export interface SeasonalDecorLayout {
  ground: SeasonalGroundPiece[];
  lanterns: SeasonalLantern[];
  garlands: SeasonalGarland[];
  /** The keeper's market stalls, one per city whose post takes one (her posts:
   *  seasonal_keeper_posts.ts). */
  stalls: SeasonalStall[];
}

/** Body radius a ground piece claims (the big carved pumpkin's footprint). */
export const DECOR_GROUND_RADIUS = 0.75;
/** Each kind's size against its authored model: festival pumpkins are big,
 *  grown for show, so they read at a glance beside a full-size character. */
export const DECOR_KIND_SCALE: Readonly<Record<SeasonalGroundKind, number>> = {
  pumpkin_lit: 1.9,
  pumpkin_small: 1.5,
  gourd: 1.7,
  garland_pole: 1.15,
  corn_shock: 1.0,
  hay_bale: 1.2,
};
/** A piece's own clear radius against colliders, where it is wider than the
 *  carved pumpkin's (a dressed hay bale is a long body). */
const DECOR_KIND_RADIUS: Readonly<Partial<Record<SeasonalGroundKind, number>>> = {
  hay_bale: 0.95,
};
/** The shoulder band a street piece seeks: just off the painted track. */
const STREET_BAND: readonly [number, number] = [3.5, 4.7];
/** A street piece keeps this far from a lamp (its own cluster dresses it). */
const STREET_LAMP_GAP = 4.5;
/** Room kept round the keeper's stall for everything else (yards). */
const STALL_MARGIN = 0.6;
/** A free-standing piece never leaves a squeeze between itself and a wall: a
 *  wall nearer than PASSAGE_MIN means it stands snug against it; one between
 *  that and PASSAGE_MAX would leave a gap too narrow to walk, so it is refused. */
const PASSAGE_MIN = 1.35;
const PASSAGE_MAX = 4;
const PASSAGE_RINGS: readonly number[] = [0.9, 1.35, 1.9, 2.5, 3.2, 4];
/** Pieces closer than this to an NPC's standing spot would stand in their way. */
export const DECOR_NPC_CLEARANCE = 1.3;
/** Never on the painted track: at least this far from the road centre line. */
export const DECOR_ROAD_CLEARANCE = 3.2;
/** Two ground pieces never closer than this (centre to centre). */
export const DECOR_MIN_SPACING = 1.5;
/** How far from a post's centre its shaft's surface is at lantern height, per
 *  fixture (yards): the bracket's back plate sits against the shaft, not in air.
 *  Measured off the shipped fixtures; an unlisted style takes 0.16. */
const LANTERN_POST_REACH: Readonly<Partial<Record<StreetlampStyleId, number>>> = {
  eastbrook_civic: 0.1,
  mirefen_witchflame: 0.13,
  thornpeak_beacon: 0.2,
};
/** Lantern height on its post, above the post's foot. */
export const DECOR_LANTERN_HEIGHT = 2.7;
/** Garland attach height on its posts, above each foot. */
export const DECOR_GARLAND_HEIGHT = 3.7;
/** The longest garland run strung between two posts (yards). */
export const DECOR_GARLAND_MAX_SPAN = 30;
/** A festival pole's garland attach height above its foot (the pole is a little taller). */
export const DECOR_POLE_GARLAND_HEIGHT = 3.5 * 1.15;
/** How far across its road a lamp's festival pole may stand (yards from the post). */
const POLE_REACH: readonly number[] = [8, 9, 10, 11, 12, 7, 13];
/** Which way from the post the pole is tried: across the road first, then
 *  along the roadside either way (a garland beside the road, not over it). */
const POLE_TURNS: readonly number[] = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
const GARLAND_MIN_SPAN = 6;
const GARLAND_MAX_RISE = 3;
const GARLAND_SAMPLE_STEP = 1;
const GARLAND_END_SKIP = 1.2;
/** Clearance past a post's own collider before the garland's run is sampled. */
const POST_SKIP_MARGIN = 0.45;

function postSkip(style: StreetlampStyleId): number {
  return Math.max(GARLAND_END_SKIP, STREETLAMP_COLLIDER_RADIUS[style] + POST_SKIP_MARGIN);
}

/** The nudge spiral: the anchor's own spot first, then rings out to 2.4 yd. */
const NUDGES: readonly { dx: number; dz: number }[] = (() => {
  const out = [{ dx: 0, dz: 0 }];
  for (const r of [0.4, 0.8, 1.2, 1.7, 2.4]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + r;
      out.push({ dx: Math.sin(a) * r, dz: Math.cos(a) * r });
    }
  }
  return out;
})();

function anchorHash(anchor: string, salt: number): number {
  let h = 0;
  for (let i = 0; i < anchor.length; i++) h = (h * 31 + anchor.charCodeAt(i)) | 0;
  return hash2(h, salt, 0x6f2d) / 4294967296;
}

interface Probe {
  seed: number;
  npcSpots: readonly { x: number; z: number }[];
  placed: { x: number; z: number }[];
  stalls: readonly SeasonalStall[];
}

/** Why a ground spot is refused, or null when it is clear (exported for the test). */
export function groundSpotProblem(
  seed: number,
  x: number,
  z: number,
  npcSpots: readonly { x: number; z: number }[],
  placed: readonly { x: number; z: number }[],
  stalls: readonly SeasonalStall[] = [],
  radius = DECOR_GROUND_RADIUS,
): 'collider' | 'road' | 'npc' | 'water' | 'crowded' | 'stall' | null {
  if (groundHeight(x, z, seed) < WATER_LEVEL + 0.4) return 'water';
  if (roadDistance(x, z) < DECOR_ROAD_CLEARANCE) return 'road';
  for (const n of npcSpots) if (Math.hypot(n.x - x, n.z - z) < DECOR_NPC_CLEARANCE) return 'npc';
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < DECOR_MIN_SPACING) return 'crowded';
  for (const stall of stalls) {
    if (insideStall(stall, x, z, STALL_MARGIN + radius)) return 'stall';
  }
  if (isBlocked(seed, x, z, radius)) return 'collider';
  return null;
}

/** True when a free-standing piece at (x, z) would narrow a walkway: the
 *  nearest wall round it is too far to stand snug against and too near to
 *  leave room to pass (exported for the pin). */
export function narrowsPassage(seed: number, x: number, z: number): boolean {
  let nearest = Number.POSITIVE_INFINITY;
  for (const r of PASSAGE_RINGS) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (isBlocked(seed, x + Math.sin(a) * r, z + Math.cos(a) * r, 0.2)) {
        nearest = r;
        break;
      }
    }
    if (nearest < Number.POSITIVE_INFINITY) break;
  }
  return nearest > PASSAGE_MIN && nearest < PASSAGE_MAX;
}

/** A ground piece's own collider radius (exported for the pin). */
export function decorKindRadius(kind: SeasonalGroundKind): number {
  return DECOR_KIND_RADIUS[kind] ?? DECOR_GROUND_RADIUS;
}

function seat(
  probe: Probe,
  out: SeasonalGroundPiece[],
  kind: SeasonalGroundKind,
  x: number,
  z: number,
  anchor: string,
  scale: number,
  face: number,
  freeStanding = false,
): boolean {
  for (const n of NUDGES) {
    const px = x + n.dx;
    const pz = z + n.dz;
    if (freeStanding && narrowsPassage(probe.seed, px, pz)) continue;
    const problem = groundSpotProblem(
      probe.seed,
      px,
      pz,
      probe.npcSpots,
      probe.placed,
      probe.stalls,
      decorKindRadius(kind),
    );
    if (problem !== null) continue;
    // A carved face turns toward whoever walks past (`face`), give or take a little.
    const yaw = face + (anchorHash(anchor, 1) - 0.5) * 0.6;
    const size = scale * DECOR_KIND_SCALE[kind];
    out.push({ kind, x: px, y: groundHeight(px, pz, probe.seed), z: pz, yaw, scale: size, anchor });
    probe.placed.push({ x: px, z: pz });
    return true;
  }
  return false;
}

/** The run's own posts are colliders: skip each end by its post's radius. A
 *  run never crosses the keeper's stall either (its crest stands above a
 *  garland's height). */
function garlandClear(
  seed: number,
  g: SeasonalGarland,
  skipA: number,
  skipB: number,
  stalls: readonly SeasonalStall[],
): boolean {
  const span = Math.hypot(g.bx - g.ax, g.bz - g.az);
  for (let d = skipA; d <= span - skipB; d += GARLAND_SAMPLE_STEP) {
    const t = d / span;
    const x = g.ax + (g.bx - g.ax) * t;
    const z = g.az + (g.bz - g.az) * t;
    if (isBlocked(seed, x, z, 0.2)) return false;
    for (const stall of stalls) if (insideStall(stall, x, z, STALL_MARGIN)) return false;
  }
  return true;
}

function cityDecor(
  seed: number,
  rule: SeasonalCityDecorRule,
  hub: { x: number; z: number },
  lamps: readonly PlacedStreetlamp[],
  probe: Probe,
  layout: SeasonalDecorLayout,
): void {
  const inTown = (x: number, z: number) => Math.hypot(x - hub.x, z - hub.z) <= rule.radius;
  // Lamps in town, by stable plan index (the anchor id survives a re-plan that
  // only moves posts, and a new post simply joins the list).
  const town = lamps
    .map((lamp, index) => ({ lamp, index }))
    .filter(({ lamp }) => inTown(lamp.x, lamp.z));
  for (const { lamp, index } of town) {
    const anchor = `lamp:${index}`;
    // The post's road side: roadYaw points from the post at the road. The
    // lantern hangs off the post's flank, a quarter turn from the road, so it
    // never clashes with the fixture's own arm over the track.
    const side = lamp.roadYaw + Math.PI / 2;
    const reach = LANTERN_POST_REACH[lamp.style] ?? 0.16;
    layout.lanterns.push({
      x: lamp.x + Math.sin(side) * reach,
      y: lamp.y + DECOR_LANTERN_HEIGHT,
      z: lamp.z + Math.cos(side) * reach,
      yaw: side,
      anchor,
    });
    // Gourds at the post's foot, on the side AWAY from the road.
    const back = lamp.roadYaw + Math.PI;
    const bx = lamp.x + Math.sin(back) * 1.25;
    const bz = lamp.z + Math.cos(back) * 1.25;
    seat(probe, layout.ground, 'pumpkin_lit', bx, bz, `${anchor}:a`, 1, lamp.roadYaw);
    // ...and a harvest cluster round it: a gourd pair to one side, a small carved
    // pumpkin to the other (which side each takes turns on the anchor's hash).
    const flip = anchorHash(anchor, 2) < 0.5 ? 1 : -1;
    // at some posts a hay bale stands in for the small pumpkin, and about half
    // of them get a corn shock behind the cluster, so a street of lamps is never
    // one stamp repeated
    const bale = anchorHash(anchor, 4) < 0.45;
    const slots: [string, SeasonalGroundKind, number, number, number][] = [
      ['b', 'gourd', 0.9, 1.7, 0.9],
      bale ? ['c', 'hay_bale', -0.95, 2.0, 0.9] : ['c', 'pumpkin_small', -0.85, 1.75, 0.85],
    ];
    if (anchorHash(anchor, 5) < 0.42) slots.push(['d', 'corn_shock', 0.25 * flip, 2.35, 1]);
    for (const [slot, kind, turn, reach, size] of slots) {
      const a = back + turn * flip;
      seat(
        probe,
        layout.ground,
        kind,
        lamp.x + Math.sin(a) * reach,
        lamp.z + Math.cos(a) * reach,
        `${anchor}:${slot}`,
        size,
        lamp.roadYaw,
      );
    }
  }
  // Garlands: each post strung to its nearest neighbour (once per pair), when
  // the run is a sensible street width and every yard of it is clear.
  const strung = new Set<string>();
  for (const { lamp: a, index: ia } of town) {
    let best: { lamp: (typeof town)[number]['lamp']; index: number; d: number } | null = null;
    for (const { lamp: b, index: ib } of town) {
      if (ib === ia) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < GARLAND_MIN_SPAN || d > DECOR_GARLAND_MAX_SPAN) continue;
      if (Math.abs(b.y - a.y) > GARLAND_MAX_RISE) continue;
      if (!best || d < best.d) best = { lamp: b, index: ib, d };
    }
    if (!best) continue;
    const key = ia < best.index ? `${ia}-${best.index}` : `${best.index}-${ia}`;
    if (strung.has(key)) continue;
    const g: SeasonalGarland = {
      ax: a.x,
      ay: a.y + DECOR_GARLAND_HEIGHT,
      az: a.z,
      bx: best.lamp.x,
      by: best.lamp.y + DECOR_GARLAND_HEIGHT,
      bz: best.lamp.z,
      sag: Math.min(1.6, 0.35 + best.d * 0.05),
      anchor: `garland:${key}`,
    };
    if (!garlandClear(seed, g, postSkip(a.style), postSkip(best.lamp.style), probe.stalls))
      continue;
    strung.add(key);
    layout.garlands.push(g);
  }
  // Festival poles: every town lamp not already strung to a neighbour is strung
  // ACROSS its road to a pole on the far side, so the streets read as dressed.
  for (const { lamp, index } of town) {
    if ([...strung].some((key) => key.split('-').includes(String(index)))) continue;
    let done = false;
    for (const turn of POLE_TURNS) {
      if (done) break;
      const dir = lamp.roadYaw + turn;
      for (const reach of POLE_REACH) {
        const px = lamp.x + Math.sin(dir) * reach;
        const pz = lamp.z + Math.cos(dir) * reach;
        if (groundSpotProblem(seed, px, pz, probe.npcSpots, probe.placed, probe.stalls) !== null)
          continue;
        const py = groundHeight(px, pz, seed);
        if (Math.abs(py - lamp.y) > GARLAND_MAX_RISE) continue;
        const g: SeasonalGarland = {
          ax: lamp.x,
          ay: lamp.y + DECOR_GARLAND_HEIGHT,
          az: lamp.z,
          bx: px,
          by: py + DECOR_POLE_GARLAND_HEIGHT,
          bz: pz,
          sag: 0.35 + reach * 0.05,
          anchor: `garland:lamp:${index}`,
        };
        if (!garlandClear(seed, g, postSkip(lamp.style), GARLAND_END_SKIP, probe.stalls)) continue;
        const anchor = `pole:${index}`;
        layout.ground.push({
          kind: 'garland_pole',
          x: px,
          y: py,
          z: pz,
          yaw: dir,
          scale: DECOR_KIND_SCALE.garland_pole,
          anchor,
        });
        probe.placed.push({ x: px, z: pz });
        layout.garlands.push(g);
        done = true;
        break;
      }
    }
  }
  // A lit pumpkin at every knocking door in this town: the read for "knock here".
  for (const id of [...TRICK_OR_TREAT_NPC_IDS].sort()) {
    const npc = NPCS[id];
    if (!npc || !inTown(npc.pos.x, npc.pos.z)) continue;
    const a = npc.facing + Math.PI / 2;
    seat(
      probe,
      layout.ground,
      'pumpkin_small',
      npc.pos.x + Math.sin(a) * 1.6,
      npc.pos.z + Math.cos(a) * 1.6,
      `npc:${id}`,
      1,
      npc.facing,
    );
    // ...and a corn shock on the door's other side: a knocking door is framed
    const b = npc.facing - Math.PI / 2;
    seat(
      probe,
      layout.ground,
      'corn_shock',
      npc.pos.x + Math.sin(b) * 1.7,
      npc.pos.z + Math.cos(b) * 1.7,
      `npc:${id}:shock`,
      0.95,
      npc.facing,
    );
  }
  // Every other townsfolk's stand gets a gourd pair at their side, so the whole
  // street reads dressed, not only the doors to knock on.
  const knockers = new Set<string>(TRICK_OR_TREAT_NPC_IDS);
  for (const npc of Object.values(NPCS).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (knockers.has(npc.id) || npc.id === GOURDLIGHT_KEEPER_NPC.id) continue;
    if (!inTown(npc.pos.x, npc.pos.z)) continue;
    const a = npc.facing - Math.PI / 2;
    const bale = anchorHash(npc.id, 6) < 0.3;
    seat(
      probe,
      layout.ground,
      bale ? 'hay_bale' : 'gourd',
      npc.pos.x + Math.sin(a) * 1.5,
      npc.pos.z + Math.cos(a) * 1.5,
      `folk:${npc.id}`,
      0.85,
      npc.facing,
      true,
    );
  }
  // The square: a ring round the hub, lit pumpkins between harvest pieces.
  for (let k = 0; k < rule.square.count; k++) {
    const a = (k / rule.square.count) * Math.PI * 2 + anchorHash(rule.zoneId, 3) * Math.PI;
    const kind: SeasonalGroundKind = k % 2 === 0 ? 'pumpkin_lit' : RING_HARVEST[(k >> 1) % 3];
    seat(
      probe,
      layout.ground,
      kind,
      hub.x + Math.sin(a) * rule.square.ring,
      hub.z + Math.cos(a) * rule.square.ring,
      `square:${rule.zoneId}:${k}`,
      kind === 'pumpkin_lit' ? 1.15 : 1,
      a,
    );
  }
  streetDecor(rule, hub, town, probe, layout);
}

const RING_HARVEST: readonly SeasonalGroundKind[] = ['gourd', 'corn_shock', 'hay_bale'];
const STREET_KINDS: readonly SeasonalGroundKind[] = [
  'corn_shock',
  'pumpkin_lit',
  'hay_bale',
  'gourd',
];

/** Harvest pieces along the shoulders of the town's own roads, so a street
 *  between lamps reads dressed too (the sparse-lamped towns most of all). The
 *  anchor is the road itself: candidate spots are the cells of a grid round the
 *  hub whose distance to the PAINTED track (the sim's roadDistance, meander and
 *  all) falls in the shoulder band, taken nearest the hub first, each at least
 *  the rule's spacing from the last and clear of every lamp's own cluster. */
function streetDecor(
  rule: SeasonalCityDecorRule,
  hub: { x: number; z: number },
  town: readonly { lamp: PlacedStreetlamp; index: number }[],
  probe: Probe,
  layout: SeasonalDecorLayout,
): void {
  const street = rule.street;
  if (!street) return;
  const step = 1.5;
  const cells: { x: number; z: number; d: number }[] = [];
  for (let gx = -rule.radius; gx <= rule.radius; gx += step) {
    for (let gz = -rule.radius; gz <= rule.radius; gz += step) {
      const d = Math.hypot(gx, gz);
      if (d > rule.radius) continue;
      const x = hub.x + gx;
      const z = hub.z + gz;
      const r = roadDistance(x, z);
      if (r < STREET_BAND[0] || r > STREET_BAND[1]) continue;
      cells.push({ x, z, d });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  const taken: { x: number; z: number }[] = [];
  for (const c of cells) {
    if (taken.length >= street.max) break;
    if (taken.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < street.spacing)) continue;
    if (town.some(({ lamp }) => Math.hypot(lamp.x - c.x, lamp.z - c.z) < STREET_LAMP_GAP)) continue;
    const anchor = `street:${rule.zoneId}:${Math.round(c.x)}:${Math.round(c.z)}`;
    const kind = STREET_KINDS[Math.floor(anchorHash(anchor, 7) * STREET_KINDS.length)];
    // face the road: the road distance grows away from the track
    const away = Math.atan2(
      roadDistance(c.x + 0.5, c.z) - roadDistance(c.x - 0.5, c.z),
      roadDistance(c.x, c.z + 0.5) - roadDistance(c.x, c.z - 0.5),
    );
    const face = away + Math.PI;
    if (!seat(probe, layout.ground, kind, c.x, c.z, anchor, 1, face, true)) continue;
    taken.push(c);
    // a lit pumpkin keeps each harvest piece company, on its road side
    if (kind === 'pumpkin_lit') continue;
    const side = face + (anchorHash(anchor, 8) < 0.5 ? 0.9 : -0.9);
    seat(
      probe,
      layout.ground,
      anchorHash(anchor, 9) < 0.5 ? 'pumpkin_lit' : 'pumpkin_small',
      c.x + Math.sin(side) * 1.3,
      c.z + Math.cos(side) * 1.3,
      `${anchor}:lit`,
      0.85,
      face,
      true,
    );
  }
}

/** Resolve the whole seasonal dressing for the active world at `seed`. */
export function resolveSeasonalDecor(seed: number): SeasonalDecorLayout {
  const content = getActiveWorldContent();
  const npcSpots = Object.values(NPCS).map((n) => ({ x: n.pos.x, z: n.pos.z }));
  // The keeper's stalls first: each claims its footprint before any piece is seated. Her
  // own standing spots join the NPC spots, so nothing is seated on her.
  const posts = resolvedKeeperPosts(seed);
  const stalls = posts.flatMap((p) => (p.stall ? [p.stall] : []));
  for (const p of posts) npcSpots.push({ x: p.pos.x, z: p.pos.z });
  const layout: SeasonalDecorLayout = { ground: [], lanterns: [], garlands: [], stalls };
  const probe: Probe = { seed, npcSpots, placed: [], stalls };
  const lamps = streetlampPlacements(seed);
  for (const rule of GOURDLIGHT_DECOR_CITIES) {
    const zone = content.zones.find((z) => z.id === rule.zoneId);
    if (!zone) continue;
    cityDecor(seed, rule, zone.hub, lamps, probe, layout);
  }
  scarecrowFieldDecor(seed, probe, layout);
  for (const post of posts) keeperDressing(post, probe, layout);
  return layout;
}

/** A stall's own front dressing (lit pumpkins at each end of the counter, where the
 *  customers stand), or, where her post took no stall, a pile of gourds either side
 *  of her. Anchors carry the post id, so each city's pieces stay its own. */
function keeperDressing(post: ResolvedKeeperPost, probe: Probe, layout: SeasonalDecorLayout): void {
  const id = post.post.id;
  const stall = post.stall;
  if (stall) {
    // part of the stall's own dressing, so its keep-clear margin does not apply to them
    // (every other stall's still does, and everything else does)
    const front: Probe = { ...probe, stalls: probe.stalls.filter((s) => s !== stall) };
    for (const [i, lx] of [
      [0, -2.1],
      [1, 2.2],
    ] as const) {
      const p = stallLocalToWorld(
        stall.x,
        stall.z,
        stall.yaw,
        lx * stall.scale,
        2.55 * stall.scale,
      );
      seat(front, layout.ground, 'pumpkin_lit', p.x, p.z, `keeper:${id}:${i}`, 1, stall.yaw);
    }
    return;
  }
  for (const [i, off] of [
    [0, -1.9],
    [1, 1.9],
    [2, -2.6],
    [3, 2.6],
    [4, -3.3],
  ] as const) {
    const a = post.facing + Math.PI / 2;
    const fx = Math.sin(post.facing) * -0.6;
    const fz = Math.cos(post.facing) * -0.6;
    const kind: SeasonalGroundKind =
      i === 2 || i === 4 ? 'gourd' : i === 3 ? 'pumpkin_small' : 'pumpkin_lit';
    seat(
      probe,
      layout.ground,
      kind,
      post.pos.x + Math.sin(a) * off + fx,
      post.pos.z + Math.cos(a) * off + fz,
      `keeper:${id}:${i}`,
      kind === 'pumpkin_lit' ? 1.25 : 1.1,
      post.facing,
    );
  }
}

/** Old Thatchgrin's pumpkin patch (seasonal/scarecrow_field.ts): corn shocks, hay bales and
 *  lit pumpkins ringing the fight's edge, never inside it, anchored to the field itself so
 *  they move with it. The ring is the arena's boundary as much as its dressing. */
export const SCARECROW_FIELD_RING = { inner: 13.5, outer: 16.5, count: 22 } as const;
const FIELD_KINDS: readonly SeasonalGroundKind[] = [
  'corn_shock',
  'pumpkin_lit',
  'gourd',
  'corn_shock',
  'pumpkin_small',
  'hay_bale',
];

function scarecrowFieldDecor(seed: number, probe: Probe, layout: SeasonalDecorLayout): void {
  const field = resolveScarecrowField(seed);
  if (!field) return;
  const ring = SCARECROW_FIELD_RING;
  for (let i = 0; i < ring.count; i++) {
    const anchor = `field:${i}`;
    const a = (i / ring.count) * Math.PI * 2 + (anchorHash(anchor, 2) - 0.5) * 0.18;
    const r = ring.inner + (ring.outer - ring.inner) * anchorHash(anchor, 3);
    const kind = FIELD_KINDS[i % FIELD_KINDS.length];
    // every piece faces the middle of the field, where he stands
    seat(
      probe,
      layout.ground,
      kind,
      field.x + Math.sin(a) * r,
      field.z + Math.cos(a) * r,
      anchor,
      1,
      a + Math.PI,
    );
  }
}

const layoutMemo = new WeakMap<object, Map<number, SeasonalDecorLayout>>();

/** The memoized layout per active world and seed (its colliders are fixed once built). */
export function seasonalDecorLayout(seed: number): SeasonalDecorLayout {
  const content = getActiveWorldContent();
  let bySeed = layoutMemo.get(content);
  if (!bySeed) {
    bySeed = new Map();
    layoutMemo.set(content, bySeed);
  }
  let layout = bySeed.get(seed);
  if (!layout) {
    layout = resolveSeasonalDecor(seed);
    bySeed.set(seed, layout);
  }
  return layout;
}
