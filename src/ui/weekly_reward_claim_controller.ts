// Completed-week presentation only. The host owns reset timing, rolls and claims.
import { ITEMS } from '../sim/data';
import { itemLevel } from '../sim/item_level';
import type { WeeklyVaultBatch } from '../sim/weekly_rewards';
import type { IWorld } from '../world_api';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, FOCUS_KEY_ATTR, findFocusKey } from './focus_restore';
import { formatDateTime, formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { showWeeklyRewardsReadyPrompt } from './weekly_rewards_ready_prompt';
import { attachWeeklyVaultReveal } from './weekly_vault_reveal_controller';

export class WeeklyRewardClaimController {
  private owner: IWorld | null = null;
  private batchKey = '';
  private started = false;
  private revealed = new Set<number>();
  private pending = new Set<number>();
  private selected: number | null = null;
  private submitted = false;
  private disposers: Array<() => void> = [];
  private readyPromptShown = false;
  private dismissReadyPrompt: (() => void) | null = null;
  private startClaim: (() => void) | null = null;
  private startButton: HTMLButtonElement | null = null;

  constructor(
    private readonly deps: {
      world(): IWorld;
      presentation: PainterHostPresentation;
      onInventoryChanged(): void;
      hideTooltip?(): void;
    },
  ) {}

  pause(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  close(): void {
    this.readyPromptShown = false;
    this.resetFlow();
  }

  private resetFlow(): void {
    this.dismissReadyPrompt?.();
    this.dismissReadyPrompt = null;
    this.startClaim = null;
    this.startButton = null;
    this.pause();
    this.pending.clear();
    this.started = false;
    this.selected = null;
    this.submitted = false;
  }

  private batch(): WeeklyVaultBatch | null {
    const info = this.deps.world().weeklyRewardInfo;
    const batch = info?.state.vaults[0];
    return info && batch && batch.choices.length && batch.resetAtMs <= info.nowMs ? batch : null;
  }

  private current(key: string): boolean {
    return (
      this.owner === this.deps.world() &&
      this.deps.world().weeklyRewardInfo?.canClaim === true &&
      this.identity() === key
    );
  }

  private identity(): string {
    const batch = this.batch();
    return batch
      ? `${batch.resetAtMs}:${this.deps.world().weeklyRewardInfo!.state.claimSequence}`
      : '';
  }

  private allOpened(): boolean {
    const batch = this.batch();
    return (
      !!batch &&
      batch.choices.every(
        (choice, index) =>
          choice.opened === true &&
          !!choice.itemId &&
          !!ITEMS[choice.itemId] &&
          this.revealed.has(index),
      )
    );
  }

  renderInto(host: HTMLElement, progress: HTMLElement): void {
    this.pause();
    const focusKey = captureFocusKey(host);
    const world = this.deps.world();
    const batch = this.batch();
    const key = this.identity();
    if (world !== this.owner || key !== this.batchKey) {
      this.resetFlow();
      this.revealed.clear();
      this.owner = world;
      this.batchKey = key;
    }
    if (!world.weeklyRewardInfo?.canClaim) this.resetFlow();
    if (batch) {
      for (const [index, choice] of batch.choices.entries()) {
        if (choice.opened && choice.itemId && ITEMS[choice.itemId]) {
          if (!this.pending.has(index)) this.revealed.add(index);
        } else this.revealed.delete(index);
      }
      if (!this.allOpened()) this.selected = null;
    }
    this.deps.hideTooltip?.();
    host.replaceChildren();
    host.className = 'weekly-claim-flow';
    host.hidden = !batch;
    progress.hidden = !!batch && this.started;
    if (!batch) return;

    const refresh = (focus?: string) => {
      this.renderInto(host, progress);
      if (focus) {
        const target =
          findFocusKey(host, focus) ??
          findFocusKey(host, 'weekly-start-claim') ??
          (host.parentElement && findFocusKey(host.parentElement, 'weekly-status'));
        target?.focus();
      }
    };
    const button = (label: string, className: string, focus: string, action: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `ui-btn ${className}`;
      el.textContent = label;
      el.setAttribute(FOCUS_KEY_ATTR, focus);
      el.addEventListener('click', action);
      return el;
    };
    const date = document.createElement('p');
    date.className = 'weekly-claim-date';
    date.textContent = t('hudChrome.weeklyRewards.completedWeek', {
      date: formatDateTime(batch.resetAtMs, { dateStyle: 'medium' }),
    });
    if (!this.started) {
      const start = button(
        t('hudChrome.weeklyRewards.claimLastWeek'),
        'weekly-start-claim ui-btn--gold',
        'weekly-start-claim',
        () => {
          if (!host.contains(start)) return;
          if (!this.current(key)) return refresh();
          this.dismissReadyPrompt?.();
          this.dismissReadyPrompt = null;
          this.started = true;
          refresh(
            this.revealed.size === batch.choices.length
              ? 'weekly-inspect:0'
              : `weekly-open:${batch.choices.findIndex((_, index) => !this.revealed.has(index))}`,
          );
        },
      );
      start.disabled = !world.weeklyRewardInfo?.canClaim;
      host.append(start, date);
      this.startButton = start;
      this.startClaim = () => start.click();
      if (!start.disabled && !this.readyPromptShown) {
        this.dismissReadyPrompt = showWeeklyRewardsReadyPrompt(
          host.closest<HTMLElement>('#bank-window') ?? host,
          () => this.startClaim?.(),
          () => this.startButton?.focus(),
        );
        this.readyPromptShown = !!this.dismissReadyPrompt;
      }
      return;
    }
    host.classList.add('weekly-claim-active');
    const heading = document.createElement('h3');
    heading.tabIndex = -1;
    heading.setAttribute(FOCUS_KEY_ATTR, 'weekly-claim-heading');
    const allRevealed = this.allOpened();
    heading.textContent = t(
      allRevealed ? 'hudChrome.weeklyRewards.chooseReward' : 'hudChrome.weeklyRewards.openRewards',
    );
    const back = button(
      t('hudChrome.weeklyRewards.currentWeek'),
      'weekly-return-progress',
      'weekly-return-progress',
      () => {
        this.resetFlow();
        refresh('weekly-start-claim');
      },
    );
    const header = document.createElement('div');
    header.className = 'weekly-claim-header';
    header.append(heading, date, back);
    host.append(header);

    if (this.selected === null) {
      const count = document.createElement('p');
      count.className = 'weekly-reveal-count';
      count.setAttribute('role', 'status');
      const updateCount = () => {
        count.textContent = allRevealed
          ? t('hudChrome.weeklyRewards.chooseOne')
          : t('hudChrome.weeklyRewards.openedCount', {
              count: formatNumber(this.revealed.size),
              total: formatNumber(batch.choices.length),
            });
      };
      updateCount();
      host.append(count);
      const tracks = document.createElement('div');
      tracks.className = 'weekly-claim-tracks';
      const animations: Array<() => void> = [];
      for (const category of ['raid', 'dungeon', 'world', 'pvp'] as const) {
        const candidates = batch.choices
          .map((choice, index) => ({ choice, index }))
          .filter(({ choice }) => choice.pool === category || choice.pool === `${category}_heroic`);
        if (!candidates.length) continue;
        const section = document.createElement('section');
        section.className = `weekly-track weekly-track-${category}`;
        section.innerHTML = `<div class="weekly-track-heading"><h3>${esc(t(`hudChrome.weeklyRewards.category.${category}`))}</h3></div>`;
        const tiles = document.createElement('div');
        tiles.className = 'weekly-claim-tiles';
        for (const { choice, index } of candidates) {
          const heroic = choice.pool.endsWith('_heroic');
          const art = heroic ? 'heroic' : 'normal';
          const title = t('hudChrome.weeklyRewards.rewardNumber', {
            count: formatNumber(index + 1),
          });
          const tile = document.createElement('div');
          tile.className = `weekly-milestone weekly-earned weekly-vault-${art} ui-card`;
          tile.innerHTML = `<div class="weekly-milestone-heading"><span class="weekly-milestone-label">${esc(title)}</span>${category === 'raid' || category === 'dungeon' ? `<span class="weekly-difficulty weekly-difficulty-${art}">${esc(t(`hudChrome.weeklyRewards.${art}`))}</span>` : ''}</div><div class="weekly-vault-illustration"><img class="weekly-vault-art" src="/ui/weekly-vault/${art}.webp" alt="" draggable="false"></div><div class="weekly-milestone-footer">${esc(t(`hudChrome.weeklyRewards.pool.${choice.pool}`))}</div>`;
          tiles.append(tile);
          const item = choice.opened && choice.itemId ? ITEMS[choice.itemId] : undefined;
          const reveal = attachWeeklyVaultReveal(
            tile.querySelector('.weekly-vault-illustration')!,
            item,
            title,
            index,
            this.revealed.has(index),
            this.deps.presentation,
            () => this.current(key),
            () => {
              this.pending.delete(index);
              this.revealed.add(index);
              updateCount();
              if (this.allOpened()) refresh('weekly-claim-heading');
            },
            allRevealed
              ? () => {
                  if (!this.current(key) || !this.allOpened()) return refresh();
                  this.selected = index;
                  this.submitted = false;
                  refresh('weekly-confirm-heading');
                }
              : undefined,
            () => {
              if (!host.contains(tile) || !this.current(key)) return;
              const currentChoice = this.batch()?.choices[index];
              if (!currentChoice || currentChoice.opening || currentChoice.opened) return;
              this.pending.add(index);
              this.deps.world().openWeeklyReward(`${batch.resetAtMs}:${index}`);
              refresh(`weekly-open:${index}`);
            },
            choice.opening === true,
          );
          this.disposers.push(reveal.dispose);
          if (item && this.pending.has(index) && !this.revealed.has(index))
            animations.push(reveal.animate);
        }
        section.append(tiles);
        tracks.append(section);
      }
      host.append(tracks);
      // Mount every tile before reduced-motion completion can repaint the sheet.
      for (const animate of animations) animate();
    } else {
      const index = this.selected;
      const item = ITEMS[batch.choices[index].itemId!];
      const panel = document.createElement('section');
      panel.className = 'weekly-confirm-panel ui-well';
      const title = document.createElement('h3');
      title.textContent = t('hudChrome.weeklyRewards.confirmTitle', {
        name: itemDisplayName(item),
      });
      title.tabIndex = -1;
      title.setAttribute(FOCUS_KEY_ATTR, 'weekly-confirm-heading');
      const itemPreview = document.createElement('button');
      itemPreview.type = 'button';
      itemPreview.className = `ui-btn weekly-choice weekly-confirm-item quality-${item.quality}`;
      itemPreview.setAttribute(FOCUS_KEY_ATTR, 'weekly-confirm-item');
      itemPreview.setAttribute(
        'aria-label',
        t('hudChrome.weeklyRewards.inspectItem', { name: itemDisplayName(item) }),
      );
      itemPreview.innerHTML = `${this.deps.presentation.itemIcon(item)}<strong>${esc(itemDisplayName(item))}</strong><span>${esc(t('hudChrome.weeklyRewards.itemLevel', { level: formatNumber(itemLevel(item) ?? 0) }))}</span>`;
      this.deps.presentation.attachTooltip(itemPreview, () =>
        this.deps.presentation.itemTooltip(item),
      );
      const description = document.createElement('p');
      description.textContent = t('hudChrome.weeklyRewards.chooseOne');
      const notice = document.createElement('p');
      notice.setAttribute('role', 'status');
      if (this.submitted) notice.textContent = t('hudChrome.weeklyRewards.claimRequested');
      const confirm = button(
        t('hudChrome.weeklyRewards.confirmClaim'),
        'weekly-confirm ui-btn--gold',
        'weekly-confirm',
        () => {
          if (this.submitted || !host.contains(confirm)) return;
          if (!this.current(key) || !this.allOpened()) return refresh();
          this.submitted = true;
          this.deps.world().claimWeeklyReward(batch.resetAtMs + ':' + index);
          // Only the host can consume the completed week's rewards.
          refresh('weekly-cancel-claim');
          this.deps.onInventoryChanged();
        },
      );
      confirm.disabled = this.submitted || !world.weeklyRewardInfo?.canClaim;
      const cancel = button(
        t('hudChrome.weeklyRewards.backToChoices'),
        'weekly-cancel-claim',
        'weekly-cancel-claim',
        () => {
          this.selected = null;
          this.submitted = false;
          refresh('weekly-inspect:' + index);
        },
      );
      const actions = document.createElement('div');
      actions.className = 'weekly-claim-footer';
      actions.append(cancel, confirm);
      panel.append(title, itemPreview, description, notice, actions);
      host.append(panel);
    }
    if (focusKey) findFocusKey(host, focusKey)?.focus();
  }
}
