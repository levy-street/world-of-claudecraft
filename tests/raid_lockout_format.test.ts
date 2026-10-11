// The localized raid lockout countdown (src/ui/raid_lockout_format.ts): the
// thin t() layer over the pure raid_lockout core. tests/raid_lockout.test.ts
// pins the parts and the shape; this file pins the rendered English string
// each shape produces, including the two details a regression would lose
// quietly: the sub-minute tail never reads "0m", and the digits stay
// ungrouped however long the lockout.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/ui/i18n';
import { formatLockoutDuration, raidLockoutDisplayName } from '../src/ui/raid_lockout_format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatLockoutDuration', () => {
  it('renders the two coarsest units for a multi-day lockout', () => {
    expect(formatLockoutDuration(2 * DAY + 3 * HOUR + 15 * MIN)).toBe('2d 3h');
  });

  it('renders hours and minutes inside a day', () => {
    expect(formatLockoutDuration(5 * HOUR + 12 * MIN)).toBe('5h 12m');
  });

  it('renders bare minutes under an hour', () => {
    expect(formatLockoutDuration(47 * MIN)).toBe('47m');
  });

  it('renders the sub-minute tail as <1m, never 0m, and degrades the same at zero', () => {
    expect(formatLockoutDuration(30_000)).toBe('<1m');
    expect(formatLockoutDuration(0)).toBe('<1m');
  });

  it('keeps the digits ungrouped so a long lockout never gains a thousands separator', () => {
    expect(formatLockoutDuration(1200 * DAY)).toBe('1200d 0h');
  });
});

// The lockout-id -> raid-name rule shared by the minimap badge panel and the
// character-select roster: the three id shapes the sim writes.
describe('raidLockoutDisplayName', () => {
  it('names a bare dungeon id as the dungeon', () => {
    setLanguage('en');
    expect(raidLockoutDisplayName('nythraxis_boss_arena')).toBe('Nythraxis Raid Arena');
  });

  it('names a heroic daily lockout with the Heroic prefix', () => {
    setLanguage('en');
    expect(raidLockoutDisplayName('nythraxis_boss_arena:heroic')).toBe(
      'Heroic Nythraxis Raid Arena',
    );
  });

  it('names a world-boss loot lockout as the boss mob', () => {
    setLanguage('en');
    expect(raidLockoutDisplayName('worldboss:thunzharr_waking_peak')).toBe(
      'Thunzharr, the Waking Peak',
    );
  });
});

// The one consumer no unit test drives: the minimap badge panel's raidName
// arm in hud.ts must be THIS resolver (tests/raid_lockout_view.test.ts injects
// its own fake, so a drift there would fail nothing). Pinned by source.
describe('raidLockoutDisplayName wiring', () => {
  it('is the minimap badge panel resolver in hud.ts', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toContain('raidName: raidLockoutDisplayName,');
    expect(hud).not.toContain('worldBossIdFromLockout');
  });
});
