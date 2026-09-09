import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { drawThroatWire } from '../src/render/ability_vfx/action_contact';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';

it('keeps both wire ends on moving hands and the victim throat, then drops a missing victim', () => {
  let x = 0,
    exists = true;
  const fills: ((p: THREE.Vector3[]) => number)[] = [];
  const host = {
    anchorOf: (_id: number, _h: number, out: THREE.Vector3) =>
      exists ? out.set(x + 2, 1.4, 0) : null,
    handPoint: (_id: number, hand: number, out: THREE.Vector3) =>
      out.set(x, 1.2, hand ? 0.25 : -0.25),
    tetherRibbon: (_c: number, _w: number, _l: number, fill: (p: THREE.Vector3[]) => number) =>
      fills.push(fill),
    burstAt: vi.fn(),
    contact: vi.fn(),
    countPrimitive: vi.fn(),
  } as unknown as SequencerHost;
  // The anchor seam accepts Vec3-like scratch, not necessarily Three vectors.
  host.anchorOf = (_id, _h, out) => {
    if (!exists) return null;
    Object.assign(out!, { x: x + 2, y: 1.4, z: 0 });
    return out!;
  };
  host.handPoint = (_id, hand, out) => {
    Object.assign(out, { x, y: 1.2, z: hand ? 0.25 : -0.25 });
    return out;
  };
  const slot = { casterId: 1, targetId: 2, abilityId: 'garrote' } as SeqSlot;
  drawThroatWire(host, slot);
  expect(fills).toHaveLength(2);
  const points = Array.from({ length: 12 }, () => new THREE.Vector3());
  fills[0](points);
  expect(points[0].x).toBe(0);
  expect(points[11].x).toBeCloseTo(1.87);
  x = 3;
  slot.casterId = 7;
  slot.targetId = 8;
  fills[0](points);
  expect(points[0].x).toBe(3);
  expect(points[11].x).toBeCloseTo(4.87);
  expect(host.contact).toHaveBeenCalledOnce();
  exists = false;
  expect(fills[1](points)).toBe(0);
});
