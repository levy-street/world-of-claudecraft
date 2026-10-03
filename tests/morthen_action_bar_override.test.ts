// The Graveyard Shift kit rides the NORMAL action bar and the pad's cross
// hotbar as a possess-bar override: every surface shows and casts it, and the
// player's own saved layouts never change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CROSS_HOTBAR_ATTACK_ID, CROSS_HOTBAR_PRIMARY_SET } from '../src/game/cross_hotbar';
import { CrossHotbarBindings } from '../src/game/cross_hotbar_bindings';
import { GP } from '../src/game/gamepad_map';
import {
  morthenActionBarOverride,
  morthenControlsActive,
  morthenCrossHotbarOverride,
} from '../src/game/morthen_controls';
import { MORTHEN_KIT } from '../src/sim/graveyard_shift/kit';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';
import { graveyardShiftIconId } from '../src/ui/graveyard_shift_icons_core';
import { ActionBarController } from '../src/ui/hud/action_bar/action_bar_controller';
import { overrideActionForSlot } from '../src/ui/hud/action_bar/action_bar_override_core';
import {
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import { EMPTY_TEST_WORLD } from './sim_shared';

const KIT_IDS = MORTHEN_KIT.map((def) => def.id);
const morthen = { auras: [morthenIdentityAura(1)] as Aura[] };
const plain = { auras: [] as Aura[] };

describe('the Morthen override providers', () => {
  it('stand in only while the identity is worn', () => {
    expect(morthenControlsActive({ player: morthen })).toBe(true);
    expect(morthenActionBarOverride(plain)).toBeNull();
    expect(morthenCrossHotbarOverride(plain)).toBeNull();
    expect(morthenActionBarOverride(undefined)).toBeNull();
  });

  it('hand out one prebuilt kit, so a per-frame read allocates nothing', () => {
    expect(morthenActionBarOverride(morthen)).toBe(morthenActionBarOverride(morthen));
    expect(morthenCrossHotbarOverride(morthen)).toBe(morthenCrossHotbarOverride(morthen));
  });

  it('lay the kit after the Attack toggle on both bars, in kit order', () => {
    const bar = morthenActionBarOverride(morthen)!;
    expect([0, 1, 2, 3, 4].map((slot) => overrideActionForSlot(bar, slot)?.id ?? null)).toEqual([
      null,
      ...KIT_IDS,
      null,
    ]);
    const pad = morthenCrossHotbarOverride(morthen)!;
    expect(pad[CROSS_HOTBAR_PRIMARY_SET].slice(0, 5).map((cell) => cell?.id ?? null)).toEqual([
      CROSS_HOTBAR_ATTACK_ID,
      ...KIT_IDS,
      null,
    ]);
  });

  it('borrow shipped icon art for every kit ability and leave other ids alone', () => {
    for (const id of KIT_IDS) expect(graveyardShiftIconId(id)).not.toBe(id);
    expect(graveyardShiftIconId('fireball')).toBe('fireball');
  });
});

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    store: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
}

describe('the action bar under the override', () => {
  function controller(known: () => readonly string[], identity: { on: boolean }) {
    const { data, store } = storage();
    const persistLayout = vi.fn();
    const bar = new ActionBarController({
      storage: store,
      playerClass: 'mage',
      playerName: 'Owner',
      playerLevel: () => 20,
      knownAbilityIds: known,
      talentSpec: () => 'fire',
      hasAura: () => false,
      showAttackButton: () => false,
      persistLayout,
      override: () => morthenActionBarOverride(identity.on ? morthen : plain),
    });
    bar.init();
    return { bar, data, persistLayout };
  }

  it('shows the kit on slots 1 to 3, Attack on slot 0 and nothing after', () => {
    const identity = { on: false };
    const { bar } = controller(() => ['fireball', 'frostbolt'], identity);
    bar.replaceActions([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frostbolt' },
    ]);
    bar.saveActions();
    expect(bar.isAttackSlotFixed()).toBe(false);
    identity.on = true;
    expect(bar.overridden).toBe(true);
    expect(bar.isAttackSlotFixed()).toBe(true);
    expect([1, 2, 3, 4].map((slot) => bar.actionForSlot(slot)?.id ?? null)).toEqual([
      ...KIT_IDS,
      null,
    ]);
  });

  it('never writes the kit, a prune or an edit into the saved layout, then gives it back', () => {
    const identity = { on: false };
    let known: readonly string[] = ['fireball', 'frostbolt'];
    const { bar, data, persistLayout } = controller(() => known, identity);
    bar.replaceActions([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frostbolt' },
    ]);
    bar.saveActions();
    const saved = JSON.stringify([...data]);
    persistLayout.mockClear();
    identity.on = true;
    // On shift the known list is the kit alone: a sync must not prune the bar.
    known = KIT_IDS;
    bar.syncKnownAbilities();
    bar.replaceActions([{ type: 'ability', id: KIT_IDS[0] }]);
    bar.saveActions();
    bar.replaceAttackAction({ type: 'ability', id: KIT_IDS[1] });
    bar.saveAttackAction();
    expect(JSON.stringify([...data])).toBe(saved);
    expect(persistLayout).not.toHaveBeenCalled();
    identity.on = false;
    known = ['fireball', 'frostbolt'];
    expect(bar.actionForSlot(1)).toEqual({ type: 'ability', id: 'fireball' });
    expect(bar.actionForSlot(2)).toEqual({ type: 'ability', id: 'frostbolt' });
  });
});

describe('the kit on the real bar view', () => {
  it('prices Shadow Pulse in Dread, paints it unusable short of the cost and keys its icon by id', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      offlineHost: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(10);
    sim.chat('/dev graveyardshift start');
    const override = morthenActionBarOverride(sim.player)!;
    const view = createActionBarView(
      {
        slots: [1, 2, 3].map((slotIndex) => ({
          slotIndex,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => {
            const action = overrideActionForSlot(override, slotIndex);
            return action ? sim.resolvedAbility(action.id) : null;
          },
          item: () => null,
          keybindLabel: () => String(slotIndex + 1),
        })),
      },
      {
        t: (key) => key,
        abilityName: (def) => def.id,
        itemName: (item) => item.id,
        slotLabel: (i) => String(i + 1),
        formatCount: (n) => String(n),
      },
    );
    const input = (resource: number): ActionBarWorldInput => ({
      player: { ...sim.player, resource, cooldowns: new Map(), gcdRemaining: 0 },
      target: null,
      inventory: [],
      stealthed: false,
      entities: [],
      activeAimSlot: null,
    });
    expect(sim.player.resourceType).toBe('dread');
    const short = view.tick(input(24)).slots;
    expect(short.map((slot) => slot.abilityId)).toEqual(KIT_IDS);
    expect(short[1].usable).toBe(false);
    expect(short[2].usable).toBe(true);
    expect(view.tick(input(25)).slots[1].usable).toBe(true);
    expect(short[1].iconKey).toMatch(/gshift_shadow_pulse$/);
  });
});

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  return map;
}

describe('the cross hotbar under the override', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it('shows and casts the kit, freezes every writer, then gives the stored layout back', () => {
    const bindings = new CrossHotbarBindings('char:test');
    bindings.seedOnce([{ type: 'ability', id: 'fireball' }]);
    const before = JSON.stringify([...store]);
    let on = true;
    bindings.setOverride(() => morthenCrossHotbarOverride(on ? morthen : plain));
    expect(bindings.overridden()).toBe(true);
    const shown = bindings.setActions(CROSS_HOTBAR_PRIMARY_SET).slice(0, 4);
    expect(shown.map((cell) => cell?.id)).toEqual([CROSS_HOTBAR_ATTACK_ID, ...KIT_IDS]);
    expect(bindings.all()).toBe(morthenCrossHotbarOverride(morthen));
    // The press resolves against the kit: some left-layer button casts Shadow Pulse.
    const pressed = Object.values(GP)
      .map((button) => bindings.actionFor(CROSS_HOTBAR_PRIMARY_SET, 'left', button)?.id)
      .filter(Boolean);
    expect(pressed).toContain('gshift_shadow_pulse');
    bindings.bind(0, 5, { type: 'ability', id: 'gshift_raise_fallen' });
    bindings.swap(0, 0, 0, 1);
    bindings.syncKnown(['gshift_sextons_chain']);
    bindings.reset();
    expect(JSON.stringify([...store])).toBe(before);
    on = false;
    expect(bindings.overridden()).toBe(false);
    expect(bindings.setActions(CROSS_HOTBAR_PRIMARY_SET)[0]).toEqual({
      type: 'ability',
      id: 'fireball',
    });
  });
});
