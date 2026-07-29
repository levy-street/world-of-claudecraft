import { describe, expect, it } from 'vitest';
import { repairStoredBindings } from '../src/game/keybinds_repair';

// The repair fires ONLY on the exact corrupted signatures left by two
// reverted layout changes, and deletes just those keys so Keybinds.load()
// re-seeds them to their current defaults. Everything else stays verbatim.
describe('repairStoredBindings', () => {
  it('drops the Q/E strafe overhaul signature so strafe and slot10/11 re-seed', () => {
    const obj = repairStoredBindings({
      strafeLeft: [null, null],
      strafeRight: [null, null],
      slot10: ['KeyQ', 'Minus'],
      slot11: ['KeyE', 'Equal'],
      // an unrelated deliberate remap must survive
      jump: ['KeyZ', null],
    });
    expect('strafeLeft' in obj).toBe(false);
    expect('strafeRight' in obj).toBe(false);
    expect('slot10' in obj).toBe(false);
    expect('slot11' in obj).toBe(false);
    expect(obj.jump).toEqual(['KeyZ', null]);
  });

  it('leaves a deliberate slot0/slot1 swap untouched (not the strafe signature)', () => {
    const obj = repairStoredBindings({ slot0: ['Digit2'], slot1: ['Digit1'] });
    expect(obj.slot0).toEqual(['Digit2']);
    expect(obj.slot1).toEqual(['Digit1']);
  });

  it('does not fire when only part of the strafe signature is present', () => {
    // Q on slot10 but strafeLeft is a real deliberate binding, not empty.
    const obj = repairStoredBindings({
      slot10: ['KeyQ', 'Minus'],
      slot11: ['KeyE', 'Equal'],
      strafeLeft: ['KeyQ'],
      strafeRight: [null, null],
    });
    expect(obj.slot10).toEqual(['KeyQ', 'Minus']);
    expect(obj.strafeLeft).toEqual(['KeyQ']);
  });

  it('also drops the v0.24.0-window meters:KeyZ leftover alongside the strafe signature', () => {
    // The same v0.24.0 overhaul window that persisted Q/E on slot10/11 also
    // persisted Damage Meters on KeyZ. Signature A must clear it too, or the
    // stale KeyZ stays bound and evicts Sheathe/Unsheathe Weapon's default.
    const obj = repairStoredBindings({
      strafeLeft: [null, null],
      strafeRight: [null, null],
      slot10: ['KeyQ', 'Minus'],
      slot11: ['KeyE', 'Equal'],
      meters: ['KeyZ', null],
    });
    expect('meters' in obj).toBe(false);
  });

  it('leaves a deliberate meters:KeyZ rebind alone when the strafe signature is absent', () => {
    // Without the rest of the v0.24.0 fingerprint, a stored meters:KeyZ is
    // ordinary player intent (a deliberate remap), not corruption.
    const obj = repairStoredBindings({ meters: ['KeyZ', null] });
    expect(obj.meters).toEqual(['KeyZ', null]);
  });

  it('drops an evicted meters binding when targetFriendly still holds KeyH', () => {
    // targetFriendly absent -> defaults to KeyH.
    const a = repairStoredBindings({ meters: [null, null] });
    expect('meters' in a).toBe(false);
    // targetFriendly explicitly on KeyH.
    const b = repairStoredBindings({ meters: [null, null], targetFriendly: ['KeyH', null] });
    expect('meters' in b).toBe(false);
  });

  it('keeps an empty meters binding when targetFriendly was remapped off KeyH', () => {
    const obj = repairStoredBindings({
      meters: [null, null],
      targetFriendly: ['KeyG', null],
    });
    expect(obj.meters).toEqual([null, null]);
  });

  it('leaves a deliberately bound meters value alone', () => {
    const obj = repairStoredBindings({ meters: ['KeyH', null] });
    expect(obj.meters).toEqual(['KeyH', null]);
  });
});
