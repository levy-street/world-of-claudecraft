// The palette lab's sky: a zenith-to-horizon gradient the dome blends over its
// HDRI under `?palette=on` only (sky.ts splices this block after the biome
// tint and before the day/night grade, so night still darkens a palette sky
// and the dawn/dusk glow still lands on top). Clouds survive the recolour: a
// low-saturation HDRI pixel keeps its own brightness and takes only a hint of
// the gradient hue, while the blue between them is replaced outright.
//
// Shared uniform objects, like the haze field: the lab writes them once and
// the dome reads them by reference. `uPalSkyZenith.a` is the blend amount, 0
// leaves the HDRI sky exactly as shipped.

import { Vector4 } from 'three';

export interface PaletteSkyUniforms {
  /** rgb: zenith radiance (linear, intensity applied), a: blend amount. */
  uPalSkyZenith: { value: Vector4 };
  /** rgb: horizon radiance (linear, intensity applied), a: cloud keep 0..1. */
  uPalSkyHorizon: { value: Vector4 };
}

const uniforms: PaletteSkyUniforms = {
  uPalSkyZenith: { value: new Vector4(0, 0, 0, 0) },
  uPalSkyHorizon: { value: new Vector4(0, 0, 0, 1) },
};

export function paletteSkyUniforms(): PaletteSkyUniforms {
  return uniforms;
}

export const PALETTE_SKY_DECLARATIONS = /* glsl */ `
  uniform vec4 uPalSkyZenith;
  uniform vec4 uPalSkyHorizon;
`;

/** Statement block over the dome's `vec3 c` and view `dir`. */
export const PALETTE_SKY_GLSL = /* glsl */ `
    if (uPalSkyZenith.a > 0.001) {
      float wocPalT = pow(clamp(dir.y, 0.0, 1.0), 0.55);
      vec3 wocPalGrad = mix(uPalSkyHorizon.rgb, uPalSkyZenith.rgb, wocPalT);
      float wocPalMax = max(c.r, max(c.g, c.b));
      float wocPalSat = (wocPalMax - min(c.r, min(c.g, c.b))) / max(wocPalMax, 1e-4);
      float wocPalCloud = (1.0 - smoothstep(0.1, 0.32, wocPalSat)) * uPalSkyHorizon.a;
      float wocPalLum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float wocPalGradLum = max(dot(wocPalGrad, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
      vec3 wocPalCloudCol = mix(vec3(wocPalLum), wocPalGrad * (wocPalLum / wocPalGradLum), 0.3);
      vec3 wocPalTarget = mix(wocPalGrad, max(wocPalCloudCol, wocPalGrad), wocPalCloud);
      c = mix(c, wocPalTarget, uPalSkyZenith.a);
    }
`;
