// The plant sheet window painter (#plant-sheet-window): the window a press on
// a free garden bed opens (Phase 9b, the bed verbs). The pure model lives in
// farming_plant_sheet_view.ts; this module only paints it and sends the one
// verb. Cold on purpose: paint on open, on a seed re-pick, and on a deny;
// no clock, no signature memo, no layout read.
//
// THE SIM'S EVENTS ARE THE FEEDBACK (the husk-trade contract): the Plant
// control sends IWorldFarming.plantCrop exactly once per activation and the
// sheet STAYS OPEN. A farmPlanted for THIS bed closes it with the trap's own
// focus restore (no successor window, the close(true) semantics); a
// farmDenied leaves it open, re-arms the control, and repaints affordability
// from the live bags. Nothing here predicts an outcome.

import { FARM_COMPOST_ITEM_ID, FARM_GROWTH_TONIC_ITEM_ID } from '../sim/content/farm_crops';
import { ITEMS } from '../sim/data';
import type { FarmPlantKnobs } from '../sim/professions/farm_projection';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import type { FarmEvent } from './farm_event_feedback';
import {
  buildPlantSheetView,
  canOpenPlantSheet,
  type PlantSheetKnob,
  type PlantSheetKnobId,
  type PlantSheetLockedRow,
  type PlantSheetSeedRow,
  type PlantSheetViewModel,
} from './farming_plant_sheet_view';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

/** An item's display name; an id the client's catalog does not carry degrades
 *  to the raw id rather than an empty label (the farmPlantedTokenId contract). */
function itemName(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? itemDisplayName(item) : itemId;
}

/** The knob's visible name: compost and the tonic name themselves through the
 *  item catalog (identical to what the same items read in the bags), and the
 *  watch is a produce fee with no item, so it reuses the journal's careWatch
 *  label rather than minting a twin. */
function knobName(id: PlantSheetKnobId): string {
  if (id === 'watch') return t('hudChrome.harvestJournal.careWatch');
  return itemName(id === 'compost' ? FARM_COMPOST_ITEM_ID : FARM_GROWTH_TONIC_ITEM_ID);
}

const wholeNumber = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

export interface PlantSheetWindowDeps {
  /** The #plant-sheet-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class PlantSheetWindow {
  private openerFocus: HTMLElement | null = null;
  private bedId: string | null = null;
  private selectedCropId: string | null = null;
  private choices: Record<PlantSheetKnobId, boolean> = {
    compost: false,
    watch: false,
    tonic: false,
  };
  /** Armed by a Plant activation, cleared by the deny that answers it (or a
   *  close): the send-once-per-activation guard, so a double click before the
   *  sim answers cannot double-plant. */
  private pendingSend = false;

  constructor(private readonly deps: PlantSheetWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  open(bedId: string): void {
    if (!canOpenPlantSheet(bedId, this.deps.world().myFarmPlots)) return;
    const root = this.deps.root();
    const wasOpen = this.isOpen;
    if (!wasOpen) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      markDialogRoot(root, { labelledBy: 'plant-sheet-title' });
      root.style.display = 'block';
    }
    // A fresh bed is a fresh decision: selection and knob picks reset even on
    // a re-open, so a toggle paid for one bed never silently rides to another.
    this.bedId = bedId;
    this.selectedCropId = null;
    this.choices = { compost: false, watch: false, tonic: false };
    this.pendingSend = false;
    this.paint();
    if (!wasOpen) root.querySelector<HTMLElement>('[data-close]')?.focus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    root.style.display = 'none';
    this.bedId = null;
    this.pendingSend = false;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** The Hud's farm-event forward. A farmPlanted for this bed is the success
   *  answer: close with focus restore (no successor window). A deny for this
   *  bed re-arms the Plant control and repaints affordability; every other
   *  event is not this window's business. */
  notifyFarmEvent(ev: FarmEvent): void {
    if (!this.isOpen || this.bedId === null) return;
    if (ev.type === 'farmPlanted' && ev.bedId === this.bedId) {
      this.close();
      return;
    }
    if (ev.type === 'farmDenied' && (ev.bedId === undefined || ev.bedId === this.bedId)) {
      this.pendingSend = false;
      this.paint();
    }
  }

  private paint(): void {
    if (!this.isOpen || this.bedId === null) return;
    const world = this.deps.world();
    const view = buildPlantSheetView({
      bedId: this.bedId,
      inventory: world.inventory,
      myFarmPlots: world.myFarmPlots,
      farmingSkill:
        world.professionsState.skills.find((row) => row.professionId === 'farming')?.skill ?? 0,
      selectedCropId: this.selectedCropId,
    });
    if (view === null) {
      // The bed became the caller's own plot under an open sheet (a repaint
      // racing a just-landed plant): nothing left to offer here.
      this.close();
      return;
    }
    this.selectedCropId = view.selectedCropId;
    // A knob that stopped being affordable un-picks itself, so the choices
    // sent can never include a payment the sheet is showing as short.
    for (const knob of view.knobs) {
      if (!knob.affordable) this.choices[knob.id] = false;
    }
    const root = this.deps.root();
    // A whole repaint destroys the subtree, so the focused control is carried
    // across the innerHTML write (the focus_restore contract).
    const focusKey = captureFocusKey(root);
    root.innerHTML =
      `<div class="panel-title"><span id="plant-sheet-title">${esc(t('hudChrome.farming.plantSheet.title'))}</span>` +
      `<button type="button" class="x-btn" data-close data-focus-key="plantSheetClose" aria-label="${esc(t('hudChrome.harvestJournal.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="ps-body">${this.bodyHtml(view)}</div>`;
    this.wire(root);
    if (focusKey !== null) {
      restoreFirstEnabled([
        root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
  }

  private wire(root: HTMLElement): void {
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    for (const btn of root.querySelectorAll<HTMLElement>('[data-seed-crop]')) {
      btn.addEventListener('click', () => {
        const cropId = btn.dataset.seedCrop ?? null;
        if (cropId === null || cropId === this.selectedCropId) return;
        this.selectedCropId = cropId;
        this.paint();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-knob]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.knob as PlantSheetKnobId;
        this.choices[id] = !this.choices[id];
        // An in-place flip: the toggle changes nothing else on the sheet.
        btn.setAttribute('aria-pressed', this.choices[id] ? 'true' : 'false');
      });
    }
    root.querySelector('[data-plant]')?.addEventListener('click', () => {
      if (this.pendingSend || this.bedId === null || this.selectedCropId === null) return;
      const knobs: FarmPlantKnobs = {};
      if (this.choices.compost) knobs.compost = true;
      if (this.choices.watch) knobs.watch = true;
      if (this.choices.tonic) knobs.tonic = true;
      this.pendingSend = true;
      // The live world at click time, never captured at render (the
      // husk-trade precedent), and the sheet stays open: the sim's own
      // farmPlanted / farmDenied events are the feedback.
      this.deps.world().plantCrop(this.bedId, this.selectedCropId, knobs);
    });
  }

  private bodyHtml(view: PlantSheetViewModel): string {
    if (view.seedRows.length === 0 && view.lockedRows.length === 0) {
      return `<p class="ps-empty">${esc(t('hudChrome.farming.plantSheet.empty'))}</p>`;
    }
    const seeds = view.seedRows.map((row) => this.seedRowHtml(row)).join('');
    const locked = view.lockedRows.map((row) => this.lockedRowHtml(row)).join('');
    const knobs =
      view.knobs.length > 0
        ? `<div class="ps-knobs">${view.knobs.map((knob) => this.knobHtml(knob)).join('')}</div>`
        : '';
    const plant =
      view.seedRows.length > 0
        ? `<button type="button" class="ps-plant" data-plant data-focus-key="plantSheetPlant">${esc(t('hudChrome.farming.plantSheet.plant'))}</button>`
        : `<p class="ps-empty">${esc(t('hudChrome.farming.plantSheet.empty'))}</p>`;
    return `<ul class="ps-list" role="list">${seeds}${locked}</ul>${knobs}${plant}`;
  }

  private seedRowHtml(row: PlantSheetSeedRow): string {
    const name = itemName(row.seedItemId);
    return (
      `<li><button type="button" class="ps-seed" data-seed-crop="${esc(row.cropId)}" data-focus-key="seed:${esc(row.cropId)}" aria-pressed="${row.selected ? 'true' : 'false'}" aria-label="${esc(t('hudChrome.farming.plantSheet.sowAria', { name }))}">` +
      `<span class="ps-name">${esc(name)}</span>` +
      `<span class="ps-count">${esc(wholeNumber(row.seedCount))}</span>` +
      `</button></li>`
    );
  }

  private lockedRowHtml(row: PlantSheetLockedRow): string {
    const reason = row.reasonParams
      ? t(row.reasonKey, { tier: wholeNumber(row.reasonParams.tier) })
      : t(row.reasonKey);
    return (
      `<li class="ps-locked">` +
      `<span class="ps-name">${esc(itemName(row.seedItemId))}</span>` +
      `<span class="ps-reason">${esc(reason)}</span>` +
      `</li>`
    );
  }

  /** One care knob: an aria-pressed toggle. Affordable knobs show their cost
   *  legs as chips (the journal's care-chip idiom; a count badge only past
   *  one unit, the bag-stack idiom); an unaffordable knob is disabled and
   *  says why through the same denied-family line the real refusal would. */
  private knobHtml(knob: PlantSheetKnob): string {
    const detail = knob.affordable
      ? knob.legs
          .map(
            (leg) =>
              `<span class="ps-knob-leg">${esc(itemName(leg.itemId))}${leg.count > 1 ? `<span class="ps-leg-count">${esc(wholeNumber(leg.count))}</span>` : ''}</span>`,
          )
          .join('')
      : `<span class="ps-knob-short">${esc(knob.shortKey === null ? '' : t(knob.shortKey))}</span>`;
    return (
      `<button type="button" class="ps-knob" data-knob="${esc(knob.id)}" data-focus-key="knob:${esc(knob.id)}" aria-pressed="${this.choices[knob.id] ? 'true' : 'false'}"${knob.affordable ? '' : ' disabled'}>` +
      `<span class="ps-knob-name">${esc(knobName(knob.id))}</span>${detail}` +
      `</button>`
    );
  }
}
