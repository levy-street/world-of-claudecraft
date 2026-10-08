import { describe, expect, it } from 'vitest';
import { authoredLettersById, BOT_REPORT_REWARD_LETTER } from '../src/sim/content/letters';
import { logEventFeedback, REPORT_REWARD_KEY } from '../src/ui/log_event_feedback_core';
import { localizeServerText } from '../src/ui/server_i18n';

describe('bot report reward feedback', () => {
  it('shows the ban notice in a banner and General chat', () => {
    const text = 'An account you reported has been banned';
    expect(REPORT_REWARD_KEY).toBe('hudChrome.reportReward.banned');
    expect(logEventFeedback({ type: 'log', pid: 7, text })).toEqual({
      combat: false,
      bubble: null,
      bannerKey: REPORT_REWARD_KEY,
    });
    expect(localizeServerText(text)).toBe(text);
  });

  it('does not show a reward banner for a submitted report or ordinary log', () => {
    for (const text of ['Your report has been submitted.', 'You receive 5 gold.']) {
      expect(logEventFeedback({ type: 'log', pid: 7, text }).bannerKey).toBeNull();
    }
  });

  it('preserves combat flavor routing, personal narrative and actionable cues', () => {
    const event = { type: 'log' as const, entityId: 3, text: 'Dragon yells, "Beware!"' };
    expect(logEventFeedback(event)).toEqual({
      combat: true,
      bubble: 'yell',
      bannerKey: null,
    });
    expect(logEventFeedback({ ...event, pid: 7 }).combat).toBe(false);
    expect(logEventFeedback({ ...event, telegraph: true }).combat).toBe(false);
    expect(logEventFeedback({ type: 'log', text: event.text }).bubble).toBeNull();
  });

  it('registers an instant thank-you letter without a gold reward', () => {
    expect(BOT_REPORT_REWARD_LETTER.letterId).toBe('bot_report_reward');
    expect(authoredLettersById().bot_report_reward).toBe(BOT_REPORT_REWARD_LETTER);
    expect(BOT_REPORT_REWARD_LETTER.subject).toBe('An account you reported has been banned');
    expect(BOT_REPORT_REWARD_LETTER.body).toContain('Thank you');
    expect(BOT_REPORT_REWARD_LETTER.body).toContain('keep the game fair');
    expect(BOT_REPORT_REWARD_LETTER.copper).toBe(0);
    expect(BOT_REPORT_REWARD_LETTER.body).not.toContain('gold');
    expect(BOT_REPORT_REWARD_LETTER.delaySeconds).toBe(0);
  });
});
