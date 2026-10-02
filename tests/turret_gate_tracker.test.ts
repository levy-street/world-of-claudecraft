import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TurretGateTracker } from '../src/render/turret_gate_tracker';

function held() {
  let settle!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Fire and Fly gate tracker', () => {
  it('releases at once with nothing in flight, and attaches at once with no inner gate', () => {
    const tracker = new TurretGateTracker();
    expect(tracker.gate).toBeUndefined();
    let released = 0;
    tracker.afterSettled(() => released++);
    expect(released).toBe(1);
  });

  it('waits for a gate opened while a release is already waiting', async () => {
    const first = held();
    const second = held();
    const queue = [first, second];
    const tracker = new TurretGateTracker(() => queue.shift()!.promise);
    void tracker.gate!(new THREE.Group());
    let released = 0;
    tracker.afterSettled(() => released++);
    void tracker.gate!(new THREE.Group());
    expect(tracker.inFlight).toBe(2);
    first.settle();
    await flush();
    expect(released).toBe(0);
    second.settle();
    await flush();
    expect(released).toBe(1);
    expect(tracker.inFlight).toBe(0);
  });

  it('counts a gate that rejects as settled, so a release still runs once', async () => {
    const gate = held();
    const tracker = new TurretGateTracker(() => gate.promise);
    tracker.gate!(new THREE.Group()).catch(() => {});
    let released = 0;
    tracker.afterSettled(() => released++);
    gate.fail(new Error('context lost'));
    await flush();
    expect(released).toBe(1);
    expect(tracker.inFlight).toBe(0);
  });
});
