import { describe, expect, it } from 'vitest';
import { ViewCreateRetryGate } from '../src/render/view_create_retry';

describe('ViewCreateRetryGate', () => {
  it('throttles each entity build slot until its cooldown expires', () => {
    const gate = new ViewCreateRetryGate(2_000);

    expect(gate.canAttempt(7, 'view', 100)).toBe(true);
    gate.markFailed(7, 'view', 100);
    expect(gate.canAttempt(7, 'view', 2_099)).toBe(false);
    expect(gate.canAttempt(7, 'form_bear', 2_099)).toBe(true);
    expect(gate.canAttempt(7, 'view', 2_100)).toBe(true);
    expect(gate.size).toBe(0);
  });

  it('clears successful slots and prunes entries for entities that left the world', () => {
    const gate = new ViewCreateRetryGate(2_000);
    gate.markFailed(7, 'view', 100);
    gate.markFailed(8, 'base:player_mech', 100);

    gate.markSucceeded(7, 'view');
    expect(gate.size).toBe(1);

    gate.prune(500, new Set([7]));
    expect(gate.size).toBe(0);
  });

  it('prunes expired entries even when their entity is never retried', () => {
    const gate = new ViewCreateRetryGate(2_000);
    gate.markFailed(7, 'view', 100);

    gate.prune(2_100, new Set([7]));
    expect(gate.size).toBe(0);
  });

  it('retains an unexpired entry for a still-present entity across a prune', () => {
    // A prune that cleared everything would silently defeat the throttle.
    const gate = new ViewCreateRetryGate(2_000);
    gate.markFailed(7, 'view', 100);

    gate.prune(500, new Set([7]));
    expect(gate.size).toBe(1);
    expect(gate.canAttempt(7, 'view', 500)).toBe(false);
  });

  it('keys per entity: one entity failing a slot never blocks another', () => {
    const gate = new ViewCreateRetryGate(2_000);
    gate.markFailed(7, 'view', 100);

    expect(gate.canAttempt(8, 'view', 100)).toBe(true);
  });
});
