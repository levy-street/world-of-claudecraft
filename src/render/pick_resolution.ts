import type { Entity } from '../sim/types';

type PickEntity = Pick<Entity, 'id' | 'kind' | 'dead' | 'lootable'>;

function lootableCorpse(e: PickEntity): boolean {
  return e.kind === 'mob' && e.dead && e.lootable;
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

  const corpses = ordered.filter(lootableCorpse);
  if (lootableCorpse(ordered[0]) && corpses.length > 1 && currentTargetId !== null) {
    const idx = corpses.findIndex((e) => e.id === currentTargetId);
    if (idx >= 0) return corpses[(idx + 1) % corpses.length].id;
  }
  return ordered[0].id;
}
