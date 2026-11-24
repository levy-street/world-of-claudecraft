import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  pickRareSet,
  planAddOnly,
  renderChoiceEntry,
  spliceChoiceEntries,
} from '../scripts/quest_leveling_gear_add';
import {
  eligibleQuests,
  isEliteOrBossQuest,
  rewardQuality,
} from '../scripts/quest_leveling_gear_rules';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { ITEMS, MOBS, QUESTS } from '../src/sim/data';
import type { QuestDef } from '../src/sim/types';

// The choose-one leveling gear generator (scripts/quest_leveling_gear_gen.ts) runs
// add-only by default (scripts/quest_leveling_gear_add.ts): committed rows keep
// every byte, only a quest with no row gets one, and elite and boss quests get
// rare (blue) choices. A full reroll rebalances every shipped quest, so it is
// opt-in (--reroll) and never what a plain run does.

const CHOICES_PATH = new URL('../src/sim/content/quest_choice_rewards.ts', import.meta.url);
const committedText = readFileSync(CHOICES_PATH, 'utf8');

// The Quartered Isle rows, all generator output from the add-only mode.
const ISLE = [
  'q_qi_the_moot_rolls',
  'q_qi_words_in_stone',
  'q_qi_servants_at_their_posts',
  'q_qi_wardens_of_the_arts',
  'q_qi_the_fallen_giant',
  'q_qi_the_first_colossus',
];

// Shipped elite and boss quests whose green rows predate the elite-means-blue rule
// in the generator. Add-only keeps them as shipped; moving them to rares is a
// rebalance for the owner to call. Never add to this list: a new elite or boss
// quest gets rares from the generator.
const LEGACY_GREEN_ELITE_QUESTS = new Set([
  'q_broodmother',
  'q_crushers',
  'q_deacon',
  'q_hollow_first_of_the_herd',
  'q_hollow_old_marrowshell',
  'q_mogger',
  'q_no_rest',
  'q_nythraxis_bound_guardian',
  'q_ogre_bounty',
  'q_old_cragmaw',
  'q_ringleader',
  'q_sunken_court',
  'q_voice_below',
  'q_waking_warden',
  'q_wardens_echoes',
]);

// The committed file text with these rows cut out, as if they had never been run.
function withoutRows(text: string, questIds: readonly string[]): string {
  let out = text;
  for (const id of questIds) {
    const row = renderChoiceEntry(id, QUEST_CHOICE_REWARDS[id]);
    expect(out.includes(row), `${id} row in canonical form`).toBe(true);
    out = out.replace(row, '');
  }
  return out;
}
function withoutKeys(questIds: readonly string[]): Record<string, readonly string[]> {
  const copy: Record<string, readonly string[]> = { ...QUEST_CHOICE_REWARDS };
  for (const id of questIds) delete copy[id];
  return copy;
}

describe('quest leveling gear generator, add-only default', () => {
  it('adds nothing when every eligible quest already has its committed row', () => {
    expect(planAddOnly(QUEST_CHOICE_REWARDS)).toEqual([]);
  });

  it('regenerates only the missing rows and leaves every other byte of the file alone', () => {
    const added = planAddOnly(withoutKeys(ISLE));
    expect(added.map((a) => a.questId).sort()).toEqual([...ISLE].sort());
    // Splicing the planned rows back into the cut file reproduces the committed
    // file exactly: the isle rows are this mode's output, and no other row moved.
    expect(spliceChoiceEntries(withoutRows(committedText, ISLE), added)).toBe(committedText);
  });

  it('plans one cut row without touching any committed row', () => {
    // A shipped quest from the middle of a band: a reroll would shift every later
    // quest of its band, the add-only mode plans this row alone.
    const id = 'q_af_amber_from_the_herd';
    const added = planAddOnly(withoutKeys([id]));
    expect(added.map((a) => a.questId)).toEqual([id]);
    const spliced = spliceChoiceEntries(withoutRows(committedText, [id]), added);
    expect(spliced.replace(renderChoiceEntry(id, added[0].ids), '')).toBe(
      withoutRows(committedText, [id]),
    );
  });

  it('refuses to splice a row that is already committed', () => {
    expect(() =>
      spliceChoiceEntries(committedText, [{ questId: ISLE[0], ids: ['highgale_robe'] }]),
    ).toThrow(/already has a committed row/);
  });

  it('only ever offers pieces the generator already owns', () => {
    for (const a of planAddOnly(withoutKeys(ISLE))) {
      for (const id of a.ids) expect(ITEMS[id], `${a.questId} ${id}`).toBeDefined();
    }
  });

  it('formats a row the way Biome does at line width 100', () => {
    expect(renderChoiceEntry('q_x', ['a', 'b'])).toBe("  q_x: ['a', 'b'],\n");
    const long = [
      'highgale_robe',
      'highgale_jerkin',
      'highgale_tunic',
      'highgale_hauberk',
      'highgale_vest',
    ];
    expect(renderChoiceEntry('q_some_quest', long)).toBe(
      `  q_some_quest: [\n${long.map((id) => `    '${id}',\n`).join('')}  ],\n`,
    );
  });
});

describe('quest leveling gear generator, elite and boss quests rate rares', () => {
  const quest = (mobId: string): QuestDef => ({
    id: 'q_test',
    name: 'Test',
    giverNpcId: 'nobody',
    turnInNpcId: 'nobody',
    text: '',
    completionText: '',
    objectives: [{ type: 'kill', targetMobId: mobId, count: 1, label: '' }],
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
  });
  const mobWhere = (pred: (m: (typeof MOBS)[string]) => boolean) => {
    const mob = Object.values(MOBS).find(pred);
    expect(mob).toBeDefined();
    return mob?.id ?? '';
  };

  it('keys on elite, boss and world boss kill targets', () => {
    for (const id of [
      mobWhere((m) => !!m.elite && !m.boss),
      mobWhere((m) => !!m.boss && !m.elite),
      mobWhere((m) => !!m.worldBoss),
    ]) {
      expect(isEliteOrBossQuest(quest(id)), id).toBe(true);
      expect(rewardQuality(quest(id)), id).toBe('rare');
    }
    const plain = mobWhere((m) => !m.elite && !m.boss && !m.worldBoss);
    expect(isEliteOrBossQuest(quest(plain))).toBe(false);
    expect(rewardQuality(quest(plain))).toBe('uncommon');
  });

  it('gives the isle elite quests rare sets and the rest of the isle greens', () => {
    const planned = new Map(planAddOnly(withoutKeys(ISLE)).map((a) => [a.questId, a]));
    for (const id of ISLE) {
      const want = isEliteOrBossQuest(QUESTS[id]) ? 'rare' : 'uncommon';
      expect(planned.get(id)?.quality, id).toBe(want);
      for (const itemId of QUEST_CHOICE_REWARDS[id]) {
        expect(ITEMS[itemId].quality, `${id} ${itemId}`).toBe(want);
      }
    }
    expect(rewardQuality(QUESTS.q_qi_wardens_of_the_arts)).toBe('rare');
    expect(rewardQuality(QUESTS.q_qi_the_first_colossus)).toBe('rare');
  });

  it('offers only rares on every elite or boss quest outside the legacy list', () => {
    const greens: string[] = [];
    for (const [questId, ids] of Object.entries(QUEST_CHOICE_REWARDS)) {
      if (rewardQuality(QUESTS[questId]) !== 'rare') continue;
      const allRare = ids.every((id) => ITEMS[id].quality === 'rare');
      if (allRare) expect(LEGACY_GREEN_ELITE_QUESTS.has(questId), questId).toBe(false);
      else greens.push(questId);
    }
    expect(greens.sort()).toEqual([...LEGACY_GREEN_ELITE_QUESTS].sort());
  });

  it('reuses a rare set at or above the quest level, never below it', () => {
    const sets = [
      { ids: ['low'], level: 18, order: 0, from: 'low' },
      { ids: ['exact'], level: 20, order: 2, from: 'exact' },
      { ids: ['high'], level: 22, order: 1, from: 'high' },
    ];
    expect(pickRareSet(sets, 20, () => 0)?.from).toBe('exact');
    expect(pickRareSet(sets, 23, () => 0)).toBeUndefined();
    // Equal levels: the less offered set wins, then the authored order.
    const tied = [
      { ids: ['a'], level: 20, order: 0, from: 'a' },
      { ids: ['b'], level: 20, order: 1, from: 'b' },
    ];
    expect(pickRareSet(tied, 20, (ids) => (ids[0] === 'a' ? 2 : 1))?.from).toBe('b');
    expect(pickRareSet(tied, 20, () => 0)?.from).toBe('a');
  });

  it('plans every eligible quest in the generator order', () => {
    // The add-only planner walks the same eligible list the reroll does.
    const ids = eligibleQuests().map(({ q }) => q.id);
    for (const id of ISLE) expect(ids, id).toContain(id);
    expect(Object.keys(QUEST_CHOICE_REWARDS).sort()).toEqual([...ids].sort());
  });
});
