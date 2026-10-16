// The Shardpike bar (src/ui/hud/shardpike/).
//
// The bar is the ONLY input surface for the Mirefen world boss's level-spread trial: the
// three verbs are item-borne rather than abilities, so there is no hotbar slot, no
// key-bind and no target click that reaches them. That is what makes the visibility rule
// and the enable rules worth pinning: a bar that fails to appear, or a Thrust that stays
// live outside the window, is the difference between a mechanic being playable and being
// unreachable code, and BOTH states typecheck and render a perfectly plausible HUD.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANCE_ITEM_ID } from '../src/sim/lance_trial';
import {
  SHARDPIKE_DANGER_BALANCE,
  SHARDPIKE_ITEM_ID,
  type ShardpikeBarInput,
  shardpikeBarSignature,
  shardpikeBarState,
} from '../src/ui/hud/shardpike';
import type { LanceTrialView } from '../src/world_api/lance_trial';

const input = (over: Partial<ShardpikeBarInput> = {}): ShardpikeBarInput => ({
  mainhandItemId: SHARDPIKE_ITEM_ID,
  trial: null,
  restRemaining: 0,
  dead: false,
  ...over,
});
const trial = (over: Partial<LanceTrialView> = {}): LanceTrialView => ({
  phase: 'bracing',
  balance: 0,
  setProgress: 0,
  windowRemaining: 0,
  ...over,
});
const button = (i: ShardpikeBarInput, action: 'brace' | 'thrust' | 'release') => {
  const b = shardpikeBarState(i).buttons.find((x) => x.action === action);
  if (!b) throw new Error(`no ${action} button`);
  return b;
};

describe('the bar belongs to the item', () => {
  it('names the same item the sim gates the trial on', () => {
    // Two ids for one item is how the bar ends up showing for a weapon that cannot brace,
    // or staying hidden for the one that can.
    expect(SHARDPIKE_ITEM_ID).toBe(LANCE_ITEM_ID);
  });

  it('shows only while the pike is the equipped mainhand', () => {
    expect(shardpikeBarState(input()).visible).toBe(true);
    expect(shardpikeBarState(input({ mainhandItemId: 'iron_sword' })).visible).toBe(false);
    expect(shardpikeBarState(input({ mainhandItemId: null })).visible).toBe(false);
    expect(shardpikeBarState(input({ mainhandItemId: undefined })).visible).toBe(false);
  });

  it('offers nothing at all when hidden, so no verb is reachable without the pike', () => {
    const hidden = shardpikeBarState(input({ mainhandItemId: 'iron_sword' }));
    expect(hidden.buttons).toEqual([]);
    expect(hidden.bracing).toBe(false);
  });

  it('keeps all three verbs present whenever it is shown', () => {
    // Present-but-disabled rather than appearing and vanishing: the row must not reflow
    // under the player's cursor in the middle of a boss fight.
    expect(shardpikeBarState(input()).buttons.map((b) => b.action)).toEqual([
      'brace',
      'thrust',
      'release',
    ]);
    const steady = shardpikeBarState(input({ trial: trial({ phase: 'steadied' }) }));
    expect(steady.buttons.map((b) => b.action)).toEqual(['brace', 'thrust', 'release']);
  });
});

describe('when each verb is legal', () => {
  it('offers Brace only with nothing couched and the pike rested', () => {
    expect(button(input(), 'brace').enabled).toBe(true);
    expect(button(input({ trial: trial() }), 'brace').enabled).toBe(false);
    expect(button(input({ restRemaining: 2.5 }), 'brace').enabled).toBe(false);
  });

  it('counts the rest down on the Brace button, rounded up', () => {
    // Rounded UP so a button reading "1" is never already live: a 0 that still refuses is
    // the reading players read as the bar being broken.
    expect(button(input({ restRemaining: 0.1 }), 'brace').cooldownSeconds).toBe(1);
    expect(button(input({ restRemaining: 4.2 }), 'brace').cooldownSeconds).toBe(5);
    expect(button(input(), 'brace').cooldownSeconds).toBeNull();
  });

  it('offers Thrust ONLY from a set pike, never while still bracing', () => {
    // The whole skill check: bracing is the work, steadied is the payoff, and a thrust
    // that fires mid-brace would delete the mechanic.
    expect(button(input({ trial: trial({ phase: 'bracing' }) }), 'thrust').enabled).toBe(false);
    expect(button(input({ trial: trial({ setProgress: 0.99 }) }), 'thrust').enabled).toBe(false);
    expect(button(input({ trial: trial({ phase: 'steadied' }) }), 'thrust').enabled).toBe(true);
    expect(button(input(), 'thrust').enabled).toBe(false);
  });

  it('puts the window deadline on the Thrust as a WINDOW, never as a cooldown', () => {
    // This test used to assert the opposite, and that was the bug: the window rode the
    // cooldown field, so the one moment the fight wants a press rendered as a dark tile with
    // a number counting down, which in this genre means "you cannot press this". Players
    // read the primed action as unavailable and let the window expire.
    const b = button(
      input({ trial: trial({ phase: 'steadied', windowRemaining: 3.2 }) }),
      'thrust',
    );
    expect(b.cooldownSeconds).toBeNull();
    expect(b.windowSeconds).toBe(4);
    expect(b.windowFrac).toBeGreaterThan(0);
    expect(b.enabled).toBe(true);
    // ...and nothing to count while there is no window.
    const idle = button(input({ trial: trial() }), 'thrust');
    expect(idle.cooldownSeconds).toBeNull();
    expect(idle.windowFrac).toBeNull();
  });

  it('offers Release whenever something is couched, and never otherwise', () => {
    expect(button(input({ trial: trial() }), 'release').enabled).toBe(true);
    expect(button(input({ trial: trial({ phase: 'steadied' }) }), 'release').enabled).toBe(true);
    expect(button(input(), 'release').enabled).toBe(false);
  });

  it('refuses every verb while dead, matching what the sim would answer', () => {
    const dead = shardpikeBarState(input({ dead: true, trial: trial({ phase: 'steadied' }) }));
    expect(dead.visible).toBe(true);
    expect(dead.buttons.every((b) => !b.enabled)).toBe(true);
    expect(dead.buttons.every((b) => !b.primed)).toBe(true);
  });
});

describe('the bar says what to do next', () => {
  it('primes exactly one verb in each ordinary state', () => {
    const idle = shardpikeBarState(input());
    expect(idle.buttons.filter((b) => b.primed).map((b) => b.action)).toEqual(['brace']);
    const steady = shardpikeBarState(input({ trial: trial({ phase: 'steadied' }) }));
    expect(steady.buttons.filter((b) => b.primed).map((b) => b.action)).toEqual(['thrust']);
  });

  it('primes nothing while the work is still being done, or while resting', () => {
    // Mid-brace the answer is "keep holding it", which is not a button press.
    expect(shardpikeBarState(input({ trial: trial() })).buttons.some((b) => b.primed)).toBe(false);
    expect(shardpikeBarState(input({ restRemaining: 3 })).buttons.some((b) => b.primed)).toBe(
      false,
    );
  });
});

describe('the balance beam', () => {
  it('maps the sim beam onto the track, centre to centre', () => {
    expect(shardpikeBarState(input({ trial: trial({ balance: 0 }) })).balanceFrac).toBeCloseTo(
      0.5,
      6,
    );
    expect(shardpikeBarState(input({ trial: trial({ balance: -1 }) })).balanceFrac).toBe(0);
    expect(shardpikeBarState(input({ trial: trial({ balance: 1 }) })).balanceFrac).toBe(1);
  });

  it('clamps a beam past its rails instead of pushing the pip off the track', () => {
    expect(shardpikeBarState(input({ trial: trial({ balance: -4 }) })).balanceFrac).toBe(0);
    expect(shardpikeBarState(input({ trial: trial({ balance: 9 }) })).balanceFrac).toBe(1);
  });

  it('warns on BOTH rails, with travel left to correct', () => {
    const danger = (balance: number) =>
      shardpikeBarState(input({ trial: trial({ balance }) })).danger;
    expect(danger(0)).toBe(false);
    expect(danger(SHARDPIKE_DANGER_BALANCE)).toBe(true);
    expect(danger(-SHARDPIKE_DANGER_BALANCE)).toBe(true);
    // The warning has to arrive BEFORE the fumble, or it is a death rattle.
    expect(SHARDPIKE_DANGER_BALANCE).toBeLessThan(1);
    expect(SHARDPIKE_DANGER_BALANCE).toBeGreaterThan(0.3);
  });

  it('reports no beam at all with nothing couched, so the meter is not drawn idle', () => {
    const idle = shardpikeBarState(input());
    expect(idle.bracing).toBe(false);
    expect(idle.balanceFrac).toBe(0.5);
    expect(idle.setFrac).toBe(0);
  });

  it('holds the set fill at full once steadied', () => {
    expect(shardpikeBarState(input({ trial: trial({ setProgress: 0.4 }) })).setFrac).toBeCloseTo(
      0.4,
      6,
    );
    expect(shardpikeBarState(input({ trial: trial({ setProgress: 3 }) })).setFrac).toBe(1);
  });
});

describe('the repaint signature', () => {
  it('is empty while hidden, so a bagged pike costs no comparison', () => {
    expect(shardpikeBarSignature(shardpikeBarState(input({ mainhandItemId: null })))).toBe('');
  });

  it('changes when any button state changes', () => {
    const idle = shardpikeBarSignature(shardpikeBarState(input()));
    const resting = shardpikeBarSignature(shardpikeBarState(input({ restRemaining: 3 })));
    const steady = shardpikeBarSignature(
      shardpikeBarState(input({ trial: trial({ phase: 'steadied' }) })),
    );
    expect(new Set([idle, resting, steady]).size).toBe(3);
  });

  it('quantizes the beam so sub-pixel drift does not rebuild the row every tick', () => {
    const at = (balance: number) =>
      shardpikeBarSignature(shardpikeBarState(input({ trial: trial({ balance }) })));
    expect(at(0.5)).toBe(at(0.5001));
    // ...but a move the player can actually see still registers.
    expect(at(0.5)).not.toBe(at(0.75));
  });
});

describe('the verbs are actually wired to the world', () => {
  it('dispatches each button to its own IWorld verb', () => {
    // The gap this closes: sim, wire, IWorld facet and server dispatch for this trial all
    // shipped complete, and nothing in src/ui ever called them, so the mechanic was
    // unreachable in play. A source pin because the alternative is a DOM harness that
    // proves the click plumbing and not the mapping.
    const src = readFileSync('src/ui/hud/shardpike/shardpike_bar.ts', 'utf8');
    expect(src).toMatch(/'brace'\)\s*w\.lanceBrace\(\)/s);
    expect(src).toMatch(/'thrust'\)\s*w\.lanceThrust\(\)/s);
    expect(src).toMatch(/w\.lanceRelease\(\)/);
  });

  it('is painted every frame by the HUD, not just constructed', () => {
    // A painter that is built and never driven is the same dead end as no painter at all.
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    expect(hud).toContain('createShardpikeBar(');
    expect(hud).toContain('this.shardpikeBar.paint(');
  });
});
