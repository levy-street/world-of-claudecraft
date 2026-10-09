import { CAMERA_RELATIVE_GLSL } from './camera_relative_glsl';

// The Drowned Temple is flooded: a translucent, self-animating water sheet
// (driven by the shared uTime so it needs no per-frame plumbing) with cheap
// layered-sine caustics, a fresnel sheen and bioluminescent glow in the
// ripples. Nothing else in the game floods its floor, which is the point.
export const TEMPLE_WATER_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
  uniform float uTime;
  varying vec3 vWPos;
  #include <fog_pars_vertex>
  void main() {
    vec3 pos = position;
    pos.y += sin(uTime * 1.3 + pos.x * 0.5) * 0.02 + sin(uTime * 0.9 + pos.z * 0.42) * 0.02;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    // Name this mvPosition: the fog_vertex chunk reads mvPosition for vFogDepth,
    // so a different name fails to compile once USE_FOG is defined (outdoor fog).
    vec4 mvPosition = wocCamRelView(wp.xyz);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
export const TEMPLE_WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  varying vec3 vWPos;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = 0.12 + 0.88 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    // layered-sine caustic web (three octaves so the veins read from any angle)
    vec2 p = vWPos.xz;
    float c = sin(p.x * 0.8 + uTime * 1.1) * sin(p.y * 0.75 - uTime * 0.95)
            + 0.6 * sin((p.x - p.y) * 0.55 + uTime * 0.8)
            + 0.4 * sin((p.x + p.y) * 1.3 - uTime * 1.4);
    float caust = smoothstep(0.5, 1.5, c * 0.5 + 0.7);
    // slow deep/shallow banding so the sheet never reads as a flat slab
    vec3 col = mix(uDeep, uShallow, 0.45 + 0.45 * sin(p.x * 0.18 + p.y * 0.12 + uTime * 0.3));
    col += uGlow * caust;                            // bright bioluminescent veins
    col = mix(col, uShallow * 1.35, fres * 0.55);    // glassy fresnel sheen at grazing
    float alpha = clamp(0.72 + caust * 0.22, 0.0, 0.97);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
