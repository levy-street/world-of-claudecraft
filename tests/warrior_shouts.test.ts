import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { physicalImpact } from '../src/render/ability_vfx/physical_choreography';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import {
  buildWarriorPressure,
  WARRIOR_PRESSURE_KINDS,
} from '../src/render/ability_vfx/warrior_shout_shapes';
import { drawWarriorShout } from '../src/render/ability_vfx/warrior_shouts';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

describe('Warrior surrounding voice sculptures', () => {
  it.each(WARRIOR_PRESSURE_KINDS)('builds finite open %s geometry at preparation time', (kind) => {
    const geometry = buildWarriorPressure(kind);
    const positions = geometry.getAttribute('position');
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(geometry.index!.array))).toBeLessThan(positions.count);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(8);
    expect(size.z).toBeGreaterThan(8);
    expect(size.y).toBeGreaterThan(0.8);
    expect(geometry.index!.count / 3).toBeLessThanOrEqual(2304);
    geometry.dispose();
  });

  it.each([
    'battle_shout',
    'rallying_cry',
    'emboldening_roar',
    'defiant_bellow',
    'demoralizing_shout',
    'intimidating_shout',
    'piercing_howl',
  ])(
    '%s sends pressure into every quadrant without faking damage or repainting recipients',
    (id) => {
      const host = {
        anchorOf: (_id: number, _fraction: number, out: THREE.Vector3) =>
          Object.assign(out, { x: 10, y: 2, z: 20 }),
        groundYAt: () => 2,
        facingAt: () => 0,
        crestAt: vi.fn(),
        pulseLight: vi.fn(),
        bakedAt: vi.fn(),
        fragmentsAt: vi.fn(),
        pathRibbon: vi.fn(),
        countPrimitive: vi.fn(),
        contact: vi.fn(),
        glowPulse: vi.fn(),
        flipbookAt: vi.fn(),
        burstAt: vi.fn(),
      } as unknown as SequencerHost;
      const spec = WARRIOR_VFX_FULL_SPECS[id];
      const slot = { abilityId: id, casterId: 1, targetId: 2, tier: 1, spec } as SeqSlot;
      for (let beat = 0; beat < spec.physical!.beats.length; beat++)
        expect(drawWarriorShout(host, slot, beat)).toBe(true);
      expect(host.crestAt).toHaveBeenCalledTimes(1);
      const dust = vi.mocked(host.bakedAt!).mock.calls;
      expect(dust.some((call) => call[1] > 11)).toBe(true);
      expect(dust.some((call) => call[1] < 9)).toBe(true);
      expect(dust.some((call) => call[3] > 21)).toBe(true);
      expect(dust.some((call) => call[3] < 19)).toBe(true);
      for (const call of vi.mocked(host.pathRibbon).mock.calls) {
        const points = Array.from({ length: 24 }, () => new THREE.Vector3());
        call[3](points);
        expect(points.every((point) => [point.x, point.y, point.z].every(Number.isFinite))).toBe(
          true,
        );
        expect(points[0].distanceTo(points.at(-1)!)).toBeGreaterThan(0.5);
      }
      expect(host.contact).not.toHaveBeenCalled();
      expect(host.glowPulse).not.toHaveBeenCalled();
      expect(host.flipbookAt).not.toHaveBeenCalled();
      expect(host.burstAt).not.toHaveBeenCalled();
      vi.mocked(host.crestAt!).mockClear();
      slot.physicalSecondary = true;
      drawWarriorShout(host, slot, 0);
      expect(host.crestAt).not.toHaveBeenCalled();
    },
  );
});

it('secondary shout announcements cannot create a generic victim hit', () => {
  const host = { burstAt: vi.fn(), countPrimitive: vi.fn() } as unknown as SequencerHost;
  const spec = WARRIOR_VFX_FULL_SPECS.demoralizing_shout;
  const slot = {
    abilityId: 'demoralizing_shout',
    physicalSecondary: true,
    spec,
    t: 0.15,
    ix: 1,
    iy: 2,
    iz: 3,
    color: 0xffffff,
  } as SeqSlot;
  physicalImpact(host, slot);
  expect(host.burstAt).not.toHaveBeenCalled();
  expect(slot.motifLoops).toBe(spec.physical!.beats.length);
});

it('a fresh prepared shout inherits reduced motion before its first visible frame', () => {
  const scene = new THREE.Scene();
  const crests = new SignatureCrests(scene);
  vi.spyOn(crests.preparation, 'ready').mockReturnValue(true);
  crests.update(0, true);
  crests.spawn(0, 0, 0, 2, 1, 0x777777, 0xffffff, 'rally_pressure');
  const mesh = scene.children.find(
    (child) => child.name === 'signatureCrest' && child.visible,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect(mesh).toBeDefined();
  expect(mesh.material.uniforms.uMotion.value).toBe(0);
  crests.update(0.1, true);
  expect(mesh.material.uniforms.uMotion.value).toBe(0);
  crests.clear();
  crests.update(0, false);
  crests.spawn(0, 0, 0, 2, 1, 0x777777, 0xffffff, 'rally_pressure');
  expect(mesh.material.uniforms.uMotion.value).toBe(1);
  crests.dispose();
});

it('a full shout pool yields a backing surface to a real Fury contact', () => {
  const scene = new THREE.Scene(),
    crests = new SignatureCrests(scene);
  vi.spyOn(crests.preparation, 'ready').mockReturnValue(true);
  for (let i = 0; i < 8; i++) {
    crests.spawn(i, 0, 0, 2, 1, 0x777777, 0xffffff, 'rally_pressure');
    crests.update(0.01, false);
  }
  crests.spawn(20, 0, 0, 1, 1, 0x990000, 0xff3300, 'blood_cut');
  const visible = scene.children.filter(
    (child) => child.name === 'signatureCrest' && child.visible,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  expect(visible).toHaveLength(8);
  const contact = visible.find((mesh) => mesh.material.uniforms.uKind.value === 12);
  expect(contact?.position.x).toBe(20);
  crests.spawn(30, 0, 0, 2, 1, 0x777777, 0xffffff, 'rally_pressure');
  expect(contact?.visible).toBe(true);
  expect(contact?.position.x).toBe(20);
  crests.dispose();
});

it('samples independent rotated terrain grids once per pressure birth', () => {
  const scene = new THREE.Scene();
  const ground = vi.fn((x: number, z: number) => x * 0.3 + z * 0.15);
  const crests = new SignatureCrests(scene, ground);
  vi.spyOn(crests.preparation, 'ready').mockReturnValue(true);
  crests.spawn(4, ground(4, 6), 6, 2, 1.5, 0x777777, 0xffffff, 'challenge_pressure', Math.PI / 2);
  const mesh = scene.children.find(
    (child) => child.name === 'signatureCrest' && child.visible,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const grid = mesh.material.uniforms.uPressureGround.value as Float32Array;
  expect(grid[12]).toBeCloseTo(2);
  expect(grid[14]).toBeCloseTo(0.8);
  expect(grid[22]).toBeCloseTo(4);
  const samples = ground.mock.calls.length;
  crests.update(0.2, false);
  expect(ground).toHaveBeenCalledTimes(samples);
  crests.spawn(0, 0, 0, 1, 1, 0x777777, 0xffffff, 'rally_pressure');
  const other = scene.children.filter(
    (child) => child.name === 'signatureCrest' && child.visible,
  )[1] as typeof mesh;
  expect(other.material.uniforms.uPressureGround.value).not.toBe(grid);
  expect(grid[14]).toBeCloseTo(0.8);
  crests.dispose();
});

it('keeps the pressure height grid finite when the caster floor sample is unavailable', () => {
  const scene = new THREE.Scene();
  const floor = vi.fn(() => 0).mockReturnValueOnce(NaN);
  const crests = new SignatureCrests(scene, floor);
  vi.spyOn(crests.preparation, 'ready').mockReturnValue(true);
  crests.spawn(0, 2, 0, 2, 1, 0x777777, 0xffffff, 'rally_pressure');
  const mesh = scene.children.find(
    (child) => child.name === 'signatureCrest' && child.visible,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect(
    Array.from(mesh.material.uniforms.uPressureGround.value as Float32Array).every(Number.isFinite),
  ).toBe(true);
  crests.dispose();
});

it('keeps a full-size directed primary silhouette when its sculpture is cold', () => {
  const crests = new SignatureCrests(new THREE.Scene());
  expect(crests.preparation.ready('piercing_pressure')).toBe(false);
  const host = {
    anchorOf: (_id: number, fraction: number, out: THREE.Vector3) =>
      Object.assign(out, { x: 0, y: fraction * 3, z: 0 }),
    groundYAt: (_x: number, z: number) => z * 0.2,
    facingAt: () => 0,
    crestAt: crests.spawn.bind(crests),
    pulseLight: vi.fn(),
    bakedAt: vi.fn(),
    fragmentsAt: vi.fn(),
    pathRibbon: vi.fn(),
    countPrimitive: vi.fn(),
    burstAt: vi.fn(),
  } as unknown as SequencerHost;
  const slot = {
    abilityId: 'piercing_howl',
    casterId: 1,
    tier: 1,
    spec: WARRIOR_VFX_FULL_SPECS.piercing_howl,
  } as SeqSlot;
  drawWarriorShout(host, slot, 0);
  const primary = vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[7] === 1);
  expect(primary).toHaveLength(3);
  for (const call of primary) {
    const points = Array.from({ length: 24 }, () => new THREE.Vector3());
    call[3](points);
    expect(points[0].x).toBe(0);
    // The slowing rake originates at the ankles and follows sloping terrain.
    expect(points[0].y).toBeCloseTo(0.146, 12);
    expect(points[0].z).toBe(0);
    expect(points.at(-1)!.z).toBeCloseTo(22.08);
    expect(points.every((p) => p.y >= host.groundYAt(p.x, p.z))).toBe(true);
  }
  expect(crests.preparation.ready('piercing_pressure')).toBe(false);
  crests.dispose();
});
