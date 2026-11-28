import * as THREE from 'three';
import { cloneMaterialWithHooks } from './material_clone_hooks';

/**
 * One hue band of the shipped Maledict Eye and what the Rotmark paints it as.
 * Hues are 0..1 (deg / 360). `satScale` and `valueScale` multiply the texel's
 * own saturation and brightness, so the painted shading and detail survive.
 */
interface PaintBand {
  /** Centre of the shipped hue band. */
  from: number;
  /** Half-width of the band; texels fade out of it over its outer 40%. */
  spread: number;
  to: number;
  satScale: number;
  valueScale: number;
}

const ROTMARK_BANDS: readonly PaintBand[] = [
  // The purple iris turns the Rotmark's sick rot green.
  { from: 0.8, spread: 0.13, to: 0.27, satScale: 1, valueScale: 1.05 },
  // The teal sclera turns pale, yellowed bone.
  { from: 0.47, spread: 0.1, to: 0.14, satScale: 0.3, valueScale: 3 },
  // The navy shell, lids, and tail turn dark rotting olive.
  { from: 0.63, spread: 0.07, to: 0.2, satScale: 0.9, valueScale: 0.95 },
];

const PAINT_KEY = 'rotmark-familiar-paint-v2';

const glslFloat = (n: number): string => n.toFixed(4);

const PAINT_FUNCTIONS = /* glsl */ `
#include <common>
vec3 rotmarkHsv(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float chroma = hi - min(c.r, min(c.g, c.b));
  float hue = 0.0;
  if (chroma > 1e-5) {
    if (hi == c.r) hue = mod((c.g - c.b) / chroma, 6.0);
    else if (hi == c.g) hue = (c.b - c.r) / chroma + 2.0;
    else hue = (c.r - c.g) / chroma + 4.0;
    hue /= 6.0;
  }
  return vec3(hue, hi > 1e-5 ? chroma / hi : 0.0, hi);
}
vec3 rotmarkRgb(vec3 c) {
  vec3 k = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(k - 1.0, 0.0, 1.0), c.y);
}
vec3 rotmarkBand(vec3 rgb, vec3 hsv, float from, float spread, float to, float satScale, float valueScale) {
  float away = abs(hsv.x - from);
  away = min(away, 1.0 - away);
  float weight = (1.0 - smoothstep(spread * 0.6, spread, away)) * smoothstep(0.05, 0.15, hsv.y);
  vec3 painted = rotmarkRgb(vec3(to, clamp(hsv.y * satScale, 0.0, 1.0), min(1.0, hsv.z * valueScale)));
  return mix(rgb, painted, weight);
}
`;

const PAINT_CHUNK = `
#include <map_fragment>
{
  vec3 rotmarkSource = rotmarkHsv(diffuseColor.rgb);
${ROTMARK_BANDS.map(
  (band) =>
    `  diffuseColor.rgb = rotmarkBand(diffuseColor.rgb, rotmarkSource, ${glslFloat(band.from)}, ${glslFloat(band.spread)}, ${glslFloat(band.to)}, ${glslFloat(band.satScale)}, ${glslFloat(band.valueScale)});`,
).join('\n')}
}
`;

/**
 * Repaints the Maledict Eye familiar from its shipped purple and teal to the
 * Rotmark's rot green and bone, in the shader, so the generated GLB and its KTX2
 * textures stay as shipped. Each band keeps the texel's own shading and detail;
 * texels outside every band (highlights, near-black) are left alone.
 *
 * Patches every standard material under `root` in place, once. The familiar
 * calls this on its own copy of the loaded model, so the patched program is the
 * one the boot prewarm links and the live familiar draws.
 */
export function paintRotmarkFamiliar(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.rotmarkPainted) continue;
      material.userData.rotmarkPainted = true;
      // Chained under any hook the material already carries, and keyed on both,
      // so the paint never drops another layer or collides with its program.
      const priorHook = material.onBeforeCompile;
      const priorKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        priorHook.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', PAINT_FUNCTIONS)
          .replace('#include <map_fragment>', PAINT_CHUNK);
      };
      material.customProgramCacheKey = () => `${priorKey}|${PAINT_KEY}`;
      material.needsUpdate = true;
    }
  });
}

/**
 * A Rotmark-painted copy of the loaded familiar model. The loader cache stays
 * untouched (the editor's maledict_eye prop keeps its shipped purple): the copy
 * owns cloned materials, which still share the cache's geometry and textures.
 */
export function rotmarkPaintedCopy(source: THREE.Object3D): THREE.Object3D {
  const copy = source.clone(true);
  copy.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => cloneMaterialWithHooks(material))
      : cloneMaterialWithHooks(mesh.material);
  });
  paintRotmarkFamiliar(copy);
  return copy;
}
