// The keyed-pool aura-strip painter (v0.16.0). It
// replaces the old renderAuras `__sig` cache + innerHTML wipe + per-rebuild
// attachTooltip (state.md Top risk 3) with a persistent per-aura node pool: one node
// per aura key (the aura id), reused across frames, its tooltip attached ONCE and
// reading a LIVE mutable record, data updated IN PLACE through the host's elided
// writers. Same painter, two instances: the player buff bar
// (#buff-bar) and the target strip (#tf-debuffs, mode 'all': buffs AND debuffs).
//
// TOP RISK 3 (the load-bearing correctness rule): the pooled record is a MUTABLE
// object. The tooltip closure attaches ONCE per node and reads `rec.name` / `rec.remaining`
// LIVE, never a captured aura value. Capture-by-value would go stale the moment the
// pool recycles that node to a different aura (the node would show the previous aura's
// name). So a recycle (aura A leaves, aura B reuses A's node) updates the record's
// fields and the same closure renders B. tests/auras_painter.test.ts pins this with a
// recycle A->B regression.
//
// WRITE ROUTING: every per-frame DOM write goes through
// the writer facet (setStyleProp for the icon, toggleClass for the debuff class,
// setText for the duration + stacks, setDisplay for the stacks badge visibility); no
// raw style / textContent / className / setAttribute. The only DOM construction (the
// node + its children) happens once per pooled node in createNode(); the icon data-URL
// is resolved only when an aura's icon key changes (the expensive part).
//
// ORDER: the active records are reconciled into the container with the minimum number
// of node moves (the reconcileOrder discipline), so a steady-state frame moves no
// nodes. The buff bar is `flex-wrap` row-reverse, so DOM order is the aura order.

import type { UiEffectsTier } from '../game/ui_effects_profile';
import { auraVisibleCap } from '../game/ui_tier_knobs';
import type { AurasState } from './auras_view';
import type { PainterHostWriters } from './painter_host';

// Class / property names the painter drives. Named, not inlined, so the painter
// references no bare DOM string literal.
const BUFF_CLASS = 'buff';
const DEBUFF_CLASS = 'debuff';
// Marks a node the local player may right-click to cancel (a helpful own buff). The
// stylesheet draws the affordance (context-menu cursor + hover border); the class is
// toggled per frame so a recycled node never keeps a stale affordance.
const CANCELABLE_CLASS = 'cancelable';
// Carries the debuff's magic school so the stylesheet tints the border per school
// (WoW-style poison/magic/curse reads); '' on a buff, so no school selector matches.
const SCHOOL_ATTR = 'data-school';
const DUR_CLASS = 'dur';
const STACKS_CLASS = 'stacks';
const BACKGROUND_IMAGE_PROP = 'background-image';
// Pool-key separator for same-id auras. The core keys a slot by the aura id, but one
// entity can legitimately carry several auras with the SAME id from different sources
// (the sim dedups by id+sourceId, sim.ts), and the online wire zeroes sourceId, so the
// id alone is NOT a unique pool key. When a base key repeats within a frame, the painter
// suffixes the running occurrence index after this separator so each duplicate keeps its
// own persistent node. Aura ids are lowercase identifiers (e.g. nythraxis_soul_rend,
// `${ability.id}_stun`), so '#' cannot collide with a real id.
const DUP_KEY_SEP = '#';
// The stacks badge persists in the DOM; only its display toggles. '' reverts to the
// stylesheet display (shown), 'none' hides it (byte-faithful to the old site, which
// appended the badge only when stacks > 1).
const STACKS_SHOWN = '';
const STACKS_HIDDEN = 'none';

/** What the pool needs from the Hud: the icon-URL resolver, the tooltip renderer, and
 *  the tooltip-attach helper. All injected so a Node test drives the pool without the
 *  icon/i18n runtime. */
export interface AurasPainterDeps {
  /** Resolve an icon key to a CSS background-image value (host: `url(${iconDataUrl(
   *  'aura', iconKey)})`). Called only when an aura's icon key changes. */
  resolveIconUrl(iconKey: string): string;
  /** Render the tooltip HTML from the LIVE aura name + remaining (host: the
   *  tt-title/tt-sub markup with esc + tPlural). Called lazily on hover, reading the
   *  pooled record's current fields. */
  renderTooltip(name: string, remaining: number, effectHtml: string): string;
  /** Attach a lazily-built tooltip to a node (host: Hud.attachTooltip). Called ONCE per
   *  pooled node; the closure reads the live record. */
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** Optional: attach the right-click-cancel handler to a pooled node ONCE (the painter
   *  never calls addEventListener itself; that listener churn is banned on the hot painter,
   *  exactly like the tooltip's attachTooltip). Supplied ONLY to the player buff-bar painter.
   *  `cancelableAuraId` is read live on right-click: it returns the aura id to cancel, or null
   *  when the node currently shows a debuff / non-cancelable aura (the host then no-ops). */
  attachCancel?(el: HTMLElement, cancelableAuraId: () => string | null): void;
}

/** One pooled aura node: the DOM refs plus the LIVE fields the tooltip closure reads.
 *  `name` / `remaining` are updated in place each frame and on recycle, so the
 *  once-attached closure always renders the aura the node currently shows. */
interface PooledAura {
  el: HTMLElement;
  dur: HTMLElement;
  stacks: HTMLElement;
  key: string;
  /** The logical aura id (the slot key's base), read live by the cancel contextmenu
   *  closure so a recycled node cancels the aura it currently shows, never a captured one. */
  auraId: string;
  /** Whether this node is currently a cancelable own-buff, read live by the cancel closure
   *  (a recycled buff->debuff node must not stay cancelable). */
  cancelable: boolean;
  name: string;
  remaining: number;
  /** The one-line effect summary HTML (or '' when the aura has no descriptor), read live
   *  by the tooltip closure alongside name/remaining. */
  effectHtml: string;
  /** The last icon key written, so the expensive data-URL resolve + write fire only on
   *  change. null until the first paint (never equals a real key). */
  lastIconKey: string | null;
  /** The frame stamp of the last paint that touched this record (the detach sweep
   *  recycles records not seen this frame). */
  seen: number;
}

export class AurasPainter {
  // Active records by aura key (the aura id). One persistent node per key, reused
  // across frames; the keyed pool this painter requires.
  private readonly pool = new Map<string, PooledAura>();
  // Detached records kept for reuse (recycling a departed aura's node to a new aura).
  // The node's tooltip closure stays attached and reads the live record, so a recycled
  // node is safe (Top risk 3).
  private readonly free: PooledAura[] = [];
  // Reused ordering scratch (cleared + refilled each paint), so a per-frame paint
  // allocates no new array.
  private readonly ordered: PooledAura[] = [];
  // Monotonic frame stamp for the detach sweep (cheaper than building a key Set each
  // frame). Wraps harmlessly: a record's stamp is rewritten every frame it is active.
  private frame = 0;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly container: HTMLElement,
    private readonly deps: AurasPainterDeps,
    // Injectable so a Node test can drive the pool without a global document.
    private readonly doc: Document = document,
    // The STATIC ui effects tier accessor (data-fx-level, never the FPS
    // governor). Read per paint to cap the visible aura count on low. Defaults to the
    // full tier so a painter built without it is untiered (uncapped, byte-faithful).
    private readonly getFxTier: () => UiEffectsTier = () => 'ultra',
  ) {}

  /** Reconcile the pool to this frame's active auras and repaint each in place. Runs
   *  every frame; the elided writers make an unchanged frame cost no DOM mutation. */
  paint(state: AurasState): void {
    this.frame++;
    const { slots, count } = state;
    // On low, cap the number of rendered auras; auras beyond the cap are
    // simply not touched this frame, so the recycle sweep below detaches them. The full
    // tiers return an infinite cap, so every active aura renders (the unchanged path).
    //
    // FAIRNESS: the cap sheds BUFF overflow only, never a DEBUFF. The
    // player buff bar is mode 'all' (buffs + debuffs interleaved in sim-application
    // order), and persistent raid buffs fill the front slots, so a flat first-N cap would
    // push a mid-combat boss/mob debuff (DoT / stun / curse) off-screen on low while every
    // other tier still shows it. With no self-dispel, that icon is the player's only read
    // of the debuff, so hiding it makes the game worse to play on low. A debuff is the
    // actionable half of the bar; a buff is cosmetic, so the budget is spent on buffs and a
    // debuff always renders: slot i is shown when it is a debuff OR fewer than `cap` auras
    // have rendered so far. When count <= cap (ALWAYS true on the full tiers, where cap is
    // +Infinity) every aura renders in order, byte-identical to the untiered painter.
    // Capping the render (not the view) keeps the parity-identical core untouched, so the
    // same selection applies under a Sim-shaped and a ClientWorld-mirror state. (Scope: a
    // debuff is anything the core flags isDebuff -- every allowlisted KIND in both worlds,
    // AND a negative-value buff_* stat-sap. The sap now classifies as a debuff online too
    // because the wire carries its negative value (server/game.ts sends it sparsely,
    // src/net/online.ts decodes it), so no sap can ride the low buff budget on either host.
    // See auras_view.isAuraDebuff.)
    const cap = auraVisibleCap(this.getFxTier());
    this.ordered.length = 0;
    let rendered = 0;
    for (let i = 0; i < count; i++) {
      const s = slots[i];
      if (!s.isDebuff && rendered >= cap) continue; // shed buff overflow; never a debuff
      rendered++;
      // Resolve the pool key. The common case (a unique aura id this frame) takes the
      // base key directly. If the base key is already claimed THIS frame, this is a
      // second (or later) aura sharing the ability id from a different source; probe
      // suffixed keys so each gets its own persistent node (byte-faithful to the old
      // one-div-per-aura render). The suffix is stable while the duplicate set is, so a
      // steady-state frame still moves no node; the no-duplicate path never concatenates.
      let key = s.key;
      let rec = this.pool.get(key);
      for (let dup = 1; rec && rec.seen === this.frame; dup++) {
        key = `${s.key}${DUP_KEY_SEP}${dup}`;
        rec = this.pool.get(key);
      }
      if (!rec) {
        rec = this.free.pop() ?? this.createNode();
        rec.key = key;
        this.pool.set(key, rec);
      }
      // Update the LIVE fields the tooltip reads BEFORE any DOM write, so a node
      // recycled to a different aura never renders the previous aura (Top risk 3).
      rec.name = s.name;
      rec.remaining = s.remaining;
      rec.auraId = s.key;
      rec.cancelable = s.cancelable;
      rec.effectHtml = s.effectHtml;
      rec.seen = this.frame;
      // Cancel affordance: only when this painter has an attachCancel dep (the player buff bar)
      // and the view marked the aura as cancelable. Read live by the contextmenu closure.
      rec.cancelable = !!this.deps.attachCancel && s.cancelable;
      // The icon: resolve the (expensive) data URL + write only when the key changes.
      if (rec.lastIconKey !== s.iconKey) {
        rec.lastIconKey = s.iconKey;
        this.writers.setStyleProp(
          rec.el,
          BACKGROUND_IMAGE_PROP,
          this.deps.resolveIconUrl(s.iconKey),
        );
      }
      // The buff/debuff distinction is a structural class (not an inline color); the
      // stylesheet renders it as a border the icon meaning does not depend on.
      this.writers.toggleClass(rec.el, DEBUFF_CLASS, s.isDebuff);
      this.writers.setAttr(rec.el, SCHOOL_ATTR, s.school);
      this.writers.toggleClass(rec.el, CANCELABLE_CLASS, rec.cancelable);
      this.writers.setText(rec.dur, s.durationText);
      const hasStacks = s.stacksText !== '';
      this.writers.setDisplay(rec.stacks, hasStacks ? STACKS_SHOWN : STACKS_HIDDEN);
      if (hasStacks) this.writers.setText(rec.stacks, s.stacksText);
      this.ordered.push(rec);
    }
    // Recycle records whose aura left this frame: detach to the free list (the node's
    // tooltip closure stays attached for reuse), so we never innerHTML-wipe. Iterate
    // `.values()` (not entries) and delete by the record's own `key`: a Map tolerates
    // deleting the current entry mid-iteration, and this avoids the per-entry [key, rec]
    // tuple the `for (const [k, v] of map)` form allocates every frame on this hot path.
    for (const rec of this.pool.values()) {
      if (rec.seen !== this.frame) {
        rec.el.remove();
        this.free.push(rec);
        this.pool.delete(rec.key);
      }
    }
    this.reconcileOrder();
  }

  /** Build one aura node (.buff > .dur + .stacks) and attach its tooltip ONCE. The
   *  closure reads the returned record's LIVE name/remaining, so it survives recycling
   *  (Top risk 3). */
  private createNode(): PooledAura {
    const el = this.doc.createElement('div');
    el.className = BUFF_CLASS;
    const dur = this.doc.createElement('div');
    dur.className = DUR_CLASS;
    el.appendChild(dur);
    const stacks = this.doc.createElement('div');
    stacks.className = STACKS_CLASS;
    el.appendChild(stacks);
    const rec: PooledAura = {
      el,
      dur,
      stacks,
      key: '',
      auraId: '',
      cancelable: false,
      name: '',
      remaining: 0,
      effectHtml: '',
      lastIconKey: null,
      seen: 0,
    };
    this.deps.attachTooltip(el, () =>
      this.deps.renderTooltip(rec.name, rec.remaining, rec.effectHtml),
    );
    // Right-click-cancel: attached ONCE per pooled node via the injected helper (the
    // buff-bar painter only). The closure reads the live record so a recycled node cancels
    // its current aura, and returns null unless the node currently shows a cancelable buff.
    this.deps.attachCancel?.(el, () => (rec.cancelable ? rec.auraId : null));
    return rec;
  }

  // Walk the desired child sequence (the active records in aura order) against the
  // container's current children, moving a node into place ONLY when it is not already
  // there. The standard keyed-list reconcile (the discipline the auras + FCT pools
  // share): O(N) compares and exactly as many insertBefore moves as nodes
  // that actually changed position (zero when nothing moved). Departed records were
  // already detached in paint(), and new / recycled records are detached, so every move
  // here is a deliberate (re)insert; an unchanged order touches the DOM not at all.
  private reconcileOrder(): void {
    let ref: ChildNode | null = this.container.firstChild;
    for (const rec of this.ordered) {
      if (rec.el === ref) {
        ref = ref.nextSibling;
      } else {
        this.container.insertBefore(rec.el, ref);
      }
    }
  }
}
