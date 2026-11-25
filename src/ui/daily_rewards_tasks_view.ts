import { type DailyRewardsView, dailyRewardTaskDescription } from './daily_rewards_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

export function dailyRewardsTasksHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
  const rows = view.status.tasks
    .map((task) => {
      const multiplier =
        typeof task.multiplier === 'number' && Number.isFinite(task.multiplier)
          ? `<em>${esc(t('hudChrome.dailyRewards.taskMultiplier', { multiplier: formatNumber(task.multiplier, { maximumFractionDigits: 2 }) }))}</em>`
          : '';
      const description = dailyRewardTaskDescription(
        task.type,
        task.description,
        t('hudChrome.dailyRewards.oneVsOneExcluded'),
      );
      return `<li class="${task.completed ? 'done' : ''}"><span>${esc(task.title)}</span><small><span>${esc(description)}</span>${multiplier}</small><b>${formatNumber(task.points, { maximumFractionDigits: 0 })}</b></li>`;
    })
    .join('');
  return (
    `<section class="dr-section ui-card"><h3>${esc(t('hudChrome.dailyRewards.tasks'))}</h3>` +
    `<ul class="dr-tasks">${rows}</ul>` +
    `</section>`
  );
}
