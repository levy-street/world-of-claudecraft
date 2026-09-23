import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RestorativeWaterVolumes } from '../src/render/ability_vfx/water_volumes';

function fixture() {
  const scene = new THREE.Scene();
  const water = new RestorativeWaterVolumes(scene);
  const spawn = (id: number, priority: 0 | 1 = 0, duration = 1) =>
    water.spawn(
      { x: id, y: 0, z: 0 },
      { x: id, y: 1, z: 1 },
      0x288d9d,
      0xbdece0,
      0.2,
      duration,
      priority,
    );
  const starts = () => {
    const attribute = water.mesh.geometry.getAttribute('aFrom');
    return Array.from({ length: attribute.count }, (_, i) => attribute.getX(i));
  };
  return { scene, water, spawn, starts };
}

describe('Restorative water volume admission', () => {
  it('fits four real links and two recipient folds each within the existing twelve-slot draw', () => {
    const h = fixture();
    for (let recipient = 1; recipient <= 4; recipient++) {
      h.spawn(recipient, 1);
      h.spawn(recipient + 10);
      h.spawn(recipient + 20);
    }
    expect(h.starts()).toHaveLength(12);
    expect(new Set(h.starts()).size).toBe(12);
    expect(h.water.mesh.geometry.instanceCount).toBe(12);
    expect(h.water.mesh.material.name).toBe('ShamanRestorativeWater');
    h.water.dispose();
  });

  it('preserves every real link when repeated decorative arrivals saturate the pool', () => {
    const h = fixture();
    for (let id = 1; id <= 4; id++) h.spawn(id, 1, 0.4);
    for (let id = 10; id < 18; id++) h.spawn(id, 0, 1);
    for (let id = 30; id < 60; id++) h.spawn(id, 0, 0.8);
    for (let id = 1; id <= 4; id++) expect(h.starts()).toContain(id);
    expect(h.starts()).toHaveLength(12);
    h.water.dispose();
  });

  it('admits a new real link by replacing decoration before an earlier-expiring real link', () => {
    const h = fixture();
    for (let id = 1; id <= 11; id++) h.spawn(id, 1, 0.3);
    h.spawn(20, 0, 1.5);
    h.spawn(99, 1, 1);
    const kept = h.starts();
    for (let id = 1; id <= 11; id++) expect(kept).toContain(id);
    expect(kept).toContain(99);
    expect(kept).not.toContain(20);
    // With only links resident, decoration is declined without touching any attributes.
    h.spawn(100, 0, 1);
    expect(h.starts()).toEqual(kept);
    h.water.dispose();
  });

  it('reuses expired primary slots and preserves the fixed allocation through clear and expiry', () => {
    const h = fixture();
    for (let id = 1; id <= 12; id++) h.spawn(id, 1, 0.1);
    const geometry = h.water.mesh.geometry;
    const material = h.water.mesh.material;
    h.water.update(0.11, true);
    expect(h.water.mesh.visible).toBe(false);
    h.spawn(30, 0);
    expect(h.starts()).toContain(30);
    expect(h.water.mesh.visible).toBe(true);
    h.water.clear();
    expect(h.water.mesh.visible).toBe(false);
    h.spawn(50, 0);
    expect(h.starts()[0]).toBe(50);
    expect(h.water.mesh.geometry).toBe(geometry);
    expect(h.water.mesh.material).toBe(material);
    h.water.dispose();
  });

  it('attempts every owned cleanup even when earlier releases throw and remains terminal', () => {
    const h = fixture();
    h.spawn(1, 1);
    const clearFailure = new Error('clear failed');
    const detachFailure = new Error('detach failed');
    const geometryFailure = new Error('geometry failed');
    const clear = vi.spyOn(h.water, 'clear').mockImplementation(() => {
      throw clearFailure;
    });
    const unbind = vi.spyOn(h.water as unknown as { unbind: () => void }, 'unbind');
    const detach = vi.spyOn(h.water.mesh, 'removeFromParent').mockImplementation(() => {
      throw detachFailure;
    });
    const geometry = vi.spyOn(h.water.mesh.geometry, 'dispose').mockImplementation(() => {
      throw geometryFailure;
    });
    const material = vi.spyOn(h.water.mesh.material, 'dispose');
    let error: unknown;
    try {
      h.water.dispose();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      clearFailure,
      detachFailure,
      geometryFailure,
    ]);
    for (const cleanup of [clear, unbind, detach, geometry, material])
      expect(cleanup).toHaveBeenCalledOnce();
    expect(h.water.mesh.visible).toBe(false);
    expect(() => h.water.dispose()).not.toThrow();
    h.spawn(2, 1);
    h.water.update(1, false);
    expect(h.water.mesh.visible).toBe(false);
    for (const cleanup of [clear, unbind, detach, geometry, material])
      expect(cleanup).toHaveBeenCalledOnce();
  });

  it('defaults shared streams to legacy and overwrites Shaman profiles when slots are reused', () => {
    const h = fixture();
    const flow = h.water.mesh.geometry.getAttribute('aFlow');
    h.spawn(1);
    expect(flow.getX(0)).toBe(0);
    h.water.clear();
    h.water.spawn({ x: 0, y: 1, z: 0 }, { x: 2, y: 3, z: 0 }, 0x288d9d, 0xbdece0, 0.3, 0.5, 1, 2);
    expect(flow.getX(0)).toBe(2);
    h.water.update(0.6, false);
    h.spawn(2);
    expect(flow.getX(0)).toBe(0);
    h.water.dispose();
  });

  it('disposes owned resources once and rejects late spawns or updates', () => {
    const h = fixture();
    const geometry = vi.spyOn(h.water.mesh.geometry, 'dispose');
    const material = vi.spyOn(h.water.mesh.material, 'dispose');
    h.spawn(1, 1);
    h.water.dispose();
    h.water.dispose();
    h.spawn(2, 1);
    h.water.update(0.2, false);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(h.water.mesh.parent).toBeNull();
    expect(h.water.mesh.visible).toBe(false);
  });
});
