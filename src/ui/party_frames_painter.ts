// The keyed-pool party-frames painter. It
// replaces the old per-rebuild innerHTML wipe + click/contextmenu re-attach
// (state.md top-risk 3) with a persistent node pool: one row per member key (pid),
// reused across rebuilds, listeners attached ONCE per row (in party_frame_row.ts),
// data updated IN PLACE through the host's six elided writers and each
// member's own unit_frame family INSTANCE.
//
// This file owns only the HOT path (reconcile + per-frame writes); every write here
// routes through the writer facet or the family painter, with NO raw style /
// className / innerHTML / setAttribute (a source-scan guard pins that). The one-time
// DOM construction (createElement, the static badge icons, the row attributes) lives
// in party_frame_row.ts, which the pool calls only when a row is first built.
//
// Reconcile: departed pids detach to a free list (their listeners intact for reuse),
// kept pids update in place, new pids take a free row or build one. The rows are
// re-appended in member order with the leave button last, so the mobile
// :first-child / :not(:first-child) rules still match; appendChild moves a node
// without dropping its keyboard focus or its listeners.

import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import {
  createLeaveButton,
  createPartyRow,
  PARTY_CREST_KEY_PREFIX,
  PARTY_LEADER_GLYPH,
  type PartyRow,
  type PartyRowAuraDeps,
  type PartyRowDeps,
} from './party_frame_row';
import type { PartyFrameMember } from './party_frames';
import { unitFrameView } from './unit_frame';

// The class-color custom property the frame's name reads (`color: var(--cls)`); a
// token, not a literal color.
const CLASS_COLOR_PROP = '--cls';
// The combat highlight class. dead / out-of-range are owned by the family's state
// classes; combat is the party-only extra (dead wins, so combat is off when dead).
const COMBAT_CLASS = 'combat';
// The container class that drops the frames below the target frame.
const BELOW_TARGET_CLASS = 'below-target';
// Badge visibility: '' reverts to the stylesheet display (shown), 'none' hides. The
// badges persist in the DOM and only their display toggles, so the icon cue survives
// forced-colors (where the combat box-shadow is dropped).
const BADGE_SHOWN = '';
const BADGE_HIDDEN = 'none';

/** What the pool needs from the Hud: the class-color resolver and the row actions. */
export interface PartyFramesPainterDeps {
  classCss: (cls: string) => string;
  onTarget: (pid: number) => void;
  onContextMenu: (pid: number, name: string, x: number, y: number) => void;
  onLeave: () => void;
  /** The localized "Leave Party" label, re-read each rebuild so an in-game language
   *  switch re-localizes it (through the elided setText). */
  leaveLabel: () => string;
  /** The shared aura view/painter deps every row's mini aura strip builds over
   *  (each row owns its own view + painter instance; the deps are the Hud's). */
  partyAuras: PartyRowAuraDeps;
}

export class PartyFramesPainter {
  // Active rows by member key (pid). One persistent node per key, reused across
  // rebuilds; the keyed pool this painter requires.
  private readonly pool = new Map<number, PartyRow>();
  // Detached rows kept for reuse (recycling a departed row to a new pid). The row's
  // listeners stay attached and read the live slot, so a recycled row is safe.
  private readonly free: PartyRow[] = [];
  private leaveBtn: HTMLButtonElement | null = null;
  // The leader-only master-loot control, owned by the Hud (built on its own
  // low-frequency footer signature) and handed to the pool for placement. It sits
  // between the member rows and the leave button, and persists across member-frame
  // rebuilds so its checkbox / dropdowns are never churned under the cursor.
  private masterControl: HTMLElement | null = null;
  // The last synced raid flag, so relocalize() can re-emit each pooled row's group
  // label in the new language after an in-game language switch (a switch does not flip
  // partyFrameSignature, so the Hud never re-syncs us, exactly like the badge tooltips).
  private lastRaid = false;
  private readonly rowDeps: PartyRowDeps;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly container: HTMLElement,
    private readonly deps: PartyFramesPainterDeps,
    // Injectable so a Node test can drive the pool without a DOM (the default builds
    // real rows in the browser); createPartyRow takes this doc, so injecting it is
    // enough to make row construction Node-safe.
    private readonly doc: Document = document,
  ) {
    this.rowDeps = { onTarget: deps.onTarget, onContextMenu: deps.onContextMenu };
  }

  /** Toggle the below-target offset on the container, every frame (cheap and elided),
   *  matching the inline `el.classList.toggle('below-target', ...)`. */
  setBelowTarget(on: boolean): void {
    this.writers.toggleClass(this.container, BELOW_TARGET_CLASS, on);
  }

  /** Set (or clear with null) the leader-only master-loot control. The Hud rebuilds
   *  the node only when its low-frequency footer signature changes, so this is not a
   *  per-frame call; we just keep the node in the DOM between the member rows and the
   *  leave button. A changed node replaces the old one in place; reconcileOrder keeps
   *  it positioned on later member rebuilds. */
  setMasterControl(el: HTMLElement | null): void {
    if (this.masterControl === el) return;
    if (this.masterControl) this.masterControl.remove();
    this.masterControl = el;
    if (el) {
      const leave = this.leaveBtn;
      if (leave && leave.parentNode === this.container) this.container.insertBefore(el, leave);
      else this.container.appendChild(el);
    }
  }

  /** Reconcile the pool to `members` and repaint each in place. Called only when the
   *  party signature changed (the Hud short-circuits an unchanged party before this),
   *  so the reconcile cost is paid only on a real change. */
  sync(members: PartyFrameMember[], leader: number, raid: boolean): void {
    this.lastRaid = raid;
    const next = new Set<number>();
    for (const m of members) next.add(m.pid);
    // Detach rows whose member left; keep them (listeners intact) for reuse.
    for (const [pid, row] of this.pool) {
      if (!next.has(pid)) {
        row.el.remove();
        this.free.push(row);
        this.pool.delete(pid);
      }
    }
    // Create / reuse a row per member and update it in place, in member order.
    const ordered: PartyRow[] = [];
    for (const m of members) {
      let row = this.pool.get(m.pid);
      if (!row) {
        row =
          this.free.pop() ??
          createPartyRow(this.doc, this.writers, this.rowDeps, m, this.deps.partyAuras);
        this.pool.set(m.pid, row);
      }
      // Update the LIVE slot BEFORE painting so the crest gate + listeners read the
      // current member, never a stale captured one (top-risk 3).
      row.slot.member = m;
      this.paintRow(row, m, leader, raid);
      ordered.push(row);
    }
    // Reconcile the DOM order with the MINIMUM number of node moves, then keep the
    // leave button last and re-localize its label (elided). A steady-state rebuild
    // (same members + order, only stats changed: the dominant raid-combat case)
    // performs ZERO node moves, so the keyed pool costs no per-rebuild DOM
    // relocation and a focused row keeps its focus. (Moving a node via
    // insertBefore/appendChild blurs it when it is the active element, which is why
    // the quest tracker re-focuses manually after a rebuild; re-appending every row
    // each frame would yank focus off a party row on every combat tick.)
    const leave = this.ensureLeaveButton();
    this.reconcileOrder(ordered, leave);
    this.writers.setText(leave, this.deps.leaveLabel());
  }

  // Walk the desired child sequence (the member rows in order, then the leave
  // button) against the container's current children, moving a node into place ONLY
  // when it is not already there. The standard keyed-list reconcile: O(N) compares
  // and exactly as many insertBefore moves as nodes that actually changed position
  // (zero when nothing moved). Departed rows were already detached in sync() and
  // new / recycled rows are detached, so every move here is a deliberate (re)insert
  // that restores member order; an unchanged order touches the DOM not at all. This
  // is the pooled-node ordering discipline the auras and FCT pools reuse.
  private reconcileOrder(rows: PartyRow[], leave: HTMLButtonElement): void {
    let ref: ChildNode | null = this.container.firstChild;
    const place = (node: ChildNode): void => {
      if (node === ref) {
        ref = ref.nextSibling;
      } else {
        this.container.insertBefore(node, ref);
      }
    };
    for (const row of rows) place(row.el);
    if (this.masterControl) place(this.masterControl);
    place(leave);
  }

  /** Re-localize every pooled and free row (the badge tooltips) plus the leave label
   *  after an in-game language switch. The keyed pool reuses row DOM and never
   *  rebuilds it, so the Hud calls this from refreshLocalizedDynamicUi (the
   *  woc:languagechange hook); without it the pooled tooltips would stay stale. */
  relocalize(): void {
    for (const row of this.pool.values()) {
      row.relocalize();
      // Re-emit the raid-group label in the new language (the badge tooltips relocalize
      // above; the group label needs the same treatment, from the live slot + last raid
      // flag, since a language switch does not flip partyFrameSignature).
      this.writers.setText(row.group, this.groupLabel(row.slot.member, this.lastRaid));
    }
    for (const row of this.free) row.relocalize();
    if (this.leaveBtn) this.writers.setText(this.leaveBtn, this.deps.leaveLabel());
  }

  /** Empty the frames (no party): detach every row + the leave button. Keeps the
   *  detached rows in the free list so a re-formed party reuses them. */
  clear(): void {
    for (const [pid, row] of this.pool) {
      row.el.remove();
      this.free.push(row);
      this.pool.delete(pid);
    }
    this.leaveBtn?.remove();
    this.masterControl?.remove();
    this.masterControl = null;
  }

  private paintRow(row: PartyRow, m: PartyFrameMember, leader: number, raid: boolean): void {
    // The class-color token + the combat class are the party-only writes the four
    // original writers cannot express (setStyleProp / toggleClass).
    this.writers.setStyleProp(row.el, CLASS_COLOR_PROP, this.deps.classCss(m.cls));
    const inCombat = !!m.inCombat && !m.dead;
    this.writers.toggleClass(row.el, COMBAT_CLASS, inCombat);
    // The shared frame (name / level / hp + resource fills / dead + out-of-range
    // classes) through the family instance, byte-faithful to the inline markup. The
    // family writes ONLY the level number into .lead-num now; the leader star is the
    // separate aria-hidden write below.
    row.painter.paint(
      unitFrameView({
        present: true,
        hpFrac: m.hp / Math.max(1, m.mhp),
        hpText: '',
        resourceKind: m.rtype,
        resFrac: m.res / Math.max(1, m.mres),
        resText: '',
        levelText: String(m.level),
        name: m.name,
        portraitKey: `${PARTY_CREST_KEY_PREFIX}${m.cls}`,
        absorb: null,
        dead: !!m.dead,
        outOfRange: m.oor,
      }),
    );
    // The leader star (aria-hidden, decorative) and the visually-hidden raid-group label,
    // both per-frame text routed through the elided writer (no raw write on the hot path);
    // each is cached, so a steady-state tick re-writes neither.
    this.writers.setText(row.leadStar, leader === m.pid ? PARTY_LEADER_GLYPH : '');
    this.writers.setText(row.group, this.groupLabel(m, raid));
    // The dead / combat / out-of-range badge icons: persistent, only display toggles
    // (the non-color cue that stays distinguishable under forced-colors).
    this.writers.setDisplay(row.badges.dead, m.dead ? BADGE_SHOWN : BADGE_HIDDEN);
    this.writers.setDisplay(row.badges.combat, inCombat ? BADGE_SHOWN : BADGE_HIDDEN);
    this.writers.setDisplay(row.badges.oor, m.oor ? BADGE_SHOWN : BADGE_HIDDEN);
    // The member's mini aura strip: the row's own keyed aura pool (writes elided
    // inside it). Signature-gated like the rest of this sync, never per frame.
    row.paintAuras(m.auras ?? []);
  }

  /** The localized "Group n" raid cue for a member, or '' outside raid. The group number
   *  goes through formatNumber (i18n digits). Used by paintRow and by relocalize (so a
   *  language switch re-emits it from the last synced raid flag). */
  private groupLabel(m: PartyFrameMember, raid: boolean): string {
    return raid
      ? t('hudChrome.unitFrame.partyGroup', {
          n: formatNumber(m.group, { maximumFractionDigits: 0 }),
        })
      : '';
  }

  private ensureLeaveButton(): HTMLButtonElement {
    if (!this.leaveBtn) this.leaveBtn = createLeaveButton(this.doc, this.deps.onLeave);
    return this.leaveBtn;
  }
}
