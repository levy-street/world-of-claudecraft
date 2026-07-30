// Equipping into an AIMED slot: the paperdoll drop target (drag a piece out of the
// bags onto a specific socket) equips into that exact equipment key instead of
// letting the resolver pick. The aimed slot is a REQUEST, never a bypass: the sim
// re-validates it against the item, so a hand-crafted 'equip' packet cannot put a
// helm on a ring finger or dodge the class / level gates.
//
// Covers the sim command (Sim.equipItemToSlot -> items.equipItem targetSlot), its
// pure rule (equipment_rules.slotAcceptsItem), and the ClientWorld wire arm.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { slotAcceptsItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';

type AnySim = Sim & Record<string, any>;

const RING_A = 'seal_of_the_nine_oaths';
const RING_B = 'nielas_coldlight_band';
const HELM = 'cryptbone_helm';

// The live equipment map for a player (the tests read the sim's own state, never a
// mirrored copy). Non-null: every pid here was just added by makeSim.
function equipmentOf(sim: AnySim, pid: number): Record<string, string | undefined> {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`no player ${pid}`);
  return meta.equipment;
}

function makeSim(): { sim: AnySim; pid: number } {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const pid = sim.addPlayer('warrior', 'Aimer');
  sim.setPlayerLevel(20, pid);
  return { sim, pid };
}

describe('slotAcceptsItem (pure)', () => {
  it('accepts a ring on EITHER finger and nothing else', () => {
    const ring = ITEMS[RING_A];
    expect(slotAcceptsItem(ring, 'ring1')).toBe(true);
    expect(slotAcceptsItem(ring, 'ring2')).toBe(true);
    expect(slotAcceptsItem(ring, 'neck')).toBe(false);
    expect(slotAcceptsItem(ring, 'helmet')).toBe(false);
  });

  it('binds every other item to its ONE declared key', () => {
    const helm = ITEMS[HELM];
    expect(slotAcceptsItem(helm, 'helmet')).toBe(true);
    expect(slotAcceptsItem(helm, 'ring1')).toBe(false);
    expect(slotAcceptsItem(helm, 'chest')).toBe(false);
  });

  it('refuses a slotless item (a consumable can never be worn)', () => {
    const potion = ITEMS.minor_healing_potion;
    expect(potion.slot).toBeUndefined();
    expect(slotAcceptsItem(potion, 'chest')).toBe(false);
  });
});

describe('Sim.equipItemToSlot', () => {
  it('honors the aimed ring2 even while ring1 is free (the resolver would have picked ring1)', () => {
    const { sim, pid } = makeSim();
    sim.addItem(RING_A, 1, pid);
    sim.equipItemToSlot(RING_A, 'ring2', pid);
    const eq = equipmentOf(sim, pid);
    expect(eq.ring2).toBe(RING_A);
    expect(eq.ring1).toBeUndefined();
  });

  it('leaves the other finger alone when the aimed one is filled', () => {
    const { sim, pid } = makeSim();
    sim.addItem(RING_A, 1, pid);
    sim.addItem(RING_B, 1, pid);
    sim.equipItemToSlot(RING_A, 'ring1', pid);
    sim.equipItemToSlot(RING_B, 'ring2', pid);
    const eq = equipmentOf(sim, pid);
    expect(eq.ring1).toBe(RING_A);
    expect(eq.ring2).toBe(RING_B);
  });

  it('swaps in place: the piece worn in the aimed slot goes back to the bags', () => {
    const { sim, pid } = makeSim();
    sim.addItem(RING_A, 1, pid);
    sim.addItem(RING_B, 1, pid);
    sim.equipItemToSlot(RING_A, 'ring2', pid);
    sim.equipItemToSlot(RING_B, 'ring2', pid);
    expect(equipmentOf(sim, pid).ring2).toBe(RING_B);
    expect(equipmentOf(sim, pid).ring1).toBeUndefined();
    // The displaced ring came back, it was not destroyed.
    expect(sim.countItem(RING_A, pid)).toBe(1);
  });

  it('REFUSES a slot the item does not fit, equips nothing, and errors', () => {
    const { sim, pid } = makeSim();
    sim.addItem(HELM, 1, pid);
    const events: any[] = [];
    sim.emit = ((ev: any) => events.push(ev)) as never;
    sim.equipItemToSlot(HELM, 'ring1', pid);
    const eq = equipmentOf(sim, pid);
    expect(eq.ring1).toBeUndefined();
    // Crucially it does NOT fall back to the helmet slot: an illegal aim is refused,
    // never silently coerced into some other socket.
    expect(eq.helmet).toBeUndefined();
    expect(sim.countItem(HELM, pid)).toBe(1);
    expect(events.some((e) => e.type === 'error' && /does not go in that slot/.test(e.text))).toBe(
      true,
    );
  });

  it('still enforces the level gate on an aimed slot', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid = sim.addPlayer('warrior', 'Twink');
    sim.setPlayerLevel(1, pid);
    // A rare ring gates on its source level; a level-1 character cannot wear it.
    sim.addItem(RING_A, 1, pid);
    sim.equipItemToSlot(RING_A, 'ring1', pid);
    expect(equipmentOf(sim, pid).ring1).toBeUndefined();
  });

  it('still enforces class proficiency on an aimed slot', () => {
    const sim = new Sim({ seed: 3, playerClass: 'mage', noPlayer: true }) as AnySim;
    const pid = sim.addPlayer('mage', 'Clothy');
    sim.setPlayerLevel(20, pid);
    sim.addItem(HELM, 1, pid); // mail helm: a mage cannot wear it
    sim.equipItemToSlot(HELM, 'helmet', pid);
    expect(equipmentOf(sim, pid).helmet).toBeUndefined();
  });

  it('leaves the un-aimed equipItem path byte-identical (ring1 first)', () => {
    const { sim, pid } = makeSim();
    sim.addItem(RING_A, 1, pid);
    sim.equipItem(RING_A, pid);
    expect(equipmentOf(sim, pid).ring1).toBe(RING_A);
  });
});

describe('ClientWorld equipItemToSlot (wire)', () => {
  it('sends the aimed slot on the same additive equip command', async () => {
    const { ClientWorld } = await import('../src/net/online');
    const world = Object.create(ClientWorld.prototype) as any;
    const sent: any[] = [];
    world.cmd = (payload: unknown) => sent.push(payload);
    ClientWorld.prototype.equipItemToSlot.call(world, RING_A, 'ring2');
    expect(sent).toEqual([{ cmd: 'equip', item: RING_A, slot: 'ring2' }]);
  });

  it('the plain equipItem still sends no slot (older servers resolve it themselves)', async () => {
    const { ClientWorld } = await import('../src/net/online');
    const world = Object.create(ClientWorld.prototype) as any;
    const sent: any[] = [];
    world.cmd = (payload: unknown) => sent.push(payload);
    world.canSendCommand = () => true;
    ClientWorld.prototype.equipItem.call(world, RING_A);
    expect(sent).toEqual([{ cmd: 'equip', item: RING_A }]);
  });
});

// Guard the drag payload never reaching the sim as a no-op: an unknown item id is
// simply ignored (no throw, no phantom equip).
describe('equipItemToSlot robustness', () => {
  it('ignores an unknown item id', () => {
    const { sim, pid } = makeSim();
    const spy = vi.spyOn(sim, 'emit' as never);
    sim.equipItemToSlot('not_a_real_item', 'helmet', pid);
    expect(equipmentOf(sim, pid).helmet).toBeUndefined();
    spy.mockRestore();
  });
});
