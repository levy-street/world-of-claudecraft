// Accessible, World of Warcraft-style Death Recap dialog.
// Presents a detailed chronological timeline of combat events (damage, critical hits,
// absorbs, and sustain healing) leading to the player's death, with ability tooltips
// on mouse hover and health percentage tracking.

import type { ResolvedAbility } from '../sim/sim';
import { buildDeathRecapSummary, type DeathRecapCardModel } from './death_recap_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import { getClassColor } from './meters';
import type { DeathRecapRecord, RaidDeathEntry } from './meters_death_recap';
import { svgIcon } from './ui_icons';

export interface DeathRecapDialogDeps {
  root?: () => HTMLElement | null;
  getLatestRecap(): DeathRecapRecord | null;
  getRaidDeaths?(): RaidDeathEntry[];
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  previewResolvedAbility?(id: string): ResolvedAbility | null;
  abilityTooltip?(res: ResolvedAbility): string;
  onClose?(): void;
}

export class DeathRecapDialog {
  private element: HTMLElement | null = null;
  private keydownHandler: ((ev: KeyboardEvent) => void) | null = null;
  private selectedPid: number | null = null;
  private selectedOrder: number | null = null;
  private currentView: 'player' | 'overview' = 'player';

  constructor(private readonly deps: DeathRecapDialogDeps) {}

  private ensureElement(): HTMLElement {
    if (!this.element) {
      let el = this.deps.root ? this.deps.root() : document.getElementById('death-recap-dialog');
      if (!el) {
        el = document.createElement('div');
        el.id = 'death-recap-dialog';
        document.body.appendChild(el);
      }
      markDialogRoot(el, { labelledBy: 'death-recap-title', modal: true });
      this.element = el;
    }
    return this.element;
  }

  isOpen(): boolean {
    return this.element !== null && this.element.style.display !== 'none';
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  selectPlayer(pid: number): void {
    this.selectedPid = pid;
    this.selectedOrder = null;
    this.currentView = 'player';
    if (this.isOpen() && this.element) {
      this.render(this.element);
    }
  }

  showOverview(): void {
    this.currentView = 'overview';
    if (this.isOpen() && this.element) {
      this.render(this.element);
    }
  }

  open(pid?: number): void {
    if (typeof pid === 'number') {
      this.selectedPid = pid;
    } else {
      this.selectedPid = null;
    }
    this.selectedOrder = null;
    this.currentView = 'player';
    const el = this.ensureElement();
    this.render(el);
    el.style.display = 'flex';
    el.dataset.windowOpen = 'true';

    if (!this.keydownHandler) {
      this.keydownHandler = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' && this.isOpen()) {
          ev.stopPropagation();
          this.close();
        }
      };
      window.addEventListener('keydown', this.keydownHandler, true);
    }
  }

  close(): void {
    if (!this.element) return;
    this.element.style.display = 'none';
    delete this.element.dataset.windowOpen;
    this.deps.hideTooltip();
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.deps.onClose?.();
  }

  private render(el: HTMLElement): void {
    const raidDeaths = this.deps.getRaidDeaths ? this.deps.getRaidDeaths() : [];

    let selectedEntry: RaidDeathEntry | null = null;
    let recap: DeathRecapRecord | null = null;

    if (raidDeaths.length > 0) {
      if (this.selectedOrder !== null) {
        selectedEntry = raidDeaths.find((d) => d.order === this.selectedOrder) ?? null;
      } else if (this.selectedPid !== null) {
        selectedEntry = [...raidDeaths].reverse().find((d) => d.pid === this.selectedPid) ?? null;
      }
      if (!selectedEntry) {
        const latestRecap = this.deps.getLatestRecap();
        if (latestRecap) {
          selectedEntry = [...raidDeaths].reverse().find((d) => d.pid === latestRecap.pid) ?? null;
        }
        if (!selectedEntry) {
          selectedEntry = raidDeaths[raidDeaths.length - 1];
        }
      }
      this.selectedPid = selectedEntry.pid;
      this.selectedOrder = selectedEntry.order;
      recap = selectedEntry.recap;
    } else {
      recap = this.deps.getLatestRecap();
    }

    if (!recap && raidDeaths.length === 0) {
      el.innerHTML = `
        <div class="death-recap-header">
          <h3 id="death-recap-title" class="death-recap-title">${esc(t('hud.core.deathRecapTitle'))}</h3>
          <button type="button" class="x-btn death-recap-close" title="${esc(t('hud.core.deathRecapClose'))}" aria-label="${esc(t('hud.core.deathRecapClose'))}" data-icon="close"></button>
        </div>
        <div class="death-recap-content">
          <div class="death-recap-empty">${esc(t('hud.core.deathRecapNoEvents'))}</div>
        </div>
        <div class="death-recap-footer">
          <button type="button" class="btn death-recap-footer-close">${esc(t('hud.core.deathRecapClose'))}</button>
        </div>
      `;
      this.wireEvents(el, []);
      return;
    }

    let rosterBarHtml = '';
    if (raidDeaths.length > 1) {
      const chipsHtml = raidDeaths
        .map((d) => {
          const isActive = this.currentView === 'player' && d.order === this.selectedOrder;
          const classColor = getClassColor(d.cls);
          return `
            <button type="button" class="death-recap-player-chip ${isActive ? 'active' : ''}" data-select-order="${d.order}" aria-pressed="${isActive}" style="--class-color: ${classColor}">
              <span class="chip-order">${esc(t('hud.core.deathRecapOrder', { order: d.order }))}</span>
              <span class="chip-name" style="color: ${classColor}">${esc(d.playerName)}</span>
              <span class="chip-time">${d.timeRel}</span>
            </button>
          `;
        })
        .join('');

      rosterBarHtml = `
        <div class="death-recap-roster-bar" role="group" aria-label="${esc(t('hud.core.deathRecapRaidDeaths', { count: raidDeaths.length }))}">
          <button type="button" class="death-recap-roster-tab ${this.currentView === 'overview' ? 'active' : ''}" data-view-mode="overview" aria-pressed="${this.currentView === 'overview'}" title="${esc(t('hud.core.deathRecapAllDeaths'))}">
            <span class="roster-overview-text">${esc(t('hud.core.deathRecapAllDeathsCount', { count: raidDeaths.length }))}</span>
          </button>
          <div class="death-recap-roster-sep"></div>
          <div class="death-recap-roster-players">
            ${chipsHtml}
          </div>
        </div>
      `;
    }

    let bodyHtml = '';
    let cards: DeathRecapCardModel[] = [];

    if (this.currentView === 'overview' && raidDeaths.length > 0) {
      const overviewRowsHtml = raidDeaths
        .map((d) => {
          const classColor = getClassColor(d.cls);
          const isFirst = d.order === 1;
          const killerLine = d.killerName
            ? t('hud.core.deathRecapKiller', {
                killer: d.killerName,
                ability: d.killerAbility ?? t('hud.core.mobileAttack'),
              })
            : t('hud.core.deathRecapNoKiller');
          return `
            <div class="overview-row ${isFirst ? 'overview-first-death' : ''}">
              <div class="overview-row-left">
                <span class="overview-order-badge">${d.order}</span>
                <div class="overview-info">
                  <div class="overview-player-line">
                    <span class="overview-player-name" style="color: ${classColor}">${esc(d.playerName)}</span>
                    ${isFirst ? `<span class="overview-first-tag">(${esc(t('hud.core.deathRecapFirstDeath'))})</span>` : ''}
                  </div>
                  <div class="overview-killer-line">
                    ${esc(killerLine)}
                  </div>
                </div>
              </div>
              <div class="overview-row-right">
                <span class="overview-time">${d.timeRel}</span>
                <button type="button" class="overview-inspect-btn" data-inspect-order="${d.order}">${esc(t('hud.core.deathRecapViewCards'))}</button>
              </div>
            </div>
          `;
        })
        .join('');

      bodyHtml = `
        <div class="death-recap-content">
          <div class="death-recap-overview-list">
            ${overviewRowsHtml}
          </div>
        </div>
      `;
    } else if (recap) {
      const summary = buildDeathRecapSummary(recap, 8);
      cards = summary.cards;

      const playerLine = selectedEntry
        ? `<div class="death-recap-summary">${esc(t('hud.core.deathRecapPlayer', { player: selectedEntry.playerName }))}</div>`
        : '';
      const killerLine = summary.killerName
        ? `<div class="death-recap-summary"><span class="death-recap-skull-icon" aria-hidden="true">${svgIcon('skull')}</span> <span class="death-recap-killer-text">${esc(t('hud.core.deathRecapKiller', { killer: summary.killerName, ability: summary.killerAbility ?? t('hud.core.mobileAttack') }))}</span></div>`
        : `<div class="death-recap-summary"><span class="death-recap-killer-text">${esc(t('hud.core.deathRecapNoKiller'))}</span></div>`;

      const totalsLine = `
        <div class="death-recap-totals">
          <span class="recap-total-dmg">${esc(t('hud.core.deathRecapDamage'))}: -${formatNumber(summary.totalDamage, { maximumFractionDigits: 0 })}</span>
          ${summary.totalHeal > 0 ? `<span class="recap-total-heal">${esc(t('hud.core.deathRecapHeal'))}: +${formatNumber(summary.totalHeal, { maximumFractionDigits: 0 })}</span>` : ''}
        </div>
      `;

      let cardsHtml = '';
      for (const card of cards) {
        const lethalClass = card.lethal ? 'recap-card-lethal' : '';
        const typeClass = `recap-card-${card.type}`;
        const hpLevelClass =
          card.hpPercent <= 20 ? 'hp-danger' : card.hpPercent <= 50 ? 'hp-warning' : 'hp-healthy';
        const timeBox = card.lethal
          ? `<div class="recap-time recap-time-lethal"><span class="recap-skull" aria-hidden="true">${svgIcon('skull')}</span> <span class="recap-lethal-badge">${esc(t('hud.core.deathRecapLethal'))}</span> <span class="recap-time-text">${card.timeRel}</span></div>`
          : `<div class="recap-time"><span class="recap-time-text">${card.timeRel}</span></div>`;

        const critBadge = card.crit
          ? `<span class="recap-crit">(${esc(t('hud.core.deathRecapCrit'))})</span>`
          : '';
        const schoolBadge = card.school
          ? `<span class="recap-school school-${esc(card.school)}">${esc(card.school)}</span>`
          : '';

        cardsHtml += `
          <div class="recap-card ${typeClass} ${lethalClass}" data-card-index="${card.index}">
            <div class="recap-card-left">
              <div class="recap-icon-frame" style="background-image:url(${iconDataUrl('ability', card.abilityId || 'attack', 36)})" aria-hidden="true"></div>
              <div class="recap-details">
                <div class="recap-name-row">
                  <span class="recap-ability">${esc(card.ability)}</span>
                  <span class="recap-source">${esc(card.sourceName)}</span>
                </div>
                <div class="recap-amount-row">
                  <span class="recap-amount recap-${card.type} ${card.school ? `school-${esc(card.school)}` : ''}">${card.amountStr}</span>
                  ${schoolBadge}
                  ${critBadge}
                </div>
              </div>
            </div>
            <div class="recap-card-right">
              <div class="recap-hp-stack">
                <div class="recap-hp-bar">
                  <div class="recap-hp-fill ${hpLevelClass}" style="width:${card.hpPercent}%"></div>
                </div>
                <div class="recap-hp-label">${esc(card.hpStr)}</div>
              </div>
              ${timeBox}
            </div>
          </div>
        `;
      }

      bodyHtml = `
        <div class="death-recap-subbar">
          ${playerLine}
          ${killerLine}
          ${totalsLine}
        </div>
        <div class="death-recap-content">
          <div class="death-recap-list">
            ${cardsHtml}
          </div>
        </div>
      `;
    }

    const backBtnHtml =
      this.currentView === 'player' && raidDeaths.length > 1
        ? `<button type="button" class="btn death-recap-footer-back" style="margin-right: auto">${esc(t('hud.core.deathRecapBackToOverview'))}</button>`
        : '';

    el.innerHTML = `
      <div class="death-recap-header">
        <h3 id="death-recap-title" class="death-recap-title">${esc(t('hud.core.deathRecapTitle'))}</h3>
        <button type="button" class="x-btn death-recap-close" title="${esc(t('hud.core.deathRecapClose'))}" aria-label="${esc(t('hud.core.deathRecapClose'))}" data-icon="close"></button>
      </div>
      ${rosterBarHtml}
      ${bodyHtml}
      <div class="death-recap-footer">
        ${backBtnHtml}
        <button type="button" class="btn death-recap-footer-close">${esc(t('hud.core.deathRecapClose'))}</button>
      </div>
    `;

    this.wireEvents(el, cards);
  }

  private wireEvents(el: HTMLElement, cards: DeathRecapCardModel[]): void {
    const closeBtns = el.querySelectorAll<HTMLElement>(
      '.death-recap-close, .death-recap-footer-close',
    );
    closeBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      });
    });

    const backBtn = el.querySelector<HTMLElement>('.death-recap-footer-back');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.currentView = 'overview';
        this.render(el);
        el.querySelector<HTMLElement>('[data-view-mode="overview"]')?.focus();
      });
    }

    const overviewTab = el.querySelector<HTMLElement>('[data-view-mode="overview"]');
    if (overviewTab) {
      overviewTab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.currentView = 'overview';
        this.render(el);
        el.querySelector<HTMLElement>('[data-view-mode="overview"]')?.focus();
      });
    }

    const chips = el.querySelectorAll<HTMLElement>('[data-select-order]');
    chips.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const order = Number.parseInt(chip.dataset.selectOrder ?? '-1', 10);
        if (order > 0) {
          this.selectedOrder = order;
          this.currentView = 'player';
          this.render(el);
          el.querySelector<HTMLElement>(`[data-select-order="${order}"]`)?.focus();
        }
      });
    });

    const inspectRows = el.querySelectorAll<HTMLButtonElement>('.overview-inspect-btn');
    inspectRows.forEach((row) => {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const order = Number.parseInt(row.dataset.inspectOrder ?? '-1', 10);
        if (order > 0) {
          this.selectedOrder = order;
          this.currentView = 'player';
          this.render(el);
          el.querySelector<HTMLElement>(`[data-select-order="${order}"]`)?.focus();
        }
      });
    });

    const cardEls = el.querySelectorAll<HTMLElement>('.recap-card');
    cardEls.forEach((cardEl) => {
      const idx = Number.parseInt(cardEl.dataset.cardIndex ?? '-1', 10);
      const card = cards[idx];
      if (!card) return;
      this.deps.attachTooltip(cardEl, () => this.generateCardTooltip(card));
    });
  }

  private generateCardTooltip(card: DeathRecapCardModel): string {
    if (card.abilityId && this.deps.previewResolvedAbility && this.deps.abilityTooltip) {
      const res = this.deps.previewResolvedAbility(card.abilityId);
      if (res) return this.deps.abilityTooltip(res);
    }

    let html = `<div class="tt-title">${esc(card.ability)}</div>`;
    const schoolUpper = card.school ? card.school.toUpperCase() : '';
    const typeUpper =
      card.type === 'damage'
        ? t('hud.core.deathRecapDamage').toUpperCase()
        : card.type === 'heal'
          ? t('hud.core.deathRecapHeal').toUpperCase()
          : 'ABSORB';
    const subLine = schoolUpper ? `${schoolUpper} - ${typeUpper}` : typeUpper;
    html += `<div class="tt-sub">${esc(subLine)}</div>`;

    if (card.sourceName && card.sourceName !== 'Unknown') {
      html += `<div class="tt-desc">${esc(card.sourceName)}</div>`;
    }

    if (card.type === 'damage') {
      const critStr = card.crit ? ` (${t('hud.core.deathRecapCrit')})` : '';
      const schoolStr = card.school ? ` ${card.school}` : '';
      html += `<div class="tt-stat tt-red">${esc(card.amountStr)}${esc(schoolStr)} ${esc(t('hud.core.deathRecapDamage'))}${esc(critStr)}</div>`;
    } else if (card.type === 'heal') {
      const critStr = card.crit ? ` (${t('hud.core.deathRecapCrit')})` : '';
      html += `<div class="tt-stat tt-green">${esc(card.amountStr)} ${esc(t('hud.core.deathRecapHeal'))}${esc(critStr)}</div>`;
    } else {
      html += `<div class="tt-stat">${esc(card.amountStr)}</div>`;
    }

    if (card.hpStr) {
      html += `<div class="tt-body">${esc(card.hpStr)} (${card.timeRel})</div>`;
    }

    return html;
  }
}
