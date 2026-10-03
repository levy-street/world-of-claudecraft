import { describe, expect, it, vi } from 'vitest';
import { morthenChooseSlot, morthenControlsActive } from '../src/game/morthen_controls';
import { MORTHEN_BAR_SLOTS, MORTHEN_KIT, morthenSlotAbility } from '../src/sim/graveyard_shift/kit';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { GCD } from '../src/sim/types';
import { graveyardShiftAbilityDescription } from '../src/ui/graveyard_shift_text_core';
import {
  createMorthenActionBarView,
  type MorthenBarPlayer,
  type MorthenBarTarget,
  morthenSlotTooltipHtml,
} from '../src/ui/hud/vehicle/morthen_action_bar_view';
import { setLanguage } from '../src/ui/i18n';

// A spy over the real description builder, so a case can count how often the view
// resolves the full tooltip prose.
vi.mock('../src/ui/graveyard_shift_text_core', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/graveyard_shift_text_core')>();
  return {
    ...real,
    graveyardShiftAbilityDescription: vi.fn(real.graveyardShiftAbilityDescription),
  };
});

function player(over: Partial<MorthenBarPlayer> = {}): MorthenBarPlayer {
  return {
    dead: false,
    autoAttack: false,
    gcdRemaining: 0,
    cooldowns: new Map<string, number>(),
    pos: { x: 0, y: 0, z: 0 },
    resource: 100,
    ...over,
  };
}

function target(z: number, over: Partial<MorthenBarTarget> = {}): MorthenBarTarget {
  return { dead: false, kind: 'player', templateId: '', pos: { x: 0, y: 0, z }, ...over };
}

const keys = (slot: number) => `K${slot + 1}`;

describe('morthen action bar view', () => {
  it('lays out Attack then the kit in MORTHEN_KIT order', () => {
    expect(MORTHEN_BAR_SLOTS.map((def) => def?.id ?? 'attack')).toEqual([
      'attack',
      'gshift_sextons_chain',
      'gshift_shadow_pulse',
      'gshift_raise_fallen',
    ]);
    const state = createMorthenActionBarView().tick(player(), null, keys);
    expect(state.slots.map((slot) => slot.kind)).toEqual([
      'attack',
      'ability',
      'ability',
      'ability',
    ]);
    expect(state.slots.slice(1).map((slot) => slot.abilityId)).toEqual(
      MORTHEN_KIT.map((def) => def.id),
    );
    expect(morthenSlotAbility(0)).toBeNull();
    expect(morthenSlotAbility(4)).toBeNull();
  });

  it('labels every slot with its key and a localized name, never a raw id', () => {
    const state = createMorthenActionBarView().tick(player(), null, keys);
    expect(state.slots.map((slot) => slot.keybindLabel)).toEqual(['K1', 'K2', 'K3', 'K4']);
    expect(state.slots[0].ariaLabel).toBe('Action slot 1: Attack');
    expect(state.slots[1].ariaLabel).toBe("Action slot 2: Sexton's Chain");
    expect(state.slots[2].ariaLabel).toBe('Action slot 3: Shadow Pulse');
    expect(state.slots[3].ariaLabel).toBe('Action slot 4: Raise the Fallen');
    for (const slot of state.slots) expect(slot.ariaLabel).not.toMatch(/gshift_/);
    expect(state.slots[2].ariaDescription).toContain('24 to 36 Shadow damage');
  });

  it('borrows shipped ability icons for the kit and the Attack art for slot 0', () => {
    const state = createMorthenActionBarView().tick(player(), null, keys);
    expect(state.slots.map((slot) => slot.iconKey)).toEqual([
      'attack',
      'oath_chain',
      'psychic_scream',
      'raise_skeletal_warrior',
    ]);
  });

  it('shows a running cooldown with its digits and sweep', () => {
    const state = createMorthenActionBarView().tick(
      player({ cooldowns: new Map([['gshift_sextons_chain', 9]]) }),
      null,
      keys,
    );
    const chain = state.slots[1];
    expect(chain.cooldownRemaining).toBe(9);
    expect(chain.cooldownTotal).toBe(18);
    expect(chain.cooldownPercent).toBe(50);
    expect(chain.cdText).toBe('9');
    expect(state.slots[2].cooldownPercent).toBe(0);
  });

  it('sweeps the global cooldown on every kit ability but never on Attack', () => {
    expect(MORTHEN_KIT.every((def) => !def.offGcd)).toBe(true);
    const state = createMorthenActionBarView().tick(player({ gcdRemaining: 0.75 }), null, keys);
    const [attack, ...kit] = state.slots;
    for (const slot of kit) {
      expect(slot.cooldownTotal).toBe(GCD);
      expect(slot.cooldownPercent).toBe(50);
      expect(slot.cdText).toBe('');
    }
    expect(attack.cooldownPercent).toBe(0);
  });

  it('keeps the longer of the cooldown and the GCD', () => {
    const state = createMorthenActionBarView().tick(
      player({ gcdRemaining: 1, cooldowns: new Map([['gshift_raise_fallen', 7.5]]) }),
      null,
      keys,
    );
    expect(state.slots[3].cooldownRemaining).toBe(7.5);
    expect(state.slots[3].cooldownPercent).toBe(50);
  });

  it('greys targeted abilities without a living target and tints them out of range', () => {
    const view = createMorthenActionBarView();
    let state = view.tick(player(), null, keys);
    expect(state.slots[1].usable).toBe(false);
    expect(state.slots[2].usable).toBe(true);
    expect(state.slots[3].usable).toBe(true);

    state = view.tick(player(), target(30), keys);
    expect(state.slots[1].usable).toBe(true);
    expect(state.slots[1].outOfRange).toBe(true);
    expect(state.slots[2].outOfRange).toBe(false);
    expect(state.slots[3].outOfRange).toBe(false);

    state = view.tick(player(), target(22), keys);
    expect(state.slots[1].outOfRange).toBe(false);
    expect(state.slots[0].outOfRange).toBe(true);

    state = view.tick(player(), target(4), keys);
    expect(state.slots[0].outOfRange).toBe(false);
    expect(state.slots[1].outOfRange).toBe(false);

    state = view.tick(player(), target(4, { dead: true }), keys);
    expect(state.slots[1].usable).toBe(false);
  });

  it('marks the Attack slot active while auto-attack runs and greys everything when dead', () => {
    const view = createMorthenActionBarView();
    expect(view.tick(player({ autoAttack: true }), null, keys).slots[0].queued).toBe(true);
    const dead = view.tick(player({ dead: true }), target(4), keys);
    expect(dead.slots.every((slot) => !slot.usable)).toBe(true);
  });

  it('resolves the slot prose once per language, never on every tick', () => {
    const describeAbility = vi.mocked(graveyardShiftAbilityDescription);
    const view = createMorthenActionBarView();
    describeAbility.mockClear();
    const first = view.tick(player(), null, keys).slots[1].ariaDescription;
    expect(describeAbility).toHaveBeenCalledTimes(MORTHEN_KIT.length);
    view.tick(player({ gcdRemaining: 1 }), target(3), keys);
    view.tick(player({ resource: 0 }), null, keys);
    expect(describeAbility).toHaveBeenCalledTimes(MORTHEN_KIT.length);
    expect(view.tick(player(), null, keys).slots[1].ariaDescription).toBe(first);
    setLanguage('de_DE');
    try {
      view.tick(player(), null, keys);
      expect(describeAbility).toHaveBeenCalledTimes(MORTHEN_KIT.length * 2);
    } finally {
      setLanguage('en');
    }
  });

  it('reuses the same state object and slot array every tick', () => {
    const view = createMorthenActionBarView();
    const first = view.tick(player(), null, keys);
    const second = view.tick(player({ gcdRemaining: 1 }), target(3), keys);
    expect(second).toBe(first);
    expect(second.slots).toBe(first.slots);
  });

  it('builds the tooltip from the kit: range, cast, cooldown and the resolved prose', () => {
    const pulse = morthenSlotTooltipHtml(2);
    expect(pulse).toContain('Shadow Pulse');
    expect(pulse).toContain('2 sec cast');
    expect(pulse).toContain('10 sec cooldown');
    expect(pulse).toContain('24 to 36 Shadow damage');
    expect(pulse).not.toContain('yd range');
    expect(pulse).not.toContain('barrow');
    expect(morthenSlotTooltipHtml(2, 1)).toContain('1 sec cast');
    const chain = morthenSlotTooltipHtml(1);
    expect(chain).toContain('Chain</div>');
    expect(chain).toContain('Instant');
    expect(chain).toContain('25 yd range');
    expect(chain).toContain('silenced for 2 sec');
    const raise = morthenSlotTooltipHtml(3);
    expect(raise).toContain('15 sec cooldown');
    expect(raise).toContain('within 20 yards');
    expect(raise).toContain('for 20 sec');
    expect(morthenSlotTooltipHtml(0)).toContain('Attack');
    for (let slot = 0; slot < 4; slot++)
      expect(morthenSlotTooltipHtml(slot)).not.toMatch(/gshift_/);
  });
});

describe('morthen slot routing', () => {
  function world(identity: boolean, autoAttack = false) {
    return {
      player: {
        auras: identity ? [morthenIdentityAura(1)] : [],
        autoAttack,
      } as never,
      entities: new Map(),
      castAbility: vi.fn(),
      startAutoAttack: vi.fn(),
      stopAutoAttack: vi.fn(),
    };
  }

  it('is active only while the player holds the identity aura', () => {
    expect(morthenControlsActive(world(true))).toBe(true);
    expect(morthenControlsActive(world(false))).toBe(false);
    expect(morthenControlsActive({})).toBe(false);
  });

  it('casts the kit by id from slots 1 to 3', () => {
    const w = world(true);
    for (let slot = 1; slot <= 3; slot++) morthenChooseSlot(w, slot);
    expect(w.castAbility.mock.calls.map(([id]) => id)).toEqual(MORTHEN_KIT.map((def) => def.id));
    morthenChooseSlot(w, 4);
    expect(w.castAbility).toHaveBeenCalledTimes(3);
  });

  it('toggles auto-attack from slot 0', () => {
    const idle = world(true, false);
    morthenChooseSlot(idle, 0);
    expect(idle.startAutoAttack).toHaveBeenCalledTimes(1);
    expect(idle.stopAutoAttack).not.toHaveBeenCalled();
    const swinging = world(true, true);
    morthenChooseSlot(swinging, 0);
    expect(swinging.stopAutoAttack).toHaveBeenCalledTimes(1);
    expect(swinging.startAutoAttack).not.toHaveBeenCalled();
  });

  it('does nothing without the identity', () => {
    const w = world(false);
    morthenChooseSlot(w, 0);
    morthenChooseSlot(w, 1);
    expect(w.castAbility).not.toHaveBeenCalled();
    expect(w.startAutoAttack).not.toHaveBeenCalled();
  });
});
