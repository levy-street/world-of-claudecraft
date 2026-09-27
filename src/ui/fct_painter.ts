// The pooled-div floating-combat-text (FCT) painter -- the per-frame HALF of the FCT
// split, filling in the seam already stood up (the pure fct_core descriptor + a
// dormant driver). It replaces the per-event createElement + setTimeout fct() in hud.ts
// with a FIXED-SIZE pre-allocated div ring: spawn() claims a free slot or evicts the
// oldest when the pool is full, and step() runs every frame from hud.update()
// to recycle each slot once its TTL elapses. The old path created a DOM node per combat
// event and leaned on setTimeout to remove it; under an AoE / boss burst that grew without
// bound. This ring caps the live node count at FCT_POOL_CAP and never allocates a node
// after construction.
//
// SCREEN-ANCHORED, byte-faithful to the old fct() and to classic-style combat text: spawn()
// projects the head anchor ONCE (renderer.worldToScreen + the getUiScale author-space
// divide), writes left / top a single time, and leaves the number at that screen position
// for its ~1.25s life while the CSS @keyframes float it straight up. It does NOT re-project
// per frame, so a number pops over the unit and rises in SCREEN space (it does not slide
// with the camera) -- exactly how the classic-era damage numbers read, and identical to
// the old fct(). step() therefore only ages out expired slots; there is no per-frame
// position write, so an unchanged frame costs nothing.
//
// WRITE ROUTING: every DOM write goes through the PainterHost
// write-elision facet -- setText for the number, toggleClass for the colour token + crit
// class, setStyleProp for left / top / animation. A node is shown purely by being attached
// (appendChild) and hidden by being detached (remove() on TTL recycle), so the spawn path
// makes no display write at all. A no-op frame costs no DOM mutation and the skip-rate holds.
// The per-kind colour moved off el.style.color
// onto a CSS class token keyed by the descriptor kind; the painter never names
// a hex (the colours live in hud.css's .fct-<token> rules). The crit rise stays on the
// .fct.crit CSS class (the crit keyframe rises -86px, the base -76px), never a descriptor
// distance, exactly as the fct_core comment requires.
//
// POOL-LIFECYCLE RULES (the load-bearing correctness, state.md Top risk 2):
//  - FIXED CAP: FCT_POOL_CAP nodes are pre-allocated in the constructor; spawn() never
//    calls createElement. At cap, spawn() EVICTS the oldest live entry (live[] is kept in
//    spawn order, so live[0] is the oldest) and reuses its node, so the live node count is
//    bounded by FCT_POOL_CAP forever.
//  - ANIMATION RESTART: a recycled node has already played its CSS rise; re-using it must
//    REPLAY the animation. A node off the free list was detached in an earlier frame's
//    step(), so re-appending it restarts the animation naturally (the browser observed the
//    disconnect). Only a same-tick EVICTED node is still attached when reused -- a same-tick
//    detach + re-append is an unobserved move that does NOT restart the animation -- so
//    spawn() forces the restart there with the reflow trick (animation:none -> read
//    offsetWidth -> restore), routed through the elided setStyleProp. Normal play never
//    evicts (the pool is far above a boss pull), so it pays no reflow; only a genuine
//    over-cap AoE burst does (and there it costs one forced reflow per eviction, bounded by
//    the burst size not the cap -- acceptable because real play never evicts, and the
//    low-tier concurrency cap + shorter TTL keep the eviction pressure bounded under load).
//  - FRAME-ORDERING CONTRACT (the natural-restart precondition): every spawn site MUST run
//    before step() within a frame. The live callers honour this -- hud.handleEvents() and
//    showSelfNote() both run before hud.update()'s step() in the same rAF tick -- so a node
//    freed by step() is never reused until the NEXT frame, guaranteeing the browser paints
//    between its detach and its re-append (which is what restarts its animation naturally). If
//    a future change ran step() before a same-frame spawn, a freed-then-reused node would skip
//    that natural restart and render invisible (the rise keyframes end at opacity 0, forwards).
//  - NO STALE CLOSURE: the painter holds no per-slot listener (FCT is decorative,
//    pointer-events:none), so the capture-by-value hazard cannot occur; the only
//    mutable slot state is read synchronously inside spawn() / step().
//
// BEAT STAGING (the one reason a floater is not spawned on the frame it arrives):
// an ability whose authored contacts land AFTER the cast tick that resolved them carries
// a delaySec on its spawn shape, and this painter holds the entry until that beat. Red
// Harvest is the case: the sim resolves all three weapon strikes on the cast tick, while
// the client plays the three blade contacts at FURY_AUDIO.red_harvest.times, so without
// staging all three numbers pop at once, ahead of every blade. The rules mirror the node
// pool's, for the same reasons:
//  - FIXED CAP: FCT_PENDING_CAP slots are pre-allocated and rewritten in place, so
//    holding allocates nothing; at the cap the oldest held entry is RELEASED immediately
//    rather than dropped (a number is never lost, it only arrives early).
//  - NO TIMER: held entries advance from the same step() the TTL recycle runs on, off the
//    frame clock hud.update() already passes. There is no setTimeout anywhere here.
//  - RELEASED, THEN DESCRIBED: a held entry claims no node and is neither described nor
//    projected until release, so the number appears over where the unit stands AT CONTACT,
//    and a behind-camera cull is decided then too.
//  - ORDERED BY BEAT: the queue is kept in due order, so two overlapping casts still
//    release their numbers in the order the blades actually land.
//  - DISPOSE CLEARS: a held entry references the entity it floats over, so dispose()
//    drops the queue and detaches the live nodes for a host that tears its painter
//    down (the tests, a future HUD teardown); the live HUD keeps one painter for the
//    page's life and never calls it.
// Only the FCT number is staged. Nothing a player reacts to (target HP, nameplates, cast
// bars, the combat log line) is delayed by any of this.
//
// ACCESSIBILITY: FCT divs are decorative transient text (not focusable,
// pointer-events:none, world-anchored over the 3D scene), so this painter introduces no
// focus trap and no announced text. Every pooled node is marked aria-hidden at build (see
// createNode below) so the raw per-hit numbers never reach the a11y tree. The coalesced,
// polite combat summary belongs to the #combat-live region, not these nodes. A
// follow-up resolved the FCT feed: the self-note kind (the one FCT-only event with NO
// combat-log line, e.g. "Can't move!") is now ALSO pushed into #combat-live from
// hud.showSelfNote, so an event the combat log never logs is still announced; the raw damage
// numbers are never streamed there (the throttled combat summary already covers them). The xp
// and rested-xp floats stay UNANNOUNCED through this painter on purpose: those events already
// emit a textual chat line via hud.log() (which the #chat-live region announces), so routing
// the float into a live region too would double-announce.

import { FURY_AUDIO } from '../game/fury_audio_core';
import type { UiEffectsTier } from '../game/ui_effects_profile';
import { fctMaxConcurrent, fctTtlScale } from '../game/ui_tier_knobs';
import {
  describeFct,
  type FctAnchorSource,
  type FctColorToken,
  type FctDescriptor,
  type FctEvent,
  type FctKind,
} from './fct_core';
import { type FctSpawnShape, type FctSpawnSource, fctSpawnShape } from './fct_event';
import { FctBeatStager, type FctBeatStrike } from './fct_stage_core';
import type { PainterHostWriters } from './painter_host';

/**
 * The projection the painter needs from the renderer: a world point -> the UNZOOMED
 * viewport point plus a behind-camera flag (renderer.worldToScreen's exact return shape,
 * {x, y, behind}). Injected so a Node test drives the pool without Three.js.
 */
export type FctProject = (
  x: number,
  y: number,
  z: number,
) => { x: number; y: number; behind: boolean };

/**
 * Max simultaneous on-screen floaters. Pre-allocated as DOM nodes in the constructor;
 * spawn() evicts the oldest once the pool is full. Chosen comfortably above a boss pull's
 * worth of simultaneous numbers so normal play never evicts, while a runaway AoE stays
 * bounded (the old createElement path had no ceiling at all).
 */
export const FCT_POOL_CAP = 64;

/**
 * Max floaters HELD for a later contact beat at once (see BEAT STAGING above). A hard
 * bound on a pre-allocated queue, like the node pool: at the cap the oldest held entry is
 * released immediately rather than dropped, so a number is never lost, it only arrives
 * early. Sized well above the real case (three strikes per cast, a handful of visible
 * casters) while staying far below the node pool it feeds.
 */
export const FCT_PENDING_CAP = 16;

/** Seconds to milliseconds: the beat table is authored in seconds, the frame clock is ms. */
const MS_PER_SEC = 1000;

/**
 * The anchor a FREE pending slot points at, so a released slot drops its reference to the
 * entity it was floating over instead of pinning it until the slot is next used.
 */
const FCT_EMPTY_ANCHOR: FctAnchorSource = { pos: { x: 0, y: 0, z: 0 }, scale: 1 };

// Class / style-property names the painter drives. Named (not inlined) so the painter
// references no bare DOM string magic and -- crucially -- no hex / px colour literal:
// the colours live in hud.css's .fct-<token> rules.
const FCT_BASE_CLASS = 'fct';
const FCT_CRIT_CLASS = 'crit';
// The colour token becomes the class `fct-<token>` (e.g. 'fct-heal'); hud.css maps each to
// the live hex. Deriving it from the token keeps the painter and the descriptor's token
// vocabulary (fct_core) in one place rather than duplicating an 11-row table.
const FCT_COLOR_CLASS_PREFIX = 'fct-';
const LEFT_PROP = 'left';
const TOP_PROP = 'top';
const ANIMATION_PROP = 'animation';
const ANIMATION_SUSPEND = 'none'; // suspend the CSS rise...
const ANIMATION_RESTORE = ''; // ...then restore the stylesheet animation to replay it.

function colorClass(token: FctColorToken): string {
  return `${FCT_COLOR_CLASS_PREFIX}${token}`;
}

/**
 * One pre-allocated pool slot. `node` is permanent; the rest is rewritten on each spawn.
 * `colorClass` is the colour class currently applied to the node, tracked so a reuse toggles
 * the previous one off before the new one on (toggleClass elides per (element, class), so the
 * painter must turn the old class off explicitly). `bornAt` + `ttlMs` drive the TTL recycle.
 * live[] is kept in spawn order, so the array position (not a stored counter) is the FIFO key.
 */
interface FctSlot {
  readonly node: HTMLElement;
  colorClass: string | null;
  bornAt: number;
  ttlMs: number;
}

/**
 * One pre-allocated HELD floater: an FctEvent whose fields are rewritten in place (so
 * holding allocates nothing) plus the frame-clock instant it is due. It is deliberately
 * FctEvent-shaped, because releasing it is just the ordinary spawn path with the slot
 * passed as the event.
 */
interface FctPending {
  kind: FctKind;
  text: string;
  target: FctAnchorSource;
  crit: boolean;
  isSelf: boolean;
  dueAt: number;
}

export class FctPainter {
  // Free slots (detached nodes ready to reuse). A slot is in exactly one of free / live.
  private readonly free: FctSlot[] = [];
  // Live slots in spawn order: new spawns append, TTL / eviction removes while preserving
  // order, so live[0] is always the oldest -> the eviction victim.
  private readonly live: FctSlot[] = [];
  // Free held-entry slots, and the entries currently waiting for their beat, kept in
  // dueAt order so releases always run in beat order (see insertPending).
  private readonly pendingFree: FctPending[] = [];
  private readonly pending: FctPending[] = [];
  // The per-frame strike-ordinal tracker, fed the ONE authored beat table (src/game
  // owns it; the pure core takes it injected so it stays game-layer-free).
  private readonly beats = new FctBeatStager(FURY_AUDIO.red_harvest.times);
  private readonly random: () => number;
  // The pre-allocated pool size. On the full tiers this is also the live cap, so eviction
  // fires only at pool-full (the pre-tiering behavior); on low fctMaxConcurrent caps the
  // live count tighter.
  private readonly cap: number;
  // The STATIC ui effects tier accessor (reads data-fx-level, written only by the
  // preset applier, NEVER the FPS governor: the two-controller hazard). Read per spawn
  // (event-driven, not a per-frame cost) to tier the live-cap / TTL knobs.
  private readonly getFxTier: () => UiEffectsTier;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly mount: HTMLElement,
    private readonly project: FctProject,
    private readonly getScale: () => number,
    opts: {
      cap?: number;
      pendingCap?: number;
      doc?: Document;
      random?: () => number;
      getFxTier?: () => UiEffectsTier;
    } = {},
  ) {
    const {
      cap = FCT_POOL_CAP,
      pendingCap = FCT_PENDING_CAP,
      doc = document,
      random = Math.random,
      // Default to the full tier so a painter built without the accessor (e.g. a Node
      // test) is untiered (byte-faithful to the pre-tiering behavior).
      getFxTier = () => 'ultra' as UiEffectsTier,
    } = opts;
    this.cap = cap;
    this.getFxTier = getFxTier;
    // Math.random for the horizontal jitter is allowed on the PAINTER (not the pure core);
    // a test injects a deterministic draw.
    this.random = random;
    for (let i = 0; i < cap; i++) {
      const node = doc.createElement('div');
      node.className = FCT_BASE_CLASS;
      // Honest boundary: FCT floaters are decorative, world-anchored transient
      // text over the 3D scene (not screen-readable). Mark each pooled node aria-hidden
      // once at build so the raw per-hit numbers never leak into the a11y tree; the
      // coalesced summary belongs to the #combat-live region, not these nodes.
      node.setAttribute('aria-hidden', 'true');
      this.free.push({ node, colorClass: null, bornAt: 0, ttlMs: 0 });
    }
    // Held-entry slots are pre-allocated the same way, so a beat-staged floater costs
    // no object on the event path either.
    for (let i = 0; i < pendingCap; i++) {
      this.pendingFree.push({
        kind: 'self-note',
        text: '',
        target: FCT_EMPTY_ANCHOR,
        crit: false,
        isSelf: false,
        dueAt: 0,
      });
    }
  }

  /**
   * Resolve the spawn shape for a damage occasion (fct_event owns that discrimination)
   * and stamp the authored contact BEAT this strike belongs to onto it, so the spawn
   * sites carry the delay with the rest of the shape. The ordinal is consumed even when
   * the shape is null (a hit between two other entities floats nothing), so a later
   * strike of the same cast still lands on its own beat rather than sliding forward.
   */
  stagedShape(strike: FctBeatStrike, now: number, src: FctSpawnSource): FctSpawnShape | null {
    const delaySec = this.beats.delaySec(strike, now);
    const shape = fctSpawnShape(src);
    if (shape === null || delaySec <= 0) return shape;
    return { ...shape, delaySec };
  }

  /**
   * Spawn a floater for `event` at frame clock `now`, or HOLD it when the event carries a
   * `delaySec` (an authored contact beat: see BEAT STAGING above). A held entry claims no
   * node and is not described or projected until it is released, so the number appears over
   * where the unit is AT CONTACT rather than where it stood on the cast tick.
   */
  spawn(event: FctEvent, now: number): void {
    const delayMs = (event.delaySec ?? 0) * MS_PER_SEC;
    if (delayMs > 0) {
      this.hold(event, now, now + delayMs);
      return;
    }
    this.spawnNow(event, now);
  }

  /**
   * The undelayed spawn: builds the pure descriptor with an injected jitter draw, projects
   * the head anchor ONCE and behind-culls exactly as the live fct() did (no slot claimed if
   * behind), claims a free slot or evicts the oldest, writes the text + colour / crit
   * classes, positions the node in author space, attaches it, and (only when an attached
   * node was evicted) replays the CSS rise.
   */
  private spawnNow(event: FctEvent, now: number): void {
    const tier = this.getFxTier();
    // Every FCT floater is spawned on every tier: the low preset sheds FCT cost purely
    // through the bounded pool (a tighter live cap + a shorter TTL below), never by refusing
    // to spawn a damage number. Refusing non-crit damage used to hide the player's own hits
    // on their target -- their primary combat feedback -- so low is no longer allowed to drop
    // it. Crit EMPHASIS on low (the scale/pop) is still shed by the separate CSS gate
    // ([data-fx-level="low"] .fct.crit); that keeps the number, only dropping the pop.
    const d = describeFct(event, this.random());
    const v = this.project(d.anchor.x, d.anchor.y, d.anchor.z);
    if (v.behind) return; // faithful to the live `if (v.behind) return;` -- waste no slot.
    // Claim a slot honoring the tier's live cap. At the cap, evict the OLDEST live entry
    // (live[0]); an evicted node is still attached and needs the forced restart, while a
    // free node was detached in an earlier frame so re-appending restarts its CSS rise
    // naturally. On the full tiers maxConcurrent == this.cap (the pool size), so when the
    // cap is reached the free list is already empty and this is byte-identical to the
    // pre-tiering "free.pop() ?? live.shift()" pool-full eviction.
    const maxConcurrent = fctMaxConcurrent(tier, this.cap);
    let slot: FctSlot;
    let evicted: boolean;
    if (this.live.length >= maxConcurrent) {
      slot = this.live.shift() as FctSlot;
      evicted = true;
    } else {
      const freeSlot = this.free.pop();
      if (freeSlot !== undefined) {
        slot = freeSlot;
        evicted = false;
      } else {
        slot = this.live.shift() as FctSlot;
        evicted = true;
      }
    }
    slot.bornAt = now;
    // Low shortens the lifetime so floaters clear faster (lower live count, less eviction
    // pressure); the full tier scale is exactly 1, so 1250 * 1 = 1250 is byte-identical.
    slot.ttlMs = d.ttlMs * fctTtlScale(tier);
    this.applyContent(slot, d);
    this.position(slot.node, v, d.jitterOffset, this.getScale());
    this.mount.appendChild(slot.node); // a detached node becomes visible on attach...
    if (evicted) this.restartAnimation(slot.node); // ...an evicted (attached) one needs the restart.
    this.live.push(slot);
  }

  /**
   * Advance every live floater one frame: recycle the ones whose TTL elapsed. Runs from
   * hud.update()'s every-frame tier (no second rAF). The number is screen-frozen
   * (spawn positioned it once), so there is NO per-frame position write -- step() only ages
   * out slots. An empty pool returns immediately, so the no-combat steady state holds the
   * perf gate by construction.
   */
  step(now: number): void {
    // Held floaters are released BEFORE the TTL walk, never after. The FRAME-ORDERING
    // CONTRACT above requires every spawn of a frame to run ahead of that frame's
    // recycling: a node this walk frees and a release then reused would be a same-tick
    // detach + re-append, which does not restart the CSS rise and renders invisible.
    this.releaseDue(now);
    if (this.live.length === 0) return;
    // Reverse walk so splicing an expired slot does not skip its neighbour.
    for (let i = this.live.length - 1; i >= 0; i--) {
      const slot = this.live[i];
      if (now - slot.bornAt >= slot.ttlMs) {
        slot.node.remove();
        this.live.splice(i, 1);
        this.free.push(slot);
      }
    }
  }

  /** Live floater count -- the bound the perf-gate AoE burst asserts never exceeds the cap. */
  liveCount(): number {
    return this.live.length;
  }

  /** Floaters currently HELD for a later contact beat (bounded by the pending cap). */
  heldCount(): number {
    return this.pending.length;
  }

  /**
   * Tear down: drop every held floater and detach every live node, returning both pools
   * to their free lists. A held entry keeps a reference to the entity it floats over, so
   * clearing is what stops a disposed painter from pinning the world it was showing; and a
   * delayed number must never arrive after the HUD that asked for it is gone.
   */
  dispose(): void {
    while (this.pending.length > 0) this.recyclePending(this.pending.pop() as FctPending);
    this.beats.reset();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const slot = this.live[i];
      slot.node.remove();
      this.free.push(slot);
    }
    this.live.length = 0;
  }

  // --- internals ---

  /**
   * Hold `event` until `dueAt`, copying its fields into a pre-allocated slot (no per-event
   * allocation). At the cap the OLDEST held entry is released immediately rather than
   * dropped: a number the player earned is never lost to a queue bound, it only arrives
   * ahead of its beat.
   */
  private hold(event: FctEvent, now: number, dueAt: number): void {
    let slot = this.pendingFree.pop();
    if (slot === undefined) {
      slot = this.pending.shift() as FctPending;
      this.spawnNow(slot, now);
    }
    slot.kind = event.kind;
    slot.text = event.text;
    slot.target = event.target;
    slot.crit = event.crit;
    slot.isSelf = event.isSelf;
    slot.dueAt = dueAt;
    this.insertPending(slot);
  }

  /**
   * Insert a held slot in dueAt order, by shifting references over a tiny array (nothing
   * allocated). Order matters because two casts can overlap: a later frame's FIRST beat
   * can fall due before an earlier frame's LAST one, and releases must still run in the
   * order the beats actually land.
   */
  private insertPending(slot: FctPending): void {
    let i = this.pending.length;
    this.pending.push(slot);
    while (i > 0 && this.pending[i - 1].dueAt > slot.dueAt) {
      this.pending[i] = this.pending[i - 1];
      this.pending[i - 1] = slot;
      i--;
    }
  }

  /** Spawn every held floater whose beat has arrived, in beat order. */
  private releaseDue(now: number): void {
    while (this.pending.length > 0 && this.pending[0].dueAt <= now) {
      const slot = this.pending.shift() as FctPending;
      this.spawnNow(slot, now);
      this.recyclePending(slot);
    }
  }

  /** Return a held slot to the free list, dropping its text and entity reference. */
  private recyclePending(slot: FctPending): void {
    slot.text = '';
    slot.target = FCT_EMPTY_ANCHOR;
    this.pendingFree.push(slot);
  }

  /** Text + colour-token class + crit class, all through the elided writers. Switches the
   *  colour class by toggling the previous one off and the new one on (so a recycled node
   *  never keeps a stale colour). */
  private applyContent(slot: FctSlot, d: FctDescriptor): void {
    this.writers.setText(slot.node, d.text);
    const cls = colorClass(d.colorToken);
    if (slot.colorClass !== cls) {
      if (slot.colorClass !== null) this.writers.toggleClass(slot.node, slot.colorClass, false);
      this.writers.toggleClass(slot.node, cls, true);
      slot.colorClass = cls;
    }
    this.writers.toggleClass(slot.node, FCT_CRIT_CLASS, d.crit);
  }

  /** Position via left / top in author space: (projected x + jitter) / uiScale and
   *  y / uiScale, written ONCE at spawn. EXACTLY the live fct() formula -- the getUiScale
   *  divide is load-bearing because worldToScreen returns the UNZOOMED viewport point while
   *  #ui is scaled by `zoom`, so an undivided write mispositions whenever uiScale != 1. */
  private position(
    node: HTMLElement,
    v: { x: number; y: number },
    jitterOffset: number,
    scale: number,
  ): void {
    this.writers.setStyleProp(node, LEFT_PROP, `${(v.x + jitterOffset) / scale}px`);
    this.writers.setStyleProp(node, TOP_PROP, `${v.y / scale}px`);
  }

  /** Replay the CSS rise on a same-tick EVICTED (still-attached) node. A same-tick detach +
   *  re-append does NOT restart a CSS animation, so force it: set animation:none, read
   *  offsetWidth to flush the 'none', then restore the stylesheet animation. Both writes route
   *  through the elided setStyleProp; the offsetWidth read is the only direct DOM touch and is
   *  what forces the reflow. Free / TTL-recycled nodes restart on re-append, so this is not
   *  called for them -- normal play pays no reflow. */
  private restartAnimation(node: HTMLElement): void {
    this.writers.setStyleProp(node, ANIMATION_PROP, ANIMATION_SUSPEND);
    void node.offsetWidth;
    this.writers.setStyleProp(node, ANIMATION_PROP, ANIMATION_RESTORE);
  }
}
