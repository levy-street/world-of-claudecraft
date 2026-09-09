import { describe, expect, it } from 'vitest';
import {
  createHapticGate,
  HAPTIC_SHAPES,
  hapticPulse,
  sanitizeHapticShape,
} from '../src/game/haptic_pulse_core';
import { createReadyGlowPlan, readyGlowAbilityIds } from '../src/ui/proc_ready_glow_core';
import {
  createReticleTicksView,
  RETICLE_ARC_DEGREES,
  RETICLE_MAX_TICKS,
} from '../src/ui/reticle_ticks_core';

describe('hotbar ready glow', () => {
  const sig = (abilityId: string, active: boolean, enabled: boolean) => ({
    abilityId,
    active,
    enabled,
  });

  it('lights only procs that are BOTH up and opted into the hotbar channel', () => {
    const ids = readyGlowAbilityIds([
      sig('recklessness', true, true),
      sig('avatar', true, false),
      sig('die_by_sword', false, true),
    ]);
    expect([...ids]).toEqual(['recklessness']);
  });

  it('ignores a row with no ability behind it', () => {
    expect([...readyGlowAbilityIds([sig('', true, true)])]).toEqual([]);
  });

  it('reuses one set across ticks and never leaks last frame into this one', () => {
    const plan = createReadyGlowPlan();
    const first = plan.tick([sig('recklessness', true, true)]);
    expect([...first]).toEqual(['recklessness']);
    const second = plan.tick([sig('avatar', true, true)]);
    // Same container (allocation-light contract), and the stale id is gone.
    expect(second).toBe(first);
    expect([...second]).toEqual(['avatar']);
    expect([...plan.tick([])]).toEqual([]);
  });
});

describe('reticle ticks', () => {
  const input = (id: string, active = false, enabled = true) => ({
    id,
    color: '#ffd24d',
    active,
    enabled,
  });

  it('puts a lone tick straight up rather than off to one side', () => {
    const state = createReticleTicksView().tick([input('a')]);
    expect(state.count).toBe(1);
    expect(state.slots[0].angleDeg).toBe(0);
  });

  it('spreads several evenly across the arc, symmetric about straight up', () => {
    const state = createReticleTicksView().tick([input('a'), input('b'), input('c')]);
    const angles = state.slots.slice(0, 3).map((s) => s.angleDeg);
    expect(angles).toEqual([-RETICLE_ARC_DEGREES / 2, 0, RETICLE_ARC_DEGREES / 2]);
  });

  it('keeps a spell on the same angle when a NEIGHBOUR fires', () => {
    // The whole value of the channel is that a tick means one spell all fight. An
    // angle that shifted when something else lit would be unreadable at a glance.
    const view = createReticleTicksView();
    const before = view.tick([input('a'), input('b')]).slots.map((s) => s.angleDeg);
    const after = view.tick([input('a', true), input('b')]).slots.map((s) => s.angleDeg);
    expect(after).toEqual(before);
  });

  it('drops procs the player did not route here, without leaving a gap', () => {
    const state = createReticleTicksView().tick([input('a'), input('b', false, false), input('c')]);
    expect(state.count).toBe(2);
    expect(state.slots.slice(0, 2).map((s) => s.id)).toEqual(['a', 'c']);
    expect(state.slots[0].angleDeg).toBe(-RETICLE_ARC_DEGREES / 2);
  });

  it('caps the ring rather than crowding it past readability', () => {
    const many = Array.from({ length: RETICLE_MAX_TICKS + 4 }, (_, i) => input(`p${i}`));
    const state = createReticleTicksView().tick(many);
    expect(state.count).toBe(RETICLE_MAX_TICKS);
  });

  it('returns the same container every tick', () => {
    const view = createReticleTicksView();
    expect(view.tick([input('a')])).toBe(view.tick([input('b')]));
  });
});

describe('haptic pulses', () => {
  it('offers a deliberately small vocabulary, since feel is hard to tell apart', () => {
    expect(HAPTIC_SHAPES).toEqual(['tap', 'double', 'long']);
  });

  it('gives each shape a distinct duration and vibrate pattern', () => {
    const pulses = HAPTIC_SHAPES.map(hapticPulse);
    expect(new Set(pulses.map((p) => p.durationMs)).size).toBe(3);
    expect(new Set(pulses.map((p) => p.vibratePattern.join(','))).size).toBe(3);
    // The double is the one shape a player can pick out from a single tap: it must
    // actually be two beats with a gap, not one long one.
    expect(hapticPulse('double').vibratePattern).toHaveLength(3);
  });

  it('keeps every magnitude inside the actuator range', () => {
    for (const shape of HAPTIC_SHAPES) {
      const p = hapticPulse(shape);
      expect(p.strongMagnitude).toBeGreaterThan(0);
      expect(p.strongMagnitude).toBeLessThanOrEqual(1);
      expect(p.weakMagnitude).toBeGreaterThan(0);
      expect(p.weakMagnitude).toBeLessThanOrEqual(1);
    }
  });

  it('degrades an unknown stored shape to the gentle default', () => {
    expect(sanitizeHapticShape('long')).toBe('long');
    expect(sanitizeHapticShape('earthquake')).toBe('tap');
    expect(sanitizeHapticShape(undefined)).toBe('tap');
    expect(sanitizeHapticShape(7)).toBe('tap');
  });

  it('refuses a second pulse inside the gap, so two procs cannot merge into a buzz', () => {
    const gate = createHapticGate(400);
    expect(gate.allow(1000)).toBe(true);
    expect(gate.allow(1100)).toBe(false);
    expect(gate.allow(1399)).toBe(false);
    expect(gate.allow(1400)).toBe(true);
  });

  it('allows the very first pulse however early the clock starts', () => {
    expect(createHapticGate(400).allow(0)).toBe(true);
  });
});
