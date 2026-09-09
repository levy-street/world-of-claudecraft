// The bed window painter (#plant-sheet-window): the window a press on a garden
// bed opens. Two modes, decided at a fresh open and FROZEN for it: a free bed
// paints the seed-and-knobs PLANT sheet (Phase 9b); a bed holding my plot
// paints HARVEST mode (intentional gathering PR1), frozen on that exact
// planting (bed, crop, plantedAtMs). Pure models in farming_plant_sheet_view.ts;
// this module paints them and sends the one verb per mode. Cold: paints on
// open, on a seed re-pick, on a deny for this bed, on a farmReady while in
// harvest mode, and from the Hud-polled refreshIfChanged when the harvest
// plot's status moved (paintedStatus is that one memo); no clock, no layout
// read, no driver of its own.
//
// THE SIM'S EVENTS ARE THE FEEDBACK: each control sends exactly once per
// activation (pendingSend, mirrored onto aria-busy) and the sheet stays open.
// The answer must name THIS bed AND fit THIS mode: farmPlanted for this bed
// closes a plant sheet, farmHarvested / farmWithered for this bed close a
// harvest sheet, farmDenied for this bed re-arms and repaints either. Anything
// else is somebody else's answer, with one kept exception: a plant sheet's arm
// also clears on ANY farmPlanted (a Phase 9b rule, pinned by tests). The sim's
// dead/busy gates answer through ctx.error, so the Hud forwards every error
// toast via notifyErrorToast, which re-arms without repainting. Nothing here
// predicts an outcome; the sim revalidates everything.

import { FARM_COMPOST_ITEM_ID, FARM_GROWTH_TONIC_ITEM_ID } from '../../../sim/content/farm_crops';
import { ITEMS } from '../../../sim/data';
import type { FarmPlantKnobs, FarmPlotStatus } from '../../../sim/professions/farm_projection';
import { distToBed } from '../../../sim/professions/farming';
import { INTERACT_RANGE } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { rovingTarget } from '../../roving_index';
import { svgIcon } from '../../ui_icons';
import type { FarmEvent } from './farm_event_feedback';
import {
  type BedSheetMode,
  bedSheetMode,
  buildHarvestSheetView,
  buildPlantSheetView,
  type HarvestSheetView,
  type HarvestSubject,
  harvestSubjectOf,
  type PlantSheetKnob,
  type PlantSheetKnobId,
  type PlantSheetLockedRow,
  type PlantSheetSeedRow,
  type PlantSheetViewModel,
} from './farming_plant_sheet_view';

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
  /** Fired after the root's display flips either way (the leaderboard /
   *  daily-rewards family shape): Hud wires it to syncAnyWindowOpenState so
   *  the mobile chrome's body classes track this window like every sibling
   *  (the P9b QA body-class gap this dep closes). */
  onVisibilityChange?(): void;
}

export class PlantSheetWindow {
  private openerFocus: HTMLElement | null = null;
  private bedId: string | null = null;
  /** Frozen at the fresh open: the verb never switches under the player. A
   *  subject that stops fitting (my plot landed under a plant sheet; my plot
   *  left, or was replaced, under a harvest sheet) closes on the next paint. */
  private mode: BedSheetMode = 'plant';
  /** Harvest mode's frozen planting; null in plant mode. */
  private subject: HarvestSubject | null = null;
  /** The status the harvest body was last painted with; the refreshIfChanged
   *  poll compares the live plot against it. Cleared on close and fresh open,
   *  re-latched by every harvest paint (relocalize included). */
  private paintedStatus: FarmPlotStatus | null = null;
  /** Bumped on every fresh open and close. Each painted send control captures
   *  the value it was built under, so a detached control from an earlier open
   *  (another bed, or the same bed re-opened on a new planting) sends nothing. */
  private generation = 0;
  private selectedCropId: string | null = null;
  private choices: Record<PlantSheetKnobId, boolean> = {
    compost: false,
    watch: false,
    tonic: false,
  };
  /** Armed by a Plant activation, cleared by the deny that answers it (or a
   *  close): the send-once-per-activation guard, so a double click before the
   *  sim answers cannot double-plant. Write it ONLY through setPendingSend,
   *  which mirrors the flag onto the root's aria-busy (the a11y batch's
   *  in-flight affordance: the send has no synchronous outcome, the sim's
   *  events answer, so AT hears the wait the sighted eye infers). */
  private pendingSend = false;

  constructor(private readonly deps: PlantSheetWindowDeps) {}

  private setPendingSend(value: boolean): void {
    this.pendingSend = value;
    this.deps.root().setAttribute('aria-busy', value ? 'true' : 'false');
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  /** Open the bed window for `bedId`: plant mode for a free bed, harvest mode
   *  for a bed holding my plot. Opening never sends anything; the generic
   *  interact press reaches this and no further. */
  open(bedId: string): void {
    const root = this.deps.root();
    const wasOpen = this.isOpen;
    if (wasOpen && this.bedId === bedId) {
      // A same-bed re-press keeps picks, mode, subject and any in-flight send;
      // it only repaints (which closes if the subject no longer fits).
      this.paint();
      return;
    }
    if (!wasOpen) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      markDialogRoot(root, { labelledBy: 'plant-sheet-title' });
      // Flex, not block: the sheet's stylesheet is authored against the
      // column-flex window family (flex-direction: column, .ps-body flex),
      // matching that family's open style (professions, deeds, bank, ...).
      root.style.display = 'flex';
      this.deps.onVisibilityChange?.();
    }
    // A fresh bed is a fresh decision: mode, subject, generation, selection and
    // knob picks reset, so nothing paid or armed for one open rides to another.
    const plots = this.deps.world().myFarmPlots;
    this.bedId = bedId;
    this.mode = bedSheetMode(bedId, plots);
    const plot = plots.find((row) => row.bedId === bedId);
    this.subject = this.mode === 'harvest' && plot ? harvestSubjectOf(plot) : null;
    this.paintedStatus = null;
    this.generation++;
    this.selectedCropId = null;
    this.choices = { compost: false, watch: false, tonic: false };
    this.setPendingSend(false);
    this.paint();
    if (!wasOpen) root.querySelector<HTMLElement>('[data-close]')?.focus();
  }

  /** The Hud's runtime-language-switch arm: repaint an open sheet so its
   *  labels follow the new locale (the cold-window relocalize contract). */
  relocalize(): void {
    if (this.isOpen) this.paint();
  }

  /** The cold poll for an OPEN HARVEST sheet (the Hud's slow band; plant mode
   *  is untouched). Online, events and snapshots arrive in separate frames, so
   *  a farmReady can repaint before the fplot delta that flips the plot and
   *  leave the control stale; this catches the flip once the snapshot lands.
   *  Compares the live plot against the last painted status: identical means
   *  no DOM write; dead, out of reach, plot gone or replaced closes; a status
   *  move on the same planting repaints once, keeping focus and the send arm. */
  refreshIfChanged(): void {
    if (!this.isOpen || this.mode !== 'harvest' || this.bedId === null || !this.subject) return;
    const world = this.deps.world();
    if (world.player.dead || !this.bedInReach(this.bedId)) {
      this.close();
      return;
    }
    const view = buildHarvestSheetView(this.bedId, world.myFarmPlots, this.subject);
    if (view === null) {
      this.close();
      return;
    }
    if (view.status !== this.paintedStatus) this.paint();
  }

  /** The Hud's error-toast forward. The sim's dead and busy plantCrop gates
   *  answer through ctx.error, never farmDenied (one busy state, one
   *  sentence), so without this arm a Plant clicked while eating or casting
   *  left pendingSend armed forever and the control dead until a close.
   *  Any error toast spends the in-flight belief; the sim's own gates keep a
   *  re-click safe (bed_taken and friends), so re-arming early costs at most
   *  one more deny toast. No repaint: an error changes no bag state. */
  notifyErrorToast(): void {
    if (this.isOpen) this.setPendingSend(false);
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    root.style.display = 'none';
    this.deps.onVisibilityChange?.();
    this.bedId = null;
    this.subject = null;
    this.paintedStatus = null;
    this.generation++;
    this.setPendingSend(false);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** The Hud's farm-event forward, scoped by MODE and SUBJECT (header). Deny
   *  correlation: every plantCrop and harvestCrop deny carries the bedId the
   *  command named (tests/farm_deny_bed_correlation.test.ts), so a bedId-free
   *  farmDenied (husk trade, feast) is provably not this send's answer and
   *  never clears the arm. farmReady carries counts only, no bed, so a harvest
   *  sheet answers it by re-reading its own plot: the same planting flipping
   *  to ready enables the control in place, with no focus move. */
  notifyFarmEvent(ev: FarmEvent): void {
    if (!this.isOpen || this.bedId === null) return;
    if (this.mode === 'plant') {
      if (ev.type === 'farmPlanted') {
        this.setPendingSend(false);
        if (ev.bedId === this.bedId) this.close();
      } else if (ev.type === 'farmDenied' && ev.bedId === this.bedId) {
        this.setPendingSend(false);
        this.paint();
      }
      return;
    }
    if (ev.type === 'farmHarvested' || ev.type === 'farmWithered') {
      if (ev.bedId !== this.bedId) return;
      this.setPendingSend(false);
      this.close();
    } else if (ev.type === 'farmDenied' && ev.bedId === this.bedId) {
      this.setPendingSend(false);
      this.paint();
    } else if (ev.type === 'farmReady') {
      this.paint();
    }
  }

  private paint(): void {
    if (!this.isOpen || this.bedId === null) return;
    if (this.mode === 'harvest') {
      this.paintHarvest(this.bedId);
      return;
    }
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
    this.paintFrame(t('hudChrome.farming.plantSheet.title'), this.bodyHtml(view));
  }

  /** Harvest mode: the frozen planting's produce, its authoritative status, and
   *  the explicit Harvest control (enabled only for ready or withered). The
   *  planting leaving the snapshot, or a replacement planting in the bed,
   *  closes the sheet rather than re-targeting it. */
  private paintHarvest(bedId: string): void {
    const view = this.subject
      ? buildHarvestSheetView(bedId, this.deps.world().myFarmPlots, this.subject)
      : null;
    if (view === null) {
      this.close();
      return;
    }
    this.paintedStatus = view.status;
    this.paintFrame(t('hudChrome.corpseHarvest.title'), this.harvestBodyHtml(view));
  }

  /** The window frame (title bar plus body), shared by both modes, with the
   *  focus carry across the rebuild. */
  private paintFrame(title: string, body: string): void {
    const root = this.deps.root();
    // A whole repaint destroys the subtree, so the focused control is carried
    // across the innerHTML write (the focus_restore contract).
    const focusKey = captureFocusKey(root);
    root.innerHTML =
      `<div class="panel-title"><span id="plant-sheet-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close data-pad-initial-focus data-focus-key="plantSheetClose" aria-label="${esc(t('hudChrome.farming.plantSheet.close'))}" title="${esc(t('hudChrome.farming.plantSheet.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="ps-body">${body}</div>`;
    this.wire(root);
    if (focusKey !== null) {
      // findFocusKey, never a selector the key is spliced into. This sheet's
      // own keys carry a CONTENT id (`seed:<cropId>`, `knob:<knobId>`) and
      // the captured key can be any member of the flat namespace, so a value
      // holding a quote or a CSS metacharacter makes querySelector THROW,
      // and it throws out of paint() into whatever drove the repaint: an
      // arrow-key seed pick loses focus to <body> mid-radiogroup, and an
      // open() never reaches the `[data-close]` focus below it, leaving the
      // dialog up with focus outside its own Tab trap. The helper discovers
      // the namespace with a literal selector and matches the identity on
      // the dataset value, the vault_window / bank_window idiom.
      restoreFirstEnabled([
        findFocusKey(root, focusKey),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
  }

  /** Pick the seed row `row` (a click or a roving-key landing). `focus` is
   *  true for a key landing: the row is focused BEFORE the repaint so
   *  captureFocusKey carries it by the seed's key; a click leaves focus where
   *  the pointer blur or the keyboard put it. */
  private pickSeed(row: HTMLElement, focus: boolean): void {
    if (focus) row.focus();
    const cropId = row.dataset.seedCrop ?? null;
    if (cropId === null || cropId === this.selectedCropId) return;
    this.selectedCropId = cropId;
    this.paint();
  }

  private wire(root: HTMLElement): void {
    // The open this paint belongs to. Each send control re-checks it at click
    // time, so a detached control from an earlier open sends nothing.
    const generation = this.generation;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    const seeds = [...root.querySelectorAll<HTMLElement>('[data-seed-crop]')];
    seeds.forEach((btn, index) => {
      btn.addEventListener('click', () => this.pickSeed(btn, false));
      // The APG radiogroup keys through the shared roving core: arrows (both
      // axes, the rows are a vertical stack), Home and End move the pick and
      // the focus as one; every other key falls through to the window (the
      // Tab trap, Escape, Enter/Space activation stay native).
      btn.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const next = rovingTarget(ke.key, index, seeds.length, 'both');
        if (next === null) return;
        ke.preventDefault();
        const target = seeds[next];
        if (target) this.pickSeed(target, true);
      });
    });
    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-knob]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.knob as PlantSheetKnobId;
        this.choices[id] = !this.choices[id];
        // An in-place flip: the toggle changes nothing else on the sheet.
        btn.setAttribute('aria-pressed', this.choices[id] ? 'true' : 'false');
      });
    }
    root.querySelector('[data-plant]')?.addEventListener('click', () => {
      if (generation !== this.generation || this.bedId === null) return;
      if (this.pendingSend || this.selectedCropId === null) return;
      const knobs: FarmPlantKnobs = {};
      if (this.choices.compost) knobs.compost = true;
      if (this.choices.watch) knobs.watch = true;
      if (this.choices.tonic) knobs.tonic = true;
      this.setPendingSend(true);
      // The live world at click time, never captured at render (the
      // husk-trade precedent), and the sheet stays open: the sim's own
      // farmPlanted / farmDenied events are the feedback.
      this.deps.world().plantCrop(this.bedId, this.selectedCropId, knobs);
    });
    root.querySelector('[data-harvest]')?.addEventListener('click', () => this.harvest(generation));
  }

  /** The ONE harvestCrop send in the client. Revalidates the LIVE world at
   *  click time: this open is still current, the player is alive, the bed is
   *  within the sim's own reach, and the bed still holds the FROZEN planting in
   *  a harvestable status. A failed check sends nothing and repaints (closing
   *  when the planting is gone or replaced, showing the disabled control when
   *  it went back to growing). */
  private harvest(generation: number): void {
    if (generation !== this.generation || this.mode !== 'harvest' || this.pendingSend) return;
    const bedId = this.bedId;
    const subject = this.subject;
    if (bedId === null || subject === null) return;
    const world = this.deps.world();
    if (world.player.dead || !this.bedInReach(bedId)) {
      this.close();
      return;
    }
    const view = buildHarvestSheetView(bedId, world.myFarmPlots, subject);
    if (view === null || !view.canHarvest) {
      this.paint();
      return;
    }
    this.setPendingSend(true);
    world.harvestCrop(bedId);
  }

  /** The sim's own reach rule (distToBed against INTERACT_RANGE, inclusive)
   *  over the static bed geometry; an unknown bed id is out of reach. */
  private bedInReach(bedId: string): boolean {
    const world = this.deps.world();
    for (const patch of world.farmPatches) {
      for (const bed of patch.beds) {
        if (bed.id === bedId) return distToBed(world.player.pos, bed) <= INTERACT_RANGE;
      }
    }
    return false;
  }

  /** The harvest body: the produce name with the authority's status beside it
   *  (the locked-row shape, so no new CSS), then the Harvest control, described
   *  by the status so AT hears why a disabled control is disabled. */
  private harvestBodyHtml(view: HarvestSheetView): string {
    const statusId = 'plant-sheet-harvest-status';
    return (
      `<ul class="ps-list" role="list"><li class="ps-locked">` +
      `<span class="ps-name">${esc(itemName(view.produceItemId))}</span>` +
      `<span class="ps-reason" id="${statusId}">${esc(t(view.statusKey))}</span>` +
      `</li></ul>` +
      `<button type="button" class="ps-plant" data-harvest data-focus-key="plantSheetHarvest" aria-describedby="${statusId}"${view.canHarvest ? '' : ' disabled'}>${esc(t('hudChrome.corpseHarvest.harvestButton'))}</button>`
    );
  }

  private bodyHtml(view: PlantSheetViewModel): string {
    if (view.seedRows.length === 0 && view.lockedRows.length === 0) {
      // The family empty state (.prof-empty, phase 14): body line alone, the
      // section-empty variant.
      return `<div class="prof-empty"><p>${esc(t('hudChrome.farming.plantSheet.empty'))}</p></div>`;
    }
    // The seed rows are SINGLE-SELECT (picking one un-picks the rest), so
    // they expose radiogroup semantics, not a row of independent aria-pressed
    // toggles (the P8/P9b a11y batch). The group borrows the dialog title as
    // its name, the li wrappers are presentational so the radios are the
    // group's owned children, and the LOCKED rows live in their own plain
    // list: they are not options, so they never dilute the radio count AT
    // reports. The group is an APG roving-tabindex radiogroup (the Phase 18
    // sweep): the picked seed is the ONE tab stop (the first row when nothing
    // is picked, which the view never produces) and the rest are reached by
    // arrow; Enter/Space on a real button still picks.
    const tabStop = Math.max(
      0,
      view.seedRows.findIndex((row) => row.selected),
    );
    const seeds =
      view.seedRows.length > 0
        ? `<ul class="ps-list" role="radiogroup" aria-labelledby="plant-sheet-title">${view.seedRows.map((row, i) => this.seedRowHtml(row, i === tabStop)).join('')}</ul>`
        : '';
    const locked =
      view.lockedRows.length > 0
        ? `<ul class="ps-list" role="list">${view.lockedRows.map((row) => this.lockedRowHtml(row)).join('')}</ul>`
        : '';
    const knobs =
      view.knobs.length > 0
        ? `<div class="ps-knobs">${view.knobs.map((knob) => this.knobHtml(knob)).join('')}</div>`
        : '';
    const plant =
      view.seedRows.length > 0
        ? `<button type="button" class="ps-plant" data-plant data-focus-key="plantSheetPlant">${esc(t('hudChrome.farming.plantSheet.plant'))}</button>`
        : `<div class="prof-empty"><p>${esc(t('hudChrome.farming.plantSheet.empty'))}</p></div>`;
    return `${seeds}${locked}${knobs}${plant}`;
  }

  private seedRowHtml(row: PlantSheetSeedRow, tabStop: boolean): string {
    const name = itemName(row.seedItemId);
    const countId = `plant-sheet-seed-count-${row.cropId}`;
    return (
      `<li role="none"><button type="button" role="radio" class="ps-seed" data-seed-crop="${esc(row.cropId)}" data-focus-key="seed:${esc(row.cropId)}" aria-checked="${row.selected ? 'true' : 'false'}" tabindex="${tabStop ? '0' : '-1'}" aria-describedby="${esc(countId)}" aria-label="${esc(t('hudChrome.farming.plantSheet.sowAria', { name }))}">` +
      `<span class="ps-name">${esc(name)}</span>` +
      `<span class="ps-count" id="${esc(countId)}">${esc(wholeNumber(row.seedCount))}</span>` +
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
