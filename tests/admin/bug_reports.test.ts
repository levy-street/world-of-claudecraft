// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

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
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import BugReports from '../../src/admin/pages/BugReports.svelte';

describe('BugReports', () => {
  it('lists reports and opens a screenshot overlay on demand', async () => {
    render(BugReports);
    expect(await screen.findByText('stuck in wall')).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('bugReports.viewScreenshot')));
    const img = await screen.findByAltText(t('bugReports.screenshotAlt'));
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });
});
