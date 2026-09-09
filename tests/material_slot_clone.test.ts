import { describe, expect, it } from 'vitest';

import { type MaterialStackSlot, normalizeMaterialStack } from '../src/sim/material_stack';
import { cloneInvSlot, type ItemInstancePayload } from '../src/sim/types';

const MATERIALS = new Set(['rough_hide']);

function materialSlot(instance?: ItemInstancePayload): MaterialStackSlot {
  return {
    itemId: 'rough_hide',
    count: 3,
    slot: 4,
    materialSeparated: true,
    ...(instance ? { instance } : {}),
    materialSources: [
      {
        source: { gatherer: { kind: 'character', id: 7, name: 'Ayla' }, signer: 'Ayla' },
        count: 2,
      },
      { source: {}, count: 1 },
    ],
  };
}

describe('material provenance at the shared inventory copy seam', () => {
  it.each([undefined, { boundTo: 7 }])(
    'detaches every source bucket with payload %j',
    (instance) => {
      const original = materialSlot(instance);
      const copied = cloneInvSlot(original);
      expect(copied).toEqual(original);
      expect(copied.materialSources).not.toBe(original.materialSources);
      expect(copied.materialSources?.[0].source).not.toBe(original.materialSources?.[0].source);
      expect(copied.materialSources?.[0].source.gatherer).not.toBe(
        original.materialSources?.[0].source.gatherer,
      );
      const mutable = copied.materialSources as {
        count: number;
        source: { signer?: string; gatherer?: { name: string } };
      }[];
      mutable[0].count = 1;
      mutable[0].source.signer = 'Bram';
      if (mutable[0].source.gatherer) mutable[0].source.gatherer.name = 'Bram';
      expect(original.materialSources?.[0]).toEqual({
        count: 2,
        source: { gatherer: { kind: 'character', id: 7, name: 'Ayla' }, signer: 'Ayla' },
      });
      expect(copied.slot).toBe(4);
      expect(copied.materialSeparated).toBe(true);
    },
  );

  it('detaches unknown nested payload data on a material source slot', () => {
    const original = materialSlot(JSON.parse('{"future":{"marks":[{"value":1}]}}'));
    const copied = cloneInvSlot(original);
    const payload = copied.instance as unknown as { future: { marks: { value: number }[] } };
    payload.future.marks[0].value = 9;
    expect(original.instance).toEqual({ future: { marks: [{ value: 1 }] } });
  });

  it('preserves malformed source data for load validation without aliasing or relabelling it', () => {
    const original = JSON.parse(
      '{"itemId":"rough_hide","count":1,"materialSources":{"future":[{"count":3}]}}',
    );
    const copied = cloneInvSlot(original);
    expect(copied).toEqual(original);
    copied.materialSources.future[0].count = 9;
    expect(original.materialSources.future[0].count).toBe(3);
    expect(normalizeMaterialStack(copied, MATERIALS).ok).toBe(false);
  });

  it('keeps legacy slots sparse while still cloning their existing instance payload', () => {
    const original = { itemId: 'rough_hide', count: 2, instance: { signer: 'Ayla' } };
    const copied = cloneInvSlot(original);
    expect(copied).toEqual(original);
    expect(Object.hasOwn(copied, 'materialSources')).toBe(false);
    expect(Object.hasOwn(copied, 'materialSeparated')).toBe(false);
    expect(copied.instance).not.toBe(original.instance);
  });
});
