// The shared seam of Morthen's Rite effects (morthen_rite_fx.ts, the host,
// and its painters): what a painter reaches on the host, the scan of the
// fight, and the small helpers they share (a vertex shader, the beam's
// placement), so the painters and the host import it without a cycle.

import * as THREE from 'three';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import type { ParticlePool, ParticleSpec } from './crypt_fx_particles';
import type { RiteCandleDecor } from './rite_candle_decor';

export const RITE_MESH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A pooled additive mesh a painter places and fades each frame. */
export interface RiteGlowMesh {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

/** What the fight looks like this tenth of a second (the host's scan). */
export interface RiteScan {
  morthenId: number;
  wyrmId: number;
  /** The Rite's candle objects (absent: the decor's own look). */
  candles: number[];
  /** Grasp of the Grave rings, gathering or holding. */
  grasps: number[];
  /** Burning Knell halves, marked or burning. */
  knells: number[];
  /** Bound Souls in flight. */
  souls: number[];
  /** Players channelling a relight. */
  lighters: number[];
  /** Players held by the grave's hands. */
  rooted: number[];
  /** The highest Grave Chill bite on any player (0: the Rite is not on). */
  chill: number;
}

/** What a painter shares from the host. */
export interface RiteFxHost {
  readonly root: THREE.Group;
  readonly kit: TelegraphKit;
  /** Ghost-fire tongues (his and the Knellwyrm's fire). */
  readonly fire: ParticlePool;
  /** The remembrance flame (the relit candles' warm holy fire). */
  readonly holy: ParticlePool;
  /** Additive soft motes (sparks, souls, embers). */
  readonly glow: ParticlePool;
  /** Normal-blended smoke and dark motes. */
  readonly dust: ParticlePool;
  /** Grave Chill's mist: under every telegraph rung, so it never hides one. */
  readonly mist: ParticlePool;
  readonly uTime: { value: number };
  readonly groundY: (x: number, z: number) => number;
  /** 0.45 on the low effects tier, 1 otherwise (cosmetic counts only). */
  readonly density: number;
  readonly low: boolean;
  readonly scan: RiteScan;
  /** The Remembrance Candles' decor of each claimed slot's interior. */
  readonly decor: RiteCandleDecor;
  clock(): number;
  rand(): number;
  /** The one reused particle spec, reset (ParticlePool.emit copies it, so a
   *  painter fills it and emits with no allocation per particle). */
  ps(): ParticleSpec;
  /** A shockwave band across the floor. */
  wave(x: number, z: number, reach: number, seconds: number, color: number, width?: number): void;
  /** A camera-facing flash that swells and fades. */
  flash(x: number, y: number, z: number, size: number, seconds: number, color: number): void;
  /** Shake the camera if the local player stands near (x, z). */
  shakeAt(x: number, z: number, amount: number): void;
  /** Keep a geometry or material for disposal. */
  own<T extends THREE.BufferGeometry | THREE.Material>(o: T): T;
  /** Play a one-shot gesture clip on an entity (the manifest's attackByAbility). */
  gesture(entityId: number, gesture: string): void;
  /** A pooled beam (unit height along +y, opened by `placeBeam`). */
  beam(color: number, flow: number, step: number): RiteGlowMesh;
  /** A pooled column of light (unit radius and height, base at its origin). */
  column(color: number, step: number): RiteGlowMesh;
  /** A pooled camera-facing glow. */
  halo(color: number, step: number): RiteGlowMesh;
}

/** One painter on the host. */
export interface RitePainter {
  update(world: IWorld, dt: number): void;
  handleEvent(ev: SimEvent, world: IWorld): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();

/** Stretch a host beam from (ax, ay, az) to (bx, by, bz), `radius` thick. */
export function placeBeam(
  b: RiteGlowMesh,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
): void {
  tmpDir.set(bx - ax, by - ay, bz - az);
  const len = Math.max(1e-3, tmpDir.length());
  tmpDir.multiplyScalar(1 / len);
  b.mesh.position.set(ax, ay, az);
  b.mesh.quaternion.setFromUnitVectors(UP, tmpDir);
  b.mesh.scale.set(radius, len, radius);
}
