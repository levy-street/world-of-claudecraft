// Pure-core tests for the action-bar view. Cover: the four slot kinds
// classify correctly; the cooldown / usable / range / queued math; the aria-label is
// resolved IN the core via the injected t() (Top risk 4); the returned array + slot
// objects are REUSED across ticks (the canonical allocation proxy); a second
// descriptor yields an INDEPENDENT view; and the ClientWorld-vs-Sim
// parity drives both world shapes to identical output.

import { describe, expect, it, vi } from 'vitest';
import { type AbilityDef, type Aura, type ItemDef, MELEE_RANGE } from '../src/sim/types';
import {
  ABILITY_ICON_PREFIX,
  type ActionBarAbility,
  type ActionBarAuraInput,
  type ActionBarDeps,
  type ActionBarDescriptor,
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  ATTACK_ICON_KEY,
  createActionBarView,
  EMPTY_ICON_KEY,
  ITEM_ICON_PREFIX,
} from '../src/ui/hud/action_bar/action_bar_view';
import { t as realT } from '../src/ui/i18n';
import { assertAllocationStable } from './util/alloc_probe';

function ability(id: string, opts: Partial<AbilityDef> & { cost?: number } = {}): ActionBarAbility {
  const def = {
    id,
    offGcd: false,
    cooldown: 6,
    requiresTarget: false,
    range: 0,
    ...opts,
  } as unknown as AbilityDef;
  return { def, cost: opts.cost ?? 0 };
}

function item(id: string, kind?: string): ItemDef {
  return { id, kind } as unknown as ItemDef;
}

interface SlotOpts {
  attack?: boolean;
  ability?: ActionBarAbility | null;
  item?: ItemDef | null;
  keybind?: string;
  // Override the raw-binding presence to exercise the unresolvable-binding edge
  // (an assigned slot whose ability/item does not resolve); defaults to "bound iff
  // an ability or item resolves".
  hasAction?: boolean;
}

function slot(slotIndex: number, opts: SlotOpts = {}): ActionBarSlotDescriptor {
  return {
    slotIndex,
    isAttack: () => opts.attack ?? false,
    hasAction: () => opts.hasAction ?? (opts.ability != null || opts.item != null),
    ability: () => opts.ability ?? null,
    item: () => opts.item ?? null,
    keybindLabel: () => opts.keybind ?? `K${slotIndex}`,
  };
}

function descriptor(...slots: ActionBarSlotDescriptor[]): ActionBarDescriptor {
  return { slots };
}

function fakeDeps(): ActionBarDeps {
  return {
    t: (key, values) =>
      values
        ? `${key}(${Object.entries(values)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')})`
        : key,
    abilityName: (def) => `ability:${def.id}`,
    itemName: (i) => `item:${i.id}`,
    slotLabel: (slotIndex) => `${slotIndex + 1}`,
    formatCount: (n) => String(n),
  };
}

interface WorldOpts {
  autoAttack?: boolean;
  dead?: boolean;
  resource?: number;
  cooldowns?: Map<string, number>;
  gcdRemaining?: number;
  potionCdRemaining?: number;
  queuedOnSwing?: string | null;
  playerPos?: { x: number; y: number; z: number };
  targetPos?: { x: number; y: number; z: number } | null;
  targetDead?: boolean;
  inventory?: { itemId: string; count: number }[];
  abilityCharges?: { [id: string]: { charges: number } | undefined };
  stealthed?: boolean;
  auras?: ActionBarAuraInput[];
}

function world(opts: WorldOpts = {}): ActionBarWorldInput {
  const targetPos = opts.targetPos === undefined ? null : opts.targetPos;
  return {
    player: {
      autoAttack: opts.autoAttack ?? false,
      dead: opts.dead ?? false,
      resource: opts.resource ?? 100,
      cooldowns: opts.cooldowns ?? new Map(),
      gcdRemaining: opts.gcdRemaining ?? 0,
      potionCdRemaining: opts.potionCdRemaining ?? 0,
      queuedOnSwing: opts.queuedOnSwing ?? null,
      pos: opts.playerPos ?? { x: 0, y: 0, z: 0 },
      abilityCharges: opts.abilityCharges,
      stealthed: opts.stealthed ?? false,
      auras: opts.auras ?? [],
    },
    target: targetPos === null ? null : { dead: opts.targetDead ?? false, pos: targetPos },
    inventory: opts.inventory ?? [],
  };
}

describe('actionBarView: the four slot kinds classify correctly', () => {
  it('attack / ability / item / empty each get the right kind, icon key, and ids', () => {
    const view = createActionBarView(
      descriptor(
        slot(0, { attack: true }),
        slot(1, { ability: ability('fireball') }),
        slot(2, { item: item('potion') }),
        slot(3, {}),
      ),
      fakeDeps(),
    );
    const s = view.tick(world()).slots;

    expect(s[0].kind).toBe('attack');
    expect(s[0].iconKey).toBe(ATTACK_ICON_KEY);
    expect(s[0].abilityId).toBeNull();
    expect(s[0].itemId).toBeNull();

    expect(s[1].kind).toBe('ability');
    expect(s[1].iconKey).toBe(`${ABILITY_ICON_PREFIX}fireball`);
    expect(s[1].abilityId).toBe('fireball');

    expect(s[2].kind).toBe('item');
    expect(s[2].iconKey).toBe(`${ITEM_ICON_PREFIX}potion`);
    expect(s[2].itemId).toBe('potion');

    expect(s[3].kind).toBe('empty');
    expect(s[3].iconKey).toBe(EMPTY_ICON_KEY);
    expect(s[3].abilityId).toBeNull();
    expect(s[3].itemId).toBeNull();
  });

  it('slot 0 stops being Attack when isAttack() is false, rendering its assigned action', () => {
    // The removable Attack button: with "Show Attack Button" off, the HUD makes
    // slot 0's isAttack() return false and actionForSlot(0) resolve the assigned
    // action, so the first slot renders as a normal ability slot, not Attack.
    const view = createActionBarView(
      descriptor(slot(0, { attack: false, ability: ability('frostbolt') })),
      fakeDeps(),
    );
    const s = view.tick(world()).slots;
    expect(s[0].kind).toBe('ability');
    expect(s[0].iconKey).toBe(`${ABILITY_ICON_PREFIX}frostbolt`);
    expect(s[0].abilityId).toBe('frostbolt');
  });

  it('slot 0 honors the live isAttack() accessor across ticks (toggle on/off)', () => {
    // The Interface toggle flips slot 0 between Attack and a normal slot at runtime
    // with no rebuild; the view must consult the accessor every tick, not cache it.
    let showAttack = true;
    const s0: ActionBarSlotDescriptor = {
      slotIndex: 0,
      isAttack: () => showAttack,
      hasAction: () => !showAttack,
      ability: () => (showAttack ? null : ability('fireball')),
      item: () => null,
      keybindLabel: () => 'K0',
    };
    const view = createActionBarView(descriptor(s0), fakeDeps());
    expect(view.tick(world()).slots[0].kind).toBe('attack');
    showAttack = false;
    const off = view.tick(world()).slots[0];
    expect(off.kind).toBe('ability');
    expect(off.abilityId).toBe('fireball');
    showAttack = true;
    expect(view.tick(world()).slots[0].kind).toBe('attack');
  });

  it('an item slot wins over a stale ability binding (item-first precedence)', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('fireball'), item: item('potion') })),
      fakeDeps(),
    );
    expect(view.tick(world()).slots[1 - 1].kind).toBe('item');
  });
});

describe('actionBarView: ability cooldown / usable / range / queued math', () => {
  it('cooldown sweep is clamped, the countdown shows above one second', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('frostbolt', { cooldown: 6 }) })),
      fakeDeps(),
    );
    const s = view.tick(world({ cooldowns: new Map([['frostbolt', 3]]) })).slots[0];
    expect(s.cooldownRemaining).toBe(3);
    expect(s.cooldownTotal).toBe(6);
    expect(s.cooldownPercent).toBeCloseTo(50);
    expect(s.cdText).toBe('3');
  });

  it('the GCD sweep uses the GCD denominator and shows no countdown', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('smite', { cooldown: 0, offGcd: false }) })),
      fakeDeps(),
    );
    const s = view.tick(world({ gcdRemaining: 1.5 })).slots[0];
    expect(s.cooldownPercent).toBeCloseTo(100);
    expect(s.cdText).toBe('');
  });

  it('off-GCD abilities ignore the GCD sweep', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('berserk', { cooldown: 0, offGcd: true }) })),
      fakeDeps(),
    );
    const s = view.tick(world({ gcdRemaining: 1.5 })).slots[0];
    expect(s.cooldownPercent).toBe(0);
  });

  it('usable reflects resource >= cost; out-of-range needs a target past range', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('pyro', { cost: 50, requiresTarget: true, range: 5 }) }),
      ),
      fakeDeps(),
    );
    const far = view.tick(world({ resource: 40, targetPos: { x: 100, y: 100, z: 100 } })).slots[0];
    expect(far.usable).toBe(false);
    expect(far.outOfRange).toBe(true);

    const near = view.tick(world({ resource: 60, targetPos: { x: 1, y: 1, z: 1 } })).slots[0];
    expect(near.usable).toBe(true);
    expect(near.outOfRange).toBe(false);
  });

  it('a requiresStealth ability is usable only while the player is stealthed (issue #1890)', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('cheap_shot', { cost: 60, requiresStealth: true }) })),
      fakeDeps(),
    );
    const outOfStealth = view.tick(world({ stealthed: false })).slots[0];
    expect(outOfStealth.usable).toBe(false);

    const inStealth = view.tick(world({ stealthed: true })).slots[0];
    expect(inStealth.usable).toBe(true);
  });

  it('an ability with no stealth requirement ignores the stealthed flag', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('sinister_strike', { cost: 45 }) })),
      fakeDeps(),
    );
    expect(view.tick(world({ stealthed: false })).slots[0].usable).toBe(true);
    expect(view.tick(world({ stealthed: true })).slots[0].usable).toBe(true);
  });

  it('respects both range boundaries for an ability with a minimum range', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, {
          ability: ability('charge', { requiresTarget: true, range: 25, minRange: 8 }),
        }),
      ),
      fakeDeps(),
    );
    // Snapshot each primitive: the core reuses the slot object across ticks.
    const tooClose = view.tick(world({ targetPos: { x: 5, y: 0, z: 0 } })).slots[0].outOfRange;
    const atMinimum = view.tick(world({ targetPos: { x: 8, y: 0, z: 0 } })).slots[0].outOfRange;
    const atMaximum = view.tick(world({ targetPos: { x: 25, y: 0, z: 0 } })).slots[0].outOfRange;
    const tooFar = view.tick(world({ targetPos: { x: 26, y: 0, z: 0 } })).slots[0].outOfRange;

    expect(tooClose).toBe(true);
    expect(atMinimum).toBe(false);
    expect(atMaximum).toBe(false);
    expect(tooFar).toBe(true);
  });

  it('a range-0 targeted ability falls back to MELEE_RANGE for the range check', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('mortal_strike', { requiresTarget: true, range: 0 }) }),
      ),
      fakeDeps(),
    );
    // range 0 -> the out-of-range check uses MELEE_RANGE (dist2d is on the x/z plane).
    // Snapshot the primitive each tick: the core reuses the slot object across ticks.
    const far = view.tick(world({ targetPos: { x: MELEE_RANGE + 1, y: 0, z: 0 } })).slots[0]
      .outOfRange;
    const near = view.tick(world({ targetPos: { x: MELEE_RANGE - 2, y: 0, z: 0 } })).slots[0]
      .outOfRange;
    expect(far).toBe(true);
    expect(near).toBe(false);
  });

  it('a dead target yields no distance, so a ranged ability never reads out of range', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('pyro', { requiresTarget: true, range: 5 }) })),
      fakeDeps(),
    );
    // The target is well past range BUT dead: tgtDist is null (dead targets are
    // ignored, matching the old `target && !target.dead`), so oor never fires.
    const s = view.tick(world({ targetPos: { x: 100, y: 0, z: 100 }, targetDead: true })).slots[0];
    expect(s.outOfRange).toBe(false);
    expect(s.usable).toBe(true);
  });

  it('a non-targeted ability ignores range entirely even with a far target', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('renew', { requiresTarget: false, range: 0 }) })),
      fakeDeps(),
    );
    const s = view.tick(world({ targetPos: { x: 100, y: 0, z: 100 } })).slots[0];
    expect(s.outOfRange).toBe(false);
  });

  it('cooldown active AND gcd active: the sweep tracks max(cd, gcd) over the cooldown denom', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('frostbolt', { cooldown: 6, offGcd: false }) })),
      fakeDeps(),
    );
    // On its own 2s cooldown while a 4s GCD still runs: shown = max(2, 4) = 4, the
    // denom stays the ability cooldown (6, because cd > 0), and the countdown text
    // reflects the ability cooldown (2), byte-identical to the old inline block.
    const s = view.tick(world({ cooldowns: new Map([['frostbolt', 2]]), gcdRemaining: 4 }))
      .slots[0];
    expect(s.cooldownTotal).toBe(6);
    expect(s.cooldownPercent).toBeCloseTo((4 / 6) * 100);
    expect(s.cdText).toBe('2');
  });

  it('queued reflects the swing-queued ability id', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('heroicStrike') })),
      fakeDeps(),
    );
    expect(view.tick(world({ queuedOnSwing: 'heroicStrike' })).slots[0].queued).toBe(true);
    expect(view.tick(world({ queuedOnSwing: null })).slots[0].queued).toBe(false);
  });

  it('marks only scoped empowered abilities when a next-cast aura names ability ids', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('holy_fire', { cost: 10 }) }),
        slot(2, { ability: ability('smite', { cost: 10 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(
      world({
        auras: [
          {
            kind: 'next_cast_free',
            value: 0,
            empowerAbilities: ['holy_fire'],
          },
        ],
      }),
    );

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
  });

  it('glows ONLY the free-proc-scoped abilities, not every button', () => {
    // A Hot Streak / Aether Rush style next_cast_free names its spenders; only
    // those slots may show the gold proc glow (freeCostAuraActive is scoped).
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('pyroblast', { cost: 20 }) }),
        slot(2, { ability: ability('fireball', { cost: 20 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(
      world({
        auras: [{ kind: 'next_cast_free', value: 0, empowerAbilities: ['pyroblast'] }],
      }),
    );
    expect(state.slots[0].procGlow).toBe(true); // named -> glows
    expect(state.slots[1].procGlow).toBe(false); // not named -> no glow
  });

  it('lets unscoped next-cast auras empower every eligible ability slot', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('fire_blast', { cost: 20 }) }),
        slot(2, { ability: ability('battle_shout', { cost: 0 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(world({ auras: [{ kind: 'next_cast_free', value: 0 }] }));

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
  });

  it('marks instant empowerment only on non-physical cast-time non-channel abilities', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, {
          ability: ability('fireball', { cost: 20, castTime: 2.5, school: 'fire' }),
        }),
        slot(2, {
          ability: ability('arcane_missiles', {
            cost: 20,
            castTime: 0,
            channel: { duration: 3, ticks: 3 },
            school: 'arcane',
          }),
        }),
        slot(3, {
          ability: ability('slam', { cost: 20, castTime: 1.5, school: 'physical' }),
        }),
      ),
      fakeDeps(),
    );
    const state = view.tick(world({ auras: [{ kind: 'next_cast_instant', value: 0 }] }));

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
    expect(state.slots[2].empowered).toBe(false);
  });
});

describe('actionBarView: free-cost proc glow + kill-window (procGlow / usable)', () => {
  it('a Battle Trance proc glows and frees exactly the scoped abilities at zero rage', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('heroic_strike', { cost: 15 }) }),
        slot(2, { ability: ability('hamstring', { cost: 10 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(world({ resource: 0, auras: [{ kind: 'battle_trance' }] }));
    // The covered ability is pressable and glows even with an empty rage bar.
    expect(state.slots[0].procGlow).toBe(true);
    expect(state.slots[0].usable).toBe(true);
    // The out-of-scope ability still needs rage and never glows.
    expect(state.slots[1].procGlow).toBe(false);
    expect(state.slots[1].usable).toBe(false);
  });

  it('a scoped next_cast_free proc glows only the ability it covers', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('mortal_strike', { cost: 30 }) }),
        slot(2, { ability: ability('rend', { cost: 10 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(
      world({
        resource: 0,
        auras: [{ kind: 'next_cast_free', empowerAbilities: ['mortal_strike'] }],
      }),
    );
    expect(state.slots[0].procGlow).toBe(true);
    expect(state.slots[0].usable).toBe(true);
    expect(state.slots[1].procGlow).toBe(false);
    expect(state.slots[1].usable).toBe(false);
  });

  it('a 0-cost ability never lights the free-cost glow', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('battle_shout', { cost: 0 }) })),
      fakeDeps(),
    );
    const state = view.tick(world({ auras: [{ kind: 'next_cast_free' }] }));
    expect(state.slots[0].procGlow).toBe(false);
  });

  it('a kill-window ability (requiresAuraKind) is usable and glows only while armed', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, {
          ability: ability('victory_rush', { cost: 0, requiresAuraKind: 'victory_rush' }),
        }),
      ),
      fakeDeps(),
    );
    const closed = view.tick(world()).slots[0];
    expect(closed.usable).toBe(false);
    expect(closed.procGlow).toBe(false);
    const open = view.tick(world({ auras: [{ kind: 'victory_rush' }] })).slots[0];
    expect(open.usable).toBe(true);
    expect(open.procGlow).toBe(true);
  });
});

describe('actionBarView: next-cast empowerment highlight (empowered)', () => {
  it('marks only scoped empowered abilities when a next-cast aura names ability ids', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('holy_fire', { cost: 10 }) }),
        slot(2, { ability: ability('smite', { cost: 10 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(
      world({
        auras: [
          {
            kind: 'next_cast_free',
            value: 0,
            empowerAbilities: ['holy_fire'],
          },
        ],
      }),
    );

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
  });

  it('lets unscoped next-cast auras empower every eligible ability slot', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, { ability: ability('fire_blast', { cost: 20 }) }),
        slot(2, { ability: ability('battle_shout', { cost: 0 }) }),
      ),
      fakeDeps(),
    );
    const state = view.tick(world({ auras: [{ kind: 'next_cast_free', value: 0 }] }));

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
  });

  it('marks instant empowerment only on non-physical cast-time non-channel abilities', () => {
    const view = createActionBarView(
      descriptor(
        slot(1, {
          ability: ability('fireball', { cost: 20, castTime: 2.5, school: 'fire' }),
        }),
        slot(2, {
          ability: ability('arcane_missiles', {
            cost: 20,
            castTime: 0,
            channel: { duration: 3, ticks: 3 },
            school: 'arcane',
          }),
        }),
        slot(3, {
          ability: ability('slam', { cost: 20, castTime: 1.5, school: 'physical' }),
        }),
      ),
      fakeDeps(),
    );
    const state = view.tick(world({ auras: [{ kind: 'next_cast_instant', value: 0 }] }));

    expect(state.slots[0].empowered).toBe(true);
    expect(state.slots[1].empowered).toBe(false);
    expect(state.slots[2].empowered).toBe(false);
  });
});

describe('actionBarView: attack + item slots', () => {
  it('attack glows while auto-attacking and reddens out of melee range', () => {
    const view = createActionBarView(descriptor(slot(0, { attack: true })), fakeDeps());
    const s = view.tick(world({ autoAttack: true, targetPos: { x: 100, y: 100, z: 100 } }))
      .slots[0];
    expect(s.queued).toBe(true);
    expect(s.outOfRange).toBe(true);
    expect(s.usable).toBe(true);
  });

  it('item count sums the inventory; unusable when none remain or the player is dead', () => {
    const view = createActionBarView(descriptor(slot(1, { item: item('potion') })), fakeDeps());
    const some = view.tick(
      world({
        inventory: [
          { itemId: 'potion', count: 2 },
          { itemId: 'potion', count: 3 },
        ],
      }),
    ).slots[0];
    expect(some.count).toBe('5');
    expect(some.usable).toBe(true);

    const none = view.tick(world({ inventory: [] })).slots[0];
    expect(none.count).toBe('0');
    expect(none.usable).toBe(false);

    const dead = view.tick(world({ dead: true, inventory: [{ itemId: 'potion', count: 1 }] }))
      .slots[0];
    expect(dead.usable).toBe(false);
  });

  it('badges the recharge-model charges (Frost second Ice Block: 1 + bonusCharges)', () => {
    // An ability on the abilityCharges recharge model carries its extra uses as
    // bonusCharges (not the Double Charge Map), so the max is 1 + bonusCharges and the
    // live count comes from player.abilityCharges. This is what Frost's second Ice
    // Block rode, which showed no badge before the fix.
    const iceBlock: ActionBarAbility = { def: ability('ice_block').def, cost: 0, bonusCharges: 1 };
    const view = createActionBarView(descriptor(slot(1, { ability: iceBlock })), fakeDeps());
    // Before any cast (no abilityCharges entry): the full 2 charges show.
    expect(view.tick(world()).slots[0].count).toBe('2');
    // One spent: the live recharge-model count shows 1.
    expect(view.tick(world({ abilityCharges: { ice_block: { charges: 1 } } })).slots[0].count).toBe(
      '1',
    );
    // A single-charge ability (no bonusCharges) still shows no badge.
    const single = createActionBarView(
      descriptor(slot(1, { ability: ability('frostbolt') })),
      fakeDeps(),
    );
    expect(single.tick(world()).slots[0].count).toBe('');
  });

  it('paints the shared potion cooldown swipe on a potion item-slot', () => {
    const view = createActionBarView(
      descriptor(slot(1, { item: item('healing_potion', 'potion') })),
      fakeDeps(),
    );
    // half of the 120s shared cooldown remaining: half-height swipe + ceil text.
    const onCd = view.tick(world({ potionCdRemaining: 60 })).slots[0];
    expect(onCd.kind).toBe('item');
    expect(onCd.cooldownRemaining).toBe(60);
    expect(onCd.cooldownTotal).toBe(120);
    expect(onCd.cooldownPercent).toBe(50);
    expect(onCd.cdText).toBe('60');

    // ready again: no swipe, no text.
    const ready = view.tick(world({ potionCdRemaining: 0 })).slots[0];
    expect(ready.cooldownPercent).toBe(0);
    expect(ready.cdText).toBe('');
  });

  it('does not paint a cooldown on a non-potion item even while the potion timer runs', () => {
    const view = createActionBarView(
      descriptor(slot(1, { item: item('iron_dagger', 'weapon') })),
      fakeDeps(),
    );
    const s = view.tick(world({ potionCdRemaining: 60 })).slots[0];
    expect(s.cooldownPercent).toBe(0);
    expect(s.cooldownRemaining).toBe(0);
  });
});

describe('actionBarView: the aria-label is resolved in the core via the injected t()', () => {
  it('renders the slot aria string through t() for each kind (no concat)', () => {
    const view = createActionBarView(
      descriptor(
        slot(0, { attack: true }),
        slot(1, { ability: ability('fireball') }),
        slot(2, { item: item('potion') }),
        slot(3, {}),
      ),
      fakeDeps(),
    );
    const s = view.tick(world()).slots;
    expect(s[0].ariaLabel).toBe(
      'abilityUi.actionBar.slotAria(slot=1,ability=abilityUi.actionBar.attackName)',
    );
    expect(s[1].ariaLabel).toBe('abilityUi.actionBar.slotAria(slot=2,ability=ability:fireball)');
    expect(s[2].ariaLabel).toBe('abilityUi.actionBar.slotAria(slot=3,ability=item:potion)');
    expect(s[3].ariaLabel).toBe('abilityUi.actionBar.emptySlotAria(slot=4)');
  });

  it('calls the injected t() every tick (the i18n key fires each frame, Top risk 4)', () => {
    const deps = fakeDeps();
    const tSpy = vi.fn(deps.t);
    const view = createActionBarView(
      descriptor(slot(0, { attack: true }), slot(1, { ability: ability('fireball') })),
      { ...deps, t: tSpy },
    );
    view.tick(world());
    const afterFirst = tSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    view.tick(world());
    expect(tSpy.mock.calls.length).toBe(afterFirst * 2);
  });

  it('the rendered i18n keys exist in the real catalog (no untracked-key fallback)', () => {
    const view = createActionBarView(descriptor(slot(0, { attack: true })), {
      ...fakeDeps(),
      t: realT,
    });
    const expected = realT('abilityUi.actionBar.slotAria', {
      slot: '1',
      ability: realT('abilityUi.actionBar.attackName'),
    });
    expect(view.tick(world()).slots[0].ariaLabel).toBe(expected);
    expect(view.tick(world()).slots[0].ariaLabel).not.toContain('abilityUi.actionBar');
  });
});

describe('actionBarView: same input, same output + the many-spells flag', () => {
  it('two ticks with the same world produce deeply-equal state', () => {
    const view = createActionBarView(
      descriptor(slot(0, { attack: true }), slot(1, { ability: ability('fireball') })),
      fakeDeps(),
    );
    const a = view.tick(world({ cooldowns: new Map([['fireball', 2]]) }));
    const snapshot = structuredClone(a);
    const b = view.tick(world({ cooldowns: new Map([['fireball', 2]]) }));
    expect(b).toEqual(snapshot);
  });

  it('many-spells turns on past the threshold of bound slots', () => {
    const bound = (n: number) =>
      descriptor(
        slot(0, { attack: true }),
        ...Array.from({ length: n }, (_, i) => slot(i + 1, { ability: ability(`a${i}`) })),
      );
    expect(createActionBarView(bound(10), fakeDeps()).tick(world()).manySpells).toBe(false);
    expect(createActionBarView(bound(11), fakeDeps()).tick(world()).manySpells).toBe(true);
  });

  it('many-spells counts RAW assigned slots, even unresolvable ones (byte-faithful)', () => {
    // 10 resolved abilities + 1 assigned-but-unresolvable slot (renders empty) ==
    // 11 raw assignments, matching the former hotbarActions.filter(a => a !== null).
    const desc = descriptor(
      slot(0, { attack: true }),
      ...Array.from({ length: 10 }, (_, i) => slot(i + 1, { ability: ability(`a${i}`) })),
      slot(11, { hasAction: true }),
    );
    const state = createActionBarView(desc, fakeDeps()).tick(world());
    expect(state.manySpells).toBe(true);
    expect(state.slots[11].kind).toBe('empty'); // it still RENDERS empty
  });
});

describe('actionBarView: allocation-light (the canonical reused-reference proxy)', () => {
  it('returns the SAME state object, slots array, and slot objects across ticks', () => {
    const view = createActionBarView(
      descriptor(
        slot(0, { attack: true }),
        slot(1, { ability: ability('fireball', { cooldown: 6 }) }),
        slot(2, { item: item('potion') }),
        slot(3, {}),
      ),
      fakeDeps(),
    );
    // The container (the ActionBarState) and its slots array stay identical, and
    // every slot object stays identical, even as the cooldown counts down each tick.
    let frame = 0;
    const tickFrame = () => {
      frame += 1;
      return view.tick(world({ cooldowns: new Map([['fireball', 6 - frame * 0.1]]) }));
    };
    expect(() => assertAllocationStable(tickFrame)).not.toThrow();
    expect(() => assertAllocationStable(() => tickFrame().slots)).not.toThrow();
  });
});

describe('actionBarView: instance-parameterized + parity', () => {
  it('a second descriptor yields an INDEPENDENT view (no shared global state)', () => {
    const a = createActionBarView(descriptor(slot(0, { attack: true })), fakeDeps());
    const b = createActionBarView(
      descriptor(slot(1, { ability: ability('fireball') })),
      fakeDeps(),
    );
    const sa = a.tick(world());
    const sb = b.tick(world());
    expect(sa).not.toBe(sb);
    expect(sa.slots).not.toBe(sb.slots);
    expect(sa.slots[0].kind).toBe('attack');
    expect(sb.slots[0].kind).toBe('ability');
    // Mutating one view's frame does not disturb the other's reused state.
    a.tick(world({ autoAttack: true }));
    expect(b.tick(world()).slots[0].kind).toBe('ability');
  });

  it('a Sim-shaped and a ClientWorld-mirror-shaped world give identical output', () => {
    const desc = descriptor(
      slot(0, { attack: true }),
      slot(1, {
        ability: ability('fireball', { cooldown: 6, requiresTarget: true, range: 5, cost: 30 }),
      }),
      slot(2, { item: item('potion', 'potion') }),
    );
    // Sim builds cooldowns directly as a Map and inventory as InvSlot objects, and
    // materializes potionCdRemaining per tick from potionCooldownUntil.
    const simWorld = world({
      resource: 50,
      cooldowns: new Map([['fireball', 3]]),
      potionCdRemaining: 42,
      targetPos: { x: 1, y: 1, z: 1 },
      inventory: [{ itemId: 'potion', count: 2 }],
    });
    // ClientWorld mirrors a snapshot: cooldowns rebuilt from Object.entries of the
    // wire `cds` blob, inventory rebuilt from the snapshot `inv` array, and
    // potionCdRemaining decoded from the wire `pcd` scalar (online.ts).
    const clientWorld = world({
      resource: 50,
      cooldowns: new Map(Object.entries({ fireball: 3 }).map(([k, v]) => [k, Number(v)])),
      potionCdRemaining: Number('42'),
      targetPos: { x: 1, y: 1, z: 1 },
      inventory: [...[{ itemId: 'potion', count: 2 }]],
    });
    const simState = structuredClone(createActionBarView(desc, fakeDeps()).tick(simWorld));
    const clientState = structuredClone(createActionBarView(desc, fakeDeps()).tick(clientWorld));
    expect(clientState).toEqual(simState);
  });
});
