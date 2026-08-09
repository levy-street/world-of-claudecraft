import { describe, expect, it } from 'vitest';
import { isBgPos } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { BG_MIN_LEVEL, bgRespond } from '../src/sim/social/battleground';
import {
  BG_PROPOSAL_LOCKOUT_SECONDS,
  BG_PROPOSAL_SECONDS,
  bgProposalFor,
  bgProposalPids,
  bgProposalSilentPids,
} from '../src/sim/social/battleground_proposal';
import { DT, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function tp(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

/** Ten solo queuers advanced one tick, so the pop has landed as an OFFER. */
function tenOffered(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `P${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    sim.entities.get(pid)!.level = BG_MIN_LEVEL;
    pids.push(pid);
    sim.bgQueueJoin(pid);
  }
  sim.tick();
  return { sim, pids };
}

function logsFor(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log' && e.pid === pid)
    .map((e) => e.text);
}

describe('Thornhollow Fields: the queue pop is an offer, not a seat', () => {
  it('holds the ten as a proposal instead of seating them', () => {
    const { sim, pids } = tenOffered();
    expect(sim.bgMatchFor(pids[0]), 'nobody is seated until all ten accept').toBeNull();
    const proposal = bgProposalFor(sim.ctx, pids[0]);
    expect(proposal, 'the pop opened an offer').toBeTruthy();
    expect(bgProposalPids(proposal!).sort((a, b) => a - b)).toEqual(
      [...pids].sort((a, b) => a - b),
    );
    // Nobody has been moved to the field, and the queue is empty (the ten are
    // held by the offer, not waiting in line).
    for (const pid of pids) expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(false);
    expect(sim.bgInfoFor(pids[0])!.queued).toBe(false);

    // Each fighter sees their own countdown, and nobody has answered yet.
    const view = sim.bgInfoFor(pids[3])!.proposal!;
    expect(view.size).toBe(10);
    expect(view.accepted).toBe(0);
    expect(view.myResponse).toBe('pending');
    expect(view.remaining).toBe(BG_PROPOSAL_SECONDS);
  });

  it('seats the match the moment the tenth fighter accepts, and not before', () => {
    const { sim, pids } = tenOffered();
    for (const pid of pids.slice(0, 9)) bgRespond(sim.ctx, true, pid);
    expect(sim.bgMatchFor(pids[0]), 'nine is not ten').toBeNull();
    expect(sim.bgInfoFor(pids[0])!.proposal!.accepted).toBe(9);
    expect(sim.bgInfoFor(pids[0])!.proposal!.myResponse).toBe('accepted');

    bgRespond(sim.ctx, true, pids[9]);
    const match = sim.bgMatchFor(pids[0]);
    expect(match, 'the tenth accept seats it').toBeTruthy();
    expect(sim.bgInfoFor(pids[0])!.proposal, 'the offer is spent').toBeNull();
    for (const pid of pids) expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
    expect(sim.ctx.bgProposals).toHaveLength(0);
  });

  it('a repeat accept is idle, never a second tally', () => {
    const { sim, pids } = tenOffered();
    bgRespond(sim.ctx, true, pids[0]);
    bgRespond(sim.ctx, true, pids[0]);
    bgRespond(sim.ctx, true, pids[0]);
    expect(sim.bgInfoFor(pids[0])!.proposal!.accepted).toBe(1);
  });
});

describe('Thornhollow Fields: a failed offer, and who pays for it', () => {
  it('a decline drops the decliner and returns everyone else to the queue', () => {
    const { sim, pids } = tenOffered();
    const decliner = pids[4];
    for (const pid of pids) if (pid !== decliner) bgRespond(sim.ctx, true, pid);

    bgRespond(sim.ctx, false, decliner);

    expect(sim.bgMatchFor(pids[0]), 'no match forms').toBeNull();
    expect(sim.ctx.bgProposals, 'the offer is gone').toHaveLength(0);
    expect(sim.bgInfoFor(decliner)!.queued, 'the decliner leaves the queue').toBe(false);
    for (const pid of pids) {
      if (pid === decliner) continue;
      expect(sim.bgInfoFor(pid)!.queued, 'everyone else keeps their place').toBe(true);
    }
    // ...and the slot the offer was holding is free again for the next pop.
    expect(sim.ctx.bgBusySlots.size).toBe(0);
  });

  it('SILENCE is a decline: a lapsed offer blames every fighter who never answered', () => {
    const { sim, pids } = tenOffered();
    const answered = pids.slice(0, 8);
    const silent = pids.slice(8);
    for (const pid of answered) bgRespond(sim.ctx, true, pid);
    expect(bgProposalSilentPids(bgProposalFor(sim.ctx, pids[0])!).sort((a, b) => a - b)).toEqual(
      [...silent].sort((a, b) => a - b),
    );

    // Run the window out. This is the whole point of the feature: an away
    // client is removed rather than cycled back into the next pop.
    for (let i = 0; i < 20 * (BG_PROPOSAL_SECONDS + 1); i++) sim.tick();

    for (const pid of silent) {
      expect(sim.bgInfoFor(pid)!.queued, 'silence costs the spot').toBe(false);
      expect(sim.bgInfoFor(pid)!.requeueIn, 'and books the lockout').toBeGreaterThan(0);
    }
    for (const pid of answered) {
      expect(sim.bgInfoFor(pid)!.requeueIn, 'answering costs nothing').toBe(0);
    }
  });

  it('returns the innocent with their ORIGINAL wait, never reset to zero', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 10; i++) {
      const pid = sim.addPlayer('warrior', `W${i}`);
      tp(sim, pid, i * 2 - 9, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
    }
    // Nine queue and wait a while; the tenth arrives late and triggers the pop,
    // so the two groups carry visibly different waits.
    for (const pid of pids.slice(0, 9)) sim.bgQueueJoin(pid);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    sim.bgQueueJoin(pids[9]);
    sim.tick();
    expect(bgProposalFor(sim.ctx, pids[0]), 'the arrangement itself must hold').toBeTruthy();

    bgRespond(sim.ctx, false, pids[9]); // the latecomer declines

    const waits = sim.ctx.bgQueue.map((g) => g.waited);
    expect(waits, 'nine groups came back').toHaveLength(9);
    // Every returned group kept the ~5s it had already served. A reset would
    // read as 0 here, which is exactly the unfairness this guards.
    for (const waited of waits) expect(waited).toBeGreaterThan(4);
  });

  it('drops a whole queued PARTY when one of its members declines', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const party = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, i * 2 - 3, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      party.push(m);
    }
    const solos: number[] = [];
    for (let i = 0; i < 7; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, i * 2 - 6, -44);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      solos.push(s);
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader);
    for (let i = 0; i < 20 * 40 && !bgProposalFor(sim.ctx, leader); i++) sim.tick();
    expect(bgProposalFor(sim.ctx, leader), 'the arrangement itself must hold').toBeTruthy();

    bgRespond(sim.ctx, false, party[2]); // one mate declines
    const evs = sim.tick();

    // The matchmaker cannot seat a queued party without one of its own, so the
    // whole unit leaves; the two innocent members are told it was not their doing.
    for (const pid of party) expect(sim.bgInfoFor(pid)!.queued).toBe(false);
    expect(sim.bgInfoFor(party[0])!.requeueIn, 'an innocent member owes no lockout').toBe(0);
    expect(sim.bgInfoFor(party[2])!.requeueIn, 'the decliner does').toBeGreaterThan(0);
    for (const s of solos) expect(sim.bgInfoFor(s)!.queued, 'the solos wait on').toBe(true);
    expect(logsFor(evs, party[0]).join(' ')).toContain('Your group leaves');
  });

  it('refuses a requeue until the lockout lapses, then allows it', () => {
    const { sim, pids } = tenOffered();
    const decliner = pids[2];
    bgRespond(sim.ctx, false, decliner);
    expect(sim.bgInfoFor(decliner)!.requeueIn).toBe(BG_PROPOSAL_LOCKOUT_SECONDS);

    sim.bgQueueJoin(decliner);
    expect(sim.bgInfoFor(decliner)!.queued, 'refused while locked out').toBe(false);

    for (let i = 0; i < 20 * (BG_PROPOSAL_LOCKOUT_SECONDS + 1); i++) sim.tick();
    expect(sim.bgInfoFor(decliner)!.requeueIn).toBe(0);
    sim.bgQueueJoin(decliner);
    expect(sim.bgInfoFor(decliner)!.queued, 'and allowed once it lapses').toBe(true);
  });

  it('fails the offer when a fighter disconnects, sparing the nine who remain', () => {
    const { sim, pids } = tenOffered();
    const gone = pids[7];
    for (const pid of pids) if (pid !== gone) bgRespond(sim.ctx, true, pid);

    sim.removePlayer(gone);

    expect(sim.bgMatchFor(pids[0]), 'nine cannot hold a field open for a ghost').toBeNull();
    expect(sim.ctx.bgProposals).toHaveLength(0);
    expect(sim.ctx.bgBusySlots.size).toBe(0);
    for (const pid of pids) {
      if (pid === gone) continue;
      expect(sim.bgInfoFor(pid)!.queued).toBe(true);
    }
  });
});

describe('Thornhollow Fields: a live offer makes a fighter unavailable', () => {
  it('refuses a party queue when any MEMBER is holding a pending offer', () => {
    // Review catch: the member loop checked seats, arena matches and queue
    // groups but not a live offer. A solo could take a pop, accept a party
    // invite before answering, and be queued again by the leader, so the same
    // character sat in a pending offer AND a fresh group; declining the first
    // then left the new group standing and skipped the lockout entirely.
    const { sim, pids } = tenOffered();
    const held = pids[5];
    expect(bgProposalFor(sim.ctx, held), 'the member really is holding an offer').toBeTruthy();

    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -44);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    sim.partyInvite(held, leader);
    sim.partyAccept(held);

    sim.bgQueueJoin(leader);

    expect(sim.bgInfoFor(leader)!.queued, 'the leader press is refused').toBe(false);
    expect(bgProposalFor(sim.ctx, held), 'and the offer is untouched').toBeTruthy();
  });

  it('refuses a party queue when a MEMBER is still under the requeue lockout', () => {
    // The same bypass one step later: the lockout is charged to the player, so
    // a leader's press must not carry them back into the queue the offer they
    // ignored just cost them.
    const { sim, pids } = tenOffered();
    const decliner = pids[3];
    bgRespond(sim.ctx, false, decliner);
    expect(sim.bgInfoFor(decliner)!.requeueIn, 'the lockout is live').toBeGreaterThan(0);

    const leader = sim.addPlayer('mage', 'Leader2');
    tp(sim, leader, 2, -44);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    sim.partyInvite(decliner, leader);
    sim.partyAccept(decliner);

    sim.bgQueueJoin(leader);

    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(decliner)!.queued).toBe(false);
  });
});

describe('Thornhollow Fields: the offer holds its slot', () => {
  it('reserves the field while pending and seats onto that same slot', () => {
    const { sim, pids } = tenOffered();
    const proposal = bgProposalFor(sim.ctx, pids[0])!;
    expect(sim.ctx.bgBusySlots.has(proposal.slot), 'held while pending').toBe(true);

    for (const pid of pids) bgRespond(sim.ctx, true, pid);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.slot, 'seated on the slot it was holding').toBe(proposal.slot);
    expect(sim.ctx.bgBusySlots.has(proposal.slot)).toBe(true);
  });

  it('refuses a queue press from someone with an offer already waiting', () => {
    const { sim, pids } = tenOffered();
    const evs: SimEvent[] = [];
    sim.bgQueueJoin(pids[1]);
    evs.push(...sim.tick());
    expect(sim.bgInfoFor(pids[1])!.queued).toBe(false);
    expect(bgProposalFor(sim.ctx, pids[1]), 'the offer survives the stray press').toBeTruthy();
  });

  it('counts down on the clock the players actually watch', () => {
    const { sim, pids } = tenOffered();
    expect(sim.bgInfoFor(pids[0])!.proposal!.remaining).toBe(BG_PROPOSAL_SECONDS);
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    const remaining = sim.bgInfoFor(pids[0])!.proposal!.remaining;
    expect(remaining).toBeLessThanOrEqual(BG_PROPOSAL_SECONDS - 10);
    expect(remaining).toBeGreaterThan(0);
    // DT is the tick, so the clock is sim time and never wall time.
    expect(BG_PROPOSAL_SECONDS / DT).toBe(600);
  });
});
