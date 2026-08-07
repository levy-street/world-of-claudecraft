// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPage = {
  rows: [
    {
      id: 5,
      account_id: 1,
      character_id: 2,
      character_name: 'Frodo',
      realm: 'eastbrook',
      pos_x: 1,
      pos_y: 2,
      pos_z: 3,
      description: 'stuck in wall',
      has_screenshot: true,
      meta: { build: 'abc' },
      status: 'open',
      created_at: '2026-06-01T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
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
  apiGet: vi.fn(async (path: string) => {
    if (path.includes('/screenshot')) return { screenshot: 'data:image/png;base64,AAAA' };
    return listPage;
  }),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import BugReports from '../../src/admin/pages/BugReports.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
});

describe('BugReports', () => {
  it('lists reports and opens a screenshot overlay on demand', async () => {
    grantPermissions();
    render(BugReports);
    expect(await screen.findByText('stuck in wall')).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('bugReports.viewScreenshot')));
    const img = await screen.findByAltText(t('bugReports.screenshotAlt'));
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('resolves an open report with a note through the confirm dialog', async () => {
    grantPermissions();
    render(BugReports);
    await screen.findByText('stuck in wall');

    await fireEvent.click(screen.getByText(t('bugReports.resolve')));
    expect(await screen.findByText(t('bugReports.confirmResolve'))).toBeInTheDocument();
    const noteInput = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(noteInput, { target: { value: 'fixed in 0.34.1' } });
    await fireEvent.click(screen.getByText(t('dialog.confirm')));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/bug-reports/5/resolve', {
      note: 'fixed in 0.34.1',
    });
  });

  it('dismisses an open report with no note (the note is optional)', async () => {
    grantPermissions();
    render(BugReports);
    await screen.findByText('stuck in wall');

    await fireEvent.click(screen.getByText(t('bugReports.dismiss')));
    expect(await screen.findByText(t('bugReports.confirmDismiss'))).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('dialog.confirm')));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/bug-reports/5/dismiss', { note: '' });
  });

  it('hides the resolve/dismiss actions without moderation.act', async () => {
    grantPermissions(['support.read']);
    render(BugReports);
    await screen.findByText('stuck in wall');
    expect(screen.queryByText(t('bugReports.resolve'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('bugReports.dismiss'))).not.toBeInTheDocument();
  });
});
