import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { blizzardPerimeter } from '../src/render/blizzard_field';
import type { ActiveBlizzard } from '../src/world_api';

const row: ActiveBlizzard = {
  id: 'blizzard:1:20',
  sourceId: 1,
  active: true,
  x: 10,
  z: 20,
  radius: 7,
  duration: 6.5,
  remaining: 3,
};
const terrain = (x: number, z: number) => x * 0.25 + Math.sin(z * 0.3);
describe('authoritative Blizzard footprint', () => {
  it('drapes every edge vertex over slopes while preserving exact outer reach', () => {
    const geometry = blizzardPerimeter(row.x, row.z, row.radius, terrain);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        r = Math.hypot(x - row.x, z - row.z);
      expect(p.getY(i)).toBeCloseTo(terrain(x, z) + 0.09, 4);
      if (i % 2 === 0) expect(r).toBeCloseTo(7, 4);
      else expect(r).toBeLessThan(7);
    }
    geometry.dispose();
  });
  it.each(['event-first', 'snapshot-first'])(
    'keeps one durable field for %s, dims inactive source, retires absent state',
    (order) => {
      const scene = new THREE.Scene(),
        fx = new MageGroundFx(scene, terrain, vi.fn());
      const sync = (rows: ActiveBlizzard[]) =>
        fx.syncWorldMeteorWarnings({
          activeBlizzards: rows,
          activeIgnivarMeteors: [],
          activeVarkhulAnvilMeteors: [],
          activeVarkhulForgestormWarnings: [],
        });
      const event = () =>
        fx.spawnSnowEvent({
          fx: 'snowZone',
          persistentId: row.id,
          x: row.x,
          z: row.z,
          radius: 7,
          duration: 6.5,
          school: 'frost',
        });
      if (order === 'event-first') event();
      sync([row]);
      event();
      sync([row]);
      expect(scene.children.filter((n) => n.name === 'mage-blizzard-boundary')).toHaveLength(1);
      const edge = scene.getObjectByName('mage-blizzard-boundary') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      const vertices = Array.from(edge.geometry.getAttribute('position').array);
      const dispose = vi.spyOn(edge.geometry, 'dispose');
      fx.update(1);
      expect(edge.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(Array.from(edge.geometry.getAttribute('position').array)).toEqual(vertices);
      sync([{ ...row, active: false, remaining: 2 }]);
      fx.update(0.1);
      expect(edge.material.opacity).toBeLessThan(0.25);
      sync([{ ...row, remaining: 0.01 }]);
      fx.update(0.1);
      // A long frame must not dispose an object still owned by the latest snapshot.
      expect(scene.getObjectByName('mage-blizzard-boundary')).toBe(edge);
      expect(dispose).not.toHaveBeenCalled();
      sync([{ ...row, remaining: 0.01 }]);
      fx.update(0.005);
      expect(scene.getObjectByName('mage-blizzard-boundary')).toBe(edge);
      expect(edge.material.opacity).toBeGreaterThan(0.4);
      sync([]);
      fx.update(0);
      expect(scene.getObjectByName('mage-blizzard-boundary')).toBeUndefined();
      expect(dispose).toHaveBeenCalledTimes(1);
      fx.dispose();
    },
  );
});
