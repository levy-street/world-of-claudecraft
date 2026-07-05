// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import AdminNav from '../../src/admin/components/AdminNav.svelte';
import { t } from '../../src/admin/i18n';
import { grantPermissions } from './_grant';

beforeEach(() => {
  grantPermissions();
});

describe('AdminNav', () => {
  it('groups moderation sub-pages and marks the current page', () => {
    render(AdminNav, {
      route: { page: 'blocked-ips' },
      onSelect: () => {},
      onClose: () => {},
    });

    expect(screen.getByText(t('app.shortTitle'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.moderation') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.reports') })).toHaveAttribute(
      'href',
      expect.stringContaining('page=moderation'),
    );
    expect(screen.getByRole('link', { name: t('nav.blockedIps') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: t('nav.chatFilter') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.sharedIps') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.players') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.accounts') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.characters') })).toBeInTheDocument();
  });

  it('groups bot detector pages between moderation and support', () => {
    render(AdminNav, {
      route: { page: 'suspicious-players' },
      onSelect: () => {},
      onClose: () => {},
    });

    const sections = screen.getAllByRole('link').map((link) => link.textContent);
    expect(sections.indexOf(t('nav.moderation'))).toBeLessThan(
      sections.indexOf(t('nav.botDetector')),
    );
    expect(sections.indexOf(t('nav.botDetector'))).toBeLessThan(sections.indexOf(t('nav.support')));
    expect(screen.getByRole('link', { name: t('nav.botDetector') })).toHaveClass('active-section');
    expect(screen.getByRole('link', { name: t('nav.liveEvidence') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: t('nav.calibration') })).toBeInTheDocument();
  });

  it('keeps the moderation section active for an IP detail route', () => {
    render(AdminNav, {
      route: { page: 'ip', ip: '203.0.113.7' },
      onSelect: () => {},
      onClose: () => {},
    });

    expect(screen.getByRole('link', { name: t('nav.moderation') })).toHaveClass('active-section');
    expect(screen.getByRole('link', { name: t('nav.sharedIps') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the staff page to a staff manager', () => {
    render(AdminNav, {
      route: { page: 'staff' },
      onSelect: () => {},
      onClose: () => {},
    });

    expect(screen.getByRole('link', { name: t('nav.staff') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('filters sections and items down to the granted permissions', () => {
    grantPermissions(['moderation.read', 'accounts.read']);
    render(AdminNav, {
      route: { page: 'moderation' },
      onSelect: () => {},
      onClose: () => {},
    });

    // Moderation section: reports/shared-ips/blocked-ips/chat-filter all visible.
    expect(screen.getByRole('link', { name: t('nav.reports') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.blockedIps') })).toBeInTheDocument();
    // Accounts and characters both require accounts.read, so both are visible.
    expect(screen.getByRole('link', { name: t('nav.accounts') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('nav.characters') })).toBeInTheDocument();
    // Whole sections without a granted permission disappear: overview needs
    // analytics.read, and Operations/Usage needs ops_usage.read, neither granted.
    expect(screen.queryByRole('link', { name: t('nav.usage') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('nav.overview') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('nav.botDetector') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('nav.bugReports') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('nav.staff') })).not.toBeInTheDocument();
  });
});
