// The roaming behavior for Logol, the mysterious merchant (docs/prd/woc/
// logol-merchant.md). One Logol, shared by the whole world, appears at a
// clock-chosen point of interest for a short window then vanishes, the way
// Destiny's Xur or RE4's Merchant do.
//
// DETERMINISM: presence and location are a PURE FUNCTION of the shared sim clock
// (ctx.time) plus the stateless hash2 (which does NOT advance ctx.rng's shared
// mulberry32 stream). No ctx.rng.next() calls are added to the per-tick path, so
// the global draw order is byte-identical to before. The whole scheduler is
// additionally gated by SimConfig.logolEnabled (default false), so offline
// worlds, headless RL, and every parity/golden trace never run this code. See
// the PRD "Determinism" section.
import { LOGOL_HARBINGER_NPC_ID, LOGOL_NPC_ID, LOGOL_POIS } from './content/logol';
import { NPCS } from './data';
import { createNpc } from './entity';
import { hash2 } from './rng';
import type { SimContext } from './sim_context';

// Tuning (PRD "Roaming tuning"): first-pass numbers, want a play-feel pass.
// INVARIANT: VISIT_DURATION < APPEAR_PERIOD, so every window has an absent gap
// and the next window always re-spawns Logol fresh at its own POI (a present
// window never straddles two POIs).
export const LOGOL_APPEAR_PERIOD = 20 * 60; // sim seconds between appearance windows
export const LOGOL_VISIT_DURATION = 5 * 60; // present for the first N seconds of each window

// Fixed base URL of Logol's pre-generated (developer-authored) voice clips.
const LOGOL_VOICE_CLIP_BASE_URL = '/audio/logol';
// Arbitrary fixed salt so the POI hash is stable and distinct.
const LOGOL_POI_SALT = 0x106f01;

// The Harbinger's fixed home (matches its NpcDef.pos). Snapped to terrain at
// spawn via ctx.groundPos.
const HARBINGER_POS = { x: 18, z: 8 };

// The scheduler's runtime state, kept on Sim and passed in by the coordinator:
// the live roaming-Logol entity id (null when he is currently absent), and the
// persistent Harbinger entity id (spawned once, never despawned while enabled).
export interface LogolRoamState {
  entityId: number | null;
  harbingerId: number | null;
}

export function makeLogolRoamState(): LogolRoamState {
  return { entityId: null, harbingerId: null };
}

/**
 * Pure: at sim time `time`, is Logol present, and at which POI index? Shared by
 * the tick reconcile and by tests. Never draws from the shared rng stream.
 */
export function logolPresence(time: number): { present: boolean; poiIndex: number } {
  if (LOGOL_APPEAR_PERIOD <= 0 || LOGOL_POIS.length === 0) {
    return { present: false, poiIndex: 0 };
  }
  const windowIndex = Math.floor(time / LOGOL_APPEAR_PERIOD);
  const within = time - windowIndex * LOGOL_APPEAR_PERIOD;
  const present = within < LOGOL_VISIT_DURATION;
  // hash2 is a stateless pure hash in [0,1); it does NOT advance ctx.rng.
  const h = hash2(windowIndex, 0, LOGOL_POI_SALT);
  const poiIndex = Math.min(LOGOL_POIS.length - 1, Math.floor(h * LOGOL_POIS.length));
  return { present, poiIndex };
}

/**
 * Reconcile the live Logol entity against the clock each tick: spawn him at the
 * window's POI when he should be present and is absent; despawn him when the
 * window ends. Call once per tick from the coordinator, gated by
 * SimConfig.logolEnabled. He stands at his POI (no per-tick rng wander).
 */
export function updateLogolRoam(ctx: SimContext, state: LogolRoamState): void {
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

  const { present, poiIndex } = logolPresence(ctx.time);
  const existing = state.entityId !== null ? ctx.entities.get(state.entityId) : undefined;
  if (present) {
    if (existing) return;
    const def = NPCS[LOGOL_NPC_ID];
    if (!def) return;
    const poi = LOGOL_POIS[poiIndex];
    const npc = createNpc(ctx.nextId++, def, ctx.groundPos(poi.x, poi.z));
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
