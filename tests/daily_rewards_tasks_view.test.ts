// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { dailyRewardsTasksHtml } from '../src/ui/daily_rewards_tasks_view';
import type { DailyRewardsView } from '../src/ui/daily_rewards_view';
import { t } from '../src/ui/i18n';

describe('daily reward task markup', () => {
  it('escapes task text, marks completion and retains arena restrictions and finite multipliers', () => {
    const view = {
      kind: 'ready',
      status: {
        tasks: [
          {
            type: 'arena_result',
            title: '<Task>',
            description: '<Description>',
            completed: true,
            multiplier: 1.5,
            points: 25,
          },
          {
            type: 'quest',
            title: 'Quest',
            description: 'Finish a quest',
            completed: false,
            multiplier: Number.NaN,
            points: 10,
          },
        ],
      },
    } as Extract<DailyRewardsView, { kind: 'ready' }>;
    const host = document.createElement('div');
    host.innerHTML = dailyRewardsTasksHtml(view);
    const rows = host.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains('done')).toBe(true);
    expect(rows[0].querySelector('span')?.textContent).toBe('<Task>');
    expect(rows[0].querySelector('small span')?.textContent).toBe(
      `<Description> ${t('hudChrome.dailyRewards.oneVsOneExcluded')}`,
    );
    expect(rows[0].querySelector('em')).not.toBeNull();
    expect(rows[0].querySelector('b')?.textContent).toBe('25');
    expect(rows[1].classList.contains('done')).toBe(false);
    expect(rows[1].querySelector('em')).toBeNull();
    expect(host.querySelector('task')).toBeNull();
  });
});
