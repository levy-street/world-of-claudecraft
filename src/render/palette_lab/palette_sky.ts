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
  /** x: painted cumulus strength 0..1 (0 skips the layer); y: top of the
   *  horizon fog band as a view elevation (0 keeps the shipped band); zw reserved. */
  uPalClouds: { value: Vector4 };
}

const uniforms: PaletteSkyUniforms = {
  uPalSkyZenith: { value: new Vector4(0, 0, 0, 0) },
  uPalSkyHorizon: { value: new Vector4(0, 0, 0, 1) },
  uPalClouds: { value: new Vector4(0, 0, 0, 0) },
};

export function paletteSkyUniforms(): PaletteSkyUniforms {
  return uniforms;
}

export const PALETTE_SKY_DECLARATIONS = /* glsl */ `
  uniform vec4 uPalSkyZenith;
  uniform vec4 uPalSkyHorizon;
  uniform vec4 uPalClouds;
`;

/**
 * The painted cumulus layer, spliced after the gradient. Clouds live on a flat
 * deck projected from the view direction (so they shrink and crowd toward the
 * horizon like real weather), shaped by a few octaves of the dome's own value
 * noise with soft painterly edges, and lit from the live sun's side: a cool
 * blue-grey underside, near-white crowns. A uniform branch skips the whole block
 * for every look with clouds at 0, so stock skies pay nothing.
 */
export const PALETTE_CLOUDS_GLSL = /* glsl */ `
    if (uPalClouds.x > 0.001 && dir.y > 0.0) {
      // pow(, 0.6) eases the deck's perspective squash, so clouds near the
      // hills keep a cumulus height instead of thinning into streaks.
      vec2 wocCloudP = dir.xz / pow(max(dir.y + 0.12, 0.0), 0.6) * 1.25 + vec2(uTime * 0.0035, uTime * 0.0012);
      vec2 wocCloudSun = normalize(uSunDirLive.xz + vec2(1e-4, 0.0)) * 0.09;
      float wocCloudA = 0.0;
      float wocCloudB = 0.0;
      float wocCloudAmp = 0.55;
      float wocCloudOctave = 1.0;
      vec2 wocCloudQ = wocCloudP;
      for (int i = 0; i < 5; i++) {
        wocCloudA += noise2(wocCloudQ) * wocCloudAmp;
        // B samples a step toward the zenith (smaller deck radius) and the sun:
        // inside a cloud's lower half that point is still cloud, so it shades.
        wocCloudB += noise2(wocCloudQ * 0.94 + wocCloudSun * wocCloudOctave) * wocCloudAmp;
        wocCloudQ = wocCloudQ * 2.03 + vec2(17.1, 9.3);
        wocCloudAmp *= 0.5;
        wocCloudOctave *= 2.0;
      }
      // Coverage: billowy masses with soft brushed edges.
      float wocCloudMask = smoothstep(0.52, 0.58, wocCloudA);
      // Light: denser toward the sun means a shaded flank; thinner means lit.
      float wocCloudLit = clamp(0.55 + (wocCloudA - wocCloudB) * 7.0, 0.0, 1.0);
      float wocCloudLum = max(dot(uPalSkyHorizon.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
      vec3 wocCloudTop = vec3(wocCloudLum * 1.4) * vec3(1.0, 0.985, 0.95);
      vec3 wocCloudUnder = mix(uPalSkyZenith.rgb, uPalSkyHorizon.rgb, 0.6) * 0.92;
      vec3 wocCloudCol = mix(wocCloudUnder, wocCloudTop, wocCloudLit);
      // Drawn after the day/night grade, so take it here: grey out and dim
      // with the sky at night.
      float wocCloudGrey = dot(wocCloudCol, vec3(0.2126, 0.7152, 0.0722));
      wocCloudCol = mix(wocCloudCol, vec3(wocCloudGrey), uNightDesat) * uDayNight;
      float wocCloudFade = smoothstep(0.015, 0.16, dir.y) * (1.0 - smoothstep(0.86, 0.99, dir.y));
      c = mix(c, wocCloudCol, wocCloudMask * wocCloudFade * uPalClouds.x);
    }
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
