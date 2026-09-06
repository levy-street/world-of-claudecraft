import type { corpseLootAvailability } from '../../../game/corpse_loot_availability';
import { HARVEST_BODY_RANGE, pickHarvestBody } from '../../../game/harvest_body_pick';
import { ITEMS } from '../../../sim/data';
import { dist2d, type Entity, type ItemDef } from '../../../sim/types';
import type { CorpseHarvestInfo, IWorld, WorldInteractionOutcome } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { knownItemDef } from '../../known_item';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { unknownItemIconHtml } from '../../unknown_item_icon';
import {
  type CorpseHarvestQueryStatus,
  corpseHarvestStatusSignature,
  corpseHarvestStatusView,
} from './corpse_harvest_view';
import { renderCorpseHarvestPanel } from './corpse_harvest_window';

/** At most two `inspectCorpseHarvest` reads per second while a corpse popup is
 *  open (corpse-status-contract.md): the 250ms `updateProximity` driver polls
 *  faster than that, so this is the controller's own throttle floor, not the
 *  driver's cadence. */
const HARVEST_QUERY_MIN_INTERVAL_MS = 500;

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** The identity of one in-flight `inspectCorpseHarvest` read: object identity
 *  (never structural equality) is what a settle handler compares itself
 *  against, so a NEWER visit's own issue can silently replace this without
 *  the old request's eventual settle clearing state that is no longer its. */
interface PendingHarvestRequest {
  readonly mobId: number;
  readonly generation: number;
  readonly world: IWorld;
}

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
  /** Opens the shared harvest-preference picker scoped to this body's
   *  supported materials (Intentional Gathering PR3, corpse-status-contract.md).
   *  Parent wires this to the existing shared `HarvestPreferenceController`
   *  after this popup's own visit is captured; this controller never writes
   *  the preference itself and sends nothing when Change is pressed. */
  openHarvestPreference(componentTags: readonly string[]): void;
  /** Injected wall clock for the harvest-status poll throttle, so a focused
   *  test can drive it deterministically; production wires real `Date.now`. */
  now(): number;
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
  | { kind: 'change' }
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
  /** The live `inspectCorpseHarvest` answer for the open corpse (or the
   *  pre-answer `checking` state); read by `renderCorpseBody` on every
   *  (re)paint of the harvest section. Meaningless while no corpse is open. */
  private harvestStatus: CorpseHarvestQueryStatus = { kind: 'checking' };
  /** The signature of the harvest status last PAINTED, so a poll that settles
   *  to an unchanged answer touches no DOM (the same idiom as `corpseSig`). */
  private harvestStatusSig: string | null = null;
  /** A Harvest command already sent for the open corpse, awaiting its
   *  started/refused outcome: disables Harvest and overrides the status line
   *  independently of `harvestStatus`, so a second press cannot queue a
   *  duplicate cast. */
  private harvestCommandPending = false;
  /** Wall-clock time of the last issued harvest-status query for the open
   *  visit; the poll floor below throttles against it. Reset to a value that
   *  never blocks the NEXT open's first query. */
  private lastHarvestQueryAtMs = Number.NEGATIVE_INFINITY;
  /** The single in-flight `inspectCorpseHarvest` read, or null when none is
   *  outstanding: ONE pending read per visit, never one per poll tick.
   *  Cleared only by the settle that still owns it (identity-compared). */
  private pendingHarvestRequest: PendingHarvestRequest | null = null;
  /** The `IWorld` this visit was opened against (set on a FRESH open only).
   *  Every re-entry (query issue, refresh, Harvest, Change) re-checks the
   *  CURRENT `deps.world()` against this before acting: a world swap
   *  (reconnect, character change) retires the visit outright rather than
   *  reading a coincidentally matching entity id out of a world this visit
   *  was never opened against. */
  private openedWorld: IWorld | null = null;

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
      // A genuine "open" event on the same body/visit: ask again, but this
      // is a REFRESH, not a fresh visit, so it still honors the poll floor
      // (never forces past it) and never flashes back to "checking" while a
      // prior answer is displayed. `refreshCorpse` may itself have retired
      // this visit (a world swap): only issue while it is still open.
      if (this.mobId === mobId) this.issueHarvestQuery(mobId, this.generation);
      return;
    }

    this.deps.closeTransient();
    const fresh = !this.isOpen;
    this.generation++;
    this.mobId = mobId;
    this.chestId = null;
    this.openedWorld = world;
    this.harvestStatus = { kind: 'checking' };
    this.harvestStatusSig = null;
    this.harvestCommandPending = false;
    this.pendingHarvestRequest = null;
    // A brand-new visit's first query may ask immediately: -Infinity always
    // clears the poll-floor check below, without a special-cased bypass.
    this.lastHarvestQueryAtMs = Number.NEGATIVE_INFINITY;
    this.renderCorpseBody(mob, availability);
    this.deps.element.style.display = 'block';
    if (this.deps.document.body.classList.contains('mobile-touch')) {
      this.deps.centerPopup(this.deps.element);
    } else {
      this.deps.placePopup(this.deps.element, screenX - 115, screenY - 30, 260, 280, 10, 10);
      this.deps.element.style.transform = 'none';
    }
    if (fresh) this.enterVisit();
    this.focusClose();
    if (availability.harvestable) this.issueHarvestQuery(mobId, this.generation);
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
    this.harvestStatus = { kind: 'checking' };
    this.harvestStatusSig = null;
    this.harvestCommandPending = false;
    this.pendingHarvestRequest = null;
    this.lastHarvestQueryAtMs = Number.NEGATIVE_INFINITY;
    this.openedWorld = null;
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
    if (this.mobId !== null) {
      const availability = this.refreshCorpse(false);
      // No queries while closed: `refreshCorpse` may have just closed the
      // popup (corpse gone/out of range/player dead/world swap), in which
      // case `this.mobId` is already null again and this must not fire.
      if (availability?.harvestable && this.mobId !== null) {
        this.issueHarvestQuery(this.mobId, this.generation);
      }
    }
    if (this.chestId !== null) {
      const chest = this.deps.world().entities.get(this.chestId);
      if (!chest || this.distanceFromPlayer(chest) > CORPSE_POPUP_RANGE) this.close();
    }
  }

  /** Ask for the open corpse's live harvest status: ONE pending read per
   *  visit (blocked while `pendingHarvestRequest` already names this same
   *  mobId/generation/world), and even then only past
   *  `HARVEST_QUERY_MIN_INTERVAL_MS` since the last one was ISSUED. The token
   *  is installed BEFORE the call so a reentrant/synchronous settle finds it
   *  already in place; every settle path clears ONLY that same token, never a
   *  newer visit's marker. An actually-async read marks Harvest busy IN PLACE
   *  while outstanding, since the last known status may no longer hold; a
   *  synchronous read settles before that would ever be observable. */
  private issueHarvestQuery(mobId: number, generation: number): void {
    const world = this.deps.world();
    const pending = this.pendingHarvestRequest;
    if (
      pending &&
      pending.mobId === mobId &&
      pending.generation === generation &&
      pending.world === world
    ) {
      return;
    }
    const now = this.deps.now();
    if (now - this.lastHarvestQueryAtMs < HARVEST_QUERY_MIN_INTERVAL_MS) return;
    this.lastHarvestQueryAtMs = now;
    const token: PendingHarvestRequest = { mobId, generation, world };
    this.pendingHarvestRequest = token;
    let result: CorpseHarvestInfo | null | Promise<CorpseHarvestInfo | null>;
    try {
      result = world.corpseHarvestInfo(mobId);
    } catch {
      this.settleHarvestQuery(token, mobId, generation, world, null);
      return;
    }
    if (isPromiseLike(result)) {
      // Only a REFRESH over a prior admitted answer goes to the aria-disabled
      // busy overlay (`applyHarvestButtonState`'s own contract): every other
      // state this read could be superseding (checking-from-cold, no answer,
      // an active denial) is already natively disabled from that state's own
      // paint, and stays that way untouched here.
      if (this.isCurrentlyAdmitted()) this.applyHarvestButtonState(false, true);
      result.then(
        (info) => this.settleHarvestQuery(token, mobId, generation, world, info),
        () => this.settleHarvestQuery(token, mobId, generation, world, null),
      );
      return;
    }
    this.settleHarvestQuery(token, mobId, generation, world, result);
  }

  /** Is the LAST known harvest status (before whatever read is being issued
   *  now) a real admitted answer: settled, a real info, no active denial? The
   *  busy-refresh overlay only ever applies over this state; every other
   *  status is already natively disabled and stays that way while a new read
   *  is in flight. */
  private isCurrentlyAdmitted(): boolean {
    const status = this.harvestStatus;
    return (
      status.kind === 'settled' &&
      status.info !== null &&
      status.info.denial === null &&
      !this.harvestCommandPending
    );
  }

  /** Is a status read currently in flight for exactly this (mobId,
   *  generation) visit? Pure state check, independent of any DOM node's
   *  `disabled` property, so a caller (Harvest's own dispatch) refuses even
   *  from a detached/stale button reference. */
  private isHarvestQueryPendingFor(mobId: number, generation: number): boolean {
    const pending = this.pendingHarvestRequest;
    return pending !== null && pending.mobId === mobId && pending.generation === generation;
  }

  /** Clear the pending marker ONLY if this settle still owns it (identity
   *  compare against the issue-time token), then apply the answer. A newer
   *  visit's own `issueHarvestQuery` may already have overwritten
   *  `pendingHarvestRequest`; a late settle here must never clear state that
   *  belongs to that newer visit. */
  private settleHarvestQuery(
    token: PendingHarvestRequest,
    mobId: number,
    generation: number,
    world: IWorld,
    info: CorpseHarvestInfo | null,
  ): void {
    if (this.pendingHarvestRequest === token) this.pendingHarvestRequest = null;
    this.applyHarvestInfo(mobId, generation, world, info);
  }

  /** Apply a settled (or newly failed/null) answer, only if it still answers
   *  for the SAME open visit (a later switch, reopen, close, or world swap
   *  drops it silently). A non-null answer naming a DIFFERENT corpse than
   *  queried is treated as no usable answer at all.
   *
   *  Never a wholesale rebuild here for its own sake: `refreshCorpse` already
   *  rebuilds only on a real signature change, so an unchanged settle (the
   *  common "nothing happened" case) touches no DOM beyond restoring the
   *  Harvest button this method itself may have disabled at issue time. */
  private applyHarvestInfo(
    mobId: number,
    generation: number,
    world: IWorld,
    info: CorpseHarvestInfo | null,
  ): void {
    if (this.mobId !== mobId || this.generation !== generation || this.deps.world() !== world) {
      return;
    }
    const safeInfo = info !== null && info.corpseId === mobId ? info : null;
    this.harvestStatus = { kind: 'settled', info: safeInfo };
    const availability = this.refreshCorpse(false);
    if (availability?.harvestable && availability.componentTags) {
      const view = corpseHarvestStatusView(this.harvestStatus, availability.componentTags);
      // The settle is authoritative: whatever busy overlay a prior in-flight
      // read may have left is always cleared here, never carried past its
      // own settle.
      this.applyHarvestButtonState(view.harvestDisabled || this.harvestCommandPending, false);
    }
  }

  /** Update only changed attributes. A pending background read uses aria-disabled
   *  to retain focus; checking, denial and command states use native disabled.
   *  The controller and painter both reject activation while a read is pending. */
  private applyHarvestButtonState(hardDisabled: boolean, busy: boolean): void {
    const btn = this.deps.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    if (!btn) return;
    if (btn.disabled !== hardDisabled) btn.disabled = hardDisabled;
    const wantsAriaBusy = busy && !hardDisabled;
    if (wantsAriaBusy) {
      if (btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-disabled', 'true');
    } else if (btn.hasAttribute('aria-disabled')) {
      btn.removeAttribute('aria-disabled');
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
   *  nothing any more; repaints the body only when the advertised loot OR
   *  harvest-status signature changed (or `force`, the relocalize/pending-flip
   *  arms), carrying keyboard focus across; otherwise touches no DOM. Returns
   *  the live availability while the popup stays open, null once closed.
   *  Every button dispatch goes through this first: the popup is a view over a
   *  snapshot and the next one can retire an action it still shows (another
   *  player claimed the harvest, the loot was taken or expired, the corpse
   *  decayed). The server refuses such a stale command anyway; this keeps the
   *  client from sending it and from showing a button that lies. */
  private refreshCorpse(force: boolean): CorpseAvailability | null {
    if (this.mobId === null) return null;
    if (this.openedWorld !== null && this.deps.world() !== this.openedWorld) {
      // The world identity changed since this visit opened (reconnect,
      // character swap): retire it outright. A coincidentally reused entity
      // id in the NEW world is never treated as "the same corpse" this visit
      // was opened against; no action runs against the new world on its
      // behalf.
      this.close();
      return null;
    }
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
    const harvestSig = corpseHarvestStatusSignature(
      this.harvestStatus,
      availability.componentTags ?? [],
    );
    const unchanged = sig === this.corpseSig && harvestSig === this.harvestStatusSig;
    if (!force && unchanged) return availability;
    const focus = this.captureCorpseFocus();
    this.renderCorpseBody(mob, availability);
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

  /** Paint the corpse popup body from one availability snapshot, plus the
   *  controller's own live `harvestStatus`/`harvestCommandPending` state for
   *  the harvest section. Placement and visibility stay with the caller. */
  private renderCorpseBody(mob: Entity, availability: CorpseAvailability): void {
    const mobId = mob.id;
    const generation = this.generation;
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
      const view = corpseHarvestStatusView(this.harvestStatus, componentTags);
      // A fresh paint (a loot/localization change forcing a rebuild WHILE a
      // background status read for this same visit is still outstanding)
      // must show that busy overlay from the first frame it exists: it is
      // never something only the in-place toggle in `issueHarvestQuery`
      // establishes. See `applyHarvestButtonState` for the hard/busy split.
      const busyRefresh =
        this.isHarvestQueryPendingFor(mobId, generation) &&
        !view.harvestDisabled &&
        !this.harvestCommandPending;
      renderCorpseHarvestPanel(this.deps.element, view, this.harvestCommandPending, {
        // Uses the view's RESOLVED tags (the authoritative info.componentTags
        // once answered, the local fallback only before that), never the raw
        // local `componentTags`: Change must offer exactly what the server
        // confirmed this body supports once that answer exists.
        onChange: () => this.changePreference(mobId, generation, view.resolvedComponentTags),
        onHarvest: () => this.harvest(mobId, generation),
        busyRefresh,
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
    this.harvestStatusSig = corpseHarvestStatusSignature(
      this.harvestStatus,
      availability.componentTags ?? [],
    );
  }

  /** Change for the corpse this control was built for: revalidated against the
   *  live ordinary availability (same visit/body/world, still harvestable)
   *  before calling the dep, exactly like Take Loot and Harvest. A detached
   *  Change from a closed or superseded visit dispatches nothing: opening the
   *  shared picker is itself a real action (it captures focus and shows a
   *  window), so it never fires on an implicit/stale trigger. */
  private changePreference(
    mobId: number,
    generation: number,
    componentTags: readonly string[],
  ): void {
    const live = this.liveAvailabilityFor(mobId, generation);
    if (!live?.harvestable) return;
    this.deps.openHarvestPreference(componentTags);
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

  /** Harvest for the corpse this section was built for: revalidated against
   *  the live ordinary loot claim AND the live admission (`harvestStatus`),
   *  never takes the loot. Refuses outright while a status query is pending
   *  for THIS visit: `harvestStatus` still holds the last known answer at
   *  that point, so relying on it alone would send on a status the server
   *  may already have superseded (the button's own `disabled` reflects this
   *  too, but this check holds even from a detached/stale button reference).
   *  A second press cannot queue a duplicate cast (`harvestCommandPending`).
   *  A `true` (cast started) outcome closes the popup ONLY if this is still
   *  the exact same live visit/world/body; `false` or a thrown/rejected
   *  outcome keeps the panel open, clears the pending flag, and asks for a
   *  fresh status so the panel does not sit on a stale accepting answer. */
  private harvest(mobId: number, generation: number): void {
    if (this.harvestCommandPending) return;
    if (this.isHarvestQueryPendingFor(mobId, generation)) return;
    const live = this.liveAvailabilityFor(mobId, generation);
    if (!live?.harvestable) return;
    const status = this.harvestStatus;
    if (status.kind !== 'settled' || status.info === null || status.info.denial !== null) return;

    const world = this.deps.world();
    this.harvestCommandPending = true;
    this.refreshCorpse(true);
    // The forced repaint above can itself close the popup (the corpse just
    // decayed, the player just died, ...); a closed visit sends nothing.
    if (this.mobId !== mobId || this.generation !== generation) return;

    const settle = (started: boolean): void => {
      if (this.mobId !== mobId || this.generation !== generation || this.deps.world() !== world) {
        return;
      }
      this.harvestCommandPending = false;
      if (started) {
        this.close();
        return;
      }
      // The command was refused despite our last known status admitting it:
      // that status is now known stale, so show the honest "checking" state
      // (disabling Harvest) rather than keep displaying the answer we just
      // learned was wrong, while a fresh read is asked for (subject to the
      // same poll floor as any other read, never forced past it).
      this.harvestStatus = { kind: 'checking' };
      this.refreshCorpse(true);
      if (this.mobId !== mobId || this.generation !== generation) return;
      this.issueHarvestQuery(mobId, generation);
    };

    let outcome: WorldInteractionOutcome;
    try {
      outcome = world.harvestCorpse(mobId);
    } catch {
      settle(false);
      return;
    }
    if (isPromiseLike(outcome)) {
      outcome.then(
        (started) => settle(started),
        () => settle(false),
      );
      return;
    }
    settle(outcome);
  }

  private captureCorpseFocus(): CorpseFocus | null {
    const active = focusedWithin(this.deps.element);
    if (!active) return null;
    if (active.hasAttribute('data-close')) return { kind: 'close' };
    if (active.classList.contains('corpse-harvest-btn')) return { kind: 'harvest' };
    if (active.classList.contains('corpse-harvest-change-btn')) return { kind: 'change' };
    if (active.classList.contains('btn')) return { kind: 'takeLoot' };
    return null;
  }

  /** The degrade ladder for a rebuilt body: the SAME control if it survived,
   *  otherwise Close (always painted). Never the other action: a player whose
   *  Harvest vanished under their finger must not find Take Loot under it
   *  instead (or the reverse), because the Enter they already committed to
   *  would then fire an action they never chose. Change degrades the same
   *  way, never to either action. */
  private restoreCorpseFocus(focus: CorpseFocus): void {
    const root = this.deps.element;
    const close = root.querySelector<HTMLButtonElement>('[data-close]');
    switch (focus.kind) {
      case 'takeLoot': {
        const takeLootSelector = '.btn:not(.corpse-harvest-btn):not(.corpse-harvest-change-btn)';
        restoreFirstEnabled([root.querySelector<HTMLButtonElement>(takeLootSelector), close]);
        return;
      }
      case 'harvest':
        restoreFirstEnabled([root.querySelector<HTMLButtonElement>('.corpse-harvest-btn'), close]);
        return;
      case 'change':
        restoreFirstEnabled([
          root.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn'),
          close,
        ]);
        return;
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
