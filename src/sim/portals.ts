// Paired overworld portals: the seamless cave transitions between zone bands
// that no road connects (the Veiled Hollow), and the tolled waystone arches
// (the Wyrmgate Waystone, content/drakelands.ts). A portal is pure data
// (PORTALS in data.ts) checked per live player in the tick, right after
// dungeon door triggers: no entities, no instance slots, and no rng draws, so
// it runs byte-identically in the offline browser, the server, and the
// headless env. A toll is settled by portal_toll.ts before any move.
//
// The teleport recipe mirrors instances/dungeons.ts enterDungeon: reground,
// kill the interpolation streak, rebucket, drop target and auto-attack, then
// emit the flavor line in the same arcane #b9f the dungeon transitions use.

import { DUNGEON_X_THRESHOLD, PORTALS } from './data';
import { displacePlayer } from './displacement';
import { settlePortalToll } from './portal_toll';
import type { SimContext } from './sim_context';
import type { Entity, PortalSide } from './types';

const PORTAL_TRIGGER_RADIUS = 2.0; // matches DOOR_TRIGGER_RADIUS

function dist2dTo(p: Entity, side: PortalSide): number {
  const dx = p.pos.x - side.x,
    dz = p.pos.z - side.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function teleport(ctx: SimContext, p: Entity, to: PortalSide, text: string): void {
  // The shared displacement recipe (displacement.ts): teardown, reground,
  // rebucket, settle, flavor line, extracted once the tutorial ferry became
  // its third copy.
  displacePlayer(ctx, p, to.landing, text);
}

export function updatePortalTriggers(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;
  if (p.pos.x > DUNGEON_X_THRESHOLD) return; // instances have their own exits
  for (const portal of PORTALS) {
    const radius = portal.radius > 0 ? portal.radius : PORTAL_TRIGGER_RADIUS;
    const inA = dist2dTo(p, portal.a) < radius;
    const inB = !inA && dist2dTo(p, portal.b) < radius;
    if (!inA && !inB) {
      // Out of this portal's trigger: a refused traveler's latch re-arms, so
      // the next approach (with coin, or without) reads fresh.
      if (p.portalHoldId === portal.id) p.portalHoldId = undefined;
      continue;
    }
    // The toll (portal_toll.ts) is settled first: an unpaid crossing refuses
    // once and moves nobody. `return`, not `continue`: the player is inside
    // THIS portal's trigger, and no two portals overlap.
    if (!settlePortalToll(ctx, p, portal)) return;
    if (inA) teleport(ctx, p, portal.b, portal.enterText);
    else teleport(ctx, p, portal.a, portal.leaveText);
    return;
  }
}
