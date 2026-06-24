import { describe, expect, it } from 'vitest';
import { type RaidLockoutI18n, raidLockoutPanelHtml } from '../src/ui/raid_lockout_view';

const i18n: RaidLockoutI18n = {
  title: 'Raid Lockouts',
  allReady: 'All raids ready',
  raidName: (id) => (id === 'nythraxis_boss_arena' ? 'Crypt of Nythraxis' : id),
  duration: (ms) => `${Math.round(ms / 3600000)}h`,
};

describe('raidLockoutPanelHtml', () => {
  it('shows the all-ready line when nothing is locked', () => {
    const html = raidLockoutPanelHtml([], i18n);
    expect(html).toContain('Raid Lockouts');
    expect(html).toContain('All raids ready');
    expect(html).not.toContain('rl-row');
  });

  it('lists a locked raid with its resolved name and duration', () => {
    const html = raidLockoutPanelHtml(
      [{ id: 'nythraxis_boss_arena', msRemaining: 5 * 3600000 }],
      i18n,
    );
    expect(html).toContain('Crypt of Nythraxis');
    expect(html).toContain('5h');
    expect(html).not.toContain('All raids ready');
  });

  it('orders locked raids soonest-first (ties by id)', () => {
    const html = raidLockoutPanelHtml(
      [
        { id: 'zeta', msRemaining: 2 * 3600000 },
        { id: 'alpha', msRemaining: 2 * 3600000 },
        { id: 'nythraxis_boss_arena', msRemaining: 1 * 3600000 },
      ],
      i18n,
    );
    const order = ['Crypt of Nythraxis', 'alpha', 'zeta'].map((n) => html.indexOf(n));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('drops already-expired entries', () => {
    const html = raidLockoutPanelHtml([{ id: 'nythraxis_boss_arena', msRemaining: 0 }], i18n);
    expect(html).toContain('All raids ready');
  });

  it('escapes injected text', () => {
    const html = raidLockoutPanelHtml([{ id: 'x', msRemaining: 1000 }], {
      ...i18n,
      raidName: () => '<img src=x>',
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img');
  });
});
