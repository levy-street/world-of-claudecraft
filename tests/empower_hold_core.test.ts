import { describe, expect, it, vi } from 'vitest';
import {
  crossHotbarActionSlot,
  EmpowerHold,
  type EmpowerHoldWorld,
} from '../src/ui/empower_hold_core';

function worldStub(): EmpowerHoldWorld {
  return {
    castAbility: vi.fn(),
    releaseEmpoweredAbility: vi.fn(),
  };
}

describe('crossHotbarActionSlot', () => {
  it('finds the last effective bar slot without confusing action types', () => {
    const actionForSlot = vi.fn((slot: number) => {
      if (slot === 1) return { type: 'item' as const, id: 'glacial_front' };
      if (slot === 3) return { type: 'ability' as const, id: 'rend' };
      if (slot === 12) return { type: 'ability' as const, id: 'glacial_front' };
      return null;
    });

    expect(crossHotbarActionSlot({ type: 'ability', id: 'glacial_front' }, 12, actionForSlot)).toBe(
      12,
    );
  });

  it('returns no slot when the effective bar does not contain the action', () => {
    expect(crossHotbarActionSlot({ type: 'ability', id: 'glacial_front' }, 12, () => null)).toBe(
      -1,
    );
  });
});

describe('EmpowerHold', () => {
  it('starts one charge and releases only its matching slot', () => {
    const hold = new EmpowerHold();
    const world = worldStub();
    const flash = vi.fn();

    expect(hold.press(4, 'glacial_front', world)).toBe(true);
    expect(hold.press(5, 'dragons_breath', world)).toBe(true);
    hold.releaseSlot(5, world, flash);
    expect(world.releaseEmpoweredAbility).not.toHaveBeenCalled();
    hold.releaseSlot(4, world, flash);

    expect(world.castAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(world.releaseEmpoweredAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(flash).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('releases a matching off-bar action without flashing a slot', () => {
    const hold = new EmpowerHold();
    const world = worldStub();
    const flash = vi.fn();
    hold.press(-1, 'dragons_breath', world);

    hold.releaseAction({ type: 'item', id: 'dragons_breath' }, world, flash);
    hold.releaseAction({ type: 'ability', id: 'glacial_front' }, world, flash);
    expect(world.releaseEmpoweredAbility).not.toHaveBeenCalled();
    hold.releaseAction({ type: 'ability', id: 'dragons_breath' }, world, flash);

    expect(world.releaseEmpoweredAbility).toHaveBeenCalledExactlyOnceWith('dragons_breath');
    expect(flash).not.toHaveBeenCalled();
  });

  // The dominant pad path: an XHB cell whose ability is ALSO on the desktop bar
  // presses through the slot (charge.slot >= 0) but releases through the recorded
  // xhb hold, so releaseAction must match the slot-anchored charge and flash it.
  it('releases a slot-anchored charge by action and flashes its slot', () => {
    const hold = new EmpowerHold();
    const world = worldStub();
    const flash = vi.fn();
    hold.press(4, 'glacial_front', world);

    hold.releaseAction({ type: 'ability', id: 'glacial_front' }, world, flash);

    expect(world.releaseEmpoweredAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(flash).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('reports the live charge through active across the whole cycle', () => {
    const hold = new EmpowerHold();
    const world = worldStub();

    expect(hold.active).toBe(false);
    hold.press(4, 'glacial_front', world);
    expect(hold.active).toBe(true);
    hold.releaseSlot(4, world, vi.fn());
    expect(hold.active).toBe(false);
  });

  it('declines a non-empowered press and no-ops without a charge', () => {
    const hold = new EmpowerHold();
    const world = worldStub();
    const flash = vi.fn();

    expect(hold.press(2, null, world)).toBe(false);
    hold.releaseSlot(2, world, flash);

    expect(world.castAbility).not.toHaveBeenCalled();
    expect(world.releaseEmpoweredAbility).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
  });
});
