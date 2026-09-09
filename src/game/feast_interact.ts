import { isFeastTemplateId } from '../sim/professions/feast';
import { dist2d, type Entity, INTERACT_RANGE, type Vec3 } from '../sim/types';

/** Nearest placed feast entity within reach of the player, by 2D distance, or
 *  null. A feast is the kind:'object' entity carrying a templateId
 *  `isFeastTemplateId` admits (src/sim/professions/feast.ts derives the family
 *  from the catalog, so every tier is in reach of one press): it is not
 *  lootable and owns no pickup item, so no other funnel arm ever competes for
 *  it. The boundary is
 *  INCLUSIVE (`<= INTERACT_RANGE`) to mirror the sim's own deny,
 *  `dist2d(p.pos, entity.pos) > INTERACT_RANGE`, which answers the merged not-found frame
 *  (farmDenied 'feast_expired', the existence-oracle guard in
 *  consumeFeastAction), so the client never refuses a press
 *  the sim would accept and never sends one the sim would fold into
 *  not-found. Ties go to the
 *  first entity in iteration order (the strict `<` on best keeps the earlier
 *  one), the farm_bed_interact comparator exactly. Pure module: no DOM, no
 *  Three, no HUD. */
export function nearestInteractableFeast(
  entities: ReadonlyMap<number, Entity>,
  playerPos: Vec3,
): number | null {
  let bestId: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of entities.values()) {
    if (entity.kind !== 'object' || !isFeastTemplateId(entity.templateId)) continue;
    const distance = dist2d(playerPos, entity.pos);
    if (distance <= INTERACT_RANGE && distance < bestDistance) {
      bestId = entity.id;
      bestDistance = distance;
    }
  }
  return bestId;
}
