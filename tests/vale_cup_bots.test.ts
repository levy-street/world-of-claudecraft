// The Vale Cup bot behavior spec (docs/prd/vale-cup.md): the idle bot showcase
// and bot backfill + private practice staging. Split from the original
// single-file tests/vale_cup.test.ts along describe boundaries for CI shard
// balance (a pure move; the shared staging helpers live in
// tests/vale_cup_util.ts).
//
// Inventory note (v0.21): fresh characters spawn WITH starter rations, so no
// assertion here compares exact inventories.

import { describe, expect, it, vi } from 'vitest';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { VC_BACKFILL_WAIT, VC_MATCH_DURATION } from '../src/sim/social/vale_cup';
import type { SimEvent } from '../src/sim/types';
import { addAt, makeWorld, readyAll, tickUntil } from './vale_cup_util';

// The full-match bot sims here run thousands of deterministic ticks; the 5s
// vitest default is too tight for them under CI's parallel load (they complete
// in well under a second locally). Give the file the headroom the other heavy
// sim suites use (climb_slope, sim, dungeons).
vi.setConfig({ testTimeout: 30000 });

describe('Vale Cup: bot showcase', () => {
  it('auto-stages a 3v3 bot exhibition after 60s idle when showcase is enabled', () => {
    // A human is online (so someone can watch), nobody queues: after the idle
    // stretch the Sowfield stages a full bot-vs-bot match with distinct nations.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.teamA.length).toBe(3);
    expect(match.teamB.length).toBe(3);
    expect(match.nationA).not.toBe(match.nationB);
    // Every fighter is a bot (no human seated in an exhibition).
    expect(sim.vcup.botPids.length).toBe(6);
    for (const pid of [...match.teamA, ...match.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(true);
    }
    expect(match.rated).toBe(false);
  });

  it('does not stage a showcase when the flag is off (tests/goldens stay quiet)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    for (let i = 0; i < 20 * 65; i++) sim.tick();
    expect(sim.vcup.match).toBe(null);
  });

  it('preempts a live bot exhibition the moment two humans can form a rated match', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const showcase = sim.vcup.match!;
    expect(showcase).toBeTruthy();
    expect(showcase.rated).toBe(false);
    // Two humans queue a 1v1: the exhibition must yield the pitch to them.
    const a = addAt(sim, 'mage', 'RealOne', 0, -40);
    const b = addAt(sim, 'rogue', 'RealTwo', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    // A couple of ticks: preempt (frees the pitch), remove bots, seat the rated match.
    for (let i = 0; i < 4 && !(sim.vcup.match && sim.vcup.match.rated); i++) sim.tick();
    const real = sim.vcup.match!;
    expect(real).toBeTruthy();
    expect(real.id).not.toBe(showcase.id);
    expect(real.rated).toBe(true);
    expect(real.teamA).toContain(a);
    expect(real.teamB).toContain(b);
    // The showcase bots are gone (only the two real humans remain seated).
    for (const pid of [...real.teamA, ...real.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(false);
    }
  });

  it('does not preempt a bot-backfilled match (a human is playing in it)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    // A lone human queues and gets bot-backfilled after the wait: that match has
    // a human seated, so a second late queuer must NOT tear it down.
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, sim.primaryId);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 + 4 && !sim.vcup.match; i++) sim.tick();
    const backfilled = sim.vcup.match!;
    expect(backfilled).toBeTruthy();
    expect(backfilled.rated).toBe(false);
    expect(backfilled.teamA).toContain(sim.primaryId);
    const late = addAt(sim, 'mage', 'Latecomer', 0, -40);
    sim.vcupQueueJoin(1, 'ogre', 'allrounder', false, late);
    for (let i = 0; i < 6; i++) sim.tick();
    // The human's backfilled match is untouched; the latecomer waits in queue.
    expect(sim.vcup.match!.id).toBe(backfilled.id);
    expect(sim.cupInfoFor(late)!.queued).toBe(true);
  });

  it('bots use the pass mechanic to build up in a showcase match', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    // Record every ability a bot casts across the briefing + a chunk of play.
    const casts: string[] = [];
    const orig = sim.castAbility.bind(sim);
    (sim as unknown as { castAbility: typeof sim.castAbility }).castAbility = (id, pid, aim) => {
      casts.push(id);
      return orig(id, pid, aim);
    };
    // Stop as soon as a pass fires (fast in the common case; the full window is
    // the upper bound so the test never runs away under full-suite load).
    for (let i = 0; i < 20 * 240 && !casts.includes('sport_pass'); i++) sim.tick();
    // The AI plays crisp lead passes in build-up (not just hopeful shots).
    expect(casts).toContain('sport_pass');
  });
});

describe('Vale Cup: bot backfill and practice', () => {
  it('backfills both sides with bots after the human unit waits out the timer (unrated)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 - 2; i++) sim.tick();
    expect(sim.vcup.match).toBe(null); // still waiting at 59.9s
    sim.tick();
    sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.rated).toBe(false);
    expect(sim.vcup.botPids.length).toBe(3);
    expect(match.teamA[0]).toBe(a);
    // Bot names are lore-flavored and unique.
    const names = [...match.rosterA, ...match.rosterB].map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    // Unrated: ready up, force a quick decision, confirm no standing moved.
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    (match as any).scoreA = 1;
    (match as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
    expect(sim.vcup.match).toBe(null);
    expect(sim.vcup.botPids.length).toBe(0);
    const meta = sim.players.get(a)!;
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0);
  });

  it('practice seats you on a PRIVATE instanced pitch, not the physical slot', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(3);
    // The one physical Sowfield slot stays free; practice lives in its own list.
    expect(sim.vcup.match).toBe(null);
    const match = sim.vcup.practices[0];
    expect(match).toBeTruthy();
    expect(match.bracket).toBe(3);
    expect(match.rated).toBe(false);
    expect(match.practice?.ownerPid).toBe(sim.primaryId);
    expect(sim.vcup.botPids.length).toBe(5);
    expect(match.teamA[0]).toBe(sim.primaryId);
    expect(match.roles[match.teamB[0]]).toBe('keeper');
    // Seated far from the Sowfield (its own instance band), not on the real pitch.
    const me = sim.entities.get(sim.primaryId)!;
    expect(me.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });

  it('a full practice bout plays itself out and cleans up, returning me home', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter', playerName: 'Solo' });
    const home = { ...sim.entities.get(sim.primaryId)!.pos };
    sim.vcupPracticeStart(1);
    expect(sim.vcup.practices.length).toBe(1);
    let end: SimEvent | undefined;
    for (let i = 0; i < 20 * (VC_MATCH_DURATION + 60) && sim.vcup.practices.length > 0; i++) {
      for (const ev of sim.tick()) if (ev.type === 'vcupEnd') end = ev;
    }
    expect(sim.vcup.practices.length).toBe(0);
    expect(end).toBeTruthy();
    expect(sim.vcup.botPids.length).toBe(0);
    expect(sim.players.size).toBe(1); // bots removed
    const meta = sim.players.get(sim.primaryId)!;
    expect(meta.sportRole).toBe(null);
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0); // unrated
    // Returned to where I started (not left out in the instance band).
    const me = sim.entities.get(sim.primaryId)!;
    expect(Math.hypot(me.pos.x - home.x, me.pos.z - home.z)).toBeLessThan(2);
  });
});
