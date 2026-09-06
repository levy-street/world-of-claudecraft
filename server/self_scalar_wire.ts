// The self record's static combat-rating / progression scalar cohort plus the
// authoritative in-combat bit, emitted through the caller's delta-eliding
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
  'dodge',
  'blk',
  'bval',
  'crat',
  'hrat',
  'hirat',
  'ddiff',
  'cbt',
] as const;

export type SelfScalarKey = (typeof SELF_SCALAR_KEYS)[number];

export function emitSelfScalarKeys(
  emit: (key: SelfScalarKey, value: unknown) => void,
  meta: PlayerMeta,
  p: Entity,
  dungeonDifficulty: string,
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
  emit('dodge', p.dodgeChance);
  emit('blk', p.blockChance);
  emit('bval', p.blockValue);
  emit('crat', p.critRating);
  emit('hrat', p.hasteRating);
  emit('hirat', p.hitRating);
  emit('ddiff', dungeonDifficulty);
  // The sim's authoritative in-combat flag (the engaged pass in sim.ts: held on
  // a live mob's hate table, or the player's own 5 s linger). Without it the
  // online SELF mirror stayed at blankEntity's false forever, so the player
  // frame's crossed swords and the combat music rode a recent-personal-event
  // heuristic and never lit for a raider a boss held but who had not yet
  // traded a blow. A 0/1 bit rather than a boolean: it flips at most a few
  // times per fight, so the delta elision keeps it off the wire between flips.
  emit('cbt', p.inCombat ? 1 : 0);
}
