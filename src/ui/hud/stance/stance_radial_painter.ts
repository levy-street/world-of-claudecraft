// Thin painter for the touch stance control: the anchor's face plus the petal
// overlay the radial opens. It owns no state and no rules; the model comes from
// stance_radial_core.ts, the seating from placeRadial via the shared gesture
// layer, and every write routes through the injected PainterHostWriters, exactly
// as the ring's own petal painter does.
//
// It does NOT reuse RadialPetalPainter: that one paints ActionBarState (hotbar
// slots with cooldowns, charges, range and proc state), and a stance petal has
// none of that. What IS reused is the geometry and the direction order, so the
// two radials sit on the same circle and the petal for 'up' means the same
// thing on both.
//
// Static layout (sizes, shape, scrim, transitions) stays in hud.mobile.css per
// tier; only the measured origin can live here, because it depends on where the
// anchor actually is once the tier and the user's button scale are applied.

import type { PainterHostWriters } from '../../painter_host';
import type { RadialDirection, RadialPlacement } from '../action_bar/radial_action_core';
import { STANCE_PETAL_DIRECTIONS, type StanceRadialModel } from './stance_radial_core';

const CLASS_OPEN = 'open';
const CLASS_LIVE = 'live';
const CLASS_ACTIVE = 'active';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';
const ORIGIN_X_PROP = '--radial-x';
const ORIGIN_Y_PROP = '--radial-y';
const ARIA_PRESSED_ATTR = 'aria-pressed';
const ARIA_LABEL_ATTR = 'aria-label';
const ARIA_HIDDEN_ATTR = 'aria-hidden';
const BACKGROUND_IMAGE_PROP = 'background-image';

/** The elements the control is painted into. Minted once from the static markup
 *  (index.html / play.html), so the painter never queries the document. */
export interface StanceRadialPaintDescriptor {
  /** The circular control on the button row: wears the active stance. */
  anchor: HTMLElement;
  /** The anchor's icon face, so the button keeps its own chrome. */
  anchorIcon: HTMLElement;
  /** The overlay root: carries the open class and the scrim's origin vars. */
  overlay: HTMLElement;
  /** The centre target that backs out of an opened radial without switching. */
  cancel: HTMLElement;
  /** The four petals, in STANCE_PETAL_DIRECTIONS order. */
  petals: readonly { btn: HTMLElement; icon: HTMLElement }[];
}

/** What the painter needs about each stance beyond the model: the resolved icon
 *  URL and the localized name, both supplied by the owning controller so this
 *  module holds no icon cache and no i18n of its own. */
export interface StanceRadialLabels {
  iconBackground(iconKey: string): string;
  name(abilityId: string): string;
  /** The anchor's accessible name for the stance it currently wears. */
  anchorName(model: StanceRadialModel): string;
}

export class StanceRadialPainter {
  /** Icon keys already resolved into a background URL, per face. The RESOLVE is
   *  what costs (icons.ts paints a canvas and returns a data URL), so the key is
   *  diffed here and the producer re-run only when it moves; the write itself is
   *  elided a second time by the facet. */
  private lastAnchorIconKey = '';
  private readonly lastPetalIconKeys: string[] = [];

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: StanceRadialPaintDescriptor,
    private readonly labels: StanceRadialLabels,
  ) {}

  /** Paint the anchor's face. Cheap and fully elided, so the owning controller
   *  can call it from the same signature-gated path the desktop row rebuilds on. */
  paintAnchor(model: StanceRadialModel): void {
    const { anchor, anchorIcon, petals } = this.descriptor;
    this.writers.setDisplay(anchor, model.visible ? 'flex' : 'none');
    if (!model.visible) return;
    const anchorIconKey = model.anchorIconKey ?? '';
    if (anchorIconKey !== this.lastAnchorIconKey) {
      this.lastAnchorIconKey = anchorIconKey;
      this.writers.setStyleProp(
        anchorIcon,
        BACKGROUND_IMAGE_PROP,
        anchorIconKey === '' ? 'none' : `url(${this.labels.iconBackground(anchorIconKey)})`,
      );
    }
    this.writers.toggleClass(anchor, CLASS_ACTIVE, model.anchorActive);
    this.writers.setAttr(anchor, ARIA_PRESSED_ATTR, model.anchorActive ? 'true' : 'false');
    this.writers.setAttr(anchor, ARIA_LABEL_ATTR, this.labels.anchorName(model));
    for (let i = 0; i < petals.length; i++) {
      const petal = model.petals[i];
      const { btn, icon } = petals[i];
      // A direction with no stance on it stays hidden AND out of the a11y tree:
      // a focusable empty circle is a dead stop for a Switch Control user.
      this.writers.setDisplay(btn, petal === undefined ? 'none' : 'flex');
      this.writers.setAttr(btn, ARIA_HIDDEN_ATTR, petal === undefined ? 'true' : 'false');
      if (petal === undefined) continue;
      if (this.lastPetalIconKeys[i] !== petal.iconKey) {
        this.lastPetalIconKeys[i] = petal.iconKey;
        this.writers.setStyleProp(
          icon,
          BACKGROUND_IMAGE_PROP,
          `url(${this.labels.iconBackground(petal.iconKey)})`,
        );
      }
      this.writers.setAttr(btn, ARIA_LABEL_ATTR, this.labels.name(petal.id));
    }
  }

  /** Show the petals seated around `placement`, marking `live` the direction the
   *  drag currently points at. `cancelLive` arrives resolved from the gesture
   *  layer's shared rule, never re-derived here. */
  paintOpen(placement: RadialPlacement, live: RadialDirection, cancelLive: boolean): void {
    const { overlay, cancel, petals } = this.descriptor;
    this.writers.toggleClass(overlay, CLASS_OPEN, true);
    this.writers.setStyleProp(overlay, ORIGIN_X_PROP, `${placement.originX}px`);
    this.writers.setStyleProp(overlay, ORIGIN_Y_PROP, `${placement.originY}px`);
    this.writers.setStyleProp(cancel, LEFT_PROP, `${placement.originX}px`);
    this.writers.setStyleProp(cancel, TOP_PROP, `${placement.originY}px`);
    this.writers.toggleClass(cancel, CLASS_LIVE, cancelLive);
    for (let i = 0; i < petals.length; i++) {
      const seat = placement.petals[i + 1];
      const { btn } = petals[i];
      this.writers.setStyleProp(btn, LEFT_PROP, `${placement.originX + seat.dx}px`);
      this.writers.setStyleProp(btn, TOP_PROP, `${placement.originY + seat.dy}px`);
      this.writers.toggleClass(btn, CLASS_LIVE, STANCE_PETAL_DIRECTIONS[i] === live);
    }
  }

  /** Close the overlay. The seating stays as written: it is re-established on the
   *  next open, and rewriting it here would cost writes for a hidden layer. */
  hide(): void {
    this.writers.toggleClass(this.descriptor.overlay, CLASS_OPEN, false);
  }
}
