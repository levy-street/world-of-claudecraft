// The Gauntlet knockout / podium overlay: a self-contained module (the
// reconnect_overlay pattern, styled after #death-overlay) that Hud drives from its
// gauntlet event cases and per-frame run view. Two states:
//   - ELIMINATED: a full-screen dim with a big title + "N still standing" subtitle,
//     auto-fading after a beat to the compact spectator bar (a "Spectating" label,
//     the live survivor count, and a Leave button that forfeits the seat).
//   - PODIUM: the first/second/third standings, with VICTORY styling when the viewer
//     took first, plus a Leave button.
// The overlay builds its own DOM lazily on first show and owns its own show/hide/
// update surface; Hud only calls in. Player/contestant names are proper nouns, set
// via textContent so they never need escaping.

import { formatNumber, t } from './i18n';

const OVERLAY_ID = 'gauntlet-overlay';
// Seconds the full-screen ELIMINATED splash holds before collapsing to the
// spectator bar. UI timing only (window clock), never the sim.
const ELIMINATED_HOLD_MS = 3000;
const INT = { maximumFractionDigits: 0 } as const;

export interface GauntletOverlayDeps {
  /** Forfeit the spectator seat / leave the podium (world.gauntletLeave()). */
  onLeave(): void;
}

type OverlayState = 'hidden' | 'eliminated' | 'spectating' | 'podium';

export class GauntletOverlay {
  private root: HTMLElement | null = null;
  private elimSub: HTMLElement | null = null;
  private spectateCount: HTMLElement | null = null;
  private podiumTitle: HTMLElement | null = null;
  private podiumNames: [HTMLElement, HTMLElement, HTMLElement] | null = null;
  private holdTimer: number | null = null;
  private state: OverlayState = 'hidden';

  constructor(private readonly deps: GauntletOverlayDeps) {}

  /** Full-screen "you were knocked out" splash, then the spectator bar. */
  showEliminated(survivors: number): void {
    const root = this.ensureDom();
    this.clearTimer();
    this.state = 'eliminated';
    root.hidden = false;
    root.dataset.state = 'eliminated';
    if (this.elimSub)
      this.elimSub.textContent = t('hudChrome.gauntlet.survivorsLeft', {
        count: formatNumber(Math.max(0, survivors), INT),
      });
    this.setSpectateCount(survivors);
    this.holdTimer = window.setTimeout(() => this.collapseToSpectator(), ELIMINATED_HOLD_MS);
  }

  /** The podium ceremony; `won` flips the VICTORY styling. */
  showPodium(podium: { first: string; second: string; third: string }, won: boolean): void {
    const root = this.ensureDom();
    this.clearTimer();
    this.state = 'podium';
    root.hidden = false;
    root.dataset.state = 'podium';
    root.classList.toggle('victory', won);
    if (this.podiumTitle)
      this.podiumTitle.textContent = won
        ? t('hudChrome.gauntlet.victory')
        : t('hudChrome.gauntlet.podiumTitle');
    if (this.podiumNames) {
      this.podiumNames[0].textContent = podium.first;
      this.podiumNames[1].textContent = podium.second;
      this.podiumNames[2].textContent = podium.third;
    }
  }

  /** Per-frame refresh of the live survivor count while spectating. */
  update(survivors: number): void {
    if (this.state === 'spectating' || this.state === 'eliminated')
      this.setSpectateCount(survivors);
  }

  /** Tear the overlay down (the run went null). */
  hide(): void {
    this.clearTimer();
    this.state = 'hidden';
    if (this.root) {
      this.root.hidden = true;
      this.root.classList.remove('victory');
      delete this.root.dataset.state;
    }
  }

  get shown(): boolean {
    return this.state !== 'hidden';
  }

  private collapseToSpectator(): void {
    this.holdTimer = null;
    if (this.state !== 'eliminated') return;
    this.state = 'spectating';
    if (this.root) this.root.dataset.state = 'spectating';
  }

  private setSpectateCount(survivors: number): void {
    if (this.spectateCount)
      this.spectateCount.textContent = t('hudChrome.gauntlet.survivorsLeft', {
        count: formatNumber(Math.max(0, survivors), INT),
      });
  }

  private clearTimer(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private ensureDom(): HTMLElement {
    if (this.root) return this.root;
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.hidden = true;

    const elim = document.createElement('div');
    elim.className = 'go-eliminated';
    const elimTitle = document.createElement('div');
    elimTitle.className = 'go-title';
    elimTitle.textContent = t('hudChrome.gauntlet.eliminated');
    const elimSub = document.createElement('div');
    elimSub.className = 'go-sub';
    elim.append(elimTitle, elimSub);

    const spectate = document.createElement('div');
    spectate.className = 'go-spectate';
    const spectateLabel = document.createElement('span');
    spectateLabel.className = 'go-spectate-label';
    spectateLabel.textContent = t('hudChrome.gauntlet.spectating');
    const spectateCount = document.createElement('span');
    spectateCount.className = 'go-spectate-count';
    spectate.append(spectateLabel, spectateCount, this.leaveButton());

    const podium = document.createElement('div');
    podium.className = 'go-podium';
    const podiumTitle = document.createElement('div');
    podiumTitle.className = 'go-podium-title';
    const places = document.createElement('ol');
    places.className = 'go-places';
    const placeKeys = [
      'hudChrome.gauntlet.placeFirst',
      'hudChrome.gauntlet.placeSecond',
      'hudChrome.gauntlet.placeThird',
    ] as const;
    const names: HTMLElement[] = [];
    for (const key of placeKeys) {
      const li = document.createElement('li');
      const place = document.createElement('span');
      place.className = 'go-place';
      place.textContent = t(key);
      const name = document.createElement('span');
      name.className = 'go-name';
      names.push(name);
      li.append(place, name);
      places.appendChild(li);
    }
    podium.append(podiumTitle, places, this.leaveButton());

    root.append(elim, spectate, podium);
    document.body.appendChild(root);

    this.root = root;
    this.elimSub = elimSub;
    this.spectateCount = spectateCount;
    this.podiumTitle = podiumTitle;
    this.podiumNames = [names[0], names[1], names[2]];
    return root;
  }

  private leaveButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'go-leave btn';
    btn.textContent = t('hudChrome.gauntlet.leave');
    btn.addEventListener('click', () => this.deps.onLeave());
    return btn;
  }
}
