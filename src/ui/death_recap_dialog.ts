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
import type { DeathRecapRecord } from './meters_death_recap';
import { svgIcon } from './ui_icons';

export interface DeathRecapDialogDeps {
  root?: () => HTMLElement | null;
  getLatestRecap(): DeathRecapRecord | null;
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  previewResolvedAbility?(id: string): ResolvedAbility | null;
  abilityTooltip?(res: ResolvedAbility): string;
  onClose?(): void;
}

export class DeathRecapDialog {
  private element: HTMLElement | null = null;
  private keydownHandler: ((ev: KeyboardEvent) => void) | null = null;

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

  open(): void {
    const el = this.ensureElement();
    const recap = this.deps.getLatestRecap();
    this.render(el, recap);
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

  private render(el: HTMLElement, recap: DeathRecapRecord | null): void {
    if (!recap) {
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

    const summary = buildDeathRecapSummary(recap, 8);
    const cards = summary.cards;

    const killerLine = summary.killerName
      ? `<div class="death-recap-summary"><span class="death-recap-skull-icon" aria-hidden="true">${svgIcon('skull')}</span> <span class="death-recap-killer-text">${esc(t('hud.core.deathRecapKiller', { killer: summary.killerName, ability: summary.killerAbility ?? 'Attack' }))}</span></div>`
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

    el.innerHTML = `
      <div class="death-recap-header">
        <h3 id="death-recap-title" class="death-recap-title">${esc(t('hud.core.deathRecapTitle'))}</h3>
        <button type="button" class="x-btn death-recap-close" title="${esc(t('hud.core.deathRecapClose'))}" aria-label="${esc(t('hud.core.deathRecapClose'))}" data-icon="close"></button>
      </div>
      <div class="death-recap-subbar">
        ${killerLine}
        ${totalsLine}
      </div>
      <div class="death-recap-content">
        <div class="death-recap-list">
          ${cardsHtml}
        </div>
      </div>
      <div class="death-recap-footer">
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
