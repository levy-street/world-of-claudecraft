// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AccountIndicators from '../../src/admin/components/AccountIndicators.svelte';
import { fmtDate } from '../../src/admin/format';
import { t } from '../../src/admin/i18n';

describe('AccountIndicators', () => {
  it('renders prominent admin and online indicators with a neutral active state', () => {
    render(AccountIndicators, {
      isAdmin: true,
      online: true,
      status: 'active',
    });

    expect(screen.getByText(t('accounts.badgeAdmin'))).toHaveClass('admin');
    expect(screen.getByText(t('moderation.badgeOnline'))).toHaveClass('success');
    expect(screen.getByText(t('detail.statusActive'))).toHaveClass('neutral');
  });

  it('renders suspended and banned account states', () => {
    const suspendedUntil = '2026-06-03T00:00:00Z';
    const { unmount } = render(AccountIndicators, {
      status: 'suspended',
      suspendedUntil,
    });
    expect(
      screen.getByText(t('detail.suspendedUntil', { value: fmtDate(suspendedUntil) })),
    ).toHaveClass('warn');

    unmount();
    render(AccountIndicators, { status: 'banned' });
    expect(screen.getByText(t('accounts.badgeBanned'))).toHaveClass('bad');
  });
});
