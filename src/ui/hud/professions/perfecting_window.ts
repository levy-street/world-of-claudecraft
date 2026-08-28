// The Perfecting window painter (#perfecting-window): the Masterwrought
// phase 14 home of the rank track and the orange promotion. The pure model
// lives in perfecting_view.ts; this module paints it and sends the one
// command (perfectItem, with the promotion's name riding its existing field).
//
// Structurally the plant sheet's shape (farming_plant_sheet_window.ts): a
// radiogroup of natively tabbable role=radio rows (the roving-tabindex
// refinement stays a recorded OPEN follow-up), aria-busy mirroring a
// send-once flag, markDialogRoot at open, focus carried across the innerHTML
// rebuild through focus_restore, an onVisibilityChange dep the Hud wires to
// syncAnyWindowOpenState. It differs in two recorded ways: the root is MINTED
// here (no markup entry; the dev_command_window precedent, which is why this
// module registers in UI_DOM_MODULES and in the managed-close CODE_BUILT
// registry), and it carries the harvest journal's 1 Hz signature-gated clock
// (a counted COLD_PAINTER_ALLOWANCES driver), because THE ATTEMPT PATH EMITS
// NO EVENT: feedback is the sim's notice/error lines plus the inv/einst
// mirrors re-diffing, so the window converges by comparing a VALUE signature
// once a second while open and repainting only when the model moved.
//
// The in-flight belief (pendingSend) clears on (a) the Hud's error-toast
// forward (the sim's deny arms answer through ctx.error) and (b) any repaint
// where the selected copy's info signature changed (the mirrors re-diffed:
// the answer landed). No timeout: re-arming early is safe, the sim
// re-validates every gate.

import { audio } from '../../../game/audio';
import { ITEMS } from '../../../sim/data';
import type { PerfectItemRef } from '../../../sim/professions/perfecting';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { captureFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { installPromptDialog } from '../../prompt_dialog';
import { svgIcon } from '../../ui_icons';
import { craftNameText } from './craft_name_view';
import {
  type LegendaryNamingDialogHandle,
  openLegendaryNamingDialog,
} from './legendary_naming_dialog';
import {
  buildPerfectingView,
  type PerfectingCandidate,
  type PerfectingDetail,
  type PerfectingViewModel,
  perfectingInfoSignature,
  perfectingViewSignature,
  samePerfectRef,
} from './perfecting_view';

// The convergence poll while open (the harvest journal's cadence): the tick
// compares a value signature and repaints only when the model moved.
const PERFECTING_POLL_MS = 1000;

const wholeNumber = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

export interface PerfectingWindowDeps extends PainterHostPresentation {
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Fired after the root's display flips either way; Hud wires it to
   *  syncAnyWindowOpenState (the farming windows' body-class family). */
  onVisibilityChange?(): void;
}

interface BuiltView {
  view: PerfectingViewModel;
  syncing: boolean;
}

export class PerfectingWindow {
  private rootEl: HTMLElement | null = null;
  private shellEl: HTMLElement | null = null;
  private liveEl: HTMLElement | null = null;
  private openerFocus: HTMLElement | null = null;
  private selectedRef: PerfectItemRef | null = null;
  private paintedView: PerfectingViewModel | null = null;
  private namingDialog: LegendaryNamingDialogHandle | null = null;
  private clock: number | null = null;
  /** The whole-view value signature the 1 Hz tick compares (text-independent
   *  BY DESIGN, which is why relocalize() below exists). */
  private lastSig = '';
  /** The SELECTED copy's info signature: a move under an in-flight send is
   *  the mirrors answering, so it clears pendingSend. Null before any paint. */
  private lastSelectedSig: string | null = null;
  /** The selected copy's previous facts, for the observed-outcome edges (the
   *  success cue on a rank advance, dismissing the naming dialog once the
   *  promotion landed). Never a prediction: only what the mirrors now show. */
  private prevSelected: {
    ref: PerfectItemRef;
    rank: number;
    perfected: boolean;
    promoted: boolean;
  } | null = null;
  /** Armed by an attempt/promotion send, cleared by the answering error toast
   *  or the selected copy's signature moving. Write ONLY through
   *  setPendingSend, which mirrors it onto the root's aria-busy (the plant
   *  sheet's in-flight affordance). */
  private pendingSend = false;

  constructor(private readonly deps: PerfectingWindowDeps) {}

  /** The minted #perfecting-window root (the dev_command_window shape): no
   *  markup entry ships it, so the first reach creates it. The repaint
   *  target is the inner .pf-shell (display: contents) so the LIVE REGION
   *  beside it is a persistent node the innerHTML rewrite never destroys
   *  (the harvest journal's structural trick: a region that leaves and
   *  re-enters the tree drops or repeats its announcements). */
  private root(): HTMLElement {
    if (this.rootEl) return this.rootEl;
    const root = document.createElement('div');
    root.id = 'perfecting-window';
    root.className = 'window panel';
    const shell = document.createElement('div');
    shell.className = 'pf-shell';
    const live = document.createElement('span');
    live.className = 'pf-live-status';
    live.setAttribute('role', 'status');
    root.append(shell, live);
    (document.getElementById('ui') ?? document.body).appendChild(root);
    this.rootEl = root;
    this.shellEl = shell;
    this.liveEl = live;
    return root;
  }

  /** Announce a landed act through the persistent status region: a FRESH
   *  child span per announcement (a byte-identical textContent write mutates
   *  nothing and announces nothing; the journal's readyAnnounce shape). */
  private announce(text: string): void {
    if (!this.liveEl) return;
    this.liveEl.textContent = '';
    const line = document.createElement('span');
    line.textContent = text;
    this.liveEl.appendChild(line);
  }

  private setPendingSend(value: boolean): void {
    this.pendingSend = value;
    this.root().setAttribute('aria-busy', value ? 'true' : 'false');
  }

  get isOpen(): boolean {
    return this.rootEl !== null && this.rootEl.style.display === 'flex';
  }

  open(): void {
    const root = this.root();
    const wasOpen = this.isOpen;
    if (!wasOpen) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      markDialogRoot(root, { labelledBy: 'perfecting-title' });
      // Flex: the column-flex window family (the plant sheet / journal shape).
      root.style.display = 'flex';
      this.deps.onVisibilityChange?.();
      this.setPendingSend(false);
      if (this.clock === null) {
        this.clock = window.setInterval(() => this.tick(), PERFECTING_POLL_MS);
      }
    }
    this.paint();
    if (!wasOpen) root.querySelector<HTMLElement>('[data-close]')?.focus();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  close(): void {
    const root = this.rootEl;
    if (!root || root.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    // Teardown order: hide FIRST so the dialog teardown's focus repair sees a
    // closed window and stands down (its isOpen gate); the dialog's dismiss
    // then clears inert itself, and the direct write after it is the backstop
    // the prompt_dialog contract asks of a caller whose window can be
    // force-closed under an open prompt.
    root.style.display = 'none';
    this.namingDialog?.dismiss();
    root.inert = false;
    this.deps.onVisibilityChange?.();
    if (this.clock !== null) {
      window.clearInterval(this.clock);
      this.clock = null;
    }
    this.setPendingSend(false);
    // Drop the session latches so a reopen never replays a stale edge (a
    // rank advance that happened while closed is old news, not a cue), and
    // clear the standing announcement with them.
    if (this.liveEl) this.liveEl.textContent = '';
    this.lastSig = '';
    this.lastSelectedSig = null;
    this.prevSelected = null;
    this.paintedView = null;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** The Hud's runtime-language-switch arm: the repaint signature is
   *  text-independent by design, so force exactly one rebuild (paint()
   *  re-latches the signature to the current state, never clears it). */
  relocalize(): void {
    if (!this.isOpen) return;
    // The standing announcement was minted in the old locale; clear rather
    // than re-announce (the journal's rule).
    if (this.liveEl) this.liveEl.textContent = '';
    this.paint();
  }

  /** The Hud's error-toast forward (the plant sheet precedent): the sim's
   *  deny arms answer through ctx.error, so any error toast spends the
   *  in-flight belief and lifts the naming dialog's submit lock early. */
  notifyErrorToast(): void {
    if (!this.isOpen) return;
    this.setPendingSend(false);
    this.namingDialog?.notifyAnswered();
  }

  private buildView(): BuiltView {
    const world = this.deps.world();
    const syncing = !world.craftingIdentity.synced;
    const view = buildPerfectingView(
      {
        equipment: world.equipment,
        equipmentInstances: world.equipmentInstances,
        inventory: world.inventory,
        identitySynced: !syncing,
        perfectingInfo: (ref) => world.perfectingInfo(ref),
      },
      this.selectedRef,
    );
    return { view, syncing };
  }

  /** The 1 Hz convergence tick: everything it does on an unchanged frame is
   *  one isOpen read and the pure signature compare; a moved model repaints
   *  whole through the SAME paintFrom an open takes (the counted
   *  COLD_PAINTER_ALLOWANCES entry in tests/hud_perf_budget.test.ts). */
  private tick(): void {
    if (!this.isOpen) return;
    const built = this.buildView();
    if (perfectingViewSignature(built.view, built.syncing) === this.lastSig) return;
    this.paintFrom(built);
  }

  private paint(): void {
    this.paintFrom(this.buildView());
  }

  private paintFrom(built: BuiltView): void {
    if (!this.isOpen) return;
    const { view, syncing } = built;
    const detail = view.detail;
    // The answer edges, judged off what the mirrors NOW show (never a
    // prediction). A moved selected-copy signature spends the in-flight
    // belief; a rank advance or the Perfected stamp is the success cue; the
    // landed promotion retires the naming dialog.
    const selectedSig = perfectingInfoSignature(detail?.info ?? null);
    if (this.lastSelectedSig !== null && selectedSig !== this.lastSelectedSig) {
      if (this.pendingSend) this.setPendingSend(false);
      this.namingDialog?.notifyAnswered();
    }
    const prev = this.prevSelected;
    if (detail && prev && samePerfectRef(prev.ref, detail.ref)) {
      // The edge latches through prevSelected below, so whichever forced
      // repaint observes it first (the 1 Hz tick, or a relocalize that beat
      // it) plays the cue exactly once; a later repaint can never replay it.
      if (detail.info.rank > prev.rank || (detail.info.perfected && !prev.perfected)) {
        audio.perfectingSuccess();
        // The aria-live half of the flip (the farming-arm acceptance): the
        // Perfected stamp outranks a same-frame rank line.
        const def = ITEMS[detail.itemId];
        const name = def ? itemDisplayName(def) : detail.itemId;
        this.announce(
          detail.info.perfected && !prev.perfected
            ? t('hudChrome.perfecting.perfectedAnnounce', { name })
            : t('hudChrome.perfecting.rankAnnounce', {
                rank: wholeNumber(detail.info.rank),
                ranks: wholeNumber(detail.info.ranks),
              }),
        );
      }
      if (detail.info.promoted && !prev.promoted) this.namingDialog?.dismiss();
    }
    this.selectedRef = detail?.ref ?? null;
    this.paintedView = view;
    const root = this.root();
    const shell = this.shellEl ?? root;
    const scroller = root.querySelector<HTMLElement>('.pf-body');
    const scrollTop = scroller?.scrollTop ?? 0;
    const focusKey = captureFocusKey(root);
    // The rewrite targets the inner shell so the sibling live region never
    // leaves the tree (see root()).
    shell.innerHTML =
      `<div class="panel-title"><span id="perfecting-title">${esc(t('hudChrome.perfecting.title'))}</span>` +
      `<button type="button" class="x-btn" data-close data-focus-key="pfClose" aria-label="${esc(t('hudChrome.perfecting.close'))}" title="${esc(t('hudChrome.perfecting.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="pf-body">${this.bodyHtml(view)}</div>`;
    this.wire(root, view);
    const newScroller = root.querySelector<HTMLElement>('.pf-body');
    if (newScroller) newScroller.scrollTop = scrollTop;
    if (focusKey !== null) {
      restoreFirstEnabled([
        root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
    this.lastSig = perfectingViewSignature(view, syncing);
    this.lastSelectedSig = selectedSig;
    this.prevSelected = detail
      ? {
          ref: detail.ref,
          rank: detail.info.rank,
          perfected: detail.info.perfected,
          promoted: detail.info.promoted,
        }
      : null;
  }

  private wire(root: HTMLElement, view: PerfectingViewModel): void {
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    for (const btn of root.querySelectorAll<HTMLElement>('[data-cand-i]')) {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.candI);
        const ref = view.candidates[index]?.ref;
        if (!ref || samePerfectRef(ref, this.selectedRef)) return;
        this.selectedRef = ref;
        this.paint();
      });
      // Owned stacks get the real item tooltip (the commission-board shape):
      // a candidate resolves its own copy's payload so the Perfected badge
      // and rank line ride along.
      const c = view.candidates[Number(btn.dataset.candI)];
      const def = c ? ITEMS[c.itemId] : undefined;
      if (c && def) {
        // Lazy thunk (the attachTooltip contract), resolving the copy's
        // payload at hover time off the LIVE world so the badge lines track
        // the mirrors rather than the render.
        const ref = c.ref;
        this.deps.attachTooltip(btn, () => {
          const live = this.deps.world();
          const instance =
            'slot' in ref ? live.equipmentInstances[ref.slot] : live.inventory[ref.bag]?.instance;
          return this.deps.itemTooltip(def, instance);
        });
      }
    }
    for (const row of root.querySelectorAll<HTMLElement>('[data-mat-id]')) {
      const def = ITEMS[row.dataset.matId ?? ''];
      if (def) this.deps.attachTooltip(row, () => this.deps.itemTooltip(def));
    }
    root.querySelector('[data-action]')?.addEventListener('click', () => {
      const detail = this.paintedView?.detail;
      if (!detail || !detail.actionEnabled || this.pendingSend) return;
      if (detail.action === 'attempt') {
        if (detail.bindWarning) this.confirmBindThenAttempt(detail);
        else this.sendAttempt(detail.ref);
      } else if (detail.action === 'promote') {
        this.openNamingDialog(detail);
      }
    });
  }

  /** Focus repair after a prompt teardown: dismissAndReturn's captured opener
   *  may have been detached by a mid-prompt 1 Hz repaint (the root rebuilds
   *  through innerHTML), and a landed promotion dismisses with no return at
   *  all, so whenever a teardown leaves focus outside the window put it on
   *  the best live rung: the selected candidate row, the action button, then
   *  close. All three carry focus keys, so a repaint that follows in the same
   *  frame carries the choice across. This is the dialog-return half of focus
   *  management, not a repaint-refocus (the #2377 ruling bars those; it runs
   *  only when a prompt THIS window opened has just torn down, and the window
   *  is FocusManager-registered).  */
  private refocusAfterPrompt(): void {
    if (!this.isOpen) return;
    // Repair ONLY a dropped focus (body/null): a prompt teardown that leaves
    // focus on any real control, this window's OR another's, keeps it. The
    // fresh-read round's steal case: the promotion's repaint-driven
    // auto-dismiss can fire while the player is typing in chat behind the
    // dialog, and yanking them onto a perfecting rung mid-word is worse than
    // the drop it repairs.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) return;
    const root = this.root();
    restoreFirstEnabled([
      root.querySelector<HTMLElement>('.pf-cand[aria-checked="true"]'),
      root.querySelector<HTMLElement>('[data-action]'),
      root.querySelector<HTMLElement>('[data-close]'),
    ]);
  }

  private sendAttempt(ref: PerfectItemRef): void {
    this.setPendingSend(true);
    audio.perfectingAttempt();
    // The live world at click time, never captured at render (the plant
    // sheet precedent); the sim's own lines + mirrors are the feedback.
    this.deps.world().perfectItem(ref);
  }

  /** The R2 confirm step: the first attempt on an unbound copy permanently
   *  binds it, so that attempt goes through an explicit confirm on the
   *  shared modal recipe (never a hand-rolled trap). */
  private confirmBindThenAttempt(detail: PerfectingDetail): void {
    const stack = document.getElementById('prompt-stack');
    if (!stack) {
      // Dev-channel only: both entry documents ship #prompt-stack, so a miss
      // is a broken embed, and a silently dead confirm would read as a bug.
      console.warn('perfecting: #prompt-stack missing, bind confirm unavailable');
      return;
    }
    const def = ITEMS[detail.itemId];
    const name = def ? itemDisplayName(def) : detail.itemId;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel pf-bind-prompt';
    const text = document.createElement('div');
    text.className = 'prompt-text';
    text.textContent = t('hudChrome.perfecting.bindConfirmText', { name });
    const actions = document.createElement('div');
    actions.className = 'pf-name-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = t('hudChrome.perfecting.bindConfirmCancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn pf-bind-confirm';
    confirm.textContent = t('hudChrome.perfecting.bindConfirmAccept');
    actions.append(cancel, confirm);
    prompt.append(text, actions);
    const opener = this.root().querySelector<HTMLElement>('[data-action]');
    const { dismissAndReturn } = installPromptDialog(
      prompt,
      opener,
      () => {
        prompt.remove();
        this.refocusAfterPrompt();
      },
      {
        inertRoot: this.root(),
        idPrefix: 'pf-bind-title',
      },
    );
    confirm.addEventListener('click', () => {
      // Send the ref the dialog was OPENED for, never a re-resolve: the 1 Hz
      // repaint keeps running behind the prompt and the HUD outside this
      // window stays interactive, so a bag shift mid-dialog would make a
      // re-resolved view fall back to another candidate and this confirm
      // would bind THAT copy. A genuinely stale captured ref resolves to
      // nothing server-side (the index-plus-id pin) and answers with the
      // sim's own noItem line, which is the safe direction (the phase 13
      // peek/consume ruling).
      dismissAndReturn();
      this.sendAttempt(detail.ref);
    });
    cancel.addEventListener('click', () => dismissAndReturn());
    stack.appendChild(prompt);
    confirm.focus();
  }

  private openNamingDialog(detail: PerfectingDetail): void {
    if (this.namingDialog?.isOpen()) return;
    const def = ITEMS[detail.itemId];
    this.namingDialog = openLegendaryNamingDialog({
      inertRoot: this.root(),
      opener: this.root().querySelector<HTMLElement>('[data-action]'),
      itemName: def ? itemDisplayName(def) : detail.itemId,
      onSubmit: (name) => {
        // Send the ref the dialog was OPENED for, never a re-resolve: a bag
        // shift mid-dialog would retarget a re-resolved view onto another
        // candidate and spend the Deed of Making naming the wrong copy. A
        // stale captured ref resolves to nothing server-side (the
        // index-plus-id pin) and answers with the sim's noItem line, the
        // safe direction (the phase 13 peek/consume ruling).
        this.setPendingSend(true);
        this.deps.world().perfectItem(detail.ref, name);
      },
      onClosed: () => {
        this.namingDialog = null;
        this.refocusAfterPrompt();
      },
    });
  }

  // --- markup -------------------------------------------------------------

  private bodyHtml(view: PerfectingViewModel): string {
    if (view.candidates.length === 0) {
      // The family empty state (.prof-empty, phase 14): body line alone, the
      // section-empty variant.
      return `<div class="prof-empty"><p>${esc(t('hudChrome.perfecting.empty'))}</p></div>`;
    }
    // Single-select rows are a radiogroup of natively tabbable radios (the
    // plant sheet's a11y shape); the group borrows the dialog title as its
    // name and the li wrappers are presentational.
    const rows = view.candidates.map((c, i) => this.candidateHtml(c, i)).join('');
    const list = `<ul class="pf-list" role="radiogroup" aria-labelledby="perfecting-title">${rows}</ul>`;
    return `${list}${view.detail ? this.detailHtml(view.detail) : ''}`;
  }

  private stateText(state: PerfectingCandidate['state'], rank: number, ranks: number): string {
    if (state === 'promoted') return t('hudChrome.perfecting.rowPromoted');
    if (state === 'perfected') return t('hudChrome.perfecting.rowPerfected');
    return t('hudChrome.perfecting.rowRank', {
      rank: wholeNumber(rank),
      ranks: wholeNumber(ranks),
    });
  }

  private candidateHtml(c: PerfectingCandidate, index: number): string {
    const def = ITEMS[c.itemId];
    const name = def ? itemDisplayName(def) : c.itemId;
    const icon = def
      ? this.deps.itemIcon(def, c.state === 'promoted' ? 'legendary' : undefined)
      : '';
    const focusKey = 'slot' in c.ref ? `cand:s:${c.ref.slot}` : `cand:b:${c.ref.bag}`;
    const worn = c.worn
      ? `<span class="pf-chip">${esc(t('hudChrome.perfecting.wornChip'))}</span>`
      : '';
    // A promoted legend's row leads with its player-chosen name (raw VALUE,
    // esc'd standalone per D13-2) so two promotions of one base item read
    // apart at a glance; the base name rides beneath, the detail-pane shape.
    const rowName = c.state === 'promoted' && c.chosenName !== null ? c.chosenName : name;
    const sub =
      c.state === 'promoted' && c.chosenName !== null
        ? `<span class="pf-cand-sub">${esc(name)}</span>`
        : '';
    return (
      `<li role="none"><button type="button" role="radio" class="pf-cand" data-cand-i="${index}" data-focus-key="${esc(focusKey)}" aria-checked="${c.selected ? 'true' : 'false'}">` +
      `<span class="pf-cand-socket">${icon}</span>` +
      `<span class="pf-cand-main"><span class="pf-name${c.state === 'promoted' ? ' q-legendary' : ''}">${esc(rowName)}</span>${sub}${worn}</span>` +
      `<span class="pf-cand-state">${esc(this.stateText(c.state, c.rank, c.ranks))}</span>` +
      `</button></li>`
    );
  }

  private detailHtml(d: PerfectingDetail): string {
    const def = ITEMS[d.itemId];
    const name = def ? itemDisplayName(def) : d.itemId;
    const icon = def
      ? this.deps.itemIcon(def, d.state === 'promoted' ? 'legendary' : undefined)
      : '';
    // The promoted legend leads with its player-chosen name (a raw VALUE,
    // esc'd standalone per the D13-2 ruling), the base name beneath it.
    const promotedName = d.state === 'promoted' && d.chosenName !== null;
    const head =
      `<div class="pf-detail-head"><span class="pf-cand-socket">${icon}</span>` +
      `<span class="pf-detail-names"><span class="pf-detail-name${d.state === 'promoted' ? ' q-legendary' : ''}">${esc(promotedName ? (d.chosenName as string) : name)}</span>` +
      `${promotedName ? `<span class="pf-detail-sub">${esc(name)}</span>` : ''}</span></div>`;
    const statusText = this.stateText(d.state, d.info.rank, d.info.ranks);
    // The shared .prof-track family (phase 14) carries the anatomy; the
    // pf- classes stay for the settled-state fills keyed off data-state.
    const steps = Array.from({ length: d.info.ranks }, (_, i) => {
      const filled = d.state !== 'track' || i < d.info.rank;
      return `<span class="prof-track-step pf-step${filled ? ' filled' : ''}"></span>`;
    }).join('');
    const track =
      `<div class="prof-track pf-track" data-state="${esc(d.state)}">` +
      `<span class="prof-track-steps" aria-hidden="true">${steps}</span>` +
      `<span class="prof-track-text pf-track-label">${esc(statusText)}</span></div>`;
    const warning = d.bindWarning
      ? `<div class="pf-warning" role="note">${svgIcon('alert')}<span>${esc(t('hudChrome.perfecting.bindWarn', { name }))} ${esc(t('hudChrome.perfecting.bindWarnDetail'))}</span></div>`
      : '';
    const lead =
      d.state === 'perfected'
        ? `<p class="pf-lead">${esc(t('hudChrome.perfecting.perfectedLead'))}</p>`
        : d.state === 'promoted'
          ? `<p class="pf-lead pf-done">${esc(t('hudChrome.perfecting.promotedLine'))}</p>`
          : '';
    // The bill: whichever rows arrive (the attempt materials, the Deed of
    // Making once Perfected, none once promoted; the view contract).
    const matRows = d.info.materials
      .map((row) => {
        const matDef = ITEMS[row.itemId];
        const matName = matDef ? itemDisplayName(matDef) : row.itemId;
        const matIcon = matDef ? this.deps.itemIcon(matDef) : '';
        const short = row.have < row.required;
        return (
          `<li class="pf-mat${short ? ' short' : ''}" data-mat-id="${esc(row.itemId)}"><span class="pf-cand-socket">${matIcon}</span>` +
          `<span class="pf-name">${esc(matName)}</span>` +
          `<span class="pf-mat-count">${esc(t('hudChrome.perfecting.matCount', { have: wholeNumber(row.have), required: wholeNumber(row.required) }))}</span></li>`
        );
      })
      .join('');
    const mats =
      d.info.materials.length > 0
        ? `<div class="pf-mats-title">${esc(t(d.state === 'perfected' ? 'hudChrome.perfecting.promoteCost' : 'hudChrome.perfecting.attemptCost'))}</div><ul class="pf-mats" role="list">${matRows}</ul>`
        : '';
    // The skill line, gated on the identity mirror's sync (never a false
    // "not met" before the first cprof frame lands).
    const craft = d.info.craftId ? craftNameText(d.info.craftId) : '';
    const skillState = d.syncing
      ? t('hudChrome.perfecting.skillSyncing')
      : d.info.skillMet
        ? t('hudChrome.perfecting.skillMet')
        : t('hudChrome.perfecting.skillUnmet');
    const skill =
      d.state === 'promoted'
        ? ''
        : `<div class="pf-skill${!d.syncing && !d.info.skillMet ? ' unmet' : ''}">${esc(t('hudChrome.perfecting.skillNeed', { craft, skill: wholeNumber(d.info.skillReq) }))} <span class="pf-skill-state">${esc(skillState)}</span></div>`;
    const equipBlocked =
      d.action === 'promote' && d.info.equipBlocked
        ? `<div class="pf-warning" role="note">${svgIcon('alert')}<span>${esc(t('hudChrome.perfecting.equipBlocked'))}</span></div>`
        : '';
    const actionLabel =
      d.action === 'attempt'
        ? t('hudChrome.perfecting.attempt')
        : t('hudChrome.perfecting.promote');
    const action =
      d.action === 'done'
        ? ''
        : `<button type="button" class="pf-action" data-action data-focus-key="pfAction"${d.actionEnabled ? '' : ' disabled'}>${esc(actionLabel)}</button>`;
    return `<div class="pf-detail">${head}${track}${lead}${warning}${mats}${skill}${equipBlocked}${action}</div>`;
  }
}
