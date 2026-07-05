// Spawns a player's "Echo of You" voice NPC (docs/prd/woc/voice-npc.md), once
// their voice_npc_grants row is 'ready' server-side. Mirrors
// src/sim/encounters/nythraxis.ts's spawnNythraxisAldric: look up the static
// NpcDef, instantiate it at runtime via createNpc, then apply per-instance
// field overrides (here: the player-chosen display name and the per-player
// cloned-voice clip base URL, see the npcNameOverride/npcVoiceClipBaseUrl
// fields on Entity). Deterministic: no Math.random/Date.now/performance.now,
// positioning uses only ctx.groundPos relative to the player's own position.

import { VOICE_ECHO_NPC_ID } from './content/voice_npc';
import { NPCS } from './data';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';

// Spawn a few yards in front of the player so the NPC is immediately visible
// without overlapping them.
const SPAWN_OFFSET_Z = 3;

export interface VoiceNpcGrantInfo {
  displayName: string;
  clipBaseUrl: string;
}

/**
 * Spawn the caller's voice-echo NPC near their current position. No-op if the
 * player entity is missing (disconnected mid-grant) or the static def isn't
 * registered. The caller (Sim.grantVoiceNpc, wired from server/game.ts) is
 * responsible for idempotency (only call this once per character, persisted).
 */
export function spawnVoiceNpcEcho(ctx: SimContext, pid: number, grant: VoiceNpcGrantInfo): void {
  const def = NPCS[VOICE_ECHO_NPC_ID];
  if (!def) return;
  const player = ctx.entities.get(pid);
  if (!player) return;

  const spawnPos = ctx.groundPos(player.pos.x, player.pos.z + SPAWN_OFFSET_Z);
  const npc = createNpc(ctx.nextId++, def, spawnPos);
  npc.facing = player.facing;
  npc.prevFacing = player.facing;
  npc.spawnPos = { ...npc.pos };
  // Per-player UGC overrides: never written back into the static def, never
  // localized (see src/sim/content/CLAUDE.md's UGC exception).
  const displayName = grant.displayName.trim();
  if (displayName) npc.npcNameOverride = displayName;
  if (grant.clipBaseUrl) npc.npcVoiceClipBaseUrl = grant.clipBaseUrl;
  ctx.addEntity(npc);
}
