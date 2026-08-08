// The lifetime played-time leaf (src/sim/playtime.ts) and the Sim facade
// getter it backs (IWorldProgressionXp.playtimeSeconds). The /playtime chat
// readout over the same pair is pinned in tests/chat.test.ts; the wire emit in
// tests/snapshots.test.ts.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { livePlaytimeSeconds } from '../src/sim/playtime';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

// The timelines below tick minutes of world time and never touch ambient
// content, so strip the constructor-spawned entities (the CHAT_TEST_WORLD
// doctrine in tests/chat.test.ts) to keep the loops cheap.
const PLAYTIME_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: PLAYTIME_TEST_WORLD,
  });
}

describe('livePlaytimeSeconds', () => {
  it('adds the elapsed session time to the persisted baseline, unfloored', () => {
    expect(livePlaytimeSeconds({ joinedAt: 0, totalPlayedSeconds: 0 }, 0)).toBe(0);
    expect(livePlaytimeSeconds({ joinedAt: 10, totalPlayedSeconds: 100.5 }, 25.25)).toBe(115.75);
  });

  it('never lets a clock behind joinedAt shrink the baseline', () => {
    expect(livePlaytimeSeconds({ joinedAt: 50, totalPlayedSeconds: 100 }, 10)).toBe(100);
  });
});

describe('Sim.playtimeSeconds (IWorldProgressionXp)', () => {
  it('starts at zero and advances with the sim clock', () => {
    const sim = makeSim();
    sim.addPlayer('warrior', 'Aleph');
    expect(sim.playtimeSeconds).toBe(0);
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(sim.playtimeSeconds).toBeCloseTo(30, 5);
  });

  it('equals what serializeCharacter folds at save (one formula, no drift)', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    const state = sim.serializeCharacter(a);
    expect(state?.totalPlayedSeconds).toBeCloseTo(sim.playtimeSeconds, 10);
  });

  it('degrades a corrupt non-finite saved baseline to zero at load', () => {
    // Math.max passes NaN through, so the load clamp guards with
    // Number.isFinite (the bgRating idiom); without it a corrupt save would
    // poison every future fold and ship null on the ptime wire.
    const donor = makeSim();
    const donorPid = donor.addPlayer('warrior', 'Aleph');
    const state = donor.serializeCharacter(donorPid);
    expect(state).not.toBeNull();
    const sim = makeSim();
    sim.addPlayer('warrior', 'Aleph', {
      state: { ...(state as object), totalPlayedSeconds: Number.NaN } as never,
    });
    expect(sim.playtimeSeconds).toBe(0);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.playtimeSeconds).toBeCloseTo(1, 5);
  });

  it('clamps a corrupt negative finite saved baseline to zero at load', () => {
    // The clamp's second arm: Number.isFinite passes a finite negative, so
    // the retained Math.max(0, ...) must catch it or a corrupt -50 save feeds
    // a negative lifetime onto the ptime wire and the sheet.
    const donor = makeSim();
    const donorPid = donor.addPlayer('warrior', 'Aleph');
    const state = donor.serializeCharacter(donorPid);
    expect(state).not.toBeNull();
    const sim = makeSim();
    sim.addPlayer('warrior', 'Aleph', {
      state: { ...(state as object), totalPlayedSeconds: -50 } as never,
    });
    expect(sim.playtimeSeconds).toBe(0);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.playtimeSeconds).toBeCloseTo(1, 5);
  });

  it('loads the saved baseline and keeps accruing on top (the relog path)', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    for (let i = 0; i < 20 * 65; i++) sim.tick();
    const state = sim.serializeCharacter(a);
    expect(state?.totalPlayedSeconds).toBeCloseTo(65, 5);

    // Relog: a fresh Sim (a restart resets sim.time to 0) loading the save.
    const sim2 = makeSim();
    sim2.addPlayer('warrior', 'Aleph', { state: state ?? undefined });
    expect(sim2.playtimeSeconds).toBeCloseTo(65, 5);
    for (let i = 0; i < 20 * 10; i++) sim2.tick();
    expect(sim2.playtimeSeconds).toBeCloseTo(75, 5);
  });

  it('re-derives the session epoch when relogging into a WARM sim', () => {
    // The live server's sim clock is far past zero when a character logs in,
    // so this is the shape that actually exercises the epoch re-derivation:
    // a joinedAt persisted with the save (or left at 0) reads 365 here, and a
    // baseline clobbered by the warm clock reads 300 or 305. Only a baseline
    // taken from the save plus a joinedAt minted AT join reads 65 then 75.
    const donor = makeSim();
    const a = donor.addPlayer('warrior', 'Aleph');
    for (let i = 0; i < 20 * 65; i++) donor.tick();
    const state = donor.serializeCharacter(a);
    expect(state?.totalPlayedSeconds).toBeCloseTo(65, 5);

    const sim2 = makeSim();
    for (let i = 0; i < 20 * 300; i++) sim2.tick();
    sim2.addPlayer('warrior', 'Aleph', { state: state ?? undefined });
    expect(sim2.playtimeSeconds).toBeCloseTo(65, 5);
    for (let i = 0; i < 20 * 10; i++) sim2.tick();
    expect(sim2.playtimeSeconds).toBeCloseTo(75, 5);
  });

  it('folds idempotently across repeated saves in one session (no double-count)', () => {
    // The classic regression this pins against: a later change that "commits"
    // the fold by writing meta.totalPlayedSeconds back at save without also
    // resetting meta.joinedAt would double-count every subsequent second
    // (the second save here would read 90, not 60).
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(sim.serializeCharacter(a)?.totalPlayedSeconds).toBeCloseTo(30, 5);
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(sim.serializeCharacter(a)?.totalPlayedSeconds).toBeCloseTo(60, 5);
  });
});
