// A battleground respawn wave reuses the SAME demon entity instead of
// rebuilding a new one every wave.
//
// The defect this pins: waves run every BG_WAVE_PERIOD (10s), but an owned
// demon corpse unravels 3s after death (mob/locomotion.ts), so by the time the
// wave raised a dead warlock the corpse was gone and restorePetReturn took the
// REBUILD arm: a brand-new entity id, every wave, for every warlock in the
// match. Every nearby client then dropped its old character view and built a
// fresh one for what is visually the same demon, a steady main-thread hitch
// source on event evenings.
//
// The fix holds the corpse-decay window (pet/pet_corpse_hold.ts) while a dead
// fighter inside an ACTIVE battleground match is still owed exactly this pet
// back, so the wave finds the corpse and the revive-in-place arm applies: same
// entity id, same client view, no wire churn. The hold lifts the moment the
// owner is back up, deserts, or the match leaves 'active'; outside a
// battleground nothing changes.
//
// These tests drive the real Sim end to end through a real (1v1) match.

import { describe, expect, it } from 'vitest';
import { summonPet } from '../src/sim/pet/pet_commands';
import { holdPetCorpseForBgWave } from '../src/sim/pet/pet_corpse_hold';
import { Sim } from '../src/sim/sim';
import {
  BG_WAVE_PERIOD,
  type BgMatch,
  endBgMatch,
  startBgMatch,
} from '../src/sim/social/battleground';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const DEMON_TEMPLATE = 'emberkin';
// The authored decay window handleDeath gives an owned demon corpse (3s), plus
// margin so a boundary tick can never make the "already unravelled" reads racy.
const UNRAVEL_SECONDS = 3.5;

function must<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(label);
  return value;
}

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
}

function kill(sim: Sim, pid: number): void {
  const e = must(sim.entities.get(pid), 'victim entity');
  sim.ctx.dealDamage(null, e, 9_999_999, false, 'physical', null, 'hit');
}

/** A live 1v1 match (the smallest startBgMatch accepts) with a warlock whose
 *  demon is standing, plus both wave clocks pushed out so each arm controls
 *  exactly when the raise lands. */
function activeMatchWithDemon(): {
  sim: Sim;
  warlockPid: number;
  match: BgMatch;
  pet: Entity;
} {
  const sim = makeSim();
  const warlockPid = sim.addPlayer('warlock', 'Wl');
  const otherPid = sim.addPlayer('warrior', 'Wr');
  for (const pid of [warlockPid, otherPid]) {
    must(sim.entities.get(pid), 'fighter').level = 20;
  }
  startBgMatch(sim.ctx, [warlockPid], [otherPid], { rated: false });
  const match = must(sim.bgMatchFor(warlockPid), 'battleground match');
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
  expect(match.state).toBe('active');
  summonPet(sim.ctx, must(sim.entities.get(warlockPid), 'warlock'), DEMON_TEMPLATE);
  sim.tick();
  const pet = must(sim.petOf(warlockPid), 'summoned demon');
  // Both raise clocks far enough out that the corpse decay window (3s) fully
  // elapses first: the exact pre-fix defect timing (death more than 3s before
  // the wave), made deterministic instead of depending on where the free
  // running clocks happen to sit.
  match.waveIn[0] = BG_WAVE_PERIOD;
  match.waveIn[1] = BG_WAVE_PERIOD;
  return { sim, warlockPid, match, pet };
}

describe('battleground wave demon return reuses the entity', () => {
  it('holds the corpse past its decay window while the dead owner awaits the wave', () => {
    const { sim, warlockPid, pet } = activeMatchWithDemon();
    kill(sim, warlockPid);
    sim.releaseSpirit(warlockPid);
    tickSeconds(sim, UNRAVEL_SECONDS);
    // Without the hold the corpse unravelled at 3s and this entity is gone.
    const corpse = must(sim.entities.get(pet.id), 'held demon corpse');
    expect(corpse.dead).toBe(true);
    // The window is FROZEN, not merely gated: corpseTimer must stay positive,
    // because the wire's corpse-decayed flag (server/game.ts `cd`) keys on it
    // and a decayed read would make every client drop the corpse view, which
    // is the churn this hold exists to prevent.
    expect(corpse.corpseTimer).toBeGreaterThan(0);
  });

  it('the wave raise revives the SAME demon entity in place beside its owner', () => {
    const { sim, warlockPid, pet } = activeMatchWithDemon();
    kill(sim, warlockPid);
    sim.releaseSpirit(warlockPid);
    // The active battleground phase is pinned draw-free (its single draw is at
    // match start), and both restore arms of the pet round trip draw no rng,
    // so the whole hold-and-raise window must cost exactly ZERO draws: this is
    // the guard that the hold never gains a draw site and forks the stream.
    let draws = 0;
    sim.ctx.rng.setObserver(() => {
      draws++;
    });
    // Through the wave raise (clock was reset to a full period at the kill).
    for (let i = 0; i < 20 * (BG_WAVE_PERIOD + 2); i++) {
      sim.tick();
      if (!must(sim.entities.get(warlockPid), 'warlock').dead) break;
    }
    sim.ctx.rng.setObserver(null);
    expect(draws).toBe(0);
    const owner = must(sim.entities.get(warlockPid), 'warlock');
    expect(owner.dead).toBe(false);
    const returned = must(sim.petOf(warlockPid), 'wave-returned demon');
    expect(returned.dead).toBe(false);
    // The pin: the wave hands back THIS entity (revive-in-place), never a
    // rebuilt copy under a fresh id that forces every client to re-mint the
    // entity and rebuild its character view.
    expect(returned.id).toBe(pet.id);
  });

  it('lifts the hold on the end-of-match result screen, fighters still dead and mapped', () => {
    const { sim, warlockPid, match, pet } = activeMatchWithDemon();
    kill(sim, warlockPid);
    sim.releaseSpirit(warlockPid);
    // Push the raise out past this arm so the owner stays dead while held.
    match.waveIn[0] = 30;
    match.waveIn[1] = 30;
    tickSeconds(sim, UNRAVEL_SECONDS);
    expect(sim.entities.get(pet.id), 'corpse held while the match is active').toBeTruthy();
    // The played-out ending (enterBgEndHold): the result screen holds every
    // fighter in place, STILL DEAD and STILL MAPPED in bgMatches, for
    // BG_END_HOLD before release. The hold must key on the 'active' state
    // itself, not on the fighter leaving the index or being raised, so the
    // corpse resumes decay the moment the result freezes.
    match.state = 'ended';
    match.timer = 30; // keep the release itself outside this assertion window
    tickSeconds(sim, UNRAVEL_SECONDS);
    expect(must(sim.entities.get(warlockPid), 'warlock').dead).toBe(true);
    expect(sim.bgMatchFor(warlockPid), 'fighter still mapped on the result screen').toBeTruthy();
    expect(sim.entities.get(pet.id)).toBeUndefined();
  });

  it('lifts the hold on the immediate teardown path (forfeit endBgMatch)', () => {
    const { sim, warlockPid, match, pet } = activeMatchWithDemon();
    kill(sim, warlockPid);
    sim.releaseSpirit(warlockPid);
    match.waveIn[0] = 30;
    match.waveIn[1] = 30;
    tickSeconds(sim, UNRAVEL_SECONDS);
    expect(sim.entities.get(pet.id), 'corpse held while the match is active').toBeTruthy();
    endBgMatch(sim.ctx, match, 0, 'forfeit');
    tickSeconds(sim, UNRAVEL_SECONDS);
    // Out of 'active' the world takes the corpse exactly as before the hold.
    expect(sim.entities.get(pet.id)).toBeUndefined();
  });

  it('never holds a corpse the owner was not owed: a demon dead BEFORE the owner fell', () => {
    const { sim, warlockPid, match, pet } = activeMatchWithDemon();
    match.waveIn[0] = 30;
    match.waveIn[1] = 30;
    // The demon dies first, so the owner's death snapshots NO living pet:
    // nothing is owed back, and the corpse must unravel on schedule even
    // though its owner is a dead fighter in an active match.
    sim.ctx.dealDamage(null, pet, 9_999_999, false, 'physical', null, 'hit');
    sim.tick();
    kill(sim, warlockPid);
    sim.releaseSpirit(warlockPid);
    tickSeconds(sim, UNRAVEL_SECONDS);
    expect(sim.entities.get(pet.id)).toBeUndefined();
  });

  it('each predicate guard refuses on its own: a dropped guard fails loudly here', () => {
    const { sim, warlockPid, match, pet } = activeMatchWithDemon();
    // A LIVING pet is never held, whoever asks.
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    kill(sim, warlockPid);
    sim.tick();
    // The real held case, release not required: the wave raises only
    // RELEASED spirits and the release press is the player's own, so gating
    // the hold on ghost would serve only owners who release inside the 3s
    // corpse window. (In-match player resurrection does not exist: the offer,
    // the corpse run, and the Spirit Healer all refuse seated fighters.)
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(true);
    // The snapshot must name THIS corpse.
    const meta = must(sim.ctx.players.get(warlockPid), 'warlock meta');
    const snap = must(meta.deathPet, 'owner-death pet snapshot');
    const realPetId = snap.petId;
    snap.petId = -1;
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    snap.petId = realPetId;
    // An already-stamped unravel is never re-held.
    snap.unravelled = true;
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    snap.unravelled = false;
    // An owner that does not resolve to a live player entity never holds.
    const realOwnerId = pet.ownerId;
    pet.ownerId = -1;
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    // The unowned-corpse early return, distinct from the lookup miss above.
    pet.ownerId = null;
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    pet.ownerId = realOwnerId;
    // A living owner never holds. Unreachable through real revive paths today
    // (each stands the owner and consumes the snapshot in one synchronous
    // call, so no tick observes an alive owner with a live snapshot), pinned
    // as defense in depth for the exported predicate.
    const owner = must(sim.entities.get(warlockPid), 'warlock entity');
    owner.dead = false;
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    owner.dead = true;
    // The match must be in the 'active' state, membership alone is not enough.
    match.state = 'ended';
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(false);
    match.state = 'active';
    expect(holdPetCorpseForBgWave(sim.ctx, pet)).toBe(true);
  });

  it('never holds an open-world demon corpse: outside a match it unravels on schedule', () => {
    const sim = makeSim();
    const warlockPid = sim.addPlayer('warlock', 'Wl');
    must(sim.entities.get(warlockPid), 'warlock').level = 20;
    summonPet(sim.ctx, must(sim.entities.get(warlockPid), 'warlock'), DEMON_TEMPLATE);
    sim.tick();
    const pet = must(sim.petOf(warlockPid), 'summoned demon');
    kill(sim, warlockPid);
    tickSeconds(sim, UNRAVEL_SECONDS);
    // The dead owner alone must never hold a corpse; only an active match's
    // pending wave does. The unravel (and the owed rebuild it stamps) is the
    // open-world contract and stays byte-identical.
    expect(sim.entities.get(pet.id)).toBeUndefined();
  });
});
