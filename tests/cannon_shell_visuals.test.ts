import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CANNON_BLAST,
  CANNON_MUZZLE,
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
    vfx: { burst: vi.fn(), groundPuff: vi.fn() },
    camera,
    addShake: vi.fn(),
    punchFov: vi.fn(),
    spawnAoeRing: vi.fn(),
  };
  return host as typeof host & CannonShellHost;
}

function weapon(effectsTier: 'low' | 'high' = 'high') {
  const scene = new THREE.Scene();
  const visuals = new CannonShellVisuals({ blastRadius: RADIUS, groundAt: () => 0, effectsTier });
  visuals.prepare(scene);
  return { scene, visuals };
}

function piece(visuals: CannonShellVisuals, role: string): THREE.InstancedMesh {
  const found = visuals.root.getObjectByName(`cannonShell:${role}`);
  if (!(found instanceof THREE.InstancedMesh)) throw new Error(`missing ${role}`);
  return found;
}

function drawn(visuals: CannonShellVisuals, role: string): number {
  const mesh = piece(visuals, role);
  return mesh.visible ? mesh.count : 0;
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
    expect(materials.size).toBeGreaterThan(0);
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
    visuals.dispose();
  });

  it('flies the shell from the fallback muzzle with its trail, then shows the blast pieces', () => {
    const { visuals } = weapon();
    visuals.fire(fired, fallback, 10, false);
    visuals.update(164, 10.02);
    expect(drawn(visuals, 'shell')).toBe(1);
    expect(drawn(visuals, 'glow')).toBe(1);
    expect(drawn(visuals, 'trail')).toBeGreaterThan(1);
    expect(drawn(visuals, 'muzzleCore')).toBe(1);
    const shell = instancePosition(piece(visuals, 'shell'), 0);
    expect(shell.x).toBeGreaterThan(fallback.x);
    expect(shell.x).toBeLessThan(20);
    expect(shell.y).toBeGreaterThan(2.2);
    visuals.update(166, 10.2);
    expect(drawn(visuals, 'muzzleCore')).toBe(0);
    visuals.impact(landed, 10.4, false);
    visuals.update(168, 10.45);
    expect(drawn(visuals, 'shell')).toBe(0);
    expect(drawn(visuals, 'flash')).toBe(1);
    expect(drawn(visuals, 'wave')).toBe(1);
    expect(instancePosition(piece(visuals, 'flash'), 0).x).toBeCloseTo(20, 9);
    expect(drawn(visuals, 'chunk')).toBeGreaterThan(0);
    expect(drawn(visuals, 'scorch')).toBeGreaterThan(0);
    visuals.update(175, 10.4 + CANNON_BLAST.chunkLife + 0.1);
    expect(drawn(visuals, 'flash')).toBe(0);
    expect(drawn(visuals, 'wave')).toBe(0);
    expect(drawn(visuals, 'chunk')).toBe(0);
    expect(drawn(visuals, 'scorch')).toBeGreaterThan(0);
    visuals.update(175, 10.4 + CANNON_BLAST.scorchLife + 0.1);
    expect(drawn(visuals, 'scorch')).toBe(0);
    visuals.dispose();
  });

  it('fades the flash and the scorch through instance colours on shared materials', () => {
    const { visuals } = weapon();
    visuals.impact(landed, 0, false);
    const colour = new THREE.Color();
    // The frame that consumed the blast already draws it, scorch included.
    visuals.update(0, 0);
    expect(drawn(visuals, 'flash')).toBe(1);
    expect(drawn(visuals, 'scorch')).toBeGreaterThan(0);
    visuals.update(0, 0.01);
    piece(visuals, 'flash').getColorAt(0, colour);
    const early = colour.r;
    visuals.update(0, CANNON_BLAST.flashLife * 0.8);
    piece(visuals, 'flash').getColorAt(0, colour);
    expect(colour.r).toBeLessThan(early);
    visuals.update(0, CANNON_BLAST.scorchLife - 0.5);
    const scorch = piece(visuals, 'scorch');
    scorch.getColorAt(0, colour);
    expect(colour.r).toBeGreaterThan(0);
    expect(colour.r).toBeLessThan(0.2);
    const material = scorch.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.SubtractiveBlending);
    expect(material.premultipliedAlpha).toBe(true);
    expect(scorch.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    expect(piece(visuals, 'wave').renderOrder).toBe(floorVfxRenderOrder('player', 1));
    visuals.dispose();
  });

  it("keeps every piece's instance-colour attribute as built, through a whole shot", () => {
    const roles = [
      'shell',
      'glow',
      'trail',
      'muzzleCore',
      'muzzleTongue',
      'flash',
      'wave',
      'chunk',
      'scorch',
    ];
    const coloured = (visuals: CannonShellVisuals) =>
      Object.fromEntries(roles.map((role) => [role, piece(visuals, role).instanceColor !== null]));
    for (const tier of ['low', 'high'] as const) {
      const { visuals } = weapon(tier);
      const host = hostStub();
      visuals.setHost(host);
      // The attribute is a program key bit: the gate links what prepare built.
      const built = coloured(visuals);
      expect(built).toEqual({
        shell: false,
        glow: false,
        trail: false,
        muzzleCore: false,
        muzzleTongue: false,
        flash: true,
        wave: true,
        chunk: true,
        scorch: true,
      });
      for (let i = 0; i < 3; i++) {
        const at = i * 0.5;
        visuals.fire({ ...fired, shotId: i + 1, impactTick: 168 + i * 10 }, fallback, at, false);
        visuals.update(160 + i * 10 + 4, at + 0.02);
        visuals.impact({ ...landed, shotId: i + 1 }, at + 0.4, false);
        visuals.update(160 + i * 10 + 8, at + 0.45);
      }
      for (const time of [2, 4, 9, 12]) visuals.update(200, time);
      visuals.clear();
      expect(coloured(visuals)).toEqual(built);
      visuals.dispose();
    }
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
    const shell = instancePosition(piece(visuals, 'shell'), 0);
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

  it('drives the renderer services: particles, the AoE ring, a FOV punch and shakes by distance', () => {
    const { visuals } = weapon();
    const host = hostStub();
    visuals.setHost(host);
    visuals.fire(fired, fallback, 0, false);
    expect(host.punchFov).toHaveBeenCalledWith(CANNON_MUZZLE.fovPunch);
    expect(host.addShake).toHaveBeenCalledWith(CANNON_MUZZLE.shake);
    expect(host.vfx.burst).toHaveBeenCalledTimes(1);
    expect(host.vfx.groundPuff).toHaveBeenCalledTimes(cannonShotCounts(false).smoke);
    host.addShake.mockClear();
    visuals.impact(landed, 0.4, false);
    expect(host.spawnAoeRing).toHaveBeenCalledWith(20, 0, RADIUS, 'physical');
    expect(host.vfx.burst).toHaveBeenCalledTimes(4);
    const dirt = host.vfx.burst.mock.calls.find((call) => call[1] === 'blood');
    expect(dirt?.[2]).toBe(cannonShotCounts(false).dirt);
    // The camera sits 30.6 yd from the blast: a little under half the full shake.
    const [shake] = host.addShake.mock.calls[0];
    expect(shake).toBeGreaterThan(0.2 * CANNON_BLAST.shake);
    expect(shake).toBeLessThan(0.5 * CANNON_BLAST.shake);
    host.addShake.mockClear();
    visuals.impact({ ...landed, shotId: 2, x: 200 }, 0.8, false);
    expect(host.addShake).not.toHaveBeenCalled();
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
    expect(host.spawnAoeRing).toHaveBeenCalledTimes(1);
    visuals.update(168, 0.45);
    expect(drawn(visuals, 'flash')).toBe(1);
    visuals.dispose();
  });

  it('sheds only cosmetic counts on the low preset: the shell, flash and shockwave stay', () => {
    const low = weapon('low').visuals;
    const high = weapon('high').visuals;
    const lowHost = hostStub();
    const highHost = hostStub();
    low.setHost(lowHost);
    high.setHost(highHost);
    const effects = new Map<CannonShellVisuals, Record<string, number[]>>();
    const inFlight = new Map<CannonShellVisuals, number[]>();
    for (const [visuals, host] of [
      [low, lowHost],
      [high, highHost],
    ] as const) {
      const counts = (school: string) =>
        host.vfx.burst.mock.calls.filter((call) => call[1] === school).map((call) => call[2]);
      visuals.fire(fired, fallback, 0, false);
      const smoke = host.vfx.groundPuff.mock.calls.length;
      const muzzleSparks = counts('arcane');
      visuals.update(164, 0.02);
      inFlight.set(
        visuals,
        ['shell', 'glow', 'trail'].map((role) => drawn(visuals, role)),
      );
      host.vfx.groundPuff.mockClear();
      host.vfx.burst.mockClear();
      visuals.impact(landed, 0.4, false);
      effects.set(visuals, {
        smoke: [smoke],
        dust: [host.vfx.groundPuff.mock.calls.length],
        dirt: counts('blood'),
        sparks: [...muzzleSparks, ...counts('arcane')],
      });
      expect(host.spawnAoeRing).toHaveBeenCalledTimes(1);
    }
    for (const [visuals, tierCounts] of [
      [low, cannonShotCounts(true)],
      [high, cannonShotCounts(false)],
    ] as const) {
      expect(effects.get(visuals)).toEqual({
        smoke: [tierCounts.smoke],
        dust: [tierCounts.dust],
        dirt: [tierCounts.dirt],
        sparks: [tierCounts.sparks, tierCounts.sparks],
      });
    }
    expect(inFlight.get(high)?.every((n) => n > 0)).toBe(true);
    expect(inFlight.get(low)).toEqual(inFlight.get(high));
    for (const visuals of [low, high]) visuals.update(168, 0.45);
    for (const role of ['flash', 'wave']) expect(drawn(low, role)).toBe(drawn(high, role));
    const liveChunks = (visuals: CannonShellVisuals) => {
      const mesh = piece(visuals, 'chunk');
      const m = new THREE.Matrix4();
      let n = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        if (m.determinant() !== 0) n++;
      }
      return n;
    };
    expect(liveChunks(low)).toBe(cannonShotCounts(true).chunks);
    expect(liveChunks(high)).toBe(cannonShotCounts(false).chunks);
    expect(lowHost.vfx.groundPuff.mock.calls.length).toBeLessThan(
      highHost.vfx.groundPuff.mock.calls.length,
    );
    low.dispose();
    high.dispose();
  });

  it('clears every shot and blast, and releases what it minted on dispose', () => {
    const { visuals } = weapon();
    visuals.fire(fired, fallback, 0, false);
    visuals.impact(landed, 0.4, false);
    visuals.update(168, 0.45);
    visuals.clear();
    for (const role of ['shell', 'trail', 'muzzleCore', 'flash', 'wave', 'chunk', 'scorch']) {
      expect(drawn(visuals, role)).toBe(0);
    }
    visuals.update(168, 0.5);
    expect(drawn(visuals, 'scorch')).toBe(0);
    const geometries = new Set<THREE.BufferGeometry>();
    visuals.root.traverse((node) => {
      const geometry = (node as THREE.Mesh).geometry;
      if (geometry) geometries.add(geometry);
    });
    const released = [...geometries, ...materialsUnder(visuals.root)].map((r) =>
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
