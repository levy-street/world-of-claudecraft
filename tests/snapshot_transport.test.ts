import { describe, expect, it } from 'vitest';
import { selectSnapshotTransport } from '../server/snapshot_transport';
import { SNAPSHOT_BINARY_WIRE_VERSION } from '../src/net/snapshot_binary';

describe('snapshot transport negotiation', () => {
  it('requires an exact numeric version and an enabled server', () => {
    expect(selectSnapshotTransport(SNAPSHOT_BINARY_WIRE_VERSION, true)).toBe('binary-v1');
    expect(selectSnapshotTransport(String(SNAPSHOT_BINARY_WIRE_VERSION), true)).toBe('json');
    expect(selectSnapshotTransport(SNAPSHOT_BINARY_WIRE_VERSION + 1, true)).toBe('json');
    expect(selectSnapshotTransport(SNAPSHOT_BINARY_WIRE_VERSION, false)).toBe('json');
    expect(selectSnapshotTransport(undefined, true)).toBe('json');
  });
});
