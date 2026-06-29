// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const filterData = {
  soft: [{ id: 1, word: 'darn' }],
  hard: [{ id: 2, word: 'slur' }],
  config: { warningsBeforeMute: 2, muteLadderSeconds: [3600, 7200] },
  accounts: [
    {
      id: 9,
      username: 'troll',
      isAdmin: false,
      chatStrikes: 3,
      chatMutedUntil: '2999-01-01T00:00:00Z',
    },
  ],
};

const apiPost = vi.fn();
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async () => filterData),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ChatFilter from '../../src/admin/pages/ChatFilter.svelte';

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
});

describe('ChatFilter', () => {
  it('renders both word tiers and the moderated accounts', async () => {
    render(ChatFilter);
    expect(await screen.findByText('darn')).toBeInTheDocument();
    expect(screen.getByText('slur')).toBeInTheDocument();
    expect(screen.getByText('troll')).toBeInTheDocument();
  });

  it('saves the escalation config', async () => {
    render(ChatFilter);
    await screen.findByText('darn');
    await fireEvent.click(screen.getByText(t('chatFilter.saveConfig')));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/chat-filter/config', {
      warningsBeforeMute: 2,
      muteLadderSeconds: [3600, 7200],
    });
  });

  it('deletes a soft word by id', async () => {
    render(ChatFilter);
    await screen.findByText('darn');
    const delButtons = screen.getAllByTitle(t('chatFilter.removeWord'));
    await fireEvent.click(delButtons[0]);
    expect(apiPost).toHaveBeenCalledWith('/admin/api/chat-filter/words/1/delete', {});
  });

  it('resets strikes for a moderated account', async () => {
    render(ChatFilter);
    await screen.findByText('troll');
    await fireEvent.click(screen.getByText(t('chatMod.resetStrikes')));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/moderation/accounts/9/reset-strikes', {});
  });

  it('asks for a reason before lifting a chat mute', async () => {
    render(ChatFilter);
    await screen.findByText('troll');
    await fireEvent.click(screen.getByText(t('chatMod.liftMute')));
    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'appeal accepted' } });
    await fireEvent.click(screen.getByText(t('dialog.confirm')));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/moderation/accounts/9/lift-mute', {
      reason: 'appeal accepted',
    });
  });
});
