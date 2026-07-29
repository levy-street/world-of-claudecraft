import type { Entity } from '../sim/types';

type PickEntity = Pick<Entity, 'id' | 'kind' | 'dead' | 'lootable'>;

function lootableCorpse(e: PickEntity): boolean {
  return e.kind === 'mob' && e.dead && e.lootable;
}

// A live, selectable creature: a mob or player still standing. Excludes
// 'npc' and 'object' (a lootable corpse must never lose priority to a
// non-combat NPC or a world prop standing behind it) and anything dead.
// Issue #2787: this is the pick priority a click resolves to before it is
// allowed to fall into the dead-corpse loot branch below.
function isLiveTargetable(e: PickEntity): boolean {
  return (e.kind === 'mob' || e.kind === 'player') && !e.dead;
}

export function resolveDirectPickEntityId(
  hitEntityIds: readonly number[],
  entities: Pick<Map<number, PickEntity>, 'get'>,
  currentTargetId: number | null = null,
): number | null {
  const ordered: PickEntity[] = [];
  const seen = new Set<number>();
  for (const id of hitEntityIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = entities.get(id);
    if (!e) continue;
    if (e.kind === 'object' && !e.lootable) return null;
    if (e.kind === 'mob' && e.dead && !e.lootable) continue;
    ordered.push(e);
  }
  if (ordered.length === 0) return null;

  // Issue #2787: in a cluster with some mobs already dead, the raycast often
  // hits a corpse's capsule first (whichever body is visually in front) even
  // when a live mob or player is ALSO in the hit set, just farther along the
  // ray. Opening the loot popup for that corpse instead of selecting the
  // still-fighting mob is the "hard to target the last living mob" bug: the
  // nearest live hit wins over a leading corpse before the loot/cycle logic
  // below ever runs.
  if (lootableCorpse(ordered[0])) {
    const live = ordered.find(isLiveTargetable);
    if (live) return live.id;
  }

  const corpses = ordered.filter(lootableCorpse);
  if (lootableCorpse(ordered[0]) && corpses.length > 1 && currentTargetId !== null) {
    const idx = corpses.findIndex((e) => e.id === currentTargetId);
    if (idx >= 0) return corpses[(idx + 1) % corpses.length].id;
  }
  return ordered[0].id;
}
