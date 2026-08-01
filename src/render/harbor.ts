// The harbor builder (docs/prd/last-bell-harbor.md H1): assembles each
// authored harbor (src/sim/harbor_layout.ts) into world geometry: long
// muted-driftwood plank decks (procedural boards, merged per tone into a
// handful of draw calls), pilings and skirt beams, post-and-cap railings
// over the exact collider segments, planked gangway ramps with cleats over
// the exact walkable ramp surfaces (the same ramps the sim walks, including
// the gangplank onto the ship), lamp/crate/barrel/bollard dressing, and the
// generated ferry ship GLB moored at the berth with its keel sunk draft
// yards below the sea surface. The procedural ship factory emits both the
// GLB and the generated walkable plan, so what you see is what you stand on.
//
// House style follows last_bell_fixtures.ts / mailbox.ts: deterministic (the
// authored layout drives everything, never Math.random), materials go through
// surfaceMat() for dedup, glow layers are cheap additive basics (no lights),
// and the whole group is static (the renderer freezes matrices after add).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAST_BELL_PROP_PATH_SEGMENTS } from '../sim/content/last_bell_cinematics';
import { getActiveWorldContent } from '../sim/data';
import { GRAND_FERRY_SHIP_PLAN } from '../sim/grand_ferry_ship_plan.generated';
import {
  HARBOR_RAIL_HEIGHT,
  type HarborDeck,
  type HarborDef,
  type HarborRail,
  type HarborRamp,
  harborShipParkedPose,
  harborSurfaceHeight,
} from '../sim/harbor_layout';
import type { Entity, SceneAttachFrame } from '../sim/types';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { type AnimState, type CharacterVisual, createCharacterVisual } from './characters';
import { GFX, surfaceMat } from './gfx';
import {
  type HarborDeckRiderResolution,
  harborDeckRiderMidInteraction,
  missingDeckRiderWarning,
  resolveHarborDeckRider,
} from './harbor_deck_rider_core';
import {
  type DeckStandInAttachPoint,
  deckStandInParentTransform,
  disposeDeckStandIn,
} from './harbor_deck_stand_in_core';
import { composeHarborShipAttachFrame } from './harbor_ship_attach_core';
import { HarborShipCueRegistry } from './harbor_ship_cue_registry';
import { firstHarborHullColliderOverlap } from './harbor_ship_tripwire_core';
import { createHarborShipUpdater } from './harbor_ship_update_core';
import { type PropPathSample, type PropPathSegment, propPathPoseAt } from './prop_path_core';
import { type PropAsset, propAsset } from './props';
import { radialGlowTexture } from './textures';

const BOARD_PITCH = 0.38; // plank width + seam
const BOARD_THICK = 0.12;
const BOARD_MAX_LEN = 5.2; // staggered joint length
const PILE_RADIUS = 0.26;
const PILE_MAX_DROP = 8; // pilings vanish into the deep; no need to reach -13.5
const CLEAT_PITCH = 0.75; // grip strips down a gangway ramp

// Muted driftwood tones; the deck alternates the three, trim runs darker.
const BOARD_TONES = [0x8a795e, 0x7c6b52, 0x93826b] as const;
const TRIM_TONE = 0x5d4e3c;
const POST_TONE = 0x63533f;

function woodMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.85,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

// Additive lamp halo, module-singleton like last_bell_fixtures.ts.
let haloTexCached: THREE.Texture | null = null;
let lampHaloMat: THREE.MeshBasicMaterial | null = null;
function haloMat(): THREE.MeshBasicMaterial {
  if (!haloTexCached) haloTexCached = radialGlowTexture();
  if (!lampHaloMat) {
    lampHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      map: haloTexCached,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return lampHaloMat;
}

// World-baked box geometries collected per tone, merged into one mesh per
// tone at flush time: a whole harbor's woodwork lands in a handful of draw
// calls instead of hundreds.
class WoodBuckets {
  private buckets = new Map<number, THREE.BufferGeometry[]>();

  box(
    tone: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    rotX = 0,
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rotX) geo.rotateX(rotX);
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    const list = this.buckets.get(tone) ?? [];
    list.push(geo);
    this.buckets.set(tone, list);
  }

  cylinder(
    tone: number,
    rTop: number,
    rBot: number,
    h: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, 6);
    geo.translate(x, y, z);
    const list = this.buckets.get(tone) ?? [];
    list.push(geo);
    this.buckets.set(tone, list);
  }

  flush(parent: THREE.Group): void {
    for (const [tone, geos] of this.buckets) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, woodMat(tone));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

function addAsset(
  parent: THREE.Object3D,
  asset: PropAsset,
  opts: { x?: number; y?: number; z?: number; rot?: number; scale?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  for (const part of asset.parts) {
    const mesh = new THREE.Mesh(part.geo, part.mat);
    mesh.castShadow = true;
    g.add(mesh);
  }
  g.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  if (opts.rot) g.rotation.y = opts.rot;
  if (opts.scale !== undefined) g.scale.setScalar(opts.scale);
  parent.add(g);
  return g;
}

// One deck rect: long boards laid across the SHORT axis (so they run along
// the deck's length), staggered joints, alternating tones; a darker skirt
// beam around the rim and pilings down into the water.
function buildDeck(wood: WoodBuckets, deck: HarborDeck, seed: number): void {
  const alongX = deck.hw >= deck.hd; // boards run along the longer axis
  const runHalf = alongX ? deck.hw : deck.hd;
  const acrossHalf = alongX ? deck.hd : deck.hw;
  const rows = Math.max(1, Math.round((acrossHalf * 2) / BOARD_PITCH));
  const rowPitch = (acrossHalf * 2) / rows;
  for (let r = 0; r < rows; r++) {
    const across = -acrossHalf + rowPitch * (r + 0.5);
    const stagger = (r % 3) * (BOARD_MAX_LEN / 3);
    for (let start = -runHalf - stagger; start < runHalf; start += BOARD_MAX_LEN) {
      const s = Math.max(start, -runHalf);
      const e = Math.min(start + BOARD_MAX_LEN - 0.06, runHalf);
      if (e - s < 0.3) continue;
      const mid = (s + e) / 2;
      const tone = BOARD_TONES[(r + Math.round((start + runHalf) / BOARD_MAX_LEN)) % 3];
      const bx = deck.x + (alongX ? mid : across);
      const bz = deck.z + (alongX ? across : mid);
      wood.box(
        tone,
        alongX ? e - s : rowPitch - 0.04,
        BOARD_THICK,
        alongX ? rowPitch - 0.04 : e - s,
        bx,
        deck.y - BOARD_THICK / 2,
        bz,
      );
    }
  }
  // skirt beams under the deck rim
  const skirtY = deck.y - BOARD_THICK - 0.14;
  wood.box(TRIM_TONE, deck.hw * 2 + 0.2, 0.3, 0.24, deck.x, skirtY, deck.z - deck.hd);
  wood.box(TRIM_TONE, deck.hw * 2 + 0.2, 0.3, 0.24, deck.x, skirtY, deck.z + deck.hd);
  wood.box(TRIM_TONE, 0.24, 0.3, deck.hd * 2 + 0.2, deck.x - deck.hw, skirtY, deck.z);
  wood.box(TRIM_TONE, 0.24, 0.3, deck.hd * 2 + 0.2, deck.x + deck.hw, skirtY, deck.z);
  // pilings at the corners and every ~3.6 yd along the edges
  const step = 3.6;
  const posts: { x: number; z: number }[] = [];
  for (let x = deck.x - deck.hw; x <= deck.x + deck.hw + 0.01; x += step) {
    posts.push({ x, z: deck.z - deck.hd }, { x, z: deck.z + deck.hd });
  }
  for (let z = deck.z - deck.hd + step; z <= deck.z + deck.hd - step + 0.01; z += step) {
    posts.push({ x: deck.x - deck.hw, z }, { x: deck.x + deck.hw, z });
  }
  for (const p of posts) {
    const bottom = Math.max(terrainHeight(p.x, p.z, seed) - 0.4, deck.y - PILE_MAX_DROP);
    const len = deck.y - bottom;
    if (len <= 0.3) continue;
    wood.cylinder(TRIM_TONE, PILE_RADIUS, PILE_RADIUS * 1.18, len, p.x, bottom + len / 2, p.z);
  }
}

// A railing run over its collider segment: chunky posts, a wide flat cap
// rail, and a mid rail. rot 0 runs along world x, Math.PI / 2 along world z.
function buildRail(wood: WoodBuckets, rail: HarborRail, deckY: number): void {
  const len = rail.hw * 2;
  const nPosts = Math.max(2, Math.ceil(len / 2.0) + 1);
  for (let i = 0; i < nPosts; i++) {
    const t = -rail.hw + (len * i) / (nPosts - 1);
    const px = rail.rot === 0 ? rail.x + t : rail.x;
    const pz = rail.rot === 0 ? rail.z : rail.z + t;
    wood.box(POST_TONE, 0.2, HARBOR_RAIL_HEIGHT, 0.2, px, deckY + HARBOR_RAIL_HEIGHT / 2, pz);
  }
  wood.box(
    BOARD_TONES[0],
    rail.rot === 0 ? len + 0.24 : 0.26,
    0.09,
    rail.rot === 0 ? 0.26 : len + 0.24,
    rail.x,
    deckY + HARBOR_RAIL_HEIGHT + 0.045,
    rail.z,
  );
  wood.box(
    POST_TONE,
    rail.rot === 0 ? len : 0.1,
    0.1,
    rail.rot === 0 ? 0.1 : len,
    rail.x,
    deckY + HARBOR_RAIL_HEIGHT * 0.55,
    rail.z,
  );
}

// A ramp as a planked gangway: one sloped surface box matching the walkable
// plane, cleat strips across it every CLEAT_PITCH, and side stringers.
function buildRamp(wood: WoodBuckets, r: HarborRamp): void {
  const alongX = r.dir === 'x+' || r.dir === 'x-';
  const run = (alongX ? r.hw : r.hd) * 2;
  const width = (alongX ? r.hd : r.hw) * 2;
  const drop = r.highY - r.lowY;
  const slopeLen = Math.hypot(run, drop);
  const pitch = Math.atan2(drop, run);
  const midY = (r.highY + r.lowY) / 2 - BOARD_THICK / 2;
  // descent sign along the axis: +1 when lowY sits at the +axis edge.
  // rotateZ(theta) lifts the +x end (right-hand rule about +z), so a
  // descent toward +x needs -pitch; rotateX(phi) DROPS the +z end
  // (+z rotates toward -y), so a descent toward +z needs +pitch.
  const sign = r.dir === 'x+' || r.dir === 'z+' ? 1 : -1;
  const rotZ = alongX ? -sign * pitch : 0;
  const rotX = alongX ? 0 : sign * pitch;
  const surface = new THREE.BoxGeometry(
    alongX ? slopeLen : width - 0.06,
    BOARD_THICK,
    alongX ? width - 0.06 : slopeLen,
  );
  if (rotZ) surface.rotateZ(rotZ);
  if (rotX) surface.rotateX(rotX);
  surface.translate(r.x, midY, r.z);
  // route through the bucket by wrapping: cheap trick, reuse box() path
  // not possible for a pre-rotated geometry, so push it directly
  const mesh = new THREE.Mesh(surface, woodMat(BOARD_TONES[1]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  rampMeshes.push(mesh);
  // cleats: level strips lying on the sloped surface
  const nCleats = Math.max(2, Math.floor(run / CLEAT_PITCH));
  for (let i = 1; i < nCleats; i++) {
    const t = i / nCleats; // 0 at high edge, 1 at low edge
    const along = (t - 0.5) * run * sign;
    const y = r.highY - drop * t + 0.035;
    wood.box(
      TRIM_TONE,
      alongX ? 0.14 : width - 0.3,
      0.07,
      alongX ? width - 0.3 : 0.14,
      r.x + (alongX ? along : 0),
      y,
      r.z + (alongX ? 0 : along),
    );
  }
  // side stringers following the slope
  for (const side of [-1, 1]) {
    const stringer = new THREE.BoxGeometry(alongX ? slopeLen : 0.18, 0.3, alongX ? 0.18 : slopeLen);
    if (rotZ) stringer.rotateZ(rotZ);
    if (rotX) stringer.rotateX(rotX);
    stringer.translate(
      r.x + (alongX ? 0 : (side * (width - 0.18)) / 2),
      midY - 0.12,
      r.z + (alongX ? (side * (width - 0.18)) / 2 : 0),
    );
    const sm = new THREE.Mesh(stringer, woodMat(TRIM_TONE));
    sm.castShadow = true;
    rampMeshes.push(sm);
  }
}

// Sloped ramp meshes carry baked rotations, so they bypass the axis-aligned
// bucket and land as individual meshes (a handful per harbor).
let rampMeshes: THREE.Mesh[] = [];

function buildLamp(parent: THREE.Group, x: number, z: number, deckY: number): void {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.6, 6), woodMat(POST_TONE));
  post.position.y = 1.3;
  post.castShadow = true;
  g.add(post);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.4, 0.34),
    surfaceMat({
      color: 0x3a3f46,
      roughness: 0.5,
      metalness: 0.6,
      flatShading: !GFX.standardMaterials,
    }),
  );
  box.position.y = 2.7;
  g.add(box);
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    surfaceMat({
      color: 0xffd27a,
      roughness: 0.3,
      metalness: 0,
      emissive: 0xffb84d,
      emissiveIntensity: 1.8,
      flatShading: !GFX.standardMaterials,
    }),
  );
  ember.position.y = 2.7;
  g.add(ember);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), haloMat());
  halo.position.y = 2.7;
  g.add(halo);
  g.position.set(x, deckY, z);
  parent.add(g);
}

function buildBollard(
  wood: WoodBuckets,
  parent: THREE.Group,
  x: number,
  z: number,
  deckY: number,
): void {
  wood.cylinder(POST_TONE, 0.15, 0.19, 0.9, x, deckY + 0.45, z);
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.05, 6, 12),
    surfaceMat({
      color: 0xb3a37f,
      roughness: 0.9,
      metalness: 0,
      flatShading: !GFX.standardMaterials,
    }),
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(x, deckY + 0.7, z);
  parent.add(collar);
}

// The scene-cued ships (H3): each moored ship registers under the prop target
// key the departure scenes cue ('harbor_ship_<harborId>'). A cue resolves an
// authored segment in the ship's berth-local frame; the scene end resets every
// cue (nobody but the cued rider ever receives the ops, so the motion is
// per-client presentation, never shared state).
interface HarborShipHandle {
  target: string;
  harbor: HarborDef;
  group: THREE.Group;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRot: number;
  frame: SceneAttachFrame;
  shipDecks: readonly HarborDeck[];
  displaced: boolean;
  shipScale: number;
  /** Mirrored simulation seconds when the active segment started, or null. */
  cueStartSec: number | null;
  segment: PropPathSegment | null;
  deckStandIn: CharacterVisual | null;
}

export interface HarborSceneDeps {
  /** Authoritative mirrored simulation clock in seconds. */
  nowSec: () => number;
}

const HARBOR_SHIP_STANDARD_SCALE =
  GRAND_FERRY_SHIP_PLAN.standardBerth.length / GRAND_FERRY_SHIP_PLAN.model.length;

// Ship-local yards for the standard 60-yard grand ferry. The generated deck
// center and height keep the moving player stand-in on the same authored deck.
// The generated deck runs in sections following the hull; the stand-in rides
// the one the gangway meets, which is the section a real rider boards onto.
const HARBOR_SHIP_BOARDING_DECK =
  GRAND_FERRY_SHIP_PLAN.decks.find(
    (deck) =>
      GRAND_FERRY_SHIP_PLAN.rampMatingEdge.x >= deck.x - deck.hw &&
      GRAND_FERRY_SHIP_PLAN.rampMatingEdge.x <= deck.x + deck.hw,
  ) ?? GRAND_FERRY_SHIP_PLAN.decks[0];
const HARBOR_SHIP_DECK_STAND_IN_ATTACH = {
  x: HARBOR_SHIP_BOARDING_DECK.x * HARBOR_SHIP_STANDARD_SCALE,
  y:
    (HARBOR_SHIP_BOARDING_DECK.y - GRAND_FERRY_SHIP_PLAN.model.keelY) * HARBOR_SHIP_STANDARD_SCALE,
  z: HARBOR_SHIP_BOARDING_DECK.z * HARBOR_SHIP_STANDARD_SCALE,
  yaw: Math.PI / 2,
} satisfies DeckStandInAttachPoint;
const DECK_STAND_IN_IDLE_STATE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
};

const PROP_PATH_SEGMENTS: Readonly<Record<string, PropPathSegment | undefined>> =
  LAST_BELL_PROP_PATH_SEGMENTS;
// buildHarbors installs its renderer's IWorld clock before registering ships.
let harborSceneNowSec = () => 0;
const SHIP_CUES = new HarborShipCueRegistry<PropPathSegment, HarborShipHandle>({
  nowSec: () => harborSceneNowSec(),
  segmentForCue: (cue) => PROP_PATH_SEGMENTS[cue],
  activate: (handle, segment, startSec) => {
    handle.segment = segment;
    handle.cueStartSec = startSec;
    handle.displaced = true;
    handle.group.matrixAutoUpdate = true;
  },
  reset: (handle) => resetShip(handle),
});
const CUE_POSE: PropPathSample = { x: 0, y: 0, z: 0, yaw: 0, done: false };
const SHIP_ATTACH_FRAME: SceneAttachFrame = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
};
const DECK_RIDER_RESOLUTION: HarborDeckRiderResolution = {
  entityId: 0,
  target: '',
  mode: 'none',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
};
const DECK_RIDER_REQUIRED_RESOLUTION: HarborDeckRiderResolution = {
  entityId: 0,
  target: '',
  mode: 'none',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
};
let activeHarbors: readonly HarborDef[] = [];
let warnedDeckRiders: Set<string> | null = null;
let warnedHullCues: Set<string> | null = null;

/** Compute the ship's current world transform without touching its freeze state.
 * The yaw convention is shared with scene_rig_core.localToWorld. */
export function harborShipAttachFrame(
  target: string,
  out: SceneAttachFrame = SHIP_ATTACH_FRAME,
  presentationTimeSec?: number,
): SceneAttachFrame | null {
  const handle = SHIP_CUES.get(target);
  if (!handle) return null;
  const elapsedSec =
    handle.cueStartSec === null
      ? null
      : (presentationTimeSec ?? harborSceneNowSec()) - handle.cueStartSec;
  const pose =
    elapsedSec !== null && handle.segment !== null
      ? propPathPoseAt(handle.segment, elapsedSec, CUE_POSE)
      : null;
  return composeHarborShipAttachFrame(handle, pose, out);
}

/** Route a scene prop cue to a ship. Pre-build targets retain their cue and
 *  unknown cues park a known ship, so load races and authored mistakes never
 *  crash the client. The ship's matrix auto-update is enabled ONLY while a cue
 *  is live, so harbors stay inside the freezeStaticMatrices contract otherwise. */
export function cueHarborShip(target: string, cue: string, startSec: number): void {
  SHIP_CUES.cue(target, cue, startSec);
}

/** Scene teardown: every ship back at its berth. */
export function resetHarborShipCues(): void {
  SHIP_CUES.resetAll();
}

function resetShip(handle: HarborShipHandle): void {
  handle.cueStartSec = null;
  handle.segment = null;
  handle.displaced = false;
  disposeDeckStandIn(handle, (visual) => visual.dispose());
  handle.group.position.set(handle.baseX, handle.baseY, handle.baseZ);
  handle.group.rotation.y = handle.baseRot;
  handle.frame.position.x = handle.baseX;
  handle.frame.position.y = handle.baseY;
  handle.frame.position.z = handle.baseZ;
  handle.frame.yaw = handle.baseRot;
  // Back under the freeze: recompose the rest pose once (updateMatrix flags
  // the world-matrix cascade for this frame), then stop the per-frame churn.
  handle.group.updateMatrix();
  handle.group.matrixAutoUpdate = false;
}

function createDeckStandIn(handle: HarborShipHandle, player: Entity): CharacterVisual | null {
  const visual = createCharacterVisual(player);
  // A null build retries next frame with no cooldown. World entry preloads
  // these assets, and the cue window is short, so this retry policy is accepted.
  if (!visual) return null;
  const transform = deckStandInParentTransform(
    HARBOR_SHIP_DECK_STAND_IN_ATTACH,
    handle.shipScale,
    player.scale,
  );
  visual.root.position.set(transform.x, transform.y, transform.z);
  visual.root.rotation.y = transform.yaw;
  visual.root.scale.setScalar(transform.scale);
  visual.setWeaponSkin(player.weaponSkinId);
  visual.update(0, DECK_STAND_IN_IDLE_STATE, true);
  handle.group.add(visual.root);
  return visual;
}

function updateHarborShipMotion(handle: HarborShipHandle): void {
  const elapsedSec = SHIP_CUES.elapsedSec(handle);
  if (elapsedSec !== null && handle.segment !== null) {
    handle.group.matrixAutoUpdate = true;
    const pose = propPathPoseAt(handle.segment, elapsedSec, CUE_POSE);
    const frame = composeHarborShipAttachFrame(handle, pose, handle.frame);
    handle.group.position.set(frame.position.x, frame.position.y, frame.position.z);
    handle.group.rotation.y = frame.yaw;
    if (import.meta.env.DEV) {
      const overlap = firstHarborHullColliderOverlap(handle.harbor, frame, activeHarbors);
      if (overlap) {
        warnedHullCues ??= new Set();
        const key = `${handle.target}:${handle.cueStartSec}:${overlap.harborId}:${overlap.colliderKind}:${overlap.colliderIndex}`;
        if (!warnedHullCues.has(key)) {
          warnedHullCues.add(key);
          console.warn(
            `Cinematic ship hull ${handle.target} overlaps ${overlap.harborId} ${overlap.colliderKind} collider ${overlap.colliderIndex}.`,
          );
        }
      }
    }
  }
}

function resolveDeckRider(
  entity: Entity,
  pose: { x: number; y: number; z: number; yaw: number },
  out: HarborDeckRiderResolution,
): HarborDeckRiderResolution {
  return resolveHarborDeckRider(
    {
      entityId: entity.id,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      yaw: pose.yaw,
      midInteraction: harborDeckRiderMidInteraction(entity),
    },
    SHIP_CUES.values(),
    out,
  );
}

/** True when renderer retention must keep this parked entity for a live ship cue. */
export function harborDeckRiderActive(entity: Entity): boolean {
  return (
    resolveDeckRider(
      entity,
      { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z, yaw: entity.facing },
      DECK_RIDER_REQUIRED_RESOLUTION,
    ).mode !== 'none'
  );
}

/** Resolve one visual's live ship pose without mutating it. */
export function harborDeckRiderVisualPlan(
  entity: Entity,
  visual: THREE.Object3D,
): HarborDeckRiderResolution {
  return resolveDeckRider(
    entity,
    {
      x: visual.position.x,
      y: visual.position.y,
      z: visual.position.z,
      yaw: visual.rotation.y,
    },
    DECK_RIDER_RESOLUTION,
  );
}

/** Apply a resolved deck-rider plan to the rig group and its anchored nameplate. */
export function applyHarborDeckRiderVisual(
  resolution: HarborDeckRiderResolution,
  visual: THREE.Object3D,
): void {
  if (resolution.mode === 'none') return;
  if (resolution.mode === 'hide') {
    visual.visible = false;
    return;
  }
  visual.position.set(resolution.x, resolution.y, resolution.z);
  visual.rotation.y = resolution.yaw;
}

/** Development assertion kept separate from mutation so a missed apply still warns. */
export function warnMissingHarborDeckRider(
  resolution: HarborDeckRiderResolution,
  visual: THREE.Object3D,
): void {
  if (!import.meta.env.DEV) return;
  const warning = missingDeckRiderWarning(resolution, {
    x: visual.position.x,
    y: visual.position.y,
    z: visual.position.z,
    yaw: visual.rotation.y,
  });
  if (warning) {
    warnedDeckRiders ??= new Set();
    const key = `${resolution.target}:${resolution.entityId}`;
    if (!warnedDeckRiders.has(key)) {
      warnedDeckRiders.add(key);
      console.warn(warning);
    }
  }
}

/** Per-frame ship motion and deck visual lifecycle from the live cue state.
 * True means the moving stand-in replaces the parked authoritative rig. The
 * factory binds every callback once so this renderer hot path stays stable. */
export const updateHarborShips = createHarborShipUpdater<Entity, CharacterVisual, HarborShipHandle>(
  {
    handles: () => SHIP_CUES.values(),
    isRealLocalPlayer: (player) => player.kind === 'player',
    createStandIn: createDeckStandIn,
    updateStandIn: (visual, dt) => visual.update(dt, DECK_STAND_IN_IDLE_STATE, false),
    disposeStandIn: (visual) => visual.dispose(),
    updateMotion: updateHarborShipMotion,
  },
);

// The moored ferry ship: the generated GLB (long axis x, base at the keel)
// scaled so the hull matches the authored berth length, yawed to the berth
// heading, keel sunk draft yards below the sea surface. The walkable
// shipDecks in the layout are measured from this model's deck plane.
function buildShip(parent: THREE.Group, harbor: HarborDef): void {
  const ship = propAsset('harborShip');
  const scale = harbor.berth.length / ship.size.x;
  const parked = harborShipParkedPose(harbor.berth, WATER_LEVEL);
  const g = new THREE.Group();
  g.position.set(parked.x, parked.y, parked.z);
  g.scale.setScalar(scale);
  g.rotation.y = parked.yaw;
  parent.add(g);
  const shipVisual = addAsset(g, ship);
  if (harbor.berth.mirrorZ) shipVisual.scale.z = -1;
  const target = `harbor_ship_${harbor.id}`;
  const handle: HarborShipHandle = {
    target,
    harbor,
    group: g,
    baseX: parked.x,
    baseY: parked.y,
    baseZ: parked.z,
    baseRot: parked.yaw,
    frame: {
      position: {
        x: parked.x,
        y: parked.y,
        z: parked.z,
      },
      yaw: parked.yaw,
    },
    shipDecks: harbor.shipDecks,
    displaced: false,
    shipScale: scale,
    cueStartSec: null,
    segment: null,
    deckStandIn: null,
  };
  SHIP_CUES.register(target, handle);
}

/** Build every authored harbor of the active world into one static group. */
export function buildHarbors(seed: number, deps: HarborSceneDeps): { group: THREE.Group } {
  harborSceneNowSec = deps.nowSec;
  const group = new THREE.Group();
  group.name = 'harbors';
  SHIP_CUES.clearHandles();
  const harbors = getActiveWorldContent().props.harbors ?? [];
  activeHarbors = harbors;
  if (import.meta.env.DEV) {
    warnedDeckRiders?.clear();
    warnedHullCues?.clear();
  }
  for (const harbor of harbors) {
    const g = new THREE.Group();
    const wood = new WoodBuckets();
    rampMeshes = [];
    for (const deck of harbor.decks) buildDeck(wood, deck, seed);
    for (const rail of harbor.rails) {
      buildRail(wood, rail, harborSurfaceHeight(harbor, rail.x, rail.z));
    }
    for (const ramp of harbor.ramps) buildRamp(wood, ramp);
    for (const d of harbor.dressing) {
      const deckY = harborSurfaceHeight(harbor, d.x, d.z);
      if (d.kind === 'lamp') buildLamp(g, d.x, d.z, deckY);
      else if (d.kind === 'crate')
        addAsset(g, propAsset('crateWooden'), {
          x: d.x,
          y: deckY,
          z: d.z,
          rot: d.rot ?? 0,
          scale: 0.9,
        });
      else if (d.kind === 'barrel')
        addAsset(g, propAsset('barrel'), {
          x: d.x,
          y: deckY,
          z: d.z,
          rot: d.rot ?? 0,
          scale: 1.05,
        });
      else buildBollard(wood, g, d.x, d.z, deckY);
    }
    buildShip(g, harbor);
    wood.flush(g);
    for (const m of rampMeshes) g.add(m);
    rampMeshes = [];
    group.add(g);
  }
  return { group };
}
