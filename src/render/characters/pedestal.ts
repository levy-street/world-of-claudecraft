// Procedural stone dais for the character-window preview turntable (Phase 2b
// of the char-equipment redesign, docs/char-equipment/; re-shaped for the
// paperdoll rework, same doc directory: the mockup's pedestal is a CHUNKY
// round stone dais with a stepped/tiered top rim, not the thin flat disc the
// original single-cylinder build read as). Three tapered cylinder tiers,
// stacked widest-at-bottom to narrowest-at-top (a "wedding cake" stone
// stack), each its own MeshStandardMaterial with a slightly different grey
// value so the stack reads as weathered, hand-set masonry rather than one
// flat-shaded mass, plus a raised rim ring tracing the topmost tier's edge
// where the character actually stands. No GLB/texture/HDRI: five cheap
// primitive geometries and five MeshStandardMaterials (the preview scene
// already lights with a hemisphere + two directional lights, see preview.ts).
//
// Built fresh (not shared/cached) per CharacterPreview instance: there are at
// most one or two live previews in the whole app (the Hud char-window preview
// and, briefly, main.ts's pre-game one), so a one-time, non-shared build costs
// nothing and lets disposePedestal() release it safely without touching any
// other instance's resources (unlike the shared per-asset caches elsewhere in
// this directory, see the CLAUDE.md "never disposed" note, that pattern is for
// many concurrent per-entity clones, not this single always-on preview prop).
import * as THREE from 'three';

// Each tier: [[topRadius, bottomRadius], height]. Tiers stack bottom-to-top,
// each tier's OWN bottom radius sized WELL within the tier below's top radius
// (a wide step, not a sliver) so the tier below's top face reads as a clearly
// visible stepped ring (the "stepped/tiered top rim" the mockup shows) even
// partly occluded by the character's own robe/legs, rather than one smooth
// taper or two steps too narrow to read at a glance.
const TIER_BASE = { radiusTop: 1.35, radiusBottom: 1.6, height: 0.22, segments: 28 };
const TIER_MID = { radiusTop: 1.0, radiusBottom: 1.05, height: 0.16, segments: 28 };
const TIER_TOP = { radiusTop: 0.78, radiusBottom: 0.85, height: 0.12, segments: 28 };

const RIM_RADIUS = TIER_TOP.radiusTop + 0.02;
const RIM_TUBE = 0.045;
const RIM_RADIAL_SEGMENTS = 8;
const RIM_TUBULAR_SEGMENTS = 24;

// Weathered grey stone, one shade pair (side/top) per tier: darkest at the
// wide base, lightest at the top tier the character stands on. The gap
// between tiers is deliberately wide (not a subtle gradient) so each step
// reads as a distinct block of stone, not a smooth taper, at preview scale.
const TIER_BASE_SIDE_COLOR = 0x1c1a17;
const TIER_BASE_TOP_COLOR = 0x2e2a22;
const TIER_MID_SIDE_COLOR = 0x322e28;
const TIER_MID_TOP_COLOR = 0x4a453a;
const TIER_TOP_SIDE_COLOR = 0x4a4438;
const TIER_TOP_TOP_COLOR = 0x726a58;
const STONE_RIM_COLOR = 0x6b6355;

/** Build one tapered cylinder tier, its own bottom-cap never facing the
 *  camera (the dais sits on the panel floor), so it reuses the side material
 *  rather than paying for a third one, matching the original single-tier
 *  build's material economy. `topY` is the LOCAL y of the tier's own top
 *  face; the tier extends downward from there. */
function buildTier(
  tier: { radiusTop: number; radiusBottom: number; height: number; segments: number },
  topY: number,
  sideColor: number,
  topColor: number,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(
    tier.radiusTop,
    tier.radiusBottom,
    tier.height,
    tier.segments,
  );
  const sideMat = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: 0.92,
    metalness: 0.05,
  });
  const topMat = new THREE.MeshStandardMaterial({
    color: topColor,
    roughness: 0.72,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, [sideMat, topMat, sideMat]);
  mesh.position.y = topY - tier.height / 2;
  return mesh;
}

/** Build a fresh, self-contained procedural stone dais: three stacked,
 *  tapered stone tiers (widest at the bottom, narrowest at the top, each a
 *  visible "step" where the tier below's top face peeks out around the
 *  tier above) plus a raised rim ring tracing the topmost tier's edge.
 *  Centered on the origin with its TOP surface (the topmost tier's top face)
 *  at local y=0 (so a caller can drop it in directly under a character whose
 *  root pivots at the feet, see CharacterPreview.setPedestal); the stack
 *  extends downward from there. Cheap: 4 draw calls, a few hundred vertices
 *  total, no textures, built once (never per-frame). Owns its own geometry/
 *  material (not a shared cache), so pair with disposePedestal() when done. */
export function buildPedestal(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'preview-pedestal';

  // Top tier's own top face sits at local y=0 (the drop-under-feet invariant);
  // each lower tier's top face is the tier above's bottom face.
  const topTier = buildTier(TIER_TOP, 0, TIER_TOP_SIDE_COLOR, TIER_TOP_TOP_COLOR);
  const midTier = buildTier(TIER_MID, -TIER_TOP.height, TIER_MID_SIDE_COLOR, TIER_MID_TOP_COLOR);
  const baseTier = buildTier(
    TIER_BASE,
    -TIER_TOP.height - TIER_MID.height,
    TIER_BASE_SIDE_COLOR,
    TIER_BASE_TOP_COLOR,
  );
  group.add(baseTier, midTier, topTier);

  const rimGeo = new THREE.TorusGeometry(
    RIM_RADIUS,
    RIM_TUBE,
    RIM_RADIAL_SEGMENTS,
    RIM_TUBULAR_SEGMENTS,
  );
  const rimMat = new THREE.MeshStandardMaterial({
    color: STONE_RIM_COLOR,
    roughness: 0.6,
    metalness: 0.1,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  return group;
}

/** Release the geometry/material owned by a pedestal built via
 *  buildPedestal(). Safe to call any time: the pedestal is never shared with
 *  another CharacterPreview instance, so this never disposes a resource
 *  still in use elsewhere. Call once from CharacterPreview.destroy(). */
export function disposePedestal(pedestal: THREE.Group): void {
  pedestal.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const m of mesh.material) m.dispose();
    } else {
      mesh.material.dispose();
    }
  });
}
