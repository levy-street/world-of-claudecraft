// The two post-recovery sicknesses and the rules they share.
//
//  - Resurrection Sickness (player-facing display name "The Keeper's Toll"): the debuff a
//    Pale Keeper resurrection inflicts, up to 10 minutes.
//  - Unstuck Sickness: the debuff a completed /unstuck inflicts, up to 5 minutes. Unstuck
//    no longer kills or routes through the Pale Keeper, so this is the whole price it
//    charges for skipping the walk.
//
// Both are the same mechanic (a level-scaled whole-stat-block drain that cannot be shed by
// dying or relogging) with different ceilings, so they share one leaf module. It imports
// only ./types and the ./moderation leaf, so every death and respawn site (combat/damage,
// spirit, entity_roster, delves/runs) plus the two clean-slate wipes (social/arena,
// social/fiesta) can share the "which auras survive this wipe" predicates and the
// level-scaled duration WITHOUT an import cycle (spirit <-> entity_roster both need it).

import { CHEATER_MARK_AURA_ID } from './moderation';
import { type Aura, MAX_LEVEL } from './types';

export const RESURRECTION_SICKNESS_ID = 'resurrection_sickness';
export const UNSTUCK_SICKNESS_ID = 'unstuck_sickness';
// Classic-era rule: no resurrection sickness below this level. Unstuck Sickness follows it,
// so a brand-new character is never punished for using the recovery command.
export const RES_SICKNESS_MIN_LEVEL = 10;
export const UNSTUCK_SICKNESS_MIN_LEVEL = RES_SICKNESS_MIN_LEVEL;
// Duration bounds (seconds): the shortest drain at the minimum level, up to the full drain
// at max level. Classic scales the duration with level.
export const RES_SICKNESS_MIN_DURATION = 60;
export const RES_SICKNESS_DURATION = 600;
export const UNSTUCK_SICKNESS_MIN_DURATION = RES_SICKNESS_MIN_DURATION;
// Half the Pale Keeper's ceiling: 5 minutes at max level, which is exactly the /unstuck
// success cooldown, so the debuff runs out as the command becomes available again.
export const UNSTUCK_SICKNESS_DURATION = 300;
// The drain: all attributes to a quarter (a signed fraction; -0.75 = -75%). Shared, so the
// two sicknesses always weigh the same and differ only in how long they last.
export const RES_SICKNESS_STAT_MULT = -0.75;
export const UNSTUCK_SICKNESS_STAT_MULT = RES_SICKNESS_STAT_MULT;

// The two sickness aura ids. They are mutually exclusive on a player (see
// applySickness in ./spirit): both are `buff_allstats_pct`, and the stat block
// multiplies every such aura in turn, so two at once would compound to -93.75%.
export const SICKNESS_AURA_IDS: ReadonlySet<string> = new Set([
  RESURRECTION_SICKNESS_ID,
  UNSTUCK_SICKNESS_ID,
]);

// Seconds of sickness for a character of the given level. Zero below minLevel (classic
// exempts low levels); otherwise scales linearly from minDuration at that level to
// maxDuration at MAX_LEVEL.
function levelScaledSicknessDuration(
  level: number,
  minLevel: number,
  minDuration: number,
  maxDuration: number,
): number {
  if (level < minLevel) return 0;
  const span = MAX_LEVEL - minLevel;
  const t = span > 0 ? (level - minLevel) / span : 1;
  return Math.round(minDuration + t * (maxDuration - minDuration));
}

/** Seconds of Resurrection Sickness (The Keeper's Toll) for a character of this level. */
export function resSicknessDuration(level: number): number {
  return levelScaledSicknessDuration(
    level,
    RES_SICKNESS_MIN_LEVEL,
    RES_SICKNESS_MIN_DURATION,
    RES_SICKNESS_DURATION,
  );
}

/** Seconds of Unstuck Sickness for a character of this level. */
export function unstuckSicknessDuration(level: number): number {
  return levelScaledSicknessDuration(
    level,
    UNSTUCK_SICKNESS_MIN_LEVEL,
    UNSTUCK_SICKNESS_MIN_DURATION,
    UNSTUCK_SICKNESS_DURATION,
  );
}

// Auras that survive a death / respawn reset: both sicknesses (The Keeper's Toll
// and Unstuck Sickness), the Cauterize lockout ('cauterize_fatigue',
// combat/fire_mage.ts), the operator-applied Cheater mark (src/sim/moderation/),
// encounter-owned unbreakable control, and FLASK auras (Aura.flask, the alchemy
// apex consumable): a flask survives DEATH, which is what makes it worth
// carrying instead of the elixir of the same stat. Death only. Auras are
// session state and are not persisted, so a flask does NOT survive a deliberate
// logout, a linkdead grace that runs out (server/linkdead.ts holds a dropped
// session in-world for its grace window, so an ordinary reconnect inside it
// KEEPS the flask), or a realm restart; that is a deferred schema decision, not
// an oversight here. While dead the timer pauses with every other aura
// (updateAuras early-returns for a dead entity), so a death effectively extends
// a flask by the time spent dead. None may be shed by dying; the encounter script remains
// responsible for releasing its own control. Every other aura clears, Well Fed
// included. Used at every player death/respawn site so the rule cannot drift.
//
// The Cheater mark is here for the same reason the sicknesses are: its aura IS
// the played-seconds countdown, so a wipe that dropped it would end the sanction
// early and hand a marked player a one-keypress way out of it.
//
// The flask PvP accounting in full, corrected three times at the phase 10 QA
// (each fix round's review found a route or an attribution the previous cut
// missed). The clean slate below keeps ONLY the Cheater mark, and it is
// reached by THREE routes. (1) The DIRECT call, in exactly two places: the
// clearPrep arm of readyArenaFighter (social/arena.ts), which IS the clean
// slate, and a Fiesta down (fiestaDownEntity in social/fiesta.ts, which a
// Protect Yumi down runs too). (2) readyArenaFighter called with clearPrep:
// true: Thornhollow Fields (social/battleground.ts) at the seat, the countdown
// end, a leaver, and the match end; the Protect Yumi revive (social/yumi.ts)
// and the Fiesta revive; and the body of resetForArena. (3) resetForArena, the
// one-line wrapper around (2), which social/arena.ts runs at its own seat
// (startArenaMatch, every arena-family format), match end (endArenaMatch, the
// undefeated), and send-home (returnFromArena, everyone the seat wrote a
// return record for and who is still present), and which the SimContext seam
// (ctx.resetForArena) hands to call sites that never spell readyArenaFighter:
// the Protect Yumi match seat (the Vale Cup's kit-swap seat and match teardown
// were the other two until the Vale Cup retired with release/v0.41.0).
// So an instanced match is a parenthesis for a flask: nothing carried in rides
// through the gates, and nothing quaffed inside comes back out. The one PvP
// path that KEEPS a flask is a Thornhollow Fields DEATH: handleDeath runs this
// filter, the graveyard release runs it again, and the wave respawn raises the
// fighter with clearPrep: false, so a flask quaffed inside a match rides
// through every death in it (classic-era flasks persisted through battleground
// deaths, the recorded decision), until the match ends. (An arena death keeps
// it on the corpse the same way, until the send-home wipe.) Both halves
// pinned: behavior per mode in tests/arena.test.ts (seat, end, send-home),
// tests/battleground.test.ts, tests/yumi_match.test.ts and tests/fiesta.test.ts;
// the three caller sets, literally, in tests/resurrection.test.ts.
export function aurasSurvivingDeath(auras: readonly Aura[]): Aura[] {
  return auras.filter(
    (a) =>
      SICKNESS_AURA_IDS.has(a.id) ||
      a.kind === 'cauterize_fatigue' ||
      a.id === CHEATER_MARK_AURA_ID ||
      a.unbreakableControl === true ||
      a.flask === true,
  );
}

// Auras that survive a CLEAN-SLATE wipe: only the Cheater mark. The clearPrep
// arm of readyArenaFighter (the arm lives in social/arena.ts; it is reached
// from every instanced match's seat and end, the Thornhollow Fields gates, and
// every Fiesta and Yumi revive; see the three routes above) and a Fiesta down
// (social/fiesta.ts fiestaDownEntity) deliberately strip MORE than a death
// does, The Keeper's Toll included, so a normalized bout is decided by play
// and not by what each fighter walked in carrying. A sanction is not something
// the fighter walked in carrying: it is account state an operator applied, so
// it survives here exactly as it survives an ordinary death. Returns a NEW
// array, so the caller's assignment stays a replacement and never mutates the
// array it read.
export function aurasSurvivingCleanSlate(auras: readonly Aura[]): Aura[] {
  return auras.filter((a) => a.id === CHEATER_MARK_AURA_ID);
}
