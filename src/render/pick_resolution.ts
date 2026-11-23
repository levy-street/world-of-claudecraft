import { isLootableBody } from '../sim/corpse_loot_state';
import type { Entity } from '../sim/types';

type PickEntity = Pick<Entity, 'id' | 'kind' | 'dead' | 'lootable'>;

function lootableCorpse(e: PickEntity): boolean {
  return isLootableBody(e);
}

// A live, selectable creature: a mob or player still standing. Excludes
// 'npc' and 'object' (a lootable corpse must never lose priority to a
// non-combat NPC or a world prop standing behind it) and anything dead.
// Issue #2787: this is the pick priority a click resolves to before it is
// allowed to fall into the dead-corpse loot branch below.
function isLiveTargetable(e: PickEntity): boolean {
  return (e.kind === 'mob' || e.kind === 'player') && !e.dead;
}

// The USE-ONLY bodies this click was aimed at, nearest first: the live mobs
// the caller's predicate names (a mob the local player can use, cannot attack
// and aimed this click at: the Hollow Crypt's Remembrance Candle during
// Morthen's Rite, see world_direct_pick.ts; the predicate is all this file
// knows of it). One exception keeps a click where it landed: when the NEAREST
// live hit is a player (a healer clicking the party member who is lighting the
// candle), there are none, and ray order stands.
function aimedUseOnlyBodies<E extends PickEntity>(
  live: readonly E[],
  isUseOnlyBody: ((e: E) => boolean) | null,
): E[] {
  if (!isUseOnlyBody || live.length === 0 || live[0].kind === 'player') return [];
  return live.filter((e) => e.kind === 'mob' && isUseOnlyBody(e));
}

export function resolveDirectPickEntityId<E extends PickEntity>(
  hitEntityIds: readonly number[],
  entities: Pick<Map<number, E>, 'get'>,
  currentTargetId: number | null = null,
  isUseOnlyBody: ((e: E) => boolean) | null = null,
): number | null {
  const ordered: E[] = [];
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

  const liveTargets = ordered.filter(isLiveTargetable);
  const liveLeads = isLiveTargetable(ordered[0]) || lootableCorpse(ordered[0]);

  // A click AIMED at a use-only body selects that body, full stop: before any
  // cycling, whatever stands nearer on the ray and whatever the player holds as
  // target. A boss whose wide click capsule stands between the camera and the
  // candle used to take every click on it, and with the boss already targeted
  // (the normal state when the Rite begins) overlap cycling stepped on to
  // whichever add was also under the cursor. A repeat click keeps the body: it
  // does not step to the next hit, so a double click or a spammed right click
  // cannot alternate between candle and boss. The mob that stands exactly in
  // front of the body stays reachable by clicking it anywhere off the body's
  // aim core, by its nameplate (the renderer answers that before any raycast),
  // by Tab and by the Attack Move key. Two aimed bodies in one stack: nearest
  // first, and a repeat click alternates between those two only.
  if (liveLeads) {
    const bodies = aimedUseOnlyBodies(liveTargets, isUseOnlyBody);
    if (bodies.length > 0) {
      const held = bodies.findIndex((e) => e.id === currentTargetId);
      return bodies[(held + 1) % bodies.length].id;
    }
  }

  // Issue #2787: in a cluster with some mobs already dead, the raycast often
  // hits a corpse's capsule first (whichever body is visually in front) even
  // when a live mob or player is ALSO in the hit set, just farther along the
  // ray. Opening the loot popup for that corpse instead of selecting the
  // still-fighting mob is the "hard to target the last living mob" bug: the
  // nearest live hit wins over a leading corpse before the loot/cycle logic
  // below ever runs.
  // Large raid-boss click proxies can overlap smaller adds. Once the nearest
  // live hit is already selected, another click on the same stack advances to
  // the next live target instead of selecting the boss again forever.
  if (liveLeads && liveTargets.length > 1 && currentTargetId !== null) {
    const idx = liveTargets.findIndex((e) => e.id === currentTargetId);
    if (idx >= 0) return liveTargets[(idx + 1) % liveTargets.length].id;
  }
  if (lootableCorpse(ordered[0]) && liveTargets.length > 0) return liveTargets[0].id;

  const corpses = ordered.filter(lootableCorpse);
  if (lootableCorpse(ordered[0]) && corpses.length > 1 && currentTargetId !== null) {
    const idx = corpses.findIndex((e) => e.id === currentTargetId);
    if (idx >= 0) return corpses[(idx + 1) % corpses.length].id;
  }
  return ordered[0].id;
}
