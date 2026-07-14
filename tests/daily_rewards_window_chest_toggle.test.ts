import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const windowSource = readFileSync(
  new URL('../src/ui/daily_rewards_window.ts', import.meta.url),
  'utf8',
);
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('Daily Rewards chest visibility control', () => {
  it('does not duplicate the Settings chest toggle inside Daily Rewards', () => {
    expect(windowSource).not.toContain('data-chest-toggle');
    expect(windowSource).not.toContain('showChestButton?(): boolean');
    expect(windowSource).not.toContain('setShowChestButton?(show: boolean): void');
  });

  it('keeps chest visibility configurable through Settings', () => {
    expect(hudSource).toContain('showDailyRewardsChestButton()');
    expect(hudSource).toContain('setDailyRewardsChestButtonPreference(show: boolean)');
  });
});
