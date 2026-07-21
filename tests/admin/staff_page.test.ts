// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const staffData = {
  rows: [
    { accountId: 1, username: 'founder', roles: ['superadmin'], lastLogin: null },
    {
      accountId: 2,
      username: 'operator',
      roles: ['viewer', 'moderator'],
      lastLogin: '2026-07-01T00:00:00Z',
    },
    {
      accountId: 3,
      username: 'modbob',
      roles: ['moderator'],
      lastLogin: '2026-06-15T00:00:00Z',
    },
  ],
  assignableRoles: ['admin', 'moderator', 'viewer'],
};

const historyData = {
  rows: [
    {
      id: 5,
      accountId: 3,
      username: 'modbob',
      adminUsername: null,
      rolesBefore: [],
      rolesAfter: ['moderator'],
      createdAt: '2026-06-15T00:00:00Z',
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
  apiGet: vi.fn(async (path: string) => (path === '/admin/api/staff' ? staffData : historyData)),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'operator',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import Staff from '../../src/admin/pages/Staff.svelte';
import { auth } from '../../src/admin/state/auth.svelte';
import { grantPermissions } from './_grant';

// The username also appears in the history table below, so take the first
// occurrence (the staff table renders first).
function rowFor(username: string): HTMLElement {
  const cell = screen.getAllByText(username)[0];
  const row = cell.closest('tr');
  if (!row) throw new Error(`no table row for ${username}`);
  return row;
}

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  grantPermissions();
  auth.name = 'operator';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Staff page', () => {
  it('renders superadmin and own rows read-only, other staff editable', async () => {
    render(Staff);
    await screen.findByText('founder');

    expect(within(rowFor('founder')).getByText(t('staff.managedByScript'))).toBeInTheDocument();
    expect(within(rowFor('founder')).queryAllByRole('checkbox')).toHaveLength(0);

    expect(within(rowFor('operator')).getByText(t('staff.ownAccount'))).toBeInTheDocument();
    expect(within(rowFor('operator')).queryAllByRole('checkbox')).toHaveLength(0);

    expect(within(rowFor('modbob')).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(rowFor('modbob')).getByRole('button', { name: t('staff.save') })).toBeDisabled();
  });

  it('saves an edited role set through the staff endpoint', async () => {
    render(Staff);
    await screen.findAllByText('modbob');

    const row = rowFor('modbob');
    const checkboxes = within(row).getAllByRole('checkbox');
    // assignableRoles order: admin, moderator, viewer.
    await fireEvent.click(checkboxes[2]);
    const save = within(row).getByRole('button', { name: t('staff.save') });
    expect(save).toBeEnabled();
    await fireEvent.click(save);

    expect(apiPost).toHaveBeenCalledWith('/admin/api/staff/roles', {
      username: 'modbob',
      roles: ['moderator', 'viewer'],
    });
  });

  it('grants roles to a new staff member from the add form', async () => {
    render(Staff);
    await screen.findAllByText('modbob');

    await fireEvent.input(screen.getByPlaceholderText(t('staff.usernamePlaceholder')), {
      target: { value: 'newstaff' },
    });
    const form = screen
      .getByPlaceholderText(t('staff.usernamePlaceholder'))
      .closest('form') as HTMLFormElement;
    const formChecks = within(form).getAllByRole('checkbox');
    // assignableRoles order: admin, moderator, viewer -> index 1 = moderator.
    await fireEvent.click(formChecks[1]);
    await fireEvent.submit(form);

    expect(apiPost).toHaveBeenCalledWith('/admin/api/staff/roles', {
      username: 'newstaff',
      roles: ['moderator'],
    });
  });

  it('shows the audit history and attributes script changes', async () => {
    render(Staff);

    expect(await screen.findByText(t('staff.historyTitle'))).toBeInTheDocument();
    const scriptCell = screen.getByText(t('staff.viaScript'));
    const historyTable = scriptCell.closest('table');
    if (!historyTable) throw new Error('history table not found');
    expect(within(historyTable).getByText(t('staff.role.moderator'))).toBeInTheDocument();
  });
});
