// Intentional Gathering (PR3), headless supplement: the DISPATCH half of the
// optional `gathering` wire protocol (docs/prd/intentional-gathering/
// headless-gathering-contract.md), driven through a REAL Sim exactly like
// tests/corpse_harvest_cast.test.ts (same fixture idioms: `sim.groundPos`,
// matching prevPos/zero velocity/onGround, the VENDOR_TEST_WORLD scoped
// world from tests/sim_shared.ts for a real field_kit seller). This file
// pins ONLY `headless/gathering_commands.ts`'s `executeGatheringCommand`:
//
//   - pre-reset refusal ({ok:false, reason:'reset_required'})
//   - malformed-request refusal even before reset ({ok:false,
//     reason:'invalid_request'}), proving structural validation runs first
//   - the read-only `inspect` verb: state, corpses/vendors discovery,
//     capping/ordering, disclosure boundaries, zero rng draws
//   - `buy_field_kit`: a real one-kit purchase, and `purchase_refused`
//   - `set_preference`: real acceptance (including an unchanged resend); an
//     unsupported material token never reaches dispatch at all, it is
//     `invalid_request` at parse time (see
//     tests/headless_gathering_protocol.test.ts), so `preference_refused` is
//     not exercised here: nothing in this dispatcher's own logic can produce
//     it once the parser has already validated the token
//   - `harvest`: a real admitted start (no immediate claim), `harvest_refused`
//     (missing kit, unavailable focused material), real 30-tick completion,
//     and movement-cancellation releasing the reservation
//   - every command leaves BOTH `sim.tickCount` and `sim.time` untouched: only
//     real `sim.tick()` calls (standing in for the env's step/noop) ever
//     advance a cast
//
// The corpse/preference/admission mechanics THEMSELVES (cast duration,
// cancellation causes, grant inputs, ...) are the corpse_harvest_cast.test.ts
// / harvest_preference_sim.test.ts suites' job, not duplicated here: this
// file only exercises them through the headless command surface.

import { describe, expect, it } from 'vitest';
import { executeGatheringCommand, type GatheringReply } from '../headless/gathering_commands';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import { HARVEST_PREFERENCE_ALL } from '../src/sim/professions/harvest_preference';
import type { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, INTERACT_RANGE } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { placeInDungeon } from './helpers/instanced_contexts';
import { OPEN_FIELD, placePlayerInOpenField } from './helpers/open_field';
import { makeScopedSim, teleportTo, VENDOR_TEST_WORLD } from './sim_shared';

const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

function mustEntity(sim: Sim, pid: number): Entity {
  return expectDefined(sim.entities.get(pid));
}

/** A dead, tagged (hide + fang) forest_wolf corpse, indexed into the spatial
 *  grid immediately (via the real `sim.addEntity`, not a bypassing
 *  `entities.set`) so a same-tick inspect can discover it without an extra
 *  settle tick. */
function spawnWolfCorpse(sim: Sim, id: number, x: number, z: number): Entity {
  const template = MOBS.forest_wolf;
  const mob = createMob(id, template, template.maxLevel, sim.groundPos(x, z));
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.addEntity(mob);
  return mob;
}

/** A dead, UNTAGGED (no componentTags) mogger_lackey corpse carrying ordinary
 *  ffa loot: the "harvest is nothing_to_harvest, ordinary loot is available"
 *  half of the harvest-only-vs-loot-only split. */
function spawnLootOnlyCorpse(sim: Sim, id: number, x: number, z: number, tapperId: number): Entity {
  const template = MOBS.mogger_lackey;
  const mob = createMob(id, template, template.maxLevel, sim.groundPos(x, z));
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  mob.lootable = true;
  mob.loot = { copper: 5, items: [] };
  mob.tappedById = tapperId;
  mob.lootFfaTimer = 0;
  sim.addEntity(mob);
  return mob;
}

function drawCounter(sim: Sim): { stop(): number } {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  return {
    stop() {
      sim.rng.setObserver(null);
      return draws;
    },
  };
}

/** Narrows an `ok:true` reply of any verb. Every `ok:true` variant carries
 *  `state`; a caller after `corpses`/`vendors` wants `expectOkInspect`
 *  instead. Throws with the full reply on an unexpected refusal so a wrong
 *  assertion fails at a readable point. */
function expectOk(reply: GatheringReply): Extract<GatheringReply, { ok: true }> {
  if (!reply.ok) throw new Error(`expected an ok reply, got ${JSON.stringify(reply)}`);
  return reply;
}

/** Narrows an `ok:true, verb:'inspect'` reply, exposing `corpses`/`vendors`
 *  alongside `state`. */
function expectOkInspect(reply: GatheringReply): Extract<GatheringReply, { verb: 'inspect' }> {
  const ok = expectOk(reply);
  if (ok.verb !== 'inspect') throw new Error(`expected verb inspect, got ${JSON.stringify(ok)}`);
  return ok;
}

/** Spies on the real spatial index (`SpatialGrid.forEachInRadius`) so the
 *  contract's "enumerate via the spatial index" line is a behavior pin, not
 *  prose: a bare `sim.entities.values()` scan for the inspect verb would
 *  leave this call count at zero. */
function spyOnGridRadius(sim: Sim): { calls: number; restore(): void } {
  const grid = sim.grid as unknown as { forEachInRadius: (...args: unknown[]) => void };
  const real = grid.forEachInRadius.bind(grid);
  let calls = 0;
  grid.forEachInRadius = (...args: unknown[]) => {
    calls++;
    return real(...args);
  };
  return {
    get calls() {
      return calls;
    },
    restore() {
      grid.forEachInRadius = real;
    },
  };
}

/** A fresh single-player headless-shaped Sim (VENDOR_TEST_WORLD keeps every
 *  BUILTIN NPC, including the field-kit sellers), the player parked in the
 *  collider-free open-field lane so nothing here collides with authored town
 *  furniture. */
function setupSim(seed = 401): Sim {
  const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior', seed);
  sim.tick();
  placePlayerInOpenField(sim);
  return sim;
}

function findNpc(sim: Sim, templateId: string): Entity {
  return expectDefined(
    [...sim.entities.values()].find((e) => e.templateId === templateId),
    templateId,
  );
}

describe('executeGatheringCommand: gating before an admitted command', () => {
  it('refuses every verb before reset with reset_required, sim untouched (no sim to touch)', () => {
    for (const raw of [
      { cmd: 'gathering', verb: 'inspect' },
      { cmd: 'gathering', verb: 'buy_field_kit', npcId: 1 },
      { cmd: 'gathering', verb: 'set_preference', preference: 'all' },
      { cmd: 'gathering', verb: 'harvest', corpseId: 1 },
    ]) {
      expect(executeGatheringCommand(null, raw)).toEqual({ ok: false, reason: 'reset_required' });
    }
  });

  it('refuses a malformed request as invalid_request even with no Sim at all (structural gate runs first)', () => {
    expect(executeGatheringCommand(null, { cmd: 'gathering', verb: 'bogus' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('refuses a malformed request as invalid_request against a real Sim too, leaving it untouched', () => {
    const sim = setupSim();
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    const copperBefore = sim.copper;
    expect(
      executeGatheringCommand(sim, { cmd: 'gathering', verb: 'harvest', corpseId: -1 }),
    ).toEqual({ ok: false, reason: 'invalid_request' });
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
    expect(sim.copper).toBe(copperBefore);
  });
});

describe('inspect: read-only state, zero draws, unchanged time', () => {
  it('reports fieldKitCount, copper and the cloned default preference with no corpses/vendors nearby', () => {
    const sim = setupSim();
    sim.copper = 7;
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    const counter = drawCounter(sim);
    const eventsBefore = sim.events.slice();
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(counter.stop()).toBe(0);
    expect(sim.events).toEqual(eventsBefore);
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
    expect(reply).toMatchObject({
      ok: true,
      verb: 'inspect',
      state: { fieldKitCount: 0, copper: 7, preference: HARVEST_PREFERENCE_ALL },
    });
    expect(expectOkInspect(reply).corpses).toEqual([]);
    expect(expectOkInspect(reply).vendors).toEqual([]);
  });

  it('clones the returned preference: mutating the reply never touches the stored choice', () => {
    const sim = setupSim();
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    // A deliberate mutable view over the (deliberately readonly) reply state,
    // the one sanctioned cast in this file: the test's whole point is proving
    // a caller mutation cannot reach the stored preference.
    const state = expectOk(reply).state as { preference: { kind: string; itemId?: string } };
    state.preference.kind = 'material';
    state.preference.itemId = 'rough_hide';
    expect(sim.harvestPreferenceFor(sim.playerId)).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('discovers an in-range, eligible corpse with distance and x/z alongside the real corpseHarvestInfo answer', () => {
    const sim = setupSim();
    sim.addItem('field_kit', 1, sim.playerId);
    const mob = spawnWolfCorpse(sim, 90001, OPEN_FIELD.x, OPEN_FIELD.z);
    const info = sim.corpseHarvestInfo(mob.id, sim.playerId);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).corpses).toEqual([
      { ...info, distance: dist2d(sim.player.pos, mob.pos), x: mob.pos.x, z: mob.pos.z },
    ]);
  });

  it('lists a harvest-only body (no ordinary loot) and a loot-only body (nothing_to_harvest) alike', () => {
    const sim = setupSim();
    // A field kit in hand isolates componentTags as the ONLY thing that
    // differs between the two bodies below (both are in range, unclaimed,
    // unreserved and fresh), so each body's denial reflects exactly its own
    // harvestability, independent of whichever body also carries ordinary loot.
    sim.addItem('field_kit', 1, sim.playerId);
    const harvestOnly = spawnWolfCorpse(sim, 90002, OPEN_FIELD.x, OPEN_FIELD.z);
    const lootOnly = spawnLootOnlyCorpse(sim, 90003, OPEN_FIELD.x, OPEN_FIELD.z, sim.playerId);

    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    const byId = new Map(expectOkInspect(reply).corpses.map((row) => [row.corpseId, row]));

    // Harvest-only: real componentTags, fully eligible (denial null), even
    // though it carries no ordinary loot at all.
    expect(byId.get(harvestOnly.id)).toMatchObject({
      componentTags: ['hide', 'fang'],
      denial: null,
    });
    // Loot-only: no componentTags at all (mogger_lackey carries none in
    // src/sim/content/zone1.ts), so the harvest read is nothing_to_harvest
    // regardless of its real (independent) ordinary loot. Confirm that loot
    // is real, through the same ordinary Sim.interact path the online/offline
    // hosts use (never a gathering verb: harvest and ordinary looting stay
    // deliberately independent, tests/interact_loot_only.test.ts covers the
    // full contract).
    expect(byId.get(lootOnly.id)).toMatchObject({
      componentTags: [],
      denial: 'nothing_to_harvest',
    });
    const copperBefore = sim.copper;
    sim.targetEntity(lootOnly.id);
    sim.interact();
    expect(sim.copper).toBe(copperBefore + 5);
  });

  it('excludes a corpse far outside the popup disclosure range', () => {
    const sim = setupSim();
    spawnWolfCorpse(sim, 90004, OPEN_FIELD.x + 500, OPEN_FIELD.z + 500);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).corpses).toEqual([]);
  });

  it('excludes a same-position corpse once the actor crosses into a real instance (wrong scope)', () => {
    const sim = setupSim();
    const mob = spawnWolfCorpse(sim, 90005, OPEN_FIELD.x, OPEN_FIELD.z);
    expect(sim.corpseHarvestInfo(mob.id, sim.playerId)).not.toBeNull();
    placeInDungeon(sim, sim.playerId);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).corpses).toEqual([]);
  });

  it('discloses a reservation held by another actor, never as this viewer', () => {
    const sim = setupSim();
    // The primary viewer needs its OWN field kit: no_field_kit precedes
    // reserved in the admission's refusal order (harvest_admission.ts), so
    // without one this row would disclose no_field_kit, not reserved.
    sim.addItem('field_kit', 1, sim.playerId);
    // The corpse and Bravo share a spot one unit off the primary player's own
    // open-field position: close enough for both actors' own range checks,
    // never the exact same coordinates as another live actor.
    const mob = spawnWolfCorpse(sim, 90006, OPEN_FIELD.x + 1, OPEN_FIELD.z);
    const bravo = sim.addPlayer('warrior', 'Bravo');
    placePlayerInOpenField(sim, bravo, { x: 1 });
    sim.addItem('field_kit', 1, bravo);
    expect(sim.harvestCorpse(mob.id, bravo)).toBe(true);

    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    const row = expectOkInspect(reply).corpses.find((r) => r.corpseId === mob.id);
    expect(row).toMatchObject({ denial: 'reserved', reservation: { name: 'Bravo', self: false } });
  });

  it('orders corpses by distance first, even against a contradicting id order', () => {
    const sim = setupSim();
    // The far body gets the SMALLER id and the near body the LARGER one, so a
    // sort that (wrongly) prioritized id over distance would fail this.
    const far = spawnWolfCorpse(sim, 90090, OPEN_FIELD.x + 5, OPEN_FIELD.z);
    const near = spawnWolfCorpse(sim, 90099, OPEN_FIELD.x + 2, OPEN_FIELD.z);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).corpses.map((r) => r.corpseId)).toEqual([near.id, far.id]);
  });

  it('caps corpse discovery at 16, tie-broken by ascending positive entity id at equal distance', () => {
    const sim = setupSim();
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) {
      const id = 91000 + i;
      spawnWolfCorpse(sim, id, OPEN_FIELD.x, OPEN_FIELD.z);
      ids.push(id);
    }
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).corpses).toHaveLength(16);
    expect(expectOkInspect(reply).corpses.map((r) => r.corpseId)).toEqual(
      ids.slice(0, 16).sort((a, b) => a - b),
    );
  });

  it('enumerates candidates through the real spatial grid, not a bare full-entity scan', () => {
    const sim = setupSim();
    spawnWolfCorpse(sim, 90007, OPEN_FIELD.x, OPEN_FIELD.z);
    const spy = spyOnGridRadius(sim);
    executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(spy.calls).toBeGreaterThan(0);
    spy.restore();
  });

  it('discovers a real field-kit vendor in purchase range with id, name, distance and x/z', () => {
    const sim = setupSim();
    const wilkes = findNpc(sim, 'trader_wilkes');
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    // toContainEqual rather than an exact single-element array: real town
    // content may place another field-kit seller within the same purchase
    // range, and this test's job is the SHAPE of Wilkes's own row, not the
    // whole roster.
    expect(expectOkInspect(reply).vendors).toContainEqual({
      id: wilkes.id,
      name: wilkes.name,
      distance: dist2d(sim.player.pos, wilkes.pos),
      x: wilkes.pos.x,
      z: wilkes.pos.z,
    });
  });

  it('excludes a real field-kit vendor once the actor is outside the actual purchase range', () => {
    const sim = setupSim();
    const wilkes = findNpc(sim, 'trader_wilkes');
    teleportTo(sim, wilkes.pos.x + INTERACT_RANGE + 40, wilkes.pos.z);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).vendors.some((v) => v.id === wilkes.id)).toBe(false);
  });

  it('excludes an in-range NPC that does not stock the field kit', () => {
    const sim = setupSim();
    // smith_haldren is a real NPC (zone1 content) that does not sell field_kit
    // (see the FIELD_KIT_SELLERS roster pinned in tests/field_kit_content.test.ts;
    // farmer_jessica, unlike smith_haldren, DOES sell it, so is not usable here).
    const nonSeller = findNpc(sim, 'smith_haldren');
    teleportTo(sim, nonSeller.pos.x + 2, nonSeller.pos.z);
    const reply = executeGatheringCommand(sim, { cmd: 'gathering', verb: 'inspect' });
    expect(expectOkInspect(reply).vendors.some((v) => v.id === nonSeller.id)).toBe(false);
  });
});

describe('buy_field_kit: a real vendor purchase, never a synthetic grant', () => {
  it('buys exactly one field kit for exactly 20 copper from a real in-range seller', () => {
    const sim = setupSim();
    const wilkes = findNpc(sim, 'trader_wilkes');
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 20;
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;

    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'buy_field_kit',
      npcId: wilkes.id,
    });

    expect(reply).toEqual({
      ok: true,
      verb: 'buy_field_kit',
      state: { fieldKitCount: 1, copper: 0, preference: HARVEST_PREFERENCE_ALL },
    });
    expect(sim.countItem('field_kit', sim.playerId)).toBe(1);
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
  });

  it('buys exactly one kit per call: two successful calls yield two kits, never a batch', () => {
    const sim = setupSim();
    const wilkes = findNpc(sim, 'trader_wilkes');
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 40;

    const first = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'buy_field_kit',
      npcId: wilkes.id,
    });
    expect(first).toMatchObject({ state: { fieldKitCount: 1 } });
    const second = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'buy_field_kit',
      npcId: wilkes.id,
    });
    expect(second).toMatchObject({ state: { fieldKitCount: 2, copper: 0 } });
    expect(sim.countItem('field_kit', sim.playerId)).toBe(2);
  });

  it('refuses purchase_refused against a non-vendor id, granting nothing', () => {
    const sim = setupSim();
    sim.copper = 20;
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'buy_field_kit',
      npcId: sim.playerId, // a real entity id, but not a stocking vendor
    });
    expect(reply).toEqual({
      ok: false,
      verb: 'buy_field_kit',
      reason: 'purchase_refused',
      state: { fieldKitCount: 0, copper: 20, preference: HARVEST_PREFERENCE_ALL },
    });
    expect(sim.countItem('field_kit', sim.playerId)).toBe(0);
  });

  it('refuses purchase_refused on insufficient copper from a real in-range seller', () => {
    const sim = setupSim();
    const wilkes = findNpc(sim, 'trader_wilkes');
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 0;
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'buy_field_kit',
      npcId: wilkes.id,
    });
    expect(reply).toMatchObject({
      ok: false,
      reason: 'purchase_refused',
      state: { fieldKitCount: 0 },
    });
    expect(sim.countItem('field_kit', sim.playerId)).toBe(0);
  });

  it('never advances sim time on a refused purchase', () => {
    const sim = setupSim();
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    executeGatheringCommand(sim, { cmd: 'gathering', verb: 'buy_field_kit', npcId: sim.playerId });
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
  });
});

describe('set_preference: real acceptance, never widened to All', () => {
  it('accepts a real supported material and reports it back cloned', () => {
    const sim = setupSim();
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'rough_hide',
    });
    expect(reply).toEqual({
      ok: true,
      verb: 'set_preference',
      state: {
        fieldKitCount: 0,
        copper: sim.copper,
        preference: { kind: 'material', itemId: 'rough_hide' },
      },
    });
    expect(sim.harvestPreferenceFor(sim.playerId)).toEqual({
      kind: 'material',
      itemId: 'rough_hide',
    });
  });

  it('accepts re-sending the exact same preference as a success, not a no-op refusal', () => {
    const sim = setupSim();
    executeGatheringCommand(sim, { cmd: 'gathering', verb: 'set_preference', preference: 'all' });
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'all',
    });
    expect(reply).toMatchObject({
      ok: true,
      verb: 'set_preference',
      state: { preference: HARVEST_PREFERENCE_ALL },
    });
    expect(expectOk(reply)).not.toHaveProperty('reason');
  });

  it('rejects a well-formed token naming no real material as invalid_request, leaving the prior choice untouched', () => {
    const sim = setupSim();
    executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'rough_hide',
    });
    // Confirms the parser-first architecture, not just the pure parser:
    // executeGatheringCommand always parses before it ever touches the real
    // Sim (see tests/headless_gathering_protocol.test.ts for the parser's own
    // pin), so an unsupported material never reaches dispatch and never
    // becomes a preference_refused reply.
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'not_a_real_material',
    });
    expect(reply).toEqual({ ok: false, reason: 'invalid_request' });
    expect(sim.harvestPreferenceFor(sim.playerId)).toEqual({
      kind: 'material',
      itemId: 'rough_hide',
    });
  });

  it('draws no rng and never advances sim time', () => {
    const sim = setupSim();
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    const counter = drawCounter(sim);
    executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'wolf_fang',
    });
    expect(counter.stop()).toBe(0);
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
  });
});

describe('harvest: a real admitted timed start, never an immediate claim', () => {
  it('refuses harvest_refused with no field kit, starting nothing', () => {
    const sim = setupSim();
    const mob = spawnWolfCorpse(sim, 90200, OPEN_FIELD.x, OPEN_FIELD.z);
    const counter = drawCounter(sim);
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'harvest',
      corpseId: mob.id,
    });
    expect(counter.stop()).toBe(0);
    expect(reply).toEqual({
      ok: false,
      verb: 'harvest',
      reason: 'harvest_refused',
      state: { fieldKitCount: 0, copper: sim.copper, preference: HARVEST_PREFERENCE_ALL },
    });
    expect(mustEntity(sim, sim.playerId).castingAbility).toBeNull();
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('admits a real timed start with no reason and no immediate claim', () => {
    const sim = setupSim();
    sim.addItem('field_kit', 1, sim.playerId);
    const mob = spawnWolfCorpse(sim, 90201, OPEN_FIELD.x, OPEN_FIELD.z);
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;

    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'harvest',
      corpseId: mob.id,
    });

    expect(reply).toMatchObject({ ok: true, verb: 'harvest' });
    expect(expectOk(reply)).not.toHaveProperty('reason');
    expect(mustEntity(sim, sim.playerId).castingAbility).not.toBeNull();
    expect(mob.harvestClaimedBy).toBeNull(); // admitted, not yet granted
    expect(sim.tickCount).toBe(tickBefore); // the command itself advanced no time
    expect(sim.time).toBe(timeBefore);
  });

  it('completes a real 30-tick cast (HARVEST_CAST_SECONDS worth) and lands the grant, driven only by real sim.tick()', () => {
    const sim = setupSim();
    sim.addItem('field_kit', 1, sim.playerId);
    const mob = spawnWolfCorpse(sim, 90202, OPEN_FIELD.x, OPEN_FIELD.z);
    executeGatheringCommand(sim, { cmd: 'gathering', verb: 'harvest', corpseId: mob.id });

    expect(TICKS_PER_CAST).toBe(30);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();

    expect(mob.harvestClaimedBy).toBe(sim.playerId);
    expect(mustEntity(sim, sim.playerId).castingAbility).toBeNull();
  });

  it('reports harvest_refused for a focused preference this body does not carry, preserving the choice', () => {
    const sim = setupSim();
    sim.addItem('field_kit', 1, sim.playerId);
    const mob = spawnWolfCorpse(sim, 90203, OPEN_FIELD.x, OPEN_FIELD.z);
    // homespun_cloth is a genuinely supported material overall (some other
    // body's tag), just not one forest_wolf carries: set_preference must
    // succeed here, and only the harvest attempt itself refuses.
    const setReply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'set_preference',
      preference: 'homespun_cloth',
    });
    expect(expectOk(setReply)).not.toHaveProperty('reason');

    const counter = drawCounter(sim);
    const reply = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'harvest',
      corpseId: mob.id,
    });
    expect(counter.stop()).toBe(0);
    expect(reply).toMatchObject({
      ok: false,
      verb: 'harvest',
      reason: 'harvest_refused',
      state: { preference: { kind: 'material', itemId: 'homespun_cloth' } },
    });
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mustEntity(sim, sim.playerId).castingAbility).toBeNull();
  });

  it('a movement cancellation mid-cast releases the reservation so a fresh command on the same body succeeds again', () => {
    const sim = setupSim();
    sim.addItem('field_kit', 1, sim.playerId);
    const mob = spawnWolfCorpse(sim, 90204, OPEN_FIELD.x, OPEN_FIELD.z);
    executeGatheringCommand(sim, { cmd: 'gathering', verb: 'harvest', corpseId: mob.id });
    sim.tick();

    const p = mustEntity(sim, sim.playerId);
    sim.moveInput.forward = true;
    sim.tick();
    sim.moveInput.forward = false;
    placePlayerInOpenField(sim);
    sim.tick();

    expect(p.castingAbility).toBeNull();
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();

    const retry = executeGatheringCommand(sim, {
      cmd: 'gathering',
      verb: 'harvest',
      corpseId: mob.id,
    });
    expect(retry).toMatchObject({ ok: true, verb: 'harvest' });
    expect(expectOk(retry)).not.toHaveProperty('reason');
  });
});
