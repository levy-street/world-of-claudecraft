import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CANNON_PUFF_KINDS, newCannonPuffFrame, PUFF } from '../src/render/cannon_puff_core';
import { CannonPuffMesh } from '../src/render/cannon_puff_mesh';
import {
  CANNON_BLAST,
  CANNON_MUZZLE,
  CANNON_SCORCH_LAYERS,
  CANNON_SCORCH_VERTS,
  cannonRecoilOffset,
  cannonShotCounts,
} from '../src/render/cannon_shell_core';
import { type CannonShellHost, CannonShellVisuals } from '../src/render/cannon_shell_visuals';
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
    for (const kind of [PUFF.flash, PUFF.fireball, PUFF.shock, PUFF.dust, PUFF.dirt, PUFF.spark]) {
      expect(puffs(visuals, kind), `kind ${kind}`).toBeGreaterThan(0);
    }
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
    const mesh = new CannonPuffMesh(4, 'test');
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

  it('takes the muzzle from the barrel tip, kicks the barrel back and springs it home', () => {
    const { scene, visuals } = weapon();
    const tank = new THREE.Group();
    tank.position.set(5, 1, 5);
    tank.rotation.y = Math.PI / 2;
    const barrel = new THREE.Object3D();
    barrel.position.set(0.2, 1.6, 0.5);
    barrel.scale.setScalar(2);
    tank.add(barrel);
    scene.add(tank);
    const tip = { x: 0, y: 0, z: 1 };
    visuals.setBarrel(barrel, tip);
    expect(visuals.hasBarrel).toBe(true);
    const rest = barrel.position.clone();
    visuals.fire({ ...fired, impactTick: 168 }, fallback, 1, false);
    visuals.update(160, 1);
    const expected = new THREE.Vector3(tip.x, tip.y, tip.z).applyMatrix4(barrel.matrixWorld);
    const shell = instancePosition(piece(visuals, 'shell') as THREE.InstancedMesh, 0);
    expect(shell.distanceTo(expected)).toBeLessThan(1e-6);
    // The muzzle faces the barrel's +z: with the tank turned a quarter, world +x.
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
});
