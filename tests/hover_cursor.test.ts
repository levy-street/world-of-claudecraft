import { describe, expect, it, vi } from 'vitest';
import type { HoverCursorKind } from '../src/game/cursors';
import { createHoverCursorUpdate, type HoverCursorHost } from '../src/game/hover_cursor';
import { FIREBOTTLE_ITEM_ID } from '../src/sim/interactions/firebottle_hut';
import { MUDFIN_HUT_TEMPLATE_ID } from '../src/sim/mudfin_huts';
import type { Entity, InvSlot } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

// The world hover cursor moved whole out of main.ts (src/game/hover_cursor.ts). These pin
// what the bootstrap relied on: the seat cursor only when nothing else is under the
// pointer, the gated re-pick, and the cursor kind re-resolving from live entity state.

function mob(partial: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    kind: 'mob',
    templateId: 'wolf',
    hostile: true,
    dead: false,
    hp: 10,
    ...partial,
  } as Entity;
}

function harness(opts: { picked?: number | null; seat?: boolean; modal?: boolean } = {}) {
  const entities = new Map<number, Entity>();
  const cursors: HoverCursorKind[] = [];
  const inventory: InvSlot[] = [];
  const world = {
    player: { id: 1 },
    playerId: 1,
    entities,
    partyInfo: null,
    duelInfo: null,
    arenaInfo: null,
    bgInfo: null,
    inventory,
  } as unknown as IWorld;
  const input = {
    hoverActive: true,
    hoverX: 10,
    hoverY: 20,
    isDragging: () => false,
    setHoverCursor: (kind: HoverCursorKind) => {
      cursors.push(kind);
    },
  };
  const hud = {
    isModalOpen: () => opts.modal ?? false,
    clearHoverTooltip: vi.fn(),
    showMobHoverTooltip: vi.fn(),
    showPlayerHoverTooltip: vi.fn(),
  };
  const picking = {
    pick: vi.fn(() => opts.picked ?? null),
    pickPlacedMover: vi.fn(() => null),
  };
  const seatHover = vi.fn(() => opts.seat ?? false);
  const host = { world, input, hud, picking, seatHover } as unknown as HoverCursorHost;
  return {
    update: createHoverCursorUpdate(host),
    entities,
    inventory,
    cursors,
    input,
    hud,
    picking,
    seatHover,
  };
}

describe('createHoverCursorUpdate', () => {
  it('shows the default cursor and no card while a modal is open, without a pick', () => {
    const h = harness({ modal: true, seat: true });
    h.update();
    expect(h.cursors).toEqual(['default']);
    expect(h.hud.clearHoverTooltip).toHaveBeenCalledTimes(1);
    expect(h.picking.pick).not.toHaveBeenCalled();
  });

  it('wears the seat cursor over a seat when no entity is under the pointer', () => {
    const h = harness({ seat: true });
    h.update();
    expect(h.cursors).toEqual(['seat']);
    expect(h.seatHover).toHaveBeenCalledWith(10, 20);
  });

  it('an entity under the pointer outranks a seat and is not asked about seats', () => {
    const h = harness({ picked: 2, seat: true });
    h.entities.set(2, mob());
    h.update();
    expect(h.cursors).toEqual(['attack']);
    expect(h.seatHover).not.toHaveBeenCalled();
    expect(h.hud.showMobHoverTooltip).toHaveBeenCalledTimes(1);
  });

  it('re-resolves the kind from live state between gated re-picks', () => {
    const h = harness({ picked: 2 });
    const wolf = mob();
    h.entities.set(2, wolf);
    h.update();
    wolf.dead = true;
    wolf.hp = 0;
    h.update();
    // the pointer did not move, so the second frame reuses the first pick
    expect(h.picking.pick).toHaveBeenCalledTimes(1);
    expect(h.cursors).toEqual(['attack', 'default']);
    expect(h.hud.clearHoverTooltip).toHaveBeenCalledTimes(1);
  });

  it('wears the gear over a torchable hut only while the firebottle is in the bags', () => {
    const h = harness({ picked: 7 });
    h.entities.set(7, {
      id: 7,
      kind: 'object',
      templateId: MUDFIN_HUT_TEMPLATE_ID,
      lootable: true,
      dead: false,
    } as Entity);
    h.update();
    h.inventory.push({ itemId: FIREBOTTLE_ITEM_ID, count: 1 } as InvSlot);
    h.update();
    h.inventory.length = 0;
    h.update();
    // the bags are read live each frame: no re-pick needed for the cursor to follow
    expect(h.picking.pick).toHaveBeenCalledTimes(1);
    expect(h.cursors).toEqual(['default', 'gear', 'default']);
    expect(h.hud.clearHoverTooltip).toHaveBeenCalled();
  });

  it('re-picks at once when the pointer moves', () => {
    const h = harness();
    h.update();
    h.input.hoverX = 11;
    h.update();
    expect(h.picking.pick).toHaveBeenCalledTimes(2);
    expect(h.picking.pick).toHaveBeenLastCalledWith(11, 20);
  });
});
