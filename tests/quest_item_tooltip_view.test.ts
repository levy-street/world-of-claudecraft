// Pure-core pins for the quest-item story tooltip model. The host (Hud.itemTooltip)
// consumes the model for title/kind gold, related quest, progress, rules, and
// orphaned lines; these tests own the MODEL decisions only (HTML escape and
// tEntity localization stay in the host). A source pin keeps the hud composition
// from drifting back to "Common Quest Item" + a second Quest Item desc.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUEST_ITEM_NAME_COLOR } from '../src/ui/item_name_color';
import {
  QUEST_ITEM_TOOLTIP_COLOR,
  type QuestItemTooltipInput,
  questItemTooltipModel,
  questItemTooltipRelatedKey,
} from '../src/ui/quest_item_tooltip_view';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOAR_OBJECTIVES = [{ type: 'collect', itemId: 'boar_hide', count: 5 }] as const;

function baseQuest(overrides: Partial<QuestItemTooltipInput> = {}): QuestItemTooltipInput {
  return {
    kind: 'quest',
    itemId: 'boar_hide',
    questId: 'q_boars',
    questKnown: true,
    objectives: BOAR_OBJECTIVES,
    ...overrides,
  };
}

describe('quest_item_tooltip_view: non-quest', () => {
  it('returns null for every non-quest ItemKind', () => {
    for (const kind of [
      'weapon',
      'armor',
      'held_offhand',
      'junk',
      'food',
      'drink',
      'tool',
      'potion',
      'elixir',
      'bag',
      'mount',
    ]) {
      expect(questItemTooltipModel({ kind, itemId: 'x' }), kind).toBeNull();
    }
  });

  it('is case-sensitive: only the exact sim kind token matches', () => {
    expect(questItemTooltipModel({ kind: 'Quest', itemId: 'boar_hide' })).toBeNull();
    expect(questItemTooltipModel({ kind: 'QUEST', itemId: 'boar_hide' })).toBeNull();
    expect(questItemTooltipModel({ kind: '', itemId: 'boar_hide' })).toBeNull();
  });
});

describe('quest_item_tooltip_view: purpose chrome', () => {
  it('uses quest gold title mode and never shows a quality word', () => {
    const model = questItemTooltipModel(baseQuest());
    expect(model).not.toBeNull();
    expect(model!.titleColorMode).toBe('quest');
    expect(model!.showQuality).toBe(false);
    expect(model!.kindLineKey).toBe('itemUi.kind.quest');
    expect(QUEST_ITEM_TOOLTIP_COLOR).toBe('var(--color-quest)');
    // Single source: tooltip gold aliases the shared name-color token.
    expect(QUEST_ITEM_TOOLTIP_COLOR).toBe(QUEST_ITEM_NAME_COLOR);
  });

  it('always carries the rules footer key (active and orphaned)', () => {
    expect(questItemTooltipModel(baseQuest({ log: null }))!.rulesKey).toBe(
      'itemUi.tooltip.questRules',
    );
    expect(
      questItemTooltipModel(baseQuest({ log: { counts: [1], state: 'active' } }))!.rulesKey,
    ).toBe('itemUi.tooltip.questRules');
  });
});

describe('quest_item_tooltip_view: related quest', () => {
  it('exposes relatedQuestId when questId resolves', () => {
    const model = questItemTooltipModel(baseQuest());
    expect(model!.relatedQuestId).toBe('q_boars');
  });

  it('omits relatedQuestId when the quest def is unknown', () => {
    const model = questItemTooltipModel(baseQuest({ questKnown: false }));
    expect(model!.relatedQuestId).toBeUndefined();
  });

  it('omits relatedQuestId when the item has no questId', () => {
    const model = questItemTooltipModel(baseQuest({ questId: undefined, objectives: undefined }));
    expect(model!.relatedQuestId).toBeUndefined();
  });

  it('pins the related-quest i18n key for the host', () => {
    expect(questItemTooltipRelatedKey()).toBe('itemUi.tooltip.questRelated');
  });
});

describe('quest_item_tooltip_view: live progress', () => {
  it('resolves collect progress from the active log entry', () => {
    const model = questItemTooltipModel(
      baseQuest({
        log: { counts: [3], state: 'active' },
      }),
    );
    expect(model!.progress).toEqual({
      objectiveIndex: 0,
      current: 3,
      required: 5,
    });
    expect(model!.orphaned).toBe(false);
  });

  it('still shows progress when ready to turn in (counts met)', () => {
    const model = questItemTooltipModel(
      baseQuest({
        log: { counts: [5], state: 'ready' },
      }),
    );
    expect(model!.progress).toEqual({
      objectiveIndex: 0,
      current: 5,
      required: 5,
    });
    expect(model!.orphaned).toBe(false);
  });

  it('prefers resolvedCounts over the objective count when present', () => {
    const model = questItemTooltipModel(
      baseQuest({
        log: { counts: [2], state: 'active', resolvedCounts: [8] },
      }),
    );
    expect(model!.progress).toEqual({
      objectiveIndex: 0,
      current: 2,
      required: 8,
    });
  });

  it('matches gather-with-item objectives the same way as collect', () => {
    const model = questItemTooltipModel(
      baseQuest({
        itemId: 'rare_ore',
        objectives: [
          { type: 'kill', itemId: undefined, count: 3 },
          { type: 'gather', itemId: 'rare_ore', count: 4 },
        ],
        log: { counts: [1, 2], state: 'active' },
      }),
    );
    expect(model!.progress).toEqual({
      objectiveIndex: 1,
      current: 2,
      required: 4,
    });
  });

  it('uses resolvedCounts at the matched objective index, not index 0', () => {
    const model = questItemTooltipModel(
      baseQuest({
        itemId: 'rare_ore',
        objectives: [
          { type: 'kill', count: 3 },
          { type: 'gather', itemId: 'rare_ore', count: 4 },
        ],
        log: { counts: [1, 2], state: 'active', resolvedCounts: [99, 8] },
      }),
    );
    expect(model!.progress).toEqual({
      objectiveIndex: 1,
      current: 2,
      required: 8,
    });
  });

  it('ignores collect objectives for a different itemId', () => {
    const model = questItemTooltipModel(
      baseQuest({
        itemId: 'other_hide',
        log: { counts: [3], state: 'active' },
      }),
    );
    expect(model!.progress).toBeUndefined();
    // Still held: not orphaned even without a matching collect row.
    expect(model!.orphaned).toBe(false);
  });

  it('ignores a matching itemId on a non-collect/gather objective type', () => {
    const model = questItemTooltipModel(
      baseQuest({
        objectives: [{ type: 'kill', itemId: 'boar_hide', count: 5 }],
        log: { counts: [3], state: 'active' },
      }),
    );
    expect(model!.progress).toBeUndefined();
  });

  it('does not invent progress when the quest is not in the log', () => {
    const model = questItemTooltipModel(baseQuest({ log: null }));
    expect(model!.progress).toBeUndefined();
  });

  it('does not invent progress for a completed (done) quest', () => {
    const model = questItemTooltipModel(
      baseQuest({
        log: { counts: [5], state: 'done' },
      }),
    );
    expect(model!.progress).toBeUndefined();
  });
});

describe('quest_item_tooltip_view: orphaned', () => {
  it('marks orphaned when the quest is not in the log', () => {
    const model = questItemTooltipModel(baseQuest({ log: null }));
    expect(model!.orphaned).toBe(true);
    expect(model!.orphanedKey).toBe('itemUi.tooltip.questOrphaned');
  });

  it('marks orphaned after the quest is done (items may linger until discard)', () => {
    const model = questItemTooltipModel(
      baseQuest({
        log: { counts: [5], state: 'done' },
      }),
    );
    expect(model!.orphaned).toBe(true);
  });

  it('marks orphaned when the item has no questId', () => {
    const model = questItemTooltipModel({
      kind: 'quest',
      itemId: 'mystery_token',
    });
    expect(model!.orphaned).toBe(true);
    expect(model!.relatedQuestId).toBeUndefined();
    expect(model!.progress).toBeUndefined();
  });

  it('is not orphaned while active or ready', () => {
    expect(
      questItemTooltipModel(baseQuest({ log: { counts: [0], state: 'active' } }))!.orphaned,
    ).toBe(false);
    expect(
      questItemTooltipModel(baseQuest({ log: { counts: [5], state: 'ready' } }))!.orphaned,
    ).toBe(false);
  });
});

describe('hud composition source pin', () => {
  it('Hud.itemTooltip composes the pure model and never reopens Common Quest Item', () => {
    // Whole-line // comments are stripped before scanning so prose cannot
    // trip the negative pins (same trap as gather_tool_tooltip source pin).
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    expect(hudSrc).toContain('questItemTooltipModel');
    expect(hudSrc).toContain('QUEST_ITEM_TOOLTIP_COLOR');
    expect(hudSrc).toContain('questItemTooltipStoryHtml');
    // Legacy double line: qualityKind for quest kinds, and a second plain
    // questItem desc, must stay dead for the purpose-class treatment.
    expect(hudSrc).not.toContain("item.kind === 'quest')\n      html +=");
    expect(hudSrc).not.toContain("t('itemUi.tooltip.questItem')");
  });
});
