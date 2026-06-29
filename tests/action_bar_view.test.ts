// Pure-core tests for the action-bar view. Cover: the four slot kinds
// classify correctly; the cooldown / usable / range / queued math; the aria-label is
// resolved IN the core via the injected t() (Top risk 4); the returned array + slot
// objects are REUSED across ticks (the canonical allocation proxy); a second
// descriptor yields an INDEPENDENT view; and the ClientWorld-vs-Sim
// parity drives both world shapes to identical output.

import { describe, expect, it, vi } from 'vitest';
import { type AbilityDef, type ItemDef, MELEE_RANGE } from '../src/sim/types';
import {
  ABILITY_ICON_PREFIX,
  type ActionBarAbility,
  type ActionBarDeps,
  type ActionBarDescriptor,
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  ATTACK_ICON_KEY,
  createActionBarView,
  EMPTY_ICON_KEY,
  ITEM_ICON_PREFIX,
} from '../src/ui/action_bar_view';
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

function item(id: string): ItemDef {
  return { id } as unknown as ItemDef;
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
    isAttack: opts.attack ?? false,
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
  queuedOnSwing?: string | null;
  playerPos?: { x: number; y: number; z: number };
  targetPos?: { x: number; y: number; z: number } | null;
  targetDead?: boolean;
  inventory?: { itemId: string; count: number }[];
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
      queuedOnSwing: opts.queuedOnSwing ?? null,
      pos: opts.playerPos ?? { x: 0, y: 0, z: 0 },
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

  it('a range-0 targeted ability falls back to MELEE_RANGE for the range check', () => {
    const view = createActionBarView(
      descriptor(slot(1, { ability: ability('rend', { requiresTarget: true, range: 0 }) })),
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
      slot(2, { item: item('potion') }),
    );
    // Sim builds cooldowns directly as a Map and inventory as InvSlot objects.
    const simWorld = world({
      resource: 50,
      cooldowns: new Map([['fireball', 3]]),
      targetPos: { x: 1, y: 1, z: 1 },
      inventory: [{ itemId: 'potion', count: 2 }],
    });
    // ClientWorld mirrors a snapshot: cooldowns rebuilt from Object.entries of the
    // wire `cds` blob, inventory rebuilt from the snapshot `inv` array (online.ts).
    const clientWorld = world({
      resource: 50,
      cooldowns: new Map(Object.entries({ fireball: 3 }).map(([k, v]) => [k, Number(v)])),
      targetPos: { x: 1, y: 1, z: 1 },
      inventory: [...[{ itemId: 'potion', count: 2 }]],
    });
    const simState = structuredClone(createActionBarView(desc, fakeDeps()).tick(simWorld));
    const clientState = structuredClone(createActionBarView(desc, fakeDeps()).tick(clientWorld));
    expect(clientState).toEqual(simState);
  });
});
