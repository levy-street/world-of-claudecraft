// Builds and wires the mobile action ring, the one action bar a touch player
// actually sees (the desktop rows are display:none under body.mobile-touch).
//
// Extracted from Hud.buildMobileActionRing so the radial rework lands behind the
// action_bar seam instead of growing the coordinator: Hud keeps the page field,
// the cast path and the per-frame paint call, and hands this module a narrow
// dependency bag. Nothing here imports Hud.
//
// What it composes:
//   - a SECOND createActionBarView instance over a 5-slot descriptor (slot 0 the
//     fixed attack toggle, slots 1-4 the radial action buttons, each resolving
//     its CENTRE action for the current page),
//   - a THIRD one over the 4 direction petals, resolving against whichever ring
//     button the gesture currently holds,
//   - the gesture layer (radial_gesture_controller.ts) and the petal painter, and
//   - the ring painter, which owns both layers so Hud.update() keeps one call.
//
// The static markup lives in index.html / play.html (#mobile-action-ring,
// #mobile-action-radial). On a build that omits it, buildMobileActionRing
// returns null and the ring silently stays unbuilt, exactly as the in-Hud
// version did.

import { audio } from '../../../game/audio';
import type { ItemDef } from '../../../sim/types';
import { formatAbilityNumber } from '../../ability_description';
import { abilityDisplayName } from '../../ability_display_name';
import { itemDisplayName } from '../../entity_i18n';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { bindTouchTap } from '../../touch_tap';
import { tapMenusEnabled } from '../tap_menu';
import type { ActionBarSlotElements } from './action_bar_painter';
import {
  type ActionBarAbility,
  type ActionBarState,
  type ActionBarView,
  type ActionBarWorldInput,
  ATTACK_ICON_KEY,
  createActionBarView,
} from './action_bar_view';
import { handleMobileAttackTap } from './hotbar';
import { MOBILE_ACTION_BUTTONS } from './mobile_action_page_view';
import { MobileActionRingPainter } from './mobile_action_ring_painter';
import type { RadialDirection, RadialPlacement } from './radial_action_core';
import { RadialGesture } from './radial_gesture_controller';
import { RADIAL_PETAL_DIRECTIONS, RadialPetalPainter } from './radial_petal_painter';

const RING_ID = 'mobile-action-ring';
const ATTACK_ID = 'mobile-action-attack';
const PAGE_TOGGLE_ID = 'mobile-action-page-toggle';
const PAGE_INDICATOR_SELECTOR = '.mobile-action-page-indicator';
const SLOT_SELECTOR = '.mobile-action-slot';
const RADIAL_ID = 'mobile-action-radial';
const RADIAL_CANCEL_ID = 'mobile-action-radial-cancel';
const PETAL_SELECTOR = '.mobile-action-petal';
const PETAL_DIRECTION_DATASET = 'radialDir';
const MOBILE_INDEX_DATASET = 'mobileIndex';

/** The per-direction accessible name a petal's slot aria is built from ("Action
 *  slot Up: Fireball"), so a screen reader names the direction rather than an
 *  index the player never sees. */
const PETAL_LABEL_KEYS: Record<RadialDirection, TranslationKey> = {
  center: 'hudChrome.mobile.radialCenter',
  up: 'hudChrome.mobile.radialUp',
  right: 'hudChrome.mobile.radialRight',
  down: 'hudChrome.mobile.radialDown',
  left: 'hudChrome.mobile.radialLeft',
};

/** Everything the ring needs from Hud, as callbacks. Deliberately narrow: the
 *  ring resolves slots and casts through the SAME paths a desktop click uses. */
export interface MobileActionRingDeps {
  writers: PainterHostWriters;
  /** Resolve a hotbar icon key to a background-image value. */
  iconBackground(iconKey: string): string;
  /** The hotbar source slot a ring button plus direction maps to on the page
   *  that is current AT CALL TIME (never a captured page). */
  sourceSlot(buttonIndex: number, direction: RadialDirection): number;
  /** Whether that button plus direction maps to a real slot right now. */
  hasSourceSlot(buttonIndex: number, direction: RadialDirection): boolean;
  /** Whether the active ground aim belongs to this physical ring button. */
  aimOwnsButton(buttonIndex: number): boolean;
  /** Cancel the active ground aim owned by a ring button. */
  cancelAim(): void;
  actionForSlot(slot: number): unknown;
  abilityForSlot(slot: number): ActionBarAbility | null;
  itemForSlot(slot: number): ItemDef | null;
  /** The empowered ability a slot holds, if any: an empowered hold owns the
   *  press, so the radial must not arm on that button. */
  empoweredAbilityIdForSlot(slot: number): string | null;
  /** True while the action bar is in keybind-rebinding mode. */
  bindModeActive(): boolean;
  /** Read and clear the drag path's "this release was a drag, not a tap" flag. */
  takeSuppressedClick(): boolean;
  castSlot(slot: number): void;
  cyclePage(): void;
  activateFixedAttackSlot(): void;
  attackNearest: (() => void) | null;
  attackTapState(): { autoAttack: boolean; hasLiveHostileTarget: boolean };
  hideTooltip(): void;
  consumePeekGuard(): void;
  bindEmpoweredHold(btn: HTMLButtonElement, resolveSlot: () => number): void;
}

export interface MobileActionRing {
  /** Ticked by Hud each frame; the petal layer rides the same world snapshot. */
  view: ActionBarView;
  painter: MobileActionRingPainter;
  gesture: RadialGesture;
  attackBtn: HTMLButtonElement;
  slotBtns: HTMLButtonElement[];
}

/** Mint the per-slot child nodes ActionBarPainter writes into. Build-time DOM,
 *  not a per-frame path: everything repeated goes through the painters. */
function slotElements(btn: HTMLButtonElement): ActionBarSlotElements {
  const label = document.createElement('span');
  label.className = 'icon-label';
  const countEl = document.createElement('span');
  countEl.className = 'item-count';
  const keybindEl = document.createElement('span');
  keybindEl.className = 'keybind';
  const cdOverlay = document.createElement('div');
  cdOverlay.className = 'cd-overlay';
  const cdText = document.createElement('div');
  cdText.className = 'cdtext';
  const rechargeOverlay = document.createElement('div');
  rechargeOverlay.className = 'recharge-overlay';
  btn.append(label, countEl, keybindEl, cdOverlay, rechargeOverlay, cdText);
  return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
}

function orderedByIndex(selector: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).sort(
    (a, b) =>
      Number(a.dataset[MOBILE_INDEX_DATASET] ?? 0) - Number(b.dataset[MOBILE_INDEX_DATASET] ?? 0),
  );
}

/**
 * Build the ring, or return null when the markup is absent.
 *
 * Wiring ORDER is load-bearing: the empowered hold is bound BEFORE
 * gesture.attach(), so on a release its pointerup handler runs first and the
 * radial sees the flag it set instead of casting on top of it.
 */
export function buildMobileActionRing(deps: MobileActionRingDeps): MobileActionRing | null {
  const attackBtn = document.getElementById(ATTACK_ID) as HTMLButtonElement | null;
  const slotBtns = orderedByIndex(SLOT_SELECTOR);
  const pageToggle = document.getElementById(PAGE_TOGGLE_ID);
  const pageIndicator = pageToggle?.querySelector<HTMLElement>(PAGE_INDICATOR_SELECTOR);
  const container = document.getElementById(RING_ID);
  if (
    !attackBtn ||
    !container ||
    slotBtns.length !== MOBILE_ACTION_BUTTONS ||
    !pageToggle ||
    !pageIndicator
  ) {
    return null;
  }

  const ringEls: ActionBarSlotElements[] = [attackBtn, ...slotBtns].map(slotElements);
  wireAttackButton(attackBtn, deps);

  const overlay = document.getElementById(RADIAL_ID);
  // Assigned once the painter exists (it needs the petal layer the gesture is
  // handed to). The gesture only reaches it on a state change, never at build.
  let ringPainter: MobileActionRingPainter | null = null;
  const gesture = new RadialGesture({
    buttons: slotBtns,
    // Hud's shared facet, the same one the ring and petal painters write
    // through: the pressed button's aria-expanded state elides against the same
    // cache as every other write on that button.
    writers: deps.writers,
    tapMenus: () => tapMenusEnabled(),
    // The radial's own geometry tokens live on the overlay; the ring container
    // is the fallback for a build without the overlay markup, where the gesture
    // still casts and only the reveal has nothing to show.
    metricsHost: overlay ?? container,
    hasSlot: (buttonIndex, direction) => deps.hasSourceSlot(buttonIndex, direction),
    aimOwnsButton: (buttonIndex) => deps.aimOwnsButton(buttonIndex),
    cancelAim: () => deps.cancelAim(),
    cast: (buttonIndex, direction) => {
      deps.consumePeekGuard();
      deps.hideTooltip();
      audio.click();
      deps.castSlot(deps.sourceSlot(buttonIndex, direction));
      slotBtns[buttonIndex]?.blur();
    },
    pressClaimed: (buttonIndex) =>
      deps.bindModeActive() ||
      deps.empoweredAbilityIdForSlot(deps.sourceSlot(buttonIndex, 'center')) !== null,
    takeSuppressedPress: () => deps.takeSuppressedClick(),
    onCancel: () => {
      deps.consumePeekGuard();
      deps.hideTooltip();
    },
    // A sticky open moves focus onto the first petal in the same call, and a
    // petal the frame has not painted yet is display:none and refuses it. The
    // drag paths keep riding Hud's frame.
    repaint: () => ringPainter?.paintPetals(),
  });

  slotBtns.forEach((btn, i) => {
    deps.bindEmpoweredHold(btn, () => (deps.aimOwnsButton(i) ? -1 : deps.sourceSlot(i, 'center')));
  });
  gesture.attach();

  bindTouchTap(pageToggle, () => {
    deps.consumePeekGuard();
    deps.hideTooltip();
    audio.click();
    deps.cyclePage();
    (pageToggle as HTMLElement).blur();
  });

  // No tooltip on the mobile ring: a long-press-to-inspect wiring lived here
  // (mirroring the desktop bar's attachTooltip), but it read as a stray popup
  // box over the world on an ordinary tap/hold rather than a deliberate inspect
  // gesture, and the hold now belongs to the radial.

  const ringView = createActionBarView(
    {
      slots: [
        {
          slotIndex: 0,
          isAttack: () => true,
          hasAction: () => false,
          ability: () => null,
          item: () => null,
          keybindLabel: () => '',
        },
        ...Array.from({ length: MOBILE_ACTION_BUTTONS }, (_, i) => ({
          slotIndex: i + 1,
          isAttack: () => false,
          hasAction: () => deps.actionForSlot(deps.sourceSlot(i, 'center')) !== null,
          ability: () => deps.abilityForSlot(deps.sourceSlot(i, 'center')),
          item: () => deps.itemForSlot(deps.sourceSlot(i, 'center')),
          keybindLabel: () => '',
          ownsAimSlot: () => deps.aimOwnsButton(i),
        })),
      ],
    },
    {
      t,
      abilityName: abilityDisplayName,
      itemName: itemDisplayName,
      slotLabel: (i) => formatAbilityNumber(i + 1),
      formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
    },
  );

  const petals = buildRadialPetals(deps, gesture, overlay);
  const painter = new MobileActionRingPainter(
    deps.writers,
    { bar: { container, slots: ringEls }, pageToggle: pageToggle as HTMLElement, pageIndicator },
    // The ring's primary attack slot shows the same crisp data-icon="attack"
    // glyph as the (now-secondary) Target swap button instead of the painted
    // ability-icon background desktop's attack toggle uses: an empty background
    // here leaves the inline SVG hydrateIcons() already inserted into
    // #mobile-action-attack's markup visible underneath. Every other slot still
    // resolves through iconBackground exactly like desktop.
    (iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : deps.iconBackground(iconKey)),
    t,
    petals?.ring,
  );
  ringPainter = painter;

  return {
    // The petal layer reads the SAME world snapshot the ring ticks against, so
    // the ring's view is wrapped rather than given a second source of truth.
    view: {
      tick(world: ActionBarWorldInput): ActionBarState {
        petals?.source.setWorld(world);
        return ringView.tick(world);
      },
    },
    painter,
    gesture,
    attackBtn,
    slotBtns,
  };
}

/** The classic fixed attack control while the player is auto-attacking or holds
 *  a live hostile target, and the acquire-nearest fallback otherwise, so a bare
 *  tap with nothing targeted picks the closest enemy and starts swinging instead
 *  of erroring. bindTouchTap, not 'click': the browser only synthesizes click
 *  for the PRIMARY pointer, so a click-bound ring button goes dead the moment
 *  the other thumb holds the joystick, which is how combat is actually played.
 *  The peek guard is CLEARED, never gated on: a set flag here is always stale
 *  cross-talk from another control's long-press, and an early return here ate
 *  the player's next cast. */
function wireAttackButton(attackBtn: HTMLButtonElement, deps: MobileActionRingDeps): void {
  bindTouchTap(attackBtn, () => {
    deps.consumePeekGuard();
    deps.hideTooltip();
    audio.click();
    handleMobileAttackTap(deps.attackTapState(), {
      activateAttack: () => deps.activateFixedAttackSlot(),
      attackNearest: deps.attackNearest,
    });
    attackBtn.blur();
  });
}

/** The petal layer: its own ActionBarView over the 4 directions of whichever
 *  ring button the gesture holds, plus the painter that seats them. Returns null
 *  when the overlay markup is absent, which leaves the ring itself working. */
function buildRadialPetals(
  deps: MobileActionRingDeps,
  gesture: RadialGesture,
  overlay: HTMLElement | null,
): {
  ring: { painter: RadialPetalPainter; source: RadialPetalSource };
  source: RadialPetalSource;
} | null {
  const cancel = document.getElementById(RADIAL_CANCEL_ID);
  const byDirection = new Map(
    Array.from(document.querySelectorAll<HTMLButtonElement>(PETAL_SELECTOR)).map((btn) => [
      btn.dataset[PETAL_DIRECTION_DATASET] ?? '',
      btn,
    ]),
  );
  const ordered = RADIAL_PETAL_DIRECTIONS.map((dir) => byDirection.get(dir));
  if (!overlay || !cancel || ordered.some((btn) => btn === undefined)) return null;
  const petalBtns = ordered as HTMLButtonElement[];
  const petalEls = petalBtns.map(slotElements);
  // Tap mode chooses a petal by tapping it, so the gesture layer needs the petal
  // buttons themselves. They exist only now: the overlay lookup runs after the
  // gesture the ring buttons are already bound to.
  gesture.attachPetals(
    RADIAL_PETAL_DIRECTIONS.map((direction, i) => ({ direction, el: petalBtns[i] as HTMLElement })),
    cancel,
  );

  const view = createActionBarView(
    {
      slots: RADIAL_PETAL_DIRECTIONS.map((direction, i) => ({
        slotIndex: i,
        isAttack: () => false,
        hasAction: () => petalSlot(deps, gesture, direction) !== null,
        ability: () => {
          const slot = petalSlot(deps, gesture, direction);
          return slot === null ? null : deps.abilityForSlot(slot);
        },
        item: () => {
          const slot = petalSlot(deps, gesture, direction);
          return slot === null ? null : deps.itemForSlot(slot);
        },
        keybindLabel: () => '',
      })),
    },
    {
      t,
      abilityName: abilityDisplayName,
      itemName: itemDisplayName,
      slotLabel: (i) => t(PETAL_LABEL_KEYS[RADIAL_PETAL_DIRECTIONS[i] ?? 'center']),
      formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
    },
  );

  const painter = new RadialPetalPainter(
    deps.writers,
    { overlay, cancel, bar: { container: overlay, slots: petalEls } },
    (iconKey) => deps.iconBackground(iconKey),
  );
  const source = new RadialPetalSource(gesture, view);
  return { ring: { painter, source }, source };
}

/** The hotbar slot a petal direction holds for the currently held ring button,
 *  or null when nothing is held or the direction has no slot on this page. */
function petalSlot(
  deps: MobileActionRingDeps,
  gesture: RadialGesture,
  direction: RadialDirection,
): number | null {
  const buttonIndex = gesture.heldButtonIndex();
  if (buttonIndex < 0) return null;
  if (!deps.hasSourceSlot(buttonIndex, direction)) return null;
  return deps.sourceSlot(buttonIndex, direction);
}

/** Joins the gesture's readout to the petal view for the ring painter. The world
 *  arrives from the ring's own tick, so the two layers can never disagree about
 *  which frame they are painting. */
class RadialPetalSource {
  private world: ActionBarWorldInput | null = null;

  constructor(
    private readonly gesture: RadialGesture,
    private readonly view: ActionBarView,
  ) {}

  setWorld(world: ActionBarWorldInput): void {
    this.world = world;
  }

  isOpen(): boolean {
    return this.gesture.isOpen() && this.world !== null;
  }

  placement(): RadialPlacement | null {
    return this.gesture.placement();
  }

  liveDirection(): RadialDirection {
    return this.gesture.liveDirection();
  }

  cancelIsLive(): boolean {
    return this.gesture.cancelIsLive();
  }

  tick(): ActionBarState {
    return this.view.tick(this.world as ActionBarWorldInput);
  }
}
