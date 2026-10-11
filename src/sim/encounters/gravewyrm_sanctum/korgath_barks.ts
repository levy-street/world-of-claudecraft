// Korgath's voice before his pull (the playtest asked the foreman to SPEAK as
// the group clears the wings below his terrace). He is chained to the seal
// pillars of the Lock Terrace, the living lock on the seal; every chain struck
// off in his fight frees one more part of him (korgath.ts). So while the
// packs of the two wings fall (the Serac Field and the Anchor Ledge,
// SANCTUM_WING_PACKS, the same five the Chain Stairs wait on) he shouts down
// at the group, torn between the lock he keeps and the chains he wants gone,
// louder with every pack that dies:
//
//   1 pack down   he hears them on the ledges
//   2             he boasts of the four chains the Smith laid on him
//   3             he dares them to strike the chains, then remembers the lock
//   4             he begs, a thousand winters chained: unchain me
//   5 (all clear) the grates rise: come up and break me loose
//
// Each line plays ONCE per claim, on the yell channel (a bubble over him and
// a chat line), and only while a living claim player stands within
// KORGATH_BARK_RANGE of him (his voice carries across the gulf to the wings,
// never back up the Sledge Road). A line earned while nobody is in range
// waits; when several wait, only the newest is said (the older ones are
// spent with it), so a group arriving late hears one line, not a speech.
// Silent once his fight has begun, and once he is dead.
//
// Sim English, re-localized by the client's EXACT matcher (src/ui/sim_i18n.ts
// `log.sanctumKorgathBark1` to `5`). Zero rng; the per-claim memory dies with
// the claim (the rune wall's precedent, rune_wall.ts).

import { SANCTUM_WING_PACKS } from '../../content/gravewyrm_sanctum';
import { dungeonPacksDead } from '../../instances/dungeon_gates';
import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity } from '../../types';
import { claimPlayers } from './claim';

/** His lines as the wing packs fall, by how many are down (1 to 5). */
export const KORGATH_BARKS: readonly string[] = [
  'Who walks the ledges? The foreman hears your little hammers.',
  'Four chains the Smith laid on me. Four! Do you hear them sing?',
  'Strike them, then. Strike the chains, mortals... and see what they hold back!',
  'A thousand winters I have kept this lock. Unchain me! Unchain me!',
  'The grates rise. Climb to the terrace and break me loose, if your arms can bear it!',
];

/** How near a living claim player must stand for a line to be said (yards
 *  from Korgath): the wings across the gulf, never the road above. Also the
 *  yell's own reach. */
export const KORGATH_BARK_RANGE = 120;

interface BarkMemory {
  /** The claim the memory belongs to (its exit entity). */
  claim: number | null;
  /** How many lines have been spent (said, or skipped for a newer one). */
  spent: number;
}

// Keyed by the slot record of ONE world (rune_wall.ts's precedent).
const memory = new WeakMap<InstanceSlot, BarkMemory>();

/** How many of the wing packs are dead now (0 to 5). */
export function wingPacksDown(ctx: SimContext, inst: InstanceSlot): number {
  let n = 0;
  for (const pack of SANCTUM_WING_PACKS) if (dungeonPacksDead(ctx, inst, [pack])) n++;
  return n;
}

/** Is a living claim player within KORGATH_BARK_RANGE of him? */
function heard(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  for (const p of claimPlayers(ctx, inst))
    if (!p.dead && dist2d(p.pos, boss.pos) <= KORGATH_BARK_RANGE) return true;
  return false;
}

/** One tick of his barks (before his fight). Returns the line said, or null. */
export function tickKorgathBarks(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity | null,
): string | null {
  if (!boss || boss.dead || boss.inCombat) return null;
  let m = memory.get(inst);
  if (!m || m.claim !== inst.exitId) {
    m = { claim: inst.exitId, spent: 0 };
    memory.set(inst, m);
  }
  if (m.spent >= KORGATH_BARKS.length) return null;
  const down = Math.min(KORGATH_BARKS.length, wingPacksDown(ctx, inst));
  if (down <= m.spent || !heard(ctx, inst, boss)) return null;
  m.spent = down;
  const line = KORGATH_BARKS[down - 1];
  emitMobYell(ctx, boss, line, KORGATH_BARK_RANGE);
  return line;
}
