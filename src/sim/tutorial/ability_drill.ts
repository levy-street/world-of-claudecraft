// The ability lesson (tutorial island): sim-side, server-authoritative credit
// for q_ps_hone_the_edge, the effigy yard's SECOND drill.
//
// Strike True teaches the swing. It does not teach that the row of buttons
// along the bottom of the screen is the game, so a new player leaves the
// island auto-attacking. This drill fixes that: land your CLASS's own attack
// on the effigies, three times, and the coach names the button per class
// rather than saying "press 1" at a mage.
//
// Two problems the drill has to solve, both found by auditing the level-1
// kits (starting_attack.ts):
//
//   Paladin had NO offensive press at all. Fixed at the source by moving
//   Hammer of Grace to level 1 (content/paladin_core_abilities.ts), so the
//   drill needs nothing special for them.
//
//   Warrior's Reaver Strike costs 15 rage and a fresh warrior has zero until
//   they have already swung, so the button is greyed out exactly when the
//   coach is pointing at it. Rather than change the class, the YARD hands
//   the rage over: while this quest is active and the player is standing in
//   the drill ring, a rage class is topped up to the cost of the press the
//   lesson is asking for. It is scoped to the quest AND the ring, so it
//   cannot follow anyone into a real fight, and it ends with the hand-in.
//
// The objective is a sentinel 'interact' with no ground entity of its own
// (the ps_gauntlet_flag / signpost_read.ts idiom): the credit rides the
// damage the ability actually deals, so the count can never disagree with
// what the player did.
//
// Zero rng (it credits a count, emits events, and clamps one resource bar),
// so its position in the damage and tick paths cannot fork the draw order.
// `src/sim`-pure: no DOM/render/ui/game/net imports, no Math.random/Date.now
// (tests/architecture.test.ts).

import { QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { isAttackAbility, startingAttackFor } from './starting_attack';

export const ABILITY_DRILL_QUEST_ID = 'q_ps_hone_the_edge';
export const ABILITY_DRILL_OBJECT_ITEM_ID = 'ps_ability_drill';

/** The quarry: the same straw effigies Strike True uses, so the drill needs
 *  no new content and the yard stays one place. */
export const ABILITY_DRILL_MOB_ID = 'training_effigy';

/** The drill ring: centred on the effigy cluster (content/proving_shore.ts
 *  spawns them between x -341 and -331, z -20 and -9) and wide enough to
 *  cover Drillmaster Rook's shoulder at (-345, -11), so a warrior walking
 *  the yard is inside it the whole lesson. Pinned against both in
 *  tests/ability_drill.test.ts. */
export const ABILITY_DRILL_RING = { x: -336, z: -14, radius: 18 } as const;

/** Resource bars that start a fight EMPTY. Only these get the yard's top-up;
 *  a mana or energy class walks in able to press their button already. */
const TOPPED_UP_RESOURCES: ReadonlySet<string> = new Set(['rage']);

function inDrillRing(e: Entity): boolean {
  const dx = e.pos.x - ABILITY_DRILL_RING.x;
  const dz = e.pos.z - ABILITY_DRILL_RING.z;
  return dx * dx + dz * dz <= ABILITY_DRILL_RING.radius * ABILITY_DRILL_RING.radius;
}

/** Is this player mid-drill? The one gate both halves below share. */
function drillActive(meta: PlayerMeta): boolean {
  return meta.questLog.get(ABILITY_DRILL_QUEST_ID)?.state === 'active';
}

/**
 * Credit one landed ability, called from dealDamage once a hit has actually
 * been applied.
 *
 * Guards, in the order that makes the common case cheapest: the target has
 * to be an effigy (which exist only in this yard), the source a player, and
 * the ability the one THIS class was taught. An autoattack carries no
 * abilityId and so credits nothing, which is the whole point of the drill.
 */
export function creditAbilityDrill(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  abilityId: string | null,
): void {
  if (!abilityId) return;
  if (target.templateId !== ABILITY_DRILL_MOB_ID) return;
  if (source.kind !== 'player') return;
  const meta = ctx.players.get(source.id);
  if (!meta || !drillActive(meta)) return;
  // ANY authored attack counts, not just the one the coach names.
  //
  // Keying on the taught id alone looked tidy and was wrong three ways: a
  // warrior's Reaver Strike is onNextSwing and lands through the auto-attack
  // path, a talent action-replacement swaps the button's id out from under
  // the player (a rogue's Wicked Slash becomes Haymaker under Redline), and
  // a player who dings mid-drill may press something they only just learned.
  // The lesson is "use an ability instead of a plain swing", and an
  // autoattack carries no abilityId at all, so that is the honest test.
  if (!isAttackAbility(abilityId)) return;

  const qp = meta.questLog.get(ABILITY_DRILL_QUEST_ID);
  if (!qp) return;
  const objective = QUESTS[ABILITY_DRILL_QUEST_ID]?.objectives[0];
  if (!objective || objective.type !== 'interact') return;
  if (objective.targetObjectItemId !== ABILITY_DRILL_OBJECT_ITEM_ID) return;
  const current = qp.counts[0] ?? 0;
  if (current >= objective.count) return;
  qp.counts[0] = current + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
}

/**
 * The yard's rage loan, swept per tick beside the island's other sweeps.
 *
 * A rage class standing in the drill ring with the lesson active never drops
 * below the cost of the press the coach is naming, so the button the player
 * is being told to click is never greyed out. Deliberately a FLOOR rather
 * than a grant: it never adds rage above the cost, so it cannot be farmed
 * into a real fight, and stepping out of the ring or handing the quest in
 * ends it immediately.
 */
export function updateAbilityDrill(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    if (!drillActive(meta)) continue;
    const taught = startingAttackFor(meta.cls);
    if (!taught.needsResourceFirst) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || p.ghost) continue;
    if (!TOPPED_UP_RESOURCES.has(p.resourceType ?? '')) continue;
    if (!inDrillRing(p)) continue;
    if (p.resource >= taught.resourceCost) continue;
    p.resource = Math.min(taught.resourceCost, p.maxResource);
  }
}
