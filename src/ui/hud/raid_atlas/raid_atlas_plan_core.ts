// The raid atlas's static plan: which floors (map pages) a raid's M-map has,
// what each page frames, where its rooms, bosses and portals stand, and which
// of the field's painted surfaces belong to it. Pilot: the Smith's Heart only.
//
// Every position comes from the raid's own content (smith_heart_layout.ts and
// smith_heart.ts, the record the sim walks and the renderer draws) and every
// surface from the field's painted plan (field_map_view.ts fieldMapPlan), so
// the atlas cannot drift from the ground the raid stands on. Nothing here is
// guessed or re-authored.
//
// Coordinates are INSTANCE-LOCAL yards. The page projection mirrors the
// existing dungeon map and the minimap (+x to the LEFT, +z UP), so the atlas,
// the minimap and the old plan all agree on which way is which.
//
// DOM-free, Three-free, deterministic; cached per raid.

import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../../../sim/content/smith_heart';
import {
  BALCONY,
  BREATH,
  CLEFT,
  GALLERY_LANDINGS,
  HAMMER_PIT,
  HEART_EXIT_PORTAL,
  HEART_RETURN_PORTAL,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
  HEART_TERRACE,
  HEAT,
  inSmithHeartRoom,
  LIGHT_RIVERS,
  QUENCH,
  RING,
  SEAL_DAIS,
  SMITH_HEART_ANCHORS,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
  type SmithHeartArea,
  type SmithHeartVein,
  smithHeartAreaAt,
} from '../../../sim/content/smith_heart_layout';
import { type FieldMapPlan, fieldMapPlan } from '../../field_map_view';

/** A map page. The Smith's Heart has two, never joined by floor: the veins
 *  (the main map) and the Heart (the final room behind the seal's portal). */
export type RaidAtlasFloorId = 'veins' | 'heart';

/** A raid area: the Smith's Heart's named areas (music, fog, sky). */
export type RaidAtlasArea = SmithHeartArea;

export interface RaidAtlasBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A labelled place on a page. `boss` rooms carry a boss medallion. */
export interface RaidAtlasRoom {
  id: string;
  /** i18n key of its name (hudChrome.raidAtlas.room.*). */
  labelKey: string;
  x: number;
  z: number;
  area: RaidAtlasArea;
  /** Label weight: a boss room's name is the largest, a passage's the smallest. */
  rank: 'major' | 'minor';
}

/** One boss medallion: the encounter, where it stands, and the bodies whose
 *  deaths end it (the Hammer Council is two). */
export interface RaidAtlasBoss {
  /** Encounter id: its vein, or 'final'. */
  id: SmithHeartVein | 'final';
  /** The mob template named on the medallion. */
  mobId: string;
  /** Every body that must lie dead for the encounter to be over. */
  bodyIds: readonly string[];
  x: number;
  z: number;
  floor: RaidAtlasFloorId;
}

export type RaidAtlasPoiKind = 'entrance' | 'portal' | 'return' | 'exit';

export interface RaidAtlasPoi {
  kind: RaidAtlasPoiKind;
  x: number;
  z: number;
  floor: RaidAtlasFloorId;
}

/** A vein's light-river (the path to its guardian), for the page's art. */
export interface RaidAtlasRiver {
  vein: SmithHeartVein;
  points: readonly { x: number; z: number }[];
}

export interface RaidAtlasFloor {
  id: RaidAtlasFloorId;
  /** i18n key of the page's name (hudChrome.raidAtlas.floor.*). */
  labelKey: string;
  /** The square the page frames (instance-local yards). */
  bounds: RaidAtlasBounds;
  /** Indices into the field plan's `surfaces` drawn on this page. */
  surfaces: readonly number[];
  rooms: readonly RaidAtlasRoom[];
  rivers: readonly RaidAtlasRiver[];
}

export interface RaidAtlasPlan {
  dungeonId: string;
  field: FieldMapPlan;
  floors: readonly RaidAtlasFloor[];
  bosses: readonly RaidAtlasBoss[];
  pois: readonly RaidAtlasPoi[];
}

/** Yards of parchment kept round a page's ground. */
export const RAID_ATLAS_PAGE_MARGIN = 26;

const ROOM_KEY = 'hudChrome.raidAtlas.room';

/** Which page a point (instance-local) belongs to. */
export function raidAtlasFloorAt(x: number, z: number): RaidAtlasFloorId {
  return inSmithHeartRoom(x, z) ? 'heart' : 'veins';
}

/** Which named area holds a point (instance-local). */
export function raidAtlasAreaAt(x: number, z: number): RaidAtlasArea {
  return smithHeartAreaAt(x, z);
}

function centroid(points: readonly [number, number][]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    z += p[1];
  }
  const n = Math.max(1, points.length);
  return { x: x / n, z: z / n };
}

/** The tight box of `points`, grown by `margin` and squared about its centre
 *  (the page is a square canvas). `headroom` and `footroom` add a share of
 *  the page above (+z) and below (-z) the ground, where the title cartouche
 *  and the tool row sit, so neither ever covers a room. */
export function squareBounds(
  points: Iterable<readonly [number, number]>,
  margin: number,
  headroom = 0,
  footroom = 0,
): RaidAtlasBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const page = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
  maxZ += page * headroom;
  minZ -= page * footroom;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxZ - minZ) / 2 + margin;
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}

function room(id: string, x: number, z: number, rank: RaidAtlasRoom['rank']): RaidAtlasRoom {
  return { id, labelKey: `${ROOM_KEY}.${id}`, x, z, area: smithHeartAreaAt(x, z), rank };
}

function buildSmithHeartPlan(): RaidAtlasPlan {
  const field = fieldMapPlan(SMITH_HEART_FIELD);
  const veinsIdx: number[] = [];
  const heartIdx: number[] = [];
  field.surfaces.forEach((s, i) => {
    const c = centroid(s.points);
    (raidAtlasFloorAt(c.x, c.z) === 'heart' ? heartIdx : veinsIdx).push(i);
  });
  const pointsOf = (idx: readonly number[]) => idx.flatMap((i) => field.surfaces[i].points);

  // Room labels sit a little off their landmark so the medallion or the
  // portal mark on it stays clear (offsets in yards, page-local).
  const veinRooms: RaidAtlasRoom[] = [
    room('cleft', CLEFT.x, CLEFT.z + 22, 'minor'),
    room('gallery', GALLERY_LANDINGS.h2.x, GALLERY_LANDINGS.h2.z + 22, 'minor'),
    room('quarry', HAMMER_PIT.x, HAMMER_PIT.z - HAMMER_PIT.rz - 8, 'major'),
    room('balcony', (BALCONY.x0 + BALCONY.x1) / 2 - 30, (BALCONY.z0 + BALCONY.z1) / 2, 'minor'),
    room('ring', RING.x, RING.z - RING.outerR - 2, 'major'),
    room('dais', SEAL_DAIS.x, SEAL_DAIS.z + SEAL_DAIS.r + 9, 'minor'),
    room('cornice', BREATH.cornice.x, BREATH.cornice.z + BREATH.cornice.rz + 9, 'major'),
    room('bridge', SMITH_HEART_ANCHORS.bridge.x - 24, SMITH_HEART_ANCHORS.bridge.z, 'minor'),
    room('basin', QUENCH.lake.x, QUENCH.shelf.z - QUENCH.shelf.rz - 9, 'major'),
    room('hearth', HEAT.forge.x, HEAT.forge.z - 56, 'major'),
    room('castingFloor', (HEAT.floor.x0 + HEAT.floor.x1) / 2, HEAT.floor.z1 + 9, 'minor'),
  ];
  const heartRooms: RaidAtlasRoom[] = [
    room('anvil', HEART_ROOM.x, HEART_ROOM.z + HEART_ROOM.r + 10, 'major'),
    room('terrace', HEART_TERRACE.x - 8, HEART_TERRACE.z - HEART_TERRACE.r - 10, 'minor'),
  ];

  const rivers = SMITH_HEART_VEINS.map((vein) => ({ vein, points: LIGHT_RIVERS[vein] }));
  const veinsPoints = pointsOf(veinsIdx);
  const heartPoints: [number, number][] = [
    ...pointsOf(heartIdx),
    [HEART_ROOM.x - HEART_ROOM_CHASM_R, HEART_ROOM.z],
    [HEART_ROOM.x + HEART_ROOM_CHASM_R, HEART_ROOM.z],
    [HEART_ROOM.x, HEART_ROOM.z - HEART_ROOM_CHASM_R],
    [HEART_ROOM.x, HEART_ROOM.z + HEART_ROOM_CHASM_R],
  ];
  const floors: RaidAtlasFloor[] = [
    {
      id: 'veins',
      labelKey: 'hudChrome.raidAtlas.floor.veins',
      bounds: squareBounds(veinsPoints, RAID_ATLAS_PAGE_MARGIN, 0.15, 0.08),
      surfaces: veinsIdx,
      rooms: veinRooms,
      rivers,
    },
    {
      id: 'heart',
      labelKey: 'hudChrome.raidAtlas.floor.heart',
      bounds: squareBounds(heartPoints, RAID_ATLAS_PAGE_MARGIN * 0.5, 0.15, 0.08),
      surfaces: heartIdx,
      rooms: heartRooms,
      rivers: [],
    },
  ];

  const B = SMITH_HEART_BOSS_SPOTS;
  const bosses: RaidAtlasBoss[] = [
    {
      id: 'hammer',
      mobId: SMITH_HEART_GUARDIANS.hammer,
      bodyIds: SMITH_HEART_COUNCIL,
      ...B.hammer,
      floor: 'veins',
    },
    ...(['breath', 'quench', 'heat'] as const).map(
      (vein): RaidAtlasBoss => ({
        id: vein,
        mobId: SMITH_HEART_GUARDIANS[vein],
        bodyIds: [SMITH_HEART_GUARDIANS[vein]],
        ...B[vein],
        floor: 'veins',
      }),
    ),
    {
      id: 'final',
      mobId: SMITH_HEART_FINAL_BOSS,
      bodyIds: [SMITH_HEART_FINAL_BOSS],
      ...B.final,
      floor: 'heart',
    },
  ];
  const pois: RaidAtlasPoi[] = [
    { kind: 'entrance', ...SMITH_HEART_ANCHORS.exit, floor: 'veins' },
    { kind: 'portal', x: SEAL_DAIS.x, z: SEAL_DAIS.z, floor: 'veins' },
    { kind: 'return', x: HEART_RETURN_PORTAL.x, z: HEART_RETURN_PORTAL.z, floor: 'heart' },
    { kind: 'exit', x: HEART_EXIT_PORTAL.x, z: HEART_EXIT_PORTAL.z, floor: 'heart' },
  ];
  return { dungeonId: SMITH_HEART_DUNGEON, field, floors, bosses, pois };
}

let smithHeartPlan: RaidAtlasPlan | null = null;

/** The atlas plan for a dungeon, or null when it has no atlas (yet). */
export function raidAtlasPlanFor(dungeonId: string): RaidAtlasPlan | null {
  if (dungeonId !== SMITH_HEART_DUNGEON) return null;
  smithHeartPlan ??= buildSmithHeartPlan();
  return smithHeartPlan;
}

/** True when a dungeon draws its M-map as a raid atlas. */
export function hasRaidAtlas(dungeonId: string): boolean {
  return dungeonId === SMITH_HEART_DUNGEON;
}

export function raidAtlasFloor(plan: RaidAtlasPlan, id: RaidAtlasFloorId): RaidAtlasFloor {
  return plan.floors.find((f) => f.id === id) ?? plan.floors[0];
}
