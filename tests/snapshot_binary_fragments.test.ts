import { describe, expect, it } from 'vitest';
import {
  decodeSnapshotBinary,
  encodeSnapshotBinary,
  encodeSnapshotBinaryEntityFragment,
  encodeSnapshotBinaryFromFragments,
} from '../src/protocol/snapshot_binary_quantized';

function defineEnumerableOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

describe('binary snapshot entity fragments', () => {
  it('round trips dangerous unknown keys as inert own data properties', () => {
    const entity: Record<string, unknown> = {
      id: 1,
      x: 1.25,
      metadata: { normal: 'kept' },
    };
    const self: Record<string, unknown> = { id: 1 };
    const snapshot: Record<string, unknown> = {
      t: 'snap',
      self,
      ents: [entity],
    };
    defineEnumerableOwn(snapshot, '__proto__', { root: 'kept' });
    defineEnumerableOwn(self, 'constructor', { self: 'kept' });
    defineEnumerableOwn(entity, 'prototype', { entity: 'kept' });
    defineEnumerableOwn(entity, '__proto__', { nested: 'kept' });

    const decoded = decodeSnapshotBinary(encodeSnapshotBinary(snapshot));
    const decodedSelf = decoded.self as Record<string, unknown>;
    const decodedEntities = decoded.ents as Array<Record<string, unknown>>;
    expect(decodedEntities).toHaveLength(1);
    const decodedEntity = decodedEntities[0] as Record<string, unknown>;

    expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
    expect(Object.hasOwn(decodedSelf, 'constructor')).toBe(true);
    expect(Object.hasOwn(decodedEntity, 'prototype')).toBe(true);
    expect(Object.hasOwn(decodedEntity, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({
      root: 'kept',
    });
    expect(decodedSelf.constructor).toEqual({ self: 'kept' });
    expect(decodedEntity.prototype).toEqual({ entity: 'kept' });
    expect(Object.getOwnPropertyDescriptor(decodedEntity, '__proto__')?.value).toEqual({
      nested: 'kept',
    });
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decodedEntity)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).nested).toBeUndefined();
  });

  it('assembles opaque fragments byte-for-byte identically to the full encoder', () => {
    const snapshot = {
      t: 'snap',
      tick: 123,
      time: 6.15,
      self: { id: 1, x: -1.257 },
      ents: [
        { id: 1, x: 12.257, y: 0, z: -8.754, hp: 95, future: { kept: true } },
        { id: 9, x: 14, y: 0.124, z: -4, hp: 1 },
      ],
      keep: [3, 4, 8],
      futureRoot: { feature: 'preserved' },
    };
    const { ents, ...root } = snapshot;
    const fragments = ents.map((entity) => encodeSnapshotBinaryEntityFragment(entity));

    const assembled = encodeSnapshotBinaryFromFragments(root, fragments);

    expect(assembled).toEqual(encodeSnapshotBinary(snapshot));
    expect(decodeSnapshotBinary(assembled)).toEqual({
      ...snapshot,
      self: { id: 1, x: -1.26 },
      ents: [
        { id: 1, x: 12.26, y: 0, z: -8.75, hp: 95, future: { kept: true } },
        { id: 9, x: 14, y: 0.12, z: -4, hp: 1 },
      ],
    });
  });

  it('reuses one entity encoding pass across many recipient-specific frames', () => {
    const entities = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      x: index / 10,
      y: 0,
      z: index === 0 ? 0 : -index / 10,
      hp: 100,
      mhp: 100,
    }));
    let entityEncodeCalls = 0;
    const fragments = entities.map((entity) => {
      entityEncodeCalls += 1;
      return encodeSnapshotBinaryEntityFragment(entity);
    });

    const frames = Array.from({ length: 200 }, (_, index) =>
      encodeSnapshotBinaryFromFragments(
        {
          t: 'snap',
          tick: 50,
          self: { id: index + 1, hp: 100, mhp: 100 },
        },
        fragments,
      ),
    );

    expect(entityEncodeCalls).toBe(entities.length);
    expect(frames).toHaveLength(200);
    expect(decodeSnapshotBinary(frames[0] as Uint8Array).ents).toEqual(entities);
    expect(decodeSnapshotBinary(frames.at(-1) as Uint8Array).self).toEqual({
      id: 200,
      hp: 100,
      mhp: 100,
    });
  });

  it('enforces aggregate limits while assembling pre-encoded fragments', () => {
    const valueLimits = { maxValues: 4 };
    const valueFragments = [
      encodeSnapshotBinaryEntityFragment({ id: 1 }, valueLimits),
      encodeSnapshotBinaryEntityFragment({ id: 2 }, valueLimits),
    ];
    expect(() =>
      encodeSnapshotBinaryFromFragments({ t: 'snap' }, valueFragments, valueLimits),
    ).toThrow('too many values');

    const collectionLimits = { maxCollectionEntries: 1 };
    const collectionFragments = [
      encodeSnapshotBinaryEntityFragment({ id: 1 }, collectionLimits),
      encodeSnapshotBinaryEntityFragment({ id: 2 }, collectionLimits),
    ];
    expect(() =>
      encodeSnapshotBinaryFromFragments({ t: 'snap' }, collectionFragments, collectionLimits),
    ).toThrow('collection is too large');

    const frameLimits = { maxFrameBytes: 100 };
    const frameFragments = [
      encodeSnapshotBinaryEntityFragment({ id: 1, payload: 'x'.repeat(40) }, frameLimits),
      encodeSnapshotBinaryEntityFragment({ id: 2, payload: 'x'.repeat(40) }, frameLimits),
    ];
    expect(() =>
      encodeSnapshotBinaryFromFragments({ t: 'snap' }, frameFragments, frameLimits),
    ).toThrow('frame is too large');
  });

  it('rejects values masquerading as opaque entity fragments', () => {
    expect(() =>
      encodeSnapshotBinaryFromFragments({ t: 'snap' }, [new Uint8Array([0]) as never]),
    ).toThrow('invalid snapshot entity fragment');
  });
});
