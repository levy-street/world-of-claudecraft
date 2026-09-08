import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import { CombatStatusSignals } from '../src/render/combat_status_signals';

describe('protected combat status batch', () => {
  it('keeps 150 simultaneous states, grows once and uploads only the live prefix', () => {
    const scene = new THREE.Scene();
    const fx = new CombatStatusSignals(scene);
    const mesh = scene.getObjectByName('combat-status-signals') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >;
    const initial = mesh.geometry;
    const disposed = vi.fn();
    initial.addEventListener('dispose', disposed);
    const scratches = new Set<THREE.Vector3>();
    const anchor = (id: number, _frac: number, out?: THREE.Vector3) => {
      expect(out).toBeDefined();
      scratches.add(out!);
      return out!.set(id, 2, -20);
    };
    for (let frame = 0; frame < 3; frame++) {
      for (let id = 1; id <= 50; id++)
        fx.hold({
          id,
          auras: [
            { id: 'a', kind: 'stun', remaining: 3, duration: 6 },
            { id: 'b', kind: 'root', remaining: 2 },
            { id: 'c', kind: 'silence', remaining: 4 },
          ],
        });
      fx.update(0.05, anchor);
      expect(mesh.geometry.instanceCount).toBe(150);
      expect(fx.hasDrawn(50)).toBe(true);
    }
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(scratches.size).toBe(1);
    expect(fx.stats().capacity).toBe(256);
    for (const name of ['aCenter', 'aColor', 'aData']) {
      const attr = mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(attr.updateRanges).toEqual([{ start: 0, count: 150 * attr.itemSize }]);
    }
    fx.setViewportHeight(800);
    expect(mesh.material.uniforms.uViewport.value).toBe(800);
    fx.update(0.05, anchor);
    expect(mesh.geometry.instanceCount).toBe(0);
    expect(fx.stats().actors).toBe(0);
    const finalGeometryDisposed = vi.fn(),
      materialDisposed = vi.fn();
    mesh.geometry.addEventListener('dispose', finalGeometryDisposed);
    mesh.material.addEventListener('dispose', materialDisposed);
    fx.dispose();
    expect(finalGeometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });

  it('prepares the real batch and clears expired, sleeping, dead and missing-anchor states', () => {
    const scene = new THREE.Scene();
    const fx = new CombatStatusSignals(scene);
    const mesh = scene.getObjectByName('combat-status-signals') as THREE.Mesh;
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets.some((target) => target.object === mesh)).toBe(true);
    const anchor = (_id: number, _frac: number, out?: THREE.Vector3) => out!.set(0, 2, -10);
    for (const id of [1, 2, 3, 4])
      fx.hold({ id, auras: [{ id: 'cc', kind: 'stun', remaining: 3 }] });
    fx.update(0.05, anchor);
    expect(fx.stats().signals).toBe(4);
    fx.hold({ id: 1, auras: [] });
    fx.hold({ id: 2, dead: true, auras: [{ id: 'cc', kind: 'stun', remaining: 3 }] });
    fx.hold({ id: 3, auras: [{ id: 'cc', kind: 'stun', remaining: 3 }] });
    fx.hold({ id: 4, auras: [{ id: 'cc', kind: 'stun', remaining: 3 }] });
    fx.sleep(4);
    fx.update(0.05, anchor);
    expect(fx.stats().signals).toBe(1);
    expect(fx.hasDrawn(1)).toBe(false);
    expect(fx.hasDrawn(2)).toBe(false);
    expect(fx.hasDrawn(3)).toBe(true);
    expect(fx.hasDrawn(4)).toBe(false);
    fx.hold({ id: 3, auras: [{ id: 'cc', kind: 'stun', remaining: 3 }] });
    fx.update(0.05, () => null);
    expect(fx.stats().signals).toBe(0);
    expect(fx.hasDrawn(3)).toBe(false);
    fx.clear();
    expect(fx.stats().actors).toBe(0);
    fx.dispose();
  });
});
