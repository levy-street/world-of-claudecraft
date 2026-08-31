// The sheathe keybind's cue-on-state-change rule (src/game/sheathe_toggle.ts),
// shared by main.ts's keyboard and gamepad dispatches (tests/pad_reel.test.ts
// pins that both call it). The world owns the gate, so the cue plays only when
// the stow state moved, and which cue follows the state the toggle landed on.
import { describe, expect, it } from 'vitest';
import { toggleSheatheWithCue } from '../src/game/sheathe_toggle';

function rig(stowed: boolean, accepts: boolean) {
  const calls: string[] = [];
  const world = {
    player: { weaponStowed: stowed } as { weaponStowed: boolean },
    toggleWeaponStow() {
      calls.push('toggle');
      if (accepts) world.player.weaponStowed = !world.player.weaponStowed;
    },
  };
  const cue = {
    weaponSheathe: () => calls.push('sheathe'),
    weaponUnsheathe: () => calls.push('unsheathe'),
  };
  return { world, cue, calls };
}

describe('toggleSheatheWithCue', () => {
  it('drawn to stowed plays the sheathe cue', () => {
    const { world, cue, calls } = rig(false, true);
    toggleSheatheWithCue(world as never, cue);
    expect(world.player.weaponStowed).toBe(true);
    expect(calls).toEqual(['toggle', 'sheathe']);
  });

  it('stowed to drawn plays the unsheathe cue', () => {
    const { world, cue, calls } = rig(true, true);
    toggleSheatheWithCue(world as never, cue);
    expect(world.player.weaponStowed).toBe(false);
    expect(calls).toEqual(['toggle', 'unsheathe']);
  });

  it('a refused toggle (dead, or combat auto-unsheathe) plays no cue at all', () => {
    for (const stowed of [false, true]) {
      const { world, cue, calls } = rig(stowed, false);
      toggleSheatheWithCue(world as never, cue);
      expect(world.player.weaponStowed).toBe(stowed);
      expect(calls).toEqual(['toggle']);
    }
  });

  it('always asks the world first: the cue never decides the state', () => {
    const { world, cue, calls } = rig(false, true);
    toggleSheatheWithCue(world as never, cue);
    expect(calls[0]).toBe('toggle');
    expect(calls).toHaveLength(2);
  });
});
