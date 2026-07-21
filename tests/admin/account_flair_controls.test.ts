// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AccountFlairControls from '../../src/admin/components/AccountFlairControls.svelte';
import { t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';

// The flair controls are NOT moderation: no reason is required, and an admin target
// still gets them (a dev who streams is a legitimate streamer). The component confirms
// through ModerationActionPrompt and submits through the parent's onSubmit.

const target = {
  id: 42,
  isAi: false,
  isStreamer: false,
  streamerLinks: {},
};

async function confirmPrompt(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));
}

describe('AccountFlairControls', () => {
  it('marks an account as AI after confirmation, with no reason required', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(AccountFlairControls, { props: { target, onSubmit } });

    expect(screen.getByText(t('detail.aiNotMarked'))).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: t('detail.markAi') }));
    await confirmPrompt();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/accounts/42/ai',
      body: { ai: true },
    });
  });

  it('offers the inverse action for an account that already carries the flair', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(AccountFlairControls, {
      props: {
        target: { ...target, isAi: true, isStreamer: true },
        onSubmit,
      },
    });

    expect(screen.getByRole('button', { name: t('detail.unmarkAi') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('detail.markAi') })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('detail.unmarkStreamer') }));
    await confirmPrompt();

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/accounts/42/streamer',
      body: { streamer: false, links: {} },
    });
  });

  it('pre-fills the link inputs and saves the edited links with the flag unchanged', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(AccountFlairControls, {
      props: {
        target: {
          ...target,
          isStreamer: true,
          streamerLinks: { twitch: 'https://twitch.tv/old' },
        },
        onSubmit,
      },
    });

    const twitch = screen.getByLabelText(t('detail.streamerLinkTwitch')) as HTMLInputElement;
    expect(twitch.value).toBe('https://twitch.tv/old');
    await fireEvent.input(twitch, { target: { value: 'https://twitch.tv/new' } });
    await fireEvent.input(screen.getByLabelText(t('detail.streamerLinkKick')), {
      target: { value: 'https://kick.com/new' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('detail.saveStreamerLinks') }));
    await confirmPrompt();

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/accounts/42/streamer',
      body: {
        streamer: true,
        links: { twitch: 'https://twitch.tv/new', kick: 'https://kick.com/new' },
      },
    });
  });

  it('refuses a hostile link and submits nothing', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(AccountFlairControls, { props: { target, onSubmit } });

    await fireEvent.input(screen.getByLabelText(t('detail.streamerLinkX')), {
      target: { value: 'javascript:alert(1)' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('detail.markStreamer') }));
    await confirmPrompt();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(t('alert.invalidStreamerUrl'));
    alert.mockRestore();
  });
});
