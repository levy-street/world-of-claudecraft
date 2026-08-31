// The Forgefather raid-door mist gate: the owner's dungeon_entrance facade
// carries a red-painted membrane in its archway (the authored mist target,
// measured from the shipped GLB below), and every placed facade gets a
// boss-gate fog wall layered over that membrane: a dark smoky sheet for
// depth plus an additive red sheet that drifts and pulses off the shared
// uTime clock (classic sealed-boss-entrance mist, per the owner's
// direction). Built into the fortress zone-feature group, so the materials
// compile under its gated attach and the whole thing culls with the isle.
import * as THREE from 'three';
import type { IgnivarPropPlacement } from '../sim/ignivar_props';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

export const MIST_GATE_PROGRAM_CACHE_KEY = 'ignivar-mist-gate-v1';

// The red membrane's canonical-space bounds, measured from the shipped
// facade GLB (16 red-painted triangles: x +-0.2822, y 0.0371 to 0.3887,
// front face at z 0.1377). The sheets overfill it slightly so the shader's
// soft edge falloff fades out behind the stone jambs, and sit just proud
// of the facade's front face so depth testing never clips them against
// the membrane they cover.
const MIST_WIDTH = 0.62;
const MIST_HEIGHT = 0.42;
const MIST_CENTER_Y = 0.213;
const MIST_FORWARD_Z = 0.148;

export interface MistGateFrame {
  x: number;
  y: number;
  z: number;
  ry: number;
  scale: number;
}

/** The mist frames a placement set implies: one per placed facade. */
export function mistGateFramesFor(placements: readonly IgnivarPropPlacement[]): MistGateFrame[] {
  const frames: MistGateFrame[] = [];
  for (const p of placements) {
    if (p.key !== 'dungeon_entrance') continue;
    frames.push({ x: p.x, y: p.y, z: p.z, ry: p.ry, scale: p.scale });
  }
  return frames;
}

// Tileable mist noise (deterministic LCG; wrapped blob stamps so the
// drifting samples never show a seam). Grayscale: the shader reads .r.
let mistTex: THREE.CanvasTexture | null = null;

function mistNoiseTexture(): THREE.CanvasTexture | null {
  if (mistTex) return mistTex;
  if (typeof document === 'undefined') return null;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  let seed = 0x4d15;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 10 + rnd() * 26;
    const a = 0.05 + rnd() * 0.09;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  mistTex = tex;
  return tex;
}

const MAP_CHUNK = '#include <map_fragment>';
const COMMON_CHUNK = '#include <common>';

/** Splice the drifting dual-sample + soft edge + pulse into a basic
 *  material's map stage. pulseDepth is how far the sheet breathes toward
 *  transparent at the trough (the glow sheet breathes deep, the smoky
 *  backdrop barely). */
function decorateMistMaterial(
  material: THREE.MeshBasicMaterial,
  pulseDepth: number,
): THREE.MeshBasicMaterial {
  const depthUniform = { value: pulseDepth };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uMistPulseDepth = depthUniform;
    if (!shader.fragmentShader.includes(MAP_CHUNK)) {
      throw new Error(`ignivar mist gate shader is missing ${MAP_CHUNK}`);
    }
    // The whole splice stays inside USE_MAP: `map` and `vMapUv` exist only
    // under that define in the pinned three, and the constructors fail soft
    // to a map-less material when the noise canvas is unavailable. That arm
    // still pulses as a plain soft sheet instead of failing to compile.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        COMMON_CHUNK,
        `${COMMON_CHUNK}
uniform float uTime;
uniform float uMistPulseDepth;`,
      )
      .replace(
        MAP_CHUNK,
        `float mistPulse = 1.0 - uMistPulseDepth * (0.5 + 0.5 * sin(uTime * 1.55));
#ifdef USE_MAP
vec2 mistCentered = vMapUv - 0.5;
float mistEdge = 1.0 - smoothstep(0.26, 0.5, length(mistCentered * vec2(1.0, 0.92)));
vec2 mistUvA = vMapUv * 1.4 + vec2(uTime * 0.016, uTime * 0.037);
vec2 mistUvB = vMapUv * 2.3 - vec2(uTime * 0.024, uTime * 0.052);
float mistBody = texture2D( map, mistUvA ).r * 0.65 + texture2D( map, mistUvB ).r * 0.55;
diffuseColor.a *= mistEdge * mistBody * mistPulse;
#else
diffuseColor.a *= 0.55 * mistPulse;
#endif`,
      );
  };
  material.customProgramCacheKey = () => MIST_GATE_PROGRAM_CACHE_KEY;
  return material;
}

let planeGeo: THREE.BufferGeometry | null = null;
let hazeMat: THREE.MeshBasicMaterial | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;

function mistPlaneGeometry(): THREE.BufferGeometry {
  planeGeo ??= markSharedGeometry(new THREE.PlaneGeometry(1, 1));
  return planeGeo;
}

function mistHazeMaterial(): THREE.MeshBasicMaterial {
  if (!hazeMat) {
    hazeMat = markSharedMaterial(
      decorateMistMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x1c0e0c,
          map: mistNoiseTexture() ?? undefined,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
        0.15,
      ),
    );
  }
  return hazeMat;
}

function mistGlowMaterial(): THREE.MeshBasicMaterial {
  if (!glowMat) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4522,
      map: mistNoiseTexture() ?? undefined,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Additive surfaces can only fade toward black: scene fog would make
      // the distant gate ADD fog-colored light (the frost_sky rule). The
      // normal-blended haze sheet keeps fog, smoke fading is correct there.
      fog: false,
    });
    // Modest HDR lift so the composer tiers bloom the pulse; kept low
    // enough that the low tier (no bloom) reads it as deep red, not white.
    material.color.multiplyScalar(1.6);
    glowMat = markSharedMaterial(decorateMistMaterial(material, 0.5));
  }
  return glowMat;
}

export function resetIgnivarMistGateCaches(): void {
  planeGeo = null;
  hazeMat = null;
  glowMat = null;
  mistTex = null;
}

/** Append one mist wall per placed dungeon_entrance facade. Returns how
 *  many gates were appended. */
export function appendIgnivarMistGates(
  group: THREE.Group,
  placements: readonly IgnivarPropPlacement[],
): number {
  const frames = mistGateFramesFor(placements);
  for (const frame of frames) {
    const gate = new THREE.Group();
    gate.name = 'ignivarMistGate';
    const haze = new THREE.Mesh(mistPlaneGeometry(), mistHazeMaterial());
    haze.scale.set(MIST_WIDTH, MIST_HEIGHT, 1);
    haze.position.set(0, MIST_CENTER_Y, MIST_FORWARD_Z);
    haze.renderOrder = 1;
    gate.add(haze);
    const glow = new THREE.Mesh(mistPlaneGeometry(), mistGlowMaterial());
    glow.scale.set(MIST_WIDTH, MIST_HEIGHT, 1);
    glow.position.set(0, MIST_CENTER_Y, MIST_FORWARD_Z + 0.004);
    glow.renderOrder = 2;
    gate.add(glow);
    gate.position.set(frame.x, frame.y, frame.z);
    gate.rotation.y = frame.ry;
    gate.scale.setScalar(frame.scale);
    group.add(gate);
  }
  return frames.length;
}

export const ignivarMistGateInternalsForTest = {
  mistBounds: {
    width: MIST_WIDTH,
    height: MIST_HEIGHT,
    centerY: MIST_CENTER_Y,
    forwardZ: MIST_FORWARD_Z,
  },
  mistNoiseTexture,
  mistHazeMaterial,
  mistGlowMaterial,
};
