// Brennoch's burner plume: the shader half of the exhaust.
//
// The geometry half is authored in Blender (scripts/assets/deepglass/dg_plume.py
// -> models/cosmetics/brennoch_plume.glb) as four nested parts, and the point of
// authoring it rather than scaling a cone is that every vertex arrives already
// knowing where it sits in the plume:
//
//   uv.x    where it is AROUND the plume, 0..1
//   uv.y    how far ALONG it, 0 at the nozzle mouth, 1 at the veil's tip, and
//           past 1 out on the tail ribbons
//   aData.x how far ACROSS a ribbon it is, 0 on the spine and 1 at the edge
//   aData.y a per-ribbon seed, so the three do not wobble in lockstep
//
// With that in hand there are no texture fetches and no object-space guesswork:
// the heat gradient, the volumetric edge, the shock banding and the turbulence
// are all functions of two numbers the mesh carries.
//
// What replaced what. The old burners were the jetpack GLB's own `fire.*` cones
//, a straight taper with a circular section, lit by a gas-ring shader that
// guttered on a timer. It read as an orange traffic cone, and the gutter (right
// for a pilot light) read as a pack failing whenever the throttle was open. The
// four parts now do different jobs and are driven apart:
//
//   wash   fixed collar at the mouth; does NOT stretch, so the plume always
//          looks socketed into the nozzle however long the rest runs
//   core   white-hot spike, brightest at the shock pinches the mesh already has
//   veil   the long soft envelope, lit at its silhouette so it reads as volume
//   tail   flat ribbons whipping past the tip, all turbulence and no shape
//
// Additive and depth-write-off throughout: this is light in water, and the world
// bloom does the rest of the work.

import * as THREE from 'three';
import { GFX, sharedUniforms } from './gfx';

/**
 * Composer-gated HDR headroom, the same idiom every other bright VFX in the
 * renderer uses (props.ts delvePortalMaterial's uHdr, vfx.ts hdr(), the pillar
 * colour boosts). Bloom is a high-pass in LINEAR HDR at BLOOM_THRESHOLD = 1.32
 * (post.ts), so a flame that writes below 1.0 can never bloom no matter how
 * hot its colour reads: the plume shipped without this and sat just under the
 * line, which is exactly what "dim, not exciting, it used to glow" looks like.
 * With no composer there is nothing to bloom into, so the gain drops to 1.
 *
 * Read at MATERIAL-BUILD time, never at module scope: `GFX` is a live binding
 * that is reassigned once the graphics tier resolves (gfx.ts), so a constant
 * captured at import would bake in the boot default and miss the player's
 * actual tier. Every other VFX in the renderer reads it the same way.
 */
function plumeHdr(): number {
  return GFX.composer ? 2.8 : 1.0;
}

/** The four authored parts, in the order they are stacked. */
export type PlumePart = 'wash' | 'core' | 'veil' | 'tail';

/** Live state every part of one burner shares. */
export interface PlumeDrive {
  /** Smoothed throttle, 0..1. Length, width and brightness all ride this. */
  heat: { value: number };
  /** Throttle genuinely OPEN, 0..1, hotter and whiter, not merely bigger. */
  burn: { value: number };
  /** The shove: a spike on ignition and on any hard change of direction. */
  surge: { value: number };
}

/** Per-part character. Everything that makes the four look like one thing doing
 *  four jobs rather than four cones of different sizes. */
interface PartSpec {
  /** Base colour at the nozzle; the gradient runs from here toward the tip. */
  tint: THREE.Color;
  /** Overall brightness multiplier. */
  gain: number;
  /** 0 = brightest through the middle (a solid core), 1 = brightest at the
   *  silhouette (a shell you see the far side of). */
  rim: number;
  /** Sharpness of that falloff. */
  rimPow: number;
  /** Shock-diamond banding depth, synced to the pinches in the core's profile. */
  band: number;
  /** Lateral turbulence amplitude, in local units at the tip. */
  turb: number;
  /** How much of this part's LENGTH answers the throttle. 0 pins it. */
  grow: number;
  /** Same for width. */
  fat: number;
  /** Where along the plume this part starts and finishes fading out. */
  fade: THREE.Vector2;
  /** 1 for the flat ribbons: fall off across the strip rather than off the
   *  normal, which on a flat quad points the same way everywhere. */
  ribbon: number;
}

const PARTS: Record<PlumePart, PartSpec> = {
  wash: {
    tint: new THREE.Color(1.0, 0.93, 0.76),
    gain: 1.1,
    rim: 0.8,
    rimPow: 1.6,
    band: 0,
    turb: 0.0,
    grow: 0,
    fat: 0.35,
    fade: new THREE.Vector2(0.6, 1.0),
    ribbon: 0,
  },
  core: {
    tint: new THREE.Color(1.0, 0.96, 0.86),
    gain: 3.2,
    rim: 0.22,
    rimPow: 1.1,
    band: 0.55,
    turb: 0.02,
    grow: 1,
    fat: 0.9,
    fade: new THREE.Vector2(0.72, 1.0),
    ribbon: 0,
  },
  veil: {
    tint: new THREE.Color(1.0, 0.52, 0.15),
    gain: 2.0,
    rim: 0.78,
    rimPow: 1.45,
    band: 0.16,
    turb: 0.055,
    grow: 1,
    fat: 1,
    fade: new THREE.Vector2(0.45, 1.0),
    ribbon: 0,
  },
  tail: {
    tint: new THREE.Color(1.0, 0.34, 0.07),
    gain: 1.2,
    rim: 0,
    rimPow: 1,
    band: 0,
    turb: 0.13,
    grow: 1,
    fat: 0.8,
    fade: new THREE.Vector2(0.62, 1.45),
    ribbon: 1,
  },
};

/** Name of the node each part is authored under in the GLB. */
export const PLUME_NODES: Record<PlumePart, string> = {
  wash: 'plume_wash',
  core: 'plume_core',
  veil: 'plume_veil',
  tail: 'plume_tail',
};

const VERT = /* glsl */ `
  attribute vec2 aData;
  uniform float uTime;
  uniform float uHeat;
  uniform float uBurn;
  uniform float uSurge;
  uniform float uPhase;
  uniform float uTurb;
  uniform float uGrow;
  uniform float uFat;
  varying vec2 vAxis;
  varying vec2 vData;
  varying float vRim;

  void main() {
    vAxis = uv;
    vData = aData;
    float v = uv.y;
    vec3 p = position;

    // Stretch from the MOUTH, never about the middle: v is already measured
    // from the nozzle, so scaling the axis leaves the socket where it is.
    float len = mix(0.30, 1.0, uHeat) * (1.0 + uSurge * 0.38);
    p.y *= mix(1.0, len, uGrow);
    float fat = mix(0.52, 1.0, uHeat) * (1.0 + uSurge * 0.16);
    float k = mix(1.0, fat, uFat);
    p.x *= k;
    p.z *= k;

    // Turbulence: nothing at the mouth, everything at the tip. Two frequencies
    // so it churns instead of swinging, seeded per ribbon.
    float t = uTime * (4.6 + uBurn * 4.4) + uPhase * 6.2831;
    float amp = uTurb * v * v * (0.42 + 0.58 * uBurn) * (1.0 + uSurge * 0.7);
    p.x += (sin(t * 1.7 + v * 9.3 + aData.y * 31.0) + 0.45 * sin(t * 3.1 + v * 17.0)) * amp;
    p.z += (cos(t * 1.3 + v * 7.9 + aData.y * 17.0) + 0.45 * cos(t * 2.7 + v * 14.0)) * amp;
    // The whip: the far end trails the near end, so a plume swinging round a
    // corner bends instead of rotating rigidly.
    p.y += sin(t * 0.9 + aData.y * 11.0) * amp * 0.5;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

// NO `precision` line here, however conventional it looks. Three prepends its
// own precision prefix to BOTH stages of a ShaderMaterial, and every uniform
// this pair shares, uTime, uHeat, uBurn, uSurge, uPhase, is declared in both.
// Overriding the fragment stage to mediump makes those declarations disagree,
// and GLSL will not link a program whose uniform precisions differ. The failure
// is silent in the ordinary way: the shaders both COMPILE, the link fails, and
// all you get is a stream of `useProgram: program not valid` warnings and an
// effect that renders nothing at all while every uniform reads correct.
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform float uBurn;
  uniform float uSurge;
  uniform float uPhase;
  uniform vec3 uTint;
  uniform float uGain;
  uniform float uRim;
  uniform float uRimPow;
  uniform float uBand;
  uniform float uRibbon;
  uniform vec2 uFade;
  varying vec2 vAxis;
  varying vec2 vData;
  varying float vRim;

  void main() {
    float v = vAxis.y;
    float heat = uHeat;
    if (heat <= 0.004) discard;

    // Heat gradient down the plume: white at the nozzle, through yellow and
    // orange, to a deep red that gives out. A burn shifts the whole ramp
    // hotter rather than only brighter, which is what reads as more thrust.
    float g = clamp(v / max(uFade.y, 0.001), 0.0, 1.0);
    g = pow(clamp(g, 0.0, 1.0), mix(1.35, 0.85, uBurn));
    vec3 col = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.76, 0.28), smoothstep(0.0, 0.13, g));
    col = mix(col, vec3(1.0, 0.38, 0.06), smoothstep(0.11, 0.40, g));
    col = mix(col, vec3(0.80, 0.10, 0.02), smoothstep(0.38, 0.88, g));
    col *= uTint;

    // Cross-section falloff. A shell reads as a volume when its SILHOUETTE is
    // the bright part (you are seeing through more of it edge-on); a core reads
    // as solid when its middle is. Flat ribbons have one normal everywhere, so
    // they fall off across the strip instead.
    float shell = mix(1.0 - vRim, vRim, uRim);
    shell = 0.14 + 0.86 * pow(clamp(shell, 0.0, 1.0), uRimPow);
    float across = 1.0 - vData.x * vData.x;
    across = across * across * across;
    float shape = mix(shell, across, uRibbon);

    // Shock diamonds. Two cycles down the core, matched to the pinches already
    // in its profile, and brightest where the jet is NARROWEST, which is where
    // a real mach disc sits.
    float band = 1.0 + uBand * (-cos(v * 12.566) * 0.5 + 0.5) * (0.45 + 0.55 * uBurn);

    // Flicker: fast, small, and out of phase between the two burners.
    float flick = 0.86 + 0.14 * sin(uTime * 23.0 + uPhase * 7.0) * sin(uTime * 13.7 + v * 4.0);

    float fade = 1.0 - smoothstep(uFade.x, uFade.y, v);
    float a = shape * fade * heat * flick * band;
    a *= 1.0 + uSurge * 0.5;
    if (a <= 0.004) discard;
    // NOT premultiplied: AdditiveBlending here uses SrcAlphaFactor, so the GPU
    // multiplies by alpha again. Writing col*a scaled every pixel by alpha
    // squared, costing 40 to 60 percent of the plume's brightness on its own
    // (the sibling additive shaders, deepglass_rush and deepglass_wake, both
    // write this un-premultiplied form).
    gl_FragColor = vec4(col * uGain * (1.0 + 0.6 * uBurn), a);
  }
`;

/**
 * Build one burner's four materials, all sharing `drive`.
 *
 * `phase` offsets the flicker and the turbulence so the two burners on a pack
 * never churn in lockstep, pass 0 and 0.5.
 */
export function createPlumeMaterials(
  drive: PlumeDrive,
  phase: number,
): Record<PlumePart, THREE.ShaderMaterial> {
  const out = {} as Record<PlumePart, THREE.ShaderMaterial>;
  const hdr = plumeHdr();
  for (const key of Object.keys(PARTS) as PlumePart[]) {
    const spec = PARTS[key];
    out[key] = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uHeat: drive.heat,
        uBurn: drive.burn,
        uSurge: drive.surge,
        uPhase: { value: phase },
        uTint: { value: spec.tint },
        uGain: { value: spec.gain * hdr },
        uRim: { value: spec.rim },
        uRimPow: { value: spec.rimPow },
        uBand: { value: spec.band },
        uTurb: { value: spec.turb },
        uGrow: { value: spec.grow },
        uFat: { value: spec.fat },
        uFade: { value: spec.fade.clone() },
        uRibbon: { value: spec.ribbon },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }
  return out;
}

/** Denormalise an attribute into plain floats. `getX`… already undo the
 *  normalisation; `setXYZ` would not re-apply it, so anything that edits a
 *  quantised buffer in place silently corrupts it. */
function toFloat(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const k = attr.itemSize;
  const out = new Float32Array(attr.count * k);
  for (let i = 0; i < attr.count; i++) {
    out[i * k] = attr.getX(i);
    if (k > 1) out[i * k + 1] = attr.getY(i);
    if (k > 2) out[i * k + 2] = attr.getZ(i);
    if (k > 3) out[i * k + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, k);
}

/**
 * Put a freshly loaded plume back into the space it was authored in.
 *
 * The shader stretches the plume by scaling object-space Y, which is only the
 * same thing as "stretch it out of the nozzle" while the mesh's own origin IS
 * the nozzle. Two things in the way, both of them invisible until the plume
 * turns up in the wrong place:
 *
 *  - the asset pipeline's meshopt pass QUANTISES positions into a normalised
 *    box and puts the offset and scale back on the node, so raw object space
 *    becomes a unit cube centred on the part's own bounding box;
 *  - glTF's V axis runs the other way from Blender's, so the authored
 *    "distance along the plume" arrives inverted, and the tail's deliberate
 *    v > 1 arrives negative.
 *
 * So: bake the node transform down into the vertices, un-flip V, and hand the
 * second UV set over under a name of our own (GLTFLoader parks TEXCOORD_1 on
 * whichever attribute name the three build of the day uses, and a
 * ShaderMaterial only declares the extra sets behind defines). Once, on the
 * template, before anything clones it, clones share these buffers.
 */
export function preparePlumeGeometry(root: THREE.Object3D): void {
  // Guarded per geometry, not per mesh: baking a node matrix twice would apply
  // it twice. Nothing in this GLB shares one, but a future part might.
  const done = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (done.has(geo)) return;
    done.add(geo);

    geo.setAttribute('position', toFloat(geo.getAttribute('position')));
    const normal = geo.getAttribute('normal');
    if (normal) geo.setAttribute('normal', toFloat(normal));

    const uv = geo.getAttribute('uv');
    if (uv) {
      const flipped = toFloat(uv);
      for (let i = 0; i < flipped.count; i++) flipped.setY(i, 1 - flipped.getY(i));
      geo.setAttribute('uv', flipped);
    }
    const second = geo.getAttribute('uv1') ?? geo.getAttribute('uv2');
    // No second set (a build from before the pipeline kept them): zeroes read
    // as "spine of a ribbon, seed 0", which simply looks plain.
    geo.setAttribute(
      'aData',
      second
        ? toFloat(second)
        : new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2),
    );

    mesh.updateMatrix();
    geo.applyMatrix4(mesh.matrix);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    geo.computeBoundingSphere();
    // The vertex shader stretches and wobbles the plume outside the bounds the
    // rest pose implies, so the sphere is padded rather than the culling
    // switched off, a plume behind the camera is 8 additive draws of pure
    // overdraw per wearer, and there can be ten of them in a bout.
    if (geo.boundingSphere) geo.boundingSphere.radius *= 1.75;
  });
}
