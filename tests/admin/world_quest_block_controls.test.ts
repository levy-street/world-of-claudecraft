// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import WorldQuestBlockControls from '../../src/admin/components/WorldQuestBlockControls.svelte';
import { t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';
import { blockWorldQuests, unblockWorldQuests } from '../../src/admin/world_quest_block_form';

// The world quest block panel: block-vs-unblock branches on the detail's
// worldQuestBlock state, both arms require a reason, and admin targets get no
// panel at all (the cheater_mark_controls.test.ts pattern).

const UNBLOCKED = { id: 42, isAdmin: false, worldQuestBlock: null };
const BLOCKED = {
  id: 42,
  isAdmin: false,
  worldQuestBlock: { reason: 'world quest bot', blockedAt: '2026-10-09T08:00:00.000Z' },
};

async function confirmWithReason(reason: string): Promise<void> {
  const input = screen.getByPlaceholderText(t('detail.notePlaceholder'));
  await fireEvent.input(input, { target: { value: reason } });
  await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));
}

describe('world quest block form builders', () => {
  it('builds the block and unblock endpoints with the reason as the body', () => {
    const block = blockWorldQuests(42, 'bot');
    const unblock = unblockWorldQuests(42, 'appeal');
    expect(block).toMatchObject({
      pending: {
        endpoint: '/admin/api/moderation/accounts/42/world-quests-block',
        body: { reason: 'bot' },
        danger: true,
      },
    });
    expect(unblock).toMatchObject({
      pending: {
        endpoint: '/admin/api/moderation/accounts/42/world-quests-unblock',
        body: { reason: 'appeal' },
      },
    });
  });

  it('refuses an empty reason on both arms', () => {
    expect(blockWorldQuests(42, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(unblockWorldQuests(42, '')).toEqual({ errorKey: 'alert.noteRequired' });
  });
});

describe('WorldQuestBlockControls', () => {
  it('offers the block on an unblocked account and submits it with the reason', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(WorldQuestBlockControls, { props: { target: UNBLOCKED, onSubmit } });

    expect(screen.queryByRole('button', { name: t('detail.worldQuestBlockLift') })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: t('detail.worldQuestBlockApply') }));
    await confirmWithReason('24h world quest circuits from one proxy');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/world-quests-block',
      body: { reason: '24h world quest circuits from one proxy' },
    });
  });

  it('shows the live block and offers only the unblock', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(WorldQuestBlockControls, { props: { target: BLOCKED, onSubmit } });

    expect(
      screen.getByText(t('detail.worldQuestBlockReason', { value: 'world quest bot' }), {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('detail.worldQuestBlockApply') })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: t('detail.worldQuestBlockLift') }));
    await confirmWithReason('appeal upheld');

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/world-quests-unblock',
      body: { reason: 'appeal upheld' },
    });
  });

  it('renders nothing for an admin target', () => {
    render(WorldQuestBlockControls, {
      props: { target: { ...UNBLOCKED, isAdmin: true }, onSubmit: vi.fn() },
    });
    expect(screen.queryByRole('button', { name: t('detail.worldQuestBlockApply') })).toBeNull();
    expect(screen.queryByLabelText(t('detail.worldQuestBlockActions'))).toBeNull();
  });
});
