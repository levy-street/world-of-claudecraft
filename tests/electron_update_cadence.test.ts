import { describe, expect, it } from 'vitest';
import { FIRST_CHECK_DELAY_MS, RECHECK_INTERVAL_MS } from '../electron/updater.cjs';

// Pin the auto-update cadence so it cannot silently drift from the documented
// contract (docs/desktop-release.md and docs/desktop-ship-notes.md: "checks 15
// seconds after launch and every 4 hours"). These constants also feed the only
// place the cadence is expressed, electron/updater.cjs setTimeout/setInterval.
describe('auto-update cadence', () => {
  it('first check is 15 seconds after launch', () => {
    expect(FIRST_CHECK_DELAY_MS).toBe(15_000);
  });

  it('rechecks every 4 hours', () => {
    expect(RECHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });
});
