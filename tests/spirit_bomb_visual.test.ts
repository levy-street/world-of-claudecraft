import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpiritBombs } from '../src/render/ability_vfx/spirit_bomb';
import { CAST_VFX_ENGINE, inCastVfxEngine } from '../src/render/cast_vfx_family';
import { bindSpellEffectsWorld, setSpellEffectsEnabled } from '../src/render/spell_effects_switch';
import { createVfxAnchor, type VfxAnchorPose } from '../src/render/vfx_anchor';

const cleanups: (() => void)[] = [];
afterEach(() => {
  setSpellEffectsEnabled(true);
  bindSpellEffectsWorld(() => undefined);
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture() {
  const scene = new THREE.Scene();
  const poses = new Map<number, VfxAnchorPose>(
    Array.from({ length: 7 }, (_, id) => [id, { x: id * 3, y: 2, z: 1, height: 2 }] as const),
  );
  const anchor = vi.fn(
    createVfxAnchor((id, out) => {
      const pose = poses.get(id);
      if (!pose) return false;
      Object.assign(out, pose);
      return true;
    }),
  );
  const impact = vi.fn();
  const bombs = new SpiritBombs(scene, anchor, () => 2, impact);
  cleanups.push(() => bombs.dispose());
  const roots = scene.children as THREE.Group[];
  const visible = () => roots.filter((root) => root.visible);
  return { scene, poses, anchor, impact, bombs, roots, visible };
}

function core(root: THREE.Group): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const mesh = root.children.find(
    (child) =>
      (child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material?.name ===
      'tithe-bomb-core',
  );
  if (!mesh) throw new Error('Missing bomb core');
  return mesh as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

describe('Tithe Bomb pooled visual lifecycle', () => {
  it('sheds only decorative motes at low quality and uploads their used prefix', () => {
    const { bombs, visible } = fixture();
    bombs.hold(1, 1, 1);
    bombs.update(0, 1, false, 0);
    const root = visible()[0];
    const points = root.children.find((child) => child instanceof THREE.Points) as THREE.Points;
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(points.geometry.drawRange.count).toBe(48);
    expect(position.updateRanges).toEqual([{ start: 0, count: 144 }]);
    expect(core(root).scale.x).toBe(3.2);
    bombs.hold(1, 1, 2);
    bombs.update(0, 2, false, 1);
    expect(points.geometry.drawRange.count).toBe(160);
    expect(position.updateRanges).toEqual([{ start: 0, count: 480 }]);
    expect(core(root).scale.x).toBe(3.2);
  });

  it('grows into a giant orb above the moving caster, using caller-owned anchor scratch', () => {
    const { bombs, poses, anchor, visible } = fixture();
    expect(bombs.hold(1, -1, 10)).toBe(true);
    bombs.update(0, 10);
    const root = visible()[0];
    expect(visible()).toHaveLength(1);
    expect(core(root).scale.x).toBeCloseTo(0.35);
    expect(root.position.toArray()).toEqual([3, 7.4, 1]);
    poses.set(1, { x: 7, y: 3, z: 9, height: 2 });
    expect(bombs.hold(1, 2, 11)).toBe(false);
    bombs.update(0.016, 11);
    expect(visible()).toEqual([root]);
    expect(core(root).scale.x).toBeCloseTo(3.2);
    expect(root.position.toArray()).toEqual([7, 8.4, 9]);
    expect(anchor.mock.calls.every((call) => call[2] instanceof THREE.Vector3)).toBe(true);
  });

  it('cancels a dropped or interrupted charge without an explosion', () => {
    const { bombs, visible, impact } = fixture();
    bombs.hold(1, 0.6, 1);
    bombs.update(0, 1);
    expect(visible()).toHaveLength(1);
    bombs.update(0.016, 2);
    expect(visible()).toHaveLength(0);
    bombs.hold(1, 1, 3);
    bombs.update(0, 3);
    bombs.cancel(1);
    bombs.update(2, 4);
    expect(visible()).toHaveLength(0);
    expect(impact).not.toHaveBeenCalled();
  });

  it('flies to the release snapshot, impacts once, and expires even when target view vanishes', () => {
    const { bombs, visible, poses, impact } = fixture();
    bombs.hold(1, 1, 1);
    bombs.update(0, 1);
    const root = visible()[0];
    expect(bombs.release(1, 2)).toBe(true);
    poses.delete(2);
    bombs.cancel(1); // A following non-casting snapshot must not cancel an accepted release.
    bombs.update(0.12, 2);
    expect(root.position.x).toBeCloseTo(4.5);
    expect(impact).not.toHaveBeenCalled();
    bombs.update(0.12, 3);
    expect(root.position.x).toBeCloseTo(6);
    expect(root.position.y).toBeCloseTo(2.7);
    expect(impact).toHaveBeenCalledExactlyOnceWith(6, 2.7, 1);
    bombs.update(0.4, 4);
    const ring = root.children.find(
      (child) => (child as THREE.Mesh).geometry?.type === 'PlaneGeometry',
    );
    expect(ring?.visible).toBe(true);
    expect((ring?.position.y ?? 0) + root.position.y).toBeCloseTo(2.09);
    bombs.update(0.71, 5);
    expect(visible()).toHaveLength(0);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('supports a remote release with no charge history and refuses missing required anchors', () => {
    const { bombs, visible, poses, impact } = fixture();
    expect(bombs.hold(99, 1, 1)).toBe(false);
    expect(bombs.release(99, 2)).toBe(false);
    expect(bombs.release(1, 2)).toBe(true);
    bombs.update(0.24, 1);
    expect(visible()).toHaveLength(1);
    expect(impact).toHaveBeenCalledTimes(1);
    bombs.clear();
    bombs.hold(1, 1, 2);
    bombs.update(0, 2);
    poses.delete(2);
    expect(bombs.release(1, 2)).toBe(false);
    expect(visible()).toHaveLength(0);
  });

  it('checks the ENGINE gate on entry and hides existing pieces when readiness is revoked', () => {
    const { bombs, visible, impact } = fixture();
    const allows = vi.fn((_family: number) => false);
    bombs.spawnGate = { allows };
    expect(bombs.hold(1, 1, 1)).toBe(false);
    expect(bombs.release(1, 2)).toBe(false);
    allows.mockReturnValue(true);
    bombs.hold(1, 1, 2);
    bombs.update(0, 2);
    expect(visible()).toHaveLength(1);
    allows.mockReturnValue(false);
    bombs.update(0.016, 2);
    expect(visible()).toHaveLength(0);
    allows.mockReturnValue(true);
    bombs.release(1, 2);
    allows.mockReturnValue(false);
    bombs.update(0.3, 3);
    expect(impact).not.toHaveBeenCalled();
    expect(allows.mock.calls.every(([family]) => family === CAST_VFX_ENGINE)).toBe(true);
  });

  it('caps concurrent pieces and reserves a charging slot for the local player', () => {
    const { bombs, roots, visible } = fixture();
    for (let id = 0; id < 4; id++) expect(bombs.hold(id, 1, 1)).toBe(true);
    bombs.update(0, 1);
    expect(roots).toHaveLength(4);
    expect(visible()).toHaveLength(4);
    expect(bombs.hold(4, 1, 1)).toBe(false);
    expect(bombs.hold(4, 1, 1, true)).toBe(true);
    bombs.update(0, 1);
    expect(visible()).toHaveLength(4);
    expect(visible().map((root) => root.position.x)).toContain(12);
    bombs.cancel(4);
    expect(visible()).toHaveLength(3);
  });

  it('drops a player bomb muted during flight without hiding an enemy source aimed at the player', () => {
    const { bombs, visible, impact } = fixture();
    bindSpellEffectsWorld((id) => ({ kind: id === 1 ? 'player' : 'mob', ownerId: null }));
    bombs.hold(1, 1, 1);
    bombs.update(0, 1);
    expect(bombs.release(1, 2)).toBe(true);
    setSpellEffectsEnabled(false);
    bombs.update(0.24, 2);
    expect(visible()).toHaveLength(0);
    expect(impact).not.toHaveBeenCalled();
    expect(bombs.release(2, 1)).toBe(true);
    bombs.update(0.24, 3);
    expect(visible()).toHaveLength(1);
    expect(impact).toHaveBeenCalledExactlyOnceWith(3, 2.7, 1);
    bombs.clear();
    setSpellEffectsEnabled(true);
    bombs.update(0.2, 4);
    expect(visible()).toHaveLength(0);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('finishes disposal after a material listener throws and never retries disposed resources', () => {
    const { scene, bombs, roots } = fixture();
    const pieces = roots.flatMap((root) => root.children) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >[];
    const materials = new Set(pieces.map((piece) => piece.material));
    const geometries = new Set(pieces.map((piece) => piece.geometry));
    const disposeCalls = [...materials, ...geometries].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    core(roots[0]).material.addEventListener('dispose', () => {
      throw new Error('Injected disposal listener failure');
    });
    expect(() => bombs.dispose()).toThrow();
    expect(scene.children).toHaveLength(0);
    for (const disposed of disposeCalls) expect(disposed).toHaveBeenCalledTimes(1);
    expect(() => bombs.dispose()).not.toThrow();
    for (const disposed of disposeCalls) expect(disposed).toHaveBeenCalledTimes(1);
    expect(bombs.hold(1, 1, 10)).toBe(false);
    expect(bombs.release(1, 2)).toBe(false);
  });

  it('freezes cosmetic motion under reduced motion while keeping flight and expiry', () => {
    const { bombs, visible, impact } = fixture();
    bombs.hold(1, 1, 1);
    bombs.update(0.4, 1, true);
    const root = visible()[0];
    const points = root.children.find((child) => child instanceof THREE.Points) as THREE.Points;
    const positions = Array.from(points.geometry.getAttribute('position').array);
    bombs.hold(1, 1, 2);
    bombs.update(0.4, 2, true);
    expect(core(root).material.uniforms.uTime.value).toBe(0);
    expect(Array.from(points.geometry.getAttribute('position').array)).toEqual(positions);
    bombs.release(1, 2);
    bombs.update(0.24, 3, true);
    expect(impact).toHaveBeenCalledTimes(1);
    bombs.update(1.11, 4, true);
    expect(visible()).toHaveLength(0);
  });

  it('prebuilds tagged reusable resources and disposes every unique GPU resource exactly once', () => {
    const { scene, bombs, roots } = fixture();
    const objects = roots.flatMap((root) => root.children) as (
      | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      | THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    )[];
    expect(objects).toHaveLength(16);
    const geometries = new Set(objects.map((object) => object.geometry));
    const materials = new Set(objects.map((object) => object.material));
    const disposeCalls = [...geometries, ...materials].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    for (const object of objects) {
      expect(inCastVfxEngine(object)).toBe(true);
      expect(object.material.depthTest).toBe(true);
      expect(object.material.depthWrite).toBe(false);
    }
    for (let frame = 0; frame < 6; frame++) {
      bombs.hold(1, 1, frame);
      bombs.update(0, frame);
      bombs.release(1, 2);
      bombs.update(2, frame);
      bombs.clear();
    }
    expect(roots.flatMap((root) => root.children)).toEqual(objects);
    expect(new Set(objects.map((object) => object.geometry))).toEqual(geometries);
    expect(new Set(objects.map((object) => object.material))).toEqual(materials);
    for (const disposed of disposeCalls) expect(disposed).not.toHaveBeenCalled();
    bombs.dispose();
    bombs.dispose();
    expect(scene.children).toHaveLength(0);
    for (const disposed of disposeCalls) expect(disposed).toHaveBeenCalledTimes(1);
    expect(bombs.hold(1, 1, 10)).toBe(false);
    expect(bombs.release(1, 2)).toBe(false);
  });
});
