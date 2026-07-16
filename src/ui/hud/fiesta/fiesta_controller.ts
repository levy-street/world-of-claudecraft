import { type AugmentCategory, augmentCategory } from '../../../sim/content/augments';
import type {
  FiestaAugmentOffer,
  FiestaMatchInfo,
  FiestaScoreboardPlayer,
  IWorld,
} from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t, tOptional } from '../../i18n';

export interface FiestaAudioPort {
  click(): void;
  scorePing(mineScored: boolean): void;
  revive(): void;
}

export interface FiestaControllerDeps {
  document: Document;
  world(): Pick<IWorld, 'arenaInfo' | 'arenaAugmentPick'>;
  audio: FiestaAudioPort;
  crestIconUrl(playerClass: FiestaScoreboardPlayer['cls']): string;
  random(): number;
  schedule(callback: () => void, delayMs: number): void;
}

export interface FiestaWordParts {
  text: string;
  tier: number;
  color: string;
}

/** Owns the transient Fiesta HUD, score effects, augment offer, and word pops. */
export class FiestaController {
  private scoreSeen = { a: -1, b: -1 };
  private offerKey = '';
  private activeSeen = false;
  private wasDown = false;

  constructor(private readonly deps: FiestaControllerDeps) {}

  isActive(): boolean {
    const match = this.deps.world().arenaInfo?.match;
    return !!match?.fiesta && match.state === 'active';
  }

  update(): void {
    const match = this.deps.world().arenaInfo?.match;
    const fiesta = match?.fiesta;
    const active = !!fiesta && match?.state === 'active';
    if (!fiesta || !active) {
      if (this.activeSeen) this.teardown();
      this.activeSeen = false;
      return;
    }
    this.activeSeen = true;
    this.renderScore(fiesta);
    this.renderRespawn(fiesta);
    this.renderOffer(fiesta);
    this.renderPending(fiesta);
  }

  augmentName(id: string): string {
    return tOptional(`fiesta.augment.${id}.name`) ?? id;
  }

  wordParts(flavor: string, count?: number): FiestaWordParts {
    switch (flavor) {
      case 'firstblood':
        return { text: t('fiesta.word.firstblood'), tier: 3, color: '#ff3df0' };
      case 'doublekill':
        return { text: t('fiesta.word.doublekill'), tier: 3, color: '#ffae00' };
      case 'shutdown':
        return { text: t('fiesta.word.shutdown'), tier: 3, color: '#00e5ff' };
      case 'spree':
        return {
          text: t('fiesta.word.spree', {
            n: formatNumber(count ?? 3, { maximumFractionDigits: 0 }),
          }),
          tier: 2,
          color: '#ff7a1a',
        };
      case 'revived':
        return { text: t('fiesta.word.revived'), tier: 0, color: '#7fdc4f' };
      case 'ringclose':
        return { text: t('fiesta.word.ringclose'), tier: 1, color: '#ff3df0' };
      default:
        return { text: t('fiesta.word.kill'), tier: 1, color: '#ffd24a' };
    }
  }

  wordPop(text: string, color: string, tier: number): void {
    const element = this.deps.document.createElement('div');
    element.className = `fiesta-word tier${tier}`;
    element.textContent = text;
    element.style.setProperty('--fw-color', color);
    this.deps.document.getElementById('ui')?.appendChild(element);
    this.deps.schedule(() => element.remove(), 1400);
  }

  private renderPending(fiesta: FiestaMatchInfo): void {
    const element = this.getElement('fiesta-pending', 'fiesta-pending');
    const show = fiesta.augmentPending > 0 && !fiesta.offer && !fiesta.down;
    if (!show) {
      element.style.display = 'none';
      element.dataset.sig = '';
      return;
    }
    element.style.display = 'flex';
    const signature = `${fiesta.augmentPending}`;
    if (element.dataset.sig !== signature) {
      element.dataset.sig = signature;
      element.innerHTML =
        `<span class="fpend-gem">${this.augmentCategorySvg('utility')}</span>` +
        `<span class="fpend-text">${esc(t('fiesta.pending.label'))}</span>`;
    }
  }

  private getElement(id: string, className: string): HTMLElement {
    let element = this.deps.document.getElementById(id);
    if (!element) {
      element = this.deps.document.createElement('div');
      element.id = id;
      element.className = className;
      this.deps.document.getElementById('ui')?.appendChild(element);
    }
    return element;
  }

  private renderScore(fiesta: FiestaMatchInfo): void {
    const element = this.getElement('fiesta-score', 'fiesta-score');
    const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });
    const dots = Array.from(
      { length: fiesta.totalWaves },
      (_, index) => `<span class="fw-dot${index < fiesta.wave ? ' on' : ''}"></span>`,
    ).join('');
    const myTeam = fiesta.team === 'A' ? fiesta.teamA : fiesta.teamB;
    const enemyTeam = fiesta.team === 'A' ? fiesta.teamB : fiesta.teamA;
    const faces = (players: FiestaScoreboardPlayer[]): string =>
      players
        .map(
          (player) =>
            `<div class="fp${player.me ? ' me' : ''}${player.down ? ' down' : ''}" title="${esc(player.name)}">` +
            `<img class="fp-face" src="${this.deps.crestIconUrl(player.cls)}" alt="" draggable="false">` +
            `<span class="fp-kills">${num(player.kills)}</span></div>`,
        )
        .join('');
    const teamSignature = (players: FiestaScoreboardPlayer[]): string =>
      players.map((player) => `${player.kills}${player.down ? 'd' : ''}`).join(',');
    const signature = `${fiesta.myScore}|${fiesta.theirScore}|${fiesta.scoreLimit}|${fiesta.wave}|${teamSignature(myTeam)}|${teamSignature(enemyTeam)}`;
    if (element.dataset.sig === signature) return;
    const scored =
      this.scoreSeen.a >= 0 &&
      (this.scoreSeen.a !== fiesta.scoreA || this.scoreSeen.b !== fiesta.scoreB);
    const previousMine = fiesta.team === 'A' ? this.scoreSeen.a : this.scoreSeen.b;
    const previousTheirs = fiesta.team === 'A' ? this.scoreSeen.b : this.scoreSeen.a;
    element.dataset.sig = signature;
    element.innerHTML = `
      <div class="fs-team mine" aria-hidden="true">${faces(myTeam)}</div>
      <div class="fs-core">
        <span class="fs-num mine">${num(fiesta.myScore)}</span>
        <div class="fs-mid">
          <div class="fs-title">${esc(t('fiesta.score.title'))}</div>
          <div class="fs-waves">${dots}</div>
          <div class="fs-limit">${esc(t('fiesta.score.toWin', { n: num(fiesta.scoreLimit) }))}</div>
        </div>
        <span class="fs-num theirs">${num(fiesta.theirScore)}</span>
      </div>
      <div class="fs-team theirs" aria-hidden="true">${faces(enemyTeam)}</div>`;
    element.setAttribute(
      'aria-label',
      t('fiesta.score.aria', {
        mine: num(fiesta.myScore),
        theirs: num(fiesta.theirScore),
        limit: num(fiesta.scoreLimit),
      }),
    );
    if (scored) {
      const mineScored = fiesta.myScore > previousMine;
      this.deps.audio.scorePing(mineScored);
      element.classList.remove('flash-mine', 'flash-theirs');
      void element.offsetWidth;
      element.classList.add(mineScored ? 'flash-mine' : 'flash-theirs');
      if (fiesta.myScore > previousMine) this.confetti('#1b9fff');
      if (fiesta.theirScore > previousTheirs) this.confetti('#ff2d66');
    }
    this.scoreSeen = { a: fiesta.scoreA, b: fiesta.scoreB };
  }

  private confetti(color: string): void {
    const root = this.deps.document.getElementById('ui');
    if (!root) return;
    const layer = this.deps.document.createElement('div');
    layer.className = 'fiesta-confetti';
    const colors = [color, '#ffffff', '#ffd24a'];
    for (let index = 0; index < 36; index++) {
      const bit = this.deps.document.createElement('i');
      bit.style.left = `${this.deps.random() * 100}%`;
      bit.style.background = colors[index % colors.length];
      bit.style.animationDelay = `${this.deps.random() * 0.5}s`;
      bit.style.animationDuration = `${1.4 + this.deps.random() * 1.1}s`;
      bit.style.transform = `rotate(${this.deps.random() * 360}deg)`;
      layer.appendChild(bit);
    }
    root.appendChild(layer);
    this.deps.schedule(() => layer.remove(), 2800);
  }

  private renderRespawn(fiesta: FiestaMatchInfo): void {
    const element = this.getElement('fiesta-respawn', 'fiesta-respawn');
    if (fiesta.down && fiesta.respawnIn > 0) {
      element.style.display = 'flex';
      const signature = `${fiesta.respawnIn}`;
      if (element.dataset.sig !== signature) {
        element.dataset.sig = signature;
        element.innerHTML = `
          <div class="fr-title">${esc(t('fiesta.respawn.title'))}</div>
          <div class="fr-count">${esc(formatNumber(fiesta.respawnIn, { maximumFractionDigits: 0 }))}</div>
          <div class="fr-sub">${esc(t('fiesta.respawn.sub'))}</div>`;
      }
      this.wasDown = true;
    } else {
      if (this.wasDown) this.deps.audio.revive();
      this.wasDown = false;
      element.style.display = 'none';
      element.dataset.sig = '';
    }
  }

  private renderOffer(fiesta: FiestaMatchInfo): void {
    const offer = fiesta.offer;
    const key = offer ? `${offer.wave}:${offer.choices.join(',')}` : '';
    if (key === this.offerKey) return;
    this.offerKey = key;
    if (offer) this.renderAugments(offer);
    else this.closeAugments();
  }

  private renderAugments(offer: FiestaAugmentOffer): void {
    const element = this.getElement('fiesta-augments', 'fiesta-augments');
    element.style.display = 'flex';
    const tierLabel = esc(t(`fiesta.tier.${offer.tier}` as TranslationKey));
    element.innerHTML = `<div class="fa-head">${esc(t('fiesta.augment.choose'))} <span class="fa-tier ${offer.tier}">${tierLabel}</span></div>
      <div class="fa-cards"></div>`;
    const cards = element.querySelector('.fa-cards');
    if (!cards) return;
    for (const id of offer.choices) {
      const category = augmentCategory(id);
      const card = this.deps.document.createElement('button');
      card.type = 'button';
      card.className = `fa-card ${offer.tier}`;
      card.innerHTML =
        `<span class="fa-icon cat-${category}">${this.augmentCategorySvg(category)}</span>` +
        `<span class="fa-name">${esc(this.augmentName(id))}</span>` +
        `<span class="fa-desc">${esc(this.augmentDescription(id))}</span>` +
        `<span class="fa-cat cat-${category}">${esc(t(`fiesta.category.${category}` as TranslationKey))}</span>`;
      card.setAttribute(
        'aria-label',
        `${this.augmentName(id)} (${t(`fiesta.category.${category}` as TranslationKey)}) - ${this.augmentDescription(id)}`,
      );
      card.addEventListener('click', () => {
        this.deps.audio.click();
        this.deps.world().arenaAugmentPick(id);
        this.closeAugments();
      });
      cards.appendChild(card);
    }
  }

  private closeAugments(): void {
    const element = this.deps.document.getElementById('fiesta-augments');
    if (!element) return;
    element.style.display = 'none';
    element.innerHTML = '';
  }

  private augmentCategorySvg(category: AugmentCategory): string {
    const paths: Record<AugmentCategory, string> = {
      offense: '<path d="M3 21l6-6m0 0l9-9 2 2-9 9m-2-2l-2 2 2 2 2-2m-2-2l2 2"/>',
      defense: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
      sustain:
        '<path d="M12 21s-7-4.6-9.2-9C1.3 8.7 3 5 6.5 5c2 0 3.5 1.5 5.5 4 2-2.5 3.5-4 5.5-4C21 5 22.7 8.7 21.2 12 19 16.4 12 21 12 21z"/>',
      mobility: '<path d="M5 18l6-6-6-6m7 12l6-6-6-6"/>',
      utility:
        '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${paths[category]}</svg>`;
  }

  private teardown(): void {
    for (const id of ['fiesta-score', 'fiesta-respawn', 'fiesta-augments', 'fiesta-pending']) {
      const element = this.deps.document.getElementById(id);
      if (!element) continue;
      element.style.display = 'none';
      element.innerHTML = '';
      element.dataset.sig = '';
    }
    this.scoreSeen = { a: -1, b: -1 };
    this.offerKey = '';
    this.wasDown = false;
  }

  private augmentDescription(id: string): string {
    return tOptional(`fiesta.augment.${id}.desc`) ?? '';
  }
}
