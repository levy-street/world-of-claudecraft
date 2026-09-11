// DOM adapter for the cross-hotbar overlay: mints the two halves, their four
// diamonds and sixteen cells inside the static #cross-hotbar root, holds the
// current overlay state, and drives the painter each frame. Cold by contract: no
// layout reads, no driver of its own (the HUD's frame loop calls paint).
//
// The cells are real buttons and therefore NOT inside an aria-hidden root: focusable
// content hidden from assistive tech is a violation, and the pad has to be able to
// select a cell while arranging. Each cell carries the shared action-bar painter's
// own aria-label and aria-disabled, which is why the button role has to be real:
// ARIA drops both on a generic role, leaving the announced name behind.

import { CROSS_HOTBAR_ATTACK_ID } from '../../../game/cross_hotbar';
import type { ResolvedAbility } from '../../../sim/sim';
import type { AbilityDef, ItemDef } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { isStanceBarAbilityGroup } from '../../stance_bar_view';
import type { ActionBarSlotElements } from '../action_bar/action_bar_painter';
import type {
  ActionBarAbility,
  ActionBarView,
  ActionBarWorldInput,
} from '../action_bar/action_bar_view';
import { createActionBarView } from '../action_bar/action_bar_view';
import { CrossHotbarPainter } from './cross_hotbar_painter';
import {
  CROSS_HOTBAR_CELLS,
  type CrossHotbarCell,
  type CrossHotbarHold,
  type CrossHotbarOverlayAction,
  type CrossHotbarOverlayState,
  crossHotbarOverlayState,
  HIDDEN_CROSS_HOTBAR,
} from './cross_hotbar_view';

const ROOT_ID = 'cross-hotbar';
const HALF_CLASS = 'xhb-half';
const CLUSTER_CLASS = 'xhb-diamond';
const CELL_CLASS = 'xhb-slot';
const CELL_POSITION_ATTR = 'data-xhb-point';
const CELL_INDEX_ATTR = 'data-xhb-index';
const HALF_LAYER_ATTR = 'data-xhb-half';
const GLYPH_CLASS = 'xhb-glyph';
const GLYPH_LONG_CLASS = 'xhb-glyph-long';
const TABINDEX_ATTR = 'tabindex';
// A resting cell is cast by its hardware chord and the overlay takes no pointer,
// so it is a readout: reachable only while arranging, which is the one act that
// picks a cell rather than firing it.
const CELL_TAB_STOP = '0';
const CELL_NOT_TAB_STOP = '-1';
const EDIT_CLASS = 'xhb-editing';
const CARRIED_CLASS = 'xhb-carried';
// Marks the spellbook row whose action is in hand. The bar shows a gap for an
// action lifted off a CELL; one picked out of the book leaves no gap, so without
// this a pick-up from the spellbook had no visible effect at all.
const SPELL_CARRIED_CLASS = 'spell-carried';

function markCarriedSpellbookRow(abilityId: string | null): void {
  for (const el of document.querySelectorAll<HTMLElement>(`.${SPELL_CARRIED_CLASS}`)) {
    el.classList.remove(SPELL_CARRIED_CLASS);
  }
  if (!abilityId) return;
  const row = document.querySelector<HTMLElement>(`.spell-row[data-ability-id="${abilityId}"]`);
  row?.classList.add(SPELL_CARRIED_CLASS);
}
// Painted at nothing while hidden: the painter returns after its display write.
const EMPTY_BAR_STATE = { slots: [], manySpells: false };
const TRIGGER_CLASS = 'xhb-trigger';
const HINT_CLASS = 'xhb-hint';
const STUD_CLASS = 'xhb-stud';
const SET_RAIL_CLASS = 'xhb-set-rail';
const SET_PIP_CLASS = 'xhb-pip';
const SET_ATTR = 'data-xhb-set';
const SET_COUNT = 2;
// The set-swap chip under the pips. The pips say which of the two sets is live;
// this says how to change it, which nothing on the bar said before.
const SET_SWAP_CLASS = 'xhb-set-swap';

const FACE_GLYPH_CLASS_BY_POINT: Record<CrossHotbarCell['point'], string> = {
  top: `${GLYPH_CLASS}-face-y`,
  left: `${GLYPH_CLASS}-face-x`,
  right: `${GLYPH_CLASS}-face-b`,
  bottom: `${GLYPH_CLASS}-face-a`,
};

/** Mint one cell's inner spans, matching the action bar's element contract so the
 *  shared ActionBarPainter can write it unchanged. */
function buildCell(cell: CrossHotbarCell): ActionBarSlotElements {
  // The same element the desktop action bar mints for a slot, so one stylesheet
  // and one painter serve both, and the painter's aria-label lands on a role that
  // is allowed to carry it.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `action-btn ${CELL_CLASS} ui-socket`;
  btn.setAttribute(CELL_POSITION_ATTR, cell.point);
  btn.setAttribute(CELL_INDEX_ATTR, String(cell.index));
  btn.setAttribute(TABINDEX_ATTR, CELL_NOT_TAB_STOP);
  const label = document.createElement('span');
  label.className = 'icon-label ui-socket-art';
  const countEl = document.createElement('span');
  countEl.className = 'item-count ui-socket-count ui-num';
  const keybindEl = document.createElement('span');
  keybindEl.className = 'keybind ui-socket-key';
  const cdOverlay = document.createElement('div');
  cdOverlay.className = 'cd-overlay ui-socket-cd';
  const cdText = document.createElement('div');
  cdText.className = 'cdtext ui-socket-cd-text ui-num';
  const rechargeOverlay = document.createElement('div');
  rechargeOverlay.className = 'recharge-overlay';
  btn.append(label, countEl, keybindEl, cdOverlay, rechargeOverlay, cdText);
  return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
}

/** How the overlay turns a cell's action id into something paintable. The bar owns
 *  its actions now, so it cannot read cells out of the desktop bar's state array
 *  and has to resolve them itself. */
export interface CrossHotbarResolvers {
  abilityById(id: string): ActionBarAbility | null;
  itemById(id: string): ItemDef | null;
  abilityName(def: AbilityDef): string;
  itemName(item: ItemDef): string;
  /** The armed ground aim's ability id, so the owning cell shows the aiming
   *  accent. Identity is by ABILITY here, never by bar slot: an XHB cell has
   *  no desktop slot, and an XHB-only aim carries the sentinel slot. */
  activeAimAbilityId(): string | null;
}

/** The resolver bag, built from the world the HUD already holds. Lives here rather
 *  than inline at the call site so src/ui/hud.ts carries a call, not a shape. */
export function crossHotbarResolvers(
  sim: {
    resolvedAbility(id: string): ResolvedAbility | null;
  },
  items: Record<string, ItemDef>,
  abilityName: (def: AbilityDef) => string,
  itemName: (item: ItemDef) => string,
  activeAimAbilityId: () => string | null,
): CrossHotbarResolvers {
  return {
    // Same resolution the action bar performs on its own slots (IWorld.resolvedAbility):
    // a saved binding keeps the BASE ability id while the painted cell follows aura and
    // talent state, so a transformed ability shows what would actually be cast.
    abilityById: (id) => sim.resolvedAbility(id),
    itemById: (id) => items[id] ?? null,
    abilityName,
    itemName,
    activeAimAbilityId,
  };
}

/**
 * What an untouched cross hotbar is filled from: this character's action bar,
 * plus the abilities a pad needs that the bar does not carry. Attack leads the
 * extras because it sits on no hotbar slot to copy (the desktop bar draws it as a
 * fixed button), so a pad player would otherwise have no auto-attack at all; the
 * stance-style abilities follow, known at level one yet unbound and so
 * unreachable on a pad. Lives here rather than inline at the call site so
 * src/ui/hud.ts carries a call, not a shape (the crossHotbarResolvers pattern).
 */
export function crossHotbarSeedActions(
  bar: readonly CrossHotbarOverlayAction[],
  known: readonly ResolvedAbility[],
): { bar: CrossHotbarOverlayAction[]; extras: string[] } {
  return {
    bar: bar.map((a) => (a ? { type: a.type, id: a.id } : null)),
    extras: [
      CROSS_HOTBAR_ATTACK_ID,
      ...known.filter((k) => isStanceBarAbilityGroup(k.def.exclusiveGroup)).map((k) => k.def.id),
    ],
  };
}

export class CrossHotbarController {
  private readonly painter: CrossHotbarPainter;
  private readonly view: ActionBarView;
  private readonly glyphs: HTMLElement[] = [];
  private readonly cellEls: HTMLElement[] = [];
  private readonly root: HTMLElement;
  private readonly triggerLabels = new Map<string, HTMLElement>();
  private readonly hint: HTMLElement;
  private readonly setSwap: HTMLElement;
  private readonly setSwapChip: HTMLElement;
  private state: CrossHotbarOverlayState = HIDDEN_CROSS_HOTBAR;
  // The hint the bar shows when it is not being arranged, kept so leaving edit
  // mode puts it back without waiting for the next hold to repaint it.
  private restingHint = '';
  private editing = false;

  private constructor(
    root: HTMLElement,
    private readonly writers: PainterHostWriters,
    iconBg: (k: string) => string,
    private readonly resolve: CrossHotbarResolvers,
  ) {
    this.root = root;
    const cells: ActionBarSlotElements[] = [];
    const halfEls = new Map<string, HTMLElement>();
    for (const cell of CROSS_HOTBAR_CELLS) {
      let half = halfEls.get(cell.layer);
      if (!half) {
        half = document.createElement('div');
        half.className = `${HALF_CLASS} ${HALF_CLASS}-${cell.layer}`;
        half.setAttribute(HALF_LAYER_ATTR, cell.layer);
        const trigger = document.createElement('span');
        trigger.className = `${TRIGGER_CLASS} ${TRIGGER_CLASS}-${cell.layer} ui-keycap`;
        half.appendChild(trigger);
        this.triggerLabels.set(cell.layer, trigger);
        halfEls.set(cell.layer, half);
        root.appendChild(half);
      }
      const clusterKey = `${cell.layer}:${cell.cluster}`;
      let cluster = halfEls.get(clusterKey);
      if (!cluster) {
        cluster = document.createElement('div');
        cluster.className = `${CLUSTER_CLASS} ${CLUSTER_CLASS}-${cell.cluster}`;
        const stud = document.createElement('span');
        stud.className = `${STUD_CLASS} ui-medal ui-medal--stud`;
        stud.setAttribute('aria-hidden', 'true');
        cluster.appendChild(stud);
        halfEls.set(clusterKey, cluster);
        half.appendChild(cluster);
      }
      const els = buildCell(cell);
      const glyph = document.createElement('span');
      glyph.className = `${GLYPH_CLASS} ${GLYPH_CLASS}-${cell.cluster}`;
      els.btn.appendChild(glyph);
      // The d-pad four share ONE glyph and differ only by rotation, which is the
      // only way all four come out the same size (no font draws its four arrows
      // alike). The face four keep their letters, which need no turning.
      if (cell.cluster === 'dpad') glyph.classList.add(`${GLYPH_CLASS}-${cell.point}`);
      else glyph.classList.add(FACE_GLYPH_CLASS_BY_POINT[cell.point]);
      this.glyphs[cell.index] = glyph;
      this.cellEls[cell.index] = els.btn;
      cluster.appendChild(els.btn);
      cells[cell.index] = els;
    }
    // Which of the two standing sets a press fires from. Decorative-free: the bar
    // never said this before, and without it the expanded bank and the ordinary
    // one look identical once the unreachable half is dropped.
    const setRail = document.createElement('div');
    setRail.className = SET_RAIL_CLASS;
    setRail.setAttribute('aria-hidden', 'true');
    for (let set = 0; set < SET_COUNT; set++) {
      const pip = document.createElement('span');
      pip.className = `${SET_PIP_CLASS} ui-medal ui-medal--stud`;
      pip.setAttribute(SET_ATTR, String(set));
      setRail.appendChild(pip);
    }
    const setSwapChip = document.createElement('span');
    setSwapChip.className = `${SET_SWAP_CLASS} ui-keycap`;
    setSwapChip.setAttribute('aria-hidden', 'true');
    // The glyph rides its OWN span: the writer cache holds one entry per element,
    // so texting and hiding the same node would evict each other every hold.
    this.setSwap = document.createElement('span');
    setSwapChip.appendChild(this.setSwap);
    this.setSwapChip = setSwapChip;
    setRail.appendChild(setSwapChip);
    root.insertBefore(setRail, halfEls.get('right') ?? null);
    this.hint = document.createElement('div');
    this.hint.className = HINT_CLASS;
    root.appendChild(this.hint);
    // The overlay's OWN view: sixteen slots resolved from this bar's actions, not
    // from the desktop bar. That is what lets a pad layout hold something the
    // action bar does not (a warrior's stance) and be arranged independently.
    this.view = createActionBarView(
      {
        slots: CROSS_HOTBAR_CELLS.map((cell) => ({
          slotIndex: cell.index,
          // Reuses the shared bar's whole attack branch (its icon, the auto-attack
          // queued glow, the melee range check) rather than a second render path.
          isAttack: () => this.state.cellActions[cell.index]?.id === CROSS_HOTBAR_ATTACK_ID,
          hasAction: () => this.state.cellActions[cell.index] !== null,
          ability: () => {
            const a = this.state.cellActions[cell.index];
            return a?.type === 'ability' ? resolve.abilityById(a.id) : null;
          },
          item: () => {
            const a = this.state.cellActions[cell.index];
            return a?.type === 'item' ? resolve.itemById(a.id) : null;
          },
          keybindLabel: () => '',
          ownsAimSlot: () => {
            const a = this.state.cellActions[cell.index];
            return a?.type === 'ability' && a.id === resolve.activeAimAbilityId();
          },
        })),
      },
      {
        t,
        abilityName: (def) => resolve.abilityName(def),
        itemName: (item) => resolve.itemName(item),
        slotLabel: (i) => formatNumber(i + 1, { maximumFractionDigits: 0 }),
        formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
      },
    );
    this.painter = new CrossHotbarPainter(
      writers,
      {
        root,
        leftHalf: halfEls.get('left') ?? root,
        rightHalf: halfEls.get('right') ?? root,
        bar: { container: root, slots: cells },
      },
      iconBg,
    );
  }

  /** Build the overlay, or answer undefined on a document without the root (the
   *  same defensive shape the mobile action ring uses for an older template). */
  static create(
    writers: PainterHostWriters,
    iconBg: (iconKey: string) => string,
    resolve: CrossHotbarResolvers,
  ): CrossHotbarController | undefined {
    const root = document.getElementById(ROOT_ID);
    return root ? new CrossHotbarController(root, writers, iconBg, resolve) : undefined;
  }

  /** Show the bar (arming at most one half), or hide it with null. The glyphs are
   *  written here rather than per frame (they only move when the pad's brand does)
   *  and into their OWN element, because the shared ActionBarPainter owns
   *  `.keybind` and would overwrite a glyph parked there with the keyboard keycap. */
  setHold(hold: CrossHotbarHold | null): void {
    this.state = crossHotbarOverlayState(hold);
    if (!hold) return;
    const labels = hold.buttons;
    for (let i = 0; i < this.glyphs.length; i++) {
      const label = labels[i] ?? '';
      this.writers.setText(this.glyphs[i], label);
      this.writers.toggleClass(this.glyphs[i], GLYPH_LONG_CLASS, label.length > 1);
    }
    // Written here rather than per frame, beside the cell glyphs, for the same
    // reason: it only moves when the pad's brand or the player's binding does.
    this.writers.setText(this.setSwap, hold.swap);
    this.writers.setDisplay(this.setSwapChip, hold.swap ? 'inline-flex' : 'none');
    const bothTriggers = t('hudChrome.controller.crossHotbarPosition', {
      trigger: hold.triggers.left,
      button: hold.triggers.right,
    });
    for (const [layer, el] of this.triggerLabels) {
      // In the expanded bank the reachable half is opened by BOTH triggers, so it
      // says so: labelling it with one trigger made the bank read as that
      // trigger's ordinary page rather than the extra one.
      const next =
        hold.expanded && layer === hold.layer
          ? bothTriggers
          : layer === 'left'
            ? hold.triggers.left
            : hold.triggers.right;
      this.writers.setText(el, next);
    }
    // Advertises the route to the expanded bank: hold one trigger, tap the other.
    // The resting bar carries the way INTO arrange mode; a chord nothing names is
    // a chord nobody finds. Once a trigger is held the expanded route matters more,
    // so the arrange line gives way to it.
    this.restingHint =
      hold.layer === null
        ? t('hudChrome.controller.crossHotbarArrangeChord', {
            bumper: hold.arrange.bumper,
            button: hold.arrange.button,
          })
        : bothTriggers;
    if (!this.editing) this.writers.setText(this.hint, this.restingHint);
  }

  /** The player-facing name of a carried action, for the carrying line. */
  private actionName(id: string): string {
    const ability = this.resolve.abilityById(id);
    return ability ? this.resolve.abilityName(ability.def) : id;
  }

  /** Which cell the pad has focused, or null when focus is elsewhere. Read off the
   *  cell's own index attribute so the DOM stays the single source of truth for
   *  what is selected. */
  focusedCell(): number | null {
    const active = document.activeElement as HTMLElement | null;
    const raw = active?.getAttribute?.(CELL_INDEX_ATTR);
    if (raw === null || raw === undefined) return null;
    const index = Number(raw);
    return Number.isInteger(index) ? index : null;
  }

  /** Pin the bar open for arranging, mark the cell being carried, and open the
   *  cells to focus for as long as the mode lasts, so the player can see what they
   *  picked up and reach the cell they want to put it on. */
  setEditing(active: boolean, carriedFrom: number | null, carried: string | null = null): void {
    this.editing = active;
    this.root.classList.toggle(EDIT_CLASS, active);
    // Carrying is the state with no other tell when the action came from the
    // spellbook: it left no gap on the bar, so the line has to say what is in hand.
    const hint = !active
      ? this.restingHint
      : carried
        ? t('hudChrome.controller.crossHotbarCarrying', { action: this.actionName(carried) })
        : t('hudChrome.controller.crossHotbarEditHint');
    this.writers.setText(this.hint, hint);
    markCarriedSpellbookRow(carried);
    for (let i = 0; i < this.cellEls.length; i++) {
      this.cellEls[i].classList.toggle(CARRIED_CLASS, active && i === carriedFrom);
      this.writers.setAttr(
        this.cellEls[i],
        TABINDEX_ATTR,
        active ? CELL_TAB_STOP : CELL_NOT_TAB_STOP,
      );
    }
  }

  /** Tick this bar's own slot states from the frame's world snapshot, then paint.
   *  Skipped entirely while hidden, so a player with no pad pays nothing for it. */
  paint(world: ActionBarWorldInput): void {
    if (!this.state.visible) {
      this.painter.paint(this.state, EMPTY_BAR_STATE);
      return;
    }
    this.painter.paint(this.state, this.view.tick(world));
  }
}
