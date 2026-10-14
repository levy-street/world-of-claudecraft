// The Deepglass arena as an ordinary editor document.
//
// The arena is the one shipped venue built entirely in code
// (src/sim/deepglass/world.ts), so unlike the dungeons there is no layout table
// to adapt: this module reads the real `buildDeepglassWorld()` output and
// rewrites it into a MapDoc, so the map a maker opens IS the venue the game
// boots, not a hand-copied likeness that drifts the first time either side
// changes.
//
// What that conversion has to do, beyond copying fields across:
//
//   1. Placements change key. The world speaks in `PlacedAsset.path`
//      ('/models/props/streetlamp_veiled_crystal.glb'); a document speaks in
//      catalogue `assetId` ('props/streetlamp_veiled_crystal'), which is what
//      the asset browser, the thumbnailer and the collision tables index on.
//   2. The market has no document home. `WorldContent.props.stalls` is a
//      code-only structure with no MapDoc field (a doc's `propsMode` only
//      filters the BUILT-IN world's props), and the renderer's stall pass
//      dresses each stand with crates and barrels. Both become ordinary
//      placements here, which is the point: in the document every stall, crate
//      and barrel is a thing the maker can move, retint or delete.
//   3. The stadium keeps its collision. The bell, bowl, pylons and cradle are
//      renderer geometry with no colliders at all (a body outside a bout walks
//      straight through the stonework), so the pylons arrive as editable
//      `collider/box` volumes: a starting set to drag, resize or throw away,
//      and a worked example of the tool for authoring the rest.
//
// The bell and the stadium shell themselves stay renderer-owned, drawn from
// `presentationMode: 'deepglass'`. They are parametric geometry keyed off
// DEEPGLASS_RADIUS rather than any model, so they cannot become placements
// without first being baked to GLBs; the document carries the flag so the venue
// still renders around whatever the maker builds.

import { COLLIDER_ASSET_IDS } from '../sim/collider_volumes';
import { DG_MARKET_STALLS } from '../sim/content/deepglass_event';
import {
  DEEPGLASS_CENTER,
  DEEPGLASS_CRADLE_R,
  DG_GOAL_HOUSING_OFFSET,
} from '../sim/deepglass/layout';
import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../sim/deepglass/world';
import { type MapPlacement, MODEL_ASSET_ID, MODEL_PATH } from '../sim/map_doc';
import type { NpcDef, PlacedAsset, WorldContent } from '../sim/types';
import type { CustomMap } from './custom_map';
import { CUSTOM_MAP_VERSION } from './custom_map';

/**
 * A model path as the world states it into the catalogue id a document uses.
 * '/models/props/foo.glb' -> 'props/foo'. Returns null for anything outside the
 * model tree, so a stray path is dropped rather than written as a broken id the
 * asset browser cannot resolve.
 */
export function assetIdFromModelPath(path: string): string | null {
  const trimmed = path.replace(/^\/+/, '');
  if (!trimmed.startsWith('models/')) return null;
  const id = trimmed.slice('models/'.length).replace(/\.glb$/i, '');
  return id.length > 0 ? id : null;
}

/** One world placement as a document placement, preserving its collision
 *  contract: baked hitboxes for the city's buildings and walls, the
 *  hand-authored circle only where the world says it kept one. */
function placementFromWorld(asset: PlacedAsset): MapPlacement | null {
  // An inline built model (the brick wedges under the city's stairs) is the
  // Build tool's own asset id, not a GLB path.
  const assetId = asset.path === MODEL_PATH ? MODEL_ASSET_ID : assetIdFromModelPath(asset.path);
  if (!assetId) return null;
  const out: MapPlacement = {
    assetId,
    x: asset.x,
    z: asset.z,
    rotY: asset.rotY,
    scale: asset.scale,
    collide: (asset.collideRadius ?? 0) > 0,
  };
  if (asset.wallFinishes) out.wallFinishes = structuredClone(asset.wallFinishes);
  if (asset.building) out.building = { ...asset.building };
  // The full transform, not just the yaw+uniform pair: the Tideway's stair
  // modules are per-axis squashed to their ramp's grade and seated at an
  // exact height (detached + groundY), and dropping those fields here opened
  // the document with full-slope stairs half-buried in the climbs.
  if (asset.rotX !== undefined && asset.rotX !== 0) out.rotX = asset.rotX;
  if (asset.rotZ !== undefined && asset.rotZ !== 0) out.rotZ = asset.rotZ;
  if (asset.scaleX !== undefined && asset.scaleX !== 1) out.scaleX = asset.scaleX;
  if (asset.scaleY !== undefined && asset.scaleY !== 1) out.scaleY = asset.scaleY;
  if (asset.scaleZ !== undefined && asset.scaleZ !== 1) out.scaleZ = asset.scaleZ;
  if (asset.y !== undefined && asset.y !== 0) out.y = asset.y;
  if (asset.detached) {
    out.detached = true;
    out.groundY = asset.groundY ?? 0;
  }
  // The built model's mesh volumes and surface, or the document opens with an
  // empty solid where the wedge was.
  if (asset.meshes && asset.meshes.length > 0) {
    out.meshes = asset.meshes.map((m) => ({
      verts: [...m.verts],
      tris: [...m.tris],
      ...(m.ramp ? { ramp: true } : {}),
    }));
    if (asset.modelTexId !== undefined) out.modelTexId = asset.modelTexId;
    if (asset.modelTexTile !== undefined) out.modelTexTile = asset.modelTexTile;
  }
  // The explorable buildings' hearth/chandelier flames: authored on the world
  // placement, so the document keeps the light that makes an interior readable.
  if (asset.fireEffects && asset.fireEffects.length > 0) {
    out.fireEffects = asset.fireEffects.map((fx) => ({ ...fx }));
  }
  if ((asset.collideRadius ?? 0) > 0) {
    if (asset.collideCustom) {
      // A deliberately simple footprint (lamps, rails, the arena's kit ring).
      // 'basic' keeps that circle instead of letting the baked box set replace
      // it on the first edit.
      out.collisionMode = 'basic';
      out.collideRadius = asset.collideRadius;
    } else {
      // The city's buildings collide with their real silhouettes: the model's
      // baked box set, or its Collision Master override where one is authored.
      // The world's radius was only the opt-in gate, so the document says
      // 'baked' and lets the per-asset tables do their job.
      out.collisionMode = 'baked';
    }
  }
  return out;
}

/** The market: the stand itself plus the dressing the renderer's stall pass
 *  puts around it, each as its own editable placement. Mirrors the alternating
 *  stand model and the crate/barrel offsets in render/props.ts so the document
 *  opens looking like the venue rather than like a row of bare counters. */
function marketPlacements(): MapPlacement[] {
  const out: MapPlacement[] = [];
  DG_MARKET_STALLS.forEach((stall, i) => {
    const standId = i % 2 === 0 ? 'props/market_stand_1' : 'props/market_stand_2';
    out.push({
      assetId: standId,
      x: stall.x,
      z: stall.z,
      rotY: stall.rot,
      scale: 1,
      collide: true,
      name: 'Market stall',
    });
    // Dressing sits in the stand's local frame, so rotate the offsets with it.
    const cos = Math.cos(stall.rot);
    const sin = Math.sin(stall.rot);
    const dress: readonly { id: string; lx: number; lz: number; scale: number }[] = [
      { id: 'props/farmcrate_apple', lx: 1.3, lz: 1.05, scale: 1.5 },
      { id: 'props/barrel', lx: -1.35, lz: 0.85, scale: 1.15 },
    ];
    for (const d of dress) {
      out.push({
        assetId: d.id,
        x: stall.x + d.lx * cos + d.lz * sin,
        z: stall.z - d.lx * sin + d.lz * cos,
        rotY: stall.rot,
        scale: d.scale,
        collide: true,
        name: 'Stall dressing',
      });
    }
  });
  return out;
}

/** How tall the pylon collision volumes stand. The buttresses themselves climb
 *  to y 74 (render/deepglass_stadium.ts), but a collider only has to stop a
 *  body walking the terrace: a full-height box would also wall off the flight
 *  lane above the bowl. */
const PYLON_COLLIDER_HEIGHT = 12;
/** The buttress ring, mirroring buildDeepglassStadium's own loop: 16 slots at
 *  the bowl's outer wall, of which THREE are skipped where the north entrance
 *  gap opens onto the causeway. Colliding all sixteen would put an invisible
 *  wall across the way in. */
const PYLON_SLOTS = 16;
const PYLON_GAP_SLOTS: readonly number[] = [3, 4, 5];
const PYLON_RING_R = 96.4;
const PYLON_HALF_W = 1.6;

/** Editable collision for the stadium legs, which have none at all today (a
 *  body outside a bout walks straight through the stonework). Placed as
 *  ordinary `collider/box` volumes so each one can be dragged, resized or
 *  deleted in the Selection panel like any other asset, and so the maker has a
 *  worked example of the tool for the rest of the shell. */
function pylonColliders(): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (let i = 0; i < PYLON_SLOTS; i++) {
    if (PYLON_GAP_SLOTS.includes(i)) continue;
    const a = (i / PYLON_SLOTS) * Math.PI * 2;
    out.push({
      assetId: COLLIDER_ASSET_IDS.box,
      x: Math.cos(a) * PYLON_RING_R,
      z: Math.sin(a) * PYLON_RING_R,
      rotY: a,
      scale: 1,
      collide: true,
      sizeX: PYLON_HALF_W * 2,
      sizeY: PYLON_COLLIDER_HEIGHT,
      sizeZ: PYLON_HALF_W * 2,
      name: 'Pylon collision',
      hidden: true,
    });
  }
  return out;
}

/**
 * Build the editable Deepglass document from the live arena world.
 *
 * Coordinates are NOT recentred (unlike mapFromColliders, which pulls a dungeon
 * back to its own origin): the arena is already built around 0,0 and its
 * absolute coordinates are load-bearing (the arrival point, the causeway, the
 * bell radius the renderer keys off), so a shifted document would publish a
 * venue that no longer lines up with its own geometry.
 */
/**
 * The arena's OWN structure, as ordinary placements.
 *
 * render/deepglass_kit.ts draws the cradle pylons as one InstancedMesh and the
 * goal gates as two tinted clones, fast, and completely renderer-owned, so a
 * maker opening the venue in Studio saw a bell and a bowl they could look at
 * and not touch. These are the same models at the same authored transforms,
 * placed as documents' first-class citizens: selectable, movable, deletable.
 *
 * They are DUPLICATES of what the kit draws, which is deliberate and is the
 * trade this adapter has always made (the market stalls do the same). The
 * document is for editing; the venue keeps drawing its own copy until a maker
 * publishes one that does not.
 */
/** The kit's PYLON_LEAN (render/deepglass_kit.ts), restated: that module keeps
 *  it private and this adapter must not import the renderer. */
const PYLON_LEAN_EDITOR = 0.06;

function arenaKitPlacements(): MapPlacement[] {
  const out: MapPlacement[] = [];
  // Measured against the authored model, as the memory records: the editor
  // normalizes a placed asset to ~2.2yd tall at scale 1, and the pylon is
  // authored 8.7yd, so it needs ~3.95 to stand at its real height.
  const PYLON_H = 8.7;
  const pylonScale = PYLON_H / 2.2;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // The kit leans each pylon toward the bell's axis about the horizontal
    // perpendicular to its radial. A placement carries Euler rotX/rotZ, so the
    // same lean is that angle resolved onto the two horizontal axes.
    out.push({
      assetId: 'deepglass/cradle_pylon',
      name: `Cradle pylon ${i + 1}`,
      x: DEEPGLASS_CENTER.x + cos * DEEPGLASS_CRADLE_R,
      z: DEEPGLASS_CENTER.z + sin * DEEPGLASS_CRADLE_R,
      y: 0.4,
      rotY: -a,
      rotX: PYLON_LEAN_EDITOR * -sin,
      rotZ: PYLON_LEAN_EDITOR * cos,
      scale: pylonScale,
      collide: true,
      collideRadius: 1.1,
      // 'basic' or the first edit swaps this hand-authored circle for the
      // model's baked box set and the cradle ring shifts (this adapter's own
      // note, learned on the lamps).
      collisionMode: 'basic',
    });
  }
  // The two goal housings, hanging just outside the glass either side.
  const GATE_H = 9.5;
  for (const [x, rotY, label] of [
    [DEEPGLASS_CENTER.x - DG_GOAL_HOUSING_OFFSET, Math.PI, 'West'],
    [DEEPGLASS_CENTER.x + DG_GOAL_HOUSING_OFFSET, 0, 'East'],
  ] as const) {
    out.push({
      assetId: 'deepglass/goal_gate',
      name: `${label} goal gate`,
      x,
      z: DEEPGLASS_CENTER.z,
      y: DEEPGLASS_CENTER.y,
      rotY,
      scale: GATE_H / 2.2,
      collide: false,
    });
  }
  return out;
}

/**
 * Every NPC the venue and the city carry, as EDITABLE map content.
 *
 * In the code-built world these are all `dynamic: true`, registered so their
 * flags and names resolve, never surface-placed, because the sim spawns them at
 * reserved ids to keep the deepball bout's rng draw order stable. A DOCUMENT is
 * the other case entirely: `content.npcs` IS the map's authored roster, and a
 * dynamic entry there is one the editor will not show and the maker cannot
 * move. So the document gets them placed.
 */
function editableNpcs(world: WorldContent): WorldContent['npcs'] {
  const out: Record<string, NpcDef> = {};
  for (const [key, def] of Object.entries(world.npcs)) {
    const { dynamic: _dropped, ...rest } = def;
    out[key] = rest as NpcDef;
  }
  return out;
}

/** The world's own collider volumes (world.ts stadiumColliderVolumes: the
 *  causeway deck, the plaza floor, the entrance cheeks, the colonnade and
 *  cradle rings) as editable collider placements, the exact inverse of
 *  sim/collider_volumes.ts colliderVolumeFromPlacement, so a published doc
 *  collides identically to the code-built venue. */
function worldColliderPlacements(world: WorldContent): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const v of world.colliderVolumes ?? []) {
    const p: MapPlacement = {
      assetId: COLLIDER_ASSET_IDS[v.kind],
      x: v.x,
      z: v.z,
      rotY: v.rotY,
      scale: 1,
      collide: true,
      sizeX: v.sizeX,
      sizeY: v.sizeY,
      sizeZ: v.sizeZ,
      name: 'Arena collision',
      hidden: true,
    };
    if (v.kind === 'plane') {
      if (v.rotX) p.rotX = v.rotX;
      if (v.rotZ) p.rotZ = v.rotZ;
      if (v.offsetY) p.y = v.offsetY;
      if (v.detached) {
        p.detached = true;
        p.groundY = v.groundY ?? 0;
      }
    }
    out.push(p);
  }
  return out;
}

export function deepglassMap(name: string, id: string, now: number): CustomMap {
  const world: WorldContent = buildDeepglassWorld();
  const placements: MapPlacement[] = [
    ...(world.placements ?? [])
      .map(placementFromWorld)
      .filter((p): p is MapPlacement => p !== null),
    ...marketPlacements(),
    ...arenaKitPlacements(),
    ...pylonColliders(),
    ...worldColliderPlacements(world),
  ];

  const map: CustomMap = {
    version: CUSTOM_MAP_VERSION,
    meta: {
      id,
      name,
      description:
        'The deepball arena: a glass bell on a sky caldera. The bell and the ' +
        'stadium shell are drawn by the venue itself; everything else here is ' +
        'yours to move.',
      createdAt: now,
      updatedAt: now,
      seed: DEEPGLASS_MAP_ENTRY.seed,
      parentId: '',
    },
    content: {
      zones: world.zones,
      camps: world.camps,
      npcs: editableNpcs(world),
      objects: world.groundObjects,
      roads: world.roads,
    },
    terrainEdits: [...(world.terrainEdits ?? [])],
    placements,
    // The venue flag: the bell, the stadium, the marshal, the crowd and the
    // arena's pinned hour all hang off this one string.
    presentationMode: 'deepglass',
    // The arena authors its own dressing; without this the projection would
    // splice the whole built-in overworld prop set into a sky caldera.
    propsMode: 'empty',
    decorationsMode: 'empty',
    playerStart: { ...world.playerStart },
    blockers: [...(world.blockers ?? [])],
    lights: [...(world.lights ?? [])],
    pointSounds: [...(world.pointSounds ?? [])],
    grassClear: [...(world.grassClear ?? [])],
    locations: [...(world.locations ?? [])],
    waterLevel: world.waterLevel,
    worldHalfX: world.worldHalfX,
  };
  // The ground paint: the city's plazas, cobbled streets and frost lips arrive
  // as ordinary painter layers (built-in PBR swatches), fully repaintable.
  if (world.biomePaint !== undefined) {
    map.biomePaint = JSON.parse(JSON.stringify(world.biomePaint)) as typeof world.biomePaint;
  }
  if (world.skybox !== undefined) map.skybox = world.skybox;
  if (world.terrainStyle !== undefined) map.terrainStyle = world.terrainStyle;
  if (world.weather !== undefined) map.weather = world.weather;
  if (world.lighting !== undefined) map.lighting = world.lighting;
  if (world.music !== undefined) map.music = world.music;
  if (world.assetViewDistance !== undefined) map.assetViewDistance = world.assetViewDistance;
  return map;
}
