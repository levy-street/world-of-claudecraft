import { describe, expect, it } from 'vitest';
import { questProgressEventText } from '../src/ui/quest_progress_text';

describe('questProgress event localization', () => {
  it('uses the structured objective identity and values instead of parsing English text', () => {
    expect(
      questProgressEventText({
        questId: 'q_wolves',
        objectiveIndex: 0,
        current: 3,
        required: 8,
        text: 'this legacy fallback must not be parsed',
      }),
    ).toBe('Forest Wolf slain: 3/8');
  });

  it('keeps the English-text parser only as compatibility for an older server payload', () => {
    expect(
      questProgressEventText({
        questId: 'q_wolves',
        text: 'Forest Wolf slain: 2/8',
      }),
    ).toBe('Forest Wolf slain: 2/8');
  });

  it('returns an unrecognized legacy payload unchanged', () => {
    expect(
      questProgressEventText({
        questId: 'missing_quest',
        text: 'Unrecognized progress',
      }),
    ).toBe('Unrecognized progress');
  });
});
