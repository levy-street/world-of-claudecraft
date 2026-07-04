import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const GATE_ITEM = 'gravecaller_sigil';
const GATE_QUEST = 'q_whispers';

function freshSim(): Sim {
  return new Sim({
    seed: 4242,
    playerClass: 'warrior',
    playerName: 'Scout',
    autoEquip: false,
  });
}

function gateObject(sim: Sim): Entity {
  const obj = [...sim.entities.values()].find(
    (e): e is Entity => e.kind === 'object' && e.objectItemId === GATE_ITEM,
  );
  if (!obj) throw new Error('gravecaller_sigil ground object not spawned');
  return obj;
}

function standOn(sim: Sim, e: Entity): void {
  const pos = { ...e.pos };
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.player.targetId = null;
}

function denyError(events: SimEvent[]): SimEvent | undefined {
  // gravecaller_sigil has a custom GROUND_PICKUP_LINES flavor deny (not the
  // generic "You cannot take the {name} yet." fallback), so match its actual text.
  return events.find(
    (e) => e.type === 'error' && /repels your touch/.test((e as { text: string }).text),
  );
}

describe('interact() and ground quest object visibility', () => {
  it('confirms the fixture item is a real quest collectible', () => {
    expect(ITEMS[GATE_ITEM]?.questId).toBe(GATE_QUEST);
  });

  it('does not select the object for a player not on the quest', () => {
    const sim = freshSim();
    const obj = gateObject(sim);
    standOn(sim, obj);

    sim.interact();
    const events = sim.drainEvents();

    // scan skipped the object: pickUpObject was never called, so no deny error
    expect(denyError(events)).toBeUndefined();
    expect(sim.countItem(GATE_ITEM)).toBe(0);
    expect(obj.lootable).toBe(true);
  });

  it('still lets a player on the quest pick it up via interact()', () => {
    const sim = freshSim();
    sim.questLog.set(GATE_QUEST, { questId: GATE_QUEST, counts: [0], state: 'active' });
    const obj = gateObject(sim);
    standOn(sim, obj);

    sim.interact();
    sim.drainEvents();

    expect(sim.countItem(GATE_ITEM)).toBe(1);
    expect(obj.lootable).toBe(false);
  });
});
