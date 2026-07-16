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
// re-parented in member order into a persistent .party-rows WRAPPER (their own element,
// one level under #party-frames), and the container's own direct children are ordered
// chip (mobile only), wrapper, master-loot control. The wrapper is what
// lets the mobile chip sit alone on its own line: with the rows nested inside it, no
// member frame can auto-flow beside the chip (the container's mobile column stacks chip,
// wrapper; the 2-column double-stack lives on the wrapper). The mobile
// row-styling rules key on .party-frame:first-of-type / :not(:first-of-type), which now
// resolve within the wrapper (only member rows live there); appendChild/insertBefore
// move a node without dropping its keyboard focus or its listeners.

import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { createPartyChip, type PartyChip } from './party_chip';
import { partyChipState } from './party_collapse';
import {
  createPartyRow,
  createPartyRowsWrapper,
  PARTY_CREST_KEY_PREFIX,
  PARTY_LEADER_GLYPH,
  type PartyRow,
  type PartyRowAuraDeps,
  type PartyRowDeps,
} from './party_frame_row';
import {
  type PartyFrameDisplayConfig,
  type PartyFrameMember,
  partyFrameHealthText,
  resolvePartyFrameStyle,
} from './party_frames';
import { unitFrameView } from './unit_frame';

// The class-color custom property the frame's name reads (`color: var(--cls)`); a
// token, not a literal color.
const CLASS_COLOR_PROP = '--cls';
// The combat highlight class. dead / out-of-range are owned by the family's state
// classes; combat is the party-only extra (dead wins, so combat is off when dead).
const COMBAT_CLASS = 'combat';
const HIDE_RESOURCE_CLASS = 'pf-hide-resource';
const HIDE_AURAS_CLASS = 'pf-hide-auras';
const THREAT_CLASS = 'threat';
const DISCONNECTED_CLASS = 'disconnected';
// The container class that drops the frames below the target frame.
const BELOW_TARGET_CLASS = 'below-target';
// The mobile collapse classes on #party-frames: the chip's presence (so CSS can
// style the container as a chip host) and the expanded state (so CSS reveals the
// member rows; collapsed hides them, leaving only the chip). Both are
// toggled through the elided writer only when the state changes (never per frame).
const CHIP_PRESENT_CLASS = 'has-party-chip';
const EXPANDED_CLASS = 'party-expanded';
const PARTY_PRESENT_CLASS = 'party-present';
const RAID_STYLE_CLASS = 'party-style-raid';
// The chip's aria-expanded attribute name/values (a disclosure control).
const ARIA_EXPANDED = 'aria-expanded';
const ARIA_TRUE = 'true';
const ARIA_FALSE = 'false';
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
  /** Hover tracking for Clique-style mouseover casts: pid on enter, null on leave. */
  onHover: (pid: number | null) => void;
  /** The localized "Party" chip caption, re-read each update so an in-game language
   *  switch re-localizes it (through the elided setText). Mobile only. */
  chipLabel: () => string;
  /** Toggle the persisted mobile collapse choice (the chip's tap). The Hud flips +
   *  persists its collapsed flag and re-drives setCollapse; a pure USER action, never
   *  gated on data-fx-level / reduce-motion / the governor (party HP is actionable). */
  onToggleCollapse: () => void;
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
  // The member-rows wrapper: every pooled row nests one level under #party-frames inside
  // this element, so the chip, the rows, the master-loot control, and Leave stack as a
  // simple column (the chip alone on its own line). On mobile the wrapper carries the
  // 2-column auto-flow grid the container used to; on desktop it is display:contents
  // (transparent), so the rows lay out in the #party-frames flex column exactly as before.
  // Built lazily on the first sync, then kept in the DOM (detached only by clear(), where
  // it is retained for reuse); reconcileOrder re-parents rows into it without node churn.
  private rowsWrapper: HTMLElement | null = null;
  // The mobile collapse chip, built lazily on the first mobile update and then kept
  // in the DOM (first child of the container) while in a party on mobile. Off mobile
  // it is never built (desktop party frames are unchanged). Its click toggles the
  // persisted collapse state through deps.onToggleCollapse.
  private chip: PartyChip | null = null;
  // The last-synced expanded flag, so relocalize() can re-emit the chip caption in
  // the new language after an in-game switch (a switch does not flip the collapse
  // state, so the Hud never re-drives setCollapse for it, like the group labels).
  private chipShown = false;
  // The leader-only master-loot control, owned by the Hud (built on its own
  // low-frequency footer signature) and handed to the pool for placement. It sits
  // after the member rows, and persists across member-frame
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
    this.rowDeps = {
      onTarget: deps.onTarget,
      onContextMenu: deps.onContextMenu,
      onHover: deps.onHover,
    };
  }

  /** Toggle the below-target offset on the container, every frame (cheap and elided),
   *  matching the inline `el.classList.toggle('below-target', ...)`. */
  setBelowTarget(on: boolean): void {
    this.writers.toggleClass(this.container, BELOW_TARGET_CLASS, on);
  }

  /**
   * Drive the mobile collapse chip from the current (in-party, mobile, collapsed,
   * chat-open) inputs, every frame (cheap and fully elided). On mobile in a party it
   * lazily builds the chip, keeps it as the container's first child, and toggles the
   * container's chip-present + expanded classes so CSS shows the chip and reveals or
   * hides the member rows; on desktop (or out of a party) the chip is
   * removed and the container carries neither class, so the desktop stack is exactly
   * as before. While the mobile chat overlay is open the party UI yields entirely (the
   * chip and frames hide), so the chat log / composer own the top-left; the persisted
   * collapse choice is untouched, so closing chat restores it. Every DOM effect routes
   * through the elided writers (class + attr + text), so a steady state (unchanged
   * inputs, the dominant case) writes nothing.
   */
  setCollapse(inParty: boolean, mobile: boolean, collapsed: boolean, chatOpen: boolean): void {
    const state = partyChipState({ inParty, mobile, collapsed, chatOpen });
    if (state.chipVisible) {
      const chip = this.ensureChip();
      this.chipShown = true;
      // The chip is placed first by reconcileOrder on the next sync; ensure it is in
      // the DOM now (a fresh chip on the first mobile update) so the class-driven
      // reveal has something to sit above even before a member rebuild.
      if (chip.el.parentNode !== this.container) {
        this.container.insertBefore(chip.el, this.container.firstChild);
      }
      this.writers.setText(chip.label, this.deps.chipLabel());
      this.writers.setAttr(chip.el, ARIA_EXPANDED, state.framesExpanded ? ARIA_TRUE : ARIA_FALSE);
    } else if (this.chip) {
      // Left the party or switched to desktop: drop the chip entirely.
      this.chip.el.remove();
      this.chipShown = false;
    }
    this.writers.toggleClass(this.container, CHIP_PRESENT_CLASS, state.chipVisible);
    // party-expanded is a MOBILE-only affordance class (it gates the mobile hide rule):
    // gate it on `mobile` so the desktop container stays pristine (no mobile classes),
    // even though the resolver reports framesExpanded=true on desktop (frames always
    // show there). On mobile it reflects the expanded state exactly.
    this.writers.toggleClass(this.container, EXPANDED_CLASS, state.framesExpanded && mobile);
  }

  private ensureChip(): PartyChip {
    if (!this.chip) this.chip = createPartyChip(this.doc, this.deps.onToggleCollapse);
    return this.chip;
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
    if (el) this.container.appendChild(el);
  }

  /** Reconcile the pool to `members` and repaint each in place. Called only when the
   *  party signature changed (the Hud short-circuits an unchanged party before this),
   *  so the reconcile cost is paid only on a real change. */
  sync(
    members: PartyFrameMember[],
    leader: number,
    raid: boolean,
    config?: PartyFrameDisplayConfig,
  ): void {
    this.writers.toggleClass(this.container, PARTY_PRESENT_CLASS, members.length > 0);
    this.writers.toggleClass(
      this.container,
      RAID_STYLE_CLASS,
      resolvePartyFrameStyle(config?.presentation ?? 0, raid) === 'raid',
    );
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
      this.paintRow(row, m, leader, raid, config);
      ordered.push(row);
    }
    // Reconcile the DOM order with the MINIMUM number of node moves. A steady-state rebuild
    // (same members + order, only stats changed: the dominant raid-combat case)
    // performs ZERO node moves, so the keyed pool costs no per-rebuild DOM
    // relocation and a focused row keeps its focus. (Moving a node via
    // insertBefore/appendChild blurs it when it is the active element, which is why
    // the quest tracker re-focuses manually after a rebuild; re-appending every row
    // each frame would yank focus off a party row on every combat tick.)
    this.reconcileOrder(ordered);
  }

  private ensureRowsWrapper(): HTMLElement {
    if (!this.rowsWrapper) this.rowsWrapper = createPartyRowsWrapper(this.doc);
    return this.rowsWrapper;
  }

  // Walk the desired child sequence against the current children, moving a node into
  // place ONLY when it is not already there. The standard keyed-list reconcile: O(N)
  // compares and exactly as many insertBefore moves as nodes that actually changed
  // position (zero when nothing moved). Departed rows were already detached in sync()
  // and new / recycled rows are detached, so every move here is a deliberate (re)insert
  // that restores member order; an unchanged order touches the DOM not at all. This is
  // the pooled-node ordering discipline the auras and FCT pools reuse.
  //
  // Two passes: (1) order the member rows INSIDE the rows wrapper (their own element,
  // so no member frame ever flows beside the container-level chip), then (2) order the
  // container's own direct children: the mobile chip first (when present, the collapse
  // header above the stack), the rows wrapper, the leader-only master-loot control, and
  // the master-loot control last. On desktop the chip is null and the wrapper is
  // display:contents, so the sequence renders as wrapper's rows, [master], exactly
  // the pre-wrapper order. A steady-state rebuild moves nothing in EITHER pass.
  private reconcileOrder(rows: PartyRow[]): void {
    const wrapper = this.ensureRowsWrapper();
    let rowRef: ChildNode | null = wrapper.firstChild;
    const placeRow = (node: ChildNode): void => {
      if (node === rowRef) {
        rowRef = rowRef.nextSibling;
      } else {
        wrapper.insertBefore(node, rowRef);
      }
    };
    for (const row of rows) placeRow(row.el);

    let ref: ChildNode | null = this.container.firstChild;
    const place = (node: ChildNode): void => {
      if (node === ref) {
        ref = ref.nextSibling;
      } else {
        this.container.insertBefore(node, ref);
      }
    };
    if (this.chip && this.chip.el.parentNode === this.container) place(this.chip.el);
    place(wrapper);
    if (this.masterControl) place(this.masterControl);
  }

  /** Re-localize every pooled and free row (the badge tooltips)
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
    // Re-emit the chip caption in the new language while it is shown (a language
    // switch does not flip the collapse state, so the Hud never re-drives
    // setCollapse for it, exactly like the pooled group labels above).
    if (this.chip && this.chipShown) {
      this.writers.setText(this.chip.label, this.deps.chipLabel());
    }
  }

  /** Empty the frames (no party): detach every row + the chip.
   *  Keeps the detached rows in the free list so a re-formed party reuses them. */
  clear(): void {
    for (const [pid, row] of this.pool) {
      row.el.remove();
      this.free.push(row);
      this.pool.delete(pid);
    }
    this.masterControl?.remove();
    this.masterControl = null;
    // Detach the (now empty) rows wrapper too, so a no-party container is truly empty and
    // not a lone wrapper box; the detached wrapper node is kept for reuse when a party
    // re-forms (the pooled rows are re-parented back into it by reconcileOrder).
    this.rowsWrapper?.remove();
    // Drop the chip and its container state classes: leaving a party must not leave a
    // stray chip or a lingering .party-expanded that would style a future desktop
    // stack. The chip node is kept for reuse if a party re-forms on mobile.
    this.chip?.el.remove();
    this.chipShown = false;
    this.writers.toggleClass(this.container, CHIP_PRESENT_CLASS, false);
    this.writers.toggleClass(this.container, EXPANDED_CLASS, false);
    this.writers.toggleClass(this.container, PARTY_PRESENT_CLASS, false);
    this.writers.toggleClass(this.container, RAID_STYLE_CLASS, false);
  }

  private paintRow(
    row: PartyRow,
    m: PartyFrameMember,
    leader: number,
    raid: boolean,
    config?: PartyFrameDisplayConfig,
  ): void {
    // The class-color token + the combat class are the party-only writes the four
    // original writers cannot express (setStyleProp / toggleClass).
    this.writers.setStyleProp(row.el, CLASS_COLOR_PROP, this.deps.classCss(m.cls));
    const inCombat = !!m.inCombat && !m.dead;
    this.writers.toggleClass(row.el, COMBAT_CLASS, inCombat);
    this.writers.toggleClass(row.el, THREAT_CLASS, !!m.hasAggro && !m.dead);
    this.writers.toggleClass(row.el, DISCONNECTED_CLASS, m.connected === 0);
    this.writers.toggleClass(row.el, HIDE_RESOURCE_CLASS, config?.showResource === false);
    this.writers.toggleClass(row.el, HIDE_AURAS_CLASS, config?.showAuras === false);
    // The shared frame (name / level / hp + resource fills / dead + out-of-range
    // classes) through the family instance, byte-faithful to the inline markup. The
    // family writes ONLY the level number into .lead-num now; the leader star is the
    // separate aria-hidden write below.
    row.painter.paint(
      unitFrameView({
        present: true,
        hpFrac: m.hp / Math.max(1, m.mhp),
        hpText: partyFrameHealthText(m.hp, m.mhp, config?.healthText ?? 1, (value, percent) =>
          formatNumber(value, percent ? { style: 'percent', maximumFractionDigits: 0 } : undefined),
        ),
        resourceKind: m.rtype,
        resFrac: m.res / Math.max(1, m.mres),
        resText: '',
        levelText: String(m.level),
        name: m.name,
        portraitKey: `${PARTY_CREST_KEY_PREFIX}${m.cls}`,
        absorb: config?.showAbsorbs === false ? null : { hp: m.hp, maxHp: m.mhp, total: m.absorb },
        dead: !!m.dead,
        outOfRange: m.oor,
      }),
    );
    const hpFrac = Math.max(0, Math.min(1, m.hp / Math.max(1, m.mhp)));
    const incomingFrac = Math.max(
      0,
      Math.min(1 - hpFrac, (m.incomingHeal ?? 0) / Math.max(1, m.mhp)),
    );
    this.writers.setStyleProp(row.incoming, '--incoming-start', `${(hpFrac * 100).toFixed(1)}%`);
    this.writers.setWidth(row.incoming, `${(incomingFrac * 100).toFixed(1)}%`);
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
    this.writers.setDisplay(row.badges.offline, m.connected === 0 ? BADGE_SHOWN : BADGE_HIDDEN);
    // The member's mini aura strip: the row's own keyed aura pool (writes elided
    // inside it). Signature-gated like the rest of this sync, never per frame.
    row.paintAuras(config?.showAuras === false ? [] : (m.auras ?? []));
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
}
