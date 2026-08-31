import { describe, expect, it } from 'vitest';
import {
  CROSS_HOTBAR_EXPANDED_SET,
  CROSS_HOTBAR_LAYER_BUTTONS,
  CROSS_HOTBAR_PRIMARY_SET,
  CROSS_HOTBAR_SET_COUNT,
  CROSS_HOTBAR_SLOTS_PER_LAYER,
  CROSS_HOTBAR_SLOTS_PER_SET,
  CROSS_HOTBAR_TRIGGERS,
  type CrossHotbarTriggerState,
  crossHotbarActionFor,
  crossHotbarActiveSet,
  crossHotbarPosition,
  crossHotbarSetActions,
  defaultCrossHotbarLayout,
  INITIAL_CROSS_HOTBAR_TRIGGER_STATE,
  isCrossHotbarButton,
  isCrossHotbarModifier,
  isCrossHotbarSeeded,
  nextCrossHotbarTriggerState,
  releaseCrossHotbarHold,
  sanitizeCrossHotbarLayout,
  seedCrossHotbarLayout,
  toggleCrossHotbarStandingSet,
} from '../src/game/cross_hotbar';
import { GP } from '../src/game/gamepad_map';

// Advance the reducer over a scripted sequence of [lt, rt] polls.
function run(
  polls: readonly (readonly [boolean, boolean])[],
  expandEnabled = true,
): CrossHotbarTriggerState {
  let state = INITIAL_CROSS_HOTBAR_TRIGGER_STATE;
  for (const [lt, rt] of polls) {
    state = nextCrossHotbarTriggerState(state, lt, rt, expandEnabled);
  }
  return state;
}

describe('cross hotbar geometry', () => {
  it('reaches eight buttons per trigger and sixteen per set', () => {
    expect(CROSS_HOTBAR_LAYER_BUTTONS).toHaveLength(8);
    expect(CROSS_HOTBAR_SLOTS_PER_LAYER).toBe(8);
    expect(CROSS_HOTBAR_SLOTS_PER_SET).toBe(16);
  });

  it('claims the d-pad and face diamonds, and nothing else', () => {
    for (const button of [GP.DPAD_UP, GP.DPAD_DOWN, GP.DPAD_LEFT, GP.DPAD_RIGHT]) {
      expect(isCrossHotbarButton(button)).toBe(true);
    }
    for (const button of [GP.A, GP.B, GP.X, GP.Y]) {
      expect(isCrossHotbarButton(button)).toBe(true);
    }
    // The bumpers, stick clicks, Back/Start and triggers are not layer buttons.
    // Trigger modifier behavior is pinned separately below.
    for (const button of [GP.LB, GP.RB, GP.L3, GP.R3, GP.BACK, GP.START, GP.LT, GP.RT]) {
      expect(isCrossHotbarButton(button)).toBe(false);
    }
  });

  it('uses the triggers as the two layer modifiers', () => {
    expect(CROSS_HOTBAR_TRIGGERS.left).toBe(GP.LT);
    expect(CROSS_HOTBAR_TRIGGERS.right).toBe(GP.RT);
    expect(isCrossHotbarModifier(GP.LT)).toBe(true);
    expect(isCrossHotbarModifier(GP.RT)).toBe(true);
    for (const button of CROSS_HOTBAR_LAYER_BUTTONS) {
      expect(isCrossHotbarModifier(button)).toBe(false);
    }
  });

  it('orders each diamond top, left, right, bottom', () => {
    expect(CROSS_HOTBAR_LAYER_BUTTONS.slice(0, 4)).toEqual([
      GP.DPAD_UP,
      GP.DPAD_LEFT,
      GP.DPAD_RIGHT,
      GP.DPAD_DOWN,
    ]);
    expect(CROSS_HOTBAR_LAYER_BUTTONS.slice(4)).toEqual([GP.Y, GP.X, GP.B, GP.A]);
  });

  it('places the right trigger positions after the left trigger block', () => {
    expect(crossHotbarPosition('left', GP.DPAD_UP)).toBe(0);
    expect(crossHotbarPosition('left', GP.A)).toBe(7);
    expect(crossHotbarPosition('right', GP.DPAD_UP)).toBe(8);
    expect(crossHotbarPosition('right', GP.A)).toBe(15);
  });

  it('returns no position for an unclaimed button on either layer', () => {
    expect(crossHotbarPosition('left', GP.LB)).toBeNull();
    expect(crossHotbarPosition('right', GP.START)).toBeNull();
  });
});

describe('defaultCrossHotbarLayout', () => {
  it('starts empty, awaiting the one-time seed', () => {
    const layout = defaultCrossHotbarLayout();
    expect(layout).toHaveLength(CROSS_HOTBAR_SET_COUNT);
    for (const set of layout) {
      expect(set).toHaveLength(CROSS_HOTBAR_SLOTS_PER_SET);
      expect(set.every((cell) => cell === null)).toBe(true);
    }
    expect(isCrossHotbarSeeded(layout)).toBe(false);
  });

  it('counts as seeded the moment anything sits on it', () => {
    const layout = defaultCrossHotbarLayout();
    layout[1][7] = { type: 'ability', id: 'heroic_strike' };
    expect(isCrossHotbarSeeded(layout)).toBe(true);
  });
});

describe('seedCrossHotbarLayout', () => {
  const ability = (id: string) => ({ type: 'ability' as const, id });

  it('lays the action bar out across the sets in order', () => {
    const bar = [ability('a'), ability('b'), null, ability('c')];
    const layout = seedCrossHotbarLayout(bar);
    expect(layout[0][0]).toEqual(ability('a'));
    expect(layout[0][1]).toEqual(ability('b'));
    expect(layout[0][2]).toBeNull();
    expect(layout[0][3]).toEqual(ability('c'));
  });

  it('spills past the first set into the second', () => {
    const bar = Array.from({ length: 20 }, (_, i) => ability(`a${i}`));
    const layout = seedCrossHotbarLayout(bar);
    expect(layout[0][15]).toEqual(ability('a15'));
    expect(layout[1][0]).toEqual(ability('a16'));
  });

  it('puts a class extra in the first free cell', () => {
    // A warrior's stance is KNOWN at level one yet unbound, so a pad player could
    // never reach it: the seed is the only thing that puts it within reach.
    const layout = seedCrossHotbarLayout([ability('heroic_strike'), null], ['battle_stance']);
    expect(layout[0][0]).toEqual(ability('heroic_strike'));
    expect(layout[0][1]).toEqual(ability('battle_stance'));
  });

  it('does not add an extra the bar already carries', () => {
    const layout = seedCrossHotbarLayout([ability('battle_stance'), null], ['battle_stance']);
    expect(layout[0][1]).toBeNull();
    const count = layout.flat().filter((c) => c?.id === 'battle_stance').length;
    expect(count).toBe(1);
  });

  it('appends an extra after a full bar rather than dropping it', () => {
    const bar = Array.from({ length: 16 }, (_, i) => ability(`a${i}`));
    const layout = seedCrossHotbarLayout(bar, ['battle_stance']);
    expect(layout[1][0]).toEqual(ability('battle_stance'));
  });
});

describe('crossHotbarActionFor', () => {
  const layout = seedCrossHotbarLayout(
    Array.from({ length: 32 }, (_, i) => ({ type: 'ability' as const, id: `a${i}` })),
  );

  it('resolves a held-trigger press to the action on that cell', () => {
    expect(crossHotbarActionFor(layout, 0, 'left', GP.DPAD_UP)).toEqual({
      type: 'ability',
      id: 'a0',
    });
    expect(crossHotbarActionFor(layout, 0, 'right', GP.A)).toEqual({
      type: 'ability',
      id: 'a15',
    });
    expect(crossHotbarActionFor(layout, 1, 'left', GP.DPAD_UP)).toEqual({
      type: 'ability',
      id: 'a16',
    });
  });

  it('resolves nothing for an unclaimed button or a set that does not exist', () => {
    expect(crossHotbarActionFor(layout, 0, 'left', GP.LB)).toBeNull();
    expect(crossHotbarActionFor(layout, 7, 'left', GP.DPAD_UP)).toBeNull();
  });

  it('resolves nothing for an empty cell', () => {
    const sparse = defaultCrossHotbarLayout();
    expect(crossHotbarActionFor(sparse, 0, 'left', GP.DPAD_UP)).toBeNull();
  });
});

describe('crossHotbarSetActions', () => {
  it('hands the overlay the sixteen actions of a set in display order', () => {
    const layout = seedCrossHotbarLayout(
      Array.from({ length: 32 }, (_, i) => ({ type: 'ability' as const, id: `a${i}` })),
    );
    const actions = crossHotbarSetActions(layout, CROSS_HOTBAR_EXPANDED_SET);
    expect(actions).toHaveLength(CROSS_HOTBAR_SLOTS_PER_SET);
    expect(actions[0]).toEqual({ type: 'ability', id: 'a16' });
  });

  it('is empty for a set outside the layout', () => {
    expect(crossHotbarSetActions(defaultCrossHotbarLayout(), 9)).toEqual([]);
  });
});

describe('nextCrossHotbarTriggerState', () => {
  it('is dormant until a trigger goes down', () => {
    const state = run([[false, false]]);
    expect(state.hold).toBeNull();
    expect(state.expanded).toBe(false);
  });

  it('holds the trigger that is pressed', () => {
    expect(run([[true, false]]).hold).toBe('left');
    expect(run([[false, true]]).hold).toBe('right');
  });

  it('keeps the hold across polls and drops it on release', () => {
    expect(
      run([
        [true, false],
        [true, false],
      ]).hold,
    ).toBe('left');
    expect(
      run([
        [true, false],
        [false, false],
      ]).hold,
    ).toBeNull();
  });

  it('rolls to the other trigger when the held one is released first', () => {
    const state = run([
      [true, false],
      [true, true],
      [false, true],
    ]);
    expect(state.hold).toBe('right');
  });

  it('resolves a same-poll tie to the left trigger', () => {
    expect(run([[true, true]]).hold).toBe('left');
  });

  it('expands on an opposite-trigger tap while holding', () => {
    const state = run([
      [true, false],
      [true, true],
    ]);
    expect(state.hold).toBe('left');
    expect(state.expanded).toBe(true);
    expect(crossHotbarActiveSet(state)).toBe(CROSS_HOTBAR_EXPANDED_SET);
  });

  it('returns to the primary set on a second tap', () => {
    const state = run([
      [true, false],
      [true, true],
      [true, false],
      [true, true],
    ]);
    expect(state.expanded).toBe(false);
    expect(crossHotbarActiveSet(state)).toBe(CROSS_HOTBAR_PRIMARY_SET);
  });

  it('needs a rising edge, so a held opposite trigger does not re-expand each poll', () => {
    const state = run([
      [true, false],
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(state.expanded).toBe(true);
  });

  it('clears the expansion when the hold is released', () => {
    const state = run([
      [true, false],
      [true, true],
      [false, false],
      [true, false],
    ]);
    expect(state.hold).toBe('left');
    expect(state.expanded).toBe(false);
  });

  it('never expands while the double bar is switched off', () => {
    const state = run(
      [
        [true, false],
        [true, true],
      ],
      false,
    );
    expect(state.hold).toBe('left');
    expect(state.expanded).toBe(false);
    expect(crossHotbarActiveSet(state)).toBe(CROSS_HOTBAR_PRIMARY_SET);
  });
});

describe('sanitizeCrossHotbarLayout', () => {
  const ability = { type: 'ability' as const, id: 'heroic_strike' };

  it('falls back wholesale for a non-array value', () => {
    expect(sanitizeCrossHotbarLayout(null)).toEqual(defaultCrossHotbarLayout());
    expect(sanitizeCrossHotbarLayout('nope')).toEqual(defaultCrossHotbarLayout());
  });

  it('keeps a well-formed stored action', () => {
    const stored = defaultCrossHotbarLayout();
    stored[0][3] = ability;
    expect(sanitizeCrossHotbarLayout(stored)[0][3]).toEqual(ability);
  });

  it('drops a malformed entry per cell rather than the whole bar', () => {
    const stored = defaultCrossHotbarLayout() as unknown[][];
    stored[0][0] = { type: 'spell', id: 'x' }; // not a kind we store
    stored[0][1] = { type: 'ability' }; // no id
    stored[0][2] = { type: 'ability', id: '' }; // empty id
    stored[0][3] = ability;
    const clean = sanitizeCrossHotbarLayout(stored);
    expect(clean[0].slice(0, 3)).toEqual([null, null, null]);
    expect(clean[0][3]).toEqual(ability);
  });

  it('reads a LEGACY slot-number layout as unseeded so the seed refills it', () => {
    // Before the bar owned its actions it stored action-bar slot indices. There is
    // no way to resolve one here without the action bar, and re-seeding from the
    // player's own slots is what that migration should produce anyway.
    const legacy = [
      Array.from({ length: 16 }, (_, i) => i),
      Array.from({ length: 16 }, (_, i) => i + 16),
    ];
    const clean = sanitizeCrossHotbarLayout(legacy);
    expect(isCrossHotbarSeeded(clean)).toBe(false);
  });

  it('restores a set that is missing or the wrong shape', () => {
    expect(sanitizeCrossHotbarLayout([undefined, 'gone'])).toEqual(defaultCrossHotbarLayout());
  });

  it('pads a short stored set back to sixteen cells', () => {
    const clean = sanitizeCrossHotbarLayout([[ability]]);
    expect(clean[0]).toHaveLength(CROSS_HOTBAR_SLOTS_PER_SET);
    expect(clean[0][0]).toEqual(ability);
    expect(clean[0][1]).toBeNull();
  });

  it('drops extra sets a longer stored value carries', () => {
    const stored = [...defaultCrossHotbarLayout(), Array(16).fill(null)];
    expect(sanitizeCrossHotbarLayout(stored)).toHaveLength(CROSS_HOTBAR_SET_COUNT);
  });
});

describe('the standing set and the mid-hold reach compose', () => {
  const held = (over: Partial<CrossHotbarTriggerState> = {}) => ({
    ...INITIAL_CROSS_HOTBAR_TRIGGER_STATE,
    ...over,
  });

  it('survives a hold ending, unlike the reach', () => {
    // The whole difference between the two: a switch is standing, a reach lasts
    // only as long as the trigger does.
    const switched = toggleCrossHotbarStandingSet(INITIAL_CROSS_HOTBAR_TRIGGER_STATE);
    const afterHold = nextCrossHotbarTriggerState(
      { ...switched, hold: 'left', ltDown: true },
      false,
      false,
      true,
    );
    expect(afterHold.standing).toBe(true);
    expect(afterHold.hold).toBeNull();
    expect(crossHotbarActiveSet(afterHold)).toBe(CROSS_HOTBAR_EXPANDED_SET);
  });

  it('reads as the OTHER set whichever one is standing', () => {
    // XOR, not either flag alone: tapping the opposite trigger has to mean "the
    // other set" even when the player already switched to the second one.
    expect(crossHotbarActiveSet(held())).toBe(CROSS_HOTBAR_PRIMARY_SET);
    expect(crossHotbarActiveSet(held({ standing: true }))).toBe(CROSS_HOTBAR_EXPANDED_SET);
    expect(crossHotbarActiveSet(held({ expanded: true }))).toBe(CROSS_HOTBAR_EXPANDED_SET);
    expect(crossHotbarActiveSet(held({ expanded: true, standing: true }))).toBe(
      CROSS_HOTBAR_PRIMARY_SET,
    );
  });

  it('toggles back', () => {
    const on = toggleCrossHotbarStandingSet(INITIAL_CROSS_HOTBAR_TRIGGER_STATE);
    expect(toggleCrossHotbarStandingSet(on).standing).toBe(false);
  });
});

describe('releaseCrossHotbarHold', () => {
  it('drops the hold, the reach and both trigger latches', () => {
    const released = releaseCrossHotbarHold({
      hold: 'right',
      expanded: true,
      standing: false,
      ltDown: true,
      rtDown: true,
    });
    expect(released).toEqual(INITIAL_CROSS_HOTBAR_TRIGGER_STATE);
  });

  it('keeps the standing set, so letting go is not a way to lose it', () => {
    // Release runs on every poll while a window is open and again on blur, so a
    // release that reset the standing set would make opening bags undo the switch.
    const released = releaseCrossHotbarHold({
      hold: 'left',
      expanded: true,
      standing: true,
      ltDown: true,
      rtDown: false,
    });
    expect(released.standing).toBe(true);
    expect(released.hold).toBeNull();
    expect(released.expanded).toBe(false);
    expect(crossHotbarActiveSet(released)).toBe(CROSS_HOTBAR_EXPANDED_SET);
  });

  it('is idempotent, so repeating it over many polls settles', () => {
    const once = releaseCrossHotbarHold(
      toggleCrossHotbarStandingSet(INITIAL_CROSS_HOTBAR_TRIGGER_STATE),
    );
    expect(releaseCrossHotbarHold(once)).toEqual(once);
  });
});
