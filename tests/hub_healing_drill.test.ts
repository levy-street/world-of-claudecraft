// The hub's optional healing lesson (q_hub_healing_numbers): Drillmaster
// Hale's second, optional quest, restricted to the four classes with a real
// direct heal in kit (druid, shaman, paladin, priest; never mage). Credit
// rides only an EFFECTIVE, DIRECT player cast on the hub's own healing dummy
// (tutorial/hub_healing_drill.ts): no pets, no passive HoT ticks, no
// derived/echoed/proc copies, no full overheal, no wrong target.
import { describe, expect, it } from 'vitest';
import {
  HUB_DUMMY_DRILL_QUEST_ID,
  HUB_HEALING_DRILL_OBJECT_ITEM_ID,
  HUB_HEALING_DRILL_QUEST_ID,
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_ELIGIBLE_CLASSES,
  HUB_PRACTICE_NPCS,
  HUB_SPARRING_MASTER_ID,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import { computeQuestState } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import {
  creditHubHealingDrill,
  HEALING_DRILL_QUEST_ID,
  isHubHealingDummy,
} from '../src/sim/tutorial/hub_healing_drill';
import { hubHealingAbilityId } from '../src/sim/tutorial/hub_healing_lesson';
import type { Entity, PlayerClass, QuestProgress, SimEvent } from '../src/sim/types';

const SEED = 42;

const ALL_CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

const HUB_DUMMY_WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: HUB_PRACTICE_NPCS,
  groundObjects: [],
};

function makeHealSim(cls: PlayerClass): Sim {
  return new Sim({ seed: SEED, playerClass: cls, autoEquip: true, world: HUB_DUMMY_WORLD });
}

function healingDummyOf(sim: Sim): Entity {
  const d = [...sim.entities.values()].find(
    (e) => e.templateId === HUB_HEALING_DUMMY_ID && !e.dead,
  );
  if (!d) throw new Error('hub healing dummy not spawned');
  return d;
}

function seedActiveHealingQuest(sim: Sim): QuestProgress {
  const meta = sim.players.get(sim.playerId)!;
  const qp: QuestProgress = { questId: HEALING_DRILL_QUEST_ID, counts: [0], state: 'active' };
  meta.questLog.set(HEALING_DRILL_QUEST_ID, qp);
  return qp;
}

/** A stand-in entity: only the fields the credit guard reads. */
function mob(templateId: string = HUB_HEALING_DUMMY_ID, kind: Entity['kind'] = 'mob'): Entity {
  return { templateId, kind } as unknown as Entity;
}

describe('the healing lesson is authored the way the credit and availability arms read it', () => {
  it('is a real optional quest on Hale, following the damage lesson', () => {
    const quest = QUESTS[HUB_HEALING_DRILL_QUEST_ID];
    expect(quest.giverNpcId).toBe(HUB_SPARRING_MASTER_ID);
    expect(quest.turnInNpcId).toBe(HUB_SPARRING_MASTER_ID);
    expect(quest.requiresQuest).toBe(HUB_DUMMY_DRILL_QUEST_ID);
    expect(quest.requiredClass).toEqual([...HUB_HEALING_ELIGIBLE_CLASSES]);
    expect(quest.requiresUsableHealAbility).toBe(true);
    expect(NPCS[HUB_SPARRING_MASTER_ID]?.questIds).toContain(HUB_HEALING_DRILL_QUEST_ID);
    expect(QUEST_ORDER).toContain(HUB_HEALING_DRILL_QUEST_ID);
  });

  it('carries the sentinel objective the credit keys on: three effective heals', () => {
    const objective = QUESTS[HUB_HEALING_DRILL_QUEST_ID].objectives[0];
    expect(objective.type).toBe('interact');
    expect(objective.type === 'interact' && objective.targetObjectItemId).toBe(
      HUB_HEALING_DRILL_OBJECT_ITEM_ID,
    );
    expect(objective.count).toBe(3);
  });

  it('names the Healing tab of the Damage Meters, with no hardcoded keybind', () => {
    const quest = QUESTS[HUB_HEALING_DRILL_QUEST_ID];
    expect(quest.text).toMatch(/Damage Meters/);
    expect(quest.text).toMatch(/Healing tab/);
    expect(quest.text).not.toMatch(/Shift/i);
    expect(quest.text).not.toMatch(/left-click/i);
    // Describes the actual object: a dummy, never a person.
    expect(quest.text).toMatch(/Healing Dummy/);
    expect(quest.text).not.toMatch(/recruit/i);
  });
});

describe('isHubHealingDummy', () => {
  it('is the hub`s own healing target and nothing else', () => {
    expect(isHubHealingDummy(mob(HUB_HEALING_DUMMY_ID))).toBe(true);
    expect(isHubHealingDummy(mob('friendly_player_dummy'))).toBe(false);
    expect(isHubHealingDummy(mob('hub_training_dummy'))).toBe(false);
    expect(isHubHealingDummy(mob('training_dummy'))).toBe(false);
    expect(isHubHealingDummy(mob(HUB_HEALING_DUMMY_ID, 'npc'))).toBe(false);
  });
});

describe('creditHubHealingDrill: unit contract', () => {
  const PRIEST_HEAL = hubHealingAbilityId('priest', 5)!;

  function playerSourceFor(sim: Sim): Entity {
    return sim.entities.get(sim.playerId)!;
  }

  it('credits three effective direct heals and readies the quest, never overshoots', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    const target = mob();
    creditHubHealingDrill(sim.ctx, p, target, 40, PRIEST_HEAL);
    creditHubHealingDrill(sim.ctx, p, target, 40, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(2);
    expect(qp.state).toBe('active');
    creditHubHealingDrill(sim.ctx, p, target, 40, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(3);
    expect(qp.state).toBe('ready');
    // Further effective heals never overshoot the count.
    creditHubHealingDrill(sim.ctx, p, target, 40, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(3);
  });

  it('draws no rng when it credits', () => {
    const sim = makeHealSim('priest');
    seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    creditHubHealingDrill(sim.ctx, p, mob(), 40, PRIEST_HEAL);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });

  it('ignores a fully overhealed cast (effective healed is 0)', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    creditHubHealingDrill(sim.ctx, p, mob(), 0, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a heal on the wrong target: the Highwatch row`s own friendly dummy does not count', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    creditHubHealingDrill(sim.ctx, p, mob('friendly_player_dummy'), 40, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a non-player (pet) source', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    creditHubHealingDrill(sim.ctx, mob('wolf'), mob(), 40, PRIEST_HEAL);
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a heal from any ability other than the caster`s own resolved direct heal (chain/proc/other spell)', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    creditHubHealingDrill(sim.ctx, p, mob(), 40, 'prayer_of_healing');
    creditHubHealingDrill(sim.ctx, p, mob(), 40, 'renew');
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a null abilityId (a proc path with no ability id)', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    creditHubHealingDrill(sim.ctx, p, mob(), 40, null);
    expect(qp.counts[0]).toBe(0);
  });

  it('never credits an ineligible class, even a real heal-shaped ability id and an (illegally) active quest', () => {
    const sim = makeHealSim('mage');
    const qp = seedActiveHealingQuest(sim); // forced active: defense in depth beyond quest gating
    const p = playerSourceFor(sim);
    // hubHealingAbilityId('mage', ...) is always null, so nothing a mage
    // passes as abilityId can ever equal it.
    creditHubHealingDrill(sim.ctx, p, mob(), 40, 'lesser_heal');
    expect(qp.counts[0]).toBe(0);
  });

  it('credits nothing when the lesson is not active', () => {
    const sim = makeHealSim('priest');
    const p = playerSourceFor(sim);
    creditHubHealingDrill(sim.ctx, p, mob(), 40, PRIEST_HEAL);
    expect(sim.players.get(sim.playerId)!.questLog.has(HEALING_DRILL_QUEST_ID)).toBe(false);
  });

  it('a generic applyHeal call no longer credits the drill directly: provenance now lives solely in effect_dispatch`s primary case', () => {
    // Regression for the Power Echo double-credit bug: the hook used to sit in
    // combat/heal.ts applyHeal's tail, so ANY applyHeal call carrying the
    // caster's own class-heal abilityId credited, including a derived call
    // this module was never meant to see. It now only fires from the one call
    // site inside effect_dispatch.ts's primary direct-heal case, so calling
    // ctx.applyHeal directly (bypassing that case entirely, the way a proc or
    // an echo does) must never credit, regardless of the abilityId passed.
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const p = playerSourceFor(sim);
    const target = healingDummyOf(sim);
    target.hp = 1;
    target.maxHp = 1000;
    sim.ctx.applyHeal(p, target, 40, 'Prayer of Mending', PRIEST_HEAL);
    expect(qp.counts[0]).toBe(0);
  });
});

describe('computeQuestState: all 9 classes, low-level availability, and the prerequisite', () => {
  const doneWithDamageLesson = new Set([HUB_DUMMY_DRILL_QUEST_ID]);

  it('is available at level 1 (the hub`s own level) for exactly the four eligible classes once the damage lesson is done', () => {
    for (const cls of ALL_CLASSES) {
      const state = computeQuestState(
        HUB_HEALING_DRILL_QUEST_ID,
        new Map(),
        doneWithDamageLesson,
        1,
        undefined,
        undefined,
        cls,
      );
      if (HUB_HEALING_ELIGIBLE_CLASSES.includes(cls)) {
        expect(state, `${cls} should see the healing lesson`).toBe('available');
      } else {
        expect(state, `${cls} must never see the healing lesson`).toBe('unavailable');
      }
    }
  });

  it('mage is unavailable at every level, even hypothetically deep into a "healing" respec', () => {
    for (const level of [1, 5, 10, 20]) {
      expect(
        computeQuestState(
          HUB_HEALING_DRILL_QUEST_ID,
          new Map(),
          doneWithDamageLesson,
          level,
          undefined,
          undefined,
          'mage',
        ),
      ).toBe('unavailable');
    }
  });

  it('is unavailable to an eligible class before the damage lesson (Know Your Numbers) is done', () => {
    expect(
      computeQuestState(
        HUB_HEALING_DRILL_QUEST_ID,
        new Map(),
        new Set(), // damage lesson NOT done
        5,
        undefined,
        undefined,
        'priest',
      ),
    ).toBe('unavailable');
  });

  it('is unavailable with no player class at all (fails closed)', () => {
    expect(
      computeQuestState(
        HUB_HEALING_DRILL_QUEST_ID,
        new Map(),
        doneWithDamageLesson,
        5,
        undefined,
        undefined,
        undefined,
      ),
    ).toBe('unavailable');
  });
});

describe('the live heal path credits the drill, per eligible class', () => {
  function castUntilFirstCredit(sim: Sim, cls: PlayerClass, qp: QuestProgress): void {
    const abilityId = hubHealingAbilityId(cls, sim.player.level)!;
    const target = healingDummyOf(sim);
    sim.targetEntity(target.id);
    for (let i = 0; i < 800 && qp.counts[0] === 0; i++) {
      sim.tick();
      if (!sim.player.castingAbility && qp.counts[0] === 0) {
        sim.castAbility(abilityId);
      }
    }
  }

  for (const cls of ['druid', 'shaman', 'paladin', 'priest'] as const) {
    it(`${cls}'s own resolved direct heal credits a real cast on the real hub dummy`, () => {
      const sim = makeHealSim(cls);
      expect(sim.player.level).toBe(1); // a fresh, low-level character
      const qp = seedActiveHealingQuest(sim);
      castUntilFirstCredit(sim, cls, qp);
      expect(qp.counts[0]).toBeGreaterThan(0);
    });
  }

  it('three effective priest heals complete the quest end to end', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const abilityId = hubHealingAbilityId('priest', sim.player.level)!;
    const target = healingDummyOf(sim);
    sim.targetEntity(target.id);
    for (let i = 0; i < 2000 && qp.state === 'active'; i++) {
      sim.tick();
      if (!sim.player.castingAbility && qp.state === 'active') {
        sim.castAbility(abilityId);
      }
    }
    expect(qp.counts[0]).toBe(3);
    expect(qp.state).toBe('ready');
  });

  it('a cast on an already-full-health dummy does not credit (no full-overheal credit, live path)', () => {
    const sim = makeHealSim('priest');
    const qp = seedActiveHealingQuest(sim);
    const abilityId = hubHealingAbilityId('priest', sim.player.level)!;
    const target = healingDummyOf(sim);
    sim.targetEntity(target.id);
    for (let i = 0; i < 400; i++) {
      // Pinned at full EVERY tick: the friendlyPracticeTarget shed mechanic
      // would otherwise drain it below max between cast attempts, which
      // would let a later cast land a real (non-overheal) heal and defeat
      // the point of this test.
      target.hp = target.maxHp;
      sim.tick();
      if (!sim.player.castingAbility) sim.castAbility(abilityId);
    }
    expect(qp.counts[0]).toBe(0);
  });
});

describe('Power Echo regression: one real cast credits once, even with the echo copy live', () => {
  it('a shaman healing_wave cast with an armed Power Echo lands TWO effective heals but credits the drill ONCE', () => {
    // Echoing Elements (shaman_warspirit.ts onStormcastConsumed) grants the
    // same `kind: 'power_echo'` aura the mage choice row does; effect_dispatch.ts's
    // shared `case 'heal':` repeats ANY class's direct heal while it rides
    // (mage_choice_rows.test.ts pins the mage shape of the same mechanic).
    // Applying the aura directly here (rather than driving the full
    // Warspirit posture/Stormcast chain) exercises the identical dispatch
    // path with a minimal, real aura application.
    const sim = makeHealSim('shaman');
    expect(sim.player.level).toBe(1);
    const qp = seedActiveHealingQuest(sim);
    const abilityId = hubHealingAbilityId('shaman', sim.player.level)!;
    const target = healingDummyOf(sim);
    sim.targetEntity(target.id);
    const p = sim.player;
    p.resource = p.maxResource;
    sim.ctx.applyAura(p, {
      id: 'shaman_echoing_elements_stormcast',
      name: 'Echoing Elements',
      kind: 'power_echo',
      value: 0.4,
      remaining: 12,
      duration: 12,
      sourceId: p.id,
      school: 'nature',
    });
    // A deep hole, far past what either the primary heal or its 40% echo
    // could close alone: a shallow hole (the dummy's ordinary rest-fraction
    // gap) would let the primary cast close it outright, clamping the
    // echo's effective heal to zero and passing this test for the wrong
    // reason (the old, buggy hook only over-credited when the echo ALSO
    // landed positive healing).
    target.maxHp = 100000;
    target.hp = 1;
    sim.castAbility(abilityId);
    const collected: SimEvent[] = [];
    for (let i = 0; i < 60; i++) collected.push(...sim.tick());
    const heals = collected.filter(
      (e): e is Extract<SimEvent, { type: 'heal2' }> =>
        e.type === 'heal2' && e.targetId === target.id,
    );
    expect(heals).toHaveLength(2); // the primary cast and its Power Echo repeat
    expect(heals[0].amount).toBeGreaterThan(0);
    expect(heals[1].amount).toBeGreaterThan(0);
    expect(qp.counts[0]).toBe(1); // ONE real cast, credited exactly once
  });
});
