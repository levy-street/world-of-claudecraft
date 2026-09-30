import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BufferUpdateRange } from '../src/render/buffer_update_range';
import { CANNON_BOMBLET, cannonAirburstCounts } from '../src/render/cannon_frag_core';
import { CANNON_GROUND_MARK, cannonGroundMarkFade } from '../src/render/cannon_ground_mark_core';
import {
  CANNON_PUFF_KINDS,
  CANNON_PUFF_SPRITE_RADIUS,
  CANNON_SHOCK_PUFFS,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import { CANNON_PUFF_ATLAS_BYTES, CannonPuffMesh } from '../src/render/cannon_puff_mesh';
import {
  CANNON_BLAST,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_OWN_FADE_SECONDS,
  CANNON_SCORCH_LAYERS,
  CANNON_SCORCH_VERTS,
  cannonRecoilOffset,
  cannonShotCounts,
} from '../src/render/cannon_shell_core';
import {
  type CannonShellHost,
  CannonShellVisuals,
  resetCannonShotTexelsForTest,
} from '../src/render/cannon_shell_visuals';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';

const RADIUS = 6;
const fired = { shotId: 1, x: 20, y: 0, z: 0, flightTicks: 8, impactTick: 168 };
const landed = { shotId: 1, x: 20, y: 0, z: 0 };
const fallback = { x: 2, y: 2.2, z: 0 };

function hostStub() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-10, 6, 0);
  const host = {
    vfx: { burst: vi.fn() },
    camera,
    addShake: vi.fn(),
    punchFov: vi.fn(),
  };
  return host as typeof host & CannonShellHost;
}

function weapon(
  effectsTier: 'low' | 'high' = 'high',
  groundAt: (x: number, z: number) => number = () => 0,
) {
  const scene = new THREE.Scene();
  const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt, effectsTier });
  visuals.prepare(scene);
  return { scene, visuals };
}

function piece(visuals: CannonShellVisuals, role: string): THREE.Mesh {
  const found = visuals.root.getObjectByName(`cannonShell:${role}`);
  if (!(found instanceof THREE.Mesh)) throw new Error(`missing ${role}`);
  return found;
}

function drawn(visuals: CannonShellVisuals, role: 'shell' | 'chunk'): number {
  const mesh = piece(visuals, role) as THREE.InstancedMesh;
  return mesh.visible ? mesh.count : 0;
}

function puffs(visuals: CannonShellVisuals, kind: number): number {
  return piece(visuals, 'puff').visible ? visuals.drawnPuffs(kind) : 0;
}

function instancePosition(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

function materialsUnder(root: THREE.Object3D): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    if (material) for (const m of Array.isArray(material) ? material : [material]) out.add(m);
  });
  return out;
}

/** The scorch's live vertex heights and fades, one slice per laid scorch. */
function scorchSlices(visuals: CannonShellVisuals) {
  const geometry = piece(visuals, 'scorch').geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const color = geometry.getAttribute('color') as THREE.BufferAttribute;
  const perScorch = CANNON_SCORCH_VERTS * CANNON_SCORCH_LAYERS.length;
  const slices: { xyz: number[][]; fade: number[] }[] = [];
  for (let base = 0; base < position.count; base += perScorch) {
    const xyz: number[][] = [];
    const fade: number[] = [];
    for (let v = 0; v < perScorch; v++) {
      xyz.push([position.getX(base + v), position.getY(base + v), position.getZ(base + v)]);
      fade.push(color.getX(base + v));
    }
    if (xyz.some(([x, y, z]) => x !== 0 || y !== 0 || z !== 0)) slices.push({ xyz, fade });
  }
  return slices;
}

describe('cannon shell visuals', () => {
  it('builds nothing until prepared, then attaches one named-material root once', () => {
    const scene = new THREE.Scene();
    const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: () => 0 });
    expect(visuals.prepared).toBe(false);
    expect(visuals.root.children).toHaveLength(0);
    visuals.prepare(scene);
    visuals.prepare(scene);
    expect(visuals.prepared).toBe(true);
    expect(visuals.root.parent).toBe(scene);
    const materials = materialsUnder(visuals.root);
    expect(materials.size).toBe(4);
    for (const material of materials) expect(material.name).toMatch(/^cannonShell:/);
    visuals.root.traverse((node) => {
      expect(node.castShadow).toBe(false);
      expect((node as THREE.Light).isLight).not.toBe(true);
    });
    visuals.dispose();
  });

  it('mints no material, geometry or mesh per shot', () => {
    const { visuals } = weapon();
    const materials = materialsUnder(visuals.root);
    const geometries = new Set<THREE.BufferGeometry>();
    visuals.root.traverse((node) => {
      if ((node as THREE.Mesh).geometry) geometries.add((node as THREE.Mesh).geometry);
    });
    const nodes = visuals.root.children.length;
    for (let i = 0; i < 20; i++) {
      const at = i * 0.5;
      visuals.fire({ ...fired, shotId: i + 1, impactTick: 168 + i * 10 }, fallback, at, false);
      visuals.update(160 + i * 10 + 4, at + 0.05);
      visuals.impact({ ...landed, shotId: i + 1 }, at + 0.4, false);
      visuals.update(160 + i * 10 + 8, at + 0.45);
    }
    expect(visuals.root.children).toHaveLength(nodes);
    expect(materialsUnder(visuals.root)).toEqual(materials);
    visuals.root.traverse((node) => {
      if ((node as THREE.Mesh).geometry)
        expect(geometries.has((node as THREE.Mesh).geometry)).toBe(true);
    });
    visuals.dispose();
  });

  it('flies a glowing shell from the muzzle behind its wake, then shows the whole blast', () => {
    const { visuals } = weapon();
    visuals.fire(fired, fallback, 10, false);
    // Past the smoke's short delay, inside the flash's 0.08 s.
    visuals.update(164, 10.07);
    expect(drawn(visuals, 'shell')).toBe(1);
    expect(puffs(visuals, PUFF.glow)).toBe(1);
    expect(puffs(visuals, PUFF.trailSmoke)).toBeGreaterThan(1);
    expect(puffs(visuals, PUFF.flash)).toBe(1);
    expect(puffs(visuals, PUFF.flame)).toBe(3);
    expect(puffs(visuals, PUFF.smoke)).toBeGreaterThan(0);
    const shell = instancePosition(piece(visuals, 'shell') as THREE.InstancedMesh, 0);
    expect(shell.x).toBeGreaterThan(fallback.x);
    expect(shell.x).toBeLessThan(20);
    expect(shell.y).toBeGreaterThan(2.2);
    visuals.update(166, 10.2);
    expect(puffs(visuals, PUFF.flame)).toBe(0);
    // The muzzle smoke outlives the flash by most of a second.
    expect(puffs(visuals, PUFF.smoke)).toBeGreaterThan(0);
    visuals.impact(landed, 10.4, false);
    visuals.update(168, 10.45);
    expect(drawn(visuals, 'shell')).toBe(0);
    expect(puffs(visuals, PUFF.glow)).toBe(0);
    for (const kind of [PUFF.flash, PUFF.fireball, PUFF.shock, PUFF.dirt, PUFF.spark]) {
      expect(puffs(visuals, kind), `kind ${kind}`).toBeGreaterThan(0);
    }
    // The thin dust heaves up out of its fade-in a moment later.
    visuals.update(169, 10.6);
    expect(puffs(visuals, PUFF.dust)).toBeGreaterThan(0);
    expect(drawn(visuals, 'chunk')).toBeGreaterThan(0);
    expect(piece(visuals, 'scorch').visible).toBe(true);
    visuals.update(175, 10.4 + 1.2);
    expect(puffs(visuals, PUFF.flash)).toBe(0);
    expect(puffs(visuals, PUFF.fireball)).toBe(0);
    // The dust cloud still lingers well past a second.
    expect(puffs(visuals, PUFF.dust)).toBeGreaterThan(0);
    visuals.update(200, 10.4 + CANNON_BLAST.life + 0.1);
    expect(piece(visuals, 'puff').visible).toBe(false);
    expect(drawn(visuals, 'chunk')).toBe(0);
    expect(piece(visuals, 'scorch').visible).toBe(true);
    visuals.update(175, 10.4 + CANNON_BLAST.scorchLife + 0.1);
    expect(piece(visuals, 'scorch').visible).toBe(false);
    expect(scorchSlices(visuals)).toHaveLength(0);
    visuals.dispose();
  });

  it('drapes the scorch over the ground under the blast and fades it through its colours', () => {
    const ground = (x: number, z: number) => 2 + 0.2 * Math.sin(x * 0.9) * Math.cos(z * 0.7);
    const { visuals } = weapon('high', ground);
    visuals.impact(landed, 0, false);
    visuals.update(0, 0);
    const [scorch] = scorchSlices(visuals);
    expect(scorch).toBeDefined();
    for (let v = 0; v < scorch.xyz.length; v++) {
      const [x, y, z] = scorch.xyz[v];
      const layer = CANNON_SCORCH_LAYERS[Math.floor(v / CANNON_SCORCH_VERTS)];
      expect(y).toBeCloseTo(ground(x, z) + layer.lift, 5);
      expect(Math.hypot(x - 20, z)).toBeLessThanOrEqual(
        RADIUS * CANNON_BLAST.scorchScale * Math.SQRT2 + 1e-6,
      );
    }
    visuals.update(0, CANNON_BLAST.scorchHold);
    const held = scorchSlices(visuals)[0].fade;
    expect(held[0]).toBeCloseTo(1, 6);
    expect(held[CANNON_SCORCH_VERTS]).toBeCloseTo(CANNON_SCORCH_LAYERS[1].strength, 6);
    visuals.update(0, CANNON_BLAST.scorchLife - 0.5);
    const late = scorchSlices(visuals)[0].fade;
    expect(late[0]).toBeGreaterThan(0);
    expect(late[0]).toBeLessThan(0.2);
    const scorch3 = piece(visuals, 'scorch');
    const material = scorch3.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.SubtractiveBlending);
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(scorch3.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    expect(piece(visuals, 'puff').renderOrder).toBe(floorVfxRenderOrder('player', 4));
    visuals.dispose();
  });

  it('links the same programs on the low preset as on the high one', () => {
    // A preset only sheds counts: a key that differed by tier would be a
    // program the other tier's warm-up never links.
    const key = (visuals: CannonShellVisuals) =>
      ['shell', 'chunk', 'scorch', 'puff'].map((role) => {
        const mesh = piece(visuals, role);
        const material = mesh.material as THREE.Material & { defines?: object };
        return [
          role,
          material.type,
          material.name,
          material.transparent,
          material.blending,
          material.depthWrite,
          material.premultipliedAlpha,
          (material as THREE.MeshBasicMaterial).vertexColors,
          !!(material as THREE.MeshBasicMaterial).map,
          JSON.stringify(material.defines ?? {}),
          material.customProgramCacheKey(),
          (mesh as THREE.InstancedMesh).isInstancedMesh === true,
          !!(mesh as THREE.InstancedMesh).instanceColor,
          Object.keys(mesh.geometry.attributes).sort().join(','),
        ];
      });
    const low = weapon('low').visuals;
    const high = weapon('high').visuals;
    expect(key(low)).toEqual(key(high));
    low.dispose();
    high.dispose();
  });

  it('keeps every program key as built through a whole shot', () => {
    const key = (visuals: CannonShellVisuals) =>
      ['shell', 'chunk', 'scorch', 'puff'].map((role) => {
        const mesh = piece(visuals, role);
        const geometry = mesh.geometry;
        return [
          role,
          (mesh as THREE.InstancedMesh).instanceColor !== null &&
            (mesh as THREE.InstancedMesh).instanceColor !== undefined,
          Object.keys(geometry.attributes).sort().join(','),
          (mesh.material as THREE.Material).version,
        ];
      });
    for (const tier of ['low', 'high'] as const) {
      const { visuals } = weapon(tier);
      visuals.setHost(hostStub());
      const built = key(visuals);
      for (let i = 0; i < 3; i++) {
        const at = i * 0.5;
        visuals.fire({ ...fired, shotId: i + 1, impactTick: 168 + i * 10 }, fallback, at, false);
        visuals.update(160 + i * 10 + 4, at + 0.02);
        visuals.impact({ ...landed, shotId: i + 1 }, at + 0.4, false);
        visuals.update(160 + i * 10 + 8, at + 0.45);
      }
      for (const time of [2, 4, 9, 12]) visuals.update(200, time);
      visuals.clear();
      expect(key(visuals)).toEqual(built);
      visuals.dispose();
    }
  });

  it('takes the scene light on its lingering dust, found among the scene lights', () => {
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.05);
    const sun = new THREE.DirectionalLight(0xffffff, 0.05);
    scene.add(hemi, sun);
    const holder = new THREE.Group();
    scene.add(holder);
    const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: () => 0 });
    visuals.prepare(holder);
    const mesh = piece(visuals, 'puff');
    const tint = mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const brightest = () => {
      let best = 0;
      const n = (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
      for (let i = 0; i < n; i++) best = Math.max(best, tint.getX(i));
      return best;
    };
    visuals.impact(landed, 0, false);
    // Past the flash, the fire and the sparks: only lit dust and cold smoke remain.
    visuals.update(168, 1.3);
    expect(puffs(visuals, PUFF.dust)).toBeGreaterThan(0);
    expect(puffs(visuals, PUFF.spark) + puffs(visuals, PUFF.flash)).toBe(0);
    const night = brightest();
    hemi.intensity = 1.5;
    sun.intensity = 3;
    visuals.update(168, 1.3);
    expect(brightest()).toBeGreaterThan(night * 3);
    visuals.dispose();
  });

  it('lights a puff by its unlit share only: self-lit fire keeps its colour in the dark', () => {
    const mesh = new CannonPuffMesh(4, 'test', null);
    const frame = { ...newCannonPuffFrame(), size: 1, a: 1, r: 2, g: 1, b: 0.5 };
    const tint = mesh.mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    mesh.setLight(0.1, 0.2, 0.3);
    mesh.begin();
    mesh.push({ ...frame, glow: 1 });
    mesh.push({ ...frame, glow: 0 });
    mesh.push({ ...frame, glow: 0, a: 0 });
    mesh.end();
    expect(mesh.drawn).toBe(2);
    expect(mesh.mesh.geometry.instanceCount).toBe(2);
    expect([tint.getX(0), tint.getY(0), tint.getZ(0)]).toEqual([2, 1, 0.5]);
    expect(tint.getX(1)).toBeCloseTo(0.2, 6);
    expect(tint.getY(1)).toBeCloseTo(0.2, 6);
    expect(tint.getZ(1)).toBeCloseTo(0.15, 6);
    mesh.begin();
    mesh.end();
    expect(mesh.mesh.visible).toBe(false);
    mesh.dispose();
  });

  it('kicks a pitched barrel back along its own axis', () => {
    const { scene, visuals } = weapon();
    const barrel = new THREE.Object3D();
    barrel.position.set(0.2, 1.6, 0.5);
    barrel.rotation.x = -0.3;
    scene.add(barrel);
    visuals.setBarrel(barrel, { x: 0, y: 0, z: 1 });
    const rest = barrel.position.clone();
    visuals.fire(fired, fallback, 1, false);
    visuals.update(160, 1 + CANNON_MUZZLE.recoilAttack);
    const kick = barrel.position.clone().sub(rest);
    expect(kick.length()).toBeCloseTo(cannonRecoilOffset(CANNON_MUZZLE.recoilAttack), 9);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(barrel.quaternion);
    expect(kick.normalize().dot(axis)).toBeCloseTo(-1, 9);
    visuals.dispose();
  });

  it('kicks a barrel pitched after it was handed over along its new axis, by the kick it was given', () => {
    const { scene, visuals } = weapon();
    const head = new THREE.Group();
    head.rotation.y = 1.1;
    const barrel = new THREE.Object3D();
    barrel.position.set(0, 0.48, 0.05);
    head.add(barrel);
    scene.add(head);
    visuals.setBarrel(barrel, { x: 0, y: 0, z: 1 }, 0.16);
    const rest = barrel.position.clone();
    barrel.rotation.x = -0.4;
    visuals.fire(fired, fallback, 1, false);
    visuals.update(160, 1 + CANNON_MUZZLE.recoilAttack);
    const kick = barrel.position.clone().sub(rest);
    const scale = 0.16 / CANNON_MUZZLE.recoilKick;
    expect(kick.length()).toBeCloseTo(cannonRecoilOffset(CANNON_MUZZLE.recoilAttack) * scale, 9);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(barrel.quaternion);
    expect(kick.normalize().dot(axis)).toBeCloseTo(-1, 9);
    expect(head.position.lengthSq()).toBe(0);
    visuals.update(162, 1 + CANNON_MUZZLE.recoilLife + 0.01);
    expect(barrel.position.equals(rest)).toBe(true);
    visuals.dispose();
  });

  it('takes the muzzle from the barrel tip, kicks the barrel back and springs it home', () => {
    const { scene, visuals } = weapon();
    const mount = new THREE.Group();
    mount.position.set(5, 1, 5);
    mount.rotation.y = Math.PI / 2;
    const barrel = new THREE.Object3D();
    barrel.position.set(0.2, 1.6, 0.5);
    barrel.scale.setScalar(2);
    mount.add(barrel);
    scene.add(mount);
    const tip = { x: 0, y: 0, z: 1 };
    visuals.setBarrel(barrel, tip);
    expect(visuals.hasBarrel).toBe(true);
    const rest = barrel.position.clone();
    visuals.fire({ ...fired, impactTick: 168 }, fallback, 1, false);
    visuals.update(160, 1);
    const expected = new THREE.Vector3(tip.x, tip.y, tip.z).applyMatrix4(barrel.matrixWorld);
    const shell = instancePosition(piece(visuals, 'shell') as THREE.InstancedMesh, 0);
    expect(shell.distanceTo(expected)).toBeLessThan(1e-6);
    // The muzzle faces the barrel's +z: with its mount turned a quarter, world +x.
    expect(expected.x).toBeGreaterThan(rest.x + 5);
    visuals.update(160, 1 + CANNON_MUZZLE.recoilAttack);
    expect(barrel.position.z).toBeCloseTo(
      rest.z - cannonRecoilOffset(CANNON_MUZZLE.recoilAttack),
      9,
    );
    expect(barrel.position.x).toBe(rest.x);
    visuals.update(162, 1 + CANNON_MUZZLE.recoilLife + 0.01);
    expect(barrel.position.equals(rest)).toBe(true);
    visuals.fire({ ...fired, shotId: 2, impactTick: 178 }, fallback, 2, false);
    visuals.update(171, 2.05);
    expect(barrel.position.z).toBeLessThan(rest.z);
    visuals.setBarrel(null, tip);
    expect(barrel.position.equals(rest)).toBe(true);
    expect(visuals.hasBarrel).toBe(false);
    visuals.dispose();
  });

  it('punches the FOV and shakes by distance and by a core hit', () => {
    const { visuals } = weapon();
    const host = hostStub();
    visuals.setHost(host);
    visuals.fire(fired, fallback, 0, false);
    expect(host.punchFov).toHaveBeenCalledWith(CANNON_MUZZLE.fovPunch);
    expect(host.addShake).toHaveBeenCalledWith(CANNON_MUZZLE.shake);
    host.addShake.mockClear();
    visuals.impact(landed, 0.4, false);
    // The camera sits 30.6 yd from the blast: a little under half the full shake.
    const [miss] = host.addShake.mock.calls[0];
    expect(miss).toBeGreaterThan(0.2 * CANNON_BLAST.shake);
    expect(miss).toBeLessThan(0.5 * CANNON_BLAST.shake);
    host.addShake.mockClear();
    visuals.impact({ ...landed, shotId: 2, hits: [{ falloff: 1 }] }, 0.8, false);
    expect(host.addShake.mock.calls[0][0]).toBeCloseTo(miss * 1.3, 9);
    host.addShake.mockClear();
    visuals.impact({ ...landed, shotId: 3, x: 200 }, 1.2, false);
    expect(host.addShake).not.toHaveBeenCalled();
    visuals.dispose();
  });

  it('stands the boot-prewarmed particles in only while its own pieces are gated', () => {
    const gate = vi.fn(() => new Promise<void>(() => {}));
    const scene = new THREE.Scene();
    const gated = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      compileGate: gate,
    });
    gated.prepare(scene);
    expect(gated.root.visible).toBe(false);
    const host = hostStub();
    gated.setHost(host);
    gated.fire(fired, fallback, 0, false);
    gated.impact(landed, 0.4, false);
    expect(host.vfx.burst.mock.calls.length).toBeGreaterThanOrEqual(2);
    gated.dispose();
    const { visuals } = weapon();
    const open = hostStub();
    visuals.setHost(open);
    visuals.fire(fired, fallback, 0, false);
    visuals.impact(landed, 0.4, false);
    expect(open.vfx.burst).not.toHaveBeenCalled();
    visuals.dispose();
  });

  it('skips the shake and the FOV punch under reduced motion, and keeps everything else', () => {
    const { visuals } = weapon();
    const host = hostStub();
    visuals.setHost(host);
    visuals.fire(fired, fallback, 0, true);
    visuals.impact(landed, 0.4, true);
    expect(host.addShake).not.toHaveBeenCalled();
    expect(host.punchFov).not.toHaveBeenCalled();
    visuals.update(168, 0.45);
    expect(puffs(visuals, PUFF.flash)).toBe(1);
    expect(puffs(visuals, PUFF.shock)).toBeGreaterThan(0);
    visuals.dispose();
  });

  it('sheds only cosmetic counts on the low preset: the shell, flash, fireball and ring stay', () => {
    const low = weapon('low').visuals;
    const high = weapon('high').visuals;
    const lowCounts = cannonShotCounts(true);
    const highCounts = cannonShotCounts(false);
    const byKind = (visuals: CannonShellVisuals) =>
      Array.from({ length: CANNON_PUFF_KINDS }, (_, kind) => puffs(visuals, kind));
    const flight = new Map<CannonShellVisuals, number[]>();
    const blast = new Map<CannonShellVisuals, number[]>();
    for (const visuals of [low, high]) {
      visuals.fire(fired, fallback, 0, false);
      visuals.update(164, 0.07);
      flight.set(visuals, [drawn(visuals, 'shell'), ...byKind(visuals)]);
      visuals.impact(landed, 0.4, false);
      visuals.update(168, 0.45);
      const flash = puffs(visuals, PUFF.flash);
      // Every other blast puff is out of its delay and its fade-in.
      visuals.update(168, 0.7);
      blast.set(visuals, [flash, ...byKind(visuals)]);
    }
    const lf = flight.get(low) ?? [];
    const hf = flight.get(high) ?? [];
    expect(lf[0]).toBe(1);
    expect(hf[0]).toBe(1);
    for (const kind of [PUFF.glow, PUFF.trailSmoke, PUFF.trailSpark, PUFF.flash, PUFF.flame]) {
      expect(lf[kind + 1], `in flight ${kind}`).toBe(hf[kind + 1]);
    }
    expect(lf[PUFF.smoke + 1]).toBe(lowCounts.smoke);
    expect(hf[PUFF.smoke + 1]).toBe(highCounts.smoke);
    const lb = blast.get(low) ?? [];
    const hb = blast.get(high) ?? [];
    expect(lb[0]).toBe(1);
    expect(hb[0]).toBe(1);
    for (const kind of [PUFF.fireball, PUFF.shock]) {
      expect(lb[kind + 1], `blast ${kind}`).toBe(hb[kind + 1]);
      expect(hb[kind + 1]).toBeGreaterThan(0);
    }
    expect(lb[PUFF.dust + 1]).toBe(lowCounts.dust);
    expect(hb[PUFF.dust + 1]).toBe(highCounts.dust);
    expect(lb[PUFF.dirt + 1]).toBe(lowCounts.dirt);
    expect(hb[PUFF.dirt + 1]).toBe(highCounts.dirt);
    expect(lb[PUFF.spark + 1]).toBeLessThan(hb[PUFF.spark + 1]);
    const liveChunks = (visuals: CannonShellVisuals) => {
      const mesh = piece(visuals, 'chunk') as THREE.InstancedMesh;
      const m = new THREE.Matrix4();
      let n = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        if (m.determinant() !== 0) n++;
      }
      return n;
    };
    expect(liveChunks(low)).toBe(lowCounts.chunks);
    expect(liveChunks(high)).toBe(highCounts.chunks);
    low.dispose();
    high.dispose();
  });

  it("draws a caller's pooled bursts in the same puff draw, and sizes that draw for them", () => {
    const bare = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: () => 0 });
    expect(bare.puffBurst(0)).toBeNull();
    bare.prepare(new THREE.Scene());
    expect(bare.puffBurst(0)).toBeNull();
    const plain = (piece(bare, 'puff') as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry;
    const plainCapacity = (plain.getAttribute('aCenter') as THREE.InstancedBufferAttribute).count;
    bare.dispose();

    const scene = new THREE.Scene();
    const visuals = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      bursts: { slots: 3, puffs: 4 },
    });
    expect(visuals.puffBurst(0)).toBeNull();
    visuals.prepare(scene);
    const mesh = piece(visuals, 'puff') as THREE.Mesh<THREE.InstancedBufferGeometry>;
    const capacity = (mesh.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute)
      .count;
    expect(capacity).toBe(plainCapacity + 12);
    const materials = materialsUnder(visuals.root);
    const burst = visuals.puffBurst(1);
    if (!burst) throw new Error('a burst slot expected');
    for (let i = 0; i < 3; i++) {
      Object.assign(burst.puffs[i], {
        kind: PUFF.shock,
        x: 4 + i,
        y: 0.3,
        z: 0,
        size0: 1,
        size1: 2,
        life: 0.8,
        delay: 0,
      });
    }
    burst.count = 3;
    burst.life = 0.8;
    visuals.update(160, 1.2);
    expect(puffs(visuals, PUFF.shock)).toBe(3);
    // One draw, one material: the burst adds instances, never a mesh or a program.
    expect(materialsUnder(visuals.root)).toEqual(materials);
    expect(mesh.geometry.instanceCount).toBe(3);
    // Spent, it frees its slot and draws nothing.
    visuals.update(160, 1.9);
    expect(puffs(visuals, PUFF.shock)).toBe(0);
    expect(burst.active).toBe(false);
    const again = visuals.puffBurst(2);
    if (!again) throw new Error('a burst slot expected');
    Object.assign(again.puffs[0], { kind: PUFF.dust, size0: 1, size1: 2, life: 5, delay: 0 });
    again.count = 1;
    again.life = 5;
    visuals.update(160, 2.1);
    expect(puffs(visuals, PUFF.dust)).toBe(1);
    visuals.clear();
    visuals.update(160, 2.2);
    expect(puffs(visuals, PUFF.dust)).toBe(0);
    visuals.dispose();
    expect(visuals.puffBurst(3)).toBeNull();
  });

  it('keeps as many blasts on the ground at once as it was sized for, none taken over', () => {
    const blasts = (n: number, impacts?: number) => {
      const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: () => 0, impacts });
      visuals.prepare(new THREE.Scene());
      for (let i = 0; i < n; i++)
        visuals.impact({ ...landed, shotId: i + 1, x: 4 * i }, 0.1, false);
      visuals.update(160, 0.3);
      const out = { fire: puffs(visuals, PUFF.fireball), chunks: drawn(visuals, 'chunk') };
      visuals.dispose();
      return out;
    };
    const one = blasts(1);
    expect(one.fire).toBeGreaterThan(0);
    expect(blasts(CANNON_IMPACT_POOL + 3).fire).toBe(one.fire * CANNON_IMPACT_POOL);
    const wide = CANNON_IMPACT_POOL + 6;
    expect(blasts(wide, wide)).toEqual({
      fire: one.fire * wide,
      chunks: wide * CANNON_CHUNKS_PER_IMPACT,
    });
  });

  it('holds no shot pool until prepared, so a player never seated pays for none', () => {
    // Every player builds the turret visual at boot; only the one who sits
    // in it needs the pools of launched puffs and frames.
    const reachable = (root: object): number => {
      const seen = new Set<object>();
      const stack: unknown[] = [root];
      while (stack.length > 0) {
        const value = stack.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        if (value !== root && (value instanceof THREE.Object3D || ArrayBuffer.isView(value))) {
          seen.add(value);
          continue;
        }
        seen.add(value);
        for (const next of Object.values(value)) stack.push(next);
      }
      return seen.size;
    };
    const visuals = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      bursts: { slots: 24, puffs: 20 },
    });
    const idle = reachable(visuals);
    expect(idle).toBeLessThan(120);
    visuals.prepare(new THREE.Scene());
    expect(reachable(visuals)).toBeGreaterThan(idle + 2000);
    visuals.dispose();
  });

  it('builds the page texels in the texel slot, never on the commitment frame, and once', async () => {
    resetCannonShotTexelsForTest();
    let open: () => void = () => {};
    const slot = vi.fn(() => new Promise<void>((resolve) => (open = resolve)));
    const scene = new THREE.Scene();
    const first = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      texelSlot: slot,
    });
    first.prepare(scene);
    const atlasOf = (visuals: CannonShellVisuals) =>
      (piece(visuals, 'puff').material as THREE.ShaderMaterial).uniforms.uAtlas
        .value as THREE.DataTexture;
    const scorchOf = (visuals: CannonShellVisuals) =>
      (piece(visuals, 'scorch').material as THREE.MeshBasicMaterial).map as THREE.DataTexture;
    const bytes = (texture: THREE.DataTexture) => texture.image.data as Uint8Array;
    // Built clear at the commitment: nothing was computed yet.
    expect(slot).toHaveBeenCalledTimes(1);
    expect(bytes(atlasOf(first))).toHaveLength(CANNON_PUFF_ATLAS_BYTES);
    expect(bytes(atlasOf(first)).some((b) => b !== 0)).toBe(false);
    expect(bytes(scorchOf(first)).some((b) => b !== 0)).toBe(false);
    // Its own pieces are not ready, so the boot particles stand in (no gate here).
    const host = hostStub();
    first.setHost(host);
    first.fire(fired, fallback, 0, false);
    expect(host.vfx.burst).toHaveBeenCalledTimes(1);
    const version = atlasOf(first).version;
    open();
    await Promise.resolve();
    await Promise.resolve();
    expect(bytes(atlasOf(first)).some((b) => b !== 0)).toBe(true);
    expect(bytes(scorchOf(first)).some((b) => b !== 0)).toBe(true);
    expect(atlasOf(first).version).toBeGreaterThan(version);
    first.fire({ ...fired, shotId: 2 }, fallback, 1, false);
    expect(host.vfx.burst).toHaveBeenCalledTimes(1);
    // A second weapon on the page takes the same texels at once, without a slot.
    const again = vi.fn(() => new Promise<void>(() => {}));
    const second = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      texelSlot: again,
    });
    second.prepare(scene);
    expect(again).not.toHaveBeenCalled();
    expect(bytes(atlasOf(second))).toBe(bytes(atlasOf(first)));
    first.dispose();
    second.dispose();
  });

  it('queues one reused upload range per buffer, however many writes a frame makes', () => {
    const { visuals } = weapon();
    const attributes = [
      ...['aCenter', 'aTint', 'aLook'].map(
        (name) => piece(visuals, 'puff').geometry.getAttribute(name) as THREE.BufferAttribute,
      ),
      piece(visuals, 'scorch').geometry.getAttribute('position') as THREE.BufferAttribute,
      piece(visuals, 'scorch').geometry.getAttribute('color') as THREE.BufferAttribute,
    ];
    const first = new Map<THREE.BufferAttribute, object>();
    // Twelve fading scorches and a live blast, and no renderer uploading between frames.
    for (let i = 0; i < 12; i++)
      visuals.impact({ ...landed, shotId: i + 1, x: 4 * i }, i * 0.1, false);
    for (let frame = 0; frame < 30; frame++) {
      visuals.update(170, 1.3 + frame * 0.2);
      for (const attribute of attributes) {
        expect(attribute.updateRanges.length).toBeLessThanOrEqual(1);
        const range = attribute.updateRanges[0];
        if (!range) continue;
        if (!first.has(attribute)) first.set(attribute, range);
        expect(range).toBe(first.get(attribute));
      }
    }
    expect(first.size).toBe(attributes.length);
    visuals.dispose();
  });

  it('widens a range still queued rather than dropping or duplicating it', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(64), 1);
    const upload = new BufferUpdateRange(attribute);
    upload.mark(10, 5);
    upload.mark(2, 3);
    expect(attribute.updateRanges).toEqual([{ start: 2, count: 13 }]);
    const range = attribute.updateRanges[0];
    // Three uploads it and clears the list: the next frame reuses the same object.
    attribute.clearUpdateRanges();
    const version = attribute.version;
    upload.mark(40, 4);
    expect(attribute.updateRanges).toEqual([{ start: 40, count: 4 }]);
    expect(attribute.updateRanges[0]).toBe(range);
    expect(attribute.version).toBeGreaterThan(version);
  });

  it('draws the far blast before the near muzzle, and each source dust first, light last', () => {
    const { visuals } = weapon();
    visuals.fire(fired, fallback, 0, false);
    visuals.impact(landed, 0, false);
    visuals.update(162, 0.3);
    const mesh = piece(visuals, 'puff') as THREE.Mesh<THREE.InstancedBufferGeometry>;
    const center = mesh.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute;
    const look = mesh.geometry.getAttribute('aLook') as THREE.InstancedBufferAttribute;
    const n = mesh.geometry.instanceCount;
    const near = (i: number) => Math.hypot(center.getX(i) - fallback.x, center.getZ(i)) < 4;
    const far = (i: number) => Math.hypot(center.getX(i) - landed.x, center.getZ(i)) < 12;
    let lastFar = -1;
    let firstNear = n;
    for (let i = 0; i < n; i++) {
      if (far(i)) lastFar = i;
      if (near(i)) firstNear = Math.min(firstNear, i);
    }
    expect(lastFar).toBeGreaterThanOrEqual(0);
    expect(firstNear).toBeLessThan(n);
    expect(lastFar).toBeLessThan(firstNear);
    // Inside the blast: the smoke and dust billows first, the flash and sparks last.
    const SMOKE = 0;
    let lastSmoke = -1;
    let firstLight = n;
    for (let i = 0; i <= lastFar; i++) {
      const sprite = look.getZ(i);
      if (sprite === SMOKE) lastSmoke = i;
      if (sprite === 1 || sprite === 2) firstLight = Math.min(firstLight, i);
    }
    expect(lastSmoke).toBeGreaterThanOrEqual(0);
    expect(lastSmoke).toBeLessThan(firstLight);
    visuals.dispose();
  });

  it('cuts every billboard to the octagon around its sprite, a fifth less fill than a square', () => {
    const mesh = new CannonPuffMesh(4, 'octagon', null);
    const geometry = mesh.mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    expect(position.count).toBe(8);
    expect(geometry.getIndex()?.count).toBe(18);
    let area = 0;
    for (let k = 0; k < 8; k++) {
      const x = position.getX(k);
      const y = position.getY(k);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
      expect(uv.getX(k)).toBeCloseTo(x + 0.5, 6);
      expect(uv.getY(k)).toBeCloseTo(y + 0.5, 6);
      const nx = position.getX((k + 1) % 8);
      const ny = position.getY((k + 1) % 8);
      area += (x * ny - nx * y) / 2;
      // Each edge stays outside the sprite's clear radius: nothing drawn is cut.
      const edge = Math.abs(x * ny - nx * y) / Math.hypot(nx - x, ny - y);
      expect(edge).toBeGreaterThanOrEqual(0.5 * CANNON_PUFF_SPRITE_RADIUS - 1e-6);
    }
    expect(area).toBeLessThan(0.81);
    mesh.dispose();
  });

  it('samples the ground once per point an impact needs, its scorch layers included', () => {
    let calls = 0;
    const counts = cannonShotCounts(false);
    const { visuals } = weapon('high', () => {
      calls++;
      return 0;
    });
    visuals.impact(landed, 0, false);
    visuals.update(168, 0.05);
    expect(calls).toBe(
      1 + counts.chunks + CANNON_SHOCK_PUFFS + counts.dirt + CANNON_SCORCH_VERTS - 1,
    );
    visuals.dispose();
  });

  it('tells its callers the static preset is low, so they shed their own cosmetic counts', () => {
    expect(weapon('low').visuals.lowEffects).toBe(true);
    expect(weapon('high').visuals.lowEffects).toBe(false);
  });

  it('clears every shot and blast, and releases what it minted on dispose', () => {
    const { visuals } = weapon();
    visuals.fire(fired, fallback, 0, false);
    visuals.impact(landed, 0.4, false);
    visuals.update(168, 0.45);
    visuals.clear();
    expect(drawn(visuals, 'shell')).toBe(0);
    expect(drawn(visuals, 'chunk')).toBe(0);
    expect(piece(visuals, 'puff').visible).toBe(false);
    expect(piece(visuals, 'scorch').visible).toBe(false);
    expect(scorchSlices(visuals)).toHaveLength(0);
    visuals.update(168, 0.5);
    expect(piece(visuals, 'scorch').visible).toBe(false);
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    visuals.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const material = mesh.material as THREE.MeshBasicMaterial & THREE.ShaderMaterial;
      if (material?.map) textures.add(material.map);
      if (material?.uniforms?.uAtlas) textures.add(material.uniforms.uAtlas.value);
    });
    expect(textures.size).toBe(2);
    const released = [...geometries, ...materialsUnder(visuals.root), ...textures].map((r) =>
      vi.spyOn(r, 'dispose'),
    );
    visuals.dispose();
    for (const spy of released) expect(spy).toHaveBeenCalled();
    expect(visuals.root.parent).toBeNull();
  });

  it('releases everything else when one resource fails to dispose, then reports it', () => {
    const { visuals } = weapon();
    const [first, ...others] = [...materialsUnder(visuals.root)];
    const failure = new Error('driver gone');
    vi.spyOn(first, 'dispose').mockImplementation(() => {
      throw failure;
    });
    const released = others.map((m) => vi.spyOn(m, 'dispose'));
    const scorch = piece(visuals, 'scorch').material as THREE.MeshBasicMaterial;
    const texture = vi.spyOn(scorch.map as THREE.Texture, 'dispose');
    let thrown: unknown = null;
    try {
      visuals.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([failure]);
    for (const spy of released) expect(spy).toHaveBeenCalled();
    expect(texture).toHaveBeenCalled();
    expect(() => visuals.dispose()).not.toThrow();
  });

  it("flies its caller's own shot on the click with the whole report, and its event adopts it", () => {
    const { visuals } = weapon();
    const host = hostStub();
    visuals.setHost(host);
    visuals.launchOwn(3, { x: 20, y: 0, z: 0 }, 160, 170, fallback, 0, false);
    expect(host.punchFov).toHaveBeenCalledWith(CANNON_MUZZLE.fovPunch);
    expect(host.addShake).toHaveBeenCalledWith(CANNON_MUZZLE.shake);
    visuals.update(165, 0.05);
    expect(drawn(visuals, 'shell')).toBe(1);
    expect(puffs(visuals, PUFF.flash)).toBe(1);
    const mid = instancePosition(piece(visuals, 'shell') as THREE.InstancedMesh, 0);
    expect(mid.x).toBeGreaterThan(fallback.x);
    expect(mid.x).toBeLessThan(20);
    expect(visuals.adoptOwn(3, fired, 165)).toBe(true);
    expect(visuals.adoptOwn(9, fired, 165)).toBe(false);
    host.punchFov.mockClear();
    visuals.update(166, 0.1);
    expect(drawn(visuals, 'shell')).toBe(1);
    expect(host.punchFov).not.toHaveBeenCalled();
    visuals.update(168, 0.15);
    expect(drawn(visuals, 'shell')).toBe(0);
    visuals.impact(landed, 0.16, false);
    visuals.update(168, 0.21);
    expect(puffs(visuals, PUFF.shock)).toBeGreaterThan(0);
    visuals.dispose();
  });

  it('shrinks a refused own shot away with no blast, no scorch and no chunk', () => {
    const { visuals } = weapon();
    visuals.launchOwn(3, { x: 20, y: 0, z: 0 }, 160, 170, fallback, 0, false);
    const refused = (serial: number) => serial === 3;
    visuals.update(162, 0.1, refused);
    const shell = piece(visuals, 'shell') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    shell.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(1, 6);
    visuals.update(163, 0.1 + CANNON_OWN_FADE_SECONDS / 2, refused);
    shell.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(0.5, 6);
    visuals.update(164, 0.11 + CANNON_OWN_FADE_SECONDS, refused);
    expect(drawn(visuals, 'shell')).toBe(0);
    expect(visuals.adoptOwn(3, fired, 164)).toBe(false);
    visuals.update(170, 0.6, refused);
    expect(puffs(visuals, PUFF.shock)).toBe(0);
    expect(drawn(visuals, 'chunk')).toBe(0);
    expect(piece(visuals, 'scorch').visible).toBe(false);
    visuals.dispose();
  });

  it('flies an event shell with no report when its report played on the click', () => {
    const { visuals } = weapon();
    const host = hostStub();
    visuals.setHost(host);
    visuals.fire(fired, fallback, 0, false, false);
    expect(host.punchFov).not.toHaveBeenCalled();
    expect(host.addShake).not.toHaveBeenCalled();
    visuals.update(164, 0.05);
    expect(drawn(visuals, 'shell')).toBe(1);
    expect(puffs(visuals, PUFF.flash)).toBe(0);
    visuals.dispose();
  });
});

describe('cannon fragmentation shell and ground mark', () => {
  const frag = { ...fired, weapon: 'frag' as const };
  const burst = {
    shotId: 1,
    x: 20,
    y: 4,
    z: 0,
    bomblets: [
      { index: 0, x: 20, y: 0, z: 0, landTick: 172 },
      { index: 1, x: 20, y: 0, z: 4.5, landTick: 173 },
      { index: 2, x: 24.3, y: 0, z: 1.4, landTick: 174 },
    ],
  };

  function fragWeapon(tier: 'low' | 'high' = 'high') {
    const scene = new THREE.Scene();
    const visuals = new CannonShellVisuals({
      blastRadius: RADIUS,
      groundAt: () => 0,
      effectsTier: tier,
      bomblets: 6,
      holdTicks: 2,
    });
    visuals.prepare(scene);
    return visuals;
  }

  function sparksBehind(visuals: CannonShellVisuals, shot: typeof fired): number {
    visuals.fire(shot, fallback, 0, false);
    visuals.update(166, 0.3);
    return puffs(visuals, PUFF.trailSpark);
  }

  it('fizzes a fragmentation shell with a denser spark wake, and an own one from the click', () => {
    const plain = fragWeapon();
    const fizzing = fragWeapon();
    expect(sparksBehind(fizzing, frag)).toBeGreaterThan(sparksBehind(plain, fired) * 1.5);
    plain.dispose();
    fizzing.dispose();
    const own = fragWeapon();
    own.launchOwn(3, { x: 20, y: 0, z: 0 }, 160, 168, fallback, 0, false, true);
    own.update(166, 0.3);
    const early = puffs(own, PUFF.trailSpark);
    const adopted = fragWeapon();
    adopted.launchOwn(3, { x: 20, y: 0, z: 0 }, 160, 168, fallback, 0, false);
    expect(adopted.adoptOwn(3, frag, 161)).toBe(true);
    adopted.update(166, 0.3);
    expect(puffs(adopted, PUFF.trailSpark)).toBe(early);
    own.dispose();
    adopted.dispose();
  });

  it('bursts in the air: the shell is gone, the airburst flashes and the bomblets fly small on the shell draw', () => {
    const visuals = fragWeapon();
    visuals.fire(frag, fallback, 0, false);
    visuals.update(166, 0.3);
    expect(drawn(visuals, 'shell')).toBe(1);
    visuals.scatter(burst, 168, 0.4);
    visuals.update(168, 0.41);
    const shells = piece(visuals, 'shell') as THREE.InstancedMesh;
    // The frag shell landed; its three bomblets fly in its place.
    expect(drawn(visuals, 'shell')).toBe(3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      shells.getMatrixAt(i, m);
      expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(CANNON_BOMBLET.scale, 6);
      expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(4, 6);
    }
    expect(puffs(visuals, PUFF.flash)).toBe(1);
    expect(puffs(visuals, PUFF.spark)).toBe(cannonAirburstCounts(false).sparks);
    // The airburst throws no chunk and lays no scorch.
    expect(drawn(visuals, 'chunk')).toBe(0);
    expect(piece(visuals, 'scorch').visible).toBe(false);
    visuals.update(172, 0.6);
    expect(drawn(visuals, 'shell')).toBe(3);
    expect(puffs(visuals, PUFF.trailSpark)).toBeGreaterThan(0);
    shells.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(0, 6);
    // Its blast lands the bomblet, small and with no dust cloud.
    visuals.landBomblet(1, 0);
    visuals.impact(
      { shotId: -99, x: 20, y: 0, z: 0, radius: 3.5, scale: 0.5, cloud: false },
      0.6,
      false,
    );
    visuals.update(172, 0.61);
    expect(drawn(visuals, 'shell')).toBe(2);
    expect(puffs(visuals, PUFF.flash)).toBe(1);
    expect(piece(visuals, 'scorch').visible).toBe(true);
    for (const time of [0.8, 1.2, 1.6]) {
      visuals.update(172, time);
      expect(puffs(visuals, PUFF.dust)).toBe(0);
    }
    // A bomblet whose blast never comes is gone once its hold runs out.
    visuals.update(177, 1.7);
    expect(drawn(visuals, 'shell')).toBe(0);
    visuals.dispose();
  });

  it('lays a pale cracked mark on the ground mark slot, on the texture second cell, fading over its life', () => {
    const ground = (x: number, z: number) => 1 + 0.1 * Math.sin(x) * Math.cos(z);
    const scene = new THREE.Scene();
    const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: ground });
    visuals.prepare(scene);
    visuals.markGround(4, 5, 1, -2, 4, 10);
    visuals.update(0, 10.5);
    const [mark] = scorchSlices(visuals);
    expect(mark).toBeDefined();
    for (let v = 0; v < mark.xyz.length; v++) {
      const [x, y, z] = mark.xyz[v];
      const layer = CANNON_SCORCH_LAYERS[Math.floor(v / CANNON_SCORCH_VERTS)];
      expect(y).toBeCloseTo(ground(x, z) + layer.lift, 5);
      expect(Math.hypot(x - 5, z + 2)).toBeLessThanOrEqual(4 * Math.SQRT2 + 1e-6);
    }
    const geometry = piece(visuals, 'scorch').geometry;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const perSlot = CANNON_SCORCH_VERTS * CANNON_SCORCH_LAYERS.length;
    const last = color.count - perSlot;
    const [r, g, b] = CANNON_GROUND_MARK.tint;
    expect(color.getX(last)).toBeCloseTo(r, 6);
    expect(color.getY(last)).toBeCloseTo(g, 6);
    expect(color.getZ(last)).toBeCloseTo(b, 6);
    // The mark samples the cracks, every scorch the char.
    for (let v = last; v < color.count; v++) expect(uv.getX(v)).toBeGreaterThanOrEqual(0.5);
    for (let v = 0; v < last; v++) expect(uv.getX(v)).toBeLessThanOrEqual(0.5);
    const texture = (piece(visuals, 'scorch').material as THREE.MeshBasicMaterial)
      .map as THREE.DataTexture;
    expect(texture.image.width).toBe(2 * texture.image.height);
    visuals.update(0, 10 + CANNON_GROUND_MARK.life - 1);
    expect(color.getX(last)).toBeCloseTo(r * cannonGroundMarkFade(CANNON_GROUND_MARK.life - 1), 2);
    // A shell's scorch beside it keeps its own grey char.
    visuals.impact(landed, 11, false);
    visuals.update(0, 12);
    expect(scorchSlices(visuals)).toHaveLength(2);
    visuals.update(0, 10 + CANNON_GROUND_MARK.life + 0.1);
    expect(scorchSlices(visuals)).toHaveLength(1);
    visuals.clear();
    expect(scorchSlices(visuals)).toHaveLength(0);
    visuals.dispose();
  });

  it('draws the frag and the mark on the materials and program keys it built, on every tier', () => {
    for (const tier of ['low', 'high'] as const) {
      const visuals = fragWeapon(tier);
      visuals.setHost(hostStub());
      const materials = materialsUnder(visuals.root);
      const built = [...materials].map((m) => m.version);
      const nodes = visuals.root.children.length;
      visuals.fire(frag, fallback, 0, false);
      visuals.update(166, 0.3);
      visuals.scatter(burst, 168, 0.4);
      visuals.markGround(1, 0, 0, 0, 4, 0.4);
      visuals.update(170, 0.5);
      for (const b of burst.bomblets) {
        visuals.landBomblet(1, b.index);
        visuals.impact(
          { shotId: -100 - b.index, ...b, radius: 3.5, scale: 0.5, cloud: false },
          0.6,
          false,
        );
      }
      visuals.update(174, 0.7);
      expect(materialsUnder(visuals.root)).toEqual(materials);
      expect([...materials].map((m) => m.version)).toEqual(built);
      expect(visuals.root.children).toHaveLength(nodes);
      visuals.dispose();
    }
  });
});
