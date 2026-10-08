import { describe, expect, it, vi } from 'vitest';
import { BOT_REPORT_REWARD_LETTER } from '../src/sim/content/letters';
import { Sim } from '../src/sim/sim';

describe('report reward mailbox admission', () => {
  it('counts legacy-name mail and stable-id mail against the same hundred-letter bound', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    for (let i = 0; i < 99; i++) {
      sim.mailSystemParcel(
        { key: i < 50 ? '9' : 'Reporter', name: 'Reporter' },
        BOT_REPORT_REWARD_LETTER,
        [],
        `old:${i}`,
      );
    }
    expect(sim.postOffice.canBookReportRewardMail(9, 'Reporter')).toBe(true);
    sim.mailSystemParcel({ key: '9', name: 'Reporter' }, BOT_REPORT_REWARD_LETTER, [], 'last');
    expect(sim.postOffice.canBookReportRewardMail(9, 'Reporter')).toBe(false);
    expect(sim.postOffice.canBookReportRewardMail(10, 'Other')).toBe(true);
  });

  it('admission reads only the indexed recipient counts against a grown book', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    for (let i = 0; i < 1000; i++) {
      sim.mailSystemParcel(
        { key: `other:${i}`, name: `Other${i}` },
        BOT_REPORT_REWARD_LETTER,
        [],
        `grown:${i}`,
      );
    }
    const index = (sim.postOffice as unknown as { index: { countFor(key: string): number } }).index;
    const count = vi.spyOn(index, 'countFor');
    expect(sim.postOffice.canBookReportRewardMail(9, 'Reporter')).toBe(true);
    expect(count.mock.calls).toEqual([['9'], ['Reporter']]);
  });
});
