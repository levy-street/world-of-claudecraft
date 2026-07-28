import { describe, expect, it } from 'vitest';
import { SnapshotDecodeQueue } from '../src/net/snapshot_decode_queue_core';

describe('SnapshotDecodeQueue', () => {
  it('drains worker and JSON results strictly in socket order', () => {
    const queue = new SnapshotDecodeQueue<string>();
    queue.beginGeneration();
    const binary = queue.enqueue();
    const json = queue.enqueue();
    const values: string[] = [];

    queue.resolve(json, 'event-after-snapshot');
    expect(queue.drain((decoded) => values.push(decoded.value))).toBe(0);
    queue.resolve(binary, 'snapshot');
    expect(queue.drain((decoded) => values.push(decoded.value))).toBe(2);
    expect(values).toEqual(['snapshot', 'event-after-snapshot']);
  });

  it('drops late results from old socket generations', () => {
    const queue = new SnapshotDecodeQueue<string>();
    queue.beginGeneration();
    const stale = queue.enqueue();
    const currentGeneration = queue.beginGeneration();
    const current = queue.enqueue();

    expect(queue.resolve(stale, 'stale')).toBe(false);
    expect(queue.resolve(current, 'current')).toBe(true);
    const values: string[] = [];
    queue.drain((decoded) => {
      expect(decoded.generation).toBe(currentGeneration);
      values.push(decoded.value);
    });
    expect(values).toEqual(['current']);
  });

  it('rejects duplicate results and bounded queue overflow', () => {
    const queue = new SnapshotDecodeQueue<string>(2);
    queue.beginGeneration();
    const first = queue.enqueue();
    queue.enqueue();
    expect(() => queue.enqueue()).toThrow('overflow');
    expect(queue.resolve(first, 'once')).toBe(true);
    expect(queue.resolve(first, 'twice')).toBe(false);
  });
});
