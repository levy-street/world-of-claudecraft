// Deferred-mode link pacing: at most one ADMITTED compile that creates programs
// per frame, issued after the frame it follows, decided by the shared queue's
// ADMISSION, never by a scheduler of its own (src/render/CLAUDE.md: no new queue,
// no new lane).
//
// Why one link per frame. On a Chromium context without
// KHR_parallel_shader_compile the first-sight gates run in deferred mode
// (link_gate_mode_core.ts): a link is issued from the main thread in about 2 ms
// and the GPU process links it behind the command buffer. That process runs
// commands in order, so links issued in a burst make the next frame's draws wait
// behind every one of them: measured on the reference phone, turning the gates
// on unpaced moved the first turn's 343 ms freeze to 398 and 310 ms freezes
// elsewhere. One link issued ahead of its draw hides in the GPU process's spare
// time; a burst cannot.
//
// How. This module is a LEDGER: frames still owed by links already issued, and
// which unit KINDS (gpuPrepKindOfLabel) are known to link. A compile arm reports
// every link it issued (compile_arms.ts noteLink), with the label of the queue
// unit whose synchronous start issued it (background_gpu_queue.ts
// runningGpuWorkLabel); a compile creating N programs owes N more frames. The
// queue's frame clock pays one back per rendered frame (noteLinkFrame, through
// the admission's noteFrame). While a frame is owed, the admission
// (gpu_prep_admission.ts) refuses candidates of a kind known to link, so the
// queue's own priority order picks which linking unit goes when the frame frees,
// and a refused unit waits as the queue's units always wait: queued, not parked
// half-started. Kinds that never linked (a uniform touch, a texture upload, a CPU
// build) are never held, and actionable work keeps the budget's floor. A kind
// is learned on its first link, under the loading cover or in the world, so only
// that first unit of a kind goes unpaced.
//
// After the frame, not inside it. The frame clock ticks at the START of the
// renderer's frame callback, and a loop it wakes resumes before that callback's
// task ends, so a link started there would sit in front of the frame's own
// present. The hold therefore also covers the frame's task: noteLinkFrame asks
// the queue for a hop after the frame (GpuWorkAdmission.frameEnded), and only
// then may a linking unit start, in the gap before the next frame's draws.
//
// What is held, and what is only counted. A gate already splits a root into one
// queue unit per material group (a gate PIECE), so the rule applies to the link
// a unit issues in its synchronous start. A link issued later, in a unit's tail
// (the shadow arm after the colour arm, a second colour target, the later roots
// of a batched resume unit) or outside any unit, cannot be held without a
// scheduler of its own: it is counted and owes its frames ON TOP of what is
// owed, so the next admitted link waits for the GPU process to have worked
// through it. Each such chain waits on its own link fence before its next link
// (compile_arms.ts), and the released-tail cap bounds how many run at once.
//
// What the hold does not do. It is not the budget: `?prep=legacy` keeps it, and
// only the link-gate mode override (`?linkgate=`) turns it off. A refusal here is
// a wait for the GPU process, not for headroom, so it does not age the
// candidate toward the budget's starvation bound (linkHeldSinceLastFrame,
// through the admission's agesDeferral), and a held unit waits only while
// higher-priority links go first, one per frame. A hidden tab ticks no frames,
// so a held unit waits for the tab to show again, as the budget's own refusals
// do. The ledger is page-wide and assumes the one admission the renderer builds.
//
// Pacing starts disarmed: under the loading screen there is no frame to protect,
// and the boot compile lanes issue in bulk behind one fence. The renderer arms it
// at a world reveal (`armLinkPacing`), and it stands down while an arrival cover
// is up. Clock-free and DOM-free.

import { arrivalCoverActive } from './arrival_cover';
import { gpuPrepKindOfLabel } from './gpu_prep_budget_core';

/** Distinct linking kinds remembered. Labels are caller-supplied, so the set is
 *  bounded here rather than trusted (the budget's ledger keeps the same bound). */
const MAX_LINKING_KINDS = 64;
/** Distinct held labels remembered per frame, for the ageing answer. A label
 *  past the bound is aged as an ordinary refusal would be. */
const MAX_HELD_LABELS = 1024;

let enabled = false;
let armed = false;
/** Frames still owed by the links already issued (one per program). */
let owedFrames = 0;
/** From a frame's start until its task has ended (frameEnded). */
let frameTaskOpen = false;
const linkingKinds = new Set<string>();
/** Labels held since the last frame began, and over the frame before it. */
let heldNow = new Set<string>();
let heldBefore = new Set<string>();
let links = 0;
let holds = 0;

function clearDebt(): void {
  owedFrames = 0;
  frameTaskOpen = false;
  heldNow.clear();
  heldBefore.clear();
}

/** The renderer's link-gate mode is deferred (link_gate_mode_core.ts). Every
 *  Renderer constructor calls it, so it also disarms: a second renderer in the
 *  page boots its own loading screen unpaced. */
export function setLinkPacingEnabled(on: boolean): void {
  enabled = on;
  armed = false;
  clearDebt();
}

/** A world reveal: pace from now on. */
export function armLinkPacing(): void {
  armed = true;
}

export function linkPacingActive(): boolean {
  return enabled && armed && !arrivalCoverActive();
}

/** A compile created `programs` programs. `label` is the queue unit whose
 *  synchronous start issued it (null outside one): its kind is learned as a
 *  linking kind whether or not pacing is active, so the world's first reveal
 *  already knows the kinds the loading screen linked. */
export function noteLink(programs: number, label: string | null): void {
  if (!(programs > 0)) return;
  links++;
  if (label !== null && linkingKinds.size < MAX_LINKING_KINDS) {
    linkingKinds.add(gpuPrepKindOfLabel(label));
  }
  if (!linkPacingActive()) return;
  owedFrames += Math.max(1, Math.floor(programs));
}

/** A rendered frame began: pay one owed frame back. Returns whether the hold
 *  also covers this frame's task, in which case the caller owes a
 *  noteLinkFrameEnded once that task is over. */
export function noteLinkFrame(): boolean {
  if (owedFrames > 0) owedFrames--;
  const previous = heldBefore;
  heldBefore = heldNow;
  heldNow = previous;
  heldNow.clear();
  frameTaskOpen = linkPacingActive();
  return frameTaskOpen;
}

/** The frame's task ended (its draws recorded, its present issued). */
export function noteLinkFrameEnded(): void {
  frameTaskOpen = false;
}

/** Whether the admission must hold this candidate: pacing active, a frame owed
 *  or the frame's task still open, a kind known to link, and not actionable (the
 *  budget's actionable floor holds for pacing too: a player's target never waits
 *  behind a reveal's link). Counts and remembers only the holds a frame OWED
 *  answered: a hold for the frame's task alone ends at the hop after it, the
 *  same frame, so it is no wait for the GPU process. Remembering it too kept a
 *  unit the budget refuses for headroom from ever ageing, because every frame's
 *  start refused it here first. */
export function linkHoldsCandidate(label: string, actionable: boolean): boolean {
  if (actionable || !linkPacingActive()) return false;
  if (owedFrames === 0 && !frameTaskOpen) return false;
  if (!linkingKinds.has(gpuPrepKindOfLabel(label))) return false;
  if (owedFrames > 0) {
    holds++;
    if (heldNow.size < MAX_HELD_LABELS) heldNow.add(label);
  }
  return true;
}

/** Whether a candidate with this label was held by the pacing over the frame
 *  that just ended: the queue asks it before ageing a refusal, and a link hold
 *  is no wait for headroom. */
export function linkHeldSinceLastFrame(label: string): boolean {
  return heldBefore.has(label);
}

/** Counters for perfStats (renderer_perf_stats.ts linkGate). */
export function linkPacingStats(): {
  active: boolean;
  owedFrames: number;
  links: number;
  holds: number;
  linkingKinds: string[];
} {
  return { active: linkPacingActive(), owedFrames, links, holds, linkingKinds: [...linkingKinds] };
}

/** Test seam: back to the module's initial state. */
export function resetLinkPacingForTests(): void {
  enabled = false;
  armed = false;
  clearDebt();
  linkingKinds.clear();
  links = 0;
  holds = 0;
}
