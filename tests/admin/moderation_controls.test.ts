// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AccountModerationActions from '../../src/admin/components/AccountModerationActions.svelte';
import ChatModerationControls from '../../src/admin/components/ChatModerationControls.svelte';
import { t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';

describe('AccountModerationActions', () => {
  it('labels the current suspension reason and asks for a reason after action selection', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(AccountModerationActions, {
      props: {
        target: {
          id: 42,
          isAdmin: false,
          bannedAt: null,
          suspendedUntil: '2999-01-01T00:00:00Z',
          moderationReason: 'repeated harassment',
        },
        onSubmit,
      },
    });

    expect(
      screen.getByText(t('detail.suspensionReason', { value: 'repeated harassment' })),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t('detail.notePlaceholder'))).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: t('detail.suspend24h') })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: t('detail.unsuspend') }));
    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'appeal accepted' } });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/unsuspend',
      body: { reason: 'appeal accepted' },
    });
  });

  it('shows the ban reason and only offers unban for a banned account', () => {
    render(AccountModerationActions, {
      props: {
        target: {
          id: 42,
          isAdmin: false,
          bannedAt: '2026-06-01T00:00:00Z',
          suspendedUntil: null,
          moderationReason: 'cheating',
        },
        onSubmit: vi.fn(async () => true),
      },
    });

    expect(screen.getByText(t('detail.banReason', { value: 'cheating' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('detail.unban') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('detail.ban') })).not.toBeInTheDocument();
  });

  it('does not present a stale moderation reason for an active account', () => {
    render(AccountModerationActions, {
      props: {
        target: {
          id: 42,
          isAdmin: false,
          bannedAt: null,
          suspendedUntil: null,
          moderationReason: 'previous unban review',
        },
        onSubmit: vi.fn(async () => true),
      },
    });

    expect(screen.queryByText(/previous unban review/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('detail.suspend24h') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('detail.unsuspend') })).not.toBeInTheDocument();
  });

  it('does not offer account sanctions for an admin account', () => {
    render(AccountModerationActions, {
      props: {
        target: {
          id: 42,
          isAdmin: true,
          bannedAt: null,
          suspendedUntil: null,
          moderationReason: '',
        },
        onSubmit: vi.fn(async () => true),
      },
    });

    expect(
      screen.queryByRole('region', { name: t('detail.accountActions') }),
    ).not.toBeInTheDocument();
  });
});

describe('ChatModerationControls', () => {
  it('offers only an audited lift action while chat is muted', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(ChatModerationControls, {
      props: {
        target: {
          id: 42,
          isAdmin: false,
          bannedAt: null,
          chatMutedUntil: '2999-01-01T00:00:00Z',
          chatMuteReason: 'chat abuse',
          chatStrikes: 2,
        },
        onSubmit,
        onReset: vi.fn(),
      },
    });

    expect(screen.getByText(t('chatMod.muteReason', { value: 'chat abuse' }))).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t('detail.notePlaceholder'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('detail.chatMute1h') })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('chatMod.liftChatMute') }));
    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'appeal accepted' } });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/lift-mute',
      body: { reason: 'appeal accepted' },
    });
  });

  it('offers mute actions while chat is not muted', () => {
    render(ChatModerationControls, {
      props: {
        target: {
          id: 42,
          isAdmin: false,
          bannedAt: null,
          chatMutedUntil: null,
          chatMuteReason: '',
          chatStrikes: 0,
        },
        onSubmit: vi.fn(async (_pending: PendingAction) => true),
        onReset: vi.fn(),
      },
    });

    expect(screen.getByRole('button', { name: t('detail.chatMute1h') })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('chatMod.liftChatMute') }),
    ).not.toBeInTheDocument();
  });
});
