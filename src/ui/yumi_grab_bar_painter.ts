// Thin painter for the Protect Yumi hold-to-grab bar (a cast-style timer that
// fills while the local player channels a mystery power-up). The pure fill rule
// lives in yumi_grab_bar_view.ts; this builds its own DOM once under the injected
// mount (so it never touches the two game HTML entries) and routes EVERY
// per-frame write through the host's elided writers. Localized text re-renders
// through t() each update and relies on writer elision.
//
// Shown only for the LOCAL player and only while a grab is in progress; the
// state comes from player.yumiGrabRemaining/yumiGrabTotal, which ride the self
// snapshot on both hosts, so the bar reflects the server-authoritative channel.

import type { IWorld } from '../world_api';
import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { yumiGrabBarState } from './yumi_grab_bar_view';

interface GrabBarEls {
  root: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
}

const FILL_PERCENT_FRACTION_DIGITS = 1;
const SECONDS_FRACTION_DIGITS = 1;

export class YumiGrabBarPainter {
  private els: GrabBarEls | null = null;

  constructor(
    private readonly w: PainterHostWriters,
    private readonly mount: () => HTMLElement | null,
  ) {}

  update(world: IWorld): void {
    const p = world.player;
    const state = yumiGrabBarState({
      yumiGrabRemaining: p.yumiGrabRemaining,
      yumiGrabTotal: p.yumiGrabTotal,
    });
    if (!state.visible) {
      if (this.els) this.w.setDisplay(this.els.root, 'none');
      return;
    }
    const els = this.ensureEls();
    if (!els) return;
    this.w.setDisplay(els.root, 'flex');
    this.w.setWidth(els.fill, `${(state.frac * 100).toFixed(FILL_PERCENT_FRACTION_DIGITS)}%`);
    this.w.setText(
      els.label,
      t('yumi.grab.channeling', {
        s: formatNumber(state.secondsLeft, {
          minimumFractionDigits: SECONDS_FRACTION_DIGITS,
          maximumFractionDigits: SECONDS_FRACTION_DIGITS,
        }),
      }),
    );
    this.w.setAttr(els.root, 'aria-label', t('yumi.grab.aria'));
  }

  // Build the bar once under the mount; static structure only (text + width flow
  // through the elided writers in update()).
  private ensureEls(): GrabBarEls | null {
    if (this.els) return this.els;
    const mount = this.mount();
    if (!mount) return null;
    const root = document.createElement('div');
    root.id = 'yumi-grab-bar';
    root.className = 'yumi-grab-bar';
    root.setAttribute('role', 'status');
    const label = document.createElement('div');
    label.className = 'ygb-label';
    const track = document.createElement('div');
    track.className = 'ygb-track';
    const fill = document.createElement('div');
    fill.className = 'ygb-fill';
    track.appendChild(fill);
    root.append(label, track);
    mount.appendChild(root);
    this.els = { root, fill, label };
    return this.els;
  }
}
