import { INTERACT_RANGE, dist2d } from '../sim/types';
import type { IWorld } from '../world_api';
import { t } from '../i18n';

export interface PickInteractionWorld {
  player: IWorld['player'];
  entities: IWorld['entities'];
  targetEntity(id: number | null): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
  pickUpObject(id: number): void;
  startAutoAttack(): void;
}

export interface PickInteractionHud {
  openLoot(mobId: number, screenX: number, screenY: number): void;
  openQuestDialog(npcId: number): void;
  showError(text: string): void;
  closeContextMenu(): void;
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
    // target portrait (right-click it), like classic WoW unit frames
    if (e.kind === 'object') {
      if (d > INTERACT_RANGE + 1) { hud.showError(t('interact.tooFar')); return; }
      if (e.templateId === 'dungeon_door' && e.dungeonId) world.enterDungeon(e.dungeonId);
      else if (e.templateId === 'dungeon_exit') world.leaveDungeon();
      else world.pickUpObject(id);
    } else if (e.kind === 'mob' && e.dead && e.lootable) {
      if (d <= INTERACT_RANGE + 1) hud.openLoot(id, screenX, screenY);
      else hud.showError(t('interact.tooFar'));
    } else if (e.kind === 'npc') {
      if (d <= INTERACT_RANGE + 2) hud.openQuestDialog(id);
      else hud.showError(t('interact.tooFar'));
    } else if (e.kind === 'mob' && !e.dead && e.hostile) {
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
    } else if (e.kind === 'npc') {
      // left-click talks too — Mac trackpads make right-click a chore;
      // out of range it just targets (no error spam while exploring)
      const d = dist2d(world.player.pos, e.pos);
      if (d <= INTERACT_RANGE + 2) hud.openQuestDialog(id);
    }
  }
}
