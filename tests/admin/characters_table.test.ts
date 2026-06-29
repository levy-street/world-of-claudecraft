// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CharactersTable from '../../src/admin/components/CharactersTable.svelte';
import { t } from '../../src/admin/i18n';
import type { CharacterRow } from '../../src/admin/types';

const rows: CharacterRow[] = [
  {
    id: 1,
    name: 'Aragorn',
    class: 'warrior',
    level: 60,
    accountId: 1,
    username: 'viggo',
    copper: 12345,
    xp: 999,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

describe('CharactersTable', () => {
  it('renders rows and shows the sort arrow on the active column', () => {
    render(CharactersTable, { rows, sort: 'level', dir: 'desc', onSort: () => {} });
    expect(screen.getByText('Aragorn')).toBeInTheDocument();
    expect(screen.getByText(/▼/)).toBeInTheDocument();
  });

  it('calls onSort with the clicked column', async () => {
    const onSort = vi.fn();
    render(CharactersTable, { rows, sort: 'level', dir: 'desc', onSort });
    await fireEvent.click(screen.getByText(new RegExp(t('characters.colName'))));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('shows the empty message for no rows', () => {
    render(CharactersTable, { rows: [], sort: 'level', dir: 'desc', onSort: () => {} });
    expect(screen.getByText(t('characters.empty'))).toBeInTheDocument();
  });
});
