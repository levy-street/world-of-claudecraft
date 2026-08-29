// The spawn greeting (tutorial island): one-shot semantics, the silent latch
// for established characters, save/load durability (zero-default omission),
// the firstCharacter account fact, and the startTutorial ferry's gates.

import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_ARRIVAL } from '../src/sim/content/proving_shore';
import { DUNGEON_X_THRESHOLD, NPCS } from '../src/sim/data';
import { FERRY_BELL_TOWN_LANDING } from '../src/sim/interactions/ferry_bell';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { maybeEmitTutorialGreeting, updateTutorialGreeting } from '../src/sim/tutorial/greeting';
import type { SimEvent } from '../src/sim/types';

function makeSim(seed = 4120): Sim {
  // The greeting suite exercises the live-world arm, so it opts in like the
  // offline client and the server do (SimConfig.compulsoryTutorial).
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, compulsoryTutorial: true });
}

function greetCtx(sim: Sim) {
  const emitted: SimEvent[] = [];
  const raw = {
    tickCount: 0,
    players: sim.players,
    // The compulsory arm reads the fresh character's position: a newborn
    // already ashore is welcomed in place, anyone else is ferried.
    entities: sim.entities,
    compulsoryTutorial: true,
    emit: (e: SimEvent) => emitted.push(e),
  };
  return { ctx: raw as unknown as SimContext, emitted, raw };
}

describe('tutorial greeting one-shot', () => {
  it('forces a fresh mainland character onto the island, exactly once', () => {
    // The tutorial is compulsory (the playtest ruling): no offer, no skip.
    // A fresh character standing anywhere off the island (the offline Sim's
    // town spawn, a legacy save that never played) is ferried straight to
    // the arrival and welcomed by Odo.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    const p = sim.entities.get(sim.playerId)!;
    sim.drainEvents();
    expect(maybeEmitTutorialGreeting(meta, sim.ctx)).toBe(true);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'ferryIslandArrival')).toEqual([
      { type: 'ferryIslandArrival', pid: sim.playerId, firstVisit: true },
    ]);
    // The old opt-in dialog is gone with the choice itself.
    expect(events.filter((e) => e.type === 'tutorialGreeting')).toEqual([]);
    expect(p.pos.x).toBeCloseTo(PROVING_SHORE_ARRIVAL.x, 3);
    expect(p.pos.z).toBeCloseTo(PROVING_SHORE_ARRIVAL.z, 3);
    expect(meta.tutorialGreetingSent).toBe(true);

    expect(maybeEmitTutorialGreeting(meta, sim.ctx)).toBe(false);
    expect(sim.drainEvents().filter((e) => e.type === 'ferryIslandArrival')).toEqual([]);
  });

  it('greets a fresh character ALREADY ashore with the island arrival, not the ferry offer', () => {
    // The server rolls newborn rows at PROVING_SHORE_ARRIVAL (auto-entered
    // tutorial), so the first greeting a new player sees is Odo's welcome.
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = PROVING_SHORE_ARRIVAL.x;
    p.pos.z = PROVING_SHORE_ARRIVAL.z;
    const meta = sim.players.get(sim.playerId)!;
    const first = greetCtx(sim);
    expect(maybeEmitTutorialGreeting(meta, first.ctx)).toBe(true);
    expect(first.emitted).toHaveLength(1);
    expect(first.emitted[0]).toMatchObject({ type: 'ferryIslandArrival', pid: sim.playerId });
    expect(meta.tutorialGreetingSent).toBe(true);

    const second = greetCtx(sim);
    expect(maybeEmitTutorialGreeting(meta, second.ctx)).toBe(false);
    expect(second.emitted).toEqual([]);
  });

  it('never ferries anyone when the host has not opted in', () => {
    // The gate every test, parity trace, and RL episode depends on: without
    // SimConfig.compulsoryTutorial the sweep is inert, so a fresh character
    // stays exactly where the scenario put them.
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const p = sim.entities.get(sim.playerId)!;
    const before = { x: p.pos.x, z: p.pos.z };
    sim.drainEvents();
    for (let t = 0; t < 42; t++) sim.tick();
    expect(sim.drainEvents().filter((e) => e.type === 'ferryIslandArrival')).toEqual([]);
    expect(p.pos.x).toBeCloseTo(before.x, 3);
    expect(p.pos.z).toBeCloseTo(before.z, 3);
    expect(sim.players.get(sim.playerId)!.tutorialGreetingSent).toBe(false);
  });

  it('never ferries a ghost away from their corpse, nor out of an instance', () => {
    // The sibling command path's gates, mirrored on the sweep.
    const ghostSim = makeSim();
    const ghost = ghostSim.entities.get(ghostSim.playerId)!;
    ghost.dead = true;
    ghost.ghost = true;
    const ghostAt = { x: ghost.pos.x, z: ghost.pos.z };
    expect(maybeEmitTutorialGreeting(ghostSim.players.get(ghostSim.playerId)!, ghostSim.ctx)).toBe(
      false,
    );
    expect(ghost.pos.x).toBeCloseTo(ghostAt.x, 3);

    const instanced = makeSim();
    const p = instanced.entities.get(instanced.playerId)!;
    p.pos.x = DUNGEON_X_THRESHOLD + 50;
    expect(
      maybeEmitTutorialGreeting(instanced.players.get(instanced.playerId)!, instanced.ctx),
    ).toBe(false);
    expect(p.pos.x).toBeCloseTo(DUNGEON_X_THRESHOLD + 50, 3);
  });

  it('latches SILENTLY for an established character (a pre-tutorial save)', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.lifetimeXp = 500; // any progress at all marks the character established
    const { ctx, emitted } = greetCtx(sim);
    expect(maybeEmitTutorialGreeting(meta, ctx)).toBe(false);
    expect(emitted).toEqual([]);
    // The flag still latched, so the greeting can never fire later either.
    expect(meta.tutorialGreetingSent).toBe(true);
  });

  it('a character with quest history is established even at zero XP', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.questsDone.add('q_wolves');
    const { ctx, emitted } = greetCtx(sim);
    expect(maybeEmitTutorialGreeting(meta, ctx)).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('the sweep runs on the 1 Hz cadence only', () => {
    const sim = makeSim();
    const { ctx, emitted, raw } = greetCtx(sim);
    raw.tickCount = 19;
    updateTutorialGreeting(ctx, sim.playerId);
    expect(emitted).toEqual([]);
    // ...and fires on the cadence boundary: the stub ctx cannot displace, so
    // the positive arm is proved by the flag latching (the ferry itself is
    // covered through real ticks below).
    const meta = sim.players.get(sim.playerId)!;
    expect(meta.tutorialGreetingSent).toBe(false);
    // ...and FIRES on the boundary. Driven with the character already
    // ashore so the stub ctx (which cannot displace) still exercises the
    // real firing arm; the ferry itself is covered through real ticks below.
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = PROVING_SHORE_ARRIVAL.x;
    p.pos.z = PROVING_SHORE_ARRIVAL.z;
    raw.tickCount = 20;
    updateTutorialGreeting(ctx, sim.playerId);
    expect(meta.tutorialGreetingSent).toBe(true);
    expect(emitted.some((e) => e.type === 'ferryIslandArrival')).toBe(true);
  });

  it('fires through the real Sim.tick mail phase within the first second', () => {
    const sim = makeSim();
    const seen: SimEvent[] = [];
    // The sweep runs on the 1 Hz cadence, so 21 real ticks cover the first
    // firing window through the actual mail-phase wiring, not a stub ctx.
    for (let t = 0; t < 21; t++) seen.push(...sim.tick());
    const arrivals = seen.filter((e) => e.type === 'ferryIslandArrival');
    expect(arrivals).toEqual([{ type: 'ferryIslandArrival', pid: sim.playerId, firstVisit: true }]);
    // The compulsory ferry landed the offline town spawn on the island.
    const p = sim.entities.get(sim.playerId)!;
    expect(p.pos.x).toBeCloseTo(PROVING_SHORE_ARRIVAL.x, 3);
    expect(p.pos.z).toBeCloseTo(PROVING_SHORE_ARRIVAL.z, 3);
    // And never again on later swept ticks.
    const later: SimEvent[] = [];
    for (let t = 0; t < 21; t++) later.push(...sim.tick());
    expect(later.filter((e) => e.type === 'ferryIslandArrival')).toEqual([]);
  });

  it('the Gauntlet run credits its flags in running order, by position, through real ticks', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const meta = sim.players.get(sim.playerId)!;
    // Stand at Warden Tam's gate and take the run.
    p.pos.x = -283;
    p.pos.z = -21;
    sim.acceptQuest('q_ps_the_gauntlet');
    const qp = meta.questLog.get('q_ps_the_gauntlet')!;
    expect(qp.state).toBe('active');

    // Standing at flag TWO first credits nothing: running order, not any order.
    p.pos.x = -308;
    p.pos.z = -32;
    sim.tick();
    expect(qp.counts[0] ?? 0).toBe(0);

    // Then the flags in order, one sweep tick each, and the last readies the
    // quest for Warden Tam's hand-in.
    p.pos.x = -308;
    p.pos.z = -16;
    sim.tick();
    expect(qp.counts[0]).toBe(1);
    p.pos.x = -308;
    p.pos.z = -32;
    sim.tick();
    expect(qp.counts[0]).toBe(2);
    expect(qp.state).toBe('active');
    p.pos.x = -334;
    p.pos.z = -32.5;
    sim.tick();
    expect(qp.counts[0]).toBe(3);
    expect(qp.state).toBe('ready');
  });

  it('does not re-fire across save/load, and omits the flag while unset', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    const bare = sim.serializeCharacter(sim.playerId);
    expect(bare && 'tutorialGreetingSent' in bare).toBe(false);

    maybeEmitTutorialGreeting(meta, sim.ctx);
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.tutorialGreetingSent).toBe(true);

    const reloaded = makeSim(4121);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.tutorialGreetingSent).toBe(true);
    const afterLoad = greetCtx(reloaded);
    expect(maybeEmitTutorialGreeting(reloadedMeta, afterLoad.ctx)).toBe(false);
    expect(afterLoad.emitted).toEqual([]);
  });

  it('forces a LATER fresh character ashore too: compulsory is per character', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('mage', 'Secondling', { firstCharacter: false });
    const meta = sim.players.get(pid)!;
    sim.drainEvents();
    expect(maybeEmitTutorialGreeting(meta, sim.ctx)).toBe(true);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'ferryIslandArrival')).toEqual([
      { type: 'ferryIslandArrival', pid, firstVisit: true },
    ]);
    const p = sim.entities.get(pid)!;
    expect(p.pos.x).toBeCloseTo(PROVING_SHORE_ARRIVAL.x, 3);
  });
});

describe('startTutorial (the ferry)', () => {
  it('teleports a level-1 character to the Proving Shore arrival and marks it', () => {
    const sim = makeSim();
    sim.events = [];
    sim.startTutorial();
    const e = sim.entities.get(sim.playerId)!;
    expect(
      Math.hypot(e.pos.x - PROVING_SHORE_ARRIVAL.x, e.pos.z - PROVING_SHORE_ARRIVAL.z),
    ).toBeLessThan(1);
    expect(e.facing).toBe(PROVING_SHORE_ARRIVAL.facing);
    // The text-free arrival marker Odo's welcome note keys off: a character
    // who has not started the rail is taught, whatever this device has seen.
    expect(sim.events).toContainEqual({
      type: 'ferryIslandArrival',
      pid: sim.playerId,
      firstVisit: true,
    });
  });

  it('refuses a character above level 1 and leaves them in place', () => {
    const sim = makeSim();
    sim.setPlayerLevel(2, sim.playerId);
    const e = sim.entities.get(sim.playerId)!;
    const before = { ...e.pos };
    sim.startTutorial();
    expect(e.pos.x).toBe(before.x);
    expect(e.pos.z).toBe(before.z);
  });

  it('refuses in combat (the flag guards the emit, this gate guards the wire)', () => {
    const sim = makeSim();
    const e = sim.entities.get(sim.playerId)!;
    e.inCombat = true;
    const before = { ...e.pos };
    sim.startTutorial();
    expect(e.pos.x).toBe(before.x);
    expect(e.pos.z).toBe(before.z);
  });

  it('refuses from the instance band', () => {
    const sim = makeSim();
    const e = sim.entities.get(sim.playerId)!;
    e.pos.x = 100_500; // inside the instance plane, past DUNGEON_X_THRESHOLD
    sim.startTutorial();
    expect(e.pos.x).toBe(100_500);
  });

  it('refuses while dead', () => {
    const sim = makeSim();
    const e = sim.entities.get(sim.playerId)!;
    e.dead = true;
    const before = { ...e.pos };
    sim.startTutorial();
    expect(e.pos.x).toBe(before.x);
    expect(e.pos.z).toBe(before.z);
  });
});

describe('the ferry bells (the clicked crossing)', () => {
  function bells(sim: Sim) {
    const found = [...sim.entities.values()].filter(
      (e) => e.kind === 'object' && e.objectItemId === 'ps_ferry_bell',
    );
    const island = found.find((b) => b.pos.x < -180)!;
    const vale = found.find((b) => b.pos.x >= -180)!;
    return { island, vale };
  }

  it('the island bell sets the player down in Eastbrook town and marks the homecoming', () => {
    const sim = makeSim();
    const { island } = bells(sim);
    expect(island).toBeTruthy();
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = island.pos.x + 1;
    p.pos.z = island.pos.z;
    sim.events = [];
    sim.pickUpObject(island.id);
    expect(
      Math.hypot(p.pos.x - FERRY_BELL_TOWN_LANDING.x, p.pos.z - FERRY_BELL_TOWN_LANDING.z),
    ).toBeLessThan(1);
    // The text-free homecoming marker the HUD keys its one-time twin-bell
    // pointer off (a possible misclick ride).
    expect(sim.events).toContainEqual({ type: 'ferryBellHome', pid: sim.playerId });
  });

  it('the town bell rings a returning player back to the island arrival', () => {
    const sim = makeSim();
    const { vale: town } = bells(sim);
    expect(town).toBeTruthy();
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = town.pos.x + 1;
    p.pos.z = town.pos.z;
    sim.events = [];
    sim.pickUpObject(town.id);
    expect(
      Math.hypot(p.pos.x - PROVING_SHORE_ARRIVAL.x, p.pos.z - PROVING_SHORE_ARRIVAL.z),
    ).toBeLessThan(1);
    // No homecoming marker on the OUTBOUND ride (the pointer is only for
    // arrivals in town); the island-arrival marker fires instead.
    expect(sim.events.filter((e) => e.type === 'ferryBellHome')).toEqual([]);
    expect(sim.events).toContainEqual({
      type: 'ferryIslandArrival',
      pid: sim.playerId,
      firstVisit: true,
    });
  });

  it('a returning student rides in with firstVisit false (no repeat lecture)', () => {
    // Per CHARACTER, not per device: once any Proving Shore quest is in the
    // log or done, the welcome note stops. This is what makes a fresh
    // character on a veteran's browser still get taught.
    const sim = makeSim();
    const { vale: town } = bells(sim);
    const meta = sim.players.get(sim.playerId)!;
    meta.questsDone.add('q_ps_strike_true');
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = town.pos.x + 1;
    p.pos.z = town.pos.z;
    sim.events = [];
    sim.pickUpObject(town.id);
    expect(sim.events).toContainEqual({
      type: 'ferryIslandArrival',
      pid: sim.playerId,
      firstVisit: false,
    });
  });

  it('refuses in combat and stays put (no bell combat exit)', () => {
    const sim = makeSim();
    const { vale: town } = bells(sim);
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = town.pos.x + 1;
    p.pos.z = town.pos.z;
    p.inCombat = true;
    sim.pickUpObject(town.id);
    expect(p.pos.x).toBe(town.pos.x + 1);
  });
});

describe('the quest-gated vendor row (the pouch lock-out guard)', () => {
  function standAtFinch(sim: Sim) {
    const finch = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'quartermaster_finch',
    )!;
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = finch.pos.x + 1;
    p.pos.z = finch.pos.z;
    return finch;
  }

  it('refuses the Linen Pouch before the lesson quest is in the log', () => {
    const sim = makeSim();
    const finch = standAtFinch(sim);
    const meta = sim.players.get(sim.playerId)!;
    meta.copper = 1000;
    sim.buyItem(finch.id, 'linen_pouch');
    expect(sim.countItem('linen_pouch')).toBe(0);
    expect(meta.copper).toBe(1000);
  });

  it('sells the Linen Pouch once the lesson quest is active, and after it is done', () => {
    const sim = makeSim();
    const finch = standAtFinch(sim);
    const meta = sim.players.get(sim.playerId)!;
    meta.copper = 1000;
    meta.questLog.set('q_ps_pouch_and_purse', {
      questId: 'q_ps_pouch_and_purse',
      counts: [0],
      state: 'active',
    });
    sim.buyItem(finch.id, 'linen_pouch');
    expect(sim.countItem('linen_pouch')).toBe(1);
    expect(meta.copper).toBe(750);
    // Done-state keeps the row open: a graduate can buy a second pouch.
    meta.questLog.delete('q_ps_pouch_and_purse');
    meta.questsDone.add('q_ps_pouch_and_purse');
    sim.buyItem(finch.id, 'linen_pouch');
    expect(sim.countItem('linen_pouch')).toBe(2);
  });

  it('the pouch objective survives being buckled on, and the turn-in leaves it', () => {
    // The quest tells the player to buy the pouch AND wear it, so the two
    // things that used to break it are pinned together: equipBag moves the
    // item out of the inventory countItem reads (the objective fell back to
    // 0/1 and could never be handed in), and a normal collect turn-in would
    // have taken the bag Maren just taught them to wear.
    const sim = makeSim();
    const finch = standAtFinch(sim);
    const meta = sim.players.get(sim.playerId)!;
    meta.copper = 1000;
    meta.questLog.set('q_ps_pouch_and_purse', {
      questId: 'q_ps_pouch_and_purse',
      counts: [0],
      state: 'active',
    });
    sim.buyItem(finch.id, 'linen_pouch');
    expect(meta.questLog.get('q_ps_pouch_and_purse')?.counts[0]).toBe(1);

    sim.equipBag('linen_pouch');
    expect(sim.countItem('linen_pouch'), 'the pouch left the bags for a socket').toBe(0);
    expect(meta.bags.filter((b) => b === 'linen_pouch')).toHaveLength(1);
    // Still complete: the ownership objective counts the worn copy.
    expect(meta.questLog.get('q_ps_pouch_and_purse')?.counts[0]).toBe(1);
    expect(sim.questState('q_ps_pouch_and_purse')).toBe('ready');

    // Hand in at Maren: she pays, and the pouch stays buckled on.
    const maren = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'instructor_maren',
    )!;
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = maren.pos.x + 1;
    p.pos.z = maren.pos.z;
    const before = meta.copper;
    sim.turnInQuest('q_ps_pouch_and_purse');
    expect(sim.questsDone.has('q_ps_pouch_and_purse')).toBe(true);
    expect(meta.copper).toBe(before + 120);
    expect(
      meta.bags.filter((b) => b === 'linen_pouch'),
      'Maren kept her hands off it',
    ).toHaveLength(1);
  });

  it('ungated rows sell as before (the gate narrows nothing else)', () => {
    // Finch's stall now stocks ONLY the gated pouch (the softlock guard), so
    // the ungated-row proof rides a town vendor instead: any Eastbrook
    // provisioner row without a vendorQuestGates entry sells to a fresh
    // character with no quest state at all.
    const sim = makeSim();
    const vendor = [...sim.entities.values()].find(
      (e) =>
        e.kind === 'npc' &&
        (NPCS[e.templateId]?.vendorItems ?? []).some(
          (id) => !(NPCS[e.templateId]?.vendorQuestGates ?? {})[id],
        ),
    )!;
    expect(vendor, 'an ungated vendor row exists somewhere').toBeTruthy();
    const npcDef = NPCS[vendor.templateId]!;
    const ungated = (npcDef.vendorItems ?? []).find((id) => !(npcDef.vendorQuestGates ?? {})[id])!;
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = vendor.pos.x + 1;
    p.pos.z = vendor.pos.z;
    const meta = sim.players.get(sim.playerId)!;
    meta.copper = 100000;
    sim.buyItem(vendor.id, ungated);
    // Some provisioner rows sell in stacks; owning ANY of it proves the
    // ungated purchase went through.
    expect(sim.countItem(ungated)).toBeGreaterThanOrEqual(1);
  });
});
