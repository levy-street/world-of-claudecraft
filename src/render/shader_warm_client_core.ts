// The shader warm client's bookkeeping: which programs were asked for (once
// each, by their text), who waits on them, what a gate did when it could not
// wait, and when the worker should pause. Host-agnostic (RENDER_PURE_CORES):
// no worker, no DOM, no clock of its own; the host (shader_warm_client.ts)
// carries the messages and the frame readings.
//
// THE POLICY, in one place. The worker warms a program for the game's link
// to be a hit, which pays wherever the link can WAIT: content the camera is
// not among yet (a streamed reveal key beyond the ring, the post-paint
// catalogs, an approaching zone), and a live entity view too, whose stand-in
// already shows the player what is there (a nameplate a little longer is
// acceptable, a frozen frame is not; settled 2026-08-28). A gate that must
// draw NOW (an actionable view, an imminent reveal) gains nothing from
// waiting and would only add the worker's round trip to its hold, and a gate
// created before the reveal links under the curtain where nothing is felt
// and where the renderer state is still moving (the step-1 measurement: the
// point-light census and the post pipeline settle after those gates were
// created, so their keys move). Those are the named bypasses, each counted,
// so the readout says how often the worker was NOT the path.
//
// The modes exist so the policy can be measured rather than believed:
// the setting is `auto` by default (the mode follows the GPU backend, see
// shaderWarmModeFor), `off` never asks the worker, `all` holds every gate
// below the actionable floor (the policy above; `auto` and the stored
// option On resolve to it), `reveal` is the probe arm that exempts the live
// view (the arm the step-3 cells ran, kept so a probe can price the
// live-view hold on its own); `?shaderwarm=` pins any of them.

import { type GpuBackendClass, workerWorthWarming } from './gpu_backend_class_core';
import { programSourceHash } from './shader_warm_audit_core';
import type { ShaderWarmSource } from './shader_warm_protocol';

export type ShaderWarmMode = 'off' | 'reveal' | 'all';

export type ShaderWarmBypass =
  | 'mode-off'
  | 'unavailable'
  | 'standing-down'
  | 'before-reveal'
  | 'actionable'
  | 'live-view'
  | 'imminent'
  | 'piece-mismatch'
  | 'nothing-to-warm';

/** Held gates the worker answered nothing through, in a row, before the
 *  client retires the worker for the rest of the renderer's life: three is
 *  one too many to be one slow link, and each such hold is a reveal delayed
 *  by the whole hold cap or by the worker's own link deadline. */
export const SHADER_WARM_TIMEOUT_BREAKER = 3;

/** The breaker's second rule, for a worker that keeps answering SOMEONE
 *  while most holds still pay the whole cap: over the last
 *  `SHADER_WARM_HOLD_WINDOW` holds, `SHADER_WARM_EXPIRED_SHARE_BREAKER`
 *  expiries retire it. A worker too slow for the demand is not wedged, and
 *  the first rule (expiries the worker answered nothing through) never sees
 *  it; this one bounds what it costs. */
export const SHADER_WARM_HOLD_WINDOW = 8;
export const SHADER_WARM_EXPIRED_SHARE_BREAKER = 4;

/** The breaker's third rule, and the only one that fires before a hold has
 *  paid anything: once the worker has settled this many links, its OWN
 *  measured wall says whether the oldest outstanding hold can still be served
 *  inside what is left of the cap its caller owns. Three links is the least
 *  evidence that is not one outlier, and it is what the calibrated comparison
 *  of the RTX 4070 capture retired on (about 3.6 s in, no hold expired, a
 *  third of the hold time the expired-share rule reached by 7 s); where the
 *  links are ten times shorter (the RTX 3060 desktop) the same arithmetic
 *  never fires. */
export const SHADER_WARM_EVIDENCE_LINKS = 3;

/** The floor a window reading gets: one link at a time. The rule itself does
 *  not run before the worker's first stats message (shader_warm_client.ts),
 *  so this only catches a message whose window reads as nothing. */
export const SHADER_WARM_WINDOW_FALLBACK = 1;

/** Cannot-serve verdicts that RETIRE the worker. The first ones only release:
 *  the verdict prices one burst (the queue ahead of the oldest hold at that
 *  moment), and a verdict read off a window that had just halved condemned a
 *  worker that warmed 174 programs on the next launch (RTX 3060, 2026-09-12).
 *  A release ends that burst's holds and keeps the worker; the same count as
 *  the wedged rule turns repeated bursts into a retirement. */
export const SHADER_WARM_RELEASE_BREAKER = 3;

/** Programs the readout names after the worker failed them, first ones kept:
 *  enough to tell a source mismatch between the dry assembly and the real
 *  link from the known silent link failures, small enough for a capture. */
export const SHADER_WARM_FAILED_PROGRAMS_KEPT = 8;

/** The A/B experiment deciding whether `auto` keeps the worker on D3D11, run
 *  for one release and removed by the decision PR whatever it shows. */
export const SHADER_WARM_AB_ACTIVE = true;

/** The refusal token the `off` arm reports on the typed refusal column, so
 *  the fleet splits the arms without a new column. It is not a refusal: a
 *  refusal-share reading must exclude it while the experiment runs. */
export const SHADER_WARM_AB_REFUSAL = 'ab:off';

export type ShaderWarmAbArm = 'on' | 'off';

export interface ShaderWarmAbInputs {
  setting: ShaderWarmSetting;
  backend: GpuBackendClass | null;
  platform: ShaderWarmPlatform;
  /** What the browser profile stored the first time; anything but an arm is
   *  no draw yet. */
  stored: string | null;
  /** A draw in [0, 1). Owes nothing to the GPU: the arm must not depend on
   *  the machine it measures. */
  random: () => number;
}

/** The arm for this launch, and the arm to store when this launch drew it.
 *  Drawn only where `auto` would start the worker: an explicit setting is
 *  never overridden, and a backend `auto` leaves off has nothing to compare.
 *  Once per browser profile, so a machine stays in one arm for the whole
 *  experiment and neither arm runs on caches the other arm's worker warmed. */
export function shaderWarmAbArmFor(inputs: ShaderWarmAbInputs): {
  arm: ShaderWarmAbArm | null;
  store: ShaderWarmAbArm | null;
} {
  if (!SHADER_WARM_AB_ACTIVE) return { arm: null, store: null };
  if (inputs.setting !== 'auto') return { arm: null, store: null };
  if (shaderWarmModeFor('auto', inputs.backend, inputs.platform) === 'off') {
    return { arm: null, store: null };
  }
  if (inputs.stored === 'on' || inputs.stored === 'off') return { arm: inputs.stored, store: null };
  const draw = inputs.random();
  const arm: ShaderWarmAbArm = Number.isFinite(draw) && draw < 0.5 ? 'off' : 'on';
  return { arm, store: arm };
}

/** One hold the client is still waiting on, in the order it opened: when its
 *  caller's cap clock started, the cap itself, the priority it asked at and
 *  the highest request id it asked for. The last two together are what the
 *  worker has to get through first: it serves by PRIORITY and only then by
 *  arrival, so a hold is behind everything above its priority plus the
 *  requests at its own that arrived no later than its last one. */
export interface ShaderWarmOutstandingHold {
  startedAtMs: number;
  capMs: number;
  priority: number;
  highestId: number;
  /** Ends this hold now, not warm, when a release takes it (the client). */
  release?: () => void;
}

export interface ShaderWarmOutstandingHolds {
  /** `nowMs` is the client's clock at the call, for the wall span below. */
  open(hold: ShaderWarmOutstandingHold, nowMs?: number): ShaderWarmOutstandingHold;
  close(hold: ShaderWarmOutstandingHold, nowMs?: number): void;
  /** The hold that started earliest among those still waiting. */
  oldest(): ShaderWarmOutstandingHold | null;
  size(): number;
  /** Every open hold, removed at once, in the order they opened. */
  releaseAll(nowMs?: number): ShaderWarmOutstandingHold[];
  clear(nowMs?: number): void;
  /** Wall time during which at least one hold was open. The A/B weighs the
   *  worker's cost in it: forty-four holds opened by one entry burst hide
   *  things for the second the burst lasted, not for forty-four seconds. */
  wallMs(nowMs: number): number;
}

export function createShaderWarmOutstandingHolds(): ShaderWarmOutstandingHolds {
  let open: ShaderWarmOutstandingHold[] = [];
  let busySinceMs: number | null = null;
  let wallTotalMs = 0;
  const span = (nowMs: number | undefined): number =>
    busySinceMs === null || nowMs === undefined || !Number.isFinite(nowMs)
      ? 0
      : Math.max(0, nowMs - busySinceMs);
  const endSpanIfIdle = (nowMs: number | undefined): void => {
    if (open.length > 0 || busySinceMs === null) return;
    wallTotalMs += span(nowMs);
    busySinceMs = null;
  };
  return {
    open(hold, nowMs) {
      if (open.length === 0 && nowMs !== undefined && Number.isFinite(nowMs)) busySinceMs = nowMs;
      open.push(hold);
      return hold;
    },
    close(hold, nowMs) {
      const at = open.indexOf(hold);
      if (at < 0) return;
      open.splice(at, 1);
      endSpanIfIdle(nowMs);
    },
    oldest() {
      let oldest: ShaderWarmOutstandingHold | null = null;
      for (const hold of open) {
        if (!oldest || hold.startedAtMs < oldest.startedAtMs) oldest = hold;
      }
      return oldest;
    },
    size: () => open.length,
    releaseAll(nowMs) {
      const released = open;
      open = [];
      endSpanIfIdle(nowMs);
      return released;
    },
    clear(nowMs) {
      open = [];
      endSpanIfIdle(nowMs);
    },
    wallMs: (nowMs) => wallTotalMs + span(nowMs),
  };
}

export interface ShaderWarmCannotServeInputs {
  /** The worker's own links this session, and their summed wall. */
  linkCount: number;
  linkSumMs: number;
  /** The links the worker gave up on at its own deadline, and the wall they
   *  had run: each a LOWER BOUND on a link's cost. Read only while no link at
   *  all has settled, and at the same evidence floor as the settled ones. */
  censoredCount?: number;
  censoredSumMs?: number;
  /** The window from the worker's last stats message, which can be a few
   *  hundred milliseconds stale (the worker reports on its own poll); a
   *  window that reads as nothing floors at one link at a time. */
  windowLinks: number;
  /** Unsettled requests the worker serves before the oldest hold's last one. */
  aheadOfOldest: number;
  /** The oldest outstanding hold's cap, and how long it has waited. */
  capMs: number;
  waitedMs: number;
}

/** Whether the worker CANNOT serve the oldest hold inside what is left of its
 *  cap, on the worker's own evidence: the queue ahead of that hold, at the
 *  mean wall this worker has actually paid per link, spread over the links it
 *  runs at once, against the cap the caller already owns. Nothing here is a
 *  millisecond bound: the same arithmetic that retires a worker whose links
 *  cost half a second keeps one whose links cost fifty.
 *
 *  Where NO link has settled, the links the worker gave up on at its deadline
 *  are the evidence instead: each ran at least the deadline, and a lower
 *  bound is enough to say a queue does not fit. They are read at the same
 *  floor, and never once a link has settled: a tab throttled early produces
 *  deadlines on a healthy machine, and one settled link says the worker is
 *  not blind, so the rule then waits for the settled evidence as before. */
export function shaderWarmCannotServe(inputs: ShaderWarmCannotServeInputs): boolean {
  const evidence = shaderWarmLinkEvidence(inputs);
  if (!evidence) return false;
  const ahead = Math.floor(inputs.aheadOfOldest);
  if (!Number.isFinite(ahead) || ahead <= 0) return false;
  if (!Number.isFinite(inputs.capMs) || !Number.isFinite(inputs.waitedMs)) return false;
  // A hold already past its cap is the EXPIRY rules' business, not this one:
  // the verdict here is final for the session, and a message that arrived
  // just before the cap but ran after a long task spanning it would otherwise
  // read a negative remainder and retire the worker on one overrun.
  if (inputs.waitedMs >= inputs.capMs) return false;
  const meanLinkMs = evidence.sumMs / evidence.count;
  const window = Math.max(
    SHADER_WARM_WINDOW_FALLBACK,
    Number.isFinite(inputs.windowLinks) ? Math.floor(inputs.windowLinks) : 0,
  );
  const remainingMs = inputs.capMs - inputs.waitedMs;
  return (ahead * meanLinkMs) / window > remainingMs;
}

export interface ShaderWarmLinkEvidence {
  count: number;
  sumMs: number;
  /** Which pool spoke: the retirement cause names it, so the fleet can
   *  tell a verdict on settled links from one on deadline give-ups. */
  source: 'settled' | 'censored';
}

/** The pool the cannot-serve rule prices links at: the settled links once
 *  there are enough of them, else the deadline-censored ones when nothing at
 *  all settled, else nothing (no evidence is not evidence of slowness). */
export function shaderWarmLinkEvidence(
  inputs: ShaderWarmCannotServeInputs,
): ShaderWarmLinkEvidence | null {
  const pool = (
    count: number,
    sumMs: number,
    source: ShaderWarmLinkEvidence['source'],
  ): ShaderWarmLinkEvidence | null => {
    const links = Math.floor(count);
    if (!Number.isFinite(links) || links < SHADER_WARM_EVIDENCE_LINKS) return null;
    if (!Number.isFinite(sumMs) || sumMs <= 0) return null;
    return { count: links, sumMs, source };
  };
  if (!Number.isFinite(inputs.linkCount)) return null;
  const settled = pool(inputs.linkCount, inputs.linkSumMs, 'settled');
  if (settled) return settled;
  if (Math.floor(inputs.linkCount) > 0) return null;
  return pool(inputs.censoredCount ?? 0, inputs.censoredSumMs ?? 0, 'censored');
}

/** The last few holds, expired or not, for the breaker's second rule. */
export interface ShaderWarmHoldRing {
  note(expired: boolean): void;
  /** Expiries among the holds the ring holds. */
  expired(): number;
  size(): number;
}

export function createShaderWarmHoldRing(window = SHADER_WARM_HOLD_WINDOW): ShaderWarmHoldRing {
  const ring: boolean[] = [];
  const keep = Math.max(1, Math.floor(window));
  return {
    note(expired) {
      ring.push(expired);
      if (ring.length > keep) ring.splice(0, ring.length - keep);
    },
    expired: () => ring.filter(Boolean).length,
    size: () => ring.length,
  };
}

export interface ShaderWarmPolicyInputs {
  mode: ShaderWarmMode;
  /** The worker is ready (spawned, context up, extensions matched). */
  available: boolean;
  /** The first reveal happened: the census and the pipeline are settled. */
  armed: boolean;
  priority: number;
  imminent: boolean;
  /** A cannot-serve release happened and the worker's queue has not drained
   *  yet: no gate holds until it has. */
  standingDown?: boolean;
  /** The queue's floors, so the core does not import the queue. */
  liveViewPriority: number;
  actionablePriority: number;
}

export type ShaderWarmDecision = { hold: true } | { hold: false; bypass: ShaderWarmBypass };

/** Whether a gate holds its link for the worker, or links as before. */
export function shaderWarmDecision(inputs: ShaderWarmPolicyInputs): ShaderWarmDecision {
  if (inputs.mode === 'off') return { hold: false, bypass: 'mode-off' };
  if (!inputs.available) return { hold: false, bypass: 'unavailable' };
  if (inputs.standingDown === true) return { hold: false, bypass: 'standing-down' };
  if (!inputs.armed) return { hold: false, bypass: 'before-reveal' };
  if (inputs.priority >= inputs.actionablePriority) return { hold: false, bypass: 'actionable' };
  if (inputs.imminent) return { hold: false, bypass: 'imminent' };
  if (inputs.priority >= inputs.liveViewPriority && inputs.mode !== 'all') {
    return { hold: false, bypass: 'live-view' };
  }
  return { hold: true };
}

/** The player's setting: a mode, or `auto`, which follows the GPU backend. */
export type ShaderWarmSetting = 'auto' | ShaderWarmMode;

export const SHADER_WARM_SETTINGS: readonly ShaderWarmSetting[] = ['auto', 'off', 'reveal', 'all'];

/** The one grammar every `?shaderwarm=` reader shares (the worker here, the
 *  character-select corpus in shader_warmup_core.ts): the four settings by
 *  name, plus `0` and `1` as the corpus's original off and on, so one pin
 *  reads the same on both arms and a probe cannot leave one of them running. */
export function asShaderWarmSetting(value: string | null | undefined): ShaderWarmSetting | null {
  if (value === 'auto' || value === 'off' || value === 'reveal' || value === 'all') return value;
  if (value === '0') return 'off';
  if (value === '1') return 'all';
  return null;
}

/** The query arm alone: the pinned setting, or null when the flag is absent
 *  or names nothing known. */
export function readShaderWarmQuery(search: string): ShaderWarmSetting | null {
  const match = /[?&]shaderwarm=([^&]*)/.exec(search);
  return match ? asShaderWarmSetting(decodeURIComponent(match[1] ?? '')) : null;
}

/** `?shaderwarmready=<ms>` pins how long a spawned worker has to answer ready,
 *  for a probe on a backend where the GPU process is busy at boot (Windows
 *  OpenGL: the worker's context queues behind the boot lane's links and the
 *  3 s default expires before it ever links). Ignored unless a positive
 *  finite number; the shipped default stays. */
export function readShaderWarmReadyDeadline(search: string, fallbackMs: number): number {
  const match = /[?&]shaderwarmready=([^&]*)/.exec(search);
  if (!match) return fallbackMs;
  const value = Number(decodeURIComponent(match[1] ?? ''));
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

/** `?shaderwarm=auto|off|reveal|all` pins an arm for a probe and wins over
 *  the stored graphics option. No stored option at all (an entry that never
 *  registered the store: the editor, the guide viewer, a test) is OFF, never
 *  auto: only the game entry owns the option and the worker context it costs. */
export function readShaderWarmSetting(
  search: string,
  stored: string | null | undefined = null,
): ShaderWarmSetting {
  return readShaderWarmQuery(search) ?? asShaderWarmSetting(stored) ?? 'off';
}

/** The platform class the mode resolver refuses on: phone-class WebKit,
 *  where a second WebGL2 context is a per-process memory ceiling risk
 *  (src/render/CLAUDE.md, the preload lanes' iPhone kill), not a frame cost. */
export type ShaderWarmPlatform = 'ios' | 'android' | 'other';

/** `auto` resolves once the backend is known: the worker holds links (the
 *  live view included) only where the backend compiles off the presenting
 *  thread AND has something to warm AND that was measured (D3D11; measured
 *  2026-08-28 and 2026-08-30). On ANGLE's OpenGL backends (Linux and
 *  Android Chrome) the worker only relocates the stall into the GPU process,
 *  on Vulkan a cold link is already as cheap as a hit while the worker's own
 *  links cost three to six times more, and Metal reads like Vulkan on its
 *  one datapoint (11 ms cold) with no in-game measurement, so `auto` is OFF
 *  on all three, and OFF while the backend is still unknown. iOS is OFF whatever the setting: the explicit arm exists to
 *  measure a backend, never to mint a second context on a phone-class
 *  WebKit; Android keeps the explicit arm (its GLES class already reads
 *  OFF under auto). */
export function shaderWarmModeFor(
  setting: ShaderWarmSetting,
  backend: GpuBackendClass | null,
  platform: ShaderWarmPlatform = 'other',
): ShaderWarmMode {
  if (platform === 'ios') return 'off';
  if (setting !== 'auto') return setting;
  return backend !== null && workerWorthWarming(backend) ? 'all' : 'off';
}

export interface ShaderWarmRequestSource {
  vertex: string;
  fragment: string;
  index0Attribute: string;
}

export type ShaderWarmOutcome = 'warmed' | 'failed';

interface ShaderWarmEntry {
  id: number;
  hash: string;
  outcome: ShaderWarmOutcome | null;
  waiters: Array<(outcome: ShaderWarmOutcome) => void>;
  priority: number;
  /** Requests still interested in the outcome: one per `request` call that
   *  named it, minus the holds that abandoned it. */
  interest: number;
}

export interface ShaderWarmRequestStats {
  /** Sources handed in, before the dedupe. */
  asked: number;
  /** Distinct programs sent to the worker. */
  sent: number;
  warmed: number;
  /** Programs the worker could not link. */
  failed: number;
  /** Requests given up on (a hold that expired) and dropped unlinked. */
  cancelled: number;
  /** Requests answered from an earlier warm (the same text asked again). */
  deduped: number;
  /** Deduped requests that raised the pending program's priority (a live
   *  view or a reveal naming what a catalog queued first). */
  promoted: number;
  /** Gates that held their link for the worker. */
  held: number;
  /** Of the held gates, those whose every program was warm when the hold
   *  ended. */
  heldWarm: number;
  /** Held gates that gave up on the hold cap and linked cold. */
  heldTimedOut: number;
  /** Held gates a cannot-serve release ended before their cap. */
  heldReleased: number;
  bypassed: Record<ShaderWarmBypass, number>;
  /** Hold durations, summed, so a mean is one division away. */
  holdMs: number;
  /** The gates' dry assembly time, summed (one queue unit per held piece). */
  dryAssembleMs: number;
  /** The worker's own link times (submission to resolution), so a capture
   *  can say how long the GPU process took per program under this load. */
  links: { count: number; sumMs: number; maxMs: number };
  /** The links the worker gave up on at its own deadline, and the wall they
   *  had run when it did: lower bounds, kept apart from `links` so a capture
   *  never reads a give-up as a link time. The cannot-serve rule's only
   *  evidence on a machine where no link ever settles. */
  censoredLinks: { count: number; sumMs: number; maxMs: number };
  /** The first programs the worker failed, by source key, with the reason. */
  failedPrograms: Array<{ hash: string; reason: 'link-failed' | 'link-deadline' }>;
}

export interface ShaderWarmRequests {
  /** Ask for a set of programs. The returned ids are the worker's; already
   *  warm ones are not re-sent and are not in `toSend`. A pending one asked
   *  again at a HIGHER priority is in `toPromote`: the worker keeps its own
   *  order by priority, so a dedupe that kept the first, lower priority left a
   *  reveal's program behind the catalog that queued it first, until the hold
   *  cap. A lower or equal priority changes nothing. */
  request(
    sources: readonly ShaderWarmRequestSource[],
    priority: number,
  ): {
    ids: number[];
    toSend: ShaderWarmSource[];
    toPromote: Array<{ id: number; priority: number }>;
  };
  /** Resolves with the outcomes of `ids`, in order, once every one settled. */
  whenSettled(ids: readonly number[]): Promise<ShaderWarmOutcome[]>;
  /** True when the id was pending and is settled now. `cancelled` says a
   *  failed outcome is a request dropped on the client's word, not a link
   *  the worker could not do. */
  settle(id: number, outcome: ShaderWarmOutcome, cancelled?: boolean): boolean;
  /** A hold gave up on these ids (it links cold now). Returns the ids no
   *  other request still waits for and the worker has not settled: those
   *  are the worker's to drop, and the same text asked again later is a
   *  fresh request rather than a wait on a link that was cancelled. */
  abandon(ids: readonly number[]): number[];
  /** Every unsettled request fails now (the worker died). */
  failAll(): void;
  /** Requests sent and not settled: someone is waiting on each of them. */
  pendingCount(): number;
  /** Of those, the ones the worker serves before a hold's last request: it
   *  takes priority first and arrival second, so everything ABOVE
   *  `priority` counts whenever it arrived, and at `priority` itself only
   *  what arrived no later than `highestId`. Requests nobody is interested in
   *  any more (a hold that gave up) are on their way out and count for
   *  nobody. */
  unsettledAhead(priority: number, highestId: number): number;
  /** The outcome a request settled with; null while pending or unknown. */
  outcomeOf(id: number): ShaderWarmOutcome | null;
  /** The source key a request was made for; null for an unknown id. */
  hashOf(id: number): string | null;
  noteHeld(warm: boolean, timedOut: boolean, holdMs: number, released?: boolean): void;
  /** The worker failed this request's program: keep its key for the readout. */
  noteFailedProgram(id: number, reason: 'link-failed' | 'link-deadline'): void;
  noteBypass(bypass: ShaderWarmBypass): void;
  noteAssembly(ms: number): void;
  noteLink(ms: number): void;
  /** A link the worker gave up on at its deadline, with the wall it ran. */
  noteCensoredLink(ms: number): void;
  stats(): ShaderWarmRequestStats;
}

export function createShaderWarmRequests(): ShaderWarmRequests {
  const byHash = new Map<string, ShaderWarmEntry>();
  const byId = new Map<number, ShaderWarmEntry>();
  let nextId = 1;
  let unsettled = 0;
  const stats: ShaderWarmRequestStats = {
    asked: 0,
    sent: 0,
    warmed: 0,
    failed: 0,
    cancelled: 0,
    deduped: 0,
    promoted: 0,
    held: 0,
    heldWarm: 0,
    heldTimedOut: 0,
    heldReleased: 0,
    bypassed: {
      'mode-off': 0,
      unavailable: 0,
      'standing-down': 0,
      'before-reveal': 0,
      actionable: 0,
      'live-view': 0,
      imminent: 0,
      'piece-mismatch': 0,
      'nothing-to-warm': 0,
    },
    holdMs: 0,
    dryAssembleMs: 0,
    links: { count: 0, sumMs: 0, maxMs: 0 },
    censoredLinks: { count: 0, sumMs: 0, maxMs: 0 },
    failedPrograms: [],
  };
  return {
    request(sources, priority) {
      const ids: number[] = [];
      const toSend: ShaderWarmSource[] = [];
      const toPromote: Array<{ id: number; priority: number }> = [];
      for (const source of sources) {
        stats.asked++;
        const hash = `${programSourceHash(source.vertex, source.fragment)}|${source.index0Attribute}`;
        let entry = byHash.get(hash);
        if (entry) {
          stats.deduped++;
          entry.interest++;
          if (entry.outcome === null && priority > entry.priority) {
            entry.priority = priority;
            stats.promoted++;
            toPromote.push({ id: entry.id, priority });
          }
        } else {
          entry = { id: nextId++, hash, outcome: null, waiters: [], priority, interest: 1 };
          byHash.set(hash, entry);
          byId.set(entry.id, entry);
          stats.sent++;
          unsettled++;
          toSend.push({
            id: entry.id,
            vertex: source.vertex,
            fragment: source.fragment,
            index0Attribute: source.index0Attribute,
            priority,
          });
        }
        ids.push(entry.id);
      }
      return { ids, toSend, toPromote };
    },
    whenSettled(ids) {
      return Promise.all(
        ids.map(
          (id) =>
            new Promise<ShaderWarmOutcome>((resolve) => {
              const entry = byId.get(id);
              if (!entry) {
                resolve('failed');
                return;
              }
              if (entry.outcome) resolve(entry.outcome);
              else entry.waiters.push(resolve);
            }),
        ),
      );
    },
    settle(id, outcome, cancelled = false) {
      const entry = byId.get(id);
      if (!entry || entry.outcome) return false;
      entry.outcome = outcome;
      unsettled--;
      if (outcome === 'warmed') stats.warmed++;
      else if (cancelled) stats.cancelled++;
      else stats.failed++;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const waiter of waiters) waiter(outcome);
      return true;
    },
    abandon(ids) {
      const dropped: number[] = [];
      for (const id of ids) {
        const entry = byId.get(id);
        if (!entry || entry.interest === 0) continue;
        entry.interest--;
        if (entry.interest > 0 || entry.outcome) continue;
        dropped.push(id);
        if (byHash.get(entry.hash) === entry) byHash.delete(entry.hash);
      }
      return dropped;
    },
    failAll() {
      for (const entry of byId.values()) {
        if (entry.outcome) continue;
        entry.outcome = 'failed';
        unsettled--;
        stats.failed++;
        const waiters = entry.waiters;
        entry.waiters = [];
        for (const waiter of waiters) waiter('failed');
      }
    },
    pendingCount: () => unsettled,
    unsettledAhead(priority, highestId) {
      let ahead = 0;
      for (const entry of byId.values()) {
        if (entry.outcome !== null || entry.interest === 0) continue;
        if (entry.priority > priority || (entry.priority === priority && entry.id <= highestId)) {
          ahead++;
        }
      }
      return ahead;
    },
    outcomeOf: (id) => byId.get(id)?.outcome ?? null,
    hashOf: (id) => byId.get(id)?.hash ?? null,
    noteHeld(warm, timedOut, holdMs, released = false) {
      stats.held++;
      if (warm) stats.heldWarm++;
      if (timedOut) stats.heldTimedOut++;
      if (released) stats.heldReleased++;
      stats.holdMs += Math.max(0, holdMs);
    },
    noteBypass(bypass) {
      stats.bypassed[bypass]++;
    },
    noteAssembly(ms) {
      stats.dryAssembleMs += Math.max(0, ms);
    },
    noteLink(ms) {
      // Dropped like a censored wall: one NaN in the sum would silence the
      // cannot-serve rule for the session with no trace.
      if (!Number.isFinite(ms)) return;
      const linkMs = Math.max(0, ms);
      stats.links.count++;
      stats.links.sumMs += linkMs;
      stats.links.maxMs = Math.max(stats.links.maxMs, linkMs);
    },
    noteCensoredLink(ms) {
      // This sum decides a retirement: one NaN would disable the arm for the
      // session, so a garbage wall is dropped rather than clamped.
      if (!Number.isFinite(ms)) return;
      const censoredMs = Math.max(0, ms);
      stats.censoredLinks.count++;
      stats.censoredLinks.sumMs += censoredMs;
      stats.censoredLinks.maxMs = Math.max(stats.censoredLinks.maxMs, censoredMs);
    },
    noteFailedProgram(id, reason) {
      const hash = byId.get(id)?.hash;
      if (hash === undefined) return;
      if (stats.failedPrograms.length >= SHADER_WARM_FAILED_PROGRAMS_KEPT) return;
      if (stats.failedPrograms.some((kept) => kept.hash === hash && kept.reason === reason)) return;
      stats.failedPrograms.push({ hash, reason });
    },
    stats: () => ({
      ...stats,
      failedPrograms: stats.failedPrograms.map((kept) => ({ ...kept })),
      bypassed: { ...stats.bypassed },
      links: { ...stats.links },
      censoredLinks: { ...stats.censoredLinks },
    }),
  };
}

/**
 * The pause signal: an exponential average of the frame time, paused above
 * two vsync periods and resumed under a period and a half, so the worker
 * never adds GPU work to a frame that is already late and never flaps on a
 * single long frame. The bounds are the display's, not a machine's.
 *
 * It applies to BACKGROUND warming only: a request a gate is holding its
 * link for has a consumer waiting, and pausing it only delays that reveal
 * (the first iGPU cell measured exactly that: the main thread's own cold
 * links made the frames long, the pause starved the worker, 35 of 57 held
 * pieces expired at the cap). The host pauses the worker only while no
 * request is unsettled (`pendingCount() === 0`), whatever the average says.
 */
export const SHADER_WARM_FRAME_PERIOD_MS = 1000 / 60;
export const SHADER_WARM_PAUSE_ABOVE_MS = SHADER_WARM_FRAME_PERIOD_MS * 2;
export const SHADER_WARM_RESUME_BELOW_MS = SHADER_WARM_FRAME_PERIOD_MS * 1.5;
const FRAME_EMA_WEIGHT = 0.2;

export interface ShaderWarmPauseState {
  emaMs: number;
  paused: boolean;
}

export function createShaderWarmPauseState(): ShaderWarmPauseState {
  return { emaMs: SHADER_WARM_FRAME_PERIOD_MS, paused: false };
}

/** Feed one frame; returns the transition, if any. */
export function noteShaderWarmFrame(
  state: ShaderWarmPauseState,
  frameMs: number,
): 'pause' | 'resume' | null {
  const ms = Number.isFinite(frameMs) ? Math.max(0, Math.min(250, frameMs)) : 0;
  state.emaMs += (ms - state.emaMs) * FRAME_EMA_WEIGHT;
  if (!state.paused && state.emaMs > SHADER_WARM_PAUSE_ABOVE_MS) {
    state.paused = true;
    return 'pause';
  }
  if (state.paused && state.emaMs < SHADER_WARM_RESUME_BELOW_MS) {
    state.paused = false;
    return 'resume';
  }
  return null;
}
