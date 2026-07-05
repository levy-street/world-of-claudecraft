// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Pager from '../../src/admin/components/Pager.svelte';
import { t } from '../../src/admin/i18n';

describe('Pager', () => {
  it('exposes a labelled footer and changes to an available page', async () => {
    const onPage = vi.fn();
    render(Pager, {
      total: 42,
      page: 1,
      limit: 25,
      layout: 'footer',
      onPage,
    });

    expect(screen.getByRole('navigation', { name: t('accounts.paginationLabel') })).toHaveClass(
      'footer',
    );
    expect(screen.getByRole('button', { name: t('accounts.prev') })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: t('accounts.next') }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
