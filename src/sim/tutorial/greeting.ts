// The spawn greeting (tutorial island): the one-time, text-free ferry that
// puts every genuinely fresh character on the Proving Shore. The tutorial is
// compulsory (never asked, never skippable); the pier bell is the way back
// off at any time.
//
// The sweep mirrors professions/prof_nudges.ts: 1 Hz beside the other mail
// phase sweeps, zero rng (it only emits events, which draw nothing), so its
// tick-tail position cannot fork the deterministic draw order. The one-shot
// flag (PlayerMeta.tutorialGreetingSent, the guildLetterSent idiom) is
// flipped BEFORE the emit so a re-entrant load can never double-fire, and it
// latches SILENTLY for an established character (an old save from before the
// tutorial shipped must not be greeted like a newborn).
//

// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic.

import { isOnProvingShore, PROVING_SHORE_ARRIVAL } from '../content/proving_shore';
import { DUNGEON_X_THRESHOLD } from '../data';
import { displacePlayer } from '../displacement';
import { emitIslandArrival } from '../interactions/ferry_bell';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** A character the greeting should engage for: one that has done nothing at
 *  all yet. Established characters (any XP, any quest history) latch the
 *  flag silently instead, so a pre-tutorial save is never greeted. */
function isFreshCharacter(meta: PlayerMeta): boolean {
  return meta.lifetimeXp === 0 && meta.questsDone.size === 0 && meta.questLog.size === 0;
}

/** The greeting one-shot: engage once ever, on the character's first swept
 *  tick. Flips the persisted flag BEFORE acting (the prof_nudges idiom).
 *  Returns whether it engaged.
 *
 *  The tutorial is COMPULSORY for a fresh character (the playtest ruling:
 *  never ask, never offer a skip): a newborn already ashore (the server
 *  rolls fresh rows at PROVING_SHORE_ARRIVAL) gets Odo's arrival welcome,
 *  and a fresh character anywhere else (the offline Sim's town spawn, a
 *  legacy save that never played) is ferried straight to the island. The
 *  bell beside the pier remains the way OFF at any time, so the shore is
 *  never a cage, just the front door. The old opt-in tutorialGreeting
 *  dialog (Bryn's take-or-skip offer) is gone with the choice itself. */
export function maybeEmitTutorialGreeting(meta: PlayerMeta, ctx: SimContext): boolean {
  if (meta.tutorialGreetingSent) return false;
  meta.tutorialGreetingSent = true;
  if (!isFreshCharacter(meta)) return false;
  const p = ctx.entities.get(meta.entityId);
  if (!p) return false;
  // The sibling command path's gates (resolveStartTutorial): never yank a
  // ghost away from their corpse, and never teleport out of the instance
  // plane. A fresh character can only be either through an odd resume, but
  // the flag has already latched by here, so failing closed just means they
  // walk to the pier bell themselves.
  if (p.dead || p.ghost) return false;
  if (p.pos.x > DUNGEON_X_THRESHOLD) return false;
  if (!isOnProvingShore(p.pos.x, p.pos.z)) {
    displacePlayer(ctx, p, PROVING_SHORE_ARRIVAL, 'The ferry sets you down on the Proving Shore.');
  }
  emitIslandArrival(ctx, p, meta);
  return true;
}

/** The 1 Hz tick sweep (called from the mail phase of Sim.tick, beside
 *  updateProfNudges): evaluates every player on the PostOffice's once-a-second
 *  cadence. Zero rng, so its position in the tick tail cannot fork the draw
 *  order (it only emits events, which draw nothing). */
export function updateTutorialGreeting(ctx: SimContext, primaryPid: number): void {
  // The host opt-in (SimConfig.compulsoryTutorial): a deterministic test,
  // parity trace, or RL episode must never see a fresh character ferried
  // away mid-scenario, so the sweep only runs where a live world asked.
  if (!ctx.compulsoryTutorial) return;
  if (ctx.tickCount % 20 !== 0) return;
  for (const meta of ctx.players.values()) {
    // Only REAL characters ride the compulsory ferry: a persisted row
    // (characterId, the server join path; a bare null-state harness join is
    // latched at join instead) or the offline Sim's own primary player.
    // Everything else addPlayer mints (dev bots, probe fixtures on a live
    // server sim) has no character to teach and stays where it was put.
    if (meta.characterId === undefined && meta.entityId !== primaryPid) continue;
    maybeEmitTutorialGreeting(meta, ctx);
  }
}

/** The ferry ride the greeting's accept button books: the standard
 *  displacement recipe (displacement.ts; the island ships NO walk-in portal
 *  ring, PROVING_SHORE_PORTALS is deliberately empty and the crossing is a
 *  clicked bell), gated so it can never be abused as a
 *  free escape teleport. Server-validated: level 1, alive (the caller's dead
 *  gate), out of combat, overworld only. The persisted flag guards only the
 *  greeting EMIT, so this command-side gate set is what keeps the wire token
 *  from doubling as an unmetered combat exit. */
export function resolveStartTutorial(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.pos.x > DUNGEON_X_THRESHOLD || p.inCombat) {
    ctx.error(p.id, 'You cannot set sail from here.');
    return;
  }
  if (p.level > 1) {
    ctx.error(p.id, 'The Proving Shore has nothing left to teach you.');
    return;
  }
  displacePlayer(ctx, p, PROVING_SHORE_ARRIVAL, 'The ferry sets you down on the Proving Shore.');
  // Text-free arrival marker: the HUD renders Ferryman Odo's welcome note,
  // which teaches walking and talking, for a character new to the shore.
  emitIslandArrival(ctx, p, meta);
}
