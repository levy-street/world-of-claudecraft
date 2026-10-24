// The world hover cursor and the mouseover tooltip, moved whole out of main.ts (the
// bootstrap firewall): the cursor kind under the pointer (attack, friendly, a vault door's
// hand, a seat, the gear over a hut the carried firebottle torches) and the mob or player
// card beside it. main.ts calls the returned update once a frame.

import type { WorldPicking } from '../render/world_picking';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import type { Input } from './input';
import { activePvpOpponentIds, HoverPickGate, hoverCursorKind } from './interactions';
import { pickPlacedMoverAt } from './placed_mover_input';

export interface HoverCursorHost {
  world: Pick<
    IWorld,
    | 'player'
    | 'playerId'
    | 'entities'
    | 'partyInfo'
    | 'duelInfo'
    | 'arenaInfo'
    | 'bgInfo'
    // the bags, for the quest-item gear over a torchable hut (hut_torch.ts)
    | 'inventory'
  >;
  input: Pick<Input, 'hoverActive' | 'hoverX' | 'hoverY' | 'isDragging' | 'setHoverCursor'>;
  hud: {
    isModalOpen(): boolean;
    clearHoverTooltip(): void;
    showMobHoverTooltip(entity: Entity, pvpOpponents: ReadonlySet<number>): void;
    showPlayerHoverTooltip(entity: Entity): void;
  };
  picking: Pick<WorldPicking, 'pick' | 'pickPlacedMover'>;
  /** Whether a seat the camera can see is under a screen point (seat_interact.ts). */
  seatHover(x: number, y: number): boolean;
}

export function createHoverCursorUpdate(host: HoverCursorHost): () => void {
  const { world, input, hud, picking } = host;

  function partyMemberIds(ids: Set<number>): Set<number> {
    ids.clear();
    for (const m of world.partyInfo?.members ?? []) {
      if (m.pid !== world.playerId) ids.add(m.pid);
    }
    return ids;
  }

  // The scene raycast is the expensive half of the hover cursor; the gate re-picks
  // on pointer movement (instantly) or every HOVER_REPICK_MS while stationary. The
  // cursor KIND below still re-resolves every frame from live entity state, so a
  // hovered mob dying or turning hostile updates without waiting for a re-pick.
  const hoverPickGate = new HoverPickGate();
  let hoverPickedId: number | null = null;
  let hoverOnMover = false;
  let hoverSeat = false;
  const hoverPartyMemberIds = new Set<number>();
  const hoverPvpOpponentIds = new Set<number>();

  return function updateHoverCursor(): void {
    if (!input.hoverActive || input.isDragging() || hud.isModalOpen()) {
      input.setHoverCursor('default');
      hud.clearHoverTooltip();
      return;
    }
    if (hoverPickGate.shouldPick(input.hoverX, input.hoverY, performance.now())) {
      hoverPickedId = picking.pick(input.hoverX, input.hoverY);
      // a vault door under the cursor wears the hand, like a friendly NPC
      hoverOnMover =
        hoverPickedId === null && pickPlacedMoverAt(picking, input.hoverX, input.hoverY) !== null;
      hoverSeat = hoverPickedId === null && host.seatHover(input.hoverX, input.hoverY);
    }
    const entity = hoverPickedId !== null ? world.entities.get(hoverPickedId) : undefined;
    const pvpOpponents = activePvpOpponentIds(world, hoverPvpOpponentIds);
    input.setHoverCursor(
      hoverOnMover
        ? 'friendly'
        : !entity && hoverSeat
          ? 'seat'
          : hoverCursorKind(
              entity,
              world.playerId,
              partyMemberIds(hoverPartyMemberIds),
              pvpOpponents,
              world.inventory,
            ),
    );
    // WoW-style mouseover tooltip (name / level / creature type) for a mob under
    // the cursor, reusing the same (gated) pick this function already does for
    // the hover-cursor kind above; the tooltip content still re-resolves every
    // frame from live entity state, so counts and death update without a re-pick.
    if (entity && entity.kind === 'mob' && !entity.dead) {
      hud.showMobHoverTooltip(entity, pvpOpponents);
    } else if (entity && entity.kind === 'player' && entity.id !== world.playerId && !entity.dead) {
      hud.showPlayerHoverTooltip(entity);
    } else {
      hud.clearHoverTooltip();
    }
  };
}
