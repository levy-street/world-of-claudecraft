import { dist2d, type Entity, INTERACT_RANGE } from '../sim/types';
import { t } from '../ui/i18n';
import { tSim } from '../ui/sim_i18n';
import type { IWorld } from '../world_api';
import { corpseLootAvailability } from './corpse_loot_availability';
import type { HoverCursorKind } from './cursors';
import type { InteractionOutcome } from './interaction_autorun';

export interface PickInteractionWorld {
  player: IWorld['player'];
  playerId?: IWorld['playerId'];
  entities: IWorld['entities'];
  duelInfo?: IWorld['duelInfo'];
  arenaInfo?: IWorld['arenaInfo'];
  targetEntity(id: number | null): void;
  enterDungeon(dungeonId: string): InteractionOutcome;
  leaveDungeon(): InteractionOutcome;
  pickUpObject(id: number): InteractionOutcome;
  startAutoAttack(): void;
  resurrectAtSpiritHealer(): InteractionOutcome;
}

export interface PickInteractionHud {
  openLoot(mobId: number, screenX: number, screenY: number): void;
  openQuestDialog(npcId: number): void;
  openDelveBoard(npcId: number): void;
  openMailbox(): void;
  showError(text: string): void;
  closeContextMenu(): void;
}

export function isAttackHoverTarget(e: Entity | undefined): boolean {
  return hoverCursorKind(e, -1, new Set()) === 'attack';
}

export function activePvpOpponentIds(
  world: Pick<PickInteractionWorld, 'player' | 'playerId' | 'duelInfo' | 'arenaInfo'>,
): Set<number> {
  const ids = new Set<number>();
  const selfId = world.playerId ?? world.player.id;
  if (world.duelInfo?.state === 'active' && world.duelInfo.otherPid !== selfId)
    ids.add(world.duelInfo.otherPid);
  const match = world.arenaInfo?.match;
  if (match?.state === 'active') {
    if (match.oppPid !== selfId) ids.add(match.oppPid);
    for (const enemy of match.enemies) {
      if (enemy.pid !== selfId) ids.add(enemy.pid);
    }
    // Protect Yumi: the ENEMY team's cat is an attackable objective (the
    // own cat stays out of the set, matching the sim hostility rule).
    const yumi = match.yumi;
    if (yumi) ids.add(yumi.team === 'A' ? yumi.yumiB.entityId : yumi.yumiA.entityId);
  }
  return ids;
}

// Re-pick cadence for the hover cursor while the pointer is stationary. A pointer
// move always re-picks immediately; this only bounds how fast the world can change
// WHICH entity sits under an unmoving cursor (a walking mob), so the scene raycast
// stops costing a full intersect pass on every frame of a still mouse.
export const HOVER_REPICK_MS = 50;

/** Gate for the per-frame hover raycast: pick when the pointer moved, otherwise at
 *  most every HOVER_REPICK_MS. Pure state machine (caller supplies the clock), so
 *  it unit-tests without DOM or timers. */
export class HoverPickGate {
  private x = Number.NaN;
  private y = Number.NaN;
  private nextAt = 0;

  shouldPick(x: number, y: number, nowMs: number): boolean {
    if (x === this.x && y === this.y && nowMs < this.nextAt) return false;
    this.x = x;
    this.y = y;
    this.nextAt = nowMs + HOVER_REPICK_MS;
    return true;
  }
}

export function isAttackableEntity(
  e: Entity | undefined,
  playerId: number,
  activePvpOpponentSet: ReadonlySet<number> = new Set(),
): boolean {
  if (!e || e.dead || e.id === playerId) return false;
  // A mob is attackable when wild-hostile OR a match objective in the
  // opponent set (the enemy Yumi cat carries hostile=false; its team
  // hostility lives in the sim rule, and activePvpOpponentIds mirrors it
  // here so every attack affordance agrees with the sim).
  if (e.kind === 'mob') return e.hostile || activePvpOpponentSet.has(e.id);
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
  return (
    e.kind === 'player' &&
    isAttackableEntity(e, world.playerId ?? world.player.id, activePvpOpponentIds(world))
  );
}

/** Whether an otherwise incomplete entity click represents a useful movement intent. */
export function shouldApproachPickedEntity(
  player: Entity,
  entity: Entity,
  didInteract: boolean,
  harvestStateReliable = true,
): boolean {
  if (didInteract || player.dead || entity.id === player.id) return false;
  const d = dist2d(player.pos, entity.pos);
  if (entity.dead) {
    return (
      entity.kind === 'mob' &&
      entity.lootable &&
      d > INTERACT_RANGE + 1 &&
      corpseLootAvailability(entity, player.id, harvestStateReliable).canOpen
    );
  }
  if (entity.kind === 'object') return d > INTERACT_RANGE;
  if (entity.kind === 'npc') return d > INTERACT_RANGE + 2;
  return true;
}

/** Route a picked entity and report only completed non-combat world interactions. */
export function handlePickedEntity(
  world: PickInteractionWorld,
  hud: PickInteractionHud,
  id: number,
  button: number,
  screenX: number,
  screenY: number,
  harvestStateReliable = true,
): InteractionOutcome {
  const e = world.entities.get(id);
  if (!e) return false;

  if (e.kind !== 'object') world.targetEntity(id);

  if (button === 2) {
    const d = dist2d(world.player.pos, e.pos);
    // players: right-click only targets — the interaction menu lives on the
    // target portrait (right-click it), like classic-MMO unit frames
    if (e.kind === 'object') {
      if (world.player.dead) {
        hud.showError(tSim('error.cantWhileDead'));
        return false;
      }
      if (d > INTERACT_RANGE) {
        hud.showError(t('questUi.errors.tooFar'));
        return false;
      }
      if (e.templateId === 'dungeon_door' && e.dungeonId) return world.enterDungeon(e.dungeonId);
      if (e.templateId === 'dungeon_exit') return world.leaveDungeon();
      if (e.templateId === 'mailbox') {
        hud.openMailbox();
        return true;
      }
      return world.pickUpObject(id);
    } else if (e.kind === 'mob' && e.dead && e.lootable) {
      if (world.player.dead) {
        hud.showError(tSim('error.cantWhileDead'));
        return false;
      }
      if (d <= INTERACT_RANGE + 1) {
        if (
          !corpseLootAvailability(e, world.playerId ?? world.player.id, harvestStateReliable)
            .canOpen
        )
          return false;
        hud.openLoot(id, screenX, screenY);
        return true;
      }
      hud.showError(t('questUi.errors.tooFar'));
      return false;
    } else if (e.kind === 'npc') {
      if (d <= INTERACT_RANGE + 2) {
        if (e.templateId === 'spirit_healer') {
          // The Spirit Healer resurrects a ghost in place (with Resurrection
          // Sickness). To the living it offers only watchful flavor.
          if (world.player.ghost) return world.resurrectAtSpiritHealer();
          else {
            hud.showError(t('hudChrome.death.spiritHealerAlive'));
            return false;
          }
        } else if (world.player.dead) {
          // Dead players and ghosts cannot talk to NPCs (the server refuses the
          // command too); do not open the quest dialog client-side.
          hud.showError(tSim('error.cantWhileDead'));
          return false;
        } else if (e.templateId === 'brother_halven' || e.templateId === 'brother_halven_marsh')
          hud.openDelveBoard(id);
        else hud.openQuestDialog(id);
        return true;
      }
      hud.showError(t('questUi.errors.tooFar'));
      return false;
    } else if (
      isAttackableEntity(e, world.playerId ?? world.player.id, activePvpOpponentIds(world))
    ) {
      // Right-click any attackable target (hostile mob, active PvP opponent,
      // or the enemy Yumi objective) to start auto-attack, the classic-MMO
      // convention the attack tooltip promises. A camera right-drag can't
      // reach this: clickPickFromMouseGesture drops a right gesture past the
      // drag threshold, so only a deliberate right-click attacks.
      world.startAutoAttack();
    }
    return false;
  } else if (button === 0) {
    hud.closeContextMenu();
    if (e.kind === 'object') {
      if (world.player.dead) {
        hud.showError(tSim('error.cantWhileDead'));
        return false;
      }
      const d = dist2d(world.player.pos, e.pos);
      if (d > INTERACT_RANGE) return false;
      if (e.templateId === 'dungeon_door' && e.dungeonId) return world.enterDungeon(e.dungeonId);
      if (e.templateId === 'dungeon_exit') return world.leaveDungeon();
      if (e.templateId === 'mailbox') {
        hud.openMailbox();
        return true;
      }
      return world.pickUpObject(id);
    } else if (e.kind === 'mob' && e.dead && e.lootable) {
      if (world.player.dead) {
        hud.showError(tSim('error.cantWhileDead'));
        return false;
      }
      const d = dist2d(world.player.pos, e.pos);
      if (d <= INTERACT_RANGE + 1) {
        if (
          !corpseLootAvailability(e, world.playerId ?? world.player.id, harvestStateReliable)
            .canOpen
        )
          return false;
        hud.openLoot(id, screenX, screenY);
        return true;
      }
    } else if (e.kind === 'npc') {
      // left-click talks too — Mac trackpads make right-click a chore;
      // out of range it just targets (no error spam while exploring)
      const d = dist2d(world.player.pos, e.pos);
      // No quest dialog while dead (the server refuses quest talk too); a ghost
      // takes the Spirit Healer res via right-click or the death panel button.
      if (d <= INTERACT_RANGE + 2 && !world.player.dead) {
        if (e.templateId === 'brother_halven' || e.templateId === 'brother_halven_marsh')
          hud.openDelveBoard(id);
        else hud.openQuestDialog(id);
        return true;
      }
    }
  }
  return false;
}
