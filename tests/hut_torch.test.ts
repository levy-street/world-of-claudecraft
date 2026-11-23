// The Mirefen hut torch made easy ("Back to the Shallows", q_deepfen_purge): walk
// up to a mudfin hut and a click on it (either button), the interact key, the
// gamepad press or the mobile interact button throws the carried firebottle for
// you, and the cursor wears the gear over a hut while the bottle is in the bags.
// Every link is pinned here: the client predicates (src/game/hut_torch.ts), the
// hover cursor rule and its art, the click and press handlers routing a hut to
// pickUpObject, and the authoritative sim answering both pickUpObject and
// interact with the throw (src/sim/interactions/firebottle_hut.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CURSOR_GEAR, cursorForHover } from '../src/game/cursors';
import { carriesFirebottle, isTorchableHut } from '../src/game/hut_torch';
import {
  handlePickedEntity,
  hoverCursorKind,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import {
  type NearbyInteractionHud,
  type NearbyInteractionWorld,
  tryNearbyInteraction,
} from '../src/game/nearby_interaction';
import {
  FIREBOTTLE_ITEM_ID,
  HUT_OBJECT_ID,
  HUT_QUEST_ID,
} from '../src/sim/interactions/firebottle_hut';
import { MUDFIN_HUT_MODELS, MUDFIN_HUT_TEMPLATE_ID, MUDFIN_HUTS } from '../src/sim/mudfin_huts';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, QuestProgress, SimEvent } from '../src/sim/types';

const BOTTLE: InvSlot = { itemId: FIREBOTTLE_ITEM_ID, count: 1 } as InvSlot;

function hutEntity(partial: Partial<Entity> = {}): Entity {
  return {
    id: 40,
    kind: 'object',
    templateId: MUDFIN_HUT_TEMPLATE_ID,
    objectItemId: HUT_OBJECT_ID,
    name: 'Mudfin Hut',
    lootable: true,
    dead: false,
    pos: { x: 0, y: 0, z: 0 },
    auras: [],
    ...partial,
  } as Entity;
}

function onQuest(): Map<string, QuestProgress> {
  return new Map([
    [HUT_QUEST_ID, { questId: HUT_QUEST_ID, counts: [0], state: 'active' } as QuestProgress],
  ]);
}

describe('hut torch predicates', () => {
  it('knows a torchable hut: the quest object, while it can be used', () => {
    expect(isTorchableHut(hutEntity())).toBe(true);
    expect(isTorchableHut(hutEntity({ lootable: false }))).toBe(false);
    expect(isTorchableHut(hutEntity({ templateId: 'ground_supply_crate' }))).toBe(false);
    expect(isTorchableHut(hutEntity({ kind: 'mob' }))).toBe(false);
  });

  it('knows whether the bags hold the firebottle', () => {
    expect(carriesFirebottle(undefined)).toBe(false);
    expect(carriesFirebottle([])).toBe(false);
    expect(carriesFirebottle([{ itemId: 'linen_cloth', count: 3 } as InvSlot])).toBe(false);
    expect(carriesFirebottle([{ ...BOTTLE, count: 0 }])).toBe(false);
    expect(carriesFirebottle([{ itemId: 'linen_cloth', count: 3 } as InvSlot, BOTTLE])).toBe(true);
  });
});

describe('the gear cursor', () => {
  it('wears the gear over a hut only while the firebottle is carried', () => {
    const hut = hutEntity();
    expect(hoverCursorKind(hut, 1, new Set(), new Set(), [BOTTLE])).toBe('gear');
    expect(hoverCursorKind(hut, 1, new Set(), new Set(), [])).toBe('default');
    expect(hoverCursorKind(hut, 1, new Set())).toBe('default');
    // a used-up hut object, or any other object, never wears it
    expect(hoverCursorKind(hutEntity({ lootable: false }), 1, new Set(), new Set(), [BOTTLE])).toBe(
      'default',
    );
    const crate = hutEntity({ templateId: 'ground_supply_crate' });
    expect(hoverCursorKind(crate, 1, new Set(), new Set(), [BOTTLE])).toBe('default');
  });

  it('draws the ornate gear, and a camera drag still shows the grab hand', () => {
    expect(cursorForHover('gear', false)).toBe(CURSOR_GEAR);
    expect(CURSOR_GEAR).toContain('ui/cursors/gear.png');
    expect(CURSOR_GEAR.endsWith(', pointer')).toBe(true);
    expect(cursorForHover('gear', true)).not.toBe(CURSOR_GEAR);
  });

  it('ships the gear as a 32 px RGBA PNG beside the other cursors', () => {
    const png = readFileSync(path.join(__dirname, '..', 'public', 'ui', 'cursors', 'gear.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(32); // IHDR width
    expect(png.readUInt32BE(20)).toBe(32); // IHDR height
    expect(png[25]).toBe(6); // colour type 6: truecolour with alpha
  });
});

describe('the client sends a hut click or press to the throw', () => {
  const player = { id: 1, pos: { x: 0, y: 0, z: 2.9 }, dead: false, ghost: false, auras: [] };

  it('routes a left or right click on a hut in reach to pickUpObject', () => {
    for (const button of [0, 2]) {
      const hut = hutEntity();
      const pickUpObject = vi.fn(() => true);
      const world = {
        player,
        playerId: 1,
        entities: new Map([[hut.id, hut]]),
        questLog: onQuest(),
        targetEntity: vi.fn(),
        interact: vi.fn(),
        enterDungeon: vi.fn(),
        leaveDungeon: vi.fn(),
        pickUpObject,
        startAutoAttack: vi.fn(),
      } as unknown as PickInteractionWorld;
      const hud = {
        openLoot: vi.fn(),
        openQuestDialog: vi.fn(),
        openDelveBoard: vi.fn(),
        openMailbox: vi.fn(),
        showError: vi.fn(),
        closeContextMenu: vi.fn(),
        requestSpiritHealerResurrect: vi.fn(),
      } as PickInteractionHud;
      expect(handlePickedEntity(world, hud, hut.id, button, 0, 0), `button ${button}`).toBe(true);
      expect(pickUpObject).toHaveBeenCalledWith(hut.id);
      expect(hud.showError).not.toHaveBeenCalled();
    }
  });

  it('answers the interact press (F, the pad, the mobile button) on a hut in reach with pickUpObject', () => {
    const hut = hutEntity();
    const pickUpObject = vi.fn(() => true);
    const world = {
      player,
      playerId: 1,
      entities: new Map([[hut.id, hut]]),
      questLog: onQuest(),
      farmPatches: [],
      myFarmPlots: [],
      inventory: [BOTTLE],
      targetEntity: vi.fn(),
      interact: vi.fn(),
      lootCorpse: vi.fn(),
      delveInteract: vi.fn(),
      enterDungeon: vi.fn(),
      leaveDungeon: vi.fn(),
      pickUpObject,
      nodeHarvestableByMe: vi.fn(() => false),
      harvestNode: vi.fn(),
      consumeFeast: vi.fn(),
    } as unknown as NearbyInteractionWorld;
    const hud = {
      openMailbox: vi.fn(),
      openQuestDialog: vi.fn(),
      openDelveBoard: vi.fn(),
      showError: vi.fn(),
      requestSpiritHealerResurrect: vi.fn(),
      openPlantSheet: vi.fn(),
      openLoot: vi.fn(),
    } as NearbyInteractionHud;
    expect(tryNearbyInteraction(world, hud, 'away', 'nothing')).toBe(true);
    expect(pickUpObject).toHaveBeenCalledWith(hut.id);
    expect(hud.showError).not.toHaveBeenCalled();
  });
});

describe('the sim throws the bottle for a hut click or interact press', () => {
  function atHut(index: number, withBottle: boolean) {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.questLog.set(HUT_QUEST_ID, {
      questId: HUT_QUEST_ID,
      counts: [0],
      state: 'active',
    } as QuestProgress);
    if (withBottle) sim.addItem(FIREBOTTLE_ITEM_ID, 1, pid);
    const spot = MUDFIN_HUTS[index];
    const hut = [...sim.entities.values()].find(
      (e) => e.objectItemId === HUT_OBJECT_ID && e.pos.x === spot.x && e.pos.z === spot.z,
    );
    if (!hut) throw new Error(`no hut object at hut ${index}`);
    // on the doorstep, just outside the solid wall
    const out = MUDFIN_HUT_MODELS[spot.model].radius + 0.6;
    const ground = sim.groundPos(
      spot.x + Math.sin(spot.yaw) * out,
      spot.z + Math.cos(spot.yaw) * out,
    );
    sim.player.pos = { ...ground };
    sim.player.prevPos = { ...ground };
    sim.drainEvents();
    return { sim, meta, hut };
  }

  function settle(sim: Sim, ticks = 2): SimEvent[] {
    const events: SimEvent[] = [...sim.drainEvents()];
    for (let i = 0; i < ticks; i++) events.push(...sim.tick());
    return events;
  }

  const burnedId = (events: SimEvent[]) =>
    events.flatMap((e) => (e.type === 'worldObjectBurning' ? [e.objectId] : []));

  it('the interact press torches the hut you stand at, crediting the objective', () => {
    const { sim, meta, hut } = atHut(1, true);
    sim.interact();
    expect(burnedId(settle(sim))).toEqual([hut.id]);
    expect(meta.questLog.get(HUT_QUEST_ID)?.counts[0]).toBe(1);
  });

  it('a click on the hut torches it too', () => {
    const { sim, meta, hut } = atHut(0, true);
    sim.pickUpObject(hut.id);
    expect(burnedId(settle(sim))).toEqual([hut.id]);
    expect(meta.questLog.get(HUT_QUEST_ID)?.counts[0]).toBe(1);
  });

  it('without the firebottle it says so and burns nothing', () => {
    const { sim, meta, hut } = atHut(2, false);
    sim.pickUpObject(hut.id);
    const events = settle(sim);
    expect(burnedId(events)).toEqual([]);
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          (e as { text?: string }).text === 'You need a firebottle to torch that.',
      ),
    ).toBe(true);
    expect(meta.questLog.get(HUT_QUEST_ID)?.counts[0]).toBe(0);
  });

  // The throw plays no character animation: the renderer answers a `windup`
  // spellfx with triggerAttack, which on a warrior is a melee swing at the hut.
  // Every route sends only the bottle's flight and the blaze.
  it('throws with no swing on a click, an interact press or a bag use', () => {
    const routes: [string, (sim: Sim, hut: Entity) => void][] = [
      ['click', (sim, hut) => sim.pickUpObject(hut.id)],
      ['interact', (sim) => sim.interact()],
      ['bag', (sim) => sim.useItem(FIREBOTTLE_ITEM_ID)],
    ];
    for (const [index, [route, act]] of routes.entries()) {
      const { sim, hut } = atHut(index, true);
      act(sim, hut);
      const events = settle(sim);
      expect(burnedId(events), route).toEqual([hut.id]);
      const playerFx = events.flatMap((e) =>
        e.type === 'spellfx' && e.sourceId === sim.playerId ? [e.fx] : [],
      );
      expect(playerFx, route).toEqual(['projectile']);
    }
  });
});
