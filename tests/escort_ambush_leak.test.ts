// Repro + guard for the escort ambush leak: a run's ambush mobs are run-scoped,
// but a KILLED one used to survive the run as a permanent world spawn.
//
// endRun drops surviving ambush mobs with an `!mob.dead` guard, so a corpse was
// skipped. Its respawnTimer then elapsed and updateMob respawned it in place,
// with no run left to own it. Every run therefore left behind however many of
// its wave the player actually killed, and those accumulated at the ambush point
// run after run. Escorts only exist in the July-2026 zones, which is exactly
// where players reported piles of stacked mobs and why the older zones were fine.
import { describe, expect, it } from 'vitest';
import { ESCORTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const ESCORT_ID = 'esc_fv_wren';
const QUEST_ID = 'q_fv_seeing_wren_home';
const ESCORTEE_TEMPLATE = 'apprentice_wren';

function makeSim(): Sim {
  // respawnSeconds pins the whole world to a 2s base, so "did a killed
  // ambusher come back?" resolves in a couple of seconds of sim time instead of
  // waiting out Frostveil's 180s tier. Without the fix the leak still shows.
  const sim = new Sim({
    seed: 424242,
    playerClass: 'warrior',
    playerName: 'Escorter',
    respawnSeconds: 2,
  });
  sim.player.level = 20;
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
  return sim;
}

function findEscortee(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === ESCORTEE_TEMPLATE && !e.dead,
  );
}

function ambushIds(sim: Sim): number[] {
  return [...(sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [])];
}

/** Live (not dead, still in the world) mobs of a template, anywhere. */
function liveOf(sim: Sim, templateId: string): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead,
  );
}

/** Start a run and walk it until its first ambush wave has spawned. */
function runToFirstAmbush(sim: Sim): number[] {
  const def = ESCORTS[ESCORT_ID];
  const escortee = findEscortee(sim);
  if (!escortee) throw new Error('no idle escortee');
  const pos = sim.groundPos(escortee.pos.x, escortee.pos.z + 2);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.interact();
  if (!sim.escortRuns.get(ESCORT_ID)?.run) throw new Error('run did not start');
  let ids: number[] = [];
  for (let i = 0; i < 60 * 20 && ids.length === 0; i++) {
    sim.tick();
    ids = ambushIds(sim);
  }
  if (ids.length === 0) throw new Error('ambush never fired');
  expect(ids.length).toBe(def.ambushes[0].count);
  return ids;
}

describe('escort ambush mobs never outlive their run', () => {
  it('does not leave a KILLED ambush mob behind to respawn forever', () => {
    const sim = makeSim();
    const ambushTemplate = ESCORTS[ESCORT_ID].ambushes[0].mobId;
    const baseline = liveOf(sim, ambushTemplate).length;

    const ids = runToFirstAmbush(sim);
    // Kill the whole wave, the way a player escorting the run would.
    for (const id of ids) {
      const mob = sim.entities.get(id);
      if (mob) sim.dealDamage(null, mob, mob.hp, false, 'physical', null, 'hit');
    }
    for (const id of ids) expect(sim.entities.get(id)?.dead).toBe(true);

    // Let the run finish and the corpses decay well past any respawn window.
    for (let i = 0; i < 30 * 20; i++) sim.tick();

    // The zone's own camps of this template are untouched; the run's wave must
    // not have added to them.
    expect(liveOf(sim, ambushTemplate).length).toBe(baseline);
    // ...and none of the run's specific entity ids is alive in the world.
    for (const id of ids) {
      const mob = sim.entities.get(id);
      expect(mob === undefined || mob.dead, `ambush mob ${id} came back`).toBe(true);
    }
  });

  it('still despawns a SURVIVING ambush mob when the run ends, as before', () => {
    const sim = makeSim();
    const ambushTemplate = ESCORTS[ESCORT_ID].ambushes[0].mobId;
    const baseline = liveOf(sim, ambushTemplate).length;

    const ids = runToFirstAmbush(sim);
    // Kill the ESCORTEE instead, failing the run with the wave still alive.
    const escortee = findEscortee(sim);
    if (escortee) sim.dealDamage(null, escortee, escortee.hp, false, 'physical', null, 'hit');
    for (let i = 0; i < 30 * 20; i++) sim.tick();

    expect(liveOf(sim, ambushTemplate).length).toBe(baseline);
    // Fully GONE from the roster, not merely dead. A run-scoped mob no longer
    // respawns, so a corpse left behind would sit in the world forever: endRun
    // has to drop the wave in either state.
    for (const id of ids) {
      expect(sim.entities.get(id), `ambush mob ${id} lingered`).toBeUndefined();
    }
  });

  it('does not accumulate across repeated runs, which is the reported symptom', () => {
    const sim = makeSim();
    const ambushTemplate = ESCORTS[ESCORT_ID].ambushes[0].mobId;
    const baseline = liveOf(sim, ambushTemplate).length;

    for (let round = 0; round < 3; round++) {
      const ids = runToFirstAmbush(sim);
      for (const id of ids) {
        const mob = sim.entities.get(id);
        if (mob) sim.dealDamage(null, mob, mob.hp, false, 'physical', null, 'hit');
      }
      // Fail the run so the escortee respawns and the next round can start.
      const escortee = findEscortee(sim);
      if (escortee) sim.dealDamage(null, escortee, escortee.hp, false, 'physical', null, 'hit');
      for (let i = 0; i < 50 * 20; i++) sim.tick();
      sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    }

    // Three runs, three killed waves: without the fix this is baseline + 9.
    expect(liveOf(sim, ambushTemplate).length).toBe(baseline);
    // Drain past the corpse window first: a slain wave mob is DELIBERATELY left
    // as a lootable corpse until it lapses (summonedAdd unravels it in
    // mob/locomotion.ts), so asserting sooner would be asserting against the
    // loot window rather than against a leak.
    for (let i = 0; i < 90 * 20; i++) sim.tick();
    // And no corpse residue either: the roster holds no more mobs of this
    // template than the zone's own camps authored.
    const anyState = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === ambushTemplate,
    );
    expect(anyState.length).toBe(baseline);
  }, 120_000);
});
