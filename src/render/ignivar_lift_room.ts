// The forge-lift antechamber's render half: the car never moves, the
// SURROUNDINGS sell the descent. Two pieces, both attached into the
// approach dressing group (so they compile under the interior's gated
// attach and dispose with it):
//  - the lift gate views (sealed / open portcullis, an in-place template
//    swap the renderer rebuilds on, the raid-gate discipline: both poses
//    share one frame so the threshold never pops), and
//  - the shaft illusion: sheets outside the car's grille walls whose
//    girders and passing floor-lights scroll UPWARD on the shared uTime
//    clock (the car "descends"), plus self-animating ember dust rising
//    through the car. Zero per-frame CPU: every motion lives in shaders
//    driven by sharedUniforms.uTime.
import * as THREE from 'three';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

export const IGNIVAR_LIFT_GATE_HEIGHT = 7.2;
// The portcullis frame's half width (the doorway in the car's exit wall).
const IGNIVAR_LIFT_GATE_HALF_WIDTH = 5;
export const LIFT_SHAFT_PROGRAM_CACHE_KEY = 'ignivar-lift-shaft-v1';
export const LIFT_DUST_PROGRAM_CACHE_KEY = 'ignivar-lift-dust-v1';

// The car interior the shaft sheets wrap: the Forge-Lift's OWN room
// (interior 'ignivar_lift', shell walls at x +-10, z +-8), its sides
// lined by grille props at x +-8. The sheets hang between the grilles
// and the shell wall's inner face (x 9), so the bars read against the
// moving shaft.
const ROOM_GRILLE_X = 8;
const CAR_Z_MIN = -8;
const CAR_Z_MAX = 8;
const SHAFT_HEIGHT = 16; // the ignivar double wall course
const SHAFT_SHEET_X = 8.7;

/** The sealed lift gate renders NOTHING by the owner's direction: the car
 *  wall itself seals the room (crossing is a teleport, never physical),
 *  and the owner dresses the doorway with the lift kit's own door pieces.
 *  On arrival the unlock swaps the entity to 'dungeon_door', which takes
 *  the standard arch-and-swirl portal body: the portal appearing IS the
 *  visible cue that the ride is over. */
export function buildIgnivarLiftGate(_open: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ignivar-lift-gate-hidden';
  return group;
}

// -- the shaft illusion -----------------------------------------------------

/** Splice the descending-shaft scroll into a basic material: girder ridges
 *  and a bright passing floor-light band ride local Y minus uTime, so the
 *  pattern climbs and the static car reads as sinking. */
function decorateShaftMaterial(material: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying vec2 vLiftShaft;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vLiftShaft = vec2(position.x, position.y);`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
varying vec2 vLiftShaft;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float liftPhase = fract(vLiftShaft.y * 0.09 - uTime * 0.55);
float liftGirder = smoothstep(0.0, 0.045, liftPhase) * smoothstep(0.13, 0.085, liftPhase);
float liftBand = smoothstep(0.47, 0.505, liftPhase) * smoothstep(0.585, 0.55, liftPhase);
float liftRib = 0.86 + 0.14 * sin(vLiftShaft.x * 2.6);
vec3 liftShaftColor = vec3(0.052, 0.034, 0.028) * (0.65 + 0.7 * liftGirder) * liftRib;
liftShaftColor += vec3(2.3, 0.72, 0.18) * liftBand;
diffuseColor.rgb = liftShaftColor;`,
      );
  };
  material.customProgramCacheKey = () => LIFT_SHAFT_PROGRAM_CACHE_KEY;
  return material;
}

let shaftGeo: THREE.BufferGeometry | null = null;
let shaftMat: THREE.MeshBasicMaterial | null = null;

function shaftSheetGeometry(): THREE.BufferGeometry {
  shaftGeo ??= markSharedGeometry(
    new THREE.PlaneGeometry(Math.abs(CAR_Z_MAX - CAR_Z_MIN) + 2.4, SHAFT_HEIGHT),
  );
  return shaftGeo;
}

function shaftSheetMaterial(): THREE.MeshBasicMaterial {
  shaftMat ??= markSharedMaterial(
    decorateShaftMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })),
  );
  return shaftMat;
}

// Rising ember dust inside the car: each particle loops its own phase on
// uTime in the vertex shader (the arena-atmosphere idiom), so the cloud
// animates with zero per-frame CPU.
const DUST_VERT = `
attribute float aPhase;
uniform float uTime;
varying float vFade;
void main() {
  float cycle = 6.5;
  float t = mod(aPhase * cycle + uTime * (0.55 + fract(aPhase * 7.31) * 0.5), cycle) / cycle;
  vec3 p = position;
  p.y += t * 9.0;
  p.x += sin(uTime * 0.7 + aPhase * 41.0) * 0.35;
  vFade = sin(t * 3.14159);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (30.0 * (0.5 + fract(aPhase * 3.7) * 0.5)) / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = `
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = 1.0 - smoothstep(0.15, 0.5, length(c));
  gl_FragColor = vec4(vec3(1.6, 0.55, 0.14) * d * vFade, d * vFade * 0.55);
}`;

let dustMat: THREE.ShaderMaterial | null = null;

function dustMaterial(): THREE.ShaderMaterial {
  if (!dustMat) {
    dustMat = markSharedMaterial(
      new THREE.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: { uTime: sharedUniforms.uTime },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    dustMat.customProgramCacheKey = () => LIFT_DUST_PROGRAM_CACHE_KEY;
  }
  return dustMat;
}

function buildDustCloud(count: number): THREE.Points {
  // Deterministic LCG scatter (never Math.random in render generation).
  let seed = 0x11f7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const carDepth = Math.abs(CAR_Z_MAX - CAR_Z_MIN);
  for (let index = 0; index < count; index++) {
    positions[index * 3] = (rnd() * 2 - 1) * (ROOM_GRILLE_X - 1);
    positions[index * 3 + 1] = rnd() * 1.5;
    positions[index * 3 + 2] = CAR_Z_MIN + 1 + rnd() * (carDepth - 2);
    phases[index] = rnd();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();
  const points = new THREE.Points(geometry, dustMaterial());
  points.name = 'ignivarLiftDust';
  points.frustumCulled = true;
  return points;
}

/** Build the shaft illusion around the car (dressing-group coordinates:
 *  the same instance-local space the prop placements use). */
export function buildIgnivarLiftShaft(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ignivarLiftShaft';
  const zCenter = (CAR_Z_MAX + CAR_Z_MIN) / 2;
  for (const side of [-1, 1]) {
    const sheet = new THREE.Mesh(shaftSheetGeometry(), shaftSheetMaterial());
    sheet.name = side < 0 ? 'liftShaftWest' : 'liftShaftEast';
    sheet.position.set(side * SHAFT_SHEET_X, SHAFT_HEIGHT / 2, zCenter);
    sheet.rotation.y = (side * Math.PI) / 2;
    group.add(sheet);
  }
  group.add(buildDustCloud(lowGfx ? 20 : 44));
  return group;
}

// -- the moving machinery ---------------------------------------------------
// The owner's lift props are single baked meshes, so the motion lives in
// the vertex shader: a position-derived REGION of each mesh moves on the
// shared uTime clock while the rest stands still. Region constants are
// measured from the shipped GLBs (canonical space: xz-centred, base y 0,
// dims normalized, or the WHOLE mesh for the spool). The spool turns on
// its axle inside the static mount (the owner's winch remake) and the
// beam's hanging sheave wheel spins. The brake handle, the retired
// one-piece winch, and the sliding door deliberately do NOT move (the
// owner retired the door's cycle with the mist-veiled facade portals).
export const LIFT_SPOOL_PROGRAM_CACHE_KEY = 'ignivar-lift-spool-v1';
export const LIFT_BEAM_PROGRAM_CACHE_KEY = 'ignivar-lift-beam-v1';

/** Compose a masked vertex motion into a material, preserving any prior
 *  onBeforeCompile hook and cache key. `vertexGlsl` runs after
 *  begin_vertex with `transformed` live and may use ignivarLiftMask(p);
 *  `normalGlsl` (optional) runs after beginnormal_vertex. */
function decorateLiftMotion(
  material: THREE.Material,
  cacheKey: string,
  maskGlsl: string,
  vertexGlsl: string,
  normalGlsl = '',
): THREE.Material {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
float ignivarLiftMask(vec3 p) { return ${maskGlsl}; }`,
    );
    if (normalGlsl) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
{
${normalGlsl}
}`,
      );
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
${vertexGlsl}
}`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${cacheKey}`;
  return material;
}

/** The spool turns WHOLE about its x-axis axle (measured at y 0.378 on
 *  the shipped GLB): the owner split the winch so the mount stands still
 *  and this entire piece is the moving half, no region mask needed. */
export function decorateLiftSpoolMaterial(material: THREE.Material): THREE.Material {
  return decorateLiftMotion(
    material,
    LIFT_SPOOL_PROGRAM_CACHE_KEY,
    '1.0',
    `float a = uTime * 1.8;
float ca = cos(a);
float sa = sin(a);
vec3 q = transformed - vec3(0.0, 0.378, 0.0);
transformed = vec3(q.x, q.y * ca - q.z * sa, q.y * sa + q.z * ca) + vec3(0.0, 0.378, 0.0);`,
    `float nA = uTime * 1.8;
float nCa = cos(nA);
float nSa = sin(nA);
objectNormal = vec3(objectNormal.x, objectNormal.y * nCa - objectNormal.z * nSa,
  objectNormal.y * nSa + objectNormal.z * nCa);`,
  );
}

/** The beam's hanging sheave wheel (the mid-span lobe under the bar,
 *  radius ~0.08 about its axle at y 0.08) spins about the z axle. */
export function decorateLiftBeamMaterial(material: THREE.Material): THREE.Material {
  return decorateLiftMotion(
    material,
    LIFT_BEAM_PROGRAM_CACHE_KEY,
    'step(abs(p.x), 0.11) * step(p.y, 0.17)',
    `float mask = ignivarLiftMask(position);
float a = uTime * 2.1 * mask;
float ca = cos(a);
float sa = sin(a);
vec3 q = transformed - vec3(0.0, 0.08, 0.0);
transformed = mix(transformed, vec3(q.x * ca - q.y * sa, q.x * sa + q.y * ca, q.z) + vec3(0.0, 0.08, 0.0), mask);`,
    `float nMask = ignivarLiftMask(position);
float nA = uTime * 2.1 * nMask;
float nCa = cos(nA);
float nSa = sin(nA);
objectNormal = mix(
  objectNormal,
  vec3(objectNormal.x * nCa - objectNormal.y * nSa,
    objectNormal.x * nSa + objectNormal.y * nCa, objectNormal.z),
  nMask
);`,
  );
}

export const ignivarLiftRoomInternalsForTest = {
  shaftSheetMaterial,
  dustMaterial,
  decorateLiftBeamMaterial,
  decorateLiftSpoolMaterial,
  roomGrilleX: ROOM_GRILLE_X,
  carZMin: CAR_Z_MIN,
  carZMax: CAR_Z_MAX,
  shaftSheetX: SHAFT_SHEET_X,
};
