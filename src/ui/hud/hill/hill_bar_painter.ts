// King of the Hill bar: the thin painter over hill_bar_view.ts. A self-mounted
// strip under the Thornhollow Fields scoreboard's slot (#hill-bar, top centre)
// that shows while the local player stands in the hill's zone. While the hill
// is announced: the title and the zone, "not yet risen", the distance to the
// marked circle and when it rises. Once risen: who holds the hill, "you N vs
// them M", the contest clock as a fill bar, the distance and when it falls.
// Either way a note says so when the viewer does not count (a raid member). The skeleton is rebuilt in ONE innerHTML write when
// the structural sig changes (a new hill, the rise, a holder or challenger
// change, crossing the circle's edge); every
// per-second value rides the PainterHost elided writers, so an idle second
// writes nothing. The tone (yours / theirs / unheld) is a class chosen from
// the union, never interpolated from the wire, and the state is carried by
// text as well as colour.

import { durationText } from '../../duration_text';
import { zoneDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { HillBarLive, HillBarView } from './hill_bar_view';

export interface HillBarDeps {
  /** The HUD layer the strip mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

interface Slots {
  zone: HTMLElement;
  held: HTMLElement;
  /** The contest rows exist only once the hill has risen. */
  counts: HTMLElement | null;
  contest: HTMLElement | null;
  fill: HTMLElement | null;
  where: HTMLElement;
  when: HTMLElement;
}

export class HillBar {
  private root: HTMLElement | null = null;
  private slots: Slots | null = null;
  private lastSig = '';
  private lastView: HillBarLive | null = null;

  constructor(private readonly deps: HillBarDeps) {}

  update(view: HillBarView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      this.lastSig = view.sig;
      this.lastView = null;
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      this.build(root, view);
    }
    this.lastView = view;
    w.setDisplay(root, 'block');
    w.toggleClass(root, 'is-you', view.holder === 'you');
    w.toggleClass(root, 'is-other', view.holder === 'other');
    w.toggleClass(root, 'is-contested', view.challenger !== 'none');
    w.toggleClass(root, 'is-you-contesting', view.challenger === 'you');
    this.paintValues(view);
  }

  /** A language switch: rebuild the skeleton with fresh t() on the next update. */
  relocalize(): void {
    this.lastSig = '';
    if (this.root && this.lastView) this.update(this.lastView);
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.slots = null;
    this.lastSig = '';
    this.lastView = null;
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'hill-bar';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  private build(root: HTMLElement, view: HillBarLive): void {
    const risen = view.phase === 'active';
    const note = standingNote(view);
    root.innerHTML =
      `<div class="hill-head"><span class="hill-title">${esc(t('hudChrome.hill.title'))}</span>` +
      `<span class="hill-zone"></span></div>` +
      `<div class="hill-held"></div>` +
      (note ? `<div class="hill-note">${esc(note)}</div>` : '') +
      (risen
        ? `<div class="hill-counts"></div>` +
          `<div class="hill-track"><div class="hill-fill"></div><span class="hill-contest"></span></div>`
        : '') +
      `<div class="hill-foot"><span class="hill-where"></span><span class="hill-when"></span></div>`;
    const q = (sel: string): HTMLElement | null => root.querySelector(sel);
    this.slots = {
      zone: q('.hill-zone') as HTMLElement,
      held: q('.hill-held') as HTMLElement,
      counts: q('.hill-counts'),
      contest: q('.hill-contest'),
      fill: q('.hill-fill'),
      where: q('.hill-where') as HTMLElement,
      when: q('.hill-when') as HTMLElement,
    };
    // The structural texts are part of the skeleton and change only with the sig.
    this.deps.writers.setText(this.slots.zone, zoneDisplayName(view.zoneId));
    this.deps.writers.setText(this.slots.held, heldText(view));
  }

  private paintValues(view: HillBarLive): void {
    const s = this.slots;
    if (!s) return;
    const w = this.deps.writers;
    if (s.counts && s.contest && s.fill) {
      const yours = formatNumber(view.yours);
      const theirs = formatNumber(view.theirs);
      w.setText(
        s.counts,
        view.holder === 'other'
          ? t('hudChrome.hill.counts', { yours, theirs })
          : view.holder === 'you'
            ? t('hudChrome.hill.countsHolding', { yours, theirs })
            : t('hudChrome.hill.countsUnheld', { yours, theirs }),
      );
      w.setText(s.contest, contestText(view));
      w.setWidth(s.fill, `${Math.round(view.contestFraction * 100)}%`);
    }
    w.setText(
      s.where,
      view.inside
        ? t('hudChrome.hill.inside')
        : t('hudChrome.hill.distance', { yards: formatNumber(view.distanceYards) }),
    );
    const minutes = durationText(view.minutesLeft * 60);
    w.setText(
      s.when,
      view.phase === 'warning'
        ? t('hudChrome.hill.rises', { minutes })
        : t('hudChrome.hill.falls', { minutes }),
    );
  }
}

/** The note for a viewer who does not count on the hill, or null. */
function standingNote(view: HillBarLive): string | null {
  return view.standing === 'raid' ? t('hudChrome.hill.standingRaid') : null;
}

function heldText(view: HillBarLive): string {
  if (view.phase === 'warning') return t('hudChrome.hill.rising');
  if (view.holder === 'you') return t('hudChrome.hill.heldYou');
  if (view.holder === 'other') return t('hudChrome.hill.heldOther');
  return t('hudChrome.hill.heldNone');
}

function contestText(view: HillBarLive): string {
  const seconds = durationText(view.contest);
  const total = durationText(view.capture);
  if (view.challenger === 'you') return t('hudChrome.hill.contestYou', { seconds, total });
  if (view.challenger === 'other') return t('hudChrome.hill.contestOther', { seconds, total });
  return t('hudChrome.hill.contestNone', { total });
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
