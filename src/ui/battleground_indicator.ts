// Thin DOM painter for the persistent Gravemarch battleground indicator: the
// compact badge near the minimap that shows the player's queue state or a live
// match on the realm (docs/prd/battlegrounds.md, "the user-visible heart of
// the feature").
//
// The consumer half of the pure-core + thin-painter split: the state decision
// lives in battleground_indicator_view.ts; this module paints the pre-existing
// #bg-indicator BUTTON (index.html) and forwards its click to the
// Battlegrounds window toggle. It is painted on Hud.update()'s mediumHud band,
// so every DOM write routes through the PainterHost write-elision facet and
// the element refs are resolved ONCE at construction (no per-frame $()).
//
// Gameplay-neutral graphics invariant: queue state and a joinable live match
// are ACTIONABLE information, so this painter is never tier-shed or throttled
// by a graphics preset (it reads no fx tier at all).
//
// The render-skip sig is text-independent (kind + numbers); relocalize()
// clears it so a language switch rebuilds the localized text exactly once.

import { audio } from '../game/audio';
import type { IWorld } from '../world_api';
import { bgClockText } from './battleground_format';
import { buildBgIndicatorView } from './battleground_indicator_view';
import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { svgIcon } from './ui_icons';

export interface BattlegroundIndicatorDeps {
  /** The #bg-indicator button (resolved once at construction). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Open/close the Battlegrounds window (the badge is its opener). */
  open(): void;
}

export class BattlegroundIndicator {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly watchEl: HTMLElement;
  private lastSig = '';

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly deps: BattlegroundIndicatorDeps,
  ) {
    // Static skeleton, built once (cold): per-tick updates only touch the three
    // text slots + display + aria-label through the elided writers.
    this.root = deps.root();
    this.root.innerHTML =
      `${svgIcon('battleground')}` +
      `<span class="bgi-text"><span class="bgi-title"></span><span class="bgi-detail"></span></span>` +
      `<span class="bgi-watch"></span>`;
    this.titleEl = this.root.querySelector('.bgi-title') as HTMLElement;
    this.detailEl = this.root.querySelector('.bgi-detail') as HTMLElement;
    this.watchEl = this.root.querySelector('.bgi-watch') as HTMLElement;
    this.root.addEventListener('click', () => {
      this.deps.open();
      audio.click();
    });
  }

  /** mediumHud-band repaint; sig-elided, every write through the facet. */
  update(): void {
    const view = buildBgIndicatorView(this.deps.world().bgInfo);
    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    if (view.kind === 'hidden') {
      this.writers.setDisplay(this.root, 'none');
      return;
    }
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    if (view.kind === 'queued') {
      const detail = t('hudChrome.bg.indicator.queuedDetail', {
        position: num(view.position),
        time: bgClockText(view.waitSec),
      });
      this.writers.setText(this.titleEl, t('hudChrome.bg.indicator.queued'));
      this.writers.setText(this.detailEl, detail);
      this.writers.setText(this.watchEl, '');
      this.writers.setDisplay(this.watchEl, 'none');
      this.writers.setAttr(
        this.root,
        'aria-label',
        t('hudChrome.bg.indicator.queuedAria', {
          position: num(view.position),
          time: bgClockText(view.waitSec),
        }),
      );
    } else {
      const detail = t('hudChrome.bg.indicator.liveDetail', {
        time: bgClockText(view.elapsed),
        killsA: num(view.killsA),
        killsB: num(view.killsB),
      });
      this.writers.setText(this.titleEl, t('hudChrome.bg.indicator.live'));
      this.writers.setText(this.detailEl, detail);
      this.writers.setText(this.watchEl, t('hudChrome.bg.indicator.watch'));
      this.writers.setDisplay(this.watchEl, '');
      this.writers.setAttr(
        this.root,
        'aria-label',
        t('hudChrome.bg.indicator.liveAria', {
          time: bgClockText(view.elapsed),
          killsA: num(view.killsA),
          killsB: num(view.killsB),
        }),
      );
    }
    this.writers.setDisplay(this.root, 'flex');
  }

  /** Language switch: the sig is text-independent, so force one rebuild. */
  relocalize(): void {
    this.lastSig = '';
    this.update();
  }
}
