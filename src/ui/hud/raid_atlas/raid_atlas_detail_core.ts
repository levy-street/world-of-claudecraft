// The raid atlas's fine detail as a drawing plan: what the cartographer inks
// over each room's floor so it reads as a place, not a blob. Every element is
// read from the raid's own content, never placed by hand:
//
//   - the Heart (the final room): the four quarters of the Anvil of the World
//     (smith_heart_quarters.ts: the ridges' swept law, the central ring, each
//     quarter's sector), each washed in its vein's colour; the sunken well
//     round the heart's light; the four altars and the grooves carved from each
//     altar down to the ring (the grooves follow the ridges' own sweep, offset
//     to their altar: the floor shader's law, pinned against
//     render/smith_heart/heart_vein_groove_core.ts by the tests); the
//     platform's paving courses.
//   - every room's dressing (SMITH_HEART_FIELD.props, by kind): columns,
//     colossi, cut blocks, the derrick, statues, standing stones, cairns,
//     braziers, steam vents, sunk blades, ice shelves, crystal clusters, the
//     wellspring, the Hearth's mouth, the altar-stone (an anvil), fire seams.
//   - the rooms' own records (smith_heart_layout.ts): the Pour Channel's molten
//     run and the first flame's pool (the Heat), the Frozen Lake's shorelines
//     (the Quench), the Cornice's wind channels, the Wind Bridge's arch and the
//     Islands of the Wind (the Breath), the quarry's terraces (the Hammer).
//
// Each element carries a TIER: `base` reads at the whole-page plate, `fine`
// only once a render holds enough pixels per yard (a settled zoom), so the
// page and the minimap stay legible while a close look gets richer.
//
// Instance-local yards; DOM-free, deterministic; cached per floor.

import {
  BREATH,
  BREATH_ISLES,
  CORNICE_CHANNELS,
  GREAT_HEARTH,
  HEART_ALTAR_R,
  HEART_ALTARS,
  HEART_ROOM,
  HEARTH_WELL,
  POUR_CHANNEL,
  QUENCH,
  RING,
  RING_ARC,
  SMITH_HEART_FIELD,
  type SmithHeartVein,
  WIND_BRIDGE,
} from '../../../sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterRidges,
  heartRidgeBearingDeg,
  heartRidgePoint,
  heartRoomBearingDeg,
} from '../../../sim/content/smith_heart_quarters';
import type { RaidAtlasColorRole } from './raid_atlas_palette_core';
import { type RaidAtlasFloorId, raidAtlasFloorAt } from './raid_atlas_plan_core';

const DEG = Math.PI / 180;

/** `base` draws on every render; `fine` only past `RAID_ATLAS_FINE_K`. */
export type RaidAtlasDetailTier = 'base' | 'fine';

/** Device px per yard a render needs before its `fine` detail is drawn: the
 *  Heart's whole-page plate holds it, the veins' plate and the minimap at its
 *  usual zooms do not (their fine detail waits for a sharp render). */
export const RAID_ATLAS_FINE_K = 6;

export type RaidAtlasGlyphKind =
  | 'column'
  | 'colossus'
  | 'block'
  | 'derrick'
  | 'crystal'
  | 'statue'
  | 'standingStone'
  | 'cairn'
  | 'shelter'
  | 'brazier'
  | 'vent'
  | 'blade'
  | 'iceShelf'
  | 'wellspring'
  | 'hearthMouth'
  | 'emberRock'
  | 'anvil'
  | 'fireSeam'
  | 'caveMouth'
  | 'firePool';

/** One landmark glyph. `rot` is the sim's yaw (0 = +z); `r` its footprint
 *  radius (or its reach), `hw`/`hd` a box's half extents (0 when round). */
export interface RaidAtlasGlyph {
  kind: RaidAtlasGlyphKind;
  x: number;
  z: number;
  rot: number;
  r: number;
  hw: number;
  hd: number;
  tone: RaidAtlasColorRole;
  tier: RaidAtlasDetailTier;
}

export type RaidAtlasStrokeKind =
  | 'molten'
  | 'shoreline'
  | 'windChannel'
  | 'arch'
  | 'isle'
  | 'inlay';

/** A line feature: a polyline (closed or open), its width in yards. */
export interface RaidAtlasStroke {
  kind: RaidAtlasStrokeKind;
  points: readonly [number, number][];
  closed: boolean;
  width: number;
  tone: RaidAtlasColorRole;
  tier: RaidAtlasDetailTier;
}

/** One quarter of the Anvil: its vein, its wash's colour and its outline (the
 *  ring's arc, its counter-clockwise ridge out to the rim, the rim's arc, its
 *  clockwise ridge back in). */
export interface RaidAtlasQuarter {
  vein: SmithHeartVein;
  tone: RaidAtlasColorRole;
  /** The vein's light (the altar, the groove). */
  light: RaidAtlasColorRole;
  outline: readonly [number, number][];
}

/** The final room's floor plan. */
export interface RaidAtlasHeartDetail {
  x: number;
  z: number;
  /** The central ring's outer foot (the sim's `ringR`). */
  ringR: number;
  /** The sunken well's lip inside it. */
  wellR: number;
  /** The platform's walk ends here. */
  rimR: number;
  quarters: readonly RaidAtlasQuarter[];
  /** The four ridges, ring to rim, and their half width on the walk. */
  ridges: readonly (readonly [number, number][])[];
  ridgeHalfWidth: number;
  /** Each altar's groove: carved down the walk from under its altar to the
   *  ring, cut across the ring's rim, then curling through the well to the
   *  boss's feet (one spiral arm). */
  grooves: readonly RaidAtlasGroove[];
  grooveHalfWidth: number;
  altars: readonly { vein: SmithHeartVein; x: number; z: number; rot: number; r: number }[];
  /** The paving's concentric courses (radii, yards). */
  courses: readonly number[];
}

export interface RaidAtlasGroove {
  vein: SmithHeartVein;
  walk: readonly [number, number][];
  rim: readonly [number, number][];
  well: readonly [number, number][];
}

export interface RaidAtlasFloorDetail {
  glyphs: readonly RaidAtlasGlyph[];
  strokes: readonly RaidAtlasStroke[];
  heart: RaidAtlasHeartDetail | null;
}

/** The measures the renderer owns and the atlas follows: the sunken well's
 *  lip (render/smith_heart/heart_quarters_core.ts HEART_RING_LOOK.wellR) and
 *  the grooves' curl across the ring (heart_vein_groove_core.ts: where the
 *  walk's carving meets the dais, the curl's pitch, where it ends). */
export interface RaidAtlasDetailLook {
  wellR: number;
  grooveRingR: number;
  grooveCurlDeg: number;
  grooveEndR: number;
}

/** A vein's quarter wash (`--color-raid-atlas-quarter-*`, the room's own
 *  quarter palette). */
export function quarterColorRole(vein: SmithHeartVein): RaidAtlasColorRole {
  switch (vein) {
    case 'hammer':
      return 'quarterHammer';
    case 'breath':
      return 'quarterBreath';
    case 'quench':
      return 'quarterQuench';
    default:
      return 'quarterHeat';
  }
}

function veinLight(vein: SmithHeartVein): RaidAtlasColorRole {
  switch (vein) {
    case 'hammer':
      return 'veinHammer';
    case 'breath':
      return 'veinBreath';
    case 'quench':
      return 'veinQuench';
    default:
      return 'veinHeat';
  }
}

/** A point at compass bearing `deg` (clockwise from +z) on an ellipse. */
function onEllipse(cx: number, cz: number, deg: number, rx: number, rz: number): [number, number] {
  return [cx + Math.sin(deg * DEG) * rx, cz + Math.cos(deg * DEG) * rz];
}

function ellipse(cx: number, cz: number, rx: number, rz: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(onEllipse(cx, cz, (i / n) * 360, rx, rz));
  return out;
}

/** The final room: quarters, ridges, ring, well, altars, grooves. */
function heartDetail(look: RaidAtlasDetailLook): RaidAtlasHeartDetail {
  const { ringR, rimR, ridgeHalfWidth } = HEART_QUARTERS;
  const cx = HEART_ROOM.x;
  const cz = HEART_ROOM.z;
  const at = (deg: number, r: number): [number, number] => onEllipse(cx, cz, deg, r, r);
  const STEPS = 28;
  const radii: number[] = [];
  for (let i = 0; i <= STEPS; i++) radii.push(ringR + ((rimR - ringR) * i) / STEPS);
  const ridges = [0, 1, 2, 3].map((k) =>
    radii.map((r): [number, number] => {
      const p = heartRidgePoint(k, r);
      return [p.x, p.z];
    }),
  );
  const ARC = 24;
  const quarters = HEART_QUARTER_ORDER.map((vein): RaidAtlasQuarter => {
    const [ka, kb] = heartQuarterRidges(vein);
    const outline: [number, number][] = [...ridges[ka]];
    // The rim's arc, clockwise from the ccw ridge's end to the cw ridge's.
    const rimFrom = heartRidgeBearingDeg(ka, rimR);
    for (let i = 1; i < ARC; i++) outline.push(at(rimFrom + (90 * i) / ARC, rimR));
    outline.push(...[...ridges[kb]].reverse());
    // The ring's arc back, counter-clockwise.
    const ringFrom = heartRidgeBearingDeg(kb, ringR);
    for (let i = 1; i < ARC; i++) outline.push(at(ringFrom - (90 * i) / ARC, ringR));
    return { vein, tone: quarterColorRole(vein), light: veinLight(vein), outline };
  });
  // A groove keeps the ridges' sweep, turned to its altar's bearing (its
  // bearing at r is ridge 0's plus the turn that puts it under the altar)
  // down to the dais's foot; across the ring it curls on at the pitch it met
  // the dais with (a logarithmic spiral) to the boss's feet.
  const ALTAR_R = 3;
  const grooves = HEART_ALTARS.map((a): RaidAtlasGroove => {
    const turn = heartRoomBearingDeg(a.x, a.z) - heartRidgeBearingDeg(0, HEART_ALTAR_R);
    const atDais = heartRidgeBearingDeg(0, look.grooveRingR) + turn;
    const bearing = (r: number) =>
      r >= look.grooveRingR
        ? heartRidgeBearingDeg(0, r) + turn
        : atDais - look.grooveCurlDeg * Math.log(look.grooveRingR / Math.max(r, 1e-3));
    const run = (from: number, to: number, n: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const r = from + ((to - from) * i) / n;
        out.push(at(bearing(r), r));
      }
      return out;
    };
    return {
      vein: a.vein,
      // From under the altar's centre (the stone covers its first yards).
      walk: run(HEART_ALTAR_R, ringR, STEPS),
      rim: run(ringR, look.wellR, 6),
      well: run(look.wellR, look.grooveEndR, 24),
    };
  });
  const altars = HEART_ALTARS.map((a) => {
    const prop = SMITH_HEART_FIELD.props.find((p) => p.kind === `sh_altar_${a.vein}`);
    return { vein: a.vein, x: a.x, z: a.z, rot: prop?.rot ?? 0, r: prop?.r ?? ALTAR_R };
  });
  const courses: number[] = [];
  for (let r = ringR + 6; r < rimR - 2; r += 6) courses.push(r);
  return {
    x: cx,
    z: cz,
    ringR,
    wellR: look.wellR,
    rimR,
    quarters,
    ridges,
    ridgeHalfWidth,
    grooves,
    grooveHalfWidth: 1.15,
    altars,
    courses,
  };
}

/** What a dressing kind draws as (null: nothing, or drawn elsewhere). */
function glyphOf(kind: string): {
  kind: RaidAtlasGlyphKind;
  tone: RaidAtlasColorRole;
  tier: RaidAtlasDetailTier;
  /** Reach (yards) when the record carries no footprint. */
  reach?: number;
} | null {
  switch (kind) {
    case 'sh_pit_column':
      return { kind: 'column', tone: 'rock', tier: 'base' };
    case 'sh_quarry_colossus':
      return { kind: 'colossus', tone: 'rock', tier: 'base' };
    case 'sh_quarry_block':
    case 'sh_fallen_block':
      return { kind: 'block', tone: 'rock', tier: 'base' };
    case 'sh_quarry_derrick':
      return { kind: 'derrick', tone: 'inkSoft', tier: 'fine' };
    case 'sh_geode':
      return { kind: 'crystal', tone: 'veinHammer', tier: 'fine' };
    case 'sh_crucible':
      return { kind: 'crystal', tone: 'veinHeat', tier: 'base' };
    case 'sh_rough_statue':
      return { kind: 'statue', tone: 'rock', tier: 'base' };
    case 'sh_ring_pillar':
      return { kind: 'standingStone', tone: 'gold', tier: 'base' };
    case 'sh_hammer_jamb':
      return { kind: 'standingStone', tone: 'veinHammer', tier: 'base' };
    case 'sh_storm_stone':
      return { kind: 'standingStone', tone: 'veinBreath', tier: 'base' };
    case 'sh_frost_stone':
      return { kind: 'standingStone', tone: 'veinQuench', tier: 'base' };
    case 'sh_ring_cairn':
      return { kind: 'cairn', tone: 'rock', tier: 'fine' };
    case 'sh_wind_shelter':
      return { kind: 'shelter', tone: 'rock', tier: 'base' };
    case 'sh_brazier':
      return { kind: 'brazier', tone: 'veinHeat', tier: 'base' };
    case 'sh_steam_vent':
      return { kind: 'vent', tone: 'veinQuench', tier: 'fine', reach: 2.2 };
    case 'sh_sunk_blade':
      return { kind: 'blade', tone: 'veinQuench', tier: 'base' };
    case 'sh_ice_blade':
      return { kind: 'blade', tone: 'veinQuench', tier: 'fine' };
    case 'sh_ice_shelf':
      return { kind: 'iceShelf', tone: 'veinQuench', tier: 'base', reach: 4.5 };
    case 'sh_pour_crucible':
      return { kind: 'wellspring', tone: 'veinHeat', tier: 'base' };
    case 'sh_great_hearth':
      return { kind: 'hearthMouth', tone: 'veinHeat', tier: 'base', reach: GREAT_HEARTH.halfWidth };
    case 'sh_great_bellows':
      return { kind: 'emberRock', tone: 'veinHeat', tier: 'base' };
    case 'sh_giant_anvil':
      return { kind: 'anvil', tone: 'ink', tier: 'base' };
    case 'sh_casting_channel':
      return { kind: 'fireSeam', tone: 'veinHeat', tier: 'base', reach: 7 };
    case 'sh_cleft_mouth':
      return { kind: 'caveMouth', tone: 'abyss', tier: 'base', reach: 6 };
    default:
      return null;
  }
}

function veinsStrokes(): RaidAtlasStroke[] {
  const out: RaidAtlasStroke[] = [];
  // The Ring: the processional line inlaid along its walk's middle, the long
  // way round from the west stair's foot to the east stair's.
  const inlay: [number, number][] = [];
  for (let i = 0; i <= 96; i++) {
    const deg = RING_ARC.fromDeg + ((RING_ARC.toDeg - RING_ARC.fromDeg) * i) / 96;
    inlay.push(onEllipse(RING.x, RING.z, deg, RING.R, RING.R));
  }
  out.push({ kind: 'inlay', points: inlay, closed: false, width: 1.6, tone: 'gold', tier: 'base' });
  // The Heat: the Pour Channel's molten run across the casting floor.
  out.push({
    kind: 'molten',
    points: [
      [POUR_CHANNEL.x, POUR_CHANNEL.z0],
      [POUR_CHANNEL.x, POUR_CHANNEL.z1],
    ],
    closed: false,
    width: POUR_CHANNEL.halfWidth * 2,
    tone: 'veinHeat',
    tier: 'base',
  });
  // The Quench: the Frozen Lake's shorelines, engraved inward from its edge.
  const L = QUENCH.lake;
  [2.5, 5.5, 9.5, 14.5].forEach((d, i) => {
    out.push({
      kind: 'shoreline',
      points: ellipse(L.x, L.z, L.rx - d, L.rz - d, 96),
      closed: true,
      width: 0,
      tone: 'veinQuench',
      tier: i < 2 ? 'base' : 'fine',
    });
  });
  // The Breath: each wind channel cut from the Cornice's rim into the plateau.
  const C = BREATH.cornice;
  for (const ch of CORNICE_CHANNELS) {
    // The notch's V: its two lips at the rim, its point deep in the plateau.
    out.push({
      kind: 'windChannel',
      points: [
        onEllipse(C.x, C.z, ch.deg - ch.halfDeg, C.rx - 0.5, C.rz - 0.5),
        onEllipse(C.x, C.z, ch.deg, C.rx - ch.depth, C.rz - ch.depth),
        onEllipse(C.x, C.z, ch.deg + ch.halfDeg, C.rx - 0.5, C.rz - 0.5),
      ],
      closed: false,
      width: 0,
      tone: 'veinBreath',
      tier: 'base',
    });
  }
  // The Wind Bridge: the natural arch between the second and third landings.
  out.push({
    kind: 'arch',
    points: [
      [WIND_BRIDGE.fromX, WIND_BRIDGE.fromZ],
      [WIND_BRIDGE.toX, WIND_BRIDGE.toZ],
    ],
    closed: false,
    width: WIND_BRIDGE.halfWidth * 2,
    tone: 'rock',
    tier: 'base',
  });
  // The Islands of the Wind: fight-only isles, a dashed outline over the air.
  for (const isle of BREATH_ISLES) {
    out.push({
      kind: 'isle',
      points: ellipse(isle.x, isle.z, isle.r, isle.r, 40),
      closed: true,
      width: 0,
      tone: 'veinBreath',
      tier: 'base',
    });
  }
  return out;
}

function glyphsFor(floor: RaidAtlasFloorId): RaidAtlasGlyph[] {
  const out: RaidAtlasGlyph[] = [];
  for (const p of SMITH_HEART_FIELD.props) {
    if (raidAtlasFloorAt(p.x, p.z) !== floor) continue;
    const g = glyphOf(p.kind);
    if (!g) continue;
    out.push({
      kind: g.kind,
      x: p.x,
      z: p.z,
      rot: p.rot,
      r: p.r ?? g.reach ?? Math.max(p.hw ?? 1, p.hd ?? 1),
      hw: p.hw ?? 0,
      hd: p.hd ?? 0,
      tone: g.tone,
      tier: g.tier,
    });
  }
  // The first flame's pool before the altar-stone (the Heat's arena).
  if (raidAtlasFloorAt(HEARTH_WELL.x, HEARTH_WELL.z) === floor) {
    out.push({
      kind: 'firePool',
      x: HEARTH_WELL.x,
      z: HEARTH_WELL.z,
      rot: 0,
      r: HEARTH_WELL.r,
      hw: 0,
      hd: 0,
      tone: 'veinHeat',
      tier: 'base',
    });
  }
  return out;
}

const cache = new Map<string, RaidAtlasFloorDetail>();

/** The fine detail inked over a page (built once per floor and look). */
export function raidAtlasFloorDetail(
  floor: RaidAtlasFloorId,
  look: RaidAtlasDetailLook,
): RaidAtlasFloorDetail {
  const key = `${floor}:${look.wellR}:${look.grooveRingR}:${look.grooveCurlDeg}:${look.grooveEndR}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const detail: RaidAtlasFloorDetail = {
    glyphs: glyphsFor(floor),
    strokes: floor === 'veins' ? veinsStrokes() : [],
    heart: floor === 'heart' ? heartDetail(look) : null,
  };
  cache.set(key, detail);
  return detail;
}

/** Whether a render at `k` device px per yard draws `tier` detail. */
export function raidAtlasDrawsTier(tier: RaidAtlasDetailTier, k: number): boolean {
  return tier === 'base' || k >= RAID_ATLAS_FINE_K;
}
