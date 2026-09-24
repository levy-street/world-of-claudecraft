// Deeprake (a common/rare Buried Hoard cave boss, a giant burrowing mole), the
// pure half: every tunable and where the ceiling comes down. No rng, no DOM: the
// renderer imports this file.
//
// The rule: he rakes the ground in front of him, digs under and erupts beneath
// one of the party (a circle marks the spot in time to step out), and on a rare
// map roars the ceiling down in patches that always leave room to move.
//
// Cues:
//   mole-swipe  his claw rake: a short, wide frontal
//   mole-burrow the circle he will erupt from, laid under a player; its clock
//               is the time he spends underground
//   mole-rock   one falling rock: a warning, then the impact

export const HOARD_MOLE_BOSS_TEMPLATE = 'hoard_boss_mole';

export const MOLE = Object.freeze({
  // ---- Claw Rake
  swipeRadius: 7,
  swipeHalfAngle: Math.PI * 0.33,
  swipeWindupSec: 1.8,
  swipeDamageFraction: 0.14,
  swipeFirstSec: 4,
  swipeEverySec: 9,
  /** The rake he follows an eruption with on a rare map or under pressure. */
  swipeFollowWindupSec: 0.9,
  // ---- Burrow
  burrowFirstSec: 12,
  burrowEverySec: 22,
  /** He digs in (a cast bar), tunnels (the circle's clock), then erupts. */
  burrowSec: 1.2,
  tunnelSec: 2.2,
  tunnelDoubleSec: 1.8,
  emergeSec: 0.8,
  eruptRadius: 4.5,
  eruptDamageFraction: 0.3,
  eruptKnockback: 4,
  // ---- Ceiling Collapse (rare maps only)
  rockFirstSec: 16,
  rockEverySec: 20,
  rockCastSec: 1.4,
  rockRadius: 3,
  rockWindupSec: 1.8,
  rockDamageFraction: 0.2,
  rockCount: 4,
  rockMax: 7,
  rockSpacing: 6.5,
  /** Rocks never land on (or right by) his eruption circle. */
  rockAvoidBurrow: 6,
  rockUnderPlayers: 2,
  rockRings: [10, 16] as readonly number[],
  /** Under pressure a second wave follows this long after the first. */
  rockSecondWaveSec: 2.5,
});

/** How many rocks one collapse drops. */
export function moleRockCount(players: number): number {
  return Math.min(MOLE.rockMax, MOLE.rockCount + Math.floor(Math.max(0, players - 1) / 2));
}
