// The Rift Forge place gate (src/sim/rift/forge_gate.ts) and the Riftwright's
// interact path (src/sim/interaction.ts).
//
// Pins:
//  - both forge operations refuse away from a riftForge NPC with the
//    'too_far' reason, one shared error line, no riftForgeResult event, and no
//    essence or gem spent; standing at the Riftwright lets the same calls land;
//  - the reach is RIFT_FORGE_RANGE inclusive (INTERACT_RANGE + 2, the bank rule);
//  - a targeted interact and an untargeted proximity interact at the Riftwright
//    each emit exactly one riftForge event for the caller (the bank precedent),
//    and the NPC is a plain non-quest greeter otherwise;
//  - the content pin: exactly one riftForge-flagged NPC ships, in Farshore.

import { describe, expect, it } from 'vitest';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { NPCS } from '../src/sim/data';
import { isRiftForgeNpc, RIFT_FORGE_RANGE } from '../src/sim/rift/forge_gate';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import { INTERACT_RANGE, type SimEvent } from '../src/sim/types';
import {
  moveFarFromRiftForge,
  moveToRiftForge,
  RIFT_FORGE_NPC_ID,
  riftForgeEntity,
} from './helpers/rift_forge';

function forgeWorld() {
  const sim = new Sim({ seed: 731, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
  const gear = createRiftGearInstance('rift-place-gate', 'S', 'warrior', sim.player.id);
  sim.addItemInstance(gear.itemId, gear.instance);
  sim.addItem(RIFT_ESSENCE_ITEM_ID, 20);
  sim.addItem(RIFT_GEM_IDS[0], 1);
  return { sim, itemId: gear.itemId };
}

const errors = (evs: SimEvent[]) =>
  evs.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
const forgeResults = (evs: SimEvent[]) => evs.filter((e) => e.type === 'riftForgeResult');

describe('rift forge place gate', () => {
  it('ships exactly one riftForge NPC, the Riftwright in Farshore', () => {
    const flagged = Object.values(NPCS).filter((n) => n.riftForge === true);
    expect(flagged.map((n) => n.id)).toEqual([RIFT_FORGE_NPC_ID]);
    expect(RIFT_FORGE_RANGE).toBe(INTERACT_RANGE + 2);
  });

  it('refuses both operations away from the forge: too_far, one error line each, nothing spent', () => {
    const { sim, itemId } = forgeWorld();
    moveFarFromRiftForge(sim);
    sim.drainEvents();
    expect(sim.upgradeRiftItem(itemId)).toMatchObject({ ok: false, reason: 'too_far' });
    expect(sim.socketRiftGem(itemId, RIFT_GEM_IDS[0])).toMatchObject({
      ok: false,
      reason: 'too_far',
    });
    const evs = sim.drainEvents();
    expect(errors(evs)).toEqual([
      'You are too far from the Rift Forge.',
      'You are too far from the Rift Forge.',
    ]);
    // Returned, never emitted (the 'dead' reason contract).
    expect(forgeResults(evs)).toHaveLength(0);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(20);
    expect(sim.countItem(RIFT_GEM_IDS[0])).toBe(1);
  });

  it('lands both at the Riftwright, and the reach edge is inclusive', () => {
    const { sim, itemId } = forgeWorld();
    const forge = moveToRiftForge(sim);
    const p = sim.player;
    // Exactly at the edge: still in reach.
    p.pos = { x: forge.pos.x + RIFT_FORGE_RANGE, y: p.pos.y, z: forge.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(sim.upgradeRiftItem(itemId)).toMatchObject({ ok: true, upgradeLevel: 1 });
    // One step past the edge: refused.
    p.pos = { x: forge.pos.x + RIFT_FORGE_RANGE + 0.01, y: p.pos.y, z: forge.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(sim.upgradeRiftItem(itemId)).toMatchObject({ ok: false, reason: 'too_far' });
    moveToRiftForge(sim);
    expect(sim.socketRiftGem(itemId, RIFT_GEM_IDS[0])).toMatchObject({ ok: true });
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(20 - 2);
  });

  it('a targeted interact at the Riftwright emits exactly one riftForge event for the caller', () => {
    const { sim } = forgeWorld();
    const forge = moveToRiftForge(sim);
    expect(isRiftForgeNpc(forge)).toBe(true);
    sim.player.targetId = forge.id;
    sim.drainEvents();
    sim.interact();
    const evs = sim.drainEvents().filter((e) => e.type === 'riftForge');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: 'riftForge', pid: sim.player.id });
  });

  it("a Riftwright visit resets Saul's consecutive-talk ledger like any NPC talk", () => {
    const { sim } = forgeWorld();
    const forge = moveToRiftForge(sim);
    // biome-ignore lint/suspicious/noExplicitAny: the deed runtime is a private ctx view
    const runtime = (sim as any).ctx.deedRuntime as { saulTalks: Map<number, number> };
    runtime.saulTalks.set(sim.player.id, 8);
    sim.player.targetId = forge.id;
    sim.interact();
    expect(runtime.saulTalks.has(sim.player.id)).toBe(false);
  });

  it('an untargeted proximity interact at the Riftwright emits exactly one riftForge event', () => {
    const { sim } = forgeWorld();
    moveToRiftForge(sim);
    sim.player.targetId = null;
    sim.drainEvents();
    sim.interact();
    const evs = sim.drainEvents().filter((e) => e.type === 'riftForge');
    expect(evs).toHaveLength(1);
    expect(riftForgeEntity(sim).kind).toBe('npc');
  });
});
