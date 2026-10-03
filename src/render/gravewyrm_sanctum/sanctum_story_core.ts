// The renderer's memory of each Sanctum claim's story step (the Calving
// Face's crack step, design section 3): the run's story markers carry it in
// their template id (sim/encounters/gravewyrm_sanctum/story.ts, latched per
// claim, monotonic), and every marker view the renderer builds reports what it
// shows here (../gate_objects.ts). The face reads the max step any mirrored
// marker of its slot carries, and WHEN each stage and each chain rose, so a
// rise plays its one-shot (a plate falling, a chain tearing out) while a party
// arriving at an already-cracked face sees it as it stands, no replay.
//
// A step LOWER than the memory's starts the slot over, snapped: the run's
// latch only ever rises, so a lower step is a fresh claim in the same slot (a
// freed claim drops its markers and a new run respawns them at 0) or a dev
// rewind (`/dev sanctum face`). A marker that left the client's interest
// range is rebuilt with the CURRENT step when it returns, never a stale one.
//
// Pure and Three-free (the clock is passed in, render seconds).

import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  SANCTUM_DUNGEON,
  sanctumFaceStage,
  sanctumStoryStepOf,
} from '../../sim/encounters/gravewyrm_sanctum/ids';

/** Seconds a stage counts as "met already" when first seen (no replay). */
const SNAPPED = 999;

interface SlotMemory {
  step: number;
  /** When each render stage (0..5) rose, render seconds (or -SNAPPED). */
  stageAt: number[];
  /** When each of the four chains fell out of the ice. */
  chainAt: number[];
}

const memory = new Map<string, SlotMemory>();

/** The memory key of the slot anchored at (ox, oz). */
export function sanctumSlotKey(ox: number, oz: number): string {
  return `${Math.round(ox)}|${Math.round(oz)}`;
}

function fresh(step: number, now: number): SlotMemory {
  const { stage, chains } = sanctumFaceStage(step);
  const stageAt = Array.from({ length: 6 }, (_, s) => (s <= stage ? now - SNAPPED : Infinity));
  const chainAt = Array.from({ length: 4 }, (_, c) => (c < chains ? now - SNAPPED : Infinity));
  return { step, stageAt, chainAt };
}

/** Record a story step seen for slot `key` at render time `now`. */
export function observeSanctumStep(key: string, step: number, now: number): void {
  let m = memory.get(key);
  if (!m || step < m.step) {
    m = fresh(step, now);
    memory.set(key, m);
  }
  if (step <= m.step) return;
  const before = sanctumFaceStage(m.step);
  const after = sanctumFaceStage(step);
  for (let s = before.stage + 1; s <= after.stage; s++) m.stageAt[s] = now;
  for (let c = before.chains; c < after.chains; c++) m.chainAt[c] = now;
  m.step = step;
}

interface MarkerLike {
  templateId: string;
  dungeonId: string | null;
  pos: { x: number; z: number };
}

/** Report a mirrored entity: a Sanctum story marker records its step under
 *  its slot; any other entity is ignored. */
export function observeSanctumStoryMarker(e: MarkerLike, now: number): void {
  const step = sanctumStoryStepOf(e.templateId);
  if (step === null || e.dungeonId !== SANCTUM_DUNGEON) return;
  const def = DUNGEONS[SANCTUM_DUNGEON];
  if (!def) return;
  const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
  observeSanctumStep(sanctumSlotKey(o.x, o.z), step, now);
}

export interface SanctumStoryView {
  step: number;
  stage: number;
  chains: number;
  /** Seconds since the current stage rose (large when met already risen). */
  since: number;
  /** Seconds since each stage rose (Infinity-like when not yet). */
  stageSince: number[];
  /** Seconds since each chain fell (negative/never: Infinity). */
  chainSince: number[];
}

/** A fresh view to fill (callers keep one and pass it every frame). */
export function newSanctumStoryView(): SanctumStoryView {
  return {
    step: 0,
    stage: 0,
    chains: 0,
    since: SNAPPED,
    stageSince: [SNAPPED, -1, -1, -1, -1, -1],
    chainSince: [-1, -1, -1, -1],
  };
}

/** The slot's story as the face draws it at `now` (arrival when unseen),
 *  written into `out` (allocation-free: the frame driver calls it every
 *  frame). */
export function sanctumStoryView(
  key: string,
  now: number,
  out: SanctumStoryView = newSanctumStoryView(),
): SanctumStoryView {
  const m = memory.get(key);
  if (!m) {
    out.step = 0;
    out.stage = 0;
    out.chains = 0;
    out.since = SNAPPED;
    for (let s = 0; s < 6; s++) out.stageSince[s] = s === 0 ? SNAPPED : -1;
    for (let c = 0; c < 4; c++) out.chainSince[c] = -1;
    return out;
  }
  const { stage, chains } = sanctumFaceStage(m.step);
  out.step = m.step;
  out.stage = stage;
  out.chains = chains;
  for (let s = 0; s < 6; s++)
    out.stageSince[s] = Number.isFinite(m.stageAt[s]) ? now - m.stageAt[s] : -1;
  for (let c = 0; c < 4; c++)
    out.chainSince[c] = Number.isFinite(m.chainAt[c]) ? now - m.chainAt[c] : -1;
  out.since = out.stageSince[stage];
  return out;
}

/** Forget every slot (tests). */
export function clearSanctumStoryForTest(): void {
  memory.clear();
}
