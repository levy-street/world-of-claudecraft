// The shared corpse-harvest preference CONTROLLER (Intentional Gathering
// PR3): the one visit/world-identity coordinator the Field Kit use,
// Professions, and corpse Change entrances all call, painting the SAME
// content renderer (harvest_preference_picker.ts). Reaches no browser
// global directly (every DOM touch rides `deps.root()`, the
// farming_plant_sheet_window.ts shape); no independent Escape/Tab
// listeners, no repeating driver, no second focus manager.
//
// Split of responsibility: the picker owns its own terminal/DOM-ownership
// guards (its own header); this controller owns the VISIT (capture/restore
// exactly once per real open/close, a generation counter that forecloses a
// stale or reentrant callback) and WORLD IDENTITY (a world instance swapped
// out from under an open picker, e.g. a reconnect or character change,
// refuses a stale Apply and retires the visit rather than leaving a
// dead-but-visible window).
//
// Generation discipline: `open()` bumps it on every call (fresh open or a
// same-window reopen for a different body alike); `close()`/teardown bumps
// it again. Every picker callback closes over the generation it was PAINTED
// under and re-checks it before acting, both BEFORE doing anything (a
// superseded or already-closed visit) and, for onCommit, AFTER calling the
// world setter (a reentrant open() from inside that call must not have its
// new visit torn down by the commit that triggered it).

import {
  type HarvestPreference,
  parseHarvestPreferenceCommand,
} from '../../../sim/professions/harvest_preference';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { t } from '../../i18n';
import { renderHarvestPreferencePicker } from './harvest_preference_picker';

type PreferenceWorld = Pick<IWorld, 'harvestPreference' | 'setHarvestPreference'>;

export interface HarvestPreferenceControllerDeps {
  /** The dedicated content root this controller owns and fully repaints. */
  root(): HTMLElement;
  world(): PreferenceWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Called on BOTH display flips (open and close), never on a same-window
   *  reopen for a different body: the mobile window-open body-class family
   *  contract (src/ui/hud/professions/CLAUDE.md). */
  onVisibilityChange?(): void;
}

export class HarvestPreferenceController {
  private openState = false;
  private generation = 0;
  private componentTags: readonly string[] | undefined;
  private openedWorld: PreferenceWorld | null = null;
  private currentDraft: HarvestPreference | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly deps: HarvestPreferenceControllerDeps) {}

  get isOpen(): boolean {
    return this.openState;
  }

  /**
   * Open for `componentTags` (omitted: the general catalog). A fresh open
   * (currently closed) captures the opener exactly once via
   * `deps.captureFocus()`; a same-window reopen (already open, a different
   * body) does NOT recapture it. Either way the draft resets to the LATEST
   * global preference read from `deps.world()` right now, discarding any
   * abandoned draft from a prior visit: opening a body is never an implicit
   * setting change.
   */
  open(componentTags?: readonly string[]): void {
    const wasOpen = this.openState;
    if (!wasOpen) {
      this.deps.closeOthers();
      this.opener = this.deps.captureFocus();
    }
    this.generation++;
    // Readonly input copy: this controller never mutates the caller's array,
    // and never holds a live reference to it.
    this.componentTags = componentTags ? [...componentTags] : undefined;
    const world = this.deps.world();
    this.openedWorld = world;
    this.currentDraft = world.harvestPreference;
    this.openState = true;
    this.paint();
    // Visible AFTER paint, so logical state and DOM visibility agree before
    // any external callback (onVisibilityChange) can observe either: a
    // caller that reads root visibility from that callback sees content
    // already in place, not a flip into an empty panel.
    this.deps.root().style.display = 'flex';
    // A fresh open, or a same-window reopen for a different body, both land
    // focus on a real control in the freshly painted content: the checked
    // roving radio, or the first (unchecked) one when nothing resolved. This
    // is deliberately NOT relocalize's job, which preserves the player's
    // EXACT prior focus instead; open() always starts a fresh visit.
    this.focusRovingTabStop();
    if (!wasOpen) this.deps.onVisibilityChange?.();
  }

  /** The Escape/close path: discards without a command and restores focus
   *  through the dependency bridge. A no-op when already closed. */
  close(): void {
    if (!this.openState) return;
    this.finishVisit();
  }

  /**
   * Repaint the SAME open visit under the current locale, preserving the
   * uncommitted draft (never re-reading `deps.world()` for it) and the
   * EXACT focused control (Apply/Cancel included, not merely "the checked
   * row"), via the shared focus-key seam. Never sends a command. A no-op
   * when closed. If the world identity changed since open (a swap under an
   * open picker), closes instead of repainting stale character data.
   */
  relocalize(): void {
    if (!this.openState) return;
    if (this.deps.world() !== this.openedWorld) {
      this.close();
      return;
    }
    const root = this.deps.root();
    const focusKey = captureFocusKey(root);
    this.paint();
    // captureFocusKey already answers null when focus was outside this
    // root; skip the restore entirely rather than stealing focus.
    if (focusKey !== null) restoreFirstEnabled([findFocusKey(root, focusKey)]);
  }

  private paint(): void {
    const generationAtPaint = this.generation;
    const root = this.deps.root();
    // Refreshed on EVERY paint (a fresh open and a relocalize repaint alike),
    // so the accessible name always matches the active locale; open() alone
    // would leave it stale after a language switch.
    markDialogRoot(root, { label: t('hudChrome.harvestPreference.title') });
    renderHarvestPreferencePicker(
      root,
      { preference: this.currentDraft, componentTags: this.componentTags },
      {
        onDraftChange: (raw) => {
          if (generationAtPaint !== this.generation) return;
          const command = parseHarvestPreferenceCommand(raw);
          if (command.ok) this.currentDraft = command.preference;
        },
        onCommit: (raw) => {
          if (generationAtPaint !== this.generation) return;
          const world = this.deps.world();
          // A world/character swap under an open picker: send the command
          // to NEITHER world, matching relocalize's own refusal above.
          if (world === this.openedWorld) world.setHarvestPreference(raw);
          // A reentrant open() from inside setHarvestPreference already
          // started a NEW visit; never tear that one down here.
          if (generationAtPaint !== this.generation) return;
          this.finishVisit();
        },
        onDismiss: () => {
          if (generationAtPaint !== this.generation) return;
          this.finishVisit();
        },
      },
    );
  }

  /** Clears the rendered subtree (so every painter control becomes inert
   *  independent of its own terminal flag), hides the root, and invalidates
   *  the visit BEFORE restoring focus or notifying the caller: logical state
   *  and DOM visibility already agree by the time either external callback
   *  runs. Used by close() and by every paint() callback's closing arm, so a
   *  world-identity refusal retires its stale visit the same way an ordinary
   *  close does, never leaving a dead-but-visible window behind. */
  private finishVisit(): void {
    this.openState = false;
    this.generation++;
    this.openedWorld = null;
    const root = this.deps.root();
    root.textContent = '';
    root.style.display = 'none';
    const opener = this.opener;
    this.opener = null;
    this.deps.restoreFocus(opener);
    this.deps.onVisibilityChange?.();
  }

  /** Focus the roving tab-stop radio in the just-painted content: the
   *  checked row, or the first (unchecked) one when nothing resolved. Used
   *  only by open() (a fresh visit); relocalize carries the player's exact
   *  prior focus instead via the focus-key seam. */
  private focusRovingTabStop(): void {
    this.deps.root().querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }
}
