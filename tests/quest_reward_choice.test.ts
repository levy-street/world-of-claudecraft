import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, NPCS, QUESTS } from '../src/sim/data';
import {
  defaultRewardChoice,
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

const quest = (choiceRewards?: string[]): QuestDef =>
  ({ ...Object.values(QUESTS)[0], choiceRewards }) as QuestDef;

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
});

describe('choose-one quest rewards: the turn-in grant', () => {
  const questId = Object.keys(QUESTS).find((id) => {
    const q = QUESTS[id];
    return !q.retired && q.objectives.every((o) => o.type === 'kill') && NPCS[q.turnInNpcId];
  }) as string;
  const original = QUESTS[questId].choiceRewards;
  afterEach(() => {
    QUESTS[questId].choiceRewards = original;
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
