// The self record's static combat-rating / progression scalar cohort plus the
// authoritative in-combat bit and the death state (corpse position, the PvP
// Resurrect offer), emitted through the caller's delta-eliding
// closure (the `maybe(...)` in selfWireJson, server/game.ts). Every key here
// rides the wire only when its serialized value differs from what the session
// last received (a fresh session gets them all); the client treats an absent
// key as unchanged (src/net/combat_scalar_wire.ts is the decode side of the
// combat cohort, src/net/online.ts of the progression one).
//
// Moved out of the coordinator (the vault_wire.ts emitter convention) so a new
// self scalar lands here, not as another inline `maybe(...)` in game.ts. The
// registry of delta keys is pinned by ALL_DELTA_KEYS in tests/snapshots.test.ts,
// whose scrape reads this file like every other server emitter.
import { pvpResurrectBarred, pvpResurrectWaitSeconds } from '../src/sim/pvp/pvp_resurrect';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

/** Every key this emitter writes, for the unit pin (tests/server/self_scalar_wire.test.ts). */
export const SELF_SCALAR_KEYS = [
  'xp',
  'lxp',
  'rxp',
  'prk',
  'copper',
  'ap',
  'sp',
  'hpw',
  'sh',
  'crit',
  'scb',
  'dodge',
  'blk',
  'bval',
  'crat',
  'hrat',
  'hirat',
  'ddiff',
  'adiff',
  'udiff',
  'cbt',
  'mbr',
  'corpse',
  'pvr',
  'pvrw',
] as const;

export type SelfScalarKey = (typeof SELF_SCALAR_KEYS)[number];

export function emitSelfScalarKeys(
  emit: (key: SelfScalarKey, value: unknown) => void,
  meta: PlayerMeta,
  p: Entity,
  dungeonDifficulty: string,
  activeDungeonDifficulty: string | null = null,
  unappliedDungeonDifficulty: string | null = null,
): void {
  emit('xp', meta.xp);
  emit('lxp', meta.lifetimeXp);
  emit('rxp', Math.round(meta.restedXp));
  emit('prk', meta.prestigeRank);
  emit('copper', meta.copper);
  emit('ap', p.attackPower);
  emit('sp', p.spellPower);
  emit('hpw', p.healPower);
  emit('sh', p.spellHaste);
  emit('crit', p.critChance);
  // The shared crit core (rating + talent/set crit + flat crit auras) the spell
  // crit pool builds on: with it mirrored, the client's character sheet runs the
  // sim's own spellCritChance over the self entity instead of a second formula.
  // Gear/talent-rate like crit above, so the delta elision keeps it quiet.
  emit('scb', p.sharedCritBonus);
  emit('dodge', p.dodgeChance);
  emit('blk', p.blockChance);
  emit('bval', p.blockValue);
  emit('crat', p.critRating);
  emit('hrat', p.hasteRating);
  emit('hirat', p.hitRating);
  emit('ddiff', dungeonDifficulty);
  emit('adiff', activeDungeonDifficulty);
  // The tier the group's live claims still run on when the selection has not
  // reached them (null otherwise), so the portrait menu never shows a tier the
  // instances are not on. Flips only on a selection change or a claim change.
  emit('udiff', unappliedDungeonDifficulty);
  // The sim's authoritative in-combat flag (the engaged pass in sim.ts: held on
  // a live mob's hate table, or the player's own 5 s linger). Without it the
  // online SELF mirror stayed at blankEntity's false forever, so the player
  // frame's crossed swords and the combat music rode a recent-personal-event
  // heuristic and never lit for a raider a boss held but who had not yet
  // traded a blow. A 0/1 bit rather than a boolean: it flips at most a few
  // times per fight, so the delta elision keeps it off the wire between flips.
  emit('cbt', p.inCombat ? 1 : 0);
  emit('mbr', p.membershipActive === true);
  // Where the player's corpse lies while their spirit is a ghost (null otherwise).
  // Delta-guarded: ships on death-release and clears on resurrect. The client
  // draws the corpse marker and gates the resurrect-at-corpse button on it.
  emit('corpse', p.corpsePos);
  // The PvP Resurrect offer (src/sim/pvp/pvp_resurrect.ts), 0/1: lit only while
  // the raise would be honored, never for a corpse on the instance plane or in
  // jail (the button would show and do nothing). A released ghost keeps the
  // bit; the death screen hides the button for a ghost and the server re-checks
  // everything at the raise. Flips once per PvP death and once at the revive.
  const pvr = p.dead && p.pvpResurrect === true && !pvpResurrectBarred(p);
  emit('pvr', pvr ? 1 : 0);
  // Whole seconds left on that offer's wait (PVP_RESURRECT_WAIT_SECONDS at the
  // death), 0 once it may be taken or when there is no offer: the death screen's
  // countdown. Changes once a second for the wait only, then sits at 0.
  emit('pvrw', pvr ? pvpResurrectWaitSeconds(p) : 0);
}
