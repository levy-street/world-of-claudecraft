import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import {
  drainGatheringGrants,
  emptyGatheringProficiency,
  GATHER_GAIN_TIER_STEP,
  gatherNodeGainMultiplier,
  normalizeGatheringProficiency,
  queueGatheringGrant,
} from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
}

describe('gathering profession proficiency (#1119)', () => {
  it('content table defines the four gathering professions', () => {
    expect(Object.keys(GATHERING_PROFESSIONS).sort()).toEqual([
      'fishing',
      'herbalism',
      'logging',
      'mining',
    ]);
  });

  it('granting Mining leaves Logging and Herbalism completely unchanged', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 5', pid);
    sim.tick();
    const meta = (sim as any).players.get(pid);
    expect(meta.gatheringProficiency).toEqual({ mining: 5, logging: 0, herbalism: 0, fishing: 0 });

    sim.chat('/dev gather mining 3', pid);
    sim.tick();
    expect(meta.gatheringProficiency).toEqual({ mining: 8, logging: 0, herbalism: 0, fishing: 0 });

    sim.chat('/dev gather logging 2', pid);
    sim.tick();
    // Mining is untouched by a Logging grant: independent, additive counters.
    expect(meta.gatheringProficiency).toEqual({ mining: 8, logging: 2, herbalism: 0, fishing: 0 });
  });

  it('the IWorld read surface exposes the same per-profession skills, mapped to PlayerProfessionSkill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather herbalism 4', pid);
    sim.tick();
    // The enforced per-profession caps (mining/logging/herbalism 100,
    // fishing 200) replace the old uniform 300.
    const expected = {
      skills: [
        { professionId: 'mining', skill: 0, maxSkill: 100 },
        { professionId: 'logging', skill: 0, maxSkill: 100 },
        { professionId: 'herbalism', skill: 4, maxSkill: 100 },
        { professionId: 'fishing', skill: 0, maxSkill: 200 },
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
    expect(state.professions).toEqual({ mining: 7, logging: 0, herbalism: 2, fishing: 0 });

    // Fresh Sim, same character, loading the saved state back in.
    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'Loaded', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    expect(meta2.gatheringProficiency).toEqual({ mining: 7, logging: 0, herbalism: 2, fishing: 0 });
  });

  it('a NONZERO fishing proficiency survives the save/load round trip', () => {
    // Every other persistence fixture in this file carries fishing:0, so a
    // regression dropping the fishing key from serializeCharacter (or a
    // hand-rolled normalize key list) would stay green without this pin.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 7', pid);
    sim.chat('/dev gather fishing 57', pid);
    sim.tick();

    const state = (sim as any).serializeCharacter(pid);
    // The save dual-writes both the legacy and the current key.
    expect(state.professions).toEqual({ mining: 7, logging: 0, herbalism: 0, fishing: 57 });
    expect(state.gatheringProficiency).toEqual({
      mining: 7,
      logging: 0,
      herbalism: 0,
      fishing: 57,
    });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'RoundTrip', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    expect(meta2.gatheringProficiency).toEqual({
      mining: 7,
      logging: 0,
      herbalism: 0,
      fishing: 57,
    });
  });

  it('ACCEPTED ROLLBACK CAVEAT (documented semantic): a pre-fishing-support round trip re-zeroes fishing only', () => {
    // A pre-fishing-support loader normalizes the blob to the starter three keys, so
    // a save written by that code path comes back WITHOUT the fishing key:
    // accrued fishing proficiency is deliberately lost on the downgrade round
    // trip (the mailWelcomed class; release-notes line at tag time) while the
    // other three professions survive untouched.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.chat('/dev gather mining 7', pid);
    sim.chat('/dev gather fishing 57', pid);
    sim.tick();
    const state = (sim as any).serializeCharacter(pid);
    delete state.professions.fishing;
    delete state.gatheringProficiency.fishing;

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'RolledBack', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    expect(meta2.gatheringProficiency).toEqual({ mining: 7, logging: 0, herbalism: 0, fishing: 0 });
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
    expect(meta2.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0, fishing: 0 });
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
    expect(state.professions).toEqual({ mining: 6, logging: 0, herbalism: 0, fishing: 0 });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const loadedPid = sim2.addPlayer('warrior', 'PreRename', { state });
    const meta2 = (sim2 as any).players.get(loadedPid);
    // Regression pin for the dead reassignments that dropped this fallback:
    // must load the legacy data, not all-zero.
    expect(meta2.gatheringProficiency).toEqual({ mining: 6, logging: 0, herbalism: 0, fishing: 0 });
  });

  it('normalizeGatheringProficiency defaults zero on undefined/partial/malformed input', () => {
    expect(normalizeGatheringProficiency(undefined)).toEqual(emptyGatheringProficiency());
    expect(normalizeGatheringProficiency({})).toEqual(emptyGatheringProficiency());
    expect(normalizeGatheringProficiency({ mining: 3 })).toEqual({
      mining: 3,
      logging: 0,
      herbalism: 0,
      fishing: 0,
    });
    // malformed/negative values are clamped, never thrown
    expect(normalizeGatheringProficiency({ mining: -5, logging: 'nope' as any })).toEqual({
      mining: 0,
      logging: 0,
      herbalism: 0,
      fishing: 0,
    });
    // A nonzero fishing value passes through intact (every other
    // fixture in this file feeds fishing 0, which a fishing-specific drop
    // would satisfy vacuously).
    expect(normalizeGatheringProficiency({ fishing: 57 })).toEqual({
      mining: 0,
      logging: 0,
      herbalism: 0,
      fishing: 57,
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
    expect(meta.gatheringProficiency).toEqual({ mining: 7, logging: 0, herbalism: 0, fishing: 0 });
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
    expect(meta.gatheringProficiency).toEqual({ mining: 5, logging: 0, herbalism: 0, fishing: 0 });
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
    expect(meta.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0, fishing: 0 });
  });

  it('node-tier-relative gain: gatherNodeGainMultiplier walks the mastery curve AT the band boundaries', () => {
    // A node of tier T maps to gain tier T - 1, scored against
    // floor(proficiency / GATHER_GAIN_TIER_STEP) through the shared four-state
    // curve (wheel.ts). Pinned AT each boundary, not only past it.
    // t1 (all pre-phase content, bare hands): full through 24, then down.
    expect(gatherNodeGainMultiplier(0, 1)).toBe(1);
    expect(gatherNodeGainMultiplier(24, 1)).toBe(1);
    expect(gatherNodeGainMultiplier(25, 1)).toBe(0.5);
    expect(gatherNodeGainMultiplier(49, 1)).toBe(0.5);
    expect(gatherNodeGainMultiplier(50, 1)).toBe(0.25);
    expect(gatherNodeGainMultiplier(74, 1)).toBe(0.25);
    expect(gatherNodeGainMultiplier(75, 1)).toBe(0); // t1 nodes gray out at 75+
    // t2: full through 49 (carries the band below 50).
    expect(gatherNodeGainMultiplier(49, 2)).toBe(1);
    expect(gatherNodeGainMultiplier(50, 2)).toBe(0.5);
    expect(gatherNodeGainMultiplier(75, 2)).toBe(0.25);
    // t3 (Thornpeak): full through 74, still reduced at 99: what finishes the
    // climb to 100.
    expect(gatherNodeGainMultiplier(74, 3)).toBe(1);
    expect(gatherNodeGainMultiplier(75, 3)).toBe(0.5);
    expect(gatherNodeGainMultiplier(99, 3)).toBe(0.5);
    // Negative or degenerate inputs clamp instead of throwing.
    expect(gatherNodeGainMultiplier(-5, 1)).toBe(1);
    expect(gatherNodeGainMultiplier(0, 0)).toBe(1);
  });

  it('pins GATHER_GAIN_TIER_STEP at its literal value', () => {
    expect(GATHER_GAIN_TIER_STEP).toBe(25);
  });

  it('rejects an unknown profession id without throwing or granting anything', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // 'skinning' is deliberately not a gathering profession in this game (its
    // materials come from corpse harvest instead; see professions/gathering.ts),
    // so it stands in as the unknown id now that 'fishing' is a real one.
    expect(() => sim.chat('/dev gather skinning 5', pid)).not.toThrow();
    sim.tick();
    const meta = (sim as any).players.get(pid);
    expect(meta.gatheringProficiency).toEqual({ mining: 0, logging: 0, herbalism: 0, fishing: 0 });
  });
});
