// Calm-pad sizing for the natural-relief terrain (see terrainCalmAt in
// world.ts). A calm anchor flattens the character layers back to the exact
// legacy field over a pad (r <= rIn) and blends them back in across a skirt
// (rIn..rOut). Where the natural field diverges far from the legacy field, a
// fixed-width skirt compresses that whole divergence into a few yards: the
// pad becomes a ledge with an unwalkable rim (the Highwatch training dummy
// report). This module sizes each skirt from the MEASURED divergence, so a
// pad in gentle country keeps its classic ring bit-identical while a pad on
// a craggy mountainside earns a wide, walkable ramp.
//
// It also OWNS the calm-pad roster: every category of authored open-world
// placement (dungeon doors, portals, graveyards, mailboxes, ground objects,
// structural props, tunnel mouths, world-boss stands...) gets a pad, so a
// cave mouth or a placed structure can never end up floating over or buried
// inside the natural relief (the Thornpeak crystal cave report). New
// placement categories register HERE, in collectCalmAnchorPads;
// tests/placement_integrity.test.ts walks the roster.
//
// Everything here is a pure function of (content tables, seed) through the
// caller-supplied probe: no Math.random, no clocks, no state. Every host
// computes the same rings from the one shipped WORLD_SEED.

import { OVERWORLD_GRAVEYARDS } from './content/graveyards';
import { MAILBOXES } from './content/mailboxes';
import { MUSTER_BOARDS, NOTICEBOARDS } from './content/noticeboards';
import { TUNNELS } from './content/tunnels';
import {
  DUNGEONS,
  ESCORTS,
  GATHER_NODES,
  GROUND_OBJECTS,
  NPCS,
  PORTALS,
  PROPS,
  ZONES,
} from './data';
import { GALE_HARBOR_DECKS } from './gale_harbor';
import { REACH_DECKS } from './reach_decks';
import { BANNER_POLES, BRAZIERS, GATE, PLINTH_POS } from './vale_cup_layout';
import { WORLD_BOSSES } from './world_boss';

// The skirt's own contribution to radial slope is bounded by
// dt/dr * |H(calm 1) - H(calm 0)|, and smoothstep's peak derivative is
// 1.5/width, so width >= 1.5 * divergence / target bounds the blend term by
// the target. 0.9 leaves headroom under the walk gate
// (PLAYER_MAX_CLIMB_SLOPE, 1.5) for the underlying field's own slope.
export const CALM_SKIRT_TARGET_SLOPE = 0.9;

// A skirt never grows past this: past ~36yd of ramp the divergence is a real
// mountainside and the placement-integrity test decides whether the approach
// works, rather than the calm field flattening a whole valley to reach it.
export const CALM_SKIRT_MAX_WIDTH = 36;

// Evaluates the finished terrain height with the calm factor FORCED to an
// endpoint (world.ts binds this over terrainHeight with its probe override).
export type CalmProbe = (x: number, z: number, calm: number) => number;

// Sampling density: the character layers vary at wavelengths of ~18yd and
// up (the crag layer's smallest octave), so 4yd radial steps and 8 angles
// resolve the divergence envelope; PROBE_SAFETY on the sizing covers the
// residual between-sample undershoot. The build runs once per (content,
// seed) per process, and ~1200 pads keep it on the load path, so density is
// a real cost. Fixed forever once goldens mint against it.
const PROBE_ANGLES = 8;
const PROBE_RADIAL_STEP = 4;
const PROBE_SAFETY = 1.15;

// Past this divergence the sizing is pinned at CALM_SKIRT_MAX_WIDTH anyway,
// so the scan may stop early.
const PROBE_DIVERGENCE_CEILING =
  (CALM_SKIRT_MAX_WIDTH * CALM_SKIRT_TARGET_SLOPE) / (1.5 * PROBE_SAFETY);

/** Max |H(calm 1) - H(calm 0)| over the disc r <= radius (center plus polar
 *  rings every PROBE_RADIAL_STEP yards). The divergence a skirt ending at
 *  `radius` would have to carry. */
export function calmDivergenceAt(x: number, z: number, radius: number, probe: CalmProbe): number {
  let worst = Math.abs(probe(x, z, 1) - probe(x, z, 0));
  for (let r = PROBE_RADIAL_STEP; r <= radius; r += PROBE_RADIAL_STEP) {
    for (let i = 0; i < PROBE_ANGLES; i++) {
      const a = (i / PROBE_ANGLES) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const d = Math.abs(probe(px, pz, 1) - probe(px, pz, 0));
      if (d > worst) {
        worst = d;
        if (worst >= PROBE_DIVERGENCE_CEILING) return worst;
      }
    }
  }
  return worst;
}

// An OPTIONAL pad (a newly covered category) is dropped when the character
// layers barely diverge over its footprint: the spot already sits on
// effectively classic ground (flat country, hub plateaus), so an anchor
// there would only add churn and lookup cost. Required pads (the classic
// gather node / NPC / camp / tarn set) always keep their ring, because
// removing an existing ring would itself move minted terrain.
const CALM_PAD_SKIP_DIVERGENCE = 0.75;

/** The skirt width for a pad at (x, z): at least baseWidth (a pad whose
 *  divergence already fits keeps its classic ring bit-identical), widened to
 *  carry the measured divergence at CALM_SKIRT_TARGET_SLOPE, capped at
 *  CALM_SKIRT_MAX_WIDTH. Returns null for an optional pad whose divergence
 *  is beneath notice (see CALM_PAD_SKIP_DIVERGENCE). Fixed-point over the
 *  probe disc, since widening the skirt exposes it to farther terrain:
 *  monotone in both directions, so a few rounds settle. */
export function calmSkirtWidth(
  x: number,
  z: number,
  rIn: number,
  baseWidth: number,
  optional: boolean,
  probe: CalmProbe,
): number | null {
  let width = baseWidth;
  let d = calmDivergenceAt(x, z, rIn + width, probe);
  if (optional && d < CALM_PAD_SKIP_DIVERGENCE) return null;
  for (let round = 0; round < 4; round++) {
    const needed = (1.5 * d * PROBE_SAFETY) / CALM_SKIRT_TARGET_SLOPE;
    const next = Math.min(Math.max(baseWidth, needed), CALM_SKIRT_MAX_WIDTH);
    if (next <= width + 1) return Math.max(next, width);
    width = next;
    d = calmDivergenceAt(x, z, rIn + width, probe);
  }
  return width;
}

// ---------------------------------------------------------------------------
// The calm-pad roster. One row per authored open-world placement that needs
// classic workable ground under and around it. rIn is the pad (exact legacy
// ground), baseROut the classic skirt edge before divergence sizing.
// ---------------------------------------------------------------------------

export interface CalmPadRow {
  x: number;
  z: number;
  rIn: number;
  baseROut: number;
  // Optional pads may be dropped where divergence is beneath notice; the
  // pre-existing categories are required so their minted rings never move.
  optional: boolean;
  // For the placement-integrity test's reporting.
  category: string;
}

export function collectCalmAnchorPads(): CalmPadRow[] {
  const rows: CalmPadRow[] = [];
  const pad = (
    category: string,
    x: number,
    z: number,
    rIn: number,
    baseROut: number,
    optional = true,
  ): void => {
    rows.push({ x, z, rIn, baseROut, optional, category });
  };
  // The pre-existing anchor set (required: these rings are already minted).
  for (const node of GATHER_NODES) pad('gatherNode', node.pos.x, node.pos.z, 5, 12, false);
  for (const id in NPCS) {
    const npc = NPCS[id];
    pad('npc', npc.pos.x, npc.pos.z, 6, 14, false);
  }
  // Precision-graded landforms outside the content tables: the Glacier Tarn
  // ramp and bowl (tests/frostveil_pit_escape.test.ts walks the descent
  // under the fall-damage and climb gates, and pins the bed and the Rime
  // Elemental beach to literals).
  pad('glacierTarn', 50, 1646, 22, 34, false);
  // Dungeon doors: the walk-up entrance in the open world (the instanced
  // interior beyond DUNGEON_X_THRESHOLD is filtered by the world.ts add).
  for (const id in DUNGEONS) {
    const door = DUNGEONS[id].doorPos;
    pad('dungeonDoor', door.x, door.z, 7, 15);
  }
  // Paired overworld portals (the merged table, so every zone's passage
  // gets its two gate mounds plus their landings, each landing sitting
  // within its side's pad).
  for (const portal of PORTALS) {
    pad('portal', portal.a.x, portal.a.z, 7, 15);
    pad('portal', portal.b.x, portal.b.z, 7, 15);
  }
  // The death loop: every overworld graveyard keeps its angel's yard level.
  for (const gy of OVERWORLD_GRAVEYARDS) pad('graveyard', gy.x, gy.z, 8, 15);
  // Interaction fixtures.
  for (const box of MAILBOXES) pad('mailbox', box.x, box.z, 3.5, 9);
  for (const board of NOTICEBOARDS) pad('noticeboard', board.x, board.z, 3.5, 9);
  for (const board of MUSTER_BOARDS) pad('musterBoard', board.x, board.z, 3.5, 9);
  // Quest/collectible ground objects (every authored position).
  for (const def of GROUND_OBJECTS) {
    for (const p of def.positions) pad('groundObject', p.x, p.z, 3.5, 9);
  }
  // Hand-authored tunnel mouths: the terrain must meet the carved opening.
  for (const tunnel of TUNNELS) {
    const w = tunnel.waypoints;
    if (w.length === 0) continue;
    const mouthA = w[0];
    const mouthB = w[w.length - 1];
    pad('tunnelMouth', mouthA.x, mouthA.z, mouthA.radius + 2, mouthA.radius + 9);
    pad('tunnelMouth', mouthB.x, mouthB.z, mouthB.radius + 2, mouthB.radius + 9);
  }
  // World-boss stands: the fight needs a workable raid floor.
  for (const boss of WORLD_BOSSES) pad('worldBoss', boss.pos.x, boss.pos.z, 10, 18);
  // Escort runs: the escortee walks the authored polyline, so the whole
  // lane keeps workable ground (pads at every authored point plus samples
  // every 8yd along each leg).
  for (const id in ESCORTS) {
    const escort = ESCORTS[id];
    const line = [escort.start, ...escort.waypoints];
    for (let i = 0; i < line.length; i++) {
      pad('escortRoute', line[i].x, line[i].z, 4, 10);
      if (i + 1 < line.length) {
        const a = line[i];
        const b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (let d = 8; d < len; d += 8) {
          const t = d / len;
          pad('escortRoute', a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 4, 10);
        }
      }
    }
  }
  // Zone POIs: the Book of Deeds grants exploration marks within 20yd of
  // each point, so every POI keeps a reachable stand.
  for (const zone of ZONES) {
    for (const poi of zone.pois) pad('poi', poi.x, poi.z, 2.5, 8);
  }
  // Deck networks: every plank run is seated from its shore-root terrain
  // samples (ax/az, ax2/az2), so those roots keep classic ground.
  for (const deck of [...GALE_HARBOR_DECKS, ...REACH_DECKS]) {
    pad('deckRoot', deck.ax, deck.az, 5, 12);
    if (deck.ax2 !== undefined && deck.az2 !== undefined) {
      pad('deckRoot', deck.ax2, deck.az2, 5, 12);
    }
  }
  // Vale Cup open-world dressing outside the sowfield flat itself.
  pad('valeCup', PLINTH_POS.x, PLINTH_POS.z, 3, 8);
  pad('valeCup', GATE.x, GATE.z, 3, 8);
  for (const pole of BANNER_POLES) pad('valeCup', pole.x, pole.z, 2, 7);
  for (const brazier of BRAZIERS) pad('valeCup', brazier.x, brazier.z, 2, 7);
  // Structural props: anything with a modeled footprint a player walks up
  // to. Foliage-like dressing (marshReeds, greatTrees) and hub-internal
  // line work (fences, walls) are deliberately absent: a tree or a fence
  // rides a slope fine, and the optional-skip rule would drop the hub rows
  // anyway.
  for (const b of PROPS.buildings) {
    pad('building', b.x, b.z, Math.hypot(b.w, b.d) / 2 + 1.5, Math.hypot(b.w, b.d) / 2 + 9);
  }
  for (const well of PROPS.wells) pad('well', well.x, well.z, well.r + 2, well.r + 9);
  for (const stall of PROPS.stalls) pad('stall', stall.x, stall.z, 3, 9);
  for (const mine of PROPS.mines) pad('mine', mine.x, mine.z, 6, 13);
  for (const dock of PROPS.docks) pad('dock', dock.x, dock.z, 8, 16);
  for (const tent of PROPS.tents) pad('tent', tent.x, tent.z, 4, 10);
  for (const [cx, cz] of PROPS.crates) pad('crate', cx, cz, 2.5, 7.5);
  for (const [cx, cz] of PROPS.campfires) pad('campfire', cx, cz, 2.5, 7.5);
  for (const [cx, cz] of PROPS.mudHuts) pad('mudHut', cx, cz, 5, 11);
  for (const ring of PROPS.ruinRings) {
    pad('ruinRing', ring.x, ring.z, ring.ringR + 2, ring.ringR + 9);
  }
  for (const bench of PROPS.benches ?? []) pad('bench', bench.x, bench.z, 2.5, 7.5);
  for (const gy of PROPS.graveyards) pad('headstones', gy.x, gy.z, 8, 15);
  // rIn 8: the delve arch draws 4yd off the marker and the exit drop lands
  // 5.96yd out, so the pad must reach past both.
  for (const marker of PROPS.delveMarkers ?? []) pad('delveMarker', marker.x, marker.z, 8, 15);
  for (const decor of PROPS.decorProps ?? []) {
    // decor.r is the COLLIDER radius (absent on walk-through dressing);
    // the VISUAL footprint tracks scale, so a scale-9 landmark gets a
    // landmark-sized pad, not a crate-sized one.
    const foot = Math.max(decor.r ?? 1.5, (decor.scale ?? 1) * 1.2);
    pad('decorProp', decor.x, decor.z, foot + 2, foot + 8);
  }
  if (PROPS.raceCourse) {
    const course = PROPS.raceCourse;
    pad('raceCourse', course.arch.x, course.arch.z, 3.5, 9);
    for (const jump of course.jumps) pad('raceCourse', jump.x, jump.z, 3.5, 9);
  }
  return rows;
}
