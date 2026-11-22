import * as THREE from 'three';
import { loadTexture } from '../assets/loader';

/**
 * The Paladin spec icons (Sunmender, Faithwarden, Dawnreaver, left to right)
 * as one distance-field atlas, built from the approved simplified artwork:
 * R the solid version's signed distance, G the line version's, B the flat
 * version's rose accent. Distances are in icon units (each cell spans
 * [-1, 1], y up) encoded as v = 0.5 - d / 1.2 (R, room for a soft halo)
 * and v = 0.5 - d / 0.6 (G).
 *
 * Demand-loaded with the Paladin kit, never at boot: the active kit recipe
 * (active_kit_prewarm.ts) fetches it when a Paladin kit is first requested and
 * uploads it in its own `upload-big:paladin-spec-icons` unit. Until that unit
 * has run on this renderer's context, every binder keeps its built-in emblem,
 * so the atlas never uploads inside a live frame.
 */
export const PALADIN_SPEC_ICONS_URL = '/vfx/paladin_spec_icons.webp';

let specIcons: THREE.Texture | null = null;
let loading: Promise<boolean> | null = null;
/** Bumped by a new renderer or a context restore: an upload belongs to one. */
let iconsContext = 0;
/** The context the atlas was last uploaded on (-1: none). */
let iconsUploadedOn = -1;

/** Start (or join) the atlas fetch: true once it has loaded, false when it
 *  failed (a later request fetches again). */
export function ensurePaladinSpecIcons(): Promise<boolean> {
  if (specIcons) return Promise.resolve(true);
  loading ??= loadTexture(PALADIN_SPEC_ICONS_URL).then(
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      specIcons = texture;
      return true;
    },
    () => {
      loading = null;
      return false;
    },
  );
  return loading;
}

/** The atlas once loaded (not necessarily uploaded); null before. */
export function paladinSpecIconsTexture(): THREE.Texture | null {
  return specIcons;
}

/** The kit recipe uploaded the atlas on the current context. */
export function markPaladinSpecIconsUploaded(): void {
  iconsUploadedOn = iconsContext;
}

/** A new renderer or a restored context: the atlas is not resident on it, so
 *  binders fall back to their emblems until the recipe uploads it again. */
export function markPaladinSpecIconsCold(): void {
  iconsContext++;
}

function iconsLive(): boolean {
  return specIcons !== null && iconsUploadedOn === iconsContext;
}

/** Uniforms a material adds to sample the atlas. */
export function paladinSpecIconUniforms(): {
  uSpecIcons: THREE.IUniform<THREE.Texture | null>;
  uSpecIconsReady: THREE.IUniform<number>;
} {
  return { uSpecIcons: { value: null }, uSpecIconsReady: { value: 0 } };
}

/** Binds the atlas into `material` once it is uploaded on this renderer's
 *  context; true when bound. Called every frame by the binders, so a context
 *  that went cold unbinds (no first-draw upload) until the recipe reruns. */
export function bindPaladinSpecIcons(material: THREE.ShaderMaterial): boolean {
  const ready = material.uniforms.uSpecIconsReady;
  if (!iconsLive()) {
    if (ready && ready.value !== 0) {
      ready.value = 0;
      material.uniforms.uSpecIcons.value = null;
    }
    return false;
  }
  if (ready?.value === 1 && material.uniforms.uSpecIcons.value === specIcons) return true;
  material.uniforms.uSpecIcons.value = specIcons;
  material.uniforms.uSpecIconsReady.value = 1;
  return true;
}

/** Test seam: stands a texture in for the atlas, loaded and (unless
 *  `uploaded` is false) uploaded on the current context. */
export function setPaladinSpecIconsForTest(texture: THREE.Texture | null, uploaded = true): void {
  specIcons = texture;
  loading = null;
  if (texture && uploaded) markPaladinSpecIconsUploaded();
  else iconsUploadedOn = -1;
}

/**
 * `paladinSpecIcon(p, spec)`: vec3(solid distance, line distance, rose accent)
 * at icon point p for spec 0 (Sunmender), 1 (Faithwarden) or 2 (Dawnreaver).
 */
export const PALADIN_SPEC_ICON_GLSL = `
  uniform sampler2D uSpecIcons;
  uniform float uSpecIconsReady;
  vec3 paladinSpecIcon(vec2 p,float spec){
    // Past the cell the distance carries on from its edge, so glows fade out
    // smoothly instead of stopping at the cell's border.
    vec2 c=clamp(p,-0.98,0.98);
    float beyond=length(p-c);
    vec3 t=texture2D(uSpecIcons,vec2((floor(spec+0.5)+c.x*0.5+0.5)/3.0,c.y*0.5+0.5)).rgb;
    return vec3((0.5-t.r)*1.2+beyond,(0.5-t.g)*0.6+beyond,beyond>0.0?0.0:t.b);
  }
`;
