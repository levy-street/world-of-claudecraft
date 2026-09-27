// The Three half of a sailing ship's wake and bow splash (the particle math is
// ship_wake_core.ts): one THREE.Points of pooled foam and spray, laid in world
// space by the ship's sockets and drawn with one soft additive sprite.
//
// GPU work: built into the props root at world build beside its ship
// (transport_ferry_ships.ts), with its one material registered for the props
// material prewarm (`shipWakePrewarmParts`, props.ts), so the world-entry
// compile links its program; a frame only rewrites buffer contents and the
// draw range, never a material, a texture or a geometry. The points stay
// hidden while nothing is alive (a moored ship draws nothing extra).
//
// Cosmetic only: the low tier emits half as many particles (graphics settings
// never touch what a player acts on).

import * as THREE from 'three';
import { GFX } from './gfx';
import {
  newWakeParticles,
  stepWakeParticles,
  type WakeEmitter,
  type WakeParticles,
  wakeParticleAlpha,
} from './ship_wake_core';
import type { TransportShipView } from './transport_ship';

/** Particle pool per ship. */
const WAKE_CAPACITY = 220;
/** Foam and spray tints (additive: the color is the light it adds). */
const FOAM = new THREE.Color(0.62, 0.7, 0.72);
const SPRAY = new THREE.Color(0.8, 0.86, 0.9);

let material: THREE.PointsMaterial | null = null;
let texture: THREE.DataTexture | null = null;

function foamTexture(): THREE.DataTexture {
  if (texture) return texture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const a = Math.round(255 * Math.max(0, 1 - d) ** 1.8);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = a;
    }
  }
  texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'ship-wake-foam';
  texture.needsUpdate = true;
  return texture;
}

function wakeMaterial(): THREE.PointsMaterial {
  if (material) return material;
  material = new THREE.PointsMaterial({
    size: 3,
    sizeAttenuation: true,
    map: foamTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = 'ship-wake';
  return material;
}

/** The wake's one program, for the props material prewarm: a tiny points
 *  object with the live attribute layout. */
export function shipWakePrewarmParts(): THREE.Points[] {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3), 3));
  return [new THREE.Points(geometry, wakeMaterial())];
}

export interface ShipWake {
  /** The world-space points (parent it under the props root). */
  readonly points: THREE.Points;
  /** Emit from the ship at `pose` moving at `speed`, and age the rest. */
  update(pose: { x: number; z: number; rot: number }, speed: number, dt: number): void;
}

/** Build a wake for a ship view (its sockets place the emitters). */
export function buildShipWake(view: TransportShipView): ShipWake {
  const particles: WakeParticles = newWakeParticles(WAKE_CAPACITY);
  const positions = new Float32Array(WAKE_CAPACITY * 3);
  const colors = new Float32Array(WAKE_CAPACITY * 3);
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  geometry.setDrawRange(0, 0);
  const points = new THREE.Points(geometry, wakeMaterial());
  points.name = 'ship-wake';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 2;
  const s = view.sockets;
  const emitter: WakeEmitter = {
    x: 0,
    z: 0,
    rot: 0,
    baseY: view.baseY,
    speed: 0,
    sternX: s.wake.x,
    sternZ: s.wake.z,
    bowX: s.bow.x,
    bowY: s.bow.y,
    bowZ: s.bow.z,
    sternHalfBeam: 3.4,
  };
  const rateScale = GFX.standardMaterials ? 1 : 0.5;
  return {
    points,
    update(pose, speed, dt) {
      emitter.x = pose.x;
      emitter.z = pose.z;
      emitter.rot = pose.rot;
      emitter.speed = speed;
      stepWakeParticles(particles, speed > 0 ? emitter : null, dt, rateScale);
      let n = 0;
      for (let i = 0; i < particles.capacity; i++) {
        const a = wakeParticleAlpha(particles, i);
        if (a <= 0) continue;
        const tint = particles.kind[i] === 1 ? SPRAY : FOAM;
        positions[n * 3] = particles.px[i];
        positions[n * 3 + 1] = particles.py[i];
        positions[n * 3 + 2] = particles.pz[i];
        colors[n * 3] = tint.r * a;
        colors[n * 3 + 1] = tint.g * a;
        colors[n * 3 + 2] = tint.b * a;
        n++;
      }
      geometry.setDrawRange(0, n);
      points.visible = n > 0;
      if (n > 0) {
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }
    },
  };
}
