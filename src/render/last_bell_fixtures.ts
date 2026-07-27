// Last Bell campaign fixtures: procedural bodies for the campaign's ground
// objects (spawned by src/sim/last_bell/campaign.ts), which had no renderer
// representation before this module:
//   - buildFerryLanding: the moored Farshore Ferry beside its mooring post
//   - buildScenarioDoor: the Tidemill's stone doorframe (the building itself
//     lands later; this marks the way in)
//   - buildBreachMaw: the campaign's wound in the world at FARSHORE_BREACH
// House style follows mailbox.ts: deterministic (the entity id drives the only
// variation, never Math.random), materials go through surfaceMat() for dedup,
// and lowGfx stays friendly (glow layers are cheap additive MeshBasicMaterials,
// no point lights).

import * as THREE from 'three';
import { WATER_LEVEL } from '../sim/world';
import { buildRiftGateBody } from './door_portal';
import { GFX, surfaceMat } from './gfx';
import { radialGlowTexture } from './textures';

function woodMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.82,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

function stoneMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.94,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

function canvasMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.9,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

// Additive glow (the door_portal.ts riftGlowMaterial recipe): transparent,
// depth-write off so it never punches holes in the water or terrain behind it.
function glowMat(color: number, opacity: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Interest churn rebuilds views but removeView only disposes per-view geometry
// (plus the portal material), so every non-portal glow material and its canvas
// texture live here as module singletons, mailbox/delve style, never per view.
let glowTexCached: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (!glowTexCached) glowTexCached = radialGlowTexture();
  return glowTexCached;
}
let lanternHaloMat: THREE.MeshBasicMaterial | null = null;
function haloMat(): THREE.MeshBasicMaterial {
  if (!lanternHaloMat) lanternHaloMat = glowMat(0xffb84d, 0.4, glowTexture());
  return lanternHaloMat;
}
let doorStripMat: THREE.MeshBasicMaterial | null = null;
function stripMat(): THREE.MeshBasicMaterial {
  if (!doorStripMat) doorStripMat = glowMat(0xffb469, 0.5);
  return doorStripMat;
}

// ---------------------------------------------------------------------------
// The Farshore Ferry landing
// ---------------------------------------------------------------------------

// The single-mast ferry, built with its WATERLINE at the sub-group's local
// y = 0 (hull draft below, freeboard and deck above), so the caller can drop
// the whole boat to the sea surface with one offset.
function buildFerryBoat(entityId: number): THREE.Group {
  const boat = new THREE.Group();
  const hullWood = woodMat(0x4f3a24);
  const trimWood = woodMat(0x6b512f);
  const deckWood = woodMat(0x7a6238);
  const canvas = canvasMat(0xd8cfb6);
  const iron = surfaceMat({
    color: 0x3a3f46,
    roughness: 0.5,
    metalness: 0.6,
    flatShading: !GFX.standardMaterials,
  });

  // Hull: ~7 yd stem to stern (5.4 yd midbody + a 1.6 yd bow wedge), 0.6 yd
  // draft below the waterline so the boat reads as floating, not perched.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.5, 2.3), hullWood);
  hull.position.set(-0.4, 0.15, 0);
  hull.castShadow = true;
  boat.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.6, 4), hullWood);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4; // square cone aligned with the hull's box faces
  bow.position.set(3.1, 0.15, 0);
  bow.castShadow = true;
  boat.add(bow);
  // Gunwale trim: two rails along the sheer line.
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.18, 0.18), trimWood);
    rail.position.set(-0.4, 0.95, side * 1.15);
    boat.add(rail);
  }
  // Deck plank surface.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.1, 2.1), deckWood);
  deck.position.set(-0.4, 0.86, 0);
  boat.add(deck);

  // Mast (just forward of midships) with a yard and the furled sail: the sail
  // is a canvas roll lashed to the yard with three rope ties.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.2, 8), trimWood);
  mast.position.set(0.4, 0.9 + 3.6, 0);
  mast.castShadow = true;
  boat.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 6), trimWood);
  yard.rotation.x = Math.PI / 2;
  yard.position.set(0.4, 6.4, 0);
  boat.add(yard);
  const furl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 3.8, 8), canvas);
  furl.rotation.x = Math.PI / 2;
  furl.position.set(0.4, 6.15, 0);
  furl.castShadow = true;
  boat.add(furl);
  for (const tz of [-1.2, 0, 1.2]) {
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 10), trimWood);
    tie.rotation.y = Math.PI / 2;
    tie.position.set(0.4, 6.15, tz);
    boat.add(tie);
  }

  // Stern lantern on a short post: the emissive ember is the landing's
  // night-time beacon (a static material glow, deliberately not a light).
  const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), trimWood);
  lampPost.position.set(-3.0, 1.45, 0);
  boat.add(lampPost);
  const lampBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.34), iron);
  lampBox.position.set(-3.0, 2.15, 0);
  boat.add(lampBox);
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
  ember.position.set(-3.0, 2.15, 0);
  boat.add(ember);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), haloMat());
  halo.position.set(-3.0, 2.15, 0);
  boat.add(halo);

  // Moored broadside: the hull lies parallel to the shore (long axis across
  // the local out-direction), with a small per-landing yaw so the two
  // landings' boats do not sit identically.
  boat.rotation.y = Math.PI / 2 + ((entityId % 5) - 2) * 0.07;
  return boat;
}

/**
 * The ferry landing for one 'lb_ferry' fixture. The fixture entity stands on
 * shore ground (roughly 0.5 to 5 yd above the sea), while the sea surface is
 * the world WATER_LEVEL (-4.5): the terrain only dips under water 28+ yd off
 * either landing (measured on the pinned world seed 20061), so the boat is
 * pushed `outDist` yd toward local -x AND dropped so its waterline sits
 * exactly at the sea surface. The caller supplies:
 *   - outDist: how far offshore the open water starts (30 mainland, 34 pier)
 *   - groundY: the fixture entity's ground height (e.pos.y), so the drop
 *     WATER_LEVEL - groundY is exact for either landing
 * and rotates the returned group so local -x points at the water. The mast
 * tops out ~11 yd above the waterline, so the landing reads well past 40 yd.
 */
export function buildFerryLanding(
  entityId: number,
  outDist: number,
  groundY: number,
): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  const boat = buildFerryBoat(entityId);
  boat.position.set(-outDist, WATER_LEVEL - groundY, 0);
  group.add(boat);

  // The short mooring post at the landing itself: a leaning timber bollard
  // with a rope collar, marking where the ferry is hailed from.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.4, 8), woodMat(0x5b4226));
  post.position.set(-0.7, 0.7, 0.5);
  post.rotation.z = 0.12;
  post.castShadow = true;
  group.add(post);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 12), canvasMat(0xb3a37f));
  collar.rotation.x = Math.PI / 2;
  collar.position.set(-0.78, 1.1, 0.5);
  group.add(collar);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 8), woodMat(0x5b4226));
  stump.position.set(0.35, 0.35, -0.4);
  group.add(stump);

  // Nameplate anchor stays at the shore fixture (the interact point), not the
  // boat: height 6 clears the mooring post and reads over the shoreline.
  return { group, height: 6 };
}

// ---------------------------------------------------------------------------
// The scenario door (the Tidemill's marked way in)
// ---------------------------------------------------------------------------

/**
 * A modest stone doorframe with a warm glow strip in the opening: two jambs,
 * a lintel, a threshold slab, and an additive light seam. The Tidemill
 * building itself lands later; this just marks the way in for 'lb_scenario_door'.
 */
export function buildScenarioDoor(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  const stone = stoneMat(0x6a655c);
  const stoneDark = stoneMat(0x524e46);

  const threshold = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.24, 1.2), stoneDark);
  threshold.position.y = 0.12;
  group.add(threshold);
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.3, 0.6), stone);
    jamb.position.set(side * 1.05, 1.65 + 0.12, 0);
    jamb.castShadow = true;
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.55, 0.7), stoneDark);
  lintel.position.y = 3.55;
  lintel.castShadow = true;
  group.add(lintel);
  // Keystone accent, nudged per entity so repeated doors would not stamp
  // identical silhouettes (deterministic, id-driven, mailbox-raven style).
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 4), stone);
  cap.position.y = 3.95;
  cap.rotation.y = Math.PI / 4 + (entityId % 3) * 0.1;
  group.add(cap);

  // The warm glow strip: millwork light spilling through the doorway. An
  // additive plane (no light) so it is lowGfx-safe and never blooms the scene.
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.1), stripMat());
  strip.position.set(0, 1.67 + 0.12, 0);
  group.add(strip);

  return { group, height: 4 };
}

// ---------------------------------------------------------------------------
// The Breach maw
// ---------------------------------------------------------------------------

const BREACH_HEIGHT = 15;
const BREACH_TINT = 0x8b1e4f; // deep violet-red: the campaign's wound color

// Jagged dark stone shards ringing the maw (shared by both build paths):
// four teeth at fixed angles, leaning in toward the tear.
function addBreachShards(group: THREE.Group): void {
  const shardMat = stoneMat(0x241c22);
  const layout = [
    { ang: 0.5, h: 6.5, r: 6.6 },
    { ang: 2.0, h: 4.6, r: 7.2 },
    { ang: 3.7, h: 5.8, r: 6.4 },
    { ang: 5.3, h: 4.2, r: 7.0 },
  ];
  for (const s of layout) {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(1.15, s.h, 5), shardMat);
    const x = Math.cos(s.ang) * s.r;
    const z = Math.sin(s.ang) * s.r;
    shard.position.set(x, s.h * 0.42, z); // seated slightly into the crater floor
    // Lean each tooth toward the center: tilt about the axis tangent to the ring.
    shard.rotation.set(Math.sin(s.ang) * 0.22, s.ang, -Math.cos(s.ang) * 0.22);
    shard.castShadow = true;
    group.add(shard);
  }
}

/**
 * The Breach: the campaign's wound in the world, sized to read from across
 * the island (~15 yd). Preferred body: the rift gate GLB via
 * buildRiftGateBody scaled 2.5x (uniform, so nothing distorts) and re-tinted
 * deep violet-red with per-view cloned materials (the GLB's own materials are
 * share-marked and must never be mutated). No rank badge: this is not a
 * ranked portal. Fallback (GLB missing or not yet preloaded): the membrane
 * recipe replicated at breach radius: a swirling additive disc in a dark
 * stone ring. Both paths get the shard teeth. The returned `portal` mesh
 * rides the renderer's existing swirl spin/pulse.
 */
export function buildBreachMaw(lowGfx: boolean): {
  group: THREE.Group;
  height: number;
  portal?: THREE.Mesh;
} {
  const group = new THREE.Group();
  addBreachShards(group);

  // Tier 'A' picks the violet portal texture family; the tint below owns the
  // final color either way.
  const gate = buildRiftGateBody(lowGfx, 'A');
  if (gate) {
    gate.body.scale.setScalar(BREACH_HEIGHT / 6); // RIFT_GATE_HEIGHT is 6 yd
    const emissive = new THREE.Color(0x4a1030);
    gate.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh === gate.portal) return;
      // Clone before tinting: the source materials are shared with every
      // ranked rift portal in the world.
      const tint = (m: THREE.Material): THREE.Material => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        if ('color' in c) c.color.lerp(new THREE.Color(0x2a1018), 0.55);
        if ('emissive' in c) {
          c.emissive = emissive;
          c.emissiveIntensity = 0.6;
          c.needsUpdate = true;
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
    // Re-color the membrane on a clone too (the shared portal material is
    // cached per tier); the clone is unshared, so the view teardown's
    // portal-material dispose reclaims it.
    if (gate.portal) {
      const membrane = (gate.portal.material as THREE.MeshBasicMaterial).clone();
      membrane.color.set(BREACH_TINT);
      if (!lowGfx) membrane.color.multiplyScalar(2); // door_portal's PORTAL_BOOST
      gate.portal.material = membrane;
    }
    group.add(gate.body);
    return { group, height: BREACH_HEIGHT, portal: gate.portal };
  }

  // Fallback membrane: a large swirl disc centered in a dark stone ring, the
  // same read as the gate's opening at breach scale.
  const ringY = BREACH_HEIGHT * 0.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.5, 8, 36), stoneMat(0x241c22));
  ring.position.y = ringY;
  ring.castShadow = true;
  group.add(ring);
  // Per-view portal material on purpose: removeView disposes exactly the
  // portal material when it is unshared, so this one does not leak (the
  // radial texture it maps stays the shared singleton).
  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 40),
    glowMat(BREACH_TINT, 0.85, glowTexture()),
  );
  if (!lowGfx) (portal.material as THREE.MeshBasicMaterial).color.multiplyScalar(2);
  portal.position.y = ringY;
  group.add(portal);
  return { group, height: BREACH_HEIGHT, portal };
}
