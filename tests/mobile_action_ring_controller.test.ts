// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import type {
  ActionBarAbility,
  ActionBarWorldInput,
} from '../src/ui/hud/action_bar/action_bar_view';
import {
  mobileButtonHasSourceSlot,
  mobileButtonOwnsSourceSlot,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';
import { buildMobileActionRing } from '../src/ui/hud/action_bar/mobile_action_ring_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

const writers: PainterHostWriters = {
  setText: vi.fn(),
  setDisplay: vi.fn(),
  setTransform: vi.fn(),
  setWidth: vi.fn(),
  setStyleProp: vi.fn(),
  toggleClass: vi.fn(),
  setAttr: vi.fn(),
};

const ability: ActionBarAbility = {
  def: {
    id: 'flamestrike',
    offGcd: false,
    cooldown: 6,
    requiresTarget: false,
    range: 30,
  } as AbilityDef,
  cost: 0,
};

function world(activeAimSlot: number | null): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      resourceType: 'mana',
      savedMana: 0,
      queuedOnSwing: null,
      auras: [],
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot,
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="mobile-action-ring">
      <button id="mobile-action-attack"></button>
      ${Array.from(
        { length: 4 },
        (_, index) => `<button class="mobile-action-slot" data-mobile-index="${index}"></button>`,
      ).join('')}
      <button id="mobile-action-page-toggle"><span class="mobile-action-page-indicator"></span></button>
    </div>
    <div id="mobile-action-radial">
      ${['up', 'right', 'down', 'left']
        .map(
          (direction, index) =>
            `<button class="mobile-action-petal" data-mobile-index="${index}" data-radial-dir="${direction}"></button>`,
        )
        .join('')}
      <button id="mobile-action-radial-cancel"></button>
    </div>
  `;
});

describe('buildMobileActionRing aiming ownership', () => {
  it('marks the physical button that owns a petal aim and clears it when aim ends', () => {
    let activeAimSlot: number | null = 17;
    const ring = buildMobileActionRing({
      writers,
      iconBackground: () => '',
      sourceSlot: (buttonIndex, direction) => sourceSlotForMobileButton(0, buttonIndex, direction),
      hasSourceSlot: (buttonIndex, direction) =>
        mobileButtonHasSourceSlot(0, buttonIndex, undefined, direction),
      aimOwnsButton: (buttonIndex) => mobileButtonOwnsSourceSlot(0, buttonIndex, activeAimSlot),
      cancelAim: vi.fn(),
      actionForSlot: () => ({ type: 'ability', id: ability.def.id }),
      abilityForSlot: () => ability,
      itemForSlot: () => null,
      empoweredAbilityIdForSlot: () => null,
      bindModeActive: () => false,
      takeSuppressedClick: () => false,
      castSlot: vi.fn(),
      cyclePage: vi.fn(),
      activateFixedAttackSlot: vi.fn(),
      attackNearest: null,
      attackTapState: () => ({ autoAttack: false, hasLiveHostileTarget: false }),
      hideTooltip: vi.fn(),
      consumePeekGuard: vi.fn(),
      bindEmpoweredHold: vi.fn(),
    });

    expect(ring).not.toBeNull();
    expect(ring?.view.tick(world(activeAimSlot)).slots.map((slot) => slot.aiming)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);

    activeAimSlot = null;
    expect(ring?.view.tick(world(activeAimSlot)).slots.every((slot) => !slot.aiming)).toBe(true);
  });
});

describe('buildMobileActionRing placed Attack', () => {
  it('paints a page slot holding the placed Attack as the Attack toggle', () => {
    // Source slot 2 (the second ring button on page 0) holds Attack; the rest hold
    // the test ability. The fixed Attack button (view slot 0) stays Attack too.
    const attackSlot = sourceSlotForMobileButton(0, 1, 'center');
    const ring = buildMobileActionRing({
      writers,
      iconBackground: (key) => `icon:${key}`,
      sourceSlot: (buttonIndex, direction) => sourceSlotForMobileButton(0, buttonIndex, direction),
      hasSourceSlot: (buttonIndex, direction) =>
        mobileButtonHasSourceSlot(0, buttonIndex, undefined, direction),
      aimOwnsButton: () => false,
      cancelAim: vi.fn(),
      actionForSlot: (slot) =>
        slot === attackSlot
          ? { type: 'attack', id: 'attack' }
          : { type: 'ability', id: ability.def.id },
      abilityForSlot: (slot) => (slot === attackSlot ? null : ability),
      itemForSlot: () => null,
      empoweredAbilityIdForSlot: () => null,
      bindModeActive: () => false,
      takeSuppressedClick: () => false,
      castSlot: vi.fn(),
      cyclePage: vi.fn(),
      activateFixedAttackSlot: vi.fn(),
      attackNearest: null,
      attackTapState: () => ({ autoAttack: false, hasLiveHostileTarget: false }),
      hideTooltip: vi.fn(),
      consumePeekGuard: vi.fn(),
      bindEmpoweredHold: vi.fn(),
    });
    const state = ring!.view.tick(world(null));
    expect(state.slots.map((slot) => slot.kind)).toEqual([
      'attack',
      'ability',
      'attack',
      'ability',
      'ability',
    ]);

    // Paint it: the fixed button keeps its blank background (its inline SVG shows
    // through), but the page slot holding Attack gets the painted Attack icon.
    const setStyleProp = writers.setStyleProp as ReturnType<typeof vi.fn>;
    setStyleProp.mockClear();
    ring!.painter.paint(state, 0, 2, 8, true);
    const labels = [
      document.querySelector('#mobile-action-attack .icon-label'),
      ...document.querySelectorAll('.mobile-action-slot .icon-label'),
    ];
    const background = (label: Element | null) =>
      setStyleProp.mock.calls.find((c) => c[0] === label && c[1] === 'background-image')?.[2];
    expect(background(labels[0])).toBe('');
    expect(background(labels[2])).toBe(`icon:${state.slots[2].iconKey}`);
    expect(state.slots[2].iconKey).toBe(state.slots[0].iconKey);
  });
});
