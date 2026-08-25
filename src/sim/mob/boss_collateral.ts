// A boss whose slams hurt EVERYTHING standing in them, not just the raid.
//
// Every telegraphed detonation in this repo walks `ctx.players` and nothing else, which is
// correct for a dungeon pull inside a sealed room and badly wrong for a world boss rampaging
// through an inhabited zone. Balgath's whole premise is that he leaves the barrow and smashes
// up the town: a fist that craters the road while the two boars standing in the crater are
// untouched reads as a scripted set piece rather than as a monster loose in the world. It
// also has real gameplay weight, since the wildlife he wanders through is exactly what a
// player would otherwise pull on top of the raid.
//
// Opt-in per template (`MobTemplate.collateral`) so it is inert for every mob shipped before
// it: an existing boss's detonations keep hitting exactly who they hit, in exactly the same
// order, drawing exactly the same rng.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import type { Entity } from '../types';
import { isAmbientMob } from './ambient';

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Splash one blast onto every other creature standing inside it.
 *
 * `blastMin`/`blastMax` are the ability's AUTHORED bounds and the splash takes their
 * midpoint, deliberately not a fresh roll and deliberately not the number the player arm
 * happened to draw. Both alternatives are worse in the same way: they make the damage a
 * bystander takes depend on how many players were in the blast, or on nothing at all when
 * the blast caught no players. The midpoint also draws NO rng, so the count of wildlife that
 * happens to be standing in a crater cannot shift the shared random stream and fork two
 * otherwise identical worlds (`src/sim/CLAUDE.md`, Determinism).
 *
 * Returns how many creatures were hit, which is what the tests assert on.
 */
export function splashNearbyMobs(
  ctx: SimContext,
  mob: Entity,
  center: { x: number; z: number },
  radius: number,
  blastMin: number,
  blastMax: number,
  school: string,
  name: string,
  /**
   * Extra shape test, for a blast that is not a full circle. The cleave passes its arc here
   * so the arm does not somehow kill the boar standing BEHIND him, which is the one thing a
   * radius-only splash gets visibly wrong.
   */
  accept?: (e: Entity) => boolean,
): number {
  const def = MOBS[mob.templateId]?.collateral;
  if (!def) return 0;
  const amount = Math.max(
    1,
    Math.round(((blastMin + blastMax) / 2) * def.mult * (mob.mechanicDamageMult ?? 1)),
  );
  let hit = 0;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.id === mob.id) continue;
    // Quest visions are set dressing standing inside a scripted memory, not creatures; the
    // shipped hostility rule already refuses to let anything harm them.
    if (e.templateId.startsWith('vision_')) continue;
    // A mob that broke leash is walking home immune (combat/damage.ts); skip it here too so
    // the count this returns matches the damage that actually landed.
    if (e.aiState === 'evade') continue;
    if (dist2d(e.pos, center) > radius) continue;
    if (accept && !accept(e)) continue;
    ctx.dealDamage(mob, e, amount, false, school, name, 'hit', true);
    if (!e.dead) enrageAgainst(e, mob, amount);
    hit++;
  }
  return hit;
}

/**
 * A creature the boss just hurt turns on him.
 *
 * dealDamage's own threat arm deliberately requires a player-ish source, so without this a
 * splashed boar takes the hit, plays its flinch, and goes back to grazing beside the thing
 * that is levelling its home, which reads as the wildlife being furniture. The hate is
 * seeded at a multiple of the damage so a mob already skirmishing with a passing player is
 * NOT instantly stolen (the normal 110%/130% switch rules in mob/targeting.ts still apply);
 * a previously idle one starts chasing the boss on its next update.
 *
 * "Him and/or people nearby" falls out of the same threat table: once the creature is in
 * combat, anyone who hits it competes for its attention under the ordinary rules.
 *
 * Skips: a SUMMONED mob (a player's pet has its own owner-driven AI and must never be
 * re-targeted under them) and an AMBIENT wanderer (decorative by contract: never hostile,
 * never combat, and its update path does not run the combat states this would leave it in).
 */
function enrageAgainst(victim: Entity, boss: Entity, damage: number): void {
  if (victim.ownerId !== null || isAmbientMob(victim)) return;
  addThreat(victim, boss.id, damage * 2);
  if (victim.aggroTargetId === null || victim.aiState === 'idle') {
    victim.aggroTargetId = boss.id;
    victim.aiState = 'chase';
    victim.inCombat = true;
  }
}
