// The char-select "Redesign" editor: a character's one-shot appearance change.
//
// Every character created inside the free window (plus, as a safety net, any
// character with no authored look at all) carries a single server-tracked
// redesign token, so the target may well arrive with a look AND a helm
// preference it already chose, which is why both seed from the row. The editor
// reuses the creation customizer, docked where the news panel sits, and drives
// the shared 3D stage with a DRAFT look; nothing is written anywhere until Save
// posts it and the server burns the token atomically. Cancel (or navigating
// away, or a roster refresh) discards the draft and the character keeps the
// design it had.
//
// Its own module rather than more top-level functions in the app coordinator:
// this is a self-contained screen, it needs none of the coordinator's private
// mutable state, and everything it does need arrives through RedesignEditorDeps.
// That also makes the two decisions worth testing (what the stage is driven
// with, and when the token is actually spent) reachable from a Vitest with a
// fake host instead of only by clicking.

import {
  type ArmorLoadout,
  classArmorSet,
  fullSet,
  type ModularAppearance,
  normalizeAppearance,
} from '../render/characters/modular';
import type { RosterLookRow } from '../render/characters/player_look_core';
import type { PlayerClass } from '../sim/types';
import { type AppearanceCustomizer, mountAppearanceCustomizer } from './appearance_customizer';
import { forgetAppearancePanel, noteAppearancePanelMounted } from './appearance_panel_locale';
import { FOCUSABLE_SELECTOR } from './focus_manager';
import { t } from './i18n';

/** The roster row the editor works against. Structural (the char-select
 *  `CharacterSummary` satisfies it) so this module does not import the net
 *  layer for a type. */
export interface RedesignTarget extends RosterLookRow {
  id: number;
  name: string;
  mainhandItemId?: string | null;
  offhandItemId?: string | null;
  weaponSkinId?: string | null;
}

/** Everything the editor needs from the app coordinator. All of it is either a
 *  singleton it must not own (the 3D stage, the api client) or a screen-level
 *  action it must not perform itself (re-pulling the roster). */
export interface RedesignEditorDeps {
  /** Drive the shared char-select turntable with a draft look. */
  previewModular(
    app: ModularAppearance,
    worn: ArmorLoadout,
    cls: PlayerClass,
    mainhandItemId: string | null,
    offhandItemId: string | null,
    weaponSkinId: string | null,
  ): void;
  /** Put the stage back on whatever the roster selection is (Cancel). */
  restoreStage(): void;
  /** The name shown under the stage. */
  setPreviewName(name: string): void;
  /** POST the redesign. Rejects on a spent token or a malformed look. */
  saveAppearance(characterId: number, app: ModularAppearance, helmHidden: boolean): Promise<void>;
  /** Re-pull the roster after a successful save. */
  refreshRoster(): Promise<void>;
  /** Map a rejected save to a sentence a player can read. */
  errorText(err: unknown): string;
}

/** The panel id the locale probe tracks this editor's customizer under. */
const PANEL_ID = '#charselect-reroll';

export class CharselectRedesignEditor {
  private target: RedesignTarget | null = null;
  /** Where keyboard focus was when the editor opened (the row's Redesign
   *  button). close() hides the panel, and hiding the element that holds focus
   *  drops it to <body>; handing it back is the chrome's focus contract. */
  private returnFocus: HTMLElement | null = null;
  private draft: ModularAppearance | null = null;
  private ui: AppearanceCustomizer | null = null;
  /** The editor's helmet toggle. Unlike the creation turntable's preview flag,
   *  this IS saved: it is the character's standing wardrobe preference, the same
   *  thing creation posts and the in-world paperdoll eye edits.
   *
   *  Which is exactly why it is SEEDED FROM THE CHARACTER rather than forced
   *  open. It used to start hidden on every open, on the reasoning that a face
   *  you are authoring should be visible: fine while the toggle was a preview,
   *  wrong the moment it became a preference: a player who had never hidden
   *  anything, redesigned, and never touched the row came out with their helm
   *  hidden. Save is now a no-op on this field unless they move it. */
  private helmHidden = false;
  /** The document-level Escape listener while a redesign is open, null while
   *  closed. Registered at the end of open(), removed UNCONDITIONALLY at the
   *  top of close() (both the save-close and cancel-close paths route
   *  through close(), so this never depends on which one fired) so two
   *  open/close cycles cannot leave a second listener behind. */
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly deps: RedesignEditorDeps) {}

  /** Whether a redesign is in progress, i.e. whether the stage belongs to a
   *  draft rather than to the roster selection. */
  get isOpen(): boolean {
    return this.target !== null && this.draft !== null;
  }

  /** The kit the draft is previewed over: the class set, head piece dropped
   *  while the helm is hidden. */
  private loadout(c: RedesignTarget): ArmorLoadout {
    const full = fullSet(classArmorSet(c.class));
    return this.helmHidden ? { ...full, head: null } : full;
  }

  /** Push the current draft onto the 3D stage. Safe to call at any time; a
   *  no-op when no redesign is open, which is what lets the coordinator route
   *  every stage refresh through it. */
  drivePreview(): void {
    const c = this.target;
    const app = this.draft;
    if (!c || !app) return;
    this.deps.previewModular(
      app,
      this.loadout(c),
      c.class,
      c.mainhandItemId ?? null,
      c.offhandItemId ?? null,
      c.weaponSkinId ?? null,
    );
  }

  /** Open the editor on a roster character. Idempotent: opening on a second
   *  character closes the first, discarding its draft.
   *
   *  `opener`, when given, is the exact element the player just interacted
   *  with (the row's Redesign button). Prefer passing it: the shipped
   *  char-select click handler selects the row (which itself calls
   *  close(false) on whatever editor is already open) BEFORE calling open(),
   *  so by the time open() would fall back to reading document.activeElement
   *  it has already been overwritten by that intervening close(). Without an
   *  explicit opener, opening row B's editor while row A's was open returned
   *  focus to A's button on close instead of B's. */
  open(c: RedesignTarget, opener?: HTMLElement): void {
    const panel = document.getElementById('charselect-reroll');
    const host = document.getElementById('charselect-reroll-host');
    if (!panel || !host) return;
    // Captured BEFORE close(), which hands focus back to whichever row opened
    // the editor last. Reading document.activeElement after close() meant
    // clicking Redesign on row B while row A's editor was open returned focus
    // to A's button when B closed; an explicit opener sidesteps that entirely.
    const resolvedOpener =
      opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.close(false);
    this.returnFocus = resolvedOpener;
    this.target = c;
    this.helmHidden = c.helmHidden === true;
    // Seed from the character's stored look. A window-eligible character may
    // already have one (the free redesign covers everyone created before the
    // cutoff, designed or not); only a never-designed one starts from the
    // default body.
    this.draft = normalizeAppearance((c.appearance as Partial<ModularAppearance>) ?? null);
    const errEl = document.getElementById('charselect-reroll-error');
    if (errEl) errEl.textContent = '';
    document.getElementById('charselect-news')?.setAttribute('hidden', '');
    panel.removeAttribute('hidden');
    this.mountCustomizer(host, c);
    this.deps.setPreviewName(c.name);
    this.drivePreview();
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Escape is Cancel: discard the draft AND restore the stage to the
      // roster selection, exactly like #btn-reroll-cancel (main.ts). A plain
      // close(false) would leave the 3D stage showing the just-discarded
      // draft while the news panel replaced the (now hidden) editor.
      this.close(true);
    };
    document.addEventListener('keydown', this.escapeHandler);
    this.focusPanel(panel);
  }

  /** Scroll the panel fully into view and move focus into it. On mobile the
   *  reroll dock flows below the roster (the char-select page itself is the
   *  scroller; see index.html), so tapping Redesign on a long roster can
   *  leave the freshly shown panel entirely offscreen with nothing else
   *  telling the player anything happened. Not gated on form factor: a
   *  keyboard user on desktop benefits from the same focus move. returnFocus
   *  is captured earlier in open(), before this ever moves focus away from
   *  the opener, so that capture is unaffected by the move. */
  private focusPanel(panel: HTMLElement): void {
    const rect = panel.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const fullyVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= viewportHeight &&
      rect.right <= viewportWidth;
    // Guarded: some test environments (jsdom) ship no scrollIntoView.
    if (!fullyVisible && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest' });
    }
    panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }

  /** Build (or rebuild) the customizer against the CURRENT locale. Separate
   *  from open() because a language switch while the editor is up has to
   *  re-mount it: the customizer bakes its labels and cannot relabel in place
   *  (see appearance_panel_locale). */
  private mountCustomizer(host: HTMLElement, c: RedesignTarget): void {
    // The title bakes here, not in open(): a language switch while the editor
    // is up re-mounts through this method (the locale-sweep callback below),
    // and a title baked only at open() would stay in the previous language
    // while everything under it relabels.
    const title = document.getElementById('charselect-reroll-title');
    if (title) title.textContent = t('character.redesignTitle', { name: c.name });
    this.ui?.destroy();
    this.ui = mountAppearanceCustomizer(host, {
      value: this.draft,
      onChange: (next) => {
        this.draft = next;
        this.drivePreview();
      },
      helm: !this.helmHidden,
      onHelm: (on) => {
        this.helmHidden = !on;
        this.drivePreview();
      },
      armorSet: () => classArmorSet(c.class),
    });
    noteAppearancePanelMounted(PANEL_ID, () => {
      const stillHosted = document.getElementById('charselect-reroll-host');
      if (this.target === c && stillHosted) this.mountCustomizer(stillHosted, c);
    });
  }

  /** Discard the draft and hide the panel. `restoreStage` puts the turntable
   *  back on the roster selection; pass false when the caller is about to drive
   *  the stage itself (a save, or a roster refresh that will re-select). */
  close(restoreStage: boolean): void {
    // Unconditional: both close paths (save's close(false) and Cancel/
    // Escape's close(true)) route through here, and a stray Escape with no
    // editor open must find nothing to remove.
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    this.ui?.destroy();
    this.ui = null;
    forgetAppearancePanel(PANEL_ID);
    this.target = null;
    this.draft = null;
    const panel = document.getElementById('charselect-reroll');
    // Hand focus back BEFORE hiding: hiding the element that holds it drops
    // focus to <body> and a keyboard user loses their place in the roster.
    if (panel && !panel.hasAttribute('hidden') && this.returnFocus?.isConnected) {
      this.returnFocus.focus();
    }
    this.returnFocus = null;
    panel?.setAttribute('hidden', '');
    document.getElementById('charselect-news')?.removeAttribute('hidden');
    if (restoreStage) this.deps.restoreStage();
  }

  /** Spend the token. The server decides eligibility and burns it atomically,
   *  so a rejection here leaves the editor open with its draft intact and the
   *  character unchanged. */
  async save(): Promise<void> {
    const c = this.target;
    const draft = this.draft;
    if (!c || !draft) return;
    const saveBtn = document.getElementById('btn-reroll-save') as HTMLButtonElement | null;
    const errEl = document.getElementById('charselect-reroll-error');
    if (saveBtn) saveBtn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      await this.deps.saveAppearance(c.id, draft, this.helmHidden);
      this.close(false);
      // Re-pull the roster: the row redraws with the new look, and the spent
      // token (server truth) removes the Redesign button.
      await this.deps.refreshRoster();
    } catch (err) {
      if (errEl) errEl.textContent = this.deps.errorText(err);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
}
