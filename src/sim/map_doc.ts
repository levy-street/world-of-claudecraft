// The serializable custom-map document: the editor's save format, the JSON a
// player exports/imports, and the JSONB the server stores for saved/forked maps.
// Lives in src/sim (DOM-free, deterministic) because BOTH sides must agree on
// what a valid document is: the editor parses untrusted local files with the
// exact sanitizer the server applies to untrusted uploads. Never throws: every
// field is validated, clamped, and def-filled; an unsalvageable input returns
// null. The wire/storage shape is CustomMap v1 plus the optional v2 fields
// (waterLevel, playerStart, meta.description/parentId, stamp mode, placement
// collide + collideRadius, blockers), so every v1 document parses unchanged.

import type {
  BiomePaint,
  BlockerDef,
  CampDef,
  GroundObjectDef,
  HeightStamp,
  NpcDef,
  ZoneDef,
} from './types';
import { BIOME_BY_ID } from './world';

export const MAP_DOC_VERSION = 2;

// Hard caps applied by the sanitizer (the server stores what the sanitizer
// returns, so these bound document size and playtest cost).
export const MAX_TERRAIN_EDITS = 4000;
export const MAX_PLACEMENTS = 4000;
export const MAX_CAMPS = 600;
export const MAX_NPCS = 200;
export const MAX_OBJECTS = 400;
export const MAX_ZONES = 12;
export const MAX_ROADS = 64;
export const MAX_ROAD_POINTS = 256;
export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MIN_WATER_LEVEL = -40;
export const MAX_WATER_LEVEL = 40;
// Playtest-cost bounds for gameplay arrays: the Sim spawns camp.count mobs per
// camp and one ground object per position, so both are hard-clamped here (the
// built-in camps top out at count 14; see src/sim/content/zone*.ts).
export const MAX_CAMP_COUNT = 20;
export const MAX_CAMP_RADIUS = 100;
export const MAX_OBJECT_POSITIONS = 100;
export const MAX_ID_LENGTH = 64;
// Generous world-coordinate bound (the built-in world spans ~360yd); camp, NPC,
// and object coordinates are clamped into it so a hostile document cannot park
// gameplay content at astronomical positions.
export const MAX_WORLD_COORD = 10_000;
// Zone sub-arrays feed terrainHeight per sampled vertex (lakes) and the
// decoration generator loop bounds (zMin/zMax), so a stored map must not be
// able to carry unbounded values a viewer's tab then pays for.
export const MAX_ZONE_LAKES = 32;
export const MAX_ZONE_POIS = 64;
export const MAX_STR_ARRAY = 64;
// Per-placement collision-radius override bounds (yards). The derived
// collideRadiusFor(scale) tops out at 8; the override may go wider for big
// walk-around set pieces but stays bounded so a hostile document cannot wall
// off the world with one placement.
export const MIN_COLLIDE_RADIUS = 0.1;
export const MAX_COLLIDE_RADIUS = 30;
// Invisible blocker walls: entry cap and per-segment length bounds (yards).
// Each blocker becomes one static OBB collider at playtest, so both the count
// and the segment length are hard-clamped here.
export const MAX_BLOCKERS = 128;
export const MIN_BLOCKER_LENGTH = 0.5;
export const MAX_BLOCKER_LENGTH = 200;

// A free-form GLB placement from the asset catalogue. `collide` opts the
// placement into a sim circle collider at playtest (see collideRadiusFor).
export interface MapPlacement {
  assetId: string; // catalogue id, e.g. "props/well"
  x: number;
  z: number;
  rotY: number; // radians
  scale: number;
  collide: boolean;
  // Optional collision-radius override in yards (clamped to
  // [MIN_COLLIDE_RADIUS, MAX_COLLIDE_RADIUS]); absent = derive from scale via
  // collideRadiusFor. Only meaningful while collide is true, but stored either
  // way so toggling collide off and back on keeps the authored radius.
  collideRadius?: number;
}

export interface MapDocMeta {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  // Fork lineage (set by the server on fork; empty string = original work).
  parentId: string;
}

// The spatial content tables, mirroring the per-zone content modules. `objects`
// matches the stored-JSON key (WorldContent calls them groundObjects).
export interface MapDocContent {
  zones: ZoneDef[];
  camps: CampDef[];
  npcs: Record<string, NpcDef>;
  objects: GroundObjectDef[];
  roads: { x: number; z: number }[][];
}

export interface MapDoc {
  version: number;
  meta: MapDocMeta;
  content: MapDocContent;
  terrainEdits: HeightStamp[];
  placements: MapPlacement[];
  biomePaint?: BiomePaint;
  // v2: invisible blocker walls (collision-only segments); absent = none.
  blockers?: BlockerDef[];
  // v2: map-wide water surface height; absent = the built-in WATER_LEVEL.
  waterLevel?: number;
  // v2: where playtest drops the player; absent = the built-in start.
  playerStart?: { x: number; z: number };
}

// Placed assets are normalized to ~2.2yd max dimension at scale 1 by the
// renderer (src/render/placed_assets.ts TARGET_HEIGHT), so a colliding
// placement gets a footprint radius proportional to its scale. Pure data in the
// document pipeline: the sim never opens the GLB.
export function collideRadiusFor(scale: number): number {
  return Math.max(0.3, Math.min(8, 0.8 * scale));
}

export function serializeMapDoc(doc: MapDoc): string {
  return JSON.stringify(doc, null, 2);
}

const DEFAULT_SEED = 20061; // the game's fixed world seed (src/main.ts WORLD_SEED)

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
// Every accepted number must pass this (never bare `typeof === 'number'`):
// JSON.parse turns 1e999 into Infinity, which JSON.stringify then stores as
// null in JSONB, making the stored document unloadable forever.
function finiteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function coord(v: number): number {
  return clamp(v, -MAX_WORLD_COORD, MAX_WORLD_COORD);
}
function idStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH ? v : null;
}
function strArray(v: unknown): string[] {
  return arr(v)
    .filter((s): s is string => typeof s === 'string')
    .slice(0, MAX_STR_ARRAY)
    .map((s) => s.slice(0, MAX_ID_LENGTH));
}

function sanitizeStamp(v: unknown): HeightStamp | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.x !== 'number' || typeof s.z !== 'number') return null;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) return null;
  const radius = num(s.radius, 0);
  if (radius <= 0) return null;
  const stamp: HeightStamp = {
    x: s.x,
    z: s.z,
    radius: clamp(radius, 0.1, 200),
    delta: clamp(num(s.delta, 0), -200, 200),
    falloff: s.falloff === 'flat' ? 'flat' : 'smooth',
  };
  if (s.mode === 'level') stamp.mode = 'level';
  return stamp;
}

function sanitizePlacement(v: unknown): MapPlacement | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.assetId !== 'string' || p.assetId.length > 128) return null;
  if (typeof p.x !== 'number' || typeof p.z !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  const out: MapPlacement = {
    assetId: p.assetId,
    x: p.x,
    z: p.z,
    rotY: num(p.rotY, 0),
    scale: clamp(num(p.scale, 1) || 1, 0.05, 40),
    collide: p.collide === true,
  };
  // Optional radius override: accepted only finite, always clamped. Kept even
  // while collide is false (cheap, and it survives a collide re-toggle).
  if (finiteNum(p.collideRadius)) {
    out.collideRadius = clamp(p.collideRadius, MIN_COLLIDE_RADIUS, MAX_COLLIDE_RADIUS);
  }
  return out;
}

/**
 * Clamp a blocker segment's length: null when shorter than MIN_BLOCKER_LENGTH
 * (too small to author deliberately), far end truncated toward the anchor when
 * longer than MAX_BLOCKER_LENGTH. Shared by the sanitizer and the editor's
 * live drag preview so what you see while drawing is what gets stored.
 */
export function clampBlockerSegment(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): BlockerDef | null {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < MIN_BLOCKER_LENGTH) return null;
  // The epsilon keeps the truncation idempotent: hypot rounding can leave a
  // truncated segment ~1 ulp over the cap, and re-sanitizing the stored bytes
  // must not produce a new byte-different (spuriously dirty) document.
  if (len > MAX_BLOCKER_LENGTH + 1e-6) {
    const k = MAX_BLOCKER_LENGTH / len;
    return { x1, z1, x2: x1 + dx * k, z2: z1 + dz * k };
  }
  return { x1, z1, x2, z2 };
}

// A blocker wall must have four finite coordinates; they are clamped into the
// world bound BEFORE the length rules, so a truncated far end (interpolated
// between two in-bound points) stays in bounds too.
function sanitizeBlocker(v: unknown): BlockerDef | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (!finiteNum(b.x1) || !finiteNum(b.z1) || !finiteNum(b.x2) || !finiteNum(b.z2)) return null;
  return clampBlockerSegment(coord(b.x1), coord(b.z1), coord(b.x2), coord(b.z2));
}

// Validate a biome paint grid: ids length must match cols*rows and cell must be
// positive, else the grid is dropped. Unknown biome ids become 255 (unpainted),
// so a document from a future build degrades instead of breaking.
function sanitizeBiomePaint(v: unknown): BiomePaint | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Record<string, unknown>;
  const cols = num(b.cols, 0);
  const rows = num(b.rows, 0);
  const cell = num(b.cell, 0);
  if (cols <= 0 || rows <= 0 || cell <= 0) return undefined;
  if (cols * rows > 1_000_000) return undefined;
  if (!Array.isArray(b.ids) || b.ids.length !== cols * rows) return undefined;
  const idCount = BIOME_BY_ID.length;
  const ids = b.ids.map((n) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < idCount ? n : 255,
  );
  return { cell, cols, rows, originX: num(b.originX, 0), originZ: num(b.originZ, 0), ids };
}

function sanitizeMeta(v: unknown): MapDocMeta {
  const m = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const created = num(m.createdAt, 0);
  return {
    id: str(m.id, '').slice(0, 64),
    name: str(m.name, 'Untitled Map').slice(0, MAX_NAME_LENGTH),
    description: str(m.description, '').slice(0, MAX_DESCRIPTION_LENGTH),
    createdAt: created,
    updatedAt: num(m.updatedAt, created),
    seed: Math.floor(num(m.seed, DEFAULT_SEED)),
    parentId: str(m.parentId, '').slice(0, 64),
  };
}

// The Sim spawns camp.count mobs inside camp.radius, so every field is
// validated and clamped; a malformed camp is dropped, never thrown on.
function sanitizeCamp(v: unknown): CampDef | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const mobId = idStr(c.mobId);
  if (!mobId) return null;
  const center = c.center as Record<string, unknown> | null | undefined;
  if (!center || typeof center !== 'object') return null;
  if (!finiteNum(center.x) || !finiteNum(center.z)) return null;
  return {
    mobId,
    center: { x: coord(center.x), z: coord(center.z) },
    radius: clamp(num(c.radius, 5), 0.5, MAX_CAMP_RADIUS),
    count: clamp(Math.floor(num(c.count, 1)), 1, MAX_CAMP_COUNT),
  };
}

// NPC ids are validated for shape only (the engine tolerates an unknown quest
// or vendor item id; it just renders nothing for it).
function sanitizeNpc(v: unknown): NpcDef | null {
  if (!v || typeof v !== 'object') return null;
  const n = v as Record<string, unknown>;
  const id = idStr(n.id);
  if (!id) return null;
  const pos = n.pos as Record<string, unknown> | null | undefined;
  if (!pos || typeof pos !== 'object') return null;
  if (!finiteNum(pos.x) || !finiteNum(pos.z)) return null;
  const npc: NpcDef = {
    id,
    name: str(n.name, 'Villager').slice(0, MAX_NAME_LENGTH),
    title: str(n.title, '').slice(0, MAX_NAME_LENGTH),
    pos: { x: coord(pos.x), z: coord(pos.z) },
    facing: num(n.facing, 0),
    color: Math.floor(clamp(num(n.color, 0xffffff), 0, 0xffffff)),
    questIds: strArray(n.questIds),
    greeting: str(n.greeting, '').slice(0, MAX_DESCRIPTION_LENGTH),
  };
  if (Array.isArray(n.vendorItems)) npc.vendorItems = strArray(n.vendorItems);
  if (n.market === true) npc.market = true;
  if (n.dynamic === true) npc.dynamic = true;
  return npc;
}

// Each position spawns one ground-object entity, so the list is bounded and
// every point must be a finite, in-bounds coordinate.
function sanitizeGroundObject(v: unknown): GroundObjectDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const itemId = idStr(o.itemId);
  if (!itemId) return null;
  const positions: { x: number; z: number }[] = [];
  for (const p of arr(o.positions).slice(0, MAX_OBJECT_POSITIONS)) {
    const pt = p as Record<string, unknown> | null;
    if (pt && typeof pt === 'object' && finiteNum(pt.x) && finiteNum(pt.z)) {
      positions.push({ x: coord(pt.x), z: coord(pt.z) });
    }
  }
  return { itemId, name: str(o.name, '').slice(0, MAX_NAME_LENGTH), positions };
}

// A zone must at least have a finite z-band and a hub to shape terrain.
function zoneIsUsable(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const z = v as Record<string, unknown>;
  const hub = z.hub as Record<string, unknown> | undefined;
  return finiteNum(z.zMin) && finiteNum(z.zMax) && !!hub && finiteNum(hub.x) && finiteNum(hub.z);
}

// Def-fill the nested zone sub-fields the terrain function and the editor
// model iterate (lakes/pois arrays, hub radius/name, a valid biome), keeping
// the never-throws contract: a minimal-but-usable zone loads instead of
// crashing a viewer's editor tab. Mutates the zone object in place (it was
// freshly JSON.parsed; nothing else holds a reference).
function fillZoneDefaults(v: unknown): ZoneDef {
  const z = v as Record<string, unknown>;
  if (typeof z.id !== 'string') z.id = 'zone';
  if (typeof z.name !== 'string') z.name = 'Zone';
  // The z-band drives the decoration generator's loop bounds and the world
  // extents: clamp its magnitude or a stored map can make a viewer's tab
  // iterate an effectively unbounded grid.
  z.zMin = coord(z.zMin as number);
  z.zMax = coord(z.zMax as number);
  // Lakes and POIs feed the terrain function and the editor overlay directly:
  // drop any entry whose numbers are not finite, clamp the survivors, and cap
  // the counts (lakes multiply per-vertex terrain cost).
  z.lakes = arr(z.lakes)
    .filter((l) => {
      const lake = l as Record<string, unknown> | null;
      return (
        !!lake &&
        typeof lake === 'object' &&
        finiteNum(lake.x) &&
        finiteNum(lake.z) &&
        finiteNum(lake.radius)
      );
    })
    .slice(0, MAX_ZONE_LAKES)
    .map((l) => {
      const lake = l as Record<string, unknown>;
      lake.x = coord(lake.x as number);
      lake.z = coord(lake.z as number);
      lake.radius = clamp(lake.radius as number, 0.5, 200);
      return lake;
    });
  z.pois = arr(z.pois)
    .filter((p) => {
      const poi = p as Record<string, unknown> | null;
      return !!poi && typeof poi === 'object' && finiteNum(poi.x) && finiteNum(poi.z);
    })
    .slice(0, MAX_ZONE_POIS)
    .map((p) => {
      const poi = p as Record<string, unknown>;
      poi.x = coord(poi.x as number);
      poi.z = coord(poi.z as number);
      return poi;
    });
  if (typeof z.welcome !== 'string') z.welcome = '';
  if (typeof z.biome !== 'string' || !BIOME_BY_ID.includes(z.biome as ZoneDef['biome'])) {
    z.biome = 'vale';
  }
  const lr = z.levelRange as unknown[] | undefined;
  if (!Array.isArray(lr) || !finiteNum(lr[0]) || !finiteNum(lr[1])) z.levelRange = [1, 10];
  else z.levelRange = [clamp(Math.floor(lr[0]), 1, 60), clamp(Math.floor(lr[1]), 1, 60)];
  const hub = z.hub as Record<string, unknown>;
  hub.x = coord(hub.x as number);
  hub.z = coord(hub.z as number);
  if (!finiteNum(hub.radius)) hub.radius = 20;
  else hub.radius = clamp(hub.radius, 1, 200);
  if (typeof hub.name !== 'string') hub.name = '';
  const gy = z.graveyard as Record<string, unknown> | undefined;
  if (!gy || !finiteNum(gy.x) || !finiteNum(gy.z)) {
    z.graveyard = { x: hub.x, z: hub.z };
  } else {
    gy.x = coord(gy.x as number);
    gy.z = coord(gy.z as number);
  }
  return z as unknown as ZoneDef;
}

function sanitizeRoads(v: unknown): { x: number; z: number }[][] {
  const roads: { x: number; z: number }[][] = [];
  for (const road of arr(v).slice(0, MAX_ROADS)) {
    if (!Array.isArray(road)) continue;
    const pts: { x: number; z: number }[] = [];
    for (const p of road.slice(0, MAX_ROAD_POINTS)) {
      const pt = p as Record<string, unknown> | null;
      if (pt && finiteNum(pt.x) && finiteNum(pt.z)) {
        pts.push({ x: pt.x, z: pt.z });
      }
    }
    if (pts.length >= 2) roads.push(pts);
  }
  return roads;
}

// Parse anything (JSON string or already-parsed object, trusted or not) into a
// MapDoc, or null if it cannot be salvaged (no usable zones). Server routes and
// the editor's import path both call THIS; there is no other validation layer.
export function sanitizeMapDoc(raw: unknown): MapDoc | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const content = (o.content && typeof o.content === 'object' ? o.content : {}) as Record<
    string,
    unknown
  >;
  const zones = arr(content.zones).filter(zoneIsUsable).slice(0, MAX_ZONES).map(fillZoneDefaults);
  if (zones.length === 0) return null; // nothing to render/play
  const npcsRaw = content.npcs && typeof content.npcs === 'object' ? (content.npcs as object) : {};
  const npcs: Record<string, NpcDef> = {};
  for (const [key, value] of Object.entries(npcsRaw).slice(0, MAX_NPCS)) {
    const npc = sanitizeNpc(value);
    if (npc) npcs[key.slice(0, MAX_ID_LENGTH)] = npc;
  }
  const doc: MapDoc = {
    // The sanitizer always produces v2 semantics, so the stored version is
    // always 2 (never a client-supplied value round-tripped verbatim).
    version: MAP_DOC_VERSION,
    meta: sanitizeMeta(o.meta),
    content: {
      // Zones keep their full shape beyond the load-bearing fields gated
      // above; camps/npcs/objects are rebuilt field by field (the Sim spawn
      // loop trusts every number in them).
      zones,
      camps: arr(content.camps)
        .slice(0, MAX_CAMPS)
        .map(sanitizeCamp)
        .filter((c): c is CampDef => c !== null),
      npcs,
      objects: arr(content.objects)
        .slice(0, MAX_OBJECTS)
        .map(sanitizeGroundObject)
        .filter((g): g is GroundObjectDef => g !== null),
      roads: sanitizeRoads(content.roads),
    },
    terrainEdits: arr(o.terrainEdits)
      .slice(0, MAX_TERRAIN_EDITS)
      .map(sanitizeStamp)
      .filter((s): s is HeightStamp => s !== null),
    placements: arr(o.placements)
      .slice(0, MAX_PLACEMENTS)
      .map(sanitizePlacement)
      .filter((p): p is MapPlacement => p !== null),
    biomePaint: sanitizeBiomePaint(o.biomePaint),
  };
  const blockers = arr(o.blockers)
    .slice(0, MAX_BLOCKERS)
    .map(sanitizeBlocker)
    .filter((b): b is BlockerDef => b !== null);
  if (blockers.length > 0) doc.blockers = blockers;
  if (finiteNum(o.waterLevel)) {
    doc.waterLevel = clamp(o.waterLevel, MIN_WATER_LEVEL, MAX_WATER_LEVEL);
  }
  const ps = o.playerStart as Record<string, unknown> | undefined;
  if (ps && typeof ps === 'object' && finiteNum(ps.x) && finiteNum(ps.z)) {
    doc.playerStart = { x: ps.x, z: ps.z };
  }
  return doc;
}
