// Bank pane: rebuild only for ledger changes. Its cached countdown node receives
// one elided text update from the existing bank slow-band refresh, no own driver.
import { ITEMS } from '../sim/data';
import { itemLevel } from '../sim/item_level';
import { WEEKLY_BACKLOG_LIMIT } from '../sim/weekly_rewards';
import type { IWorld } from '../world_api';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { buildWeeklyRewardsView, weeklyCountdown } from './weekly_rewards_view';

export const WEEKLY_TAB_ID = 'weekly-rewards-tab';
export const WEEKLY_PANEL_ID = 'weekly-rewards-panel';
export class WeeklyRewardsTab {
  private timer: HTMLElement | null = null;
  private timerText = '';
  private lastSignature = '';
  private expanded = new Set<string>();
  private selected: string | null = null;
  constructor(
    private readonly deps: {
      world(): IWorld;
      presentation: PainterHostPresentation;
      onInventoryChanged(): void;
    },
  ) {}
  refreshIfChanged(repaint: () => void): boolean {
    const info = this.deps.world().weeklyRewardInfo;
    if (!info) return false;
    this.refreshCountdown();
    const signature = JSON.stringify([
      info.state,
      info.readyWeeks,
      info.canClaim,
      info.worldQuestsAvailable,
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
      panel.textContent = t('hudChrome.weeklyRewards.approachKeeper');
      parent.appendChild(panel);
      return;
    }
    const rows = buildWeeklyRewardsView(info, world.cfg.playerClass);
    panel.innerHTML = `<header class="weekly-rewards-header"><div><h2>${esc(t('hudChrome.weeklyRewards.title'))}</h2><p>${esc(t('hudChrome.weeklyRewards.intro'))}</p></div><div class="weekly-reset"><span>${esc(t('hudChrome.weeklyRewards.nextReset'))}</span><strong data-weekly-countdown role="timer"></strong></div></header>`;
    this.timer = panel.querySelector('[data-weekly-countdown]');
    this.refreshCountdown();
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
    const batch = info.state.vaults[0];
    if (batch) {
      const choices = document.createElement('div');
      choices.className = 'weekly-choices';
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', t('hudChrome.weeklyRewards.chooseOne'));
      const buttons: HTMLButtonElement[] = [];
      for (const [index, choice] of batch.choices.entries()) {
        const item = ITEMS[choice.itemId];
        const key = `${batch.resetAtMs}:${index}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `weekly-choice ui-btn quality-${item.quality}`;
        button.setAttribute(FOCUS_KEY_ATTR, `weekly-choice:${key}`);
        button.setAttribute('aria-pressed', String(this.selected === key));
        button.innerHTML = `${this.deps.presentation.itemIcon(item)}<strong>${esc(itemDisplayName(item))}</strong><span>${esc(t(`hudChrome.weeklyRewards.pool.${choice.pool}`))}</span><span>${esc(t(item.quality === 'epic' ? 'hudChrome.weeklyRewards.epic' : 'hudChrome.weeklyRewards.rare'))} · ${esc(t('hudChrome.weeklyRewards.itemLevel', { level: formatNumber(itemLevel(item) ?? 0) }))}</span>`;
        this.deps.presentation.attachTooltip(button, () =>
          this.deps.presentation.itemTooltip(item),
        );
        button.addEventListener('click', () => {
          this.selected = key;
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
          confirm.disabled = !info.canClaim;
        });
        buttons.push(button);
        choices.appendChild(button);
      }
      panel.appendChild(choices);
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'weekly-confirm ui-btn ui-btn-primary';
      confirm.setAttribute(FOCUS_KEY_ATTR, 'weekly-confirm');
      confirm.textContent = t('hudChrome.weeklyRewards.claim');
      const selectedIndex = batch.choices.findIndex(
        (_, i) => this.selected === `${batch.resetAtMs}:${i}`,
      );
      confirm.disabled = !info.canClaim || selectedIndex < 0;
      confirm.addEventListener('click', () => {
        if (!this.selected || confirm.disabled) return;
        this.deps.world().claimWeeklyReward(this.selected);
        // Disable repeat confirmation. A refused claim can be retried by selecting
        // again; the server token still admits at most one item for this week.
        confirm.disabled = true;
        this.selected = null;
        status.focus();
        this.deps.onInventoryChanged();
      });
      panel.appendChild(confirm);
      const rule = document.createElement('p');
      rule.textContent = t('hudChrome.weeklyRewards.chooseOne');
      panel.appendChild(rule);
    } else {
      this.selected = null;
    }
    const tracks = document.createElement('div');
    tracks.className = 'weekly-tracks';
    for (const row of rows) {
      const section = document.createElement('section');
      section.className = 'weekly-track ui-card';
      section.innerHTML = `<div class="weekly-track-heading"><h3>${esc(t(`hudChrome.weeklyRewards.category.${row.category}`))}</h3><span class="weekly-progress">${esc(t('hudChrome.weeklyRewards.progress', { count: formatNumber(row.progress), max: formatNumber(row.thresholds[2]) }))}</span></div><p>${esc(t(`hudChrome.weeklyRewards.task.${row.category}`))}</p><div class="weekly-milestones">${row.thresholds.map((threshold, i) => `<span class="weekly-milestone ${row.progress >= threshold ? 'weekly-earned' : ''}">${esc(t('hudChrome.weeklyRewards.milestone', { count: formatNumber(threshold), choices: formatNumber(i + 1) }))}</span>`).join('')}</div>`;
      if (!row.available) {
        const note = document.createElement('p');
        note.className = 'weekly-unavailable';
        note.textContent = t('hudChrome.weeklyRewards.worldUnavailable');
        section.appendChild(note);
      }
      for (const pool of row.pools) {
        const details = document.createElement('details');
        details.className = 'weekly-pool';
        details.open = this.expanded.has(pool.pool);
        const qualities = pool.qualities
          .map((q) =>
            t(q === 'epic' ? 'hudChrome.weeklyRewards.epic' : 'hudChrome.weeklyRewards.rare'),
          )
          .join(' / ');
        details.innerHTML = `<summary ${FOCUS_KEY_ATTR}="weekly-pool:${pool.pool}"><strong>${esc(t(`hudChrome.weeklyRewards.pool.${pool.pool}`))}</strong><span>${esc(qualities || t('hudChrome.weeklyRewards.unavailable'))}</span><span>${esc(t('hudChrome.weeklyRewards.poolSize', { count: formatNumber(pool.items.length) }))}</span></summary><p>${esc(t('hudChrome.weeklyRewards.poolRule'))}</p><div class="weekly-loot-list"></div>`;
        details.addEventListener('toggle', () => {
          if (details.open) this.expanded.add(pool.pool);
          else this.expanded.delete(pool.pool);
        });
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
        section.appendChild(details);
        const actions = document.createElement('div');
        actions.className = 'weekly-pool-actions';
        actions.textContent = t('hudChrome.weeklyRewards.earned', {
          count: formatNumber(pool.earned),
        });
        section.appendChild(actions);
      }
      tracks.appendChild(section);
    }
    panel.appendChild(tracks);
    parent.appendChild(panel);
  }
}
