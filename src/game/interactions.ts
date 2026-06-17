import { INTERACT_RANGE, dist2d, Entity } from '../sim/types';
import { MOBS } from '../sim/data';
import type { HoverCursorKind } from './cursors';
import type { IWorld } from '../world_api';

export interface PickInteractionWorld {
  player: IWorld['player'];
  playerId?: IWorld['playerId'];
  entities: IWorld['entities'];
  duelInfo?: IWorld['duelInfo'];
  arenaInfo?: IWorld['arenaInfo'];
  professionSkills: IWorld['professionSkills'];
  targetEntity(id: number | null): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
  pickUpObject(id: number): void;
  skin(mobId: number): void;
  startAutoAttack(): void;
}

// A looted, un-skinned beast corpse the player knows Skinning for. Loot comes
// first (the loot branch handles a still-lootable corpse), so this only fires
// once the corpse has no loot left.
function canSkin(world: PickInteractionWorld, e: Entity): boolean {
  if (e.kind !== 'mob' || !e.dead || e.lootable || e.skinned) return false;
  if (!MOBS[e.templateId]?.skinnable) return false;
  return world.professionSkills.skinning !== undefined;
}

export interface PickInteractionHud {
  openLoot(mobId: number, screenX: number, screenY: number): void;
  openQuestDialog(npcId: number): void;
  showError(text: string): void;
  closeContextMenu(): void;
}

export function isAttackHoverTarget(e: Entity | undefined): boolean {
  return hoverCursorKind(e, -1, new Set()) === 'attack';
}

export function activePvpOpponentIds(world: Pick<PickInteractionWorld, 'player' | 'playerId' | 'duelInfo' | 'arenaInfo'>): Set<number> {
  const ids = new Set<number>();
  const selfId = world.playerId ?? world.player.id;
  if (world.duelInfo?.state === 'active' && world.duelInfo.otherPid !== selfId) ids.add(world.duelInfo.otherPid);
  const match = world.arenaInfo?.match;
  if (match?.state === 'active') {
    if (match.oppPid !== selfId) ids.add(match.oppPid);
    for (const enemy of match.enemies) {
      if (enemy.pid !== selfId) ids.add(enemy.pid);
    }
  }
  return ids;
}

export function isAttackableEntity(
  e: Entity | undefined,
  playerId: number,
  activePvpOpponentSet: ReadonlySet<number> = new Set(),
): boolean {
  if (!e || e.dead || e.id === playerId) return false;
  if (e.kind === 'mob') return e.hostile;
  return e.kind === 'player' && activePvpOpponentSet.has(e.id);
}

/** Which game cursor to show when hovering an entity. */
export function hoverCursorKind(
  e: Entity | undefined,
  playerId: number,
  partyMemberIds: ReadonlySet<number>,
  activePvpOpponentSet: ReadonlySet<number> = new Set(),
): HoverCursorKind {
  if (!e) return 'default';
  if (isAttackableEntity(e, playerId, activePvpOpponentSet)) return 'attack';
  if (e.kind === 'npc') return 'friendly';
  if (e.kind === 'player' && e.id !== playerId) return 'friendly';
  void partyMemberIds;
  return 'default';
}

export function isActivePvpOpponent(world: PickInteractionWorld, e: Entity): boolean {
  return e.kind === 'player' && isAttackableEntity(e, world.playerId ?? world.player.id, activePvpOpponentIds(world));
}

export function handlePickedEntity(
  world: PickInteractionWorld,
  hud: PickInteractionHud,
  id: number,
  button: number,
  screenX: number,
  screenY: number,
): void {
  const e = world.entities.get(id);
  if (!e) return;

  if (e.kind !== 'object') world.targetEntity(id);

  if (button === 2) {
    const d = dist2d(world.player.pos, e.pos);
    // players: right-click only targets — the interaction menu lives on the
    // target portrait (right-click it), like classic-MMO unit frames
    if (e.kind === 'object') {
      if (d > INTERACT_RANGE + 1) { hud.showError('Too far away.'); return; }
      if (e.templateId === 'dungeon_door' && e.dungeonId) world.enterDungeon(e.dungeonId);
      else if (e.templateId === 'dungeon_exit') world.leaveDungeon();
      else world.pickUpObject(id);
    } else if (e.kind === 'mob' && e.dead && e.lootable) {
      if (d <= INTERACT_RANGE + 1) hud.openLoot(id, screenX, screenY);
      else hud.showError('Too far away.');
    } else if (canSkin(world, e)) {
      if (d <= INTERACT_RANGE + 1) world.skin(id);
      else hud.showError('Too far away.');
    } else if (e.kind === 'npc') {
      if (d <= INTERACT_RANGE + 2) {
        hud.openQuestDialog(id);
      }
      else hud.showError('Too far away.');
    } else if ((e.kind === 'mob' && !e.dead && e.hostile) || isActivePvpOpponent(world, e)) {
      world.startAutoAttack();
    }
  } else if (button === 0) {
    hud.closeContextMenu();
    if (e.kind === 'object') {
      const d = dist2d(world.player.pos, e.pos);
      if (d > INTERACT_RANGE + 1) return;
      if (e.templateId === 'dungeon_door' && e.dungeonId) world.enterDungeon(e.dungeonId);
      else if (e.templateId === 'dungeon_exit') world.leaveDungeon();
      else world.pickUpObject(id);
    } else if (e.kind === 'mob' && e.dead && e.lootable) {
      const d = dist2d(world.player.pos, e.pos);
      if (d <= INTERACT_RANGE + 1) hud.openLoot(id, screenX, screenY);
    } else if (canSkin(world, e)) {
      const d = dist2d(world.player.pos, e.pos);
      if (d <= INTERACT_RANGE + 1) world.skin(id);
    } else if (e.kind === 'npc') {
      // left-click talks too — Mac trackpads make right-click a chore;
      // out of range it just targets (no error spam while exploring)
      const d = dist2d(world.player.pos, e.pos);
      if (d <= INTERACT_RANGE + 2) {
        hud.openQuestDialog(id);
      }
    }
  }
}
