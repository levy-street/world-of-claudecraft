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
// The Farshore Ferry boarding point
// ---------------------------------------------------------------------------

/**
 * The minimal mooring marker for one 'lb_ferry' fixture. The harbor builder
 * (src/render/harbor.ts) owns the ship and the boardwalk now; the fixture
 * keeps only the leaning bollard and rope collar that mark where boarding is
 * hailed from, plus the sparkle and nameplate the renderer attaches.
 */
export function buildFerryMooring(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.4, 8), woodMat(0x5b4226));
  post.position.set(-0.7, 0.7, 0.5);
  // a small per-landing lean so the two gangplank posts do not sit identically
  post.rotation.z = 0.09 + (entityId % 3) * 0.03;
  post.castShadow = true;
  group.add(post);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 12), canvasMat(0xb3a37f));
  collar.rotation.x = Math.PI / 2;
  collar.position.set(-0.78, 1.1, 0.5);
  group.add(collar);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 8), woodMat(0x5b4226));
  stump.position.set(0.35, 0.35, -0.4);
  group.add(stump);

  // Nameplate anchor: clears the post while staying near the gangplank.
  return { group, height: 3.2 };
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
