// Bank pane: rebuild only for ledger changes. Its cached countdown node receives
// one elided text update from the existing bank slow-band refresh, no own driver.
import { ITEMS } from '../sim/data';
import { WEEKLY_BACKLOG_LIMIT } from '../sim/weekly_rewards';
import type { IWorld } from '../world_api';
import { chromeIconUrl } from './chrome_icon_art';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { WeeklyRewardClaimController } from './weekly_reward_claim_controller';
import { buildWeeklyRewardsView, weeklyCountdown } from './weekly_rewards_view';

export const WEEKLY_TAB_ID = 'weekly-rewards-tab';
export const WEEKLY_PANEL_ID = 'weekly-rewards-panel';
/** Bind the bank host without losing its callback receiver. */
export function createWeeklyRewardsTab(
  host: PainterHostPresentation & {
    world(): IWorld;
    onInventoryChanged(): void;
    hideTooltip(): void;
  },
): WeeklyRewardsTab {
  return new WeeklyRewardsTab({
    world: () => host.world(),
    presentation: host,
    onInventoryChanged: () => host.onInventoryChanged(),
    hideTooltip: () => host.hideTooltip(),
  });
}
export class WeeklyRewardsTab {
  private timer: HTMLElement | null = null;
  private timerText = '';
  private lastSignature = '';
  private expanded = new Set<string>();
  private readonly claimFlow: WeeklyRewardClaimController;
  constructor(
    private readonly deps: {
      world(): IWorld;
      presentation: PainterHostPresentation;
      onInventoryChanged(): void;
      hideTooltip?(): void;
    },
  ) {
    this.claimFlow = new WeeklyRewardClaimController(deps);
  }
  close(): void {
    this.claimFlow.close();
  }
  refreshIfChanged(repaint: () => void): boolean {
    const info = this.deps.world().weeklyRewardInfo;
    if (!info) {
      this.claimFlow.close();
      this.lastSignature = '';
      return false;
    }
    this.refreshCountdown();
    const signature = JSON.stringify([
      info.state,
      info.readyWeeks,
      info.canClaim,
      info.worldQuestsAvailable,
      !!info.state.vaults[0] && info.state.vaults[0].resetAtMs <= info.nowMs,
    ]);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      repaint();
    }
    return true;
  }
  refreshCountdown(): void {
    const info = this.deps.world().weeklyRewardInfo;
    if (!this.timer || !info) return;
    const text = weeklyCountdown(info.state.resetAtMs, info.nowMs);
    if (text === this.timerText) return;
    this.timer.textContent = text;
    this.timerText = text;
  }
  renderInto(parent: HTMLElement): void {
    this.claimFlow.pause();
    // Discard a previously dragged bank's inline insets before using the large sheet.
    for (const property of ['left', 'top', 'right', 'bottom', 'transform'])
      parent.style.removeProperty(property);
    delete parent.dataset.windowMoved;
    const world = this.deps.world();
    const info = world.weeklyRewardInfo;
    this.timer = null;
    this.timerText = '';
    const panel = document.createElement('section');
    panel.id = WEEKLY_PANEL_ID;
    panel.className = 'weekly-rewards bank-scroll';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', t('hudChrome.weeklyRewards.title'));
    if (!info) {
      this.claimFlow.close();
      this.lastSignature = '';
      panel.textContent = t('hudChrome.weeklyRewards.approachKeeper');
      parent.appendChild(panel);
      return;
    }
    this.lastSignature = JSON.stringify([
      info.state,
      info.readyWeeks,
      info.canClaim,
      info.worldQuestsAvailable,
      !!info.state.vaults[0] && info.state.vaults[0].resetAtMs <= info.nowMs,
    ]);
    const rows = buildWeeklyRewardsView(info, world.cfg.playerClass);
    panel.innerHTML = `<header class="weekly-rewards-header"><div class="weekly-vault-crest" aria-hidden="true"><img src="${chromeIconUrl('chest')}" alt="" draggable="false"></div><div class="weekly-vault-intro"><h2>${esc(t('hudChrome.weeklyRewards.title'))}</h2><p>${esc(t('hudChrome.weeklyRewards.intro'))}</p></div><div class="weekly-reset"><span>${esc(t('hudChrome.weeklyRewards.nextReset'))}</span><strong data-weekly-countdown role="timer"></strong></div></header>`;
    this.timer = panel.querySelector('[data-weekly-countdown]');
    this.refreshCountdown();
    const lootButton = document.createElement('button');
    lootButton.type = 'button';
    lootButton.className = 'weekly-possible-loot-button ui-btn';
    lootButton.id = 'weekly-possible-loot-button';
    lootButton.textContent = t('hudChrome.weeklyRewards.viewPossibleLoot');
    lootButton.setAttribute(FOCUS_KEY_ATTR, 'weekly-possible-loot');
    const allPools = document.createElement('div');
    allPools.id = 'weekly-possible-loot';
    allPools.className = 'weekly-possible-loot';
    allPools.hidden = !this.expanded.has('all-loot');
    allPools.setAttribute('role', 'region');
    allPools.setAttribute('aria-labelledby', lootButton.id);
    lootButton.setAttribute('aria-controls', allPools.id);
    lootButton.setAttribute('aria-expanded', String(!allPools.hidden));
    lootButton.addEventListener('click', () => {
      allPools.hidden = !allPools.hidden;
      lootButton.setAttribute('aria-expanded', String(!allPools.hidden));
      if (allPools.hidden) this.expanded.delete('all-loot');
      else this.expanded.add('all-loot');
    });
    const toolbar = document.createElement('div');
    toolbar.className = 'weekly-vault-toolbar';
    toolbar.appendChild(lootButton);
    panel.append(toolbar, allPools);
    const status = document.createElement('p');
    status.className = 'weekly-choice-status';
    status.tabIndex = -1;
    status.setAttribute(FOCUS_KEY_ATTR, 'weekly-status');
    status.setAttribute('role', 'status');
    status.textContent = t(
      info.readyWeeks ? 'hudChrome.weeklyRewards.readyWeeks' : 'hudChrome.weeklyRewards.waiting',
      { count: formatNumber(info.readyWeeks) },
    );
    panel.appendChild(status);
    if (info.state.overflowed || info.readyWeeks >= WEEKLY_BACKLOG_LIMIT) {
      const warning = document.createElement('p');
      warning.textContent = t('hudChrome.weeklyRewards.backlogFull');
      panel.appendChild(warning);
    }
    const tracks = document.createElement('div');
    tracks.className = 'weekly-tracks';
    for (const row of rows) {
      const section = document.createElement('section');
      section.className = `weekly-track weekly-track-${row.category}`;
      section.classList.toggle('weekly-track-unavailable', !row.available);
      section.setAttribute('aria-labelledby', `weekly-track-${row.category}-title`);
      section.innerHTML = `<div class="weekly-track-overview"><div class="weekly-track-heading"><h3 id="weekly-track-${row.category}-title">${esc(t(`hudChrome.weeklyRewards.category.${row.category}`))}</h3></div><div class="weekly-milestones">${row.milestones
        .map(
          ({
            required: threshold,
            completed: earned,
            difficulty,
            heroic,
            normal,
            heroicRemaining,
          }) => {
            const art = earned ? (difficulty === 'heroic' ? 'heroic' : 'normal') : 'closed';
            const label = !row.available
              ? t('hudChrome.weeklyRewards.unavailable')
              : earned
                ? t(
                    `hudChrome.weeklyRewards.completedTask.${row.category}${threshold === 1 ? 'One' : 'Many'}`,
                    { count: formatNumber(threshold) },
                  )
                : t(
                    `hudChrome.weeklyRewards.requiredTask.${row.category}${threshold === 1 ? 'One' : 'Many'}`,
                    {
                      count: formatNumber(threshold),
                    },
                  );
            return `<div class="weekly-milestone ui-card ${earned ? 'weekly-earned' : ''} weekly-vault-${art}"><div class="weekly-milestone-heading"><span class="weekly-milestone-label">${esc(label)}</span>${difficulty ? `<span class="weekly-difficulty weekly-difficulty-${difficulty}">${esc(t(`hudChrome.weeklyRewards.${difficulty}`))}</span>` : ''}</div><div class="weekly-vault-illustration"><img class="weekly-vault-art" src="/ui/weekly-vault/${art}.webp" alt="" aria-hidden="true" draggable="false"></div><div class="weekly-milestone-footer">${row.category === 'dungeon' && heroicRemaining > 0 ? `<span class="weekly-heroic-upgrade">${esc(t(heroicRemaining === 1 ? 'hudChrome.weeklyRewards.heroicUpgradeOne' : 'hudChrome.weeklyRewards.heroicUpgradeMany', { count: formatNumber(heroicRemaining) }))}</span>` : ''}${earned && difficulty ? `<span class="weekly-clear-mix">${esc(heroic > 0 && normal > 0 ? t('hudChrome.weeklyRewards.mixedClears', { heroic: formatNumber(heroic), normal: formatNumber(normal) }) : t(heroic > 0 ? 'hudChrome.weeklyRewards.heroicClears' : 'hudChrome.weeklyRewards.normalClears', { count: formatNumber(heroic || normal) }))}</span>` : row.available ? `<span class="weekly-roll-label">${esc(t(earned ? 'hudChrome.weeklyRewards.milestone' : 'hudChrome.weeklyRewards.lockedRoll'))}</span>` : ''}<span class="weekly-milestone-count ui-num">${esc(t('hudChrome.weeklyRewards.progress', { count: formatNumber(Math.min(row.progress, threshold)), max: formatNumber(threshold) }))}</span></div></div>`;
          },
        )
        .join('')}</div></div>`;
      for (const pool of row.pools) {
        const details = document.createElement('div');
        details.className = 'weekly-pool ui-card';
        details.id = `weekly-pool-${pool.pool}`;
        const qualities = pool.qualities
          .map((q) =>
            t(q === 'epic' ? 'hudChrome.weeklyRewards.epic' : 'hudChrome.weeklyRewards.rare'),
          )
          .join(' / ');
        details.innerHTML = `<h4 id="weekly-pool-title-${pool.pool}">${esc(t(`hudChrome.weeklyRewards.pool.${pool.pool}`))}</h4><p>${esc(qualities || t('hudChrome.weeklyRewards.unavailable'))}</p><p>${esc(t('hudChrome.weeklyRewards.poolRule'))}</p><div class="weekly-loot-list"></div>`;
        const list = details.querySelector('.weekly-loot-list')!;
        for (const id of pool.items) {
          const item = ITEMS[id];
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = `weekly-loot ui-btn quality-${item.quality}`;
          cell.setAttribute(FOCUS_KEY_ATTR, `weekly-item:${pool.pool}:${id}`);
          cell.innerHTML = `${this.deps.presentation.itemIcon(item)}<span>${esc(itemDisplayName(item))}</span>`;
          this.deps.presentation.attachTooltip(cell, () =>
            this.deps.presentation.itemTooltip(item),
          );
          list.appendChild(cell);
        }
        allPools.appendChild(details);
        const actions = document.createElement('div');
        actions.className = 'weekly-pool-actions';
        actions.textContent = t('hudChrome.weeklyRewards.earned', {
          count: formatNumber(pool.earned),
        });
        details.appendChild(actions);
      }

      tracks.appendChild(section);
    }
    const claimHost = document.createElement('div');
    panel.append(claimHost, tracks);
    parent.appendChild(panel);
    this.claimFlow.renderInto(claimHost, tracks);
  }
}
