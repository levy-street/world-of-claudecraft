import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HourglassFieldVisual } from '../src/render/hourglass_field_visual';
import { disposeRendererPrewarmAndGroundFx } from '../src/render/renderer_resource_lifecycle';
import {
  TemporalHourglassGroundVisuals,
  TemporalHourglassVisual,
} from '../src/render/temporal_hourglass_visual';

describe('Hourglass capture geometry and disposition lifecycle', () => {
  it('keeps the real edge fixed in all modes and differentiates silhouettes without motion', () => {
    const field = new HourglassFieldVisual();
    const matrix = new THREE.Matrix4(),
      at = new THREE.Vector3();
    const ground = (x: number, z: number) => 0.04 * x + 0.02 * z;
    for (const mode of ['protective', 'hostile', 'unknown'] as const) {
      field.update(3, 5, 1.75, mode, ground);
      expect(field.spires.count).toBe(mode === 'hostile' ? 12 : mode === 'protective' ? 4 : 0);
      for (let i = 0; i < 12; i++) {
        field.ticks.getMatrixAt(i * 3, matrix);
        at.setFromMatrixPosition(matrix);
        expect(Math.hypot(at.x - 3, at.z - 5)).toBeCloseTo(1.75, 5);
        expect(at.y).toBeCloseTo(ground(at.x, at.z) + 0.075, 5);
      }
    }
    const version = field.ticks.instanceMatrix.version;
    field.update(3, 5, 1.75, 'unknown', ground);
    expect(field.ticks.instanceMatrix.version).toBe(version);
    field.dispose();
  });

  it('changes same-timer disposition, preserves capture size near expiry and recycles the same objects', () => {
    const scene = new THREE.Scene();
    const fx = new TemporalHourglassGroundVisuals(scene, () => 0);
    const state = {
      id: 'opaque',
      sourceId: 1,
      disposition: 'protective' as const,
      x: 0,
      z: 0,
      radius: 1.75,
      duration: 30,
      remaining: 0.15,
    };
    fx.sync([state]);
    const hourglass = scene.getObjectByName('temporal-hourglass-visual')!;
    const edge = scene.getObjectByName('temporal-hourglass-capture-edge')!;
    const ticks = edge.children[1] as THREE.InstancedMesh;
    const initialMaterial = ticks.material;
    fx.sync([{ ...state, disposition: 'hostile' }]);
    expect(ticks.material).not.toBe(initialMaterial);
    fx.update(0.14);
    expect(hourglass.scale.toArray()).toEqual([1, 1, 1]);
    expect(edge.scale.toArray()).toEqual([1, 1, 1]);
    fx.sync([]);
    expect(scene.children).toHaveLength(0);
    fx.sync([{ ...state, id: 'new', x: 8, remaining: 30 }]);
    expect(scene.getObjectByName('temporal-hourglass-visual')).toBe(hourglass);
    expect(hourglass.position.x).toBe(8);
    const dispose = vi.spyOn(fx, 'dispose');
    disposeRendererPrewarmAndGroundFx(
      { prewarmDepthMaterials: new Map(), temporalHourglassGroundVisuals: fx },
      (fn) => fn(),
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
    fx.dispose();
    const version = ticks.instanceMatrix.version;
    fx.sync([state]);
    fx.update(1);
    expect(scene.children).toHaveLength(0);
    expect(ticks.instanceMatrix.version).toBe(version);
  });

  it('keeps both sand volumes inside their glass throughout the timer and pulse', () => {
    const visual = new TemporalHourglassVisual();
    const point = new THREE.Vector3();
    for (const remaining of [1, 0.8, 0.5, 0.2, 0]) {
      for (const dt of [0, 0.3, 0.7]) {
        visual.update('protective', dt, 1.8, remaining);
        visual.group.updateMatrixWorld(true);
        for (const bulb of ['upper', 'lower']) {
          const sand = visual.group.getObjectByName(
            `temporal-hourglass-${bulb}-sand`,
          ) as THREE.Mesh;
          const glass = visual.group.getObjectByName(
            `temporal-hourglass-${bulb}-glass`,
          ) as THREE.Mesh;
          const vertices = sand.geometry.getAttribute('position');
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(sand.matrixWorld);
            glass.worldToLocal(point);
            expect(point.y).toBeGreaterThanOrEqual(-0.17001);
            expect(point.y).toBeLessThanOrEqual(0.17001);
            const availableRadius = (0.22 * (0.17 - point.y)) / 0.34;
            expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(availableRadius + 0.00001);
          }
        }
      }
    }
    visual.dispose();
  });

  it('makes terminal disposal idempotent and ignores late field and body updates', () => {
    const field = new HourglassFieldVisual(),
      body = new TemporalHourglassVisual();
    const scene = new THREE.Scene();
    scene.add(field.group, body.group);
    field.update(0, 0, 1.75, 'protective', () => 0);
    body.update('protective', 0.1);
    const version = field.ticks.instanceMatrix.version;
    const dispose = vi.spyOn(field.ticks, 'dispose');
    field.dispose();
    body.dispose();
    field.dispose();
    body.dispose();
    field.update(8, 8, 4, 'hostile', () => 0);
    body.update('hostile', 1);
    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(field.ticks.instanceMatrix.version).toBe(version);
    expect(body.currentMode()).toBeNull();
    expect(body.group.visible).toBe(false);
  });
});
