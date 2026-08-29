import { describe, expect, it } from 'vitest';
import { BuildRetryGate } from '../src/render/build_retry_gate';

// The rift interior build's failure cooldown (renderer.ts): timestamp-based so
// no timer handle outlives a renderer teardown or fires into a recycled one.

describe('BuildRetryGate', () => {
  it('allows an unknown key, blocks a failed key for the cooldown, then allows again', () => {
    // Arrange
    const gate = new BuildRetryGate(15000);
    // Act + Assert
    expect(gate.shouldAttempt('rift:a', 1000)).toBe(true);
    gate.markFailed('rift:a', 1000);
    expect(gate.shouldAttempt('rift:a', 1001)).toBe(false);
    expect(gate.shouldAttempt('rift:a', 15999)).toBe(false);
    expect(gate.shouldAttempt('rift:a', 16000)).toBe(true);
    // The spent cooldown was cleared by the allowing read.
    expect(gate.shouldAttempt('rift:a', 16000)).toBe(true);
  });

  it('tracks keys independently and re-arms on a repeat failure', () => {
    const gate = new BuildRetryGate(100);
    gate.markFailed('a', 0);
    expect(gate.shouldAttempt('b', 50)).toBe(true);
    expect(gate.shouldAttempt('a', 50)).toBe(false);
    expect(gate.shouldAttempt('a', 100)).toBe(true);
    gate.markFailed('a', 100);
    expect(gate.shouldAttempt('a', 150)).toBe(false);
    expect(gate.shouldAttempt('a', 200)).toBe(true);
  });
});
