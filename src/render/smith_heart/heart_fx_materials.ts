// The Smith's Heart's VFX materials: small texture-free shaders for the
// raid's structural moments (heart_seal.ts, heart_portal.ts, heart_room.ts):
//   - a light volume (a beam, a column, a pour): additive, fading up its
//     height, with bands of light running along it;
//   - a floor ring (a shockwave): an additive band at a radius;
//   - the vortex: four spiral arms in the four vein colours round a
//     white-gold eye, turning inward;
//   - the funnel: a twisting sleeve of the same four colours;
//   - motes: shader-driven points (no per-frame CPU), each riding its own
//     seed along a path the vertex shader computes;
//   - the core: the Smith's heart, a slow molten surface that beats.
// Every one is built at interior build inside the interior group, so the
// renderer's compile gate links it before the first frame (a hidden mesh's
// material links too: three's compile walks the whole subtree); none reads a
// texture, so nothing uploads on first use. Each factory returns a fresh
// material: its uniforms are the owning slot's state.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';

const NOISE = /* glsl */ `
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), u.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const FOUR = /* glsl */ `
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
vec3 fourColour(float k) {
  float s = fract(k) * 4.0;
  vec3 a = s < 1.0 ? uC0 : s < 2.0 ? uC1 : s < 3.0 ? uC2 : uC3;
  vec3 b = s < 1.0 ? uC1 : s < 2.0 ? uC2 : s < 3.0 ? uC3 : uC0;
  return mix(a, b, smoothstep(0.55, 1.0, fract(s)));
}
`;

/** The four vein colours as uniforms (Hammer, Breath, Quench, Heat). */
function fourColourUniforms(): Record<string, THREE.IUniform> {
  return {
    uC0: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS.hammer) },
    uC1: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS.breath) },
    uC2: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS.quench) },
    uC3: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS.heat) },
  };
}

function additive(name: string, opts: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    ...opts,
  });
}

/** A light volume on a cylinder or a ribbon whose uv.y runs foot (0) to top
 *  (1): additive, brightest at the foot, bands running up (`uFlow` > 0) or
 *  down (< 0). `uK` is its strength (0 draws black, i.e. nothing). */
export function heartBeamMaterial(color: number, name: string, flow = 1): THREE.ShaderMaterial {
  return additive(name, {
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uK: { value: 0 },
      uFlow: { value: flow },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRim;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uK; uniform float uFlow; uniform float uTime;
      varying vec2 vUv; varying float vRim;
      void main() {
        float up = 1.0 - vUv.y;
        float bands = 0.65 + 0.35 * sin((vUv.y * 9.0 - uTime * 2.6 * uFlow) * 3.14159);
        float streak = 0.75 + 0.25 * sin(vUv.x * 37.7 + vUv.y * 4.0 - uTime * 1.3 * uFlow);
        float edge = pow(vRim, 1.3);
        float a = uK * up * up * bands * streak * (0.35 + 0.65 * edge);
        vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), 0.35 * up) * a;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** A floor ring on a flat disc of radius 1 (scaled to the reach): a bright
 *  band at `uR` (0 to 1 of the disc) in the four colours, a soft wake inside.
 *  `uK` is its strength. */
export function heartRingMaterial(name: string, mono?: number): THREE.ShaderMaterial {
  return additive(name, {
    uniforms: {
      ...fourColourUniforms(),
      uMono: { value: new THREE.Color(mono ?? 0xffffff) },
      uUseMono: { value: mono === undefined ? 0 : 1 },
      uR: { value: 0 },
      uK: { value: 0 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${FOUR}
      uniform float uR; uniform float uK; uniform float uTime;
      uniform vec3 uMono; uniform float uUseMono;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float band = smoothstep(0.06, 0.0, abs(r - uR)) + 0.5 * smoothstep(0.03, 0.0, abs(r - uR * 0.82));
        float wake = smoothstep(uR, uR * 0.55, r) * step(r, uR) * 0.3;
        float ang = atan(vP.x, vP.y) / 6.2831853 + 0.5;
        vec3 c = mix(mix(fourColour(ang + uTime * 0.05), uMono, uUseMono), vec3(1.0, 0.95, 0.85), 0.35);
        float a = uK * (band + wake) * (1.0 - uR * 0.6);
        gl_FragColor = vec4(c * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** The vortex on a flat disc of radius 1: four spiral arms in the four vein
 *  colours turning inward round a white-gold eye. `uK` grows it (0 to 1). */
export function heartVortexMaterial(name: string): THREE.ShaderMaterial {
  return additive(name, {
    uniforms: {
      ...fourColourUniforms(),
      uK: { value: 0 },
      uSpin: { value: 1 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOUR}
      uniform float uK; uniform float uSpin; uniform float uTime;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        float k = clamp(uK, 0.0, 1.0);
        float reach = mix(0.05, 1.0, k);
        float ang = atan(vP.x, vP.y);
        float t = uTime * uSpin;
        // Four arms, each a log spiral drawn inward.
        float arm = ang * 4.0 / 6.2831853 + log(max(r, 0.02)) * 1.6 + t * 0.55;
        float armMask = pow(0.5 + 0.5 * cos(arm * 6.2831853), 3.0);
        float turb = vnoise(vec2(ang * 3.0 + t, r * 6.0 - t * 2.0));
        vec3 c = fourColour(floor(fract(arm) * 4.0) / 4.0 + 0.125 + turb * 0.05);
        float eye = smoothstep(0.32, 0.0, r);
        float fadeOut = smoothstep(reach, reach * 0.72, r);
        float body = (armMask * (0.55 + 0.45 * turb) + 0.18) * fadeOut;
        vec3 col = c * body * 1.3 + vec3(1.0, 0.93, 0.78) * eye * (1.6 + 0.4 * sin(t * 5.0));
        col += vec3(0.02, 0.015, 0.03) * (1.0 - fadeOut);
        gl_FragColor = vec4(col * k, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** The funnel over the vortex, on an open cylinder whose uv.y runs foot to
 *  top: a twisting sleeve of the four colours, brightest low, rising.
 *  `uK` is its strength. */
export function heartFunnelMaterial(name: string): THREE.ShaderMaterial {
  return additive(name, {
    side: THREE.DoubleSide,
    uniforms: {
      ...fourColourUniforms(),
      uK: { value: 0 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRim;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOUR}
      uniform float uK; uniform float uTime;
      varying vec2 vUv; varying float vRim;
      void main() {
        float twist = vUv.x * 4.0 + vUv.y * 2.4 - uTime * 0.35;
        float strand = pow(0.5 + 0.5 * cos(twist * 6.2831853), 4.0);
        float n = vnoise(vec2(vUv.x * 12.0 + uTime * 0.4, vUv.y * 6.0 - uTime * 1.6));
        float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        float edge = 0.3 + 0.7 * pow(1.0 - vRim, 1.5);
        vec3 c = fourColour(floor(fract(twist) * 4.0) / 4.0 + 0.125);
        c = mix(c, vec3(1.0, 0.95, 0.85), 0.08 + 0.22 * (1.0 - vUv.y) * n);
        float a = uK * fade * (strand * 0.85 + 0.12 * n) * edge;
        gl_FragColor = vec4(c * a * 1.5, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Motes riding up a spiral round an axis: each point's `seed` attribute
 * (x: phase, y: radius scale, z: speed) places it; the vertex shader moves
 * it, so the CPU never touches the buffer. `uK` fades them all.
 */
export function heartMoteMaterial(
  name: string,
  opts: { radius: number; height: number; size: number; spin: number; color?: number },
): THREE.ShaderMaterial {
  return additive(name, {
    uniforms: {
      ...fourColourUniforms(),
      uK: { value: 0 },
      uTime: sharedUniforms.uTime,
      uRadius: { value: opts.radius },
      uHeight: { value: opts.height },
      uSize: { value: opts.size },
      uSpin: { value: opts.spin },
      uTint: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uUseTint: { value: opts.color === undefined ? 0 : 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 seed;
      uniform float uTime; uniform float uRadius; uniform float uHeight; uniform float uSize; uniform float uSpin;
      varying float vLife; varying float vHue;
      void main() {
        float life = fract(seed.x + uTime * seed.z * 0.12);
        float ang = seed.x * 6.2831853 * 7.0 + life * uSpin * 6.2831853;
        float r = uRadius * seed.y * (1.0 - 0.55 * life);
        vec3 p = vec3(sin(ang) * r, life * uHeight, cos(ang) * r);
        vLife = life; vHue = seed.x;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Sized with distance, capped so a mote by the camera never blooms.
        gl_PointSize = min(uSize * (0.6 + 0.8 * seed.y) * (300.0 / max(1.0, -mv.z)), 9.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${FOUR}
      uniform float uK; uniform vec3 uTint; uniform float uUseTint;
      varying float vLife; varying float vHue;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.0, d);
        float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
        vec3 c = mix(fourColour(vHue), uTint, uUseTint);
        c = mix(c, vec3(1.0), soft * soft * 0.5);
        gl_FragColor = vec4(c * soft * fade * uK, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Seeds for `count` motes (deterministic: a golden-ratio walk, no rng). */
export function heartMoteGeometry(count: number): THREE.BufferGeometry {
  const seeds = new Float32Array(count * 3);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = (i * 0.618034) % 1;
    seeds[i * 3 + 1] = 0.35 + ((i * 0.754877) % 1) * 0.65;
    seeds[i * 3 + 2] = 0.6 + ((i * 0.56984) % 1) * 0.8;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  // The shader places every mote; a generous sphere keeps the cloud drawn.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 40);
  return g;
}

/** The Smith's heart: a molten white-gold surface that churns slowly and
 *  beats (a double beat every `uBeat` seconds), on a sphere. */
export function heartCoreMaterial(name: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    fog: false,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uBeat: { value: 2.2 },
      uLevel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying float vRim;
      void main() {
        vN = normal; vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vRim = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime; uniform float uBeat; uniform float uLevel;
      varying vec3 vN; varying vec3 vP; varying float vRim;
      void main() {
        vec3 n = normalize(vN);
        vec2 uv = vec2(atan(n.x, n.z) * 1.6, n.y * 3.0);
        float t = uTime * 0.08;
        float churn = vnoise(uv * 3.0 + vec2(t, -t * 1.3)) * 0.6 + vnoise(uv * 7.0 - vec2(t * 2.0, t)) * 0.4;
        float ph = fract(uTime / uBeat);
        float beat = exp(-pow((ph - 0.08) * 22.0, 2.0)) + 0.6 * exp(-pow((ph - 0.24) * 22.0, 2.0));
        vec3 deep = vec3(0.55, 0.22, 0.05);
        vec3 hot = vec3(1.0, 0.86, 0.55);
        vec3 white = vec3(1.0, 0.98, 0.92);
        vec3 col = mix(deep, hot, smoothstep(0.25, 0.75, churn));
        col = mix(col, white, smoothstep(0.7, 0.95, churn) * 0.8);
        col *= 1.1 + beat * 0.9;
        col += hot * pow(1.0 - vRim, 2.0) * (0.8 + beat);
        // The heart going dark: embers of it, never black.
        col *= mix(0.1, 1.0, uLevel);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * The crystal of the seal, its heart, the spires and the shards (the Ring
 * kit's glow slot: a grey facet shade per vertex): dark smoky crystal with
 * a hint of its vein's colour while the vein is dark; lit (`uLevel`), the
 * light runs through it from one end (`uFill` 0 to 1 along the radius from
 * the seal's boss, `uAxis` 0, or up its height, `uAxis` 1, over `uSpan`) and
 * it burns in its colour, the facets brighter, a white flare on `uFlare`.
 * Unlit by the scene (it is its own light), instanced or not.
 */
export function heartCrystalMaterial(name: string, color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    fog: false,
    vertexColors: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uLevel: { value: 0 },
      uFill: { value: 0 },
      uFlare: { value: 0 },
      uAxis: { value: 0 },
      uSpan: { value: new THREE.Vector2(1.85, 9) },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      uniform float uAxis; uniform vec2 uSpan;
      varying vec3 vShade; varying float vT; varying float vRim; varying float vH;
      void main() {
        vShade = color;
        vec3 p = position;
        vT = clamp((mix(length(p.xz), p.y, uAxis) - uSpan.x) / max(0.001, uSpan.y - uSpan.x), 0.0, 1.0);
        vH = p.x * 0.7 + p.y * 1.3 + p.z * 0.9;
        vec4 w = vec4(p, 1.0);
        #ifdef USE_INSTANCING
          w = instanceMatrix * w;
        #endif
        vec4 mv = modelViewMatrix * w;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          n = mat3(instanceMatrix) * n;
        #endif
        vRim = abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLevel; uniform float uFill; uniform float uFlare;
      uniform float uAxis; uniform float uTime;
      varying vec3 vShade; varying float vT; varying float vRim; varying float vH;
      void main() {
        float shade = vShade.r;
        float rim = pow(1.0 - vRim, 2.0);
        // Dark: smoky crystal, a breath of its colour in the facets.
        vec3 dark = mix(vec3(0.06, 0.06, 0.07), uColor * 0.22, 0.22) * (0.5 + 0.7 * shade) + uColor * rim * 0.06;
        // The light runs in from the rim (or up the spire) behind a hot front.
        float front = mix(1.0 - uFill, uFill, uAxis);
        float lit = mix(smoothstep(front - 0.04, front + 0.04, vT), 1.0 - smoothstep(front - 0.04, front + 0.04, vT), uAxis);
        lit *= step(0.0001, uFill);
        float edge = smoothstep(0.08, 0.0, abs(vT - front)) * step(0.0001, uFill) * step(uFill, 0.999);
        float pulse = 0.82 + 0.18 * sin(uTime * 1.7 + vH * 0.6);
        vec3 burn = uColor * (0.55 + 1.1 * shade) * pulse * uLevel + mix(uColor, vec3(1.0), 0.6) * rim * uLevel * 0.9;
        vec3 col = mix(dark, burn, lit);
        col += vec3(1.0, 0.97, 0.9) * (edge * 1.4 + uFlare * (0.6 + rim));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A light-river's bright ribbon: its vein's colour flowing toward the seal
 * (bands running along `aArc`, the yards from its source), and a white-hot
 * surge riding at `uHead` (yards) while the light runs, its wake trailing.
 */
export function heartRiverSurgeMaterial(name: string, color: number): THREE.ShaderMaterial {
  return additive(name, {
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHead: { value: -1 },
      uK: { value: 0.95 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      attribute float aArc;
      attribute float aSide;
      varying float vArc; varying float vAcross;
      void main() {
        vArc = aArc;
        vAcross = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uHead; uniform float uK; uniform float uTime;
      varying float vArc; varying float vAcross;
      void main() {
        float flow = 0.72 + 0.28 * sin(vArc * 0.9 - uTime * 5.0) * sin(vArc * 0.31 - uTime * 2.1 + 1.3);
        float core = 1.0 - 0.45 * vAcross * vAcross;
        float d = uHead - vArc;
        float head = uHead < 0.0 ? 0.0 : exp(-d * d * 0.06) * 2.6 + step(0.0, d) * exp(-d * 0.08) * 0.9;
        vec3 col = uColor * flow * core * uK + mix(uColor, vec3(1.0, 0.97, 0.9), 0.65) * head;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
