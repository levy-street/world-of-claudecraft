// Tests for the pure swing-timer core (swing_timer.ts). Covers: the visible/hidden
// gating (auto-attack + a live, non-object target), the parameter-in/next-state-out
// edge tracking (interval recovered on the reset edge, carried while counting
// down), the ready vs seconds label discriminator, frac clamping, same-input ->
// same-output determinism, and the ClientWorld-vs-Sim parity assertion (the core
// reads only fields BOTH world shapes expose). The core is i18n-free
// (a guard below pins that), so the painter owns the t() label resolution.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type SwingPlayerInput,
  type SwingTargetInput,
  swingTimerState,
} from '../src/ui/swing_timer';

// A live, non-object target (the bar shows only against one).
const LIVE_TARGET: SwingTargetInput = { dead: false, kind: 'mob' };

function player(over: Partial<SwingPlayerInput> = {}): SwingPlayerInput {
  return { autoAttack: true, swingTimer: 1, weapon: { speed: 2 }, ...over };
}

describe('swingTimerState: visibility gating', () => {
  it('is hidden when the player is not auto-attacking (and resets the edge state)', () => {
    const s = swingTimerState(player({ autoAttack: false }), LIVE_TARGET, 2, 1);
    expect(s.visible).toBe(false);
    expect(s.nextPeriod).toBe(0);
    expect(s.nextTimer).toBe(0);
  });

  it('is hidden with no target, a dead target, or an object (door/crate) target', () => {
    expect(swingTimerState(player(), null, 1, 1).visible).toBe(false);
    expect(swingTimerState(player(), { dead: true, kind: 'mob' }, 1, 1).visible).toBe(false);
    expect(swingTimerState(player(), { dead: false, kind: 'object' }, 1, 1).visible).toBe(false);
  });

  it('is visible against a live mob/npc/player target while auto-attacking', () => {
    expect(swingTimerState(player(), { dead: false, kind: 'mob' }, 0, 0).visible).toBe(true);
    expect(swingTimerState(player(), { dead: false, kind: 'npc' }, 0, 0).visible).toBe(true);
    expect(swingTimerState(player(), { dead: false, kind: 'player' }, 0, 0).visible).toBe(true);
  });
});

describe('swingTimerState: edge-tracked period recovery (parameter-in / next-state-out)', () => {
  it('recovers the swing interval on first show (prevPeriod 0) as max(timer, weapon speed)', () => {
    // weapon speed 2, fresh -> period = max(swingTimer, speed) = 2, frac = 1 - 2/2 = 0.
    const s = swingTimerState(player({ swingTimer: 2 }), LIVE_TARGET, 0, 0);
    expect(s.nextPeriod).toBe(2);
    expect(s.frac).toBe(0);
    expect(s.nextTimer).toBe(2);
  });

  it('carries the recovered period so the fill grows smoothly as the timer drops', () => {
    // prevPeriod 2, prevTimer 2; now timer 1 did NOT jump up -> period stays 2,
    // frac = 1 - 1/2 = 0.5.
    const s = swingTimerState(player({ swingTimer: 1 }), LIVE_TARGET, 2, 2);
    expect(s.nextPeriod).toBe(2);
    expect(s.frac).toBe(0.5);
  });

  it('re-recovers the interval on the reset edge (timer jumps up past the epsilon)', () => {
    // prevTimer 0.1, now swingTimer 1.5 jumped up -> a new swing; weapon speed 1.2,
    // so period = max(1.5, 1.2) = 1.5, frac = 1 - 1.5/1.5 = 0.
    const s = swingTimerState(
      player({ swingTimer: 1.5, weapon: { speed: 1.2 } }),
      LIVE_TARGET,
      1.2,
      0.1,
    );
    expect(s.nextPeriod).toBe(1.5);
    expect(s.frac).toBe(0);
  });

  it('clamps frac into [0, 1] even when the timer exceeds the carried period', () => {
    // prevPeriod 1 retained (timer 3 did not jump up from prevTimer 5); 1 - 3/1 = -2.
    const s = swingTimerState(player({ swingTimer: 3 }), LIVE_TARGET, 1, 5);
    expect(s.nextPeriod).toBe(1);
    expect(s.frac).toBe(0);
  });
});

describe('swingTimerState: the ready vs seconds label discriminator', () => {
  it('reports ready (swingTimer <= 0) with the ready discriminator and a full bar', () => {
    const s = swingTimerState(player({ swingTimer: 0 }), LIVE_TARGET, 2, 0.5);
    expect(s.ready).toBe(true);
    expect(s.labelKind).toBe('ready');
    expect(s.frac).toBe(1); // 1 - 0/2 = 1
  });

  it('reports the seconds discriminator carrying the raw swingTimer value when not ready', () => {
    const s = swingTimerState(player({ swingTimer: 1.4 }), LIVE_TARGET, 2, 2);
    expect(s.ready).toBe(false);
    expect(s.labelKind).toBe('seconds');
    expect(s.seconds).toBe(1.4);
  });
});

describe('swingTimerState: determinism + ClientWorld-vs-Sim parity', () => {
  it('is deterministic: identical inputs produce a deep-equal result', () => {
    const a = swingTimerState(player({ swingTimer: 1.3 }), LIVE_TARGET, 2, 1.5);
    const b = swingTimerState(player({ swingTimer: 1.3 }), LIVE_TARGET, 2, 1.5);
    expect(a).toEqual(b);
  });

  it('Sim-shaped and ClientWorld-mirror-shaped inputs render identically', () => {
    // Both stubs carry the shared fields the core reads (autoAttack / swingTimer /
    // weapon.speed; target dead / kind) PLUS host-specific extras the core must
    // ignore. If the core ever reached for a Sim-only field, these would diverge.
    const simPlayer = {
      autoAttack: true,
      swingTimer: 1.2,
      weapon: { speed: 2, min: 5, max: 9 }, // Sim weapon carries dmg range too
      hp: 100, // Sim-only extra
    };
    const clientPlayer = {
      autoAttack: true,
      swingTimer: 1.2,
      weapon: { speed: 2 },
      netUpdatedAt: 1234, // ClientWorld mirror extras
      netInterval: 50,
    };
    const simTarget = { dead: false, kind: 'mob', templateId: 'wolf' };
    const clientTarget = { dead: false, kind: 'mob', netInterval: 50 };
    const fromSim = swingTimerState(simPlayer, simTarget, 2, 2);
    const fromClient = swingTimerState(clientPlayer, clientTarget, 2, 2);
    expect(fromSim).toEqual(fromClient);
    expect(fromSim.visible).toBe(true);
  });
});

describe('swing_timer core stays i18n-free (the painter owns t())', () => {
  const src = readFileSync(new URL('../src/ui/swing_timer.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports no i18n runtime and calls no t()/tEntity/formatNumber', () => {
    expect(code).not.toContain("from './i18n'");
    expect(code).not.toMatch(/\bt\(/);
    expect(code).not.toMatch(/\btEntity\(/);
    expect(code).not.toMatch(/\bformatNumber\(/);
  });
});
