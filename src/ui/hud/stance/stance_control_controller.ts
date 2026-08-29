// Builds and wires the TOUCH stance control: the circular anchor on the button
// row plus the four-direction radial it opens. Presentation and input only;
// every rule it applies belongs to someone else.
//
// It is a new CONSUMER of the ring's gesture layer, not a new gesture: the
// pointer capture, the reveal timer, the single anchor measure, the window
// release backstop, sticky/tap mode, aria-expanded and the Escape closer all
// come from ../action_bar/radial_gesture_controller.ts, parameterized with
// `anchorRole: 'toggle'` because the control runs no action of its own (a bare
// tap opens the radial and the next press closes it, in EITHER mode). The
// direction and release tables are radial_action_core.ts / radial_gesture_core.ts
// and tap_menu_core.ts; the stance-to-direction mapping is stance_radial_core.ts.
//
// The static markup lives in index.html / play.html (#mobile-stance-anchor,
// #mobile-stance-radial). On a build that omits it, buildStanceControl returns
// null and the control silently stays unbuilt, exactly like the ring.

import type { PainterHostWriters } from '../../painter_host';
import { RadialGesture } from '../action_bar/radial_gesture_controller';
import { tapMenusEnabled } from '../tap_menu';
import {
  STANCE_PETAL_DIRECTIONS,
  type StanceRadialModel,
  stancePetalIndex,
} from './stance_radial_core';
import {
  type StanceRadialLabels,
  type StanceRadialPaintDescriptor,
  StanceRadialPainter,
} from './stance_radial_painter';

const ANCHOR_ID = 'mobile-stance-anchor';
const ANCHOR_ICON_SELECTOR = '.icon-label';
const OVERLAY_ID = 'mobile-stance-radial';
const CANCEL_ID = 'mobile-stance-cancel';
const PETAL_SELECTOR = '.mobile-stance-petal';

/** The model an unbuilt or hidden control reports, so the caller never has to
 *  hold a null-shaped special case. */
const CLOSED_MODEL: StanceRadialModel = {
  visible: false,
  activeId: null,
  anchorIconKey: null,
  anchorActive: false,
  petals: [],
  overflow: [],
  sig: 'hidden',
};

export interface StanceControlDeps {
  /** Hud's shared write-elision facet: the anchor and the petals are painted
   *  from the frame loop, so they write into the same cache as every other. */
  writers: PainterHostWriters;
  /** Resolved icon URL for a stance ability id. */
  iconBackground(iconKey: string): string;
  /** The localized name of a stance ability. */
  name(abilityId: string): string;
  /** The anchor's accessible name for the stance it currently wears. */
  anchorName(model: StanceRadialModel): string;
  /** Switch to this stance. Routes through the SAME cast path the desktop row's
   *  buttons use; only the input differs. */
  cast(abilityId: string): void;
  /** The player opened the radial and chose nothing. */
  onCancel?(): void;
}

export interface StanceControl {
  /** Paint the anchor's face from the current model. Called every frame; every
   *  write is elided and the icon RESOLVE is key-diffed inside the painter. */
  render(model: StanceRadialModel): void;
  /** The anchor element, so the owner can reach it for focus or measurement. */
  anchor: HTMLButtonElement;
}

/** Build the control, or return null when the markup is absent. */
export function buildStanceControl(deps: StanceControlDeps): StanceControl | null {
  const anchor = document.getElementById(ANCHOR_ID) as HTMLButtonElement | null;
  const overlay = document.getElementById(OVERLAY_ID);
  const cancel = document.getElementById(CANCEL_ID);
  const anchorIcon = anchor?.querySelector<HTMLElement>(ANCHOR_ICON_SELECTOR) ?? null;
  if (!anchor || !overlay || !cancel || !anchorIcon) return null;
  const petalEls = [...overlay.querySelectorAll<HTMLElement>(PETAL_SELECTOR)];
  if (petalEls.length !== STANCE_PETAL_DIRECTIONS.length) return null;
  const petals = petalEls.map((btn) => {
    const icon = btn.querySelector<HTMLElement>(ANCHOR_ICON_SELECTOR);
    return icon === null ? null : { btn, icon };
  });
  if (petals.some((p) => p === null)) return null;
  const seats = petals as { btn: HTMLElement; icon: HTMLElement }[];

  const descriptor: StanceRadialPaintDescriptor = {
    anchor,
    anchorIcon,
    overlay,
    cancel,
    petals: seats,
  };
  const labels: StanceRadialLabels = {
    iconBackground: (key) => deps.iconBackground(key),
    name: (id) => deps.name(id),
    anchorName: (model) => deps.anchorName(model),
  };
  const painter = new StanceRadialPainter(deps.writers, descriptor, labels);

  // The live model, refreshed by render() from the frame loop. The gesture layer
  // reads it at press time rather than capturing it, because the choice set moves
  // with the worn stance and a captured copy would cast a stale id.
  let model: StanceRadialModel = CLOSED_MODEL;

  const gesture = new RadialGesture({
    buttons: [anchor],
    writers: deps.writers,
    tapMenus: () => tapMenusEnabled(),
    // The control shows the worn stance and switches to another; it has no action
    // of its own, so its own press only ever opens or closes the radial.
    anchorRole: 'toggle',
    // The geometry tokens live on the OVERLAY, a sibling of the anchor, so the
    // petals are seated in viewport coordinates rather than inside the anchor's
    // own scaled box.
    metricsHost: overlay,
    hasSlot: (_buttonIndex, direction) => stancePetalIndex(model, direction) >= 0,
    cast: (_buttonIndex, direction) => {
      const index = stancePetalIndex(model, direction);
      const petal = model.petals[index];
      if (petal === undefined) return;
      deps.cast(petal.id);
      anchor.blur();
    },
    // Nothing else binds this control, and it carries no drag-suppressed press.
    pressClaimed: () => false,
    takeSuppressedPress: () => false,
    onCancel: () => deps.onCancel?.(),
    // A sticky open moves focus onto the first petal in the same call, and a
    // petal the frame has not painted yet is display:none and refuses it. The
    // drag paths keep riding the frame loop through render().
    repaint: () => paintRadial(),
  });

  /** Paint or hide the radial from the gesture's own readouts. render() below
   *  runs it every frame after the anchor; the gesture runs it on a state
   *  change that has to land before focus moves. */
  const paintRadial = (): void => {
    const placement = gesture.placement();
    if (!gesture.isOpen() || placement === null) {
      painter.hide();
      return;
    }
    painter.paintOpen(placement, gesture.liveDirection(), gesture.cancelIsLive());
  };
  gesture.attach();
  gesture.attachPetals(
    STANCE_PETAL_DIRECTIONS.map((direction, i) => ({ direction, el: seats[i].btn })),
    cancel,
  );

  return {
    anchor,
    render(next: StanceRadialModel): void {
      model = next;
      painter.paintAnchor(next);
      paintRadial();
    },
  };
}
