import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  SanguineWeaponSheath,
  sanguineWeaponGeometry,
} from '../src/render/characters/sanguine_weapon_sheath';
import { compileTargetPrepared } from '../src/render/compile_target_readiness';
import { markProgramReady } from '../src/render/linked_program_readiness';

const assets = vi.hoisted(() => ({ texture: null as THREE.Texture | null }));
vi.mock('../src/render/ability_vfx/production_assets', () => ({
  warriorBloodTexture: () => assets.texture,
}));

function fixture() {
  assets.texture = new THREE.Texture();
  const scene = new THREE.Group();
  const source = new THREE.BoxGeometry(0.15, 2, 0.08);
  const fallback = new THREE.MeshBasicMaterial({ color: 0xff4636 });
  const aura = new THREE.Mesh(source, fallback);
  scene.add(aura);
  const owner = new SanguineWeaponSheath();
  const jobs: { target: THREE.Object3D; settle: (prepared?: () => boolean) => void }[] = [];
  owner.setGate((target, settle) => jobs.push({ target, settle }));
  return { scene, source, fallback, aura, owner, jobs };
}

describe('Sanguine weapon ownership', () => {
  it('projects detail along the blade without changing source positions or skin UVs', () => {
    const source = new THREE.BoxGeometry(0.15, 2, 0.08);
    const uvBefore = [...source.getAttribute('uv').array];
    const result = sanguineWeaponGeometry(source);
    expect([...source.getAttribute('uv').array]).toEqual(uvBefore);
    expect([...result.getAttribute('position').array]).toEqual([
      ...source.getAttribute('position').array,
    ]);
    const uv = result.getAttribute('uv');
    const position = result.getAttribute('position');
    for (let i = 0; i < uv.count; i++) expect(uv.getX(i)).toBeCloseTo((position.getY(i) + 1) / 2);
    result.dispose();
    source.dispose();
  });

  it('keeps the old overlay until proven ready, then mounts the exact compiled material', () => {
    const f = fixture();
    const oldDisposed = vi.spyOn(f.fallback, 'dispose');
    const sourceDisposed = vi.spyOn(f.source, 'dispose');
    f.owner.stage(f.aura);
    expect(f.aura.material).toBe(f.fallback);
    const compiled = f.jobs[0].target as THREE.Mesh;
    expect(compiled).not.toBeInstanceOf(THREE.SkinnedMesh);
    expect(compiled.parent).toBe(null);
    const proof = vi.fn(() => true);
    f.jobs[0].settle(proof);
    expect(proof).toHaveBeenCalledOnce();
    expect(f.aura.material).toBe(compiled.material);
    expect(f.aura.geometry).toBe(compiled.geometry);
    expect(f.aura.userData.ownsAuraGeometry).toBe(true);
    expect(oldDisposed).toHaveBeenCalledOnce();
    expect(sourceDisposed).not.toHaveBeenCalled();
    const liveDisposed = vi.spyOn(f.aura.material, 'dispose');
    f.owner.clear();
    expect(liveDisposed).not.toHaveBeenCalled();
  });

  it.each<['a thunk proving not-ready' | 'no thunk at all', (() => boolean) | undefined]>([
    ['a thunk proving not-ready', () => false],
    ['no thunk at all', undefined],
  ])('does not treat %s as preparation', (_label, proof) => {
    const f = fixture();
    f.owner.stage(f.aura);
    const target = f.jobs[0].target as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const materialDisposed = vi.spyOn(target.material, 'dispose');
    const geometryDisposed = vi.spyOn(target.geometry, 'dispose');
    f.jobs[0].settle(proof);
    expect(f.aura.material).toBe(f.fallback);
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(geometryDisposed).toHaveBeenCalledOnce();
  });

  it.each<['clear' | 'gate replacement' | 'detached weapon', boolean]>([
    // A cleared or replaced owner drops the pending upgrade outright, so the
    // stale settle is discarded before the readiness proof is ever read:
    // laziness holds even off the hot crowd path. A detached weapon is still
    // the pending upgrade (only aura.parent says no), so the proof IS read;
    // either way nothing mounts.
    ['clear', false],
    ['gate replacement', false],
    ['detached weapon', true],
  ])('rejects stale upgrades after %s', (reason, proofRead) => {
    const f = fixture();
    f.owner.stage(f.aura);
    const target = f.jobs[0].target as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const materialDisposed = vi.spyOn(target.material, 'dispose');
    const textureDisposed = vi.spyOn(assets.texture!, 'dispose');
    if (reason === 'clear') f.owner.clear();
    else if (reason === 'gate replacement') f.owner.setGate(null);
    else f.aura.removeFromParent();
    const proof = vi.fn(() => true);
    f.jobs[0].settle(proof);
    expect(f.aura.material).toBe(f.fallback);
    expect(materialDisposed).toHaveBeenCalled();
    expect(textureDisposed).not.toHaveBeenCalled();
    expect(proof).toHaveBeenCalledTimes(proofRead ? 1 : 0);
  });
});

describe('compile target readiness proof', () => {
  it('requires every face program and the actual uploaded texture in this context', () => {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const target = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const records = new Map<object, unknown>();
    const properties = { get: (object: object) => records.get(object) };
    const first = { getUniforms() {}, getAttributes() {} };
    const second = { getUniforms() {}, getAttributes() {} };
    expect(compileTargetPrepared(properties, target)).toBe(false);
    records.set(material, {
      programs: new Map([
        ['front', first],
        ['back', second],
      ]),
    });
    markProgramReady(first);
    expect(compileTargetPrepared(properties, target)).toBe(false);
    markProgramReady(second);
    expect(compileTargetPrepared(properties, target)).toBe(false);
    records.set(texture, { __webglTexture: {}, __version: texture.version });
    expect(compileTargetPrepared(properties, target)).toBe(true);
    texture.needsUpdate = true;
    expect(compileTargetPrepared(properties, target)).toBe(false);
    expect(compileTargetPrepared({ get: () => undefined }, target)).toBe(false);
    expect(compileTargetPrepared(properties, new THREE.Group())).toBe(false);
    target.geometry.dispose();
    material.dispose();
    texture.dispose();
  });
});
