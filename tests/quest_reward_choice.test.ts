import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import {
  defaultRewardChoice,
  questFixedReward,
  questRewardChoices,
  resolveRewardChoice,
} from '../src/sim/quests/quest_reward_choice';
import { Sim } from '../src/sim/sim';
import type { ItemDef, PlayerClass, QuestDef } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// One leveling green per role (the Hedgerow chest set): the five-way choice
// every leveling quest offers.
function piece(id: string): ItemDef {
  const found = ITEMS[id];
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

const CLOTH_INT = piece('hedgerow_robe');
const LEATHER_AGI = piece('hedgerow_jerkin');
const LEATHER_STR = piece('hedgerow_tunic');
const MAIL_STR = piece('hedgerow_hauberk');
const MAIL_INT = piece('hedgerow_chainmail');
const CHOICES = [CLOTH_INT.id, LEATHER_AGI.id, LEATHER_STR.id, MAIL_STR.id, MAIL_INT.id];

const quest = (choiceRewards?: string[], itemRewards: QuestDef['itemRewards'] = {}): QuestDef =>
  ({ ...Object.values(QUESTS)[0], choiceRewards, itemRewards }) as QuestDef;

describe('choose-one quest rewards: the shared resolver', () => {
  it('offers each class only what it can wear', () => {
    expect(questRewardChoices(quest(CHOICES), 'mage')).toEqual([CLOTH_INT.id]);
    expect(questRewardChoices(quest(CHOICES), 'rogue')).toEqual([
      CLOTH_INT.id,
      LEATHER_AGI.id,
      LEATHER_STR.id,
    ]);
    expect(questRewardChoices(quest(CHOICES), 'warrior')).toEqual(CHOICES);
    expect(questRewardChoices(quest(), 'warrior')).toEqual([]);
  });

  it('defaults to the piece that fits the spec, or the class leveling spec before one', () => {
    const q = quest(CHOICES);
    const cases: [PlayerClass, string | null, string][] = [
      ['warrior', 'arms', MAIL_STR.id],
      ['paladin', 'holy', MAIL_INT.id],
      ['paladin', 'retribution', MAIL_STR.id],
      ['paladin', null, MAIL_STR.id],
      ['shaman', 'elemental', MAIL_INT.id],
      // Enhancement and feral attack power is 2 per Strength (measured).
      ['shaman', 'enhancement', MAIL_STR.id],
      ['shaman', null, MAIL_STR.id],
      ['druid', 'feral', LEATHER_STR.id],
      ['druid', 'balance', CLOTH_INT.id],
      ['rogue', 'combat', LEATHER_AGI.id],
      ['hunter', null, LEATHER_AGI.id],
      ['priest', null, CLOTH_INT.id],
    ];
    for (const [cls, spec, expected] of cases) {
      expect(defaultRewardChoice(q, cls, spec), `${cls} ${spec}`).toBe(expected);
    }
  });

  it('settles a turn-in: no pick takes the default, an unoffered pick is refused', () => {
    const q = quest(CHOICES);
    expect(resolveRewardChoice(q, 'mage', undefined)).toEqual({ ok: true, itemId: CLOTH_INT.id });
    expect(resolveRewardChoice(q, 'warrior', LEATHER_AGI.id)).toEqual({
      ok: true,
      itemId: LEATHER_AGI.id,
    });
    expect(resolveRewardChoice(q, 'mage', MAIL_STR.id)).toEqual({
      ok: false,
      reason: 'not_offered',
    });
    expect(resolveRewardChoice(quest(), 'mage', MAIL_STR.id)).toEqual({
      ok: true,
      itemId: undefined,
    });
  });

  it('folds an authored gear reward into the list instead of granting it beside it', () => {
    // The Old Wolf authors Greyjaw's Pelt Leggings (cloth, so every class
    // reaches them through its reward archetype) and carries its band's choice
    // set: one list, one pick, no second reward.
    const greyjaw = QUESTS.q_greyjaw;
    expect(greyjaw.choiceRewards?.length).toBeGreaterThan(0);
    const classes: PlayerClass[] = [
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
    for (const cls of classes) {
      const offered = questRewardChoices(greyjaw, cls);
      expect(offered[0], cls).toBe('greyjaw_pelt_cloak');
      expect(offered.slice(1), cls).toEqual(
        (greyjaw.choiceRewards ?? []).filter((id) => canEquipItem(cls, ITEMS[id])),
      );
      expect(questFixedReward(greyjaw, cls), cls).toBeUndefined();
    }
    // Without a choice list the authored piece is still the fixed reward.
    const plain = { ...greyjaw, choiceRewards: undefined } as QuestDef;
    expect(questFixedReward(plain, 'warrior')).toBe('greyjaw_pelt_cloak');
    expect(questRewardChoices(plain, 'warrior')).toEqual([]);
  });

  it('keeps a non-gear authored reward fixed beside the choice', () => {
    const q = quest(CHOICES, { warrior: 'greyjaw_fang' });
    expect(ITEMS.greyjaw_fang.slot).toBeUndefined();
    expect(questFixedReward(q, 'warrior')).toBe('greyjaw_fang');
    expect(questRewardChoices(q, 'warrior')).toEqual(CHOICES);
  });

  it('preselects only a piece the spec uses, though an off-role authored piece stays on offer', () => {
    // The strongest druid-wearable Intellect weapon with no Strength or Agility:
    // the archetype gear a balance druid wants and a feral cat must not be handed.
    const casterWeapon = Object.values(ITEMS)
      .filter(
        (i) =>
          i.weapon &&
          (i.stats?.int ?? 0) > 0 &&
          !i.stats?.str &&
          !i.stats?.agi &&
          canEquipItem('druid', i),
      )
      .sort((a, b) => (b.stats?.int ?? 0) - (a.stats?.int ?? 0))[0];
    expect(casterWeapon).toBeDefined();
    const q = quest(CHOICES, { druid: casterWeapon.id });
    expect(questRewardChoices(q, 'druid')).toContain(casterWeapon.id);
    expect(defaultRewardChoice(q, 'druid', 'feral')).toBe(LEATHER_STR.id);
  });
});

describe('choose-one quest rewards: the turn-in grant', () => {
  const questId = Object.keys(QUESTS).find((id) => {
    const q = QUESTS[id];
    return !q.retired && q.objectives.every((o) => o.type === 'kill') && NPCS[q.turnInNpcId];
  }) as string;
  const original = QUESTS[questId].choiceRewards;
  const originalItems = QUESTS[questId].itemRewards;
  afterEach(() => {
    QUESTS[questId].choiceRewards = original;
    QUESTS[questId].itemRewards = originalItems;
  });

  function readyAtTurnIn(cls: PlayerClass): Sim {
    const sim = new Sim({ seed: 42, playerClass: cls, autoEquip: false });
    const q = QUESTS[questId];
    sim.questLog.set(questId, {
      questId,
      counts: q.objectives.map((o) => o.count),
      state: 'ready',
    });
    const npc = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === q.turnInNpcId,
    );
    if (!npc) throw new Error(`no ${q.turnInNpcId} in the world`);
    const p = sim.player;
    const x = npc.pos.x + 1;
    p.pos = { x, y: terrainHeight(x, npc.pos.z, sim.cfg.seed), z: npc.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.drainEvents();
    return sim;
  }

  it('grants the picked piece', () => {
    QUESTS[questId].choiceRewards = CHOICES;
    const sim = readyAtTurnIn('warrior');
    sim.turnInQuest(questId, LEATHER_AGI.id);
    expect(sim.countItem(LEATHER_AGI.id)).toBe(1);
    expect(sim.countItem(MAIL_STR.id)).toBe(0);
    expect(sim.questLog.has(questId)).toBe(false);
  });

  it('grants the spec default when the turn-in names no pick', () => {
    QUESTS[questId].choiceRewards = CHOICES;
    const sim = readyAtTurnIn('mage');
    sim.turnInQuest(questId);
    expect(sim.countItem(CLOTH_INT.id)).toBe(1);
  });

  it('grants one pick, never the authored gear piece on top of it', () => {
    QUESTS[questId].choiceRewards = CHOICES;
    QUESTS[questId].itemRewards = { warrior: 'greyjaw_pelt_cloak' };
    const picksChoice = readyAtTurnIn('warrior');
    picksChoice.turnInQuest(questId, LEATHER_AGI.id);
    expect(picksChoice.countItem(LEATHER_AGI.id)).toBe(1);
    expect(picksChoice.countItem('greyjaw_pelt_cloak')).toBe(0);

    const picksAuthored = readyAtTurnIn('warrior');
    picksAuthored.turnInQuest(questId, 'greyjaw_pelt_cloak');
    expect(picksAuthored.countItem('greyjaw_pelt_cloak')).toBe(1);
    expect(CHOICES.every((id) => picksAuthored.countItem(id) === 0)).toBe(true);
  });

  it('refuses a piece the class is not offered and keeps the quest ready', () => {
    QUESTS[questId].choiceRewards = CHOICES;
    const sim = readyAtTurnIn('mage');
    sim.turnInQuest(questId, MAIL_STR.id);
    const errors = sim.drainEvents().filter((e) => e.type === 'error');
    expect(errors.map((e) => (e as { text: string }).text)).toContain(
      'That reward is not offered.',
    );
    expect(sim.countItem(MAIL_STR.id)).toBe(0);
    expect(sim.questLog.get(questId)?.state).toBe('ready');
  });
});
