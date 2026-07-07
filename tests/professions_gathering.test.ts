import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import {
  drainGatheringGrants,
  emptyGatheringProficiency,
  normalizeGatheringProficiency,
  queueGatheringGrant,
} from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
}

describe('gathering profession proficiency (#1119)', () => {
  it('content table defines the starter three professions', () => {
    expect(Object.keys(GATHERING_PROFESSIONS).sort()).toEqual(['herbalism', 'logging', 'mining']);
  });

  it('granting Mining leaves Logging and Herbalism completely unchanged', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 5', pid);
    sim.tick();
    const meta = (sim as any).players.get(pid);
    expect(meta.gatheringProficiency).toEqual({ mining: 5, logging: 0, herbalism: 0 });

    sim.chat('/dev gather mining 3', pid);
    sim.tick();
    expect(meta.gatheringProficiency).toEqual({ mining: 8, logging: 0, herbalism: 0 });

    sim.chat('/dev gather logging 2', pid);
    sim.tick();
    // Mining is untouched by a Logging grant: independent, additive counters.
    expect(meta.gatheringProficiency).toEqual({ mining: 8, logging: 2, herbalism: 0 });
  });

  it('the IWorld read surface exposes the same per-profession skills, mapped to PlayerProfessionSkill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather herbalism 4', pid);
    sim.tick();
    const expected = {
      skills: [
        { professionId: 'mining', skill: 0, maxSkill: 300 },
        { professionId: 'logging', skill: 0, maxSkill: 300 },
        { professionId: 'herbalism', skill: 4, maxSkill: 300 },
      ],
    };
    expect(sim.professionsState).toEqual(expected);
    expect(sim.professionsStateFor(pid)).toEqual(expected);
  });

  it('persists across a save/load round trip', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 7', pid);
    sim.chat('/dev gather herbalism 2', pid);
    sim.tick();

    const state = (sim as any).serializeCharacter(pid);
    expect(state.professions).toEqual({ mining: 7, logging: 0, herbalism: 2 });

    // Fresh Sim, same character, loading the saved state back in.
    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'Loaded', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    expect(meta2.gatheringProficiency).toEqual({ mining: 7, logging: 0, herbalism: 2 });
  });

  it('backward-compatible: an old save lacking the field loads with all-zero proficiency', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const state = (sim as any).serializeCharacter(pid);
    delete state.professions; // simulate a pre-professions save

    let loadedPid = -1;
    expect(() => {
      const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
      loadedPid = sim2.addPlayer('warrior', 'Old', { state });
    }).not.toThrow();

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    loadedPid = sim2.addPlayer('warrior', 'Old', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    expect(meta2.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0 });
  });

  it('a genuine pre-rename save (professions set, gatheringProficiency absent) loads via the legacy fallback', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 6', pid);
    sim.tick();

    const state = (sim as any).serializeCharacter(pid);
    // Simulate a save written before the gatheringProficiency rename: only the
    // legacy `professions` key carries real data.
    delete state.gatheringProficiency;
    expect(state.professions).toEqual({ mining: 6, logging: 0, herbalism: 0 });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'PreRename', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    // Regression pin for the dead reassignments that dropped this fallback:
    // must load the legacy data, not all-zero.
    expect(meta2.gatheringProficiency).toEqual({ mining: 6, logging: 0, herbalism: 0 });
  });

  it('normalizeGatheringProficiency defaults zero on undefined/partial/malformed input', () => {
    expect(normalizeGatheringProficiency(undefined)).toEqual(emptyGatheringProficiency());
    expect(normalizeGatheringProficiency({})).toEqual(emptyGatheringProficiency());
    expect(normalizeGatheringProficiency({ mining: 3 })).toEqual({
      mining: 3,
      logging: 0,
      herbalism: 0,
    });
    // malformed/negative values are clamped, never thrown
    expect(normalizeGatheringProficiency({ mining: -5, logging: 'nope' as any })).toEqual({
      mining: 0,
      logging: 0,
      herbalism: 0,
    });
  });

  it('determinism: the same seed and same sequence of grants yields the same result', () => {
    const run = () => {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.chat('/dev gather mining 1', pid);
      sim.tick();
      sim.chat('/dev gather mining 2', pid);
      sim.tick();
      sim.chat('/dev gather logging 4', pid);
      sim.tick();
      sim.chat('/dev gather herbalism 9', pid);
      sim.tick();
      return (sim as any).players.get(pid).gatheringProficiency;
    };
    expect(run()).toEqual(run());
  });

  it('gain uses only fixed deterministic amounts, never Math.random, at the module level', () => {
    // queueGatheringGrant/drainGatheringGrants take an explicit amount and do a
    // plain additive update: no rng draw is possible in this module. Prove the
    // drain is a pure function of the queued amount, called directly (no sim).
    const meta: any = {
      pendingGatherGrants: [],
      gatheringProficiency: emptyGatheringProficiency(),
    };
    queueGatheringGrant(meta, 'mining', 3);
    queueGatheringGrant(meta, 'mining', 4);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency).toEqual({ mining: 7, logging: 0, herbalism: 0 });
    expect(meta.pendingGatherGrants).toEqual([]);
  });

  it('rejects a non-positive amount at queue time: proficiency is additive-only, no decrement path', () => {
    const meta: any = {
      pendingGatherGrants: [],
      gatheringProficiency: emptyGatheringProficiency(),
    };
    queueGatheringGrant(meta, 'mining', 5);
    queueGatheringGrant(meta, 'mining', -3);
    queueGatheringGrant(meta, 'mining', 0);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency).toEqual({ mining: 5, logging: 0, herbalism: 0 });
    expect(meta.pendingGatherGrants).toEqual([]);
  });

  it('a queued grant only takes effect once sim.tick() runs (the 20 Hz tick path, not out of band)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 5', pid);
    const meta = (sim as any).players.get(pid);
    // Queued, but not yet applied: the grant is still pending until the next tick.
    expect(meta.pendingGatherGrants.length).toBe(1);
    expect(meta.gatheringProficiency.mining).toBe(0);

    sim.tick(); // one tick = DT = 1/20 second
    expect(meta.pendingGatherGrants.length).toBe(0);
    expect(meta.gatheringProficiency.mining).toBe(5);
  });

  it('the /dev gather cheat is gated by devCommands (never a bypass path)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }); // devCommands off
    const pid = sim.playerId;
    sim.chat('/dev gather mining 5', pid);
    sim.tick();
    const meta = (sim as any).players.get(pid);
    expect(meta.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0 });
  });

  it('rejects an unknown profession id without throwing or granting anything', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(() => sim.chat('/dev gather fishing 5', pid)).not.toThrow();
    sim.tick();
    const meta = (sim as any).players.get(pid);
    expect(meta.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0 });
  });
});
