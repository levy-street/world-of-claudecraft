// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ModerationHistory from '../../src/admin/components/ModerationHistory.svelte';
import { fmtDate } from '../../src/admin/format';
import { t } from '../../src/admin/i18n';

describe('ModerationHistory', () => {
  it('renders who performed each action, when, why, and its expiry', () => {
    render(ModerationHistory, {
      entries: [
        {
          id: 12,
          action: 'suspend',
          reason: 'harassment',
          createdAt: '2026-06-01T02:00:00Z',
          expiresAt: '2026-06-02T02:00:00Z',
          adminAccountId: 3,
          adminUsername: 'moderator',
        },
        {
          id: 11,
          action: 'chat_unmute',
          reason: 'appeal accepted',
          createdAt: '2026-05-30T02:00:00Z',
          expiresAt: null,
          adminAccountId: 3,
          adminUsername: 'moderator',
        },
      ],
    });

    expect(screen.getByText(t('moderationHistory.actionSuspend'))).toBeInTheDocument();
    expect(screen.getAllByText(t('moderationHistory.by', { name: 'moderator' }))).toHaveLength(2);
    expect(screen.getByText('harassment')).toBeInTheDocument();
    expect(screen.getByText(t('moderationHistory.actionChatUnmute'))).toBeInTheDocument();
    expect(screen.getByText('appeal accepted')).toBeInTheDocument();
    expect(screen.getByText(fmtDate('2026-06-01T02:00:00Z'))).toBeInTheDocument();
    expect(
      screen.getByText(
        t('moderationHistory.expires', {
          value: fmtDate('2026-06-02T02:00:00Z'),
        }),
      ),
    ).toBeInTheDocument();
  });

  it('renders an empty state', () => {
    render(ModerationHistory, { entries: [] });
    expect(screen.getByText(t('moderationHistory.empty'))).toBeInTheDocument();
  });
});
