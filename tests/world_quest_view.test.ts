import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import {
  worldQuestDisplayName,
  worldQuestObjectiveLabel,
  worldQuestRewardLine,
  worldQuestRewardText,
  worldQuestStatusText,
  worldQuestTimeRemainingText,
} from '../src/ui/world_quest_view';

describe('world quest view', () => {
  it('renders complete localized templates for names, states, and every reward kind', () => {
    expect(worldQuestDisplayName('wq_eastbrook_bandits')).toContain(':');
    expect(worldQuestStatusText('available')).toBe('Available world quest');
    expect(worldQuestStatusText('active')).toBe('Active world quest');

    const xp = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const copper = WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers;
    const item = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    expect(worldQuestRewardText(xp, 20)).toBe('2,784 experience');
    expect(worldQuestRewardText(copper, 10)).toContain('42');
    expect(worldQuestRewardText(item, 20)).toContain('Item reward:');
    expect(worldQuestRewardLine(item, 20)).toContain('Rewards: Item reward:');
  });

  it('uses a localized sentence rather than exposing a raw unknown id', () => {
    expect(worldQuestDisplayName('wq_from_a_future_server')).toBe(
      'Unknown world quest (wq_from_a_future_server)',
    );
  });

  it('renders the rotation deadline with days, hours, and minutes', () => {
    const now = Date.UTC(2026, 7, 31, 12, 0);
    const expiresAt = now + ((2 * 24 + 14) * 60 + 16) * 60_000;
    expect(worldQuestTimeRemainingText(expiresAt, now)).toBe(
      'Expires in 2 days, 14 hours, and 16 minutes',
    );
  });

  it('describes each non-combat objective instead of showing a mob name', () => {
    expect(worldQuestObjectiveLabel('wq_eastbrook_bandits')).toBe('Load freight into the wagon');
    expect(worldQuestObjectiveLabel('wq_frostveil_howlers')).toBe('Recover Sprung Fen Trap');
    expect(worldQuestObjectiveLabel('wq_galecrest_wisps')).toBe('Redirect the ley beam');
    expect(worldQuestObjectiveLabel('wq_palmreach_confections')).toBe(
      'Match enchanted confections',
    );
    expect(worldQuestObjectiveLabel('wq_farshore_salvage')).toBe('Salvage shipwreck debris');
    expect(worldQuestObjectiveLabel('wq_eastbrook_caravan')).toBe(
      'Escort the caravan: Eastbrook Vale',
    );
    expect(worldQuestObjectiveLabel('wq_willowfen_caravan')).toBe(
      'Escort the caravan: The Willowfen',
    );
    expect(worldQuestObjectiveLabel('wq_frostveil_caravan')).toBe(
      'Escort the caravan: The Frostveil Reach',
    );
  });
});
