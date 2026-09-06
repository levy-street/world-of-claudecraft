// The Rift Forge place gate: may this player forge (upgrade / socket a
// Riftbound ring) from where they stand?
//
// The forge is an NPC service, the bank precedent (bank.ts nearBanker): both
// forge operations in progression.ts refuse unless the player stands
// within reach of a riftForge-flagged NPC (the Riftwright, content/farshore.ts).
// The rule lives in the sim so all three hosts (offline browser, authoritative
// server, headless env) enforce it identically; the server's env gate
// (server/rift_forge_gate.ts) is only an ops kill switch above it.
//
// Reach is resolved through the spatial grid around the PLAYER rather than an
// anchor-id list seeded at construction (the bankerIds shape): forge commands
// ride the per-session command lane, never the 20 Hz loop, so a bounded radius
// query per attempt is the cheaper contract and needs no new Sim state.
// Draws no rng, mutates nothing.

import { NPCS } from '../data';
import type { SimContext } from '../sim_context';
import { type Entity, INTERACT_RANGE } from '../types';

/** How close a player must stand to the Riftwright: INTERACT_RANGE + 2,
 *  inclusive, the same reach the bank and the World Market use. */
export const RIFT_FORGE_RANGE = INTERACT_RANGE + 2;

/** True when `e` is a live NPC whose def carries the riftForge flag. */
export function isRiftForgeNpc(e: Entity): boolean {
  return e.kind === 'npc' && NPCS[e.templateId]?.riftForge === true;
}

/** True when the player entity stands within RIFT_FORGE_RANGE of a riftForge NPC. */
export function nearRiftForge(ctx: SimContext, p: Entity): boolean {
  let near = false;
  // The grid already filters on the squared radius (inclusive), so the
  // callback only has to recognize the NPC.
  ctx.grid.forEachInRadius(p.pos.x, p.pos.z, RIFT_FORGE_RANGE, (e) => {
    if (!near && isRiftForgeNpc(e)) near = true;
  });
  return near;
}

/** The English refusal line (re-localized by the client matcher, sim_i18n.ts). */
export const RIFT_FORGE_TOO_FAR_TEXT = 'You are too far from the Rift Forge.';
