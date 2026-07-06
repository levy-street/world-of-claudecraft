// The appearance behavior for Logol, the mysterious merchant (docs/prd/woc/
// logol-merchant.md). One Logol, shared by the whole world, appears at the SAME
// fixed spot once a week for a multi-day window, then vanishes, the way Destiny's
// Xur returns to a known place each week.
//
// CLOCK: the weekly cadence is anchored to the HOST wall clock, not sim time,
// because sim time restarts at 0 on every realm reboot (a sim-time week would
// reset each deploy and leave Logol nearly always present). The clock arrives
// through the same host-injected seam raid lockouts use (SimConfig.lockoutNowMs):
// the live server passes Date.now(); offline and headless worlds keep the
// default sim-time-derived ms, which stays fully deterministic. Weeks are epoch
// anchored (Unix epoch is a Thursday), so every realm shares the same
// Thursday-to-Sunday UTC visit window and a restart never moves it.
//
// DETERMINISM: presence is a PURE FUNCTION of the injected clock; no ctx.rng
// draws are added to the per-tick path, so the global draw order is
// byte-identical to before. The whole scheduler is additionally gated by
// SimConfig.logolEnabled (default false), so offline worlds, headless RL, and
// every parity/golden trace never run this code. See the PRD "Determinism".
import { LOGOL_APPEAR_POS, LOGOL_HARBINGER_NPC_ID, LOGOL_NPC_ID } from './content/logol';
import { NPCS } from './data';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';

const DAY_MS = 24 * 60 * 60 * 1000;

// Tuning (PRD "Appearance cadence"): a play-feel pass may adjust the visit
// length. INVARIANT: LOGOL_VISIT_MS < LOGOL_APPEAR_PERIOD_MS, so every week has
// an absent gap and each week re-spawns Logol fresh at the same spot.
export const LOGOL_APPEAR_PERIOD_MS = 7 * DAY_MS; // once a week
export const LOGOL_VISIT_MS = 3 * DAY_MS; // he lingers a few days, then is gone

// Fixed base URL of Logol's pre-generated (developer-authored) voice clips.
const LOGOL_VOICE_CLIP_BASE_URL = '/audio/logol';

// The Harbinger's fixed home (matches its NpcDef.pos). Snapped to terrain at
// spawn via ctx.groundPos.
const HARBINGER_POS = { x: 18, z: 8 };

// The scheduler's runtime state, kept on Sim and passed in by the coordinator:
// the live Logol entity id (null when he is currently absent), and the
// persistent Harbinger entity id (spawned once, never despawned while enabled).
export interface LogolRoamState {
  entityId: number | null;
  harbingerId: number | null;
}

export function makeLogolRoamState(): LogolRoamState {
  return { entityId: null, harbingerId: null };
}

/**
 * Pure: which appearance week `nowMs` (epoch ms) falls in. The same index feeds
 * the weekly wares rotation (logolOfferedWares), so the stock changes exactly
 * when the visit window rolls over. Clamped to >= 0 for pre-epoch test clocks.
 */
export function logolWeekIndex(nowMs: number): number {
  return Math.max(0, Math.floor(nowMs / LOGOL_APPEAR_PERIOD_MS));
}

/**
 * Pure: is Logol present at `nowMs` (epoch ms), i.e. within the first
 * LOGOL_VISIT_MS of the current week? Shared by the tick reconcile, the shop
 * offer gate (server/logol.ts), and tests. Never draws rng.
 */
export function logolPresent(nowMs: number): boolean {
  if (nowMs < 0) return false;
  return nowMs % LOGOL_APPEAR_PERIOD_MS < LOGOL_VISIT_MS;
}

/** Pure: epoch ms when the current week's window state next changes. */
export function logolNextChangeMs(nowMs: number): number {
  const weekStart = logolWeekIndex(nowMs) * LOGOL_APPEAR_PERIOD_MS;
  return logolPresent(nowMs) ? weekStart + LOGOL_VISIT_MS : weekStart + LOGOL_APPEAR_PERIOD_MS;
}

/**
 * Reconcile the live Logol entity against the injected clock each tick: spawn
 * him at his fixed spot when the weekly window opens and he is absent; despawn
 * him when it closes. Call once per tick from the coordinator, gated by
 * SimConfig.logolEnabled, passing the host clock (cfg.lockoutNowMs()). He stands
 * at his spot (no per-tick rng wander).
 */
export function updateLogolRoam(ctx: SimContext, state: LogolRoamState, nowMs: number): void {
  // Ensure the persistent Harbinger (the quest giver) exists at its fixed home.
  const harbinger = state.harbingerId !== null ? ctx.entities.get(state.harbingerId) : undefined;
  if (!harbinger) {
    const def = NPCS[LOGOL_HARBINGER_NPC_ID];
    if (def) {
      const npc = createNpc(ctx.nextId++, def, ctx.groundPos(HARBINGER_POS.x, HARBINGER_POS.z));
      npc.spawnPos = { ...npc.pos };
      ctx.addEntity(npc);
      state.harbingerId = npc.id;
    }
  }

  const present = logolPresent(nowMs);
  const existing = state.entityId !== null ? ctx.entities.get(state.entityId) : undefined;
  if (present) {
    if (existing) return;
    const def = NPCS[LOGOL_NPC_ID];
    if (!def) return;
    const npc = createNpc(ctx.nextId++, def, ctx.groundPos(LOGOL_APPEAR_POS.x, LOGOL_APPEAR_POS.z));
    npc.spawnPos = { ...npc.pos };
    // Fixed developer-authored voice (a Logan Golema clone), served statically.
    npc.npcVoiceClipBaseUrl = LOGOL_VOICE_CLIP_BASE_URL;
    ctx.addEntity(npc);
    state.entityId = npc.id;
  } else if (existing) {
    ctx.dropEntity(existing.id);
    state.entityId = null;
  } else {
    // Absent and no live entity, but clear a stale id if the entity vanished for
    // another reason (defensive; keeps state honest).
    state.entityId = null;
  }
}
