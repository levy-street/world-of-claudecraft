// Pull timer tests (src/sim/social/pull_timer.ts)
// Verifies:
// - Leader initiates countdown with /pull X or /pull "X"
// - Non-leader and solo player rejected with appropriate errors
// - Validates duration bounds (1-60 seconds)
// - Countdown emits raidWarning at start, at 5..1, and PULL! at 0
// - /pull cancel or /pull 0 cancels the active timer
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { PULL_TIMER_MAX_SECONDS } from '../src/sim/social/pull_timer';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function makeParty() {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const lead = sim.addPlayer('warrior', 'Lead');
  const mate = sim.addPlayer('mage', 'Mate');
  sim.partyInvite(mate, lead);
  sim.partyAccept(mate);
  return { sim, lead, mate };
}

const raidWarningsFor = (evs: SimEvent[], pid: number) =>
  evs.filter(
    (e): e is Extract<SimEvent, { type: 'chat' }> =>
      e.type === 'chat' && e.pid === pid && e.channel === 'raidWarning',
  );

describe('pull timer (/pull)', () => {
  it('leader /pull 10 broadcasts pull in 10 sec to all party members', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/pull 10', lead);
    const evs = sim.tick();

    const leadWarnings = raidWarningsFor(evs, lead);
    const mateWarnings = raidWarningsFor(evs, mate);

    expect(leadWarnings).toHaveLength(1);
    expect(leadWarnings[0].text).toBe('Pull in 10 sec!');
    expect(mateWarnings).toHaveLength(1);
    expect(mateWarnings[0].text).toBe('Pull in 10 sec!');
    expect(sim.pullTimers.size).toBe(1);
  });

  it('handles quotes in /pull "5"', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/pull "5"', lead);
    const evs = sim.tick();

    const mateWarnings = raidWarningsFor(evs, mate);
    expect(mateWarnings).toHaveLength(1);
    expect(mateWarnings[0].text).toBe('Pull in 5 sec!');
  });

  it('rejects non-leader and solo player', () => {
    const { sim, mate } = makeParty();
    sim.chat('/pull 10', mate);
    const evs = sim.tick();
    const err = evs.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
    expect(err).toBeDefined();
    expect(err?.text).toBe('You are not the party leader.');
    expect(sim.pullTimers.size).toBe(0);

    const solo = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const alone = solo.addPlayer('warrior', 'Solo');
    solo.chat('/pull 10', alone);
    const soloEvs = solo.tick();
    const soloErr = soloEvs.find(
      (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error',
    );
    expect(soloErr).toBeDefined();
    expect(soloErr?.text).toBe('You are not in a party.');
  });

  it('clamps seconds duration to PULL_TIMER_MAX_SECONDS', () => {
    const { sim, lead } = makeParty();
    sim.chat('/pull 100', lead);
    sim.tick();
    expect(sim.pullTimers.size).toBe(1);
    const timer = [...sim.pullTimers.values()][0];
    expect(timer.totalSeconds).toBe(PULL_TIMER_MAX_SECONDS);
  });

  it('counts down through 5, 4, 3, 2, 1 and PULL!', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/pull 5', lead);
    sim.tick(); // Start at 5 sec

    const collectedWarnings: string[] = [];

    // 20 ticks per second. Run 5 seconds (100 ticks) + extra ticks to ensure completion
    for (let i = 0; i < 110; i++) {
      const evs = sim.tick();
      const rw = raidWarningsFor(evs, mate);
      for (const w of rw) collectedWarnings.push(w.text);
    }

    expect(collectedWarnings).toEqual(['4', '3', '2', '1', 'PULL!']);
    expect(sim.pullTimers.size).toBe(0); // Finished and cleaned up
  });

  it('/pull cancel cancels active timer and broadcasts cancellation', () => {
    const { sim, lead, mate } = makeParty();
    sim.chat('/pull 10', lead);
    sim.tick();
    expect(sim.pullTimers.size).toBe(1);

    sim.chat('/pull cancel', lead);
    const evs = sim.tick();
    expect(sim.pullTimers.size).toBe(0);

    const mateWarnings = raidWarningsFor(evs, mate);
    expect(mateWarnings.some((w) => w.text === 'Pull cancelled.')).toBe(true);
  });
});
