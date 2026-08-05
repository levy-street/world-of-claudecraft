// The custom GLB bodies for the three Thornhollow Fields rune pads, and the switch that
// falls back to the procedural shapes when a model has not been registered.
//
// HOW TO SHIP A CUSTOM RUNE MODEL
//   1. Drop the .glb under `public/models/battleground/`.
//   2. Fill in that rune's entry in RUNE_MODEL_DEFS below (url + targetHeight,
//      plus any rest rotation the export needs).
//   3. `node scripts/build_media_manifest.mjs generate` (automatic in
//      `npm run build`) so the asset is content-hashed into the manifest.
//   4. `tests/render_glb_replacement_assets.test.ts` then enforces that the file
//      exists on disk AND is manifested, no extra test wiring needed.
// Nothing else changes: the pad's spin/bob, its glow disc, and its bespoke
// effect kit (battleground_rune_vfx.ts) all sit outside the body and keep
// working against whatever shape is in the socket.
//
// A def left null keeps the procedural extruded solid battleground_props.ts
// builds (bolt / crossed swords / shield plate). That is the state today, so
// the fallback is the LIVE path, not dead code: it must stay correct.
//
// Loading follows the mailbox.ts precedent, the fetch registers with the boot
// preload gate at import time, so `startGame`'s `assetsReady()` await means
// `runeModelBody()` can answer synchronously from the pad's build path. The
// prepared template's geometries and materials are marked shared, so per-view
// disposal (pads are stateful and unpooled) never frees them out from under the
// next pad build; per-pad instances are `clone(true)` over that template.
import * as THREE from 'three';
import { type BgRuneType, RUNE_VISUALS } from '../sim/social/battleground';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

export interface RuneModelDef {
  /** Path under public/, e.g. '/models/battleground/sprint_rune.glb'. */
  readonly url: string;
  /** Yards tall the model is normalized to, whatever units it exported in. */
  readonly targetHeight: number;
  /** Rest yaw/pitch/roll (radians) applied before the pad's spinner yaws it. */
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
  /**
   * Where the model's own bounds sit on the spinner origin: 0 seats its base
   * there, 0.5 centers it (the default, the spinner hovers, so a centered
   * body reads better than one hanging from its feet).
   */
  readonly anchor?: number;
  /**
   * Emissive strength the rune color is pushed into the model's materials at,
   * so a plain diffuse export still blooms in the pad's color on high tiers.
   * 0 leaves the export's own materials untouched.
   */
  readonly emissive?: number;
  /**
   * Body opacity. Under 1 the pad reads as a conjured, lit-from-within token
   * rather than a physical object dropped on the field, which is what a rune
   * pickup IS. 1 keeps the export solid.
   */
  readonly opacity?: number;
}

/**
 * Registered custom bodies, per rune type. All null = every pad uses the
 * procedural fallback. Fill an entry in to swap that one pad over; the other
 * two are unaffected.
 */
export const RUNE_MODEL_DEFS: Record<BgRuneType, RuneModelDef | null> = {
  // Heights are chosen from each export's OWN aspect so no pad's body grows
  // wider than the disc it spins over (RUNE_DISC_R 1.05 => a 2.1yd pad): the
  // Battle plate is wide and short, the Ward shield tall and narrow, so
  // matching them on height alone would put the plate out past the rim.
  // Each body is translucent and lit from within in its own rune color, so the
  // pad reads as conjured. The emissive carries the color at distance (where
  // the export's own texture is a smudge) and the opacity is what makes the
  // effect kit BEHIND the body still show through it.
  sprint: {
    url: '/models/battleground/rune_sprint.glb',
    targetHeight: 1.3,
    emissive: 0.9,
    opacity: 0.62,
  },
  damage: {
    url: '/models/battleground/rune_damage.glb',
    targetHeight: 1.0,
    emissive: 0.9,
    opacity: 0.62,
  },
  defense: {
    url: '/models/battleground/rune_defense.glb',
    targetHeight: 1.25,
    // A quarter turn presents the shield's FACE at rest; the export's face
    // normal runs down x, so without this the pad's signature shape starts
    // edge-on and reads as a splinter.
    yaw: Math.PI / 2,
    emissive: 0.9,
    opacity: 0.62,
  },
};

const DEFAULT_ANCHOR = 0.5;
const DEFAULT_EMISSIVE = 0.85;
const DEFAULT_OPACITY = 1;

const templates = new Map<BgRuneType, THREE.Group>();

/**
 * Normalize a loaded scene into a pad-ready template: scaled to the def's
 * height, anchored on the spinner origin, rest-rotated, with cloned + shared
 * geometry/materials (loader cache results are immutable).
 */
export function prepareRuneModel(
  source: THREE.Object3D,
  def: RuneModelDef,
  color: number,
): THREE.Group {
  const instance = source.clone(true);
  const emissive = def.emissive ?? DEFAULT_EMISSIVE;
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry = markSharedGeometry(child.geometry.clone());
    const exported = Array.isArray(child.material) ? child.material[0] : child.material;
    const mat = exported.clone();
    if (emissive > 0 && 'emissive' in mat) {
      const lit = mat as THREE.Material & {
        emissive: THREE.Color;
        emissiveIntensity: number;
      };
      lit.emissive = new THREE.Color(color);
      lit.emissiveIntensity = emissive;
    }
    const opacity = def.opacity ?? DEFAULT_OPACITY;
    if (opacity < 1) {
      mat.transparent = true;
      mat.opacity = opacity;
      // depthWrite STAYS on. Turning it off is the usual reflex for a
      // transparent material, but these bodies self-overlap heavily (a boot
      // inside its own wings, crossed blades) and without depth they render as
      // a jumble of their own interior faces. Keeping it means the body blends
      // against the world but stays solid against ITSELF, tinted glass, which
      // is the read we want, not an x-ray.
      mat.depthWrite = true;
    }
    child.material = markSharedMaterial(mat);
    // Pads sit in the open on a bright field; a spinning body casting shadow
    // costs a shadow-map draw per pad for a silhouette nobody reads.
    child.castShadow = false;
    child.receiveShadow = false;
  });

  const bounds = new THREE.Box3().setFromObject(instance);
  const height = bounds.max.y - bounds.min.y;
  if (height > 1e-4) instance.scale.multiplyScalar(def.targetHeight / height);
  const scaled = new THREE.Box3().setFromObject(instance);
  const anchor = def.anchor ?? DEFAULT_ANCHOR;
  instance.position.y -= scaled.min.y + (scaled.max.y - scaled.min.y) * anchor;
  // Center the body on the spin axis. The pad's spinner yaws this group about
  // its own origin, so a body whose export is off-center horizontally would
  // ORBIT that origin instead of turning in place, and authored exports
  // routinely are off-center (the Slipstream model's x bounds run -0.18..0.52).
  instance.position.x -= (scaled.min.x + scaled.max.x) / 2;
  instance.position.z -= (scaled.min.z + scaled.max.z) / 2;

  const group = new THREE.Group();
  group.name = `runeModel_${def.url}`;
  group.rotation.set(def.pitch ?? 0, def.yaw ?? 0, def.roll ?? 0);
  group.add(instance);
  group.userData.assetUrl = def.url;
  return group;
}

// The DEFERRED lane, not the eager one: these models are only ever needed by a
// player who enters the band, so nothing here should be in flight while the
// launcher is still up.
if (typeof window !== 'undefined') {
  for (const [kind, def] of Object.entries(RUNE_MODEL_DEFS) as [
    BgRuneType,
    RuneModelDef | null,
  ][]) {
    if (!def) continue;
    registerDeferredPreload(() =>
      loadGltf(def.url).then((gltf) => {
        // The rune color is fixed per type (RUNE_VISUALS), so one prepared
        // template per type covers every pad of that type on the field.
        templates.set(kind, prepareRuneModel(gltf.scene, def, RUNE_VISUALS[kind].color));
        releaseGltf(def.url);
      }),
    );
  }
}

/**
 * A per-pad instance of the registered custom body, or null when that rune has
 * no model (or its load failed) and the procedural fallback should be built.
 */
export function runeModelBody(kind: BgRuneType): THREE.Group | null {
  const template = templates.get(kind);
  return template ? template.clone(true) : null;
}

/** Test-only window into the defs + prepared templates. */
export const battlegroundRuneModelPreloadInternalsForTest = {
  defs: RUNE_MODEL_DEFS,
  urls: (): string[] =>
    Object.values(RUNE_MODEL_DEFS)
      .filter((def): def is RuneModelDef => def !== null)
      .map((def) => def.url),
  templates,
};
