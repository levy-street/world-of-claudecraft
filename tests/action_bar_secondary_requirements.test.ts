// The action bar greys out a slot whose situational cast requirement is unmet
// (a target above its execute threshold, combat for an out-of-combat ability, no
// combo points for a finisher, the wrong druid form, no shield or dagger worn, no
// Burning Pact for Conflagrate), asking the same predicates
// the sim's cast gate asks. Covers the shared execute-window leaf directly, the
// bar view over the REAL ability defs, and a live Sim proving the bar and the
// gate agree on both sides of the Execute boundary.

import { describe, expect, it } from 'vitest';
import { hasBurningPact } from '../src/sim/combat/destruction';
import {
  effectsRequireDagger,
  shieldEquipped,
  wieldsDagger,
} from '../src/sim/combat/equipment_requirement';
import {
  executeWindowBlocksCast,
  executeWindowBypassed,
  targetOutsideExecuteWindow,
} from '../src/sim/combat/execute_threshold';
import { ABILITIES, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { isShieldItem } from '../src/sim/equipment_rules';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, Entity, EquipSlot, SimEvent } from '../src/sim/types';
import {
  type ActionBarAbility,
  type ActionBarAuraInput,
  type ActionBarDeps,
  type ActionBarWorldInput,
  createActionBarView,
  secondaryRequirementsMet,
} from '../src/ui/hud/action_bar/action_bar_view';

const EXECUTE = ABILITIES.execute;
const DUSKFIRE = ABILITIES.shadowburn;
const HAMMER = ABILITIES.hammer_of_wrath;

function known(def: AbilityDef): ActionBarAbility {
  return { def, cost: 0 };
}

interface WorldOpts {
  targetHp?: number;
  targetMaxHp?: number;
  noTarget?: boolean;
  targetDead?: boolean;
  auras?: ActionBarAuraInput[];
  inCombat?: boolean;
  comboPoints?: number;
  paladinDevotion?: { value: number; ascensionCharges: number; ascensionRemaining: number };
  level?: number;
  equippedItems?: Partial<Record<EquipSlot, string>>;
  targetAuras?: ActionBarAuraInput[];
}

function world(opts: WorldOpts = {}): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 1000,
      resourceType: 'rage',
      savedMana: 0,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
      inCombat: opts.inCombat,
      comboPoints: opts.comboPoints,
      auras: opts.auras ?? [],
      paladinDevotion: opts.paladinDevotion,
      level: opts.level,
      equippedItems: opts.equippedItems,
    },
    target: opts.noTarget
      ? null
      : {
          dead: opts.targetDead ?? false,
          kind: 'mob',
          templateId: 'training_dummy',
          pos: { x: 0, y: 0, z: 2 },
          hp: opts.targetHp,
          maxHp: opts.targetMaxHp,
          auras: opts.targetAuras ?? [],
        },
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot: null,
  };
}

function deps(): ActionBarDeps {
  return {
    t: (key) => key,
    abilityName: (def) => def.id,
    itemName: (i) => i.id,
    slotLabel: (i) => String(i + 1),
    formatCount: (n) => String(n),
  };
}

/** The painted usable flag for one ability in one world, through the real view. */
function usableOnBar(def: AbilityDef, w: ActionBarWorldInput): boolean {
  const view = createActionBarView(
    {
      slots: [
        {
          slotIndex: 1,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => known(def),
          item: () => null,
          keybindLabel: () => '1',
        },
      ],
    },
    deps(),
  );
  return view.tick(w).slots[0].usable;
}

describe('execute window: the shared cast-gate predicate', () => {
  it('reads requiresTargetHpBelow as at-or-below and executeThreshold as strictly below', () => {
    expect(EXECUTE.requiresTargetHpBelow).toBe(0.2);
    expect(DUSKFIRE.executeThreshold).toBe(0.2);
    expect(targetOutsideExecuteWindow(EXECUTE, 200, 1000)).toBe(false);
    expect(targetOutsideExecuteWindow(EXECUTE, 201, 1000)).toBe(true);
    expect(targetOutsideExecuteWindow(DUSKFIRE, 200, 1000)).toBe(true);
    expect(targetOutsideExecuteWindow(DUSKFIRE, 199, 1000)).toBe(false);
  });

  it('never blocks an ability without an execute requirement', () => {
    expect(targetOutsideExecuteWindow(ABILITIES.eviscerate, 1000, 1000)).toBe(false);
  });

  it('opens the window early only for the proc that names the ability', () => {
    const suddenDeath = { auras: [{ kind: 'sudden_death' }] };
    expect(executeWindowBypassed(suddenDeath, 'execute')).toBe(true);
    expect(executeWindowBypassed(suddenDeath, 'shadowburn')).toBe(false);
    expect(
      executeWindowBypassed(
        { auras: [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }] },
        'hammer_of_wrath',
      ),
    ).toBe(true);
    expect(
      executeWindowBypassed(
        { auras: [], paladinDevotion: { ascensionCharges: 2, ascensionRemaining: 10 } },
        'hammer_of_wrath',
      ),
    ).toBe(true);
    expect(
      executeWindowBypassed(
        { auras: [], paladinDevotion: { ascensionCharges: 0, ascensionRemaining: 10 } },
        'hammer_of_wrath',
      ),
    ).toBe(false);
    expect(
      executeWindowBypassed({ auras: [{ kind: 'paladin_dawns_wrath' }] }, 'hammer_of_wrath'),
    ).toBe(true);
    expect(executeWindowBlocksCast(EXECUTE, { auras: [] }, 1000, 1000)).toBe(true);
    expect(executeWindowBlocksCast(EXECUTE, suddenDeath, 1000, 1000)).toBe(false);
  });
});

describe('action bar: greys a slot while its secondary cast requirement is unmet', () => {
  it('greys Execute above 20% target health and lights it at 20%', () => {
    expect(usableOnBar(EXECUTE, world({ targetHp: 900, targetMaxHp: 1000 }))).toBe(false);
    expect(usableOnBar(EXECUTE, world({ targetHp: 201, targetMaxHp: 1000 }))).toBe(false);
    expect(usableOnBar(EXECUTE, world({ targetHp: 200, targetMaxHp: 1000 }))).toBe(true);
    expect(usableOnBar(EXECUTE, world({ targetHp: 50, targetMaxHp: 1000 }))).toBe(true);
  });

  it("keeps Duskfire's strict boundary: grey at exactly 20%, lit below it", () => {
    // Duskfire also spends Ruin, which the bar gates on its own; ask only the
    // secondary-requirement half here.
    const at = (targetHp: number) =>
      secondaryRequirementsMet(world({ targetHp, targetMaxHp: 1000 }), known(DUSKFIRE));
    expect(at(200)).toBe(false);
    expect(at(199)).toBe(true);
    expect(usableOnBar(DUSKFIRE, world({ targetHp: 200, targetMaxHp: 1000 }))).toBe(false);
  });

  it('lights Execute on a healthy target while Sudden Death is worn', () => {
    const w = world({ targetHp: 1000, targetMaxHp: 1000, auras: [{ kind: 'sudden_death' }] });
    expect(usableOnBar(EXECUTE, w)).toBe(true);
  });

  it('lights Hammer of Wrath on a healthy target during Avenging Wrath or Divine Ascension', () => {
    const healthy = { targetHp: 1000, targetMaxHp: 1000 };
    expect(usableOnBar(HAMMER, world(healthy))).toBe(false);
    expect(
      usableOnBar(
        HAMMER,
        world({ ...healthy, auras: [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }] }),
      ),
    ).toBe(true);
    expect(
      usableOnBar(
        HAMMER,
        world({
          ...healthy,
          paladinDevotion: { value: 0, ascensionCharges: 3, ascensionRemaining: 20 },
        }),
      ),
    ).toBe(true);
  });

  it('does not guess without a live target of known health', () => {
    expect(usableOnBar(EXECUTE, world({ noTarget: true }))).toBe(true);
    expect(usableOnBar(EXECUTE, world({ targetDead: true, targetHp: 0, targetMaxHp: 1000 }))).toBe(
      true,
    );
    expect(usableOnBar(EXECUTE, world({ targetMaxHp: 1000 }))).toBe(true);
  });

  it('greys an out-of-combat ability while the player is in combat', () => {
    const stealth = ABILITIES.stealth;
    expect(stealth.requiresOutOfCombat).toBe(true);
    expect(usableOnBar(stealth, world({ inCombat: true }))).toBe(false);
    expect(usableOnBar(stealth, world({ inCombat: false }))).toBe(true);
  });

  it('keeps the Ember Form exit lit in combat, as the gate lets it toggle off', () => {
    const ember = ABILITIES.fireball_form;
    expect(ember.requiresOutOfCombat).toBe(true);
    expect(ember.requiresOutsideInstance).toBe(true);
    expect(usableOnBar(ember, world({ inCombat: true }))).toBe(false);
    const wearing = world({
      inCombat: true,
      auras: [{ id: 'fireball_form', kind: 'form_fireball' }],
    });
    expect(usableOnBar(ember, wearing)).toBe(true);
  });

  it('greys a combo finisher at zero combo points but not a comboOptional one', () => {
    const eviscerate = ABILITIES.eviscerate;
    expect(usableOnBar(eviscerate, world({ comboPoints: 0 }))).toBe(false);
    expect(usableOnBar(eviscerate, world())).toBe(false);
    expect(usableOnBar(eviscerate, world({ comboPoints: 1 }))).toBe(true);
    const optional = { ...eviscerate, comboOptional: true } as AbilityDef;
    expect(usableOnBar(optional, world({ comboPoints: 0 }))).toBe(true);
  });

  it('greys a form ability outside its druid form', () => {
    const maul = ABILITIES.maul;
    expect(usableOnBar(maul, world())).toBe(false);
    expect(usableOnBar(maul, world({ auras: [{ kind: 'form_bear' }] }))).toBe(true);
  });

  it('leaves an ability with no secondary requirement untouched', () => {
    const strike = ABILITIES.heroic_strike;
    expect(
      secondaryRequirementsMet(
        world({ inCombat: true, targetHp: 1000, targetMaxHp: 1000 }),
        known(strike),
      ),
    ).toBe(true);
  });
});

describe('action bar and the live cast gate agree on the Execute window', () => {
  function warriorWithDummy(): { sim: Sim; p: Entity; mob: Entity } {
    const sim = new Sim({ seed: 72, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.tick();
    const p = sim.player;
    const mob = createMob(9801, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 2,
    });
    mob.hostile = true;
    mob.maxHp = mob.hp = 1000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    p.facing = 0;
    return { sim, p, mob };
  }

  /** Press Execute through the real gate. `refused` is the execute-window error;
   *  `landed` proves an accepted press really cast (it started the GCD, which a
   *  free Sudden Death cast does too), so a range, facing or rage refusal cannot
   *  pass for agreement. */
  function pressExecute(sim: Sim, p: Entity): { refused: boolean; landed: boolean } {
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    sim.castAbility('execute');
    const events: SimEvent[] = sim.tick();
    return {
      refused: events.some(
        (e) => e.type === 'error' && /requires the target below 20% health/.test(e.text),
      ),
      landed: p.gcdRemaining > 0,
    };
  }

  function barAllowsExecute(p: Entity, mob: Entity): boolean {
    return secondaryRequirementsMet(
      { player: { ...world().player, ...p }, target: mob },
      known(EXECUTE),
    );
  }

  it('the warrior knows Execute at level 20', () => {
    const { sim } = warriorWithDummy();
    expect(sim.known.some((k) => k.def.id === 'execute')).toBe(true);
  });

  it.each([
    [900, false],
    [201, false],
    [200, true],
    [100, true],
  ])('target at %i / 1000 hp: bar usable = %s, and the gate agrees', (hp, usable) => {
    const { sim, p, mob } = warriorWithDummy();
    mob.hp = hp;
    expect(barAllowsExecute(p, mob)).toBe(usable);
    expect(pressExecute(sim, p)).toEqual({ refused: !usable, landed: usable });
  });

  it('Sudden Death opens both the bar and the gate on a healthy target', () => {
    const { sim, p, mob } = warriorWithDummy();
    mob.hp = 900;
    p.auras.push({
      id: 'sudden_death',
      name: 'Sudden Death',
      kind: 'sudden_death',
      remaining: 10,
      duration: 10,
      sourceId: p.id,
    } as Entity['auras'][number]);
    expect(barAllowsExecute(p, mob)).toBe(true);
    expect(pressExecute(sim, p)).toEqual({ refused: false, landed: true });
  });
});

// Real catalog items, picked by shape so the suite survives catalog churn.
const allItems = Object.values(ITEMS);
const SHIELD = allItems.find((item) => isShieldItem(item))!.id;
const DAGGERS = allItems.filter((item) => item.weapon?.dagger === true);
const LOW_DAGGER = DAGGERS.reduce((a, b) => (requiredLevelFor(a) <= requiredLevelFor(b) ? a : b));
const HIGH_DAGGER = DAGGERS.reduce((a, b) => (requiredLevelFor(a) >= requiredLevelFor(b) ? a : b));
const SWORD = allItems.find(
  (item) => item.weapon !== undefined && item.weapon.dagger !== true && item.slot === 'mainhand',
)!.id;

describe('action bar: equipment and target-aura requirements', () => {
  it('finds the fixture items it needs', () => {
    expect(SHIELD).toBeTruthy();
    expect(SWORD).toBeTruthy();
    expect(requiredLevelFor(HIGH_DAGGER)).toBeGreaterThan(requiredLevelFor(LOW_DAGGER));
  });

  it('greys Shield Slam without a shield in the off hand', () => {
    const slam = ABILITIES.shield_slam;
    expect(slam.requiresShield).toBe(true);
    expect(usableOnBar(slam, world({ equippedItems: {} }))).toBe(false);
    expect(usableOnBar(slam, world({ equippedItems: { mainhand: SWORD } }))).toBe(false);
    expect(usableOnBar(slam, world({ equippedItems: { offhand: SHIELD } }))).toBe(true);
    expect(shieldEquipped({ offhand: SHIELD })).toBe(true);
  });

  it('greys Backstab unless a usable dagger is in the main hand', () => {
    const backstab = ABILITIES.backstab;
    expect(effectsRequireDagger(backstab.effects)).toBe(true);
    const at = (mainhand: string, level: number) =>
      secondaryRequirementsMet(world({ level, equippedItems: { mainhand } }), known(backstab));
    expect(at(SWORD, 60)).toBe(false);
    expect(at(LOW_DAGGER.id, 60)).toBe(true);
    // An over-level main hand is inert, exactly as recalcPlayerStats treats it.
    expect(at(HIGH_DAGGER.id, requiredLevelFor(HIGH_DAGGER) - 1)).toBe(false);
    expect(at(HIGH_DAGGER.id, requiredLevelFor(HIGH_DAGGER))).toBe(true);
  });

  it('reads the rank-resolved effects over the def when the resolve supplies them', () => {
    const backstab = ABILITIES.backstab;
    const w = world({ level: 60, equippedItems: { mainhand: SWORD } });
    expect(secondaryRequirementsMet(w, { def: backstab, cost: 0, effects: [] })).toBe(true);
    expect(secondaryRequirementsMet(w, { def: backstab, cost: 0 })).toBe(false);
  });

  it("greys Conflagrate unless the target carries the caster's own ticking Immolate", () => {
    const conflagrate = ABILITIES.conflagrate;
    const pact = (sourceId: number, remaining: number): ActionBarAuraInput => ({
      id: 'immolate',
      kind: 'dot',
      sourceId,
      remaining,
    });
    const at = (targetAuras: ActionBarAuraInput[]) =>
      secondaryRequirementsMet(world({ targetAuras }), known(conflagrate));
    expect(at([])).toBe(false);
    expect(at([pact(2, 8)])).toBe(false);
    expect(at([pact(1, 0)])).toBe(false);
    expect(at([pact(1, 8)])).toBe(true);
    // No target: the gate auto-acquires, so the bar does not guess.
    expect(secondaryRequirementsMet(world({ noTarget: true }), known(conflagrate))).toBe(true);
    expect(hasBurningPact({ id: 1 }, { auras: [pact(1, 8)] })).toBe(true);
  });

  it('agrees with the live sim: the worn-gear dagger read matches weapon.dagger', () => {
    const sim = new Sim({ seed: 72, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    for (const id of [LOW_DAGGER.id, SWORD]) {
      sim.addItem(id, 1);
      sim.equipItem(id);
      sim.tick();
      expect(p.equippedItems.mainhand).toBe(id);
      expect(wieldsDagger(p.equippedItems, p.level)).toBe(p.weapon.dagger === true);
    }
  });
});
