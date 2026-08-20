// Per-frame ADMISSION budget and learned COST LEDGER for post-curtain GPU
// preparation work (shader link submissions, program touches, texture chunk
// uploads, bounded first draws).
//
// Why this exists, stated as the defect it removes. background_gpu_queue.ts
// arbitrates ORDER: which lane's unit runs next. Nothing arbitrates AMOUNT.
// Once the curtain is up the queue keeps handing units to the main thread at
// whatever rate they arrive, so a burst of preparation lands inside live frames
// and the frame-gap numbers the queue reports are the post-mortem of a decision
// nobody made. This core is that decision: given what the last frames cost and
// what this KIND of piece has historically cost, is there room for it in the
// frame that is about to be drawn.
//
// The ledger half is what makes the admission half honest. A predicted cost per
// kind (the label prefix, so 'reveal-gate:eastbrookBuilding:3' and
// 'reveal-gate:tavern:1' share one estimate) is learned from what actually ran,
// because the same piece costs wildly different milliseconds on an iGPU and a
// discrete card and no constant can stand in for both.
//
// Three properties are deliberate. It is CLOCK-FREE: the host passes the frame
// duration it measured, so a test drives the whole policy with plain numbers
// and the determinism rules hold for free. It NEVER blocks: no timers, no
// promises, no queue of its own; the caller asks and acts on the answer. And it
// never withholds ACTIONABLE work: a budget that can delay something a player
// reacts to is a fairness defect, not a pacing win, so the actionable floor is
// the first rule and no configuration can switch it off.
import { GPU_WORK_PRIORITY } from './background_gpu_queue';

/** How much a piece of preparation is allowed to cost a live frame, by what
 *  seeing it late would cost the player. */
export type GpuPrepClass = 'actionable' | 'visible' | 'approaching' | 'cosmetic';

/**
 * Map a queue priority onto its admission class.
 *
 * Read against GPU_WORK_PRIORITY rather than the raw numbers, and read INSIDE
 * the function on purpose: background_gpu_queue.ts imports this module, so a
 * module-level constant derived from GPU_WORK_PRIORITY would evaluate while the
 * queue is still initializing and hit the temporal dead zone.
 */
export function gpuPrepClassForPriority(priority: number): GpuPrepClass {
  if (!Number.isFinite(priority)) return 'cosmetic';
  if (priority >= GPU_WORK_PRIORITY.ACTIONABLE_VIEW) return 'actionable';
  if (priority >= GPU_WORK_PRIORITY.LIVE_VIEW) return 'visible';
  // BOOT_DEBT sits with VISIBLE_PREWARM rather than with the cosmetic warmers:
  // unpaid link debt surfaces as a first-draw stall in a live frame, so it is
  // work the player is about to arrive at, not work for its own sake. A gate's
  // tail pieces queue BELOW the debt (a piece finishes a link, a submission
  // starts one) but are the same kind of work: approaching, never cosmetic.
  if (priority >= GPU_WORK_PRIORITY.BOOT_DEBT) return 'approaching';
  if (priority === GPU_WORK_PRIORITY.TAIL_PIECE) return 'approaching';
  return 'cosmetic';
}

/**
 * Whether an ARRIVAL CURTAIN admits this candidate. The cover has no live
 * frame to protect, so it used to admit everything, and that is what starved
 * the arrival: measured at an online entry, a full second of free admission
 * drained the boot-debt resume lane at full speed and not one piece of an
 * imminent reveal key ever ran (0 of 1 ready on every band, 0 of 12 on the
 * town). Under a cover the frames belong to what the camera LANDED AMONG, so
 * the debt and background lanes wait: BOOT_RESUME, BACKGROUND and BOOT_DEBT
 * are refused, and everything from TAIL_PIECE up is admitted (a gate's tail
 * pieces are what a held key needs to settle, so refusing them would defeat
 * the whole arrangement). A candidate with no usable priority is admitted,
 * which is the cover's historical answer.
 */
export function gpuPrepCoverAdmits(priority: number | undefined): boolean {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) return true;
  if (priority === GPU_WORK_PRIORITY.TAIL_PIECE) return true;
  return priority >= GPU_WORK_PRIORITY.VISIBLE_PREWARM;
}

/** Longest kind key retained. A label is caller-supplied, so the ledger's key
 *  space is bounded here rather than trusted. */
const MAX_KIND_LENGTH = 48;

/** Distinct kinds the ledger stores. Past this, a new kind still gets a
 *  prediction (the unknown prior) but no slot, so a caller minting unique
 *  labels can never grow the map without bound. */
const MAX_KINDS = 64;

const UNLABELED_KIND = 'unlabeled';

/** The KIND of a piece: the label prefix up to the first ':'. Callers label
 *  units per instance ('reveal-gate:eastbrookBuilding:3'); costs are learned
 *  per family. */
export function gpuPrepKindOfLabel(label: string): string {
  if (typeof label !== 'string') return UNLABELED_KIND;
  const colon = label.indexOf(':');
  const head = (colon >= 0 ? label.slice(0, colon) : label).trim();
  if (head.length === 0) return UNLABELED_KIND;
  return head.length > MAX_KIND_LENGTH ? head.slice(0, MAX_KIND_LENGTH) : head;
}

export interface GpuPrepBudgetConfig {
  /** The tier's frame target, derived by the host. The core never assumes a
   *  refresh rate: a 30 fps tier budget and a 120 Hz one are the same policy
   *  with a different target. */
  targetFrameMs: number;
  /** Headroom kept for preparation even when the measured frame already
   *  overruns the target. Without it a machine that never hits its target
   *  would admit nothing forever, which is exactly the machine carrying the
   *  most preparation debt. */
  minSliceMs: number;
  /** The floor's share of a frame that already overruns the target: a machine
   *  running 40 ms frames still gives preparation this fraction of each frame
   *  (max with minSliceMs), because starving preparation on a slow frame does
   *  not make the frame faster and only pushes the debt to a first draw. */
  overrunSliceShare: number;
  /** A candidate deferred this many frames is admitted regardless of headroom
   *  or pressure. The starvation bound: pacing may delay a piece, never drop
   *  it. Applies to the approaching class; the visible class has the per-frame
   *  progress rule below and the cosmetic class its own longer bound. */
  maxDeferFrames: number;
  /** The cosmetic starvation bound. Long on purpose: a cosmetic piece that
   *  cannot fit (a whole preview warm on a slow machine) should wait for a
   *  quiet frame rather than be forced into a busy one every half second. */
  cosmeticMaxDeferFrames: number;
  /** Predicted cost of a kind with no sample yet. Pessimistic on purpose: an
   *  unmeasured kind is admitted on the first-sample slot below, not on a
   *  flattering guess. */
  unknownCostMs: number;
  /** Blend weight of a new cost sample. */
  emaAlpha: number;
  /** Blend weight of a new frame duration. Lower than emaAlpha: frame times
   *  are the noisier signal, and one GC frame must not shut the lane. */
  frameEmaAlpha: number;
}

export const DEFAULT_GPU_PREP_BUDGET_CONFIG: GpuPrepBudgetConfig = {
  targetFrameMs: 1000 / 60,
  minSliceMs: 1.5,
  overrunSliceShare: 0.12,
  maxDeferFrames: 30,
  cosmeticMaxDeferFrames: 240,
  unknownCostMs: 4,
  emaAlpha: 0.3,
  frameEmaAlpha: 0.2,
};

export interface GpuPrepAdmitInput {
  kind: string;
  cls: GpuPrepClass;
  /** Frames this candidate has already been refused, counted by the caller. */
  deferredFrames: number;
  /** An arrival curtain covers the world: the cover rule below decides, and
   *  the frame budget is not consulted at all. */
  cover?: boolean;
  /** The candidate's queue priority. Read only by the cover rule
   *  (gpuPrepCoverAdmits); the ordinary path decides on `cls`. */
  priority?: number;
}

export type GpuPrepAdmitReason =
  | 'actionable-floor'
  | 'fits'
  | 'progress'
  | 'starvation'
  | 'legacy'
  | 'first-sample'
  | 'cover'
  | 'no-headroom'
  | 'unknown-cap'
  | 'pressure'
  | 'cover-not-arrival';

export type GpuPrepAdmitDecision =
  | {
      admit: true;
      reason:
        | 'actionable-floor'
        | 'fits'
        | 'progress'
        | 'starvation'
        | 'legacy'
        | 'first-sample'
        | 'cover';
      predictedMs: number;
    }
  | {
      admit: false;
      reason: 'no-headroom' | 'unknown-cap' | 'pressure' | 'cover-not-arrival';
      predictedMs: number;
      headroomMs: number;
    };

export interface GpuPrepKindStat {
  kind: string;
  emaMs: number;
  samples: number;
}

export interface GpuPrepBudgetSnapshot {
  frameEmaMs: number;
  headroomMs: number;
  spentThisFrameMs: number;
  legacy: boolean;
  degrading: boolean;
  /** Costliest kind first, so the readout leads with what pacing is deciding
   *  about. */
  kinds: GpuPrepKindStat[];
  decisions: Record<GpuPrepAdmitReason, number>;
}

export interface GpuPrepBudget {
  /** The last rendered frame's duration. Opens a new frame: the frame's spend
   *  and its first-sample slot both reset here. The optional target is the
   *  tier's live drop-frame threshold: GFX is REASSIGNED on a tier change, so
   *  a target captured once at construction leaves a session pacing against
   *  the tier it booted on. Junk values keep the current target. */
  noteFrame(frameMs: number, targetFrameMs?: number): void;
  /** The frame governor's pressure. While degrading, cosmetic candidates
   *  defer; actionable and visible work is never touched by it. */
  notePressure(degrading: boolean): void;
  headroomMs(): number;
  predictMs(kind: string): number;
  record(kind: string, syncMs: number): void;
  admit(input: GpuPrepAdmitInput): GpuPrepAdmitDecision;
  /** Charge the current frame after a piece ran, so a second piece in the same
   *  frame sees the smaller headroom it actually has. */
  spend(ms: number): void;
  /** Kill switch: admit everything, keep learning. */
  setLegacy(on: boolean): void;
  snapshot(): GpuPrepBudgetSnapshot;
}

interface KindLedger {
  emaMs: number;
  samples: number;
}

const positiveMs = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const alpha = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;

const frameCount = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;

const share = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function createGpuPrepBudget(config?: Partial<GpuPrepBudgetConfig>): GpuPrepBudget {
  const defaults = DEFAULT_GPU_PREP_BUDGET_CONFIG;
  const cfg: GpuPrepBudgetConfig = {
    targetFrameMs: positiveMs(config?.targetFrameMs, defaults.targetFrameMs),
    minSliceMs: positiveMs(config?.minSliceMs, defaults.minSliceMs),
    overrunSliceShare: share(config?.overrunSliceShare, defaults.overrunSliceShare),
    maxDeferFrames: frameCount(config?.maxDeferFrames, defaults.maxDeferFrames),
    cosmeticMaxDeferFrames: frameCount(
      config?.cosmeticMaxDeferFrames,
      defaults.cosmeticMaxDeferFrames,
    ),
    unknownCostMs: positiveMs(config?.unknownCostMs, defaults.unknownCostMs),
    emaAlpha: alpha(config?.emaAlpha, defaults.emaAlpha),
    frameEmaAlpha: alpha(config?.frameEmaAlpha, defaults.frameEmaAlpha),
  };
  const kinds = new Map<string, KindLedger>();
  const decisions: Record<GpuPrepAdmitReason, number> = {
    'actionable-floor': 0,
    fits: 0,
    progress: 0,
    starvation: 0,
    legacy: 0,
    'first-sample': 0,
    cover: 0,
    'no-headroom': 0,
    'unknown-cap': 0,
    pressure: 0,
    'cover-not-arrival': 0,
  };
  // Before a single frame is measured, assume the frame is already spending its
  // whole target: preparation then starts from the minSliceMs floor and grows
  // as evidence arrives, rather than spending a budget nobody has observed.
  let frameEmaMs = cfg.targetFrameMs;
  let frameSamples = 0;
  let spentThisFrameMs = 0;
  let firstSampleUsedThisFrame = false;
  let progressUsedThisFrame = false;
  let degrading = false;
  let legacy = false;

  const headroom = (): number => {
    const floor = Math.max(cfg.minSliceMs, frameEmaMs * cfg.overrunSliceShare);
    const slice = Math.max(floor, cfg.targetFrameMs - frameEmaMs) - spentThisFrameMs;
    return slice > 0 ? slice : 0;
  };
  const ledgerOf = (kind: string): KindLedger | undefined => kinds.get(gpuPrepKindOfLabel(kind));
  const predict = (kind: string): number => ledgerOf(kind)?.emaMs ?? cfg.unknownCostMs;
  const admitted = (
    reason:
      | 'actionable-floor'
      | 'fits'
      | 'progress'
      | 'starvation'
      | 'legacy'
      | 'first-sample'
      | 'cover',
    predictedMs: number,
  ): GpuPrepAdmitDecision => {
    decisions[reason]++;
    return { admit: true, reason, predictedMs };
  };
  const deferred = (
    reason: 'no-headroom' | 'unknown-cap' | 'pressure' | 'cover-not-arrival',
    predictedMs: number,
  ): GpuPrepAdmitDecision => {
    decisions[reason]++;
    return { admit: false, reason, predictedMs, headroomMs: headroom() };
  };

  return {
    noteFrame(frameMs: number, targetFrameMs?: number): void {
      if (
        typeof targetFrameMs === 'number' &&
        Number.isFinite(targetFrameMs) &&
        targetFrameMs > 0
      ) {
        cfg.targetFrameMs = targetFrameMs;
      }
      spentThisFrameMs = 0;
      firstSampleUsedThisFrame = false;
      progressUsedThisFrame = false;
      if (!Number.isFinite(frameMs) || frameMs < 0) return;
      // The first measurement SETS the average. Blending it against the
      // target-derived seed would make the first several frames report a frame
      // cost no frame ever had.
      frameEmaMs =
        frameSamples === 0 ? frameMs : frameEmaMs + (frameMs - frameEmaMs) * cfg.frameEmaAlpha;
      frameSamples++;
    },
    notePressure(value: boolean): void {
      degrading = value === true;
    },
    headroomMs: headroom,
    predictMs: predict,
    record(kind: string, syncMs: number): void {
      if (!Number.isFinite(syncMs) || syncMs < 0) return;
      const key = gpuPrepKindOfLabel(kind);
      const ledger = kinds.get(key);
      if (ledger) {
        ledger.emaMs = ledger.emaMs + (syncMs - ledger.emaMs) * cfg.emaAlpha;
        ledger.samples++;
        return;
      }
      if (kinds.size >= MAX_KINDS) return;
      kinds.set(key, { emaMs: syncMs, samples: 1 });
    },
    admit(input: GpuPrepAdmitInput): GpuPrepAdmitDecision {
      const predictedMs = predict(input.kind);
      if (legacy) return admitted('legacy', predictedMs);
      // The cover answers BEFORE the frame budget and instead of it: there is
      // no live frame to protect behind a loading screen, only an order to
      // impose. Nothing below is consulted, so the frame's first-sample and
      // progress slots stay unspent for the frames that do need them.
      if (input.cover === true) {
        return gpuPrepCoverAdmits(input.priority)
          ? admitted('cover', predictedMs)
          : deferred('cover-not-arrival', predictedMs);
      }
      if (input.cls === 'actionable') return admitted('actionable-floor', predictedMs);
      const deferredFrames = Number.isFinite(input.deferredFrames) ? input.deferredFrames : 0;
      const starvationBound =
        input.cls === 'cosmetic' ? cfg.cosmeticMaxDeferFrames : cfg.maxDeferFrames;
      if (deferredFrames >= starvationBound) return admitted('starvation', predictedMs);
      if (input.cls === 'cosmetic' && degrading) return deferred('pressure', predictedMs);
      // Visible and approaching work (a live gate, a reveal-gate compile, and
      // their pieces: the body or the band the player is about to see) always
      // makes progress: one piece per frame even when it does not fit,
      // because delaying it never makes the frame faster and a gated root
      // revealed by an escape before its pieces are done pays the whole link
      // on the live path, which costs more than the piece.
      //
      // The slot is per frame, NOT per unspent frame: gating it on a frame
      // that had spent nothing let any actionable unit that ran first close
      // it for every visible and approaching piece behind it, which on a busy
      // frame is all of them. It does need SOME headroom left, though: a frame
      // already exhausted by an earlier piece must not take a second oversized
      // one, or the cheap link submissions behind it lose the whole frame
      // (measured on the iGPU crowd: the props bands' compiles slipped and
      // their first draw raced).
      if (
        (input.cls === 'visible' || input.cls === 'approaching') &&
        !progressUsedThisFrame &&
        ledgerOf(input.kind) !== undefined &&
        headroom() > 0 &&
        predictedMs > headroom()
      ) {
        progressUsedThisFrame = true;
        return admitted('progress', predictedMs);
      }
      if (ledgerOf(input.kind) === undefined) {
        // An unmeasured kind is priced by a guess, so let exactly one through
        // per frame: that is what turns the guess into a sample without letting
        // a whole burst of unknowns in on the strength of it.
        if (firstSampleUsedThisFrame) return deferred('unknown-cap', predictedMs);
        firstSampleUsedThisFrame = true;
        return admitted('first-sample', predictedMs);
      }
      if (predictedMs <= headroom()) return admitted('fits', predictedMs);
      return deferred('no-headroom', predictedMs);
    },
    spend(ms: number): void {
      if (!Number.isFinite(ms) || ms <= 0) return;
      spentThisFrameMs += ms;
    },
    setLegacy(on: boolean): void {
      legacy = on === true;
    },
    snapshot(): GpuPrepBudgetSnapshot {
      return {
        frameEmaMs: round2(frameEmaMs),
        headroomMs: round2(headroom()),
        spentThisFrameMs: round2(spentThisFrameMs),
        legacy,
        degrading,
        kinds: [...kinds.entries()]
          .map(([kind, ledger]) => ({
            kind,
            emaMs: round2(ledger.emaMs),
            samples: ledger.samples,
          }))
          .sort((a, b) => b.emaMs - a.emaMs || a.kind.localeCompare(b.kind)),
        decisions: { ...decisions },
      };
    },
  };
}
