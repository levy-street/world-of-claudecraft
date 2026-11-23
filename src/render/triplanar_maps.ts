// Triplanar albedo/emissive sampling for the carve-interior material.
//
// The cavity mesher bakes DOMINANT-AXIS planar UVs per vertex: wherever the
// surface normal's biggest axis flips (all around a bowl's rim, and along the
// 45-degree lines between walls), the projection changes and the texture
// mirrors and kinks, a clean grid of seams etched across every large carve,
// glaring on high-contrast art like lava. Re-projecting in the fragment
// shader along all three world axes and blending by the normal removes the
// seams entirely; the baked uv attribute stays on the mesh (the normal map
// still rides it, its seam contribution is sub-noise next to the albedo's).
//
// The tiling period rides a uniform, so materials with different periods
// still share one compiled program.

import type * as THREE from 'three';

export function applyTriplanarMaps(mat: THREE.MeshStandardMaterial, tilePeriod: number): void {
  const scale = 1 / Math.max(0.25, tilePeriod);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTriScale = { value: scale };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTriPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vTriN = normal;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriN;
        uniform float uTriScale;
        vec4 wocTriplanar(sampler2D tex) {
          vec3 w = pow(abs(normalize(vTriN)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          return texture2D(tex, vTriPos.zy * uTriScale) * w.x +
            texture2D(tex, vTriPos.xz * uTriScale) * w.y +
            texture2D(tex, vTriPos.xy * uTriScale) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
        diffuseColor *= wocTriplanar(map);
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance *= wocTriplanar(emissiveMap).rgb;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'woc-triplanar-maps';
}
