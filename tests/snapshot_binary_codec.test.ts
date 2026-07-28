import { describe, expect, it } from 'vitest';
import { encodeSnapshotBinary } from '../server/snapshot_binary';
import { decodeSnapshotBinary, SNAPSHOT_BINARY_WIRE_VERSION } from '../src/net/snapshot_binary';

function fixture() {
  return {
    t: 'snap',
    tick: 123456,
    time: 612.25,
    tickHz: 20,
    timerWire: 2,
    self: {
      id: 1,
      x: -1.25,
      nested: { unicode: 'ClaudeCraft 世界', values: [null, true, false, -7, 4.5] },
    },
    ents: [
      {
        id: 1,
        x: 12.25,
        y: 0,
        z: -8.75,
        f: 3.14,
        hp: 95,
        mhp: 100,
        k: 'player',
        tid: 'mage',
        nm: 'Mélanie',
        lv: 42,
        unknownFutureField: { state: 'kept', amount: 3 },
      },
      {
        id: 9,
        x: 14,
        y: 0.12,
        z: -4,
        hp: 1,
        mhp: 1,
        sparseExtension: 'present',
      },
    ],
    keep: [3, 4, 8],
    rings: [{ id: 4, radius: 7.5 }],
    hourglasses: [],
    futureRoot: { feature: 'preserved' },
  };
}

describe('binary snapshot codec', () => {
  it('round trips the current snapshot shape without dropping unknown fields', () => {
    const snapshot = fixture();
    const decoded = decodeSnapshotBinary(encodeSnapshotBinary(snapshot));
    expect(decoded).toEqual(snapshot);
  });

  it('quantizes hot coordinates to the server wire precision', () => {
    const decoded = decodeSnapshotBinary(
      encodeSnapshotBinary({
        t: 'snap',
        ents: [{ id: 1, x: Math.PI, y: 0, z: -1.237, f: 0.125 }],
      }),
    );
    expect(decoded.ents).toEqual([{ id: 1, x: 3.14, y: 0, z: -1.24, f: 0.13 }]);
  });

  it('produces deterministic bytes independent of object insertion order', () => {
    const first = fixture();
    const second = {
      futureRoot: { feature: 'preserved' },
      hourglasses: [],
      rings: [{ radius: 7.5, id: 4 }],
      keep: [3, 4, 8],
      ents: first.ents.map((entity) => Object.fromEntries(Object.entries(entity).reverse())),
      self: {
        nested: { values: [null, true, false, -7, 4.5], unicode: 'ClaudeCraft 世界' },
        x: -1.25,
        id: 1,
      },
      timerWire: 2,
      tickHz: 20,
      time: 612.25,
      tick: 123456,
      t: 'snap',
    };
    expect(encodeSnapshotBinary(second)).toEqual(encodeSnapshotBinary(first));
  });

  it('keeps a steady 100-player frame below 4 KB and 80 KB/s at 20 Hz', () => {
    const snapshot = {
      t: 'snap',
      tick: 1,
      time: 0.05,
      self: { id: 1, hp: 930, mhp: 1000 },
      ents: Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        x: Math.round(Math.cos(index) * 3000) / 100,
        y: 0,
        z: Math.round(Math.sin(index) * 3000) / 100,
        f: Math.round(index * 13.7) / 100,
        hp: 700 + (index % 300),
        mhp: 1000,
      })),
      keep: [],
    };
    const binary = encodeSnapshotBinary(snapshot);
    expect(binary.length).toBeLessThan(4_000);
    expect(binary.length * 20).toBeLessThan(80_000);
  });

  it('is materially smaller than JSON for repeated full entity keys', () => {
    const base = fixture().ents[0]!;
    const snapshot = {
      t: 'snap',
      tick: 1,
      time: 0.05,
      self: { id: 1 },
      ents: Array.from({ length: 100 }, (_, index) => ({
        ...base,
        id: index + 1,
        x: index * 0.25,
      })),
    };
    const binary = encodeSnapshotBinary(snapshot);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    expect(binary.length).toBeLessThan(jsonBytes * 0.6);
  });

  it('rejects bad magic, future versions, truncation, and trailing bytes', () => {
    const encoded = encodeSnapshotBinary(fixture());
    const badMagic = encoded.slice();
    badMagic[0] = 0;
    expect(() => decodeSnapshotBinary(badMagic)).toThrow('invalid magic');

    const future = encoded.slice();
    future[4] = SNAPSHOT_BINARY_WIRE_VERSION + 1;
    expect(() => decodeSnapshotBinary(future)).toThrow('unsupported snapshot wire version');
    expect(() => decodeSnapshotBinary(encoded.subarray(0, encoded.length - 1))).toThrow(
      'truncated',
    );

    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => decodeSnapshotBinary(trailing)).toThrow('trailing bytes');
  });

  it('enforces frame, string, collection, depth, and value limits', () => {
    const encoded = encodeSnapshotBinary(fixture());
    expect(() => decodeSnapshotBinary(encoded, { maxFrameBytes: encoded.length - 1 })).toThrow(
      'too large',
    );
    expect(() =>
      encodeSnapshotBinary(
        { t: 'snap', ents: [], long: 'abcdef' },
        {
          maxStringBytes: 4,
        },
      ),
    ).toThrow('string is too large');
    expect(() =>
      encodeSnapshotBinary(
        { t: 'snap', ents: [], values: [1, 2, 3] },
        {
          maxCollectionEntries: 2,
        },
      ),
    ).toThrow('collection is too large');
    expect(() =>
      encodeSnapshotBinary(
        { t: 'snap', ents: [], nested: { a: { b: { c: 1 } } } },
        {
          maxDepth: 2,
        },
      ),
    ).toThrow('nesting is too deep');
    expect(() => decodeSnapshotBinary(encoded, { maxValues: 3 })).toThrow('too many values');
  });

  it('rejects unsupported values and non-finite numbers', () => {
    expect(() => encodeSnapshotBinary({ t: 'snap', ents: [], bad: undefined })).toThrow(
      'unsupported value',
    );
    expect(() => encodeSnapshotBinary({ t: 'snap', ents: [], bad: Number.NaN })).toThrow('finite');
  });
});
