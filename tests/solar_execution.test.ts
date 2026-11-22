import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { solarExecution } from '../src/render/ability_vfx/solar_execution';

it('keeps the execution sword over its victim instead of drawing a damage-radius circle', () => {
  const paths: THREE.Vector3[][] = [];
  const host = {
    anchorOf: (_id: number, _height: number, out: THREE.Vector3) =>
      Object.assign(out, { x: 2, y: 1, z: 3 }),
    pathRibbon: (
      _color: number,
      _width: number,
      life: number,
      fill: (points: THREE.Vector3[]) => void,
    ) => {
      expect(life).toBeLessThan(0.6);
      const points = Array.from({ length: 12 }, () => new THREE.Vector3());
      fill(points);
      paths.push(points);
    },
    countPrimitive: vi.fn(),
    contact: vi.fn(),
    ringAt: vi.fn(),
  } as unknown as SequencerHost;
  solarExecution(host, 1, 2);
  expect(paths[0].every((point) => point.x === 2 && point.z === 3)).toBe(true);
  expect(paths[0][11].y - paths[0][0].y).toBeGreaterThan(7);
  expect(host.ringAt).not.toHaveBeenCalled();
  expect(host.contact).toHaveBeenCalledWith(1, 2, 'holy', 2.2);
});
