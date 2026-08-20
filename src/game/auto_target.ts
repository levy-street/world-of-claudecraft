// Picking an enemy for a pad player who pressed an ability without one.
//
// A mouse player targets by clicking what they can see, so a targetless cast is a
// slip. A pad player has no such gesture: they see a wolf, press the attack they
// know, and the cast refuses. That is the first thing a new controller player
// hits, so the press selects for them rather than answering with an error.
//
// FFXIV added exactly this in 6.1 (Auto-Target Settings), with the same choice of
// priority; nearest is the arm implemented here.
//
// Pure: the caller supplies the attackable predicate (the client already owns one)
// and the entity list, so no world handle and no DOM.

/** The little the picker reads off an entity. */
export interface AutoTargetEntity {
  id: number;
  pos: { x: number; z: number };
}

/** The ability fields that decide whether a target is needed at all. */
export interface AutoTargetAbility {
  requiresTarget?: boolean;
  targetType?: string;
}

/** How far out to look, in yards. Matches the client's own attack-nearest reach,
 *  so the press picks the same enemy that key would. */
export const AUTO_TARGET_RANGE = 40;

/**
 * Whether this press should choose an enemy first.
 *
 * Only for abilities that actually need a hostile target: a heal or a buff would
 * otherwise yank the player off the ally they meant, and an untargeted AoE is
 * already legal and must stay that way.
 */
export function shouldAutoTarget(
  ability: AutoTargetAbility | null | undefined,
  hasLiveHostileTarget: boolean,
): boolean {
  if (!ability?.requiresTarget) return false;
  if (ability.targetType === 'friendly') return false;
  return !hasLiveHostileTarget;
}

/**
 * The nearest attackable entity, or null when nothing qualifies. `isAttackable` is
 * the caller's own rule (faction, dead, pvp opt-in), so this never second-guesses
 * who may be attacked; it only answers which of them is closest.
 */
export function nearestAutoTarget(
  entities: Iterable<AutoTargetEntity>,
  origin: { x: number; z: number },
  isAttackable: (e: AutoTargetEntity) => boolean,
  range = AUTO_TARGET_RANGE,
): number | null {
  let best: number | null = null;
  let bestDistance = range;
  for (const e of entities) {
    if (!isAttackable(e)) continue;
    const d = Math.hypot(origin.x - e.pos.x, origin.z - e.pos.z);
    if (d < bestDistance) {
      best = e.id;
      bestDistance = d;
    }
  }
  return best;
}
