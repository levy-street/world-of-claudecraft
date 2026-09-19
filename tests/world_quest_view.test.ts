import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createGroundObject } from '../src/sim/entity';
import { entityDisplayName } from '../src/ui/entity_display_core';
import {
  worldQuestDisplayName,
  worldQuestObjectiveLabel,
  worldQuestRewardLine,
  worldQuestRewardText,
  worldQuestStatusText,
  worldQuestTimeRemainingText,
} from '../src/ui/world_quest_view';

describe('world quest view', () => {
  it('distinguishes the Last Keep defense from the existing cannon quest', () => {
    expect(worldQuestDisplayName('wq_last_keep_cannon')).toBe('The Last Keep Cannon');
    expect(worldQuestObjectiveLabel('wq_last_keep_cannon')).toBe(
      'Defend the approach to The Last Keep',
    );
    expect(worldQuestDisplayName('wq_evergarden_cannon')).toBe('North Watch Cannon');
    expect(worldQuestObjectiveLabel('wq_evergarden_cannon')).toBe('Defend the north watch');
    const cannon = createGroundObject(1, 'last_keep_cannon', 'raw station name', {
      x: 0,
      y: 0,
      z: 0,
    });
    cannon.templateId = 'last_keep_cannon';
    expect(entityDisplayName(cannon)).toBe('The Last Keep Cannon');
  });
  it('renders complete localized templates for names, states, and every reward kind', () => {
    expect(worldQuestDisplayName('wq_eastbrook_bandits')).toContain(':');
    expect(worldQuestStatusText('available')).toBe('Available world quest');
    expect(worldQuestStatusText('active')).toBe('Active world quest');

    // Every quest pays the bundle: XP and the shared copper purse, plus any extra.
    const plain = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const formerCopper = WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers;
    const extra = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    expect(worldQuestRewardText(plain, 20)).toContain('2,784 experience');
    expect(worldQuestRewardText(plain, 20)).toContain('31');
    expect(worldQuestRewardText(formerCopper, 10)).toContain('experience');
    expect(worldQuestRewardText(formerCopper, 10)).toContain('19');
    expect(worldQuestRewardText(extra, 20)).toContain('Item reward:');
    const viewer = { level: 20, cls: 'warrior' as const, cycle: 'wq1_0' };
    expect(worldQuestRewardLine(extra, viewer)).toContain('Rewards: ');
    expect(worldQuestRewardLine(extra, viewer)).toContain('Item reward:');
    expect(worldQuestRewardLine(extra, viewer)).toContain('standing');
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
    expect(worldQuestObjectiveLabel('wq_farshore_salvage')).toBe(
      'Salvage debris washed along the strand from the wreck northwest of Gullhaven',
    );
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
