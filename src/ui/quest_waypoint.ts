// Pure, host-agnostic core for the focused-quest waypoint. It answers two
// questions, both DOM/Three-free so they unit-test without a browser or a camera
// (mirrors the compass.ts / xp_bar.ts pure-core split):
//
//   1. WHERE in the world the focused quest points right now
//      (`questWaypointTarget`): the {x,z} of the first incomplete objective's
//      location, or the turn-in NPC once the quest is ready to hand in.
//   2. WHICH WAY the on-screen arrow should point (`screenArrowDeg`): the
//      rotation, in degrees, for an up-pointing glyph anchored above the player to
//      aim from one projected screen point toward another (the heading to the
//      target), so the arrow tracks the target as the player moves and turns.
//
// The thin consumer (hud.ts#updateQuestWaypoint) projects the player and a point
// toward the target via the renderer, feeds the two screen points to (2), and
// formats the distance through formatNumber. Quest/NPC/camp/object positions are
// static client-side content (the sim/data tables hud.ts already imports), so no
// IWorld surface is added: the same tables resolve identically in the offline Sim
// and the online ClientWorld, which is why this stays a pure ui helper rather than
// an IWorld method implemented twice.

import type { CampDef, GroundObjectDef, MobTemplate, NpcDef, QuestDef, QuestProgress, QuestState } from '../sim/types';
import { questTurnInNpcIds } from '../sim/types';
import { CAMPS, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from '../sim/data';

/** A world-space point (yard-space x east/west, z north/south). */
export interface WaypointPos {
  x: number;
  z: number;
}

/** The static content the target derivation reads, injected so the resolution is
 *  testable against fixtures rather than the live (and evolving) content tables. */
export interface WaypointContent {
  quests: Record<string, QuestDef>;
  npcs: Record<string, NpcDef>;
  camps: readonly CampDef[];
  groundObjects: readonly GroundObjectDef[];
  /** Map an item id to the id of a mob that drops it, if any. */
  mobForItem(itemId: string): string | undefined;
}

/** Build the item-id -> dropping-mob-id index once. The first mob found to drop
 *  an item wins; ties do not matter because we only need *a* camp to point at. */
export function buildMobDropIndex(mobs: Record<string, MobTemplate>): Map<string, string> {
  const index = new Map<string, string>();
  for (const mobId of Object.keys(mobs)) {
    for (const entry of mobs[mobId].loot) {
      if (entry.itemId && !index.has(entry.itemId)) index.set(entry.itemId, mobId);
    }
  }
  return index;
}

let cachedContent: WaypointContent | null = null;

/** The live content tables bound to a memoised mob-drop index. Lazily built so
 *  importing this module (e.g. for the pure-math tests) costs nothing until the
 *  HUD actually resolves a waypoint. */
export function defaultWaypointContent(): WaypointContent {
  if (!cachedContent) {
    const dropIndex = buildMobDropIndex(MOBS);
    cachedContent = {
      quests: QUESTS,
      npcs: NPCS,
      camps: CAMPS,
      groundObjects: GROUND_OBJECTS,
      mobForItem: (itemId) => dropIndex.get(itemId),
    };
  }
  return cachedContent;
}

function npcPos(npcId: string | undefined, content: WaypointContent): WaypointPos | null {
  if (!npcId) return null;
  const npc = content.npcs[npcId];
  return npc ? { x: npc.pos.x, z: npc.pos.z } : null;
}

/** The quest's turn-in NPC position (first resolvable of turnInNpcIds). */
function turnInPos(quest: QuestDef, content: WaypointContent): WaypointPos | null {
  for (const id of questTurnInNpcIds(quest)) {
    const pos = npcPos(id, content);
    if (pos) return pos;
  }
  return null;
}

/** The center of the camp for `mobId` nearest the player (camps repeat a mob in
 *  several places, so point at the closest one as the player travels). */
function nearestCampCenter(mobId: string, player: WaypointPos, content: WaypointContent): WaypointPos | null {
  let best: WaypointPos | null = null;
  let bestDist = Infinity;
  for (const camp of content.camps) {
    if (camp.mobId !== mobId) continue;
    const d = sqDist(camp.center, player);
    if (d < bestDist) {
      bestDist = d;
      best = { x: camp.center.x, z: camp.center.z };
    }
  }
  return best;
}

/** The nearest placed position of the ground object that yields `itemId`. */
function nearestObjectPos(itemId: string, player: WaypointPos, content: WaypointContent): WaypointPos | null {
  let best: WaypointPos | null = null;
  let bestDist = Infinity;
  for (const obj of content.groundObjects) {
    if (obj.itemId !== itemId) continue;
    for (const pos of obj.positions) {
      const d = sqDist(pos, player);
      if (d < bestDist) {
        bestDist = d;
        best = { x: pos.x, z: pos.z };
      }
    }
  }
  return best;
}

function sqDist(a: WaypointPos, b: WaypointPos): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Planar (x,z) distance between two world points, in yards. */
export function waypointDistance(a: WaypointPos, b: WaypointPos): number {
  return Math.sqrt(sqDist(a, b));
}

/** Resolve the world point the focused quest currently points at, or null when
 *  it cannot be located (no arrow is better than a wrong arrow). Once the quest
 *  is ready it points at the turn-in NPC; otherwise it points at the first
 *  incomplete objective's location, by objective type:
 *    - interact + targetNpcId        -> that NPC's fixed position
 *    - interact/collect + objectItem -> nearest matching ground object
 *    - kill + targetMobId            -> nearest camp center for that mob
 *    - collect + itemId (mob drop)   -> nearest camp of a mob that drops it
 *  Anything unresolvable falls back to the turn-in NPC. */
export function questWaypointTarget(
  progress: QuestProgress,
  state: QuestState,
  player: WaypointPos,
  content: WaypointContent,
): WaypointPos | null {
  const quest = content.quests[progress.questId];
  if (!quest) return null;

  if (state === 'ready' || progress.state === 'ready') return turnInPos(quest, content);

  const idx = quest.objectives.findIndex((obj, i) => (progress.counts[i] ?? 0) < obj.count);
  if (idx < 0) return turnInPos(quest, content); // all met but not yet ready: head to turn-in
  const obj = quest.objectives[idx];

  switch (obj.type) {
    case 'interact':
      return npcPos(obj.targetNpcId, content)
        ?? (obj.targetObjectItemId ? nearestObjectPos(obj.targetObjectItemId, player, content) : null)
        ?? turnInPos(quest, content);
    case 'kill':
      return (obj.targetMobId ? nearestCampCenter(obj.targetMobId, player, content) : null)
        ?? turnInPos(quest, content);
    case 'collect':
      if (obj.targetObjectItemId) {
        return nearestObjectPos(obj.targetObjectItemId, player, content) ?? turnInPos(quest, content);
      }
      if (obj.itemId) {
        const mobId = content.mobForItem(obj.itemId);
        const camp = mobId ? nearestCampCenter(mobId, player, content) : null;
        return camp ?? turnInPos(quest, content);
      }
      return turnInPos(quest, content);
    default:
      return turnInPos(quest, content);
  }
}

/** Convenience binding over the live sim/data content. */
export function questWaypointTargetFor(progress: QuestProgress, state: QuestState, player: WaypointPos): WaypointPos | null {
  return questWaypointTarget(progress, state, player, defaultWaypointContent());
}

// ---------------------------------------------------------------------------
// On-screen arrow heading
// ---------------------------------------------------------------------------

/** A point in screen space (renderer-viewport pixels, y down). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A projected screen point that also reports whether it fell behind the camera.
 *  `behind` (or a non-finite coordinate) means the perspective divide mirrored it,
 *  so its position is unreliable for a heading. Mirrors the renderer's
 *  `worldToScreen` return shape so the consumer passes it straight through. */
export interface ScreenProbe extends ScreenPoint {
  behind: boolean;
}

/** The rotation (degrees, clockwise, normalised to [0,360)) for an UP-pointing
 *  arrow glyph anchored at `from` to aim toward `to` in screen space (y down). 0
 *  keeps the glyph pointing up (target straight ahead/up), 90 right, 180 down, 270
 *  left. The consumer projects the player anchor (`from`) and a point a few yards
 *  toward the target (`to`) and rotates the head-mounted arrow by this. */
export function screenArrowDeg(from: ScreenPoint, to: ScreenPoint): number {
  // up = (0,-1) which is atan2(-1,0) = -90deg; add 90 so straight-up aim is 0deg.
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90;
  return ((deg % 360) + 360) % 360;
}

function usableProbe(p: ScreenProbe): boolean {
  return !p.behind && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Pick the arrow heading from `base` given two probes a short step toward and
 *  away from the target. Prefers the toward probe; when it is behind the camera
 *  (the projection mirrors it, which would point the arrow ~180deg the wrong way
 *  exactly when the target is behind the player) it falls back to the away probe,
 *  which is then in front, and flips the heading 180deg. Returns null when neither
 *  probe is usable (both behind / non-finite) so the caller hides the arrow. */
export function arrowHeadingDeg(base: ScreenPoint, toward: ScreenProbe, away: ScreenProbe): number | null {
  if (usableProbe(toward)) return screenArrowDeg(base, toward);
  if (usableProbe(away)) return (screenArrowDeg(base, away) + 180) % 360;
  return null;
}
