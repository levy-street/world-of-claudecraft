// Press-to-charge binding for empowered abilities (Dragon's Breath and kin):
// src/ui/hud/action_bar/empowered_hold.ts. Pins that a Shift press, the slot MOVE
// gesture, never starts a charge, so Shift-dragging the ability to another slot
// moves it instead of firing it, while a plain press still charges and releases.
import { describe, expect, it } from 'vitest';
import {
  bindEmpoweredActionHold,
  type EmpoweredHoldDeps,
} from '../src/ui/hud/action_bar/empowered_hold';

type Handler = (e: unknown) => void;

function fixture(overrides: Partial<EmpoweredHoldDeps> = {}) {
  const handlers: Record<string, Handler> = {};
  let captured: number | null = null;
  const btn = {
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    setPointerCapture: (id: number) => {
      captured = id;
    },
  } as unknown as HTMLButtonElement;
  const calls: string[] = [];
  const deps: EmpoweredHoldDeps = {
    bindModeActive: () => false,
    empoweredAbilityIdForSlot: () => 'dragons_breath',
    chargeActive: () => false,
    pressSlot: (slot) => calls.push(`press:${slot}`),
    releaseSlot: (slot) => calls.push(`release:${slot}`),
    suppressNextClick: () => calls.push('suppress'),
    ...overrides,
  };
  bindEmpoweredActionHold(btn, () => 3, deps);
  const pointer = (shiftKey: boolean, pointerId = 7) => ({
    pointerType: 'mouse',
    button: 0,
    pointerId,
    shiftKey,
    preventDefault: () => calls.push('prevent'),
  });
  return { handlers, calls, pointer, captured: () => captured };
}

describe('bindEmpoweredActionHold', () => {
  it('a plain press charges the slot, captures the pointer, and release fires it', () => {
    const f = fixture();
    f.handlers.pointerdown(f.pointer(false));
    expect(f.calls).toEqual(['press:3', 'prevent']);
    expect(f.captured()).toBe(7);
    f.handlers.pointerup(f.pointer(false));
    expect(f.calls).toEqual(['press:3', 'prevent', 'release:3', 'suppress', 'prevent']);
  });

  it('a Shift press is the move gesture: no charge starts and the native drag is left alone', () => {
    const f = fixture();
    f.handlers.pointerdown(f.pointer(true));
    expect(f.calls).toEqual([]);
    expect(f.captured()).toBeNull();
  });

  it('after a Shift press, the pointercancel a native drag fires releases nothing', () => {
    // The old failure: dragging a held Dragon's Breath cancelled the pointer,
    // which released (fired) the half-charged breath. With Shift the hold never
    // started, so the drag's pointercancel has nothing to release.
    const f = fixture();
    f.handlers.pointerdown(f.pointer(true));
    f.handlers.pointercancel(f.pointer(true));
    f.handlers.pointerup(f.pointer(true));
    expect(f.calls).toEqual([]);
  });

  it('a Shift press on a non-empowered slot is also ignored (nothing to charge)', () => {
    const f = fixture({ empoweredAbilityIdForSlot: () => null });
    f.handlers.pointerdown(f.pointer(true));
    f.handlers.pointerdown(f.pointer(false));
    expect(f.calls).toEqual([]);
  });
});
