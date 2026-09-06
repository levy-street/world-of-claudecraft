import type { corpseLootAvailability } from '../../../game/corpse_loot_availability';
import { HARVEST_BODY_RANGE, pickHarvestBody } from '../../../game/harvest_body_pick';
import { ITEMS } from '../../../sim/data';
import { dist2d, type Entity, type ItemDef } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { knownItemDef } from '../../known_item';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { unknownItemIconHtml } from '../../unknown_item_icon';
import { corpseHarvestView } from './corpse_harvest_view';
import { renderCorpseHarvestPicker } from './corpse_harvest_window';

export interface LootWindowItemStack {
  itemId: string;
  count: number;
}

type CorpseAvailability = ReturnType<typeof corpseLootAvailability>;

export interface LootWindowControllerDeps {
  element: HTMLElement;
  document: Document;
  world(): IWorld;
  corpseAvailability(entity: Entity): CorpseAvailability;
  closeTransient(): void;
  hideTooltip(): void;
  showError(text: string): void;
  entityName(entity: Entity): string;
  money(copper: number): string;
  coinIconUrl(): string;
  /** The PainterHostPresentation.itemIcon signature, named from the seam
   *  rather than re-typed; the quality parameter is shape uniformity only
   *  here, since no copy payload reaches this surface, and is never passed. */
  itemIcon: PainterHostPresentation['itemIcon'];
  itemTooltip(item: ItemDef): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  /** The shared HUD confirm dialog (Hud.confirmDialog: focus-trapped,
   *  aria-named), for the bind-on-pickup warning before Take Loot. */
  confirm(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void;
  centerPopup(element: HTMLElement): void;
  placePopup(
    element: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
    minLeft?: number,
    minTop?: number,
  ): void;
  /** The shared window-focus bridge (Hud.windowFocus): capture records the
   *  opener and installs the Tab trap on a FRESH open, restore releases it and
   *  returns focus on close. One capture per visit: re-opening the same body or
   *  switching bodies keeps the original opener. */
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The mobile window-open body-class family: called on BOTH display flips. */
  onVisibilityChange?(): void;
}

/** The corpse popup's range gate, in yards (the coordinator's proximity band). */
const CORPSE_POPUP_RANGE = HARVEST_BODY_RANGE;

/** The identity of the focused control inside the corpse popup, carried across
 *  a body rebuild. Role-keyed rather than `data-focus-key`: the picker's
 *  controls are minted by corpse_harvest_window, which carries no key, so the
 *  identity is read from the classes it already paints (the "different identity
 *  entirely" case focus_restore.ts describes). */
type CorpseFocus =
  | { kind: 'takeLoot' }
  | { kind: 'harvest' }
  | { kind: 'check'; tag: string }
  | { kind: 'close' };

/** Digest of exactly what the corpse popup ADVERTISES: the two action halves and
 *  the loot rows. Two snapshots with the same digest paint the same body, so the
 *  per-frame refresh compares this and rewrites nothing while it holds. Text is
 *  deliberately NOT part of it (the repaint-signature idiom); a language switch
 *  reaches the body through relocalize() instead. */
function corpseAvailabilitySignature(availability: CorpseAvailability): string {
  const items = availability.visibleItems.map((stack) => `${stack.itemId}:${stack.count}`);
  return `${availability.hasLoot ? 'L' : '-'}${availability.harvestable ? 'H' : '-'}|${availability.visibleCopper}|${items.join(',')}`;
}

/** Owns corpse and delve-chest loot popup state, rendering, actions, and range closure. */
export class LootWindowController {
  private mobId: number | null = null;
  private chestId: number | null = null;
  /** A fresh visit retires handlers and confirmations from an earlier opening. */
  private generation = 0;
  /** The signature of the corpse body currently painted; null while no corpse is open. */
  private corpseSig: string | null = null;
  /** The opener recorded by the focus bridge for this visit (captured once on
   *  the fresh open, handed back on close); null while nothing is open. */
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: LootWindowControllerDeps) {}

  get hasOpenChest(): boolean {
    return this.chestId !== null;
  }

  private get isOpen(): boolean {
    return this.mobId !== null || this.chestId !== null;
  }

  /** The Professions entry opens a choice without collecting anything.
   * The underlying window stays open so closing this dialog can return focus. */
  openHarvestBodyChoice(): void {
    const mobId = pickHarvestBody(this.deps.world());
    if (mobId === null) {
      this.deps.showError(t('errors.nothingInteract'));
      return;
    }
    this.openCorpse(mobId, 0, 0);
    this.deps.centerPopup(this.deps.element);
  }

  /** Open the popup for a corpse, or refresh it when that same corpse is
   *  already open. The open gate mirrors the proximity refresh (a living
   *  viewer, a lootable body inside the popup range, something to open), so an
   *  entry that names a body the refresh would close at once never flashes.
   *  Opening never runs an action: Take Loot and Harvest are the player's own
   *  presses inside. The SAME body re-opened is a refresh only (picks and
   *  focus survive); ANOTHER body is a fresh choice with focus on Close and
   *  the visit's original opener kept. */
  openCorpse(mobId: number, screenX: number, screenY: number): void {
    const world = this.deps.world();
    const mob = world.entities.get(mobId);
    if (
      !mob ||
      world.player.dead ||
      !mob.lootable ||
      this.distanceFromPlayer(mob) > CORPSE_POPUP_RANGE
    ) {
      return;
    }
    const availability = this.deps.corpseAvailability(mob);
    if (!availability.canOpen) return;
    if (this.mobId === mobId) {
      this.refreshCorpse(false);
      return;
    }

    this.deps.closeTransient();
    const fresh = !this.isOpen;
    this.generation++;
    this.mobId = mobId;
    this.chestId = null;
    this.renderCorpseBody(mob, availability, null);
    this.deps.element.style.display = 'block';
    if (this.deps.document.body.classList.contains('mobile-touch')) {
      this.deps.centerPopup(this.deps.element);
    } else {
      this.deps.placePopup(this.deps.element, screenX - 115, screenY - 30, 260, 280, 10, 10);
      this.deps.element.style.transform = 'none';
    }
    if (fresh) this.enterVisit();
    this.focusClose();
  }

  openChest(chestId: number, items: readonly LootWindowItemStack[]): void {
    if (items.length === 0) return;
    this.deps.closeTransient();
    const fresh = !this.isOpen;
    this.generation++;
    this.mobId = null;
    this.corpseSig = null;
    this.chestId = chestId;
    const chest = this.deps.world().entities.get(chestId);
    const title = chest ? this.deps.entityName(chest) : t('hudChrome.loot.chestTitle');
    this.deps.element.innerHTML =
      this.titleHtml(title) + items.map((stack) => this.itemRowHtml(stack)).join('');
    markDialogRoot(this.deps.element, { label: title });
    this.attachItemTooltips();
    this.appendTakeButton(t('itemUi.loot.takeAll'), () => {
      this.deps.world().collectDelveChestLoot(chestId);
      this.close();
    });
    this.bindClose();
    this.deps.element.style.display = 'block';
    this.deps.centerPopup(this.deps.element);
    if (fresh) this.enterVisit();
    this.focusClose();
  }

  close(): void {
    const wasOpen = this.isOpen;
    this.generation++;
    this.deps.element.style.display = 'none';
    this.mobId = null;
    this.chestId = null;
    this.corpseSig = null;
    this.deps.hideTooltip();
    if (!wasOpen) return;
    // Release the trap and hand focus back to the visit's opener; the bridge
    // ignores a null or detached target, so a closed opener strands nothing.
    const opener = this.openerFocus;
    this.openerFocus = null;
    this.deps.restoreFocus(opener);
    this.deps.onVisibilityChange?.();
  }

  /** The fresh-open bookkeeping, once per visit: record the opener and arm the
   *  shared Tab trap, then report the display flip. */
  private enterVisit(): void {
    this.openerFocus = this.deps.captureFocus();
    this.deps.onVisibilityChange?.();
  }

  /** Land keyboard focus on Close (always painted) so a keyboard user enters
   *  the dialog rather than staying stranded on the opener while the trap is
   *  armed; the sibling cold windows do the same. Close is the one control
   *  whose accidental activation costs nothing. */
  private focusClose(): void {
    this.deps.element.querySelector<HTMLElement>('[data-close]')?.focus();
  }

  updateProximity(): void {
    if (this.mobId !== null) this.refreshCorpse(false);
    if (this.chestId !== null) {
      const chest = this.deps.world().entities.get(this.chestId);
      if (!chest || this.distanceFromPlayer(chest) > CORPSE_POPUP_RANGE) this.close();
    }
  }

  /** The language fan-out arm (Hud.refreshLocalizedDynamicUi): the corpse body
   *  is gated on a DATA signature that a locale switch never moves, so force
   *  exactly one rebuild with fresh t() and re-latch. Self-gated: a no-op with
   *  nothing open. The chest body is built once on open with no signature, so
   *  it is not rebuilt here (nothing to re-latch). */
  relocalize(): void {
    if (this.mobId !== null) this.refreshCorpse(true);
  }

  /** Re-read the open corpse against the CURRENT snapshot. Closes the popup when
   *  the corpse is gone, out of range, the player is dead, or it advertises
   *  nothing any more; repaints the body only when the advertised set changed
   *  (or `force`, the relocalize arm), carrying the player's checkbox picks and
   *  keyboard focus across; otherwise touches no DOM. Returns the live
   *  availability while the popup stays open, null once closed.
   *  Every button dispatch goes through this first: the popup is a view over a
   *  snapshot and the next one can retire an action it still shows (another
   *  player claimed the harvest, the loot was taken or expired, the corpse
   *  decayed). The server refuses such a stale command anyway; this keeps the
   *  client from sending it and from showing a button that lies. */
  private refreshCorpse(force: boolean): CorpseAvailability | null {
    if (this.mobId === null) return null;
    const world = this.deps.world();
    const mob = world.entities.get(this.mobId);
    if (world.player.dead || !mob?.lootable || this.distanceFromPlayer(mob) > CORPSE_POPUP_RANGE) {
      this.close();
      return null;
    }
    const availability = this.deps.corpseAvailability(mob);
    if (!availability.canOpen) {
      this.close();
      return null;
    }
    const sig = corpseAvailabilitySignature(availability);
    if (!force && sig === this.corpseSig) return availability;
    const selected = this.currentHarvestSelection();
    const focus = this.captureCorpseFocus();
    this.renderCorpseBody(mob, availability, selected);
    if (focus) this.restoreCorpseFocus(focus);
    return availability;
  }

  /** The live availability of the corpse a captured handler was built for, or
   *  null when that handler must not act: the popup has since closed or moved to
   *  another corpse (a detached button, or a bind confirm accepted after the
   *  player opened a different body), or the refresh just closed it. Handlers
   *  capture the body and visit at build time and re-check them HERE, so
   *  one corpse is never taken on the strength of another's availability. */
  private liveAvailabilityFor(mobId: number, generation: number): CorpseAvailability | null {
    if (this.mobId !== mobId || this.generation !== generation) return null;
    const live = this.refreshCorpse(false);
    return this.mobId === mobId && this.generation === generation ? live : null;
  }

  /** Paint the corpse popup body from one availability snapshot. `selected` is
   *  the harvest pick to carry across a refresh; null takes the town-focus
   *  default of a fresh open. Placement and visibility stay with the caller. */
  private renderCorpseBody(
    mob: Entity,
    availability: CorpseAvailability,
    selected: ReadonlySet<string> | null,
  ): void {
    const mobId = mob.id;
    const generation = this.generation;
    const world = this.deps.world();
    const { componentTags, harvestable, visibleItems, visibleCopper, hasLoot } = availability;
    const title = this.deps.entityName(mob);
    // A real dialog root (the shared cold-window pattern): role, modal flag and
    // exactly one accessible name, the body's own name.
    markDialogRoot(this.deps.element, { label: title });
    let html = this.titleHtml(title);
    // visibleCopper, not mob.loot.copper: coin is shared (tap-owned) loot, so
    // the popup must not advertise a stranger's copper the take would deny.
    if (visibleCopper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${this.deps.coinIconUrl()}" alt="" draggable="false"><span>${this.deps.money(visibleCopper)}</span></div>`;
    }
    html += visibleItems.map((stack) => this.itemRowHtml(stack)).join('');
    this.deps.element.innerHTML = html;
    this.attachItemTooltips();

    if (hasLoot) {
      // "Take Loot", not "Take All": the old label promised the harvest too.
      // The delve-chest arm keeps Take All. Take Loot never harvests.
      this.appendTakeButton(
        t('hudChrome.loot.takeLootButton'),
        () => this.takeLoot(mobId, generation),
        () => esc(t('hudChrome.loot.takeLootTooltip')),
      );
    }
    if (harvestable && componentTags) {
      // Pre-check the caller's town focus: the same subset an omitted-components
      // harvest resolves server-side. Deselecting every box still submits an
      // explicit empty pick, which spreads. A refresh carries the player's own
      // pick instead of resetting it to the default.
      const focused =
        selected ?? new Set(componentTags.filter((tag) => (world.townFocus[tag] ?? 0) > 0));
      renderCorpseHarvestPicker(this.deps.element, corpseHarvestView(componentTags, focused), {
        onHarvest: (chosen) => this.harvest(mobId, chosen, generation),
        attachTooltip: (element, html) => this.deps.attachTooltip(element, html),
      });
    }
    // Only where a Harvest button exists for the sentence to point at. It tells
    // the player that the interact key takes the loot ONLY and that components
    // come from the explicit Harvest here; a loot-only corpse has no Harvest and
    // needs no hint (the press does the one obvious thing). Both arms are
    // pinned in tests/loot_window_controller.test.ts.
    if (harvestable) {
      const hint = this.deps.document.createElement('div');
      hint.className = 'town-focus-hint';
      hint.textContent = t('hudChrome.loot.unifiedPressHint');
      this.deps.element.appendChild(hint);
    }
    this.bindClose();
    this.corpseSig = corpseAvailabilitySignature(availability);
  }

  /** Take Loot for the corpse this button was built for: revalidated against
   *  the live snapshot at the click AND again when a bind confirm is accepted
   *  (the confirm is modal over the world, not over this popup: the snapshot,
   *  the player, and even the open corpse can all move while it waits). Never
   *  a harvest. */
  private takeLoot(mobId: number, generation: number): void {
    const live = this.liveAvailabilityFor(mobId, generation);
    if (!live?.hasLoot) return;
    const dispatch = (): void => {
      if (!this.liveAvailabilityFor(mobId, generation)?.hasLoot) return;
      this.deps.world().lootCorpse(mobId);
      this.close();
    };
    // Bind-on-pickup warning: when the visible loot holds a soulbound item,
    // taking it binds it, so the player confirms once first (the classic
    // BoP dialog). An unknown stale-client def cannot claim soulbound, so
    // it takes the plain path rather than warning on a guess.
    const bindsOnPickup = live.visibleItems.some(
      (stack) => knownItemDef(ITEMS, stack.itemId)?.soulbound === true,
    );
    if (bindsOnPickup) {
      this.deps.confirm(
        t('hudChrome.loot.bindConfirmTitle'),
        t('hudChrome.loot.bindConfirmBody'),
        t('hudChrome.loot.takeLootButton'),
        t('hud.chat.context.cancel'),
        dispatch,
      );
      return;
    }
    dispatch();
  }

  /** Harvest for the corpse this picker was built for: revalidated against the
   *  live claim, never takes the loot. */
  private harvest(mobId: number, chosen: string[], generation: number): void {
    const live = this.liveAvailabilityFor(mobId, generation);
    if (!live?.harvestable) return;
    this.deps.world().harvestCorpse(mobId, chosen);
    this.close();
  }

  /** The checked harvest tags in the painted picker, or null when no picker is painted. */
  private currentHarvestSelection(): ReadonlySet<string> | null {
    const boxes = this.deps.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    if (boxes.length === 0) return null;
    return new Set([...boxes].filter((box) => box.checked).map((box) => box.value));
  }

  private captureCorpseFocus(): CorpseFocus | null {
    const active = focusedWithin(this.deps.element);
    if (!active) return null;
    if (active.hasAttribute('data-close')) return { kind: 'close' };
    if (active.classList.contains('corpse-harvest-btn')) return { kind: 'harvest' };
    if (active.classList.contains('corpse-harvest-check')) {
      return { kind: 'check', tag: (active as HTMLInputElement).value };
    }
    if (active.classList.contains('btn')) return { kind: 'takeLoot' };
    return null;
  }

  /** The degrade ladder for a rebuilt body: the SAME control if it survived,
   *  otherwise Close (always painted). Never the other action: a player whose
   *  Harvest vanished under their finger must not find Take Loot under it
   *  instead (or the reverse), because the Enter they already committed to
   *  would then fire an action they never chose. A checkbox degrades the same
   *  way, never to either action. */
  private restoreCorpseFocus(focus: CorpseFocus): void {
    const root = this.deps.element;
    const close = root.querySelector<HTMLButtonElement>('[data-close]');
    switch (focus.kind) {
      case 'takeLoot':
        restoreFirstEnabled([
          root.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)'),
          close,
        ]);
        return;
      case 'harvest':
        restoreFirstEnabled([root.querySelector<HTMLButtonElement>('.corpse-harvest-btn'), close]);
        return;
      case 'check': {
        const box = [...root.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')].find(
          (candidate) => candidate.value === focus.tag,
        );
        restoreFirstEnabled([box, close]);
        return;
      }
      case 'close':
        restoreFirstEnabled([close]);
        return;
    }
  }

  private distanceFromPlayer(entity: Entity): number {
    return dist2d(this.deps.world().player.pos, entity.pos);
  }

  private titleHtml(title: string): string {
    return `<div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-close data-pad-initial-focus aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
  }

  private itemRowHtml(stack: LootWindowItemStack): string {
    // Stale-client guard (R34): corpse and chest loot lists are server truth,
    // so a bundle one deploy behind can be handed an id with no local def. An
    // unguarded deref here used to throw before this popup's innerHTML was
    // assigned, leaving the corpse un-lootable (and, on the chest arm, the
    // throw aborted the rest of that frame's event batch).
    const item: ItemDef | undefined = knownItemDef(ITEMS, stack.itemId);
    const count =
      stack.count > 1
        ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(stack.count, { maximumFractionDigits: 0 }) }))}`
        : '';
    return `<div class="loot-item" data-item="${esc(stack.itemId)}">${item ? this.deps.itemIcon(item) : unknownItemIconHtml(stack.itemId)}<span style="font-size:12px">${esc(item ? itemDisplayName(item) : stack.itemId)}${count}</span></div>`;
  }

  private attachItemTooltips(): void {
    this.deps.element.querySelectorAll<HTMLElement>('[data-item]').forEach((row) => {
      const itemId = row.dataset.item ?? '';
      const item: ItemDef | undefined = knownItemDef(ITEMS, itemId);
      // An unknown id gets the same minimal tooltip its bag and bank
      // siblings render (raw id plus the unknown sub-line), never the
      // def-derived body.
      this.deps.attachTooltip(row, () =>
        item
          ? this.deps.itemTooltip(item)
          : `<div class="tt-title">${esc(itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`,
      );
    });
  }

  private appendTakeButton(label: string, onClick: () => void, tooltip?: () => string): void {
    const button = this.deps.document.createElement('button');
    button.className = 'btn';
    button.textContent = label;
    // The shared attachTooltip idiom (hover, mobile long-press, and keyboard
    // focus), not a native title attribute, so touch players see it too.
    if (tooltip) this.deps.attachTooltip(button, tooltip);
    button.addEventListener('click', onClick);
    this.deps.element.appendChild(button);
  }

  private bindClose(): void {
    this.deps.element.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}
