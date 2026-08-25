import { GPU_WORK_PRIORITY } from './background_gpu_queue';

/** The subset of a scene node the priority walk reads (Three-free). */
export interface CompilePriorityNode {
  userData: { entityId?: unknown };
  parent: CompilePriorityNode | null;
}

/** A live compile gate rides ACTIONABLE_VIEW when the target sits under the
 *  player's current target entity OR under an entity that is CASTING, and
 *  LIVE_VIEW otherwise.
 *
 *  The cast arm is not a nicety: a mob casting at a player it has aggro on is
 *  actionable information the player reacts to (interrupt, step out, line of
 *  sight) whether or not that player happens to have it targeted, so its
 *  programs must not link behind the background lane and land after the cast
 *  bar is already draining.
 *
 *  `isCasting` is optional so a caller with no sim in hand keeps the old
 *  behavior; it is asked only about the entity ids the ancestry walk finds. */
export function compilePriorityForTarget(
  target: CompilePriorityNode,
  playerTargetId: number | null,
  isCasting: (entityId: number) => boolean = () => false,
): number {
  let current: CompilePriorityNode | null = target;
  while (current) {
    const entityId = current.userData.entityId;
    if (entityId === playerTargetId) return GPU_WORK_PRIORITY.ACTIONABLE_VIEW;
    if (typeof entityId === 'number' && isCasting(entityId)) {
      return GPU_WORK_PRIORITY.ACTIONABLE_VIEW;
    }
    current = current.parent;
  }
  return GPU_WORK_PRIORITY.LIVE_VIEW;
}

/** Entry admission: actionable views and views the entry manifest itself
 * awaits may compile before first paint. Ordinary live views keep their canvas
 * stand-in until the shared first-paint gate releases. */
export function compileMayStartBeforeInitialPaint(
  priority: number,
  requiredForEntry = false,
): boolean {
  return requiredForEntry || priority >= GPU_WORK_PRIORITY.ACTIONABLE_VIEW;
}

/** The one predicate the renderer feeds compilePriorityForTarget: casting AT
 *  the local player, never casting at all. A 20-strong crowd trading abilities
 *  among itself made every crowd view ACTIONABLE and starved the reveal lane's
 *  decor keys past their watchdog (batch 28); what the player must react to is
 *  a cast aimed at them. Pure: the sim stays behind the lookup callback. */
export function castingAtPlayerPredicate(
  lookup: (id: number) => { castingAbility?: string | null; targetId?: number | null } | undefined,
  playerId: number,
): (id: number) => boolean {
  return (id) => {
    const caster = lookup(id);
    return Boolean(caster?.castingAbility) && caster?.targetId === playerId;
  };
}
