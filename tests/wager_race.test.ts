import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { COURSES } from '../src/sim/content/courses';

// Phase 5 — the soft-currency PvP Wager Race. The governing invariant is
// CONSENT + CONSERVATION: a player is charged only after their own accept, and
// every coin/Charter in the pot drains exactly once (to the winner, or refunded).
// No real money / $WOC — pure meta.copper + charter items inside the sim.

const CHARTER = 'charter_goldcrest';
const ANTE = 500;

function makeWorld(n: number, opts: { charter?: boolean; copper?: number } = {}) {
  const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const pids: number[] = [];
  for (let i = 0; i < n; i++) {
    const pid = sim.addPlayer('warrior', `Racer${i}`);
    const e = sim.entities.get(pid)!;
    e.pos.x = 40 + i * 0.5; e.pos.z = 40; e.pos.y = terrainHeight(e.pos.x, e.pos.z, sim.cfg.seed); e.prevPos = { ...e.pos };
    e.mountTier = 11; e.mountId = 'sovereign'; // a flyer (set directly)
    sim.players.get(pid)!.copper = opts.copper ?? 100_000;
    if (opts.charter) sim.addItem(CHARTER, 1, pid);
    pids.push(pid);
  }
  for (const ent of sim.entities.values()) if (ent.kind === 'mob') { ent.hostile = false; ent.aiState = 'idle'; }
  return { sim, pids };
}

const copper = (sim: Sim, pid: number) => sim.players.get(pid)!.copper;
const charters = (sim: Sim, pid: number) => sim.countItem(CHARTER, pid);
// total wealth across the table — must be conserved by every wager outcome.
function wealth(sim: Sim, pids: number[]): { copper: number; charters: number } {
  let c = 0, ch = 0;
  for (const pid of pids) { c += copper(sim, pid); ch += charters(sim, pid); }
  return { copper: c, charters: ch };
}

// Drive one racer through every gate of the course so they finish (in order).
function finishCourse(sim: Sim, pid: number, courseId = 'skytrial_vale'): void {
  const e = sim.entities.get(pid)!;
  for (const g of COURSES[courseId].checkpoints) { e.pos.x = g.x; e.pos.y = g.y; e.pos.z = g.z; sim.tick(); }
}

describe('soft-currency Wager Race', () => {
  it('charges the host on propose and a joiner only on accept (consent)', () => {
    const { sim, pids } = makeWorld(2, { charter: true });
    const [host, other] = pids;

    expect(sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host)).toBe(true);
    expect(copper(sim, host)).toBe(100_000 - ANTE); // host staked on propose
    expect(charters(sim, host)).toBe(0);
    expect(copper(sim, other)).toBe(100_000); // invitee NOT charged yet
    expect(charters(sim, other)).toBe(1);

    expect(sim.wagerJoin(other)).toBe(true); // their accept
    expect(copper(sim, other)).toBe(100_000 - ANTE); // now charged
    expect(charters(sim, other)).toBe(0);
    expect(sim.wagerInfoFor(host)!.potCopper).toBe(2 * ANTE);
    expect(sim.wagerInfoFor(host)!.potCharters).toBe(2);
  });

  it('declining never charges and leaves the wallet untouched', () => {
    const { sim, pids } = makeWorld(2, { charter: true });
    const [host, other] = pids;
    sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host);
    sim.wagerDecline(other);
    expect(copper(sim, other)).toBe(100_000);
    expect(charters(sim, other)).toBe(1);
    expect(sim.wagerInfoFor(other)).toBeNull(); // not in the lobby
  });

  it('winner takes the whole pot (gold + Charters); losers forfeit; wealth is conserved', () => {
    const { sim, pids } = makeWorld(2, { charter: true });
    const [host, other] = pids;
    const before = wealth(sim, pids);

    sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host);
    sim.wagerJoin(other);
    expect(sim.launchWagerRace(host)).toBe(true);
    for (let i = 0; i < 61; i++) sim.tick(); // countdown → GO

    finishCourse(sim, other); // `other` wins (finishes first)
    finishCourse(sim, host);  // host finishes second → race resolves

    // winner gets both antes + both Charters; loser is down a full stake
    expect(copper(sim, other)).toBe(100_000 - ANTE + 2 * ANTE);
    expect(charters(sim, other)).toBe(2);
    expect(copper(sim, host)).toBe(100_000 - ANTE);
    expect(charters(sim, host)).toBe(0);
    // pure transfer: total wealth unchanged
    expect(wealth(sim, pids)).toEqual(before);
  });

  it('no finisher (all DNF) refunds every staker — pot drained, nobody paid', () => {
    const { sim, pids } = makeWorld(2, { charter: true });
    const [host, other] = pids;
    const before = wealth(sim, pids);

    sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host);
    sim.wagerJoin(other);
    sim.launchWagerRace(host);
    for (let i = 0; i < 61; i++) sim.tick(); // GO
    // both lose flight → both DNF
    sim.dismissMount(host); sim.dismissMount(other);
    for (let i = 0; i < 5; i++) sim.tick(); // race detects DNF → done → refund

    expect(wealth(sim, pids)).toEqual(before); // fully refunded
    expect(copper(sim, host)).toBe(100_000);
    expect(copper(sim, other)).toBe(100_000);
    expect(sim.wagerInfoFor(host)).toBeNull();
  });

  it('host leaving before launch refunds everyone and closes the lobby', () => {
    const { sim, pids } = makeWorld(3, { charter: true });
    const [host, a, b] = pids;
    const before = wealth(sim, pids);
    sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host);
    sim.wagerJoin(a); sim.wagerJoin(b);
    expect(sim.wagerInfoFor(host)!.members.length).toBe(3);

    sim.wagerLeave(host); // host cancels
    expect(wealth(sim, pids)).toEqual(before);
    expect(sim.wagerInfoFor(host)).toBeNull();
    expect(sim.wagerInfoFor(a)).toBeNull();
  });

  it('an un-launched lobby auto-refunds at its TTL', () => {
    const { sim, pids } = makeWorld(2, { charter: true });
    const [host, other] = pids;
    const before = wealth(sim, pids);
    sim.proposeWagerRace('skytrial_vale', ANTE, CHARTER, host);
    sim.wagerJoin(other);
    // advance past WAGER_LOBBY_TTL (120s) without launching
    for (let i = 0; i < 20 * 121; i++) sim.tick();
    expect(wealth(sim, pids)).toEqual(before);
    expect(sim.wagerInfoFor(host)).toBeNull();
  });

  it('launch needs at least two stakers; a lone host is refunded', () => {
    const { sim, pids } = makeWorld(2);
    const [host] = pids;
    const before = copper(sim, host);
    sim.proposeWagerRace('skytrial_vale', ANTE, null, host); // nobody joins
    expect(sim.launchWagerRace(host)).toBe(false);
    expect(copper(sim, host)).toBe(before); // host refunded
    expect(sim.wagerInfoFor(host)).toBeNull();
  });

  it('the pot is paid exactly once across the result-panel linger (no double award)', () => {
    const { sim, pids } = makeWorld(2);
    const [host, other] = pids;
    sim.proposeWagerRace('skytrial_vale', ANTE, null, host);
    sim.wagerJoin(other);
    sim.launchWagerRace(host);
    for (let i = 0; i < 61; i++) sim.tick();
    finishCourse(sim, other);
    finishCourse(sim, host);
    const afterSettle = copper(sim, other);
    // linger through the full cleanup window — winner must not be paid again
    for (let i = 0; i < 20 * 9; i++) sim.tick();
    expect(copper(sim, other)).toBe(afterSettle);
  });

  it('rejects a wager the host cannot cover, and a non-flyer', () => {
    const { sim, pids } = makeWorld(1, { copper: 100 });
    const [host] = pids;
    expect(sim.proposeWagerRace('skytrial_vale', 500, null, host)).toBe(false); // can't afford
    sim.players.get(host)!.copper = 100_000;
    sim.entities.get(host)!.mountId = undefined; // dismount
    expect(sim.proposeWagerRace('skytrial_vale', 500, null, host)).toBe(false); // not a flyer
  });
});
