// Gloamveil's living shadow pool: a dark stain on the ground under the Shadow
// priest that ripples and throws out tendrils, leaves a short fading wake of
// smaller stains where the priest just walked, and on the entry erupts past
// its rest size while a ring of shadow races out over the floor.
//
// World-space, never parented to a rig (a rig turns, scales and bobs; a stain
// on the floor does not). Each stain is a small grid DRAPED on the real floor
// through the renderer's own seed-bound ground sampler, the one every other
// floor effect is handed. That sampler is costly, so the pool and its wake
// read the floor through the field's remembered grid of it (GloamGround) and
// the ring, whose grid is coarse and which lives a second, samples only the
// vertices its racing front is about to reach. The decisions (where it lies,
// what a vertex does where the floor breaks away, what a lay costs) are the
// pure gloam_pool_core.ts; this file is the meshes.
//
// Every stain of every pool draws with ONE of two materials (the pool's and
// the ring's), which the field builds once and links behind its compile gate
// (gloam_field.ts). What differs per stain (its opacity, its growth, its seed)
// is written into that material's uniforms in the stain's own onBeforeRender,
// three's sanctioned path for per-object uniforms on a shared ShaderMaterial,
// so a pool appearing or a wake stain dropping mints no material. A pool whose
// wearer is gone is parked and handed to the next wearer (gloam_field.ts keeps
// a bounded few), so a camera turning away and back mints no buffer either.

import * as THREE from 'three';
import { floorVfxLayerTopOrder } from './floor_vfx_layer';
import {
  createGloamFloor,
  createGloamWake,
  createGloamWindow,
  GLOAM_BREAK_HEIGHT,
  GLOAM_POOL_FADE,
  GLOAM_POOL_LIFT,
  GLOAM_POOL_SIZE,
  GLOAM_RING_EDGE,
  GLOAM_RING_LEAD_SECONDS,
  GLOAM_RING_SIZE,
  GLOAM_WAKE_SECONDS,
  GLOAM_WAKE_SIZE,
  type GloamDrapeBudget,
  type GloamGround,
  gloamDrapeFade,
  gloamDrapeHeight,
  gloamEruptGrow,
  gloamFloorInto,
  gloamRedrapeDue,
  gloamRingAt,
  gloamRingFront,
  gloamWakeAlpha,
  gloamWakeGrow,
  gloamWakeStep,
  gloamWindowFill,
  gloamWindowHeight,
} from './gloam_pool_core';
import { setRenderCategory } from './renderer_diagnostics';

/** Cells along one side of a wake stain and of the shock ring. */
const WAKE_CELLS = 6;
const RING_CELLS = 18;
/**
 * Every stain (the pool, its wake, the entry ring) sits on the top rung of the
 * GROUND band, which nothing else uses: over the world's own marks, and under
 * every player-band and encounter-band piece. The pool is near-black and
 * normal-blended, so anything it painted over would be hidden: a Consecration,
 * a Ring of Frost, a meteor's footprint are ground a player reacts to, and all
 * of them paint over it from here. Nothing shares the rung, so the order
 * against every other floor piece is fixed, whatever the camera does.
 */
const FLOOR_ORDER = floorVfxLayerTopOrder('ground');

const VERTEX_SHADER = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vFade = aFade;
    // Camera-relative (modelViewMatrix is composed on the CPU in doubles), then
    // pulled a hand toward the camera along its own view ray: same pixels,
    // always in front of the floor it lies on, on any slope and at any world
    // coordinate (a dungeon instance sits a hundred thousand yards out).
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dc = max(length(mv.xyz), 1e-3);
    mv.xyz -= mv.xyz * (min(0.16, dc * 0.25) / dc);
    gl_Position = projectionMatrix * mv;
  }
`;

const POOL_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vFade;
  uniform float uClock;
  uniform float uAlpha;
  uniform float uSeed;
  uniform float uGrow;
  void main() {
    float r = length(vUv) / uGrow;
    float a = atan(vUv.y, vUv.x + 1e-6); // guarded: atan(0,0) is undefined
    float t = uClock;
    // tendrils: the rim reaches out in pointed lobes that stretch and draw back
    float reach =
      0.24 * pow(clamp(0.5 + 0.5 * sin(a * 5.0 + uSeed + 0.8 * sin(t * 0.7 + a * 2.0)), 0.0, 1.0), 3.0) *
        (0.6 + 0.4 * sin(t * 1.1 + a * 3.0 + uSeed)) +
      0.2 * pow(clamp(0.5 + 0.5 * sin(a * 9.0 - t * 0.9 + uSeed * 2.0), 0.0, 1.0), 4.0) *
        (0.55 + 0.45 * sin(t * 1.9 - a * 2.0)) +
      0.05 * sin(t * 1.6 + a * 3.0);
    float edge = 0.4 + reach;
    float body = 1.0 - smoothstep(edge - 0.14, edge, r);
    float alpha = body * 0.88 * uAlpha * vFade;
    if (alpha < 0.01) discard;
    // slow rings rolling outward across the surface
    float ripple = 0.5 + 0.5 * sin(r * 16.0 - t * 2.0 + uSeed);
    float rim = smoothstep(edge - 0.2, edge - 0.03, r) * body;
    vec3 col = mix(vec3(0.045, 0.02, 0.09), vec3(0.006, 0.003, 0.012), body);
    col += vec3(0.2, 0.07, 0.5) * rim * 0.55;
    col += vec3(0.03, 0.012, 0.07) * ripple * 0.3 * body;
    gl_FragColor = vec4(col, alpha);
  }
`;

// The shock ring: a band of darkness racing outward over the floor, a violet
// edge leading it and a thinning wash of shadow left inside.
const RING_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vFade;
  uniform float uClock;
  uniform float uAlpha;
  uniform float uSeed;
  uniform float uGrow;
  void main() {
    float r = length(vUv);
    float a = atan(vUv.y, vUv.x + 1e-6); // guarded: atan(0,0) is undefined
    float front = uGrow * (0.94 + 0.06 * sin(a * 11.0 + uSeed));
    float band = smoothstep(front - 0.2, front - 0.02, r) * (1.0 - smoothstep(front, front + 0.03, r));
    float wash = (1.0 - smoothstep(0.0, front, r)) * 0.35;
    float edge = smoothstep(front - 0.05, front, r) * (1.0 - smoothstep(front, front + 0.03, r));
    float alpha = max(band * 0.9, wash) * uAlpha * vFade;
    if (alpha < 0.01) discard;
    vec3 col = vec3(0.008, 0.004, 0.018) + vec3(0.42, 0.16, 1.0) * edge * 0.9;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** The two materials every stain draws with, and the clock they share. */
export interface GloamFloorMaterials {
  pool: THREE.ShaderMaterial;
  ring: THREE.ShaderMaterial;
  /** Seconds for the tendrils and ripples; held still under reduced motion. */
  clock: { value: number };
}

function floorMaterial(fragmentShader: string, clock: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uClock: clock,
      uAlpha: { value: 0 },
      uSeed: { value: 0 },
      uGrow: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader,
  });
}

export function createGloamFloorMaterials(): GloamFloorMaterials {
  const clock = { value: 0 };
  const pool = floorMaterial(POOL_FRAGMENT_SHADER, clock);
  pool.name = 'gloam_pool';
  const ring = floorMaterial(RING_FRAGMENT_SHADER, clock);
  ring.name = 'gloam_ring';
  return { pool, ring, clock };
}

/** One draped stain. */
interface Stain {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  position: Float32Array;
  fade: Float32Array;
  alpha: number;
  grow: number;
  seed: number;
  /** Half the side of its grid, yards. */
  half: number;
  /** Seconds a wake stain has left. */
  life: number;
  /** Its last lay read every node it stands on (none was still unknown). */
  whole: boolean;
  /** The ring: how many vertices, nearest its centre first, are laid. */
  reached: number;
}

function makeStain(
  material: THREE.ShaderMaterial,
  size: number,
  cells: number,
  seed: number,
): Stain {
  const geometry = new THREE.PlaneGeometry(size, size, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const fade = new THREE.BufferAttribute(new Float32Array(position.count).fill(1), 1);
  geometry.setAttribute('aFade', fade);
  // Both are rewritten on every lay, which a walking wearer asks for several
  // times a second.
  position.setUsage(THREE.DynamicDrawUsage);
  fade.setUsage(THREE.DynamicDrawUsage);
  // Draping moves vertices by at most the break height, so one fixed bound
  // covers every lay and the stain culls without a recompute.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    size * Math.SQRT1_2 + GLOAM_BREAK_HEIGHT + 0.2,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = FLOOR_ORDER;
  mesh.visible = false;
  setRenderCategory(mesh, 'vfx');
  const stain: Stain = {
    mesh,
    geometry,
    position: position.array as Float32Array,
    fade: fade.array as Float32Array,
    alpha: 0,
    grow: 1,
    seed,
    half: size / 2,
    life: 0,
    whole: true,
    reached: 0,
  };
  const uniforms = material.uniforms;
  mesh.onBeforeRender = () => {
    uniforms.uAlpha.value = stain.alpha;
    uniforms.uGrow.value = stain.grow;
    uniforms.uSeed.value = stain.seed;
    material.uniformsNeedUpdate = true;
  };
  return stain;
}

/** A hidden stain on each floor material, so a compile of the field's root
 *  links both programs with the mesh shape the live stains draw. */
export function buildGloamFloorStandIns(materials: GloamFloorMaterials): THREE.Mesh[] {
  const pool = makeStain(materials.pool, 1, 1, 0).mesh;
  pool.name = 'gloam_pool:stand-in';
  const ring = makeStain(materials.ring, 1, 1, 0).mesh;
  ring.name = 'gloam_ring:stand-in';
  return [pool, ring];
}

/** One reused read of the grid nodes under a stain. */
const WINDOW = createGloamWindow();

function flatten(stain: Stain): void {
  const position = stain.position;
  for (let i = 1; i < position.length; i += 3) position[i] = 0;
  stain.fade.fill(1);
}

function uploaded(stain: Stain): void {
  stain.geometry.getAttribute('position').needsUpdate = true;
  stain.geometry.getAttribute('aFade').needsUpdate = true;
}

/**
 * Lay `stain` on the floor around (x, z), whose own floor there is `baseY`. A
 * flat lay touches no ground. A draped one reads the floor between the nodes
 * of `ground`; a vertex over ground still unknown (the allowance ran out) is
 * left as it was. Returns whether the lay was whole.
 */
function drape(
  stain: Stain,
  x: number,
  z: number,
  baseY: number,
  flat: boolean,
  ground: GloamGround,
  groundY: (x: number, z: number) => number,
  budget: GloamDrapeBudget,
): boolean {
  stain.mesh.position.set(x, baseY + GLOAM_POOL_LIFT, z);
  if (flat) {
    flatten(stain);
    uploaded(stain);
    return true;
  }
  const position = stain.position;
  const fade = stain.fade;
  const unknown = gloamWindowFill(ground, x, z, stain.half, groundY, budget, WINDOW);
  for (let i = 0, v = 0; i < position.length; i += 3, v++) {
    const height = gloamWindowHeight(WINDOW, x + position[i], z + position[i + 2]);
    if (Number.isNaN(height)) continue;
    const rise = height - baseY;
    position[i + 1] = gloamDrapeHeight(rise);
    fade[v] = gloamDrapeFade(rise);
  }
  uploaded(stain);
  return unknown === 0;
}

/** The ring's vertices, nearest the centre first, and how far out each lies as
 *  a share of the half side. One table per grid: every ring shares it. */
interface RingOrder {
  vertex: Uint16Array;
  radius: Float32Array;
}
let ringOrder: RingOrder | null = null;

function ringOrderOf(stain: Stain): RingOrder {
  if (ringOrder) return ringOrder;
  const position = stain.position;
  const count = position.length / 3;
  const radius = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    radius[v] = Math.hypot(position[v * 3], position[v * 3 + 2]) / stain.half;
  }
  const vertex = new Uint16Array(count);
  for (let v = 0; v < count; v++) vertex[v] = v;
  vertex.sort((a, b) => radius[a] - radius[b]);
  ringOrder = { vertex, radius };
  return ringOrder;
}

/**
 * Lay the entry ring as far out as `front` (0 to 1 of its half side), which
 * the caller takes a moment ahead of where the darkness is. The ring only
 * ever draws what lies behind its front, so a vertex is sampled just before
 * the darkness reaches it: the lay is spread over the second the ring lasts,
 * and its corners, which the front never reaches, are never sampled at all.
 */
function reachRing(
  ring: Stain,
  front: number,
  groundY: (x: number, z: number) => number,
  budget: GloamDrapeBudget,
): void {
  const order = ringOrderOf(ring);
  const position = ring.position;
  const at = ring.mesh.position;
  const baseY = at.y - GLOAM_POOL_LIFT;
  const limit = front + GLOAM_RING_EDGE;
  const first = ring.reached;
  while (ring.reached < order.vertex.length) {
    const v = order.vertex[ring.reached];
    if (order.radius[v] > limit || !budget.take()) break;
    const rise = groundY(at.x + position[v * 3], at.z + position[v * 3 + 2]) - baseY;
    position[v * 3 + 1] = gloamDrapeHeight(rise);
    ring.fade[v] = gloamDrapeFade(rise);
    ring.reached += 1;
  }
  if (ring.reached !== first) uploaded(ring);
}

function disposeStain(stain: Stain): void {
  stain.mesh.removeFromParent();
  stain.geometry.dispose();
}

const ringScratch = { grow: 0, alpha: 0 };

/** The pool, wake and entry ring of one wearer. Owns its geometries; the two
 *  materials belong to the field. */
export class GloamPool {
  private readonly pool: Stain;
  private readonly wake: Stain[] = [];
  private ring: Stain | null = null;
  private floor = createGloamFloor();
  private trail = createGloamWake();
  /** Seconds into the entry; past it the pool rests. */
  private eruptAge = Number.POSITIVE_INFINITY;
  private ringPending = false;
  /** The ring lies flat (on a deck, or far away): nothing of it is sampled. */
  private ringFlat = false;
  /** Where, and how, the pool was last laid. */
  private laidX = Number.NaN;
  private laidY = Number.NaN;
  private laidZ = Number.NaN;
  private laidFlat = false;
  private laidWhole = false;
  private fadeIn = 0;
  /** A wearer was presented since the last animate. */
  private present = false;

  /**
   * `cells` is the side of the pool's grid: fixed for the life of the pool, so
   * the field replaces a pool whose tier changed rather than resizing it.
   */
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly materials: GloamFloorMaterials,
    readonly cells: number,
  ) {
    this.pool = makeStain(materials.pool, GLOAM_POOL_SIZE, cells, 1.7);
    this.pool.mesh.name = 'gloam_pool';
    parent.add(this.pool.mesh);
  }

  /**
   * The wearer is gone: take every stain out of the scene and forget where the
   * pool lay, keeping the geometries. `revive` hands it to the next wearer.
   */
  park(): void {
    for (const stain of this.stains()) {
      stain.mesh.visible = false;
      stain.mesh.removeFromParent();
      stain.alpha = 0;
      stain.life = 0;
      stain.whole = true;
    }
    // A pool that was never laid lies flat until its first lay reaches it.
    flatten(this.pool);
    uploaded(this.pool);
    this.floor = createGloamFloor();
    this.trail = createGloamWake();
    this.eruptAge = Number.POSITIVE_INFINITY;
    this.ringPending = false;
    this.laidX = this.laidY = this.laidZ = Number.NaN;
    this.laidFlat = false;
    this.laidWhole = false;
    this.fadeIn = 0;
    this.present = false;
  }

  /** The ground it was laid on is no longer the ground here: lay it again. */
  forgetLay(): void {
    this.laidX = this.laidY = this.laidZ = Number.NaN;
    this.laidFlat = false;
    this.laidWhole = false;
  }

  /** Back into the scene for a new wearer, as a pool that was never laid. */
  revive(): void {
    for (const stain of this.stains()) this.parent.add(stain.mesh);
  }

  private stains(): Stain[] {
    return this.ring ? [this.pool, this.ring, ...this.wake] : [this.pool, ...this.wake];
  }

  /** The form was seen starting: erupt, and send the ring out if `ring`. */
  enter(ring: boolean): void {
    this.eruptAge = 0;
    this.ringPending = ring;
  }

  /**
   * A frame in which the wearer is presented: follow it at (x, z), its feet at
   * `feetY`. `draped` is false past the range where a draped grid is worth its
   * samples: the pool then lies flat. `wakeStains` is how many stains the wake
   * may hold (0: none), `ground` the field's memory of the floor, and `budget`
   * the frame's shared allowance of new ground samples. Call `animate` after
   * it, every frame.
   */
  follow(
    x: number,
    feetY: number,
    z: number,
    settled: boolean,
    draped: boolean,
    wakeStains: number,
    ground: GloamGround,
    groundY: (x: number, z: number) => number,
    budget: GloamDrapeBudget,
  ): void {
    const floor = gloamFloorInto(groundY(x, z), feetY, settled, this.floor);
    const flat = floor.flat || !draped;
    const base = floor.baseY;
    const pool = this.pool;
    this.present = true;

    if (this.ringPending) {
      // Put down where the form began, on the frame it begins: an entry must
      // not arrive late. It starts flat and is laid outward ahead of its front.
      this.ringPending = false;
      this.ring ??= this.makeRing();
      const ring = this.ring;
      ring.mesh.position.set(x, base + GLOAM_POOL_LIFT, z);
      flatten(ring);
      uploaded(ring);
      ring.reached = 0;
      this.ringFlat = flat;
    }
    if (this.ring && !this.ringFlat && gloamRingAt(this.eruptAge, ringScratch)) {
      // As far as the front will have run a slow frame from now.
      const ahead = gloamRingFront(this.eruptAge + GLOAM_RING_LEAD_SECONDS);
      reachRing(this.ring, ahead, groundY, budget);
    }

    // The pool rides its wearer every frame, and is laid again once it has
    // moved a step (or while its last lay still has ground to learn). A lay
    // reads remembered ground and samples only the nodes it newly stands on.
    pool.mesh.position.set(x, base + GLOAM_POOL_LIFT, z);
    if (flat) {
      // One flat lay serves every later frame.
      if (!this.laidFlat) this.lay(x, z, base, true, ground, groundY, budget);
    } else if (
      this.laidFlat ||
      !this.laidWhole ||
      gloamRedrapeDue(x, base, z, this.laidX, this.laidY, this.laidZ)
    ) {
      this.lay(x, z, base, false, ground, groundY, budget);
    }

    // A wake stain whose drop found ground still unknown finishes its lay.
    for (const stain of this.wake) {
      if (stain.life <= 0 || stain.whole) continue;
      const at = stain.mesh.position;
      stain.whole = drape(
        stain,
        at.x,
        at.z,
        at.y - GLOAM_POOL_LIFT,
        false,
        ground,
        groundY,
        budget,
      );
    }
    const drop = gloamWakeStep(this.trail, x, z, draped ? wakeStains : 0);
    if (drop < 0) return;
    while (this.wake.length <= drop) this.wake.push(this.makeWake(this.wake.length));
    const stain = this.wake[drop];
    // Dropped only by a wearer on its floor (one in the air leaves no print).
    if (floor.presence < 1) return;
    const dropX = this.trail.dropX;
    const dropZ = this.trail.dropZ;
    // A reused stain starts flat: ground its lay cannot read yet must not keep
    // the shape of wherever it lay last.
    flatten(stain);
    stain.whole = drape(
      stain,
      dropX,
      dropZ,
      flat ? base : groundY(dropX, dropZ),
      flat,
      ground,
      groundY,
      budget,
    );
    stain.mesh.visible = true;
    stain.life = GLOAM_WAKE_SECONDS;
  }

  /**
   * Every frame, presented or not: the pool fades in under a wearer and out
   * once nobody reports one (the form ended, or the wearer left the view),
   * the entry runs its course and the wake thins.
   */
  animate(dt: number): void {
    const step = this.present ? dt : -dt;
    this.present = false;
    this.fadeIn = Math.min(1, Math.max(0, this.fadeIn + step / GLOAM_POOL_FADE));
    this.eruptAge += dt;
    const presence = this.floor.presence;
    const pool = this.pool;
    pool.alpha = this.fadeIn * presence;
    pool.grow = gloamEruptGrow(this.eruptAge);
    pool.mesh.visible = pool.alpha > 0.004;
    if (this.ring) {
      const shown = gloamRingAt(this.eruptAge, ringScratch);
      this.ring.mesh.visible = shown;
      this.ring.grow = ringScratch.grow;
      this.ring.alpha = shown ? ringScratch.alpha * presence : 0;
    }
    for (const stain of this.wake) {
      if (stain.life <= 0) continue;
      stain.life -= dt;
      if (stain.life <= 0) {
        stain.mesh.visible = false;
        continue;
      }
      const left = stain.life / GLOAM_WAKE_SECONDS;
      stain.alpha = gloamWakeAlpha(left);
      stain.grow = gloamWakeGrow(left);
    }
  }

  private lay(
    x: number,
    z: number,
    base: number,
    flat: boolean,
    ground: GloamGround,
    groundY: (x: number, z: number) => number,
    budget: GloamDrapeBudget,
  ): void {
    this.laidWhole = drape(this.pool, x, z, base, flat, ground, groundY, budget);
    this.laidX = x;
    this.laidY = base;
    this.laidZ = z;
    this.laidFlat = flat;
  }

  private makeRing(): Stain {
    const ring = makeStain(this.materials.ring, GLOAM_RING_SIZE, RING_CELLS, 3.1);
    ring.mesh.name = 'gloam_ring';
    this.parent.add(ring.mesh);
    return ring;
  }

  private makeWake(index: number): Stain {
    const stain = makeStain(this.materials.pool, GLOAM_WAKE_SIZE, WAKE_CELLS, index * 2.3 + 0.4);
    stain.mesh.name = 'gloam_wake';
    this.parent.add(stain.mesh);
    return stain;
  }

  /** Meshes this pool has in the scene (the pool, its ring, its wake). */
  get stainCount(): number {
    return 1 + (this.ring ? 1 : 0) + this.wake.length;
  }

  dispose(): void {
    disposeStain(this.pool);
    if (this.ring) disposeStain(this.ring);
    for (const stain of this.wake) disposeStain(stain);
    this.wake.length = 0;
    this.ring = null;
  }
}
