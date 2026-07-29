// The world population invariant, as a CLASS detector rather than a list of
// known offenders.
//
// Rule: the open world may never hold more live mobs of a template than its
// authored CAMPS place, except for the wave of a run that is currently active.
// Anything that spawns mobs and forgets to reclaim them violates this, whatever
// the mechanism, so this catches the next leak as well as the one it was written
// for (escort ambush waves, which each run left behind permanently).
//
// Deliberately driven through the real Sim and the real content tables: the
// point is to exercise every shipped escort, not a fixture.
import { describe, expect, it } from 'vitest';
import { CAMPS, DUNGEON_X_THRESHOLD, ESCORTS, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

/** Authored standing population per template, from the camp tables. */
function authoredCounts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const camp of CAMPS) {
    if (!MOBS[camp.mobId]) continue;
    out.set(camp.mobId, (out.get(camp.mobId) ?? 0) + camp.count);
  }
  return out;
}

/** Live open-world mobs per template (instanced content excluded). */
function liveCounts(sim: Sim): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (e.spawnPos.x > DUNGEON_X_THRESHOLD) continue; // instance plane
    out.set(e.templateId, (out.get(e.templateId) ?? 0) + 1);
  }
  return out;
}

/** Templates a run is allowed to add to the world WHILE it is active. */
function activeWaveAllowance(sim: Sim): Map<string, number> {
  const out = new Map<string, number>();
  for (const def of Object.values(ESCORTS)) {
    const state = sim.escortRuns.get(def.id);
    if (!state?.run) continue;
    for (const ambush of def.ambushes) {
      out.set(ambush.mobId, (out.get(ambush.mobId) ?? 0) + ambush.count);
    }
    // The escortee itself is a live mob while the run walks.
    out.set(def.npcMobId, (out.get(def.npcMobId) ?? 0) + 1);
  }
  return out;
}

/** Escortees stand idle in the world between runs; that is authored, not a leak. */
function idleEscorteeAllowance(): Map<string, number> {
  const out = new Map<string, number>();
  for (const def of Object.values(ESCORTS)) {
    out.set(def.npcMobId, (out.get(def.npcMobId) ?? 0) + 1);
  }
  return out;
}

function assertPopulationSane(sim: Sim, label: string): void {
  const authored = authoredCounts();
  const wave = activeWaveAllowance(sim);
  const idle = idleEscorteeAllowance();
  const over: string[] = [];
  for (const [templateId, live] of liveCounts(sim)) {
    const budget =
      (authored.get(templateId) ?? 0) + (wave.get(templateId) ?? 0) + (idle.get(templateId) ?? 0);
    if (live > budget) over.push(`${templateId}: ${live} live vs ${budget} allowed`);
  }
  expect(over, label).toEqual([]);
}

function findByTemplate(sim: Sim, templateId: string): Entity | undefined {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead,
  );
}

describe('open-world population never exceeds what the content authored', () => {
  it('holds at world generation', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
    assertPopulationSane(sim, 'at boot');
  });

  it('holds after every shipped escort is run and its wave is killed, repeatedly', () => {
    // One sim, every escort, several cycles each: the leak this guards compounds
    // per run, so a survivor shows up as a growing template count.
    const sim = new Sim({
      seed: 424242,
      playerClass: 'warrior',
      playerName: 'Escorter',
      respawnSeconds: 2, // resolve "did it come back?" in seconds of sim time
    });
    sim.player.level = 20;

    let ranAtLeastOne = false;
    for (const def of Object.values(ESCORTS)) {
      for (let round = 0; round < 2; round++) {
        sim.questLog.set(def.questId, { questId: def.questId, counts: [0], state: 'active' });
        const escortee = findByTemplate(sim, def.npcMobId);
        if (!escortee) continue; // not yet respawned; the next escort still runs
        const pos = sim.groundPos(escortee.pos.x, escortee.pos.z + 2);
        sim.player.pos = { ...pos };
        sim.player.prevPos = { ...pos };
        sim.interact();
        if (!sim.escortRuns.get(def.id)?.run) continue;
        ranAtLeastOne = true;

        // Walk until the first wave spawns, then kill all of it.
        let ids: number[] = [];
        for (let i = 0; i < 60 * 20 && ids.length === 0; i++) {
          sim.tick();
          ids = [...(sim.escortRuns.get(def.id)?.run?.ambushIds ?? [])];
        }
        for (const id of ids) {
          const mob = sim.entities.get(id);
          if (mob) sim.dealDamage(null, mob, mob.hp, false, 'physical', null, 'hit');
        }
        // Fail the run so the escortee cycles and the next round can start.
        const walker = findByTemplate(sim, def.npcMobId);
        if (walker) sim.dealDamage(null, walker, walker.hp, false, 'physical', null, 'hit');
        for (let i = 0; i < 50 * 20; i++) sim.tick();

        assertPopulationSane(sim, `${def.id} round ${round + 1}`);
      }
    }
    expect(ranAtLeastOne, 'no escort actually ran, so this proved nothing').toBe(true);
  }, 120_000);

  it('names the escort ambush templates it is protecting, so the sweep is visible', () => {
    // Every shipped escort wave template, spelled out. If a new escort ships,
    // this list moves and the author sees that the guard above now covers it.
    const waveTemplates = [
      ...new Set(Object.values(ESCORTS).flatMap((d) => d.ambushes.map((a) => a.mobId))),
    ].sort();
    expect(waveTemplates).toEqual([
      'breach_wretch',
      'canopy_weaver',
      'fen_sprite',
      'snowdrift_wolf',
      'tide_scuttler',
      'void_stalker',
      'widowsilk_spinner',
      'wood_wraith',
    ]);
    // ...and each is a real template placed by real camps, so the budget above
    // is a meaningful number rather than zero.
    for (const id of waveTemplates) expect(MOBS[id], id).toBeTruthy();
  });
});
