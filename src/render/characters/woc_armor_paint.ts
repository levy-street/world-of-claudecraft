// The three.js half of the painted WOC armour (woc_armor_paint_core.ts owns the look and
// its knobs): which materials are armour, and the layer the tinted-material factory puts
// on their derivations.
//
// WHICH: the armour store tags every material of an armour pack's parse as the file lands
// (woc_armor_packs.ts, markWocArmorPaintScene), so any WOC armour set, shipped or added
// later, takes the treatment by being an armour pack, never by a name or a list. A
// Material.clone() copies userData, so the high pack's assembled material clones and
// every tinted clone carry the tag on; the body, the head, the hair and the held weapons
// come from other files and never do.
//
// WHERE: assets.ts buildTintedClone calls applyWocArmorPaint as its last layer on BOTH
// arms (the Standard/Physical clone and the Lambert rebuild of Low and iOS), for the rig,
// the merged kit (it draws the file material) and the far bake (it derives from the same
// source materials). The layer is an onBeforeCompile hook chained after whatever the
// material carries, under a program key of its own that is the same string for every
// armour material of a session: one program per base program, never one per set.
// material_clone_hooks.ts re-attaches it on a program-preserving clone (the effect
// overlays, the buff glow), right after the env sheen, where the factory puts it.
//
// GPU preparation (src/render/CLAUDE.md, "GPU work"): the layer adds no producer. An armour
// material links where it always did, behind the armour file's compile gate
// (CharacterVisual revealOnCompile, the suit standing in) or the far mint gate, and any
// prewarm that builds an armoured body builds it through the same factory, so the twin it
// links is this very program.
//
// `?armorpaint=off` is the stock armour, byte for byte (no tag is read, no factor
// changes, no hook): the before arm of a screenshot pair. The `ap*` knobs override the
// defaults for one session (woc_armor_paint_core.ts wocArmorPaintFromQuery). Reload to flip.
import type * as THREE from 'three';
import {
  patchWocArmorPaintFragment,
  WOC_ARMOR_PAINT_DEFAULTS,
  type WocArmorPaintSettings,
  wocArmorPaintActive,
  wocArmorPaintFromQuery,
  wocArmorPaintProgramKey,
  wocArmorSurfaceFactors,
} from './woc_armor_paint_core';

/** The userData key that marks an armour pack's own materials (and their derivations). */
export const WOC_ARMOR_PAINT_TAG = 'wocArmorPaint';

// Read once at module load: the layer is compiled into programs, so a change needs a
// reload. A host without a location (Node tests, tools) runs the shipped defaults.
let settings: WocArmorPaintSettings | null =
  typeof location === 'undefined'
    ? WOC_ARMOR_PAINT_DEFAULTS
    : wocArmorPaintFromQuery(location.search);

/** The session's treatment, or null for the stock armour (`?armorpaint=off`). */
export function wocArmorPaintSettings(): WocArmorPaintSettings | null {
  return settings;
}

/** Test seam: run another treatment (null: the stock armour) until the next call. */
export function setWocArmorPaintSettingsForTest(next: WocArmorPaintSettings | null): void {
  settings = next;
}

/** Tag every material of an armour pack's parse (woc_armor_packs.ts, as the file lands).
 *  Idempotent. */
export function markWocArmorPaintScene(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) material.userData[WOC_ARMOR_PAINT_TAG] = true;
    }
  });
}

/** Whether a material is an armour pack's own, or a derivation of one. */
export function isWocArmorMaterial(material: THREE.Material): boolean {
  return material.userData?.[WOC_ARMOR_PAINT_TAG] === true;
}

/** The materials that carry the layer, with the treatment each was built with. A clone
 *  is given the layer only when its source carried it (never a layer it did not have). */
const painted = new WeakMap<THREE.Material, WocArmorPaintSettings>();

/** Whether a material carries the paint layer (tests, the clone re-attach). */
export function hasWocArmorPaint(material: THREE.Material): boolean {
  return painted.has(material);
}

/**
 * The armour treatment on a freshly derived (tinted) material, `source` being what it was
 * derived from: the metal response (the metalness cap; the sky reflection's is the env
 * sheen's metal share, env_sheen_core.ts) and the paint-over hook. A no-op for any material
 * whose source is not armour, and for every material under `?armorpaint=off`. Call it once
 * per derivation, after every other layer the factory attaches (the cap is idempotent, the
 * hook is attached once per material).
 */
export function applyWocArmorPaint(material: THREE.Material, source: THREE.Material): void {
  const look = settings;
  if (!look || !isWocArmorMaterial(source)) return;
  // the Lambert rebuild starts from an empty userData: the tag rides on for its clones
  material.userData[WOC_ARMOR_PAINT_TAG] = true;
  const std = material as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    std.metalness = wocArmorSurfaceFactors(std).metalness;
  }
  attachPaintHook(material, look);
}

function attachPaintHook(material: THREE.Material, look: WocArmorPaintSettings): void {
  if (painted.has(material) || !wocArmorPaintActive(look)) return;
  painted.set(material, look);
  const previousCompile = material.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = material.customProgramCacheKey.bind(material);
  const key = wocArmorPaintProgramKey(look);
  // Idempotent and stateless, as the dry compile requires (src/render/CLAUDE.md, the shader
  // warm gate): a pure rewrite of the source it is handed, nothing kept.
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = patchWocArmorPaintFragment(shader.fragmentShader, look);
  };
  material.customProgramCacheKey = () => `${key}|${previousCompileSource}|${previousProgramKey()}`;
  material.needsUpdate = true;
}

/** Re-attach the layer to a Material.clone() of a painted material (material_clone_hooks.ts):
 *  clone() copies the tag and the capped factors but drops the hook, so the clone would draw
 *  the unpainted armour and link a program of its own. No-op for any other source. */
export function reapplyWocArmorPaintToClone(source: THREE.Material, clone: THREE.Material): void {
  const look = painted.get(source);
  if (look) attachPaintHook(clone, look);
}
