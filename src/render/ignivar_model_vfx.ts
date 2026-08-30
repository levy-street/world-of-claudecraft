// Persistent forge-fire presentation attached to Ignivar's animated upper
// body. Geometry stays model-local so it follows character normalization,
// facing, and entity scale; particles are emitted in world space.
import * as THREE from 'three';
import {
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
} from '../sim/encounters/ignivar';
import { GFX } from './gfx';
import { attachIgnivarVfx, type IgnivarVfxHandle } from './ignivar_fire_vfx';
import type { Vfx } from './vfx';

export const IGNIVAR_CHEST_FIRE_NAME = 'ignivarChestFurnaceFire';
export const IGNIVAR_SHOULDER_FIRE_LEFT_NAME = 'ignivarShoulderForgeFireLeft';
export const IGNIVAR_SHOULDER_FIRE_RIGHT_NAME = 'ignivarShoulderForgeFireRight';
const IGNIVAR_FIRE_VFX_HANDLE = 'ignivarFireVfxHandle';

const FLAME_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uHeight;
  uniform float uWobble;
  varying float vHeight;
  void main() {
    vec3 p = position;
    vHeight = clamp((p.y + uHeight * 0.5) / uHeight, 0.0, 1.0);
    float sway = sin(uTime * 7.4 + uPhase + vHeight * 8.0) * uWobble * vHeight;
    p.x += sway;
    p.z += cos(uTime * 6.1 + uPhase * 1.7 + vHeight * 6.0) * uWobble * 0.55 * vHeight;
    p.xz *= 0.9 + 0.13 * sin(uTime * 9.0 + uPhase + vHeight * 11.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform vec3 uLowColor;
  uniform vec3 uHighColor;
  uniform float uOpacity;
  varying float vHeight;
  void main() {
    float body = sin(3.14159265 * clamp(vHeight, 0.0, 1.0));
    float alpha = pow(max(body, 0.0), 0.42) * uOpacity;
    vec3 color = mix(uLowColor, uHighColor, smoothstep(0.12, 0.92, vHeight));
    gl_FragColor = vec4(color, alpha);
  }
`;

function flameMaterial(
  height: number,
  phase: number,
  lowColor: number,
  highColor: number,
  opacity: number,
  wobble: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
      uHeight: { value: height },
      uWobble: { value: wobble },
      uLowColor: { value: new THREE.Color(lowColor).multiplyScalar(1.35) },
      uHighColor: { value: new THREE.Color(highColor).multiplyScalar(1.9) },
      uOpacity: { value: opacity },
    },
    vertexShader: FLAME_VERTEX,
    fragmentShader: FLAME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function flameCone(
  radius: number,
  height: number,
  y: number,
  phase: number,
  colors: [number, number],
  opacity: number,
): THREE.Mesh {
  const material = flameMaterial(height, phase, colors[0], colors[1], opacity, radius * 0.38);
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 9, 2, true), material);
  mesh.position.y = y;
  mesh.rotation.y = phase;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.userData.renderCategory = 'vfx';
  return mesh;
}

function shoulderFire(name: string, phase: number): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  root.add(
    flameCone(0.12, 0.34, 0.17, phase, [0xff3705, 0xffaa22], 0.58),
    flameCone(0.08, 0.26, 0.13, phase + 1.7, [0xff8a0a, 0xffe07a], 0.72),
    flameCone(0.045, 0.18, 0.09, phase + 3.1, [0xffb21c, 0xfff0b0], 0.64),
  );
  const light = new THREE.PointLight(0xff6a18, 3.5, 7, 2);
  light.name = `${name}Light`;
  light.position.y = 0.25;
  light.userData.baseIntensity = 3.5;
  root.add(light);
  root.userData.phase = phase;
  return root;
}

function chestFire(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_CHEST_FIRE_NAME;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 14, 10),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff7218).multiplyScalar(1.25),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.name = 'ignivarChestGlowCore';
  glow.userData.renderCategory = 'vfx';
  glow.renderOrder = 8;
  root.add(glow);
  const light = new THREE.PointLight(0xff5b12, 5, 9, 2);
  light.name = 'ignivarChestFurnaceLight';
  light.userData.baseIntensity = 5;
  root.add(light);
  return root;
}

function addSocket(parent: THREE.Object3D, name: string, position: [number, number, number]): void {
  const socket = new THREE.Object3D();
  socket.name = name;
  socket.position.set(...position);
  parent.add(socket);
}

/** Runtime fallback for the locally-rigged KayKit model. The shipping GLB also
 * authors these sockets; accepting the fallback keeps previews and source GLBs
 * useful before the deterministic finalizer runs. */
export function ensureIgnivarModelVfxSockets(model: THREE.Object3D): boolean {
  if (model.getObjectByName('Socket_ChestCore')) return false;
  const chest = model.getObjectByName('chest');
  if (!chest) return false;
  // Bone-local offsets on the normalized KayKit body: the chest emitter sits
  // just proud of the furnace plate and the shoulder flames crown the pauldrons.
  addSocket(chest, 'Socket_ChestCore', [0, 0.02, 0.18]);
  addSocket(chest, 'Socket_ShoulderLeft', [-0.3, 0.13, 0.02]);
  addSocket(chest, 'Socket_ShoulderRight', [0.3, 0.13, 0.02]);
  return true;
}

export function attachIgnivarModelVfx(model: THREE.Object3D): boolean {
  if (model.getObjectByName('ignivar__shockwave')) return false;
  if (model.getObjectByName('vfx_core')) {
    const handle = attachIgnivarVfx(model, {
      count: GFX.tier === 'low' ? 40 : GFX.tier === 'medium' ? 64 : 96,
      shimmer: GFX.tier !== 'low',
      flameLight: GFX.tier !== 'low',
      flameTexUrl: '/textures/vfx/ignivar_flame_6x6.webp',
    });
    model.userData[IGNIVAR_FIRE_VFX_HANDLE] = handle;
    return true;
  }
  if (model.getObjectByName(IGNIVAR_CHEST_FIRE_NAME)) return false;
  ensureIgnivarModelVfxSockets(model);
  const chest = model.getObjectByName('Socket_ChestCore');
  const left = model.getObjectByName('Socket_ShoulderLeft');
  const right = model.getObjectByName('Socket_ShoulderRight');
  if (!chest || !left || !right) return false;
  chest.add(chestFire());
  left.add(shoulderFire(IGNIVAR_SHOULDER_FIRE_LEFT_NAME, 0.35));
  right.add(shoulderFire(IGNIVAR_SHOULDER_FIRE_RIGHT_NAME, 2.4));
  return true;
}

const socketWorld = new THREE.Vector3();
const socketWorldRotation = new THREE.Quaternion();
const socketLocalDown = new THREE.Vector3();

export interface IgnivarModelVfxState {
  dead?: boolean;
  castingAbility?: string | null;
  channeling?: boolean;
}

function authoredVfxOwner(model: THREE.Object3D): THREE.Object3D | null {
  const shockwave = model.getObjectByName('ignivar__shockwave');
  return shockwave?.parent ?? null;
}

export function syncIgnivarModelVfx(
  model: THREE.Object3D,
  dt: number,
  vfx?: Vfx,
  state?: IgnivarModelVfxState,
): void {
  const owner = authoredVfxOwner(model);
  const handle = owner?.userData[IGNIVAR_FIRE_VFX_HANDLE] as IgnivarVfxHandle | undefined;
  if (handle && owner) {
    const dead = state?.dead === true;
    const castingAbility = state?.castingAbility ?? null;
    const flameActive =
      !dead &&
      castingAbility !== IGNIVAR_ROTATING_RAYS_CAST_ID &&
      (state?.channeling === true ||
        castingAbility === IGNIVAR_FRONTAL_CAST_ID ||
        castingAbility === IGNIVAR_SKYFIRE_CAST_ID);
    const previousFlameActive = owner?.userData.ignivarVfxFlameActive === true;
    const previousCast = (owner?.userData.ignivarVfxCast as string | null | undefined) ?? null;
    handle.setIntensity(dead ? 0 : flameActive ? 1.35 : 1);
    handle.setFlame(flameActive);
    if (previousFlameActive && !flameActive && !dead) handle.pulse();
    if (
      previousCast === IGNIVAR_FORGE_WAVE_CAST_ID &&
      castingAbility !== IGNIVAR_FORGE_WAVE_CAST_ID &&
      !dead
    ) {
      handle.shockwave();
    }
    owner.userData.ignivarVfxFlameActive = flameActive;
    owner.userData.ignivarVfxCast = castingAbility;
    handle.update(dt);
    return;
  }
  const elapsed = (model.userData.ignivarModelVfxTime ?? 0) + dt;
  model.userData.ignivarModelVfxTime = elapsed;
  for (const name of [IGNIVAR_SHOULDER_FIRE_LEFT_NAME, IGNIVAR_SHOULDER_FIRE_RIGHT_NAME]) {
    const fire = model.getObjectByName(name);
    if (!fire) continue;
    const down = name === IGNIVAR_SHOULDER_FIRE_RIGHT_NAME ? 0.07 : 0.02;
    fire.parent?.getWorldQuaternion(socketWorldRotation);
    socketLocalDown.set(0, -down, 0).applyQuaternion(socketWorldRotation.invert());
    fire.position.copy(socketLocalDown);
    const phase = fire.userData.phase as number;
    const pulse = 1 + Math.sin(elapsed * 7.2 + phase) * 0.07;
    fire.scale.set(1 / pulse, pulse, 1 / pulse);
    fire.rotation.y = Math.sin(elapsed * 2.1 + phase) * 0.1;
    fire.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.ShaderMaterial;
      if (material.isShaderMaterial && material.uniforms.uTime) {
        material.uniforms.uTime.value = elapsed;
      }
    });
    fire.getWorldPosition(socketWorld);
    vfx?.campfireEmber(socketWorld, dt);
  }
  const chest = model.getObjectByName(IGNIVAR_CHEST_FIRE_NAME);
  const glow = chest?.getObjectByName('ignivarChestGlowCore');
  if (glow) glow.scale.setScalar(0.92 + Math.sin(elapsed * 5.4) * 0.08);
}

function disposeNamed(model: THREE.Object3D, name: string): void {
  const root = model.getObjectByName(name);
  if (!root) return;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
  root.removeFromParent();
}

export function disposeIgnivarModelVfx(model: THREE.Object3D): void {
  const owner = authoredVfxOwner(model);
  const handle = owner?.userData[IGNIVAR_FIRE_VFX_HANDLE] as IgnivarVfxHandle | undefined;
  if (handle && owner) {
    handle.dispose();
    delete owner.userData[IGNIVAR_FIRE_VFX_HANDLE];
    delete owner.userData.ignivarVfxFlameActive;
    delete owner.userData.ignivarVfxCast;
    return;
  }
  disposeNamed(model, IGNIVAR_CHEST_FIRE_NAME);
  disposeNamed(model, IGNIVAR_SHOULDER_FIRE_LEFT_NAME);
  disposeNamed(model, IGNIVAR_SHOULDER_FIRE_RIGHT_NAME);
}
