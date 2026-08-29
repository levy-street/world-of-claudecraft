// @vitest-environment jsdom

// Hud.pressCrossHotbarAction / releaseCrossHotbarAction, the pad's press and
// release edges, over Hud.castCrossHotbarAction, the tap-shaped fire. All route
// back through the slot entry points so a cross-hotbar cast keeps the semantics
// a key press has (reticle, empower, sport tap, mouseover, the auto-attack QoL),
// and the interesting half is what happens when the action is NOT on the bar.
//
// The slot search is barSlot-indexed, NOT array-indexed: barSlot 0 is the fixed
// Attack seat and 1..ACTION_BAR_ABILITY_SLOTS are the configurable slots, so a
// loop bounded by the array length silently skips the LAST one. That is the
// off-by-one this file pins, together with the three fallback arms.
//
// The second block pins the other half of the same seam: which ids Hud.syncSlotMap
// hands the pad as newly learnable actions.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { click: vi.fn() },
}));
vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitUpdate: vi.fn(),
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(),
}));
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (kind: string, id: string) => `mock:${kind}:${id}`,
  QUALITY_COLOR: {},
  raidMarkerDataUrl: vi.fn(() => ''),
  auraImageUrl: vi.fn(() => null),
  cachedProceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
  hasAbilityIconIdentity: vi.fn(() => false),
  hasAuraImageIdentity: vi.fn(() => false),
  hasAuraRecipe: vi.fn(() => false),
  proceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
}));

import { CROSS_HOTBAR_ATTACK_ID } from '../src/game/cross_hotbar';
import { ABILITIES } from '../src/sim/data';
import type { AbilityDef } from '../src/sim/types';
import { EmpowerHold } from '../src/ui/empower_hold_core';
import { Hud } from '../src/ui/hud';
import { ACTION_BAR_ABILITY_SLOTS } from '../src/ui/hud/action_bar/action_bar_layout_core';
import { tSim } from '../src/ui/sim_i18n';
import { isStanceBarAbilityGroup } from '../src/ui/stance_bar_view';

type Action = { type: 'ability' | 'item'; id: string } | null;

interface CastHarness {
  actionBarController: {
    actions: Action[];
    actionForSlot(barSlot: number): Action;
    isHotbarItemId(itemId: string): boolean;
  };
  sim: {
    castAbility: ReturnType<typeof vi.fn>;
    releaseEmpoweredAbility: ReturnType<typeof vi.fn>;
    known: { def: AbilityDef }[];
    useItem: ReturnType<typeof vi.fn>;
    tradeInfo: unknown;
  };
  castSlot: ReturnType<typeof vi.fn>;
  pressSlot: ReturnType<typeof vi.fn>;
  activateFixedAttackSlot: ReturnType<typeof vi.fn>;
  empowerHold: EmpowerHold;
  flashActionSlot: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  tryGatherToolUse: ReturnType<typeof vi.fn>;
  renderBags: ReturnType<typeof vi.fn>;
  pressCrossHotbarAction(action: { type: 'ability' | 'item'; id: string }): void;
  releaseCrossHotbarAction(action: { type: 'ability' | 'item'; id: string }): void;
  castCrossHotbarAction(action: { type: 'ability' | 'item'; id: string }): void;
}

/** A Hud with the real castCrossHotbarAction over a faithful fake of the action
 *  bar controller's slot contract: barSlot 0 is the Attack seat (null while the
 *  Attack button owns it), barSlot n is the array's index n-1. */
function makeHud(
  opts: {
    bar?: Action[];
    attackSeat?: Action;
    usableItemIds?: readonly string[];
    tradeOpen?: boolean;
    gatherToolHandled?: boolean;
    knownIds?: readonly string[];
  } = {},
): CastHarness {
  document.body.innerHTML = '<div id="bags" style="display:none"></div>';
  const bar = opts.bar ?? Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
  const usable = new Set(opts.usableItemIds ?? []);
  const hud = Object.create(Hud.prototype) as unknown as CastHarness;
  hud.actionBarController = {
    actions: bar,
    actionForSlot: (barSlot) =>
      barSlot === 0 ? (opts.attackSeat ?? null) : (bar[barSlot - 1] ?? null),
    isHotbarItemId: (itemId) => usable.has(itemId),
  };
  // tradeOpen is derived (sim.tradeInfo !== null), so the open trade is staged
  // the way the real world reports one.
  hud.sim = {
    castAbility: vi.fn(),
    releaseEmpoweredAbility: vi.fn(),
    known: (opts.knownIds ?? []).map((id) => ({ def: ABILITIES[id] })),
    useItem: vi.fn(),
    tradeInfo: opts.tradeOpen ? { items: [] } : null,
  };
  hud.castSlot = vi.fn();
  hud.pressSlot = vi.fn();
  hud.activateFixedAttackSlot = vi.fn();
  hud.empowerHold = new EmpowerHold();
  hud.flashActionSlot = vi.fn();
  hud.showError = vi.fn();
  hud.tryGatherToolUse = vi.fn(() => opts.gatherToolHandled ?? false);
  hud.renderBags = vi.fn();
  return hud;
}

describe('Hud cross hotbar hold routing', () => {
  it('routes an on-bar press through pressSlot at the last bar slot', () => {
    const last = ACTION_BAR_ABILITY_SLOTS - 1;
    const hud = makeHud({ bar: barWith(last, { type: 'ability', id: 'glacial_front' }) });

    hud.pressCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    expect(hud.pressSlot).toHaveBeenCalledExactlyOnceWith(ACTION_BAR_ABILITY_SLOTS);
    expect(hud.sim.castAbility).not.toHaveBeenCalled();
  });

  it('starts an empowered off-bar ability without immediately releasing it', () => {
    const hud = makeHud({ knownIds: ['glacial_front'] });

    const fallback = vi.spyOn(hud, 'castCrossHotbarAction');

    hud.pressCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    expect(hud.sim.castAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(hud.sim.releaseEmpoweredAbility).not.toHaveBeenCalled();
    expect(hud.empowerHold.active).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('keeps the unchanged fallback for a non-empowered off-bar ability', () => {
    const hud = makeHud({ knownIds: ['defensive_stance'] });
    const fallback = vi.spyOn(hud, 'castCrossHotbarAction');

    hud.pressCrossHotbarAction({ type: 'ability', id: 'defensive_stance' });

    expect(fallback).toHaveBeenCalledExactlyOnceWith({
      type: 'ability',
      id: 'defensive_stance',
    });
    expect(hud.sim.castAbility).toHaveBeenCalledExactlyOnceWith('defensive_stance');
  });

  it('uses the unchanged fallback for an empowered ability the player does not know', () => {
    const hud = makeHud();
    const fallback = vi.spyOn(hud, 'castCrossHotbarAction');

    hud.pressCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    expect(fallback).toHaveBeenCalledExactlyOnceWith({
      type: 'ability',
      id: 'glacial_front',
    });
  });

  it.each([
    { type: 'ability' as const, id: CROSS_HOTBAR_ATTACK_ID },
    { type: 'item' as const, id: 'minor_healing_potion' },
  ])('delegates $type actions unchanged', (action) => {
    const hud = makeHud({ usableItemIds: ['minor_healing_potion'] });
    const fallback = vi.spyOn(hud, 'castCrossHotbarAction');

    hud.pressCrossHotbarAction(action);

    expect(fallback).toHaveBeenCalledExactlyOnceWith(action);
  });

  it('releases only the matching live empowered ability once', () => {
    const hud = makeHud({ knownIds: ['glacial_front'] });
    hud.pressCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    hud.releaseCrossHotbarAction({ type: 'ability', id: 'dragons_breath' });
    expect(hud.sim.releaseEmpoweredAbility).not.toHaveBeenCalled();
    hud.releaseCrossHotbarAction({ type: 'ability', id: 'glacial_front' });
    hud.releaseCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    expect(hud.sim.releaseEmpoweredAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(hud.flashActionSlot).not.toHaveBeenCalled();
  });

  it('does nothing on release without a live charge', () => {
    const hud = makeHud({ knownIds: ['glacial_front'] });

    hud.releaseCrossHotbarAction({ type: 'ability', id: 'glacial_front' });

    expect(hud.sim.releaseEmpoweredAbility).not.toHaveBeenCalled();
  });
});

describe('Hud slot hold routing', () => {
  interface SlotHarness {
    empowerHold: EmpowerHold;
    sim: {
      castAbility: ReturnType<typeof vi.fn>;
      releaseEmpoweredAbility: ReturnType<typeof vi.fn>;
    };
    abilityForSlot: ReturnType<typeof vi.fn>;
    castSlot: ReturnType<typeof vi.fn>;
    flashActionSlot: ReturnType<typeof vi.fn>;
    pressSlot(slot: number): void;
    releaseSlot(slot: number): void;
  }

  function makeSlotHud(empowered: boolean): SlotHarness {
    const hud = Object.create(Hud.prototype) as unknown as SlotHarness;
    hud.empowerHold = new EmpowerHold();
    hud.sim = {
      castAbility: vi.fn(),
      releaseEmpoweredAbility: vi.fn(),
    };
    hud.abilityForSlot = vi.fn(() =>
      empowered ? { def: ABILITIES.glacial_front } : { def: ABILITIES.defensive_stance },
    );
    hud.castSlot = vi.fn();
    hud.flashActionSlot = vi.fn();
    return hud;
  }

  it('starts and releases an empowered slot through the real Hud methods', () => {
    const hud = makeSlotHud(true);

    hud.pressSlot(4);
    hud.pressSlot(4);
    expect(hud.sim.castAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(hud.sim.releaseEmpoweredAbility).not.toHaveBeenCalled();
    expect(hud.castSlot).not.toHaveBeenCalled();
    hud.releaseSlot(4);

    expect(hud.sim.releaseEmpoweredAbility).toHaveBeenCalledExactlyOnceWith('glacial_front');
    expect(hud.flashActionSlot).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('keeps non-empowered press fallthrough and release no-op behavior', () => {
    const hud = makeSlotHud(false);

    hud.pressSlot(4);
    hud.releaseSlot(4);

    expect(hud.castSlot).toHaveBeenCalledExactlyOnceWith(4);
    expect(hud.sim.castAbility).not.toHaveBeenCalled();
    expect(hud.sim.releaseEmpoweredAbility).not.toHaveBeenCalled();
    expect(hud.flashActionSlot).not.toHaveBeenCalled();
  });
});

function barWith(index: number, action: Action): Action[] {
  const bar: Action[] = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
  bar[index] = action;
  return bar;
}

describe('Hud.castCrossHotbarAction slot routing', () => {
  it('routes an action on the LAST desktop slot through castSlot, not the fallback', () => {
    const last = ACTION_BAR_ABILITY_SLOTS - 1;
    const hud = makeHud({ bar: barWith(last, { type: 'ability', id: 'heroic_strike' }) });

    hud.castCrossHotbarAction({ type: 'ability', id: 'heroic_strike' });

    // barSlot, not array index: the last slot is ACTION_BAR_ABILITY_SLOTS itself.
    expect(hud.castSlot).toHaveBeenCalledWith(ACTION_BAR_ABILITY_SLOTS);
    expect(hud.sim.castAbility).not.toHaveBeenCalled();
  });

  it('routes the first desktop slot through castSlot at barSlot 1', () => {
    const hud = makeHud({ bar: barWith(0, { type: 'ability', id: 'rend' }) });

    hud.castCrossHotbarAction({ type: 'ability', id: 'rend' });

    expect(hud.castSlot).toHaveBeenCalledWith(1);
  });

  it('matches the Attack seat at barSlot 0 when the player parked an action there', () => {
    const hud = makeHud({ attackSeat: { type: 'ability', id: 'charge' } });

    hud.castCrossHotbarAction({ type: 'ability', id: 'charge' });

    expect(hud.castSlot).toHaveBeenCalledWith(0);
  });

  it('never matches a slot the Attack button owns', () => {
    // Attack on: actionForSlot(0) is null even though the array holds an action
    // at index 0, and index 0 is barSlot 1, which must still match on its own.
    const hud = makeHud({ bar: barWith(0, { type: 'ability', id: 'charge' }), attackSeat: null });

    hud.castCrossHotbarAction({ type: 'ability', id: 'charge' });

    expect(hud.castSlot).toHaveBeenCalledWith(1);
    expect(hud.castSlot).not.toHaveBeenCalledWith(0);
  });

  it('toggles auto-attack for the Attack action, which no slot can hold', () => {
    const hud = makeHud();

    hud.castCrossHotbarAction({ type: 'ability', id: CROSS_HOTBAR_ATTACK_ID });

    expect(hud.activateFixedAttackSlot).toHaveBeenCalledTimes(1);
    expect(hud.castSlot).not.toHaveBeenCalled();
  });

  it('does not confuse an item with an ability of the same id', () => {
    const hud = makeHud({
      bar: barWith(4, { type: 'ability', id: 'shared_id' }),
      usableItemIds: ['shared_id'],
    });

    hud.castCrossHotbarAction({ type: 'item', id: 'shared_id' });

    expect(hud.castSlot).not.toHaveBeenCalled();
    expect(hud.sim.useItem).toHaveBeenCalledWith('shared_id');
  });
});

describe('Hud.castCrossHotbarAction fallback for an action off the desktop bar', () => {
  it('still casts an ability the bar does not hold', () => {
    const hud = makeHud();

    hud.castCrossHotbarAction({ type: 'ability', id: 'defensive_stance' });

    expect(hud.castSlot).not.toHaveBeenCalled();
    expect(hud.sim.castAbility).toHaveBeenCalledWith('defensive_stance');
    expect(hud.showError).not.toHaveBeenCalled();
  });

  it('uses an item the bar does not hold', () => {
    const hud = makeHud({ usableItemIds: ['minor_healing_potion'] });

    hud.castCrossHotbarAction({ type: 'item', id: 'minor_healing_potion' });

    expect(hud.castSlot).not.toHaveBeenCalled();
    expect(hud.sim.useItem).toHaveBeenCalledWith('minor_healing_potion');
    expect(hud.showError).not.toHaveBeenCalled();
  });

  it('takes the gathering-tool handler first, exactly as a bar press does', () => {
    const hud = makeHud({ usableItemIds: ['copper_pick'], gatherToolHandled: true });

    hud.castCrossHotbarAction({ type: 'item', id: 'copper_pick' });

    expect(hud.tryGatherToolUse).toHaveBeenCalledWith('copper_pick');
    expect(hud.sim.useItem).not.toHaveBeenCalled();
  });

  it('refuses an item the bar cannot use out loud instead of eating the press', () => {
    const hud = makeHud({ usableItemIds: [] });

    hud.castCrossHotbarAction({ type: 'item', id: 'rusty_longsword' });

    expect(hud.sim.useItem).not.toHaveBeenCalled();
    expect(hud.showError).toHaveBeenCalledTimes(1);
    const [text] = hud.showError.mock.calls[0] as [string];
    expect(text).toBe(tSim('error.noItem'));
    expect(text).not.toContain('rusty_longsword');
    expect(text.length).toBeGreaterThan(0);
  });

  it('stays silent while a trade window is open', () => {
    const hud = makeHud({ usableItemIds: ['minor_healing_potion'], tradeOpen: true });

    hud.castCrossHotbarAction({ type: 'item', id: 'minor_healing_potion' });

    expect(hud.sim.useItem).not.toHaveBeenCalled();
    expect(hud.showError).not.toHaveBeenCalled();
  });
});

// Hud.syncSlotMap, the mid-session "you learned something new" hand-off to the pad.
// Stances are the interesting id: pad mode hides the desktop stance bar, so a stance
// learned after the cross hotbar was seeded reaches a controller player ONLY through
// this offer. The list is filtered by action-bar eligibility alone, and a stance-group
// filter creeping back here would silently strand Guarded Stance on a pad again.
describe('Hud.syncSlotMap known-ability offer to the pad', () => {
  interface SyncHarness {
    actionBarController: { syncKnownAbilities: ReturnType<typeof vi.fn> };
    optionsHooks: { gamepad: { syncCrossHotbarKnown: ReturnType<typeof vi.fn> } };
    sim: { known: { def: AbilityDef }[] };
    currentMobileActionPage: ReturnType<typeof vi.fn>;
    syncSlotMap(): void;
  }

  /** A Hud with the real syncSlotMap over the two collaborators it reads: the
   *  player's known list and the gamepad options hook it offers ids to. */
  function makeSyncHud(knownIds: readonly string[]): SyncHarness {
    const hud = Object.create(Hud.prototype) as unknown as SyncHarness;
    hud.actionBarController = { syncKnownAbilities: vi.fn() };
    hud.optionsHooks = { gamepad: { syncCrossHotbarKnown: vi.fn() } };
    // Real content records: what makes an id a stance is the shipped
    // exclusiveGroup, not a shape the test gets to invent for itself.
    hud.sim = { known: knownIds.map((id) => ({ def: ABILITIES[id] })) };
    hud.currentMobileActionPage = vi.fn(() => 0);
    return hud;
  }

  function offeredIds(hud: SyncHarness): string[] {
    hud.syncSlotMap();
    const [ids] = hud.optionsHooks.gamepad.syncCrossHotbarKnown.mock.calls[0] as [string[]];
    return ids;
  }

  it('offers a stance the pad has no other way to reach', () => {
    expect(isStanceBarAbilityGroup(ABILITIES.defensive_stance.exclusiveGroup)).toBe(true);
    const hud = makeSyncHud(['mortal_strike', 'defensive_stance']);

    expect(offeredIds(hud)).toContain('defensive_stance');
  });

  it('withholds a passive, which no bar seat can cast', () => {
    expect(ABILITIES.measured_fury.passive).toBe(true);
    const hud = makeSyncHud(['mortal_strike', 'measured_fury']);

    expect(offeredIds(hud)).toEqual(['mortal_strike']);
  });
});
