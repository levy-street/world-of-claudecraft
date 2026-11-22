import * as THREE from 'three';
import { loadTexture } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';

/**
 * The Paladin spec icons (Sunmender, Faithwarden, Dawnreaver, left to right)
 * as one distance-field atlas, built from the approved simplified artwork:
 * R the solid version's signed distance, G the line version's, B the flat
 * version's rose accent. Distances are in icon units (each cell spans
 * [-1, 1], y up) encoded as v = 0.5 - d / 1.2 (R, room for a soft halo)
 * and v = 0.5 - d / 0.6 (G).
 */
export const PALADIN_SPEC_ICONS_URL = '/vfx/paladin_spec_icons.png';

let specIcons: THREE.Texture | null = null;
// Deferred like every world-art fetch.
registerDeferredPreload(() =>
  loadTexture(PALADIN_SPEC_ICONS_URL).then((texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    specIcons = texture;
    return texture;
  }),
);

/** The atlas once loaded; until then effects draw their built-in emblems. */
export function paladinSpecIconsTexture(): THREE.Texture | null {
  return specIcons;
}

/** Uniforms a material adds to sample the atlas. */
export function paladinSpecIconUniforms(): {
  uSpecIcons: THREE.IUniform<THREE.Texture | null>;
  uSpecIconsReady: THREE.IUniform<number>;
} {
  return { uSpecIcons: { value: null }, uSpecIconsReady: { value: 0 } };
}

/** Binds the atlas into `material` once it has loaded; true when bound. */
export function bindPaladinSpecIcons(material: THREE.ShaderMaterial): boolean {
  if (material.uniforms.uSpecIconsReady?.value === 1) return true;
  if (!specIcons) return false;
  const texture = specIcons;
  material.uniforms.uSpecIcons.value = texture;
  material.uniforms.uSpecIconsReady.value = 1;
  return true;
}

/** Test seam: stands a texture in for the loaded atlas. */
export function setPaladinSpecIconsForTest(texture: THREE.Texture | null): void {
  specIcons = texture;
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
