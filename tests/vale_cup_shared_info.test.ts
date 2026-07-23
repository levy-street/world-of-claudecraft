// Byte-identical extraction proof for the Vale Cup CupInfo readout split
// (slice 1 of the shared-readout offload): cupSharedInfoFor(ctx) builds the
// realm-wide fragment (queue sizes, the live strip, the winners and guild
// boards, who is practicing) once per broadcast pass, and cupInfoFor accepts
// that fragment as an optional argument. Passing the shared fragment must
// produce a readout deep-equal to computing it inline, for every viewer class,
// and the per-viewer practice suppression of `live` must stay on top of the
// RAW shared fragment (never baked into it). If any class fails to deep-equal,
// or the practice viewer's `live` is non-null on either side, something read as
// "shared" is actually per-viewer: a bug in the extraction, not the test.

import { describe, expect, it, vi } from 'vitest';
import { cupInfoFor, cupSharedInfoFor } from '../src/sim/social/vale_cup';
import { PITCH_CENTER } from '../src/sim/vale_cup_layout';
import { addAt, makeWorld, startBout } from './vale_cup_util';

// startBout runs a real bot bout up to kickoff (dozens of deterministic ticks);
// give the file the headroom the sibling Vale Cup suites use.
vi.setConfig({ testTimeout: 30000 });

// Build ONE sim state that simultaneously carries every viewer class:
//  - a, b: the two fighters seated in the live rated Sowfield match
//  - spec: a walk-up standing in the Sowfield stands (off the pitch) while it runs
//  - idle: a far-away player, not queued and not at the Sowfield
//  - prac: a player off in a private practice instance while the real match is live
// No tick fires after setup, so the state is frozen at match-active for the reads.
function stage() {
  const sim = makeWorld();
  const a = addAt(sim, 'warrior', 'Aleph', 0, -40);
  const b = addAt(sim, 'mage', 'Bet', 4, -40);
  startBout(sim, a, b); // occupies vc.match, runs it to 'active'
  expect(sim.vcup.match?.phase).toBe('active');
  // Spectator in the south stand: inside the Sowfield region, off the physical
  // pitch (so the closed-pitch policing never ejects them), no match of their own.
  const spec = addAt(sim, 'priest', 'Spectator', PITCH_CENTER.x, PITCH_CENTER.z - 22);
  // Idle player far from the Sowfield, unqueued: no match, no spectate.
  const idle = addAt(sim, 'paladin', 'Idler', 0, -300);
  // Practicer owning a private practice instance in parallel with the real match.
  const prac = addAt(sim, 'rogue', 'Practicer', 8, -40);
  sim.vcupPracticeStart(2, prac);
  expect(sim.vcup.practices.length).toBe(1);
  return { sim, ctx: sim.ctx, a, b, spec, idle, prac };
}

describe('Vale Cup: cupSharedInfoFor extraction is byte-identical', () => {
  it('class (a) a match participant: passing the shared fragment is identical', () => {
    const { ctx, a } = stage();
    expect(cupInfoFor(ctx, a)).toEqual(cupInfoFor(ctx, a, cupSharedInfoFor(ctx)));
    // Positively pin the participant is on the MATCH branch (not some other path that
    // also happens to leave live populated), and that they DO see the Sowfield live
    // strip (they are not in a practice).
    expect(cupInfoFor(ctx, a)!.match).not.toBeNull();
    expect(cupInfoFor(ctx, a)!.live).not.toBeNull();
  });

  it('class (b) a Sowfield spectator: passing the shared fragment is identical', () => {
    const { ctx, spec } = stage();
    // The spectator gets the walk-up view (spectate populated) and still deep-equals.
    expect(cupInfoFor(ctx, spec)!.spectate).not.toBeNull();
    expect(cupInfoFor(ctx, spec)).toEqual(cupInfoFor(ctx, spec, cupSharedInfoFor(ctx)));
  });

  it('class (c) a far-away idle player: passing the shared fragment is identical', () => {
    const { ctx, idle } = stage();
    const info = cupInfoFor(ctx, idle)!;
    expect(info.match).toBeNull();
    expect(info.spectate).toBeNull();
    // A far idle viewer is not practicing, so the persistent Sowfield indicator (the
    // live strip) still shows to them; pin it non-null so this guarantee is decisive
    // on its own rather than only transitively via the participant class.
    expect(info.live).not.toBeNull();
    expect(cupInfoFor(ctx, idle)).toEqual(cupInfoFor(ctx, idle, cupSharedInfoFor(ctx)));
  });

  it('class (d) a practice-instance player: identical, and live suppressed on both sides', () => {
    const { ctx, prac } = stage();
    const without = cupInfoFor(ctx, prac)!;
    const withShared = cupInfoFor(ctx, prac, cupSharedInfoFor(ctx))!;
    // The practicer is in their own bout: their readout deep-equals with and
    // without the shared fragment...
    expect(without).toEqual(withShared);
    // ...and the per-viewer suppression zeroes their live strip both ways...
    expect(without.live).toBeNull();
    expect(withShared.live).toBeNull();
    // ...while the RAW shared fragment's live stays non-null (the real Sowfield
    // match is running), proving the suppression rides ON TOP of the shared
    // fragment and is never baked into it.
    expect(cupSharedInfoFor(ctx).live).not.toBeNull();
  });

  it('the shared fragment is genuinely realm-wide (identical across viewers)', () => {
    const { ctx, a, idle } = stage();
    // Two independent builds of the fragment are deep-equal (deterministic, no rng).
    expect(cupSharedInfoFor(ctx)).toEqual(cupSharedInfoFor(ctx));
    // The realm-wide fields are the same shape for two different viewers' full
    // readouts: the boards and the queue sizes do not vary by pid.
    const infoA = cupInfoFor(ctx, a)!;
    const infoIdle = cupInfoFor(ctx, idle)!;
    expect(infoA.board).toEqual(infoIdle.board);
    expect(infoA.guildBoard).toEqual(infoIdle.guildBoard);
    expect(infoA.queueSizes).toEqual(infoIdle.queueSizes);
    expect(infoA.practicing).toEqual(infoIdle.practicing);
  });

  it('pins concrete realm-wide values (guards a symmetric field drop in cupSharedInfoFor)', () => {
    const { sim, ctx, spec } = stage();
    // Give the spectator (last alphabetically) a cup win so the winners board's
    // wins-desc sort is exercised: it must jump to the front. The four deep-equal
    // classes above route BOTH sides through cupSharedInfoFor, so a field dropped
    // or miscomputed inside it would be wrong on both sides and stay green there;
    // these literal pins catch such a symmetric drop.
    ctx.players.get(spec)!.vcupWins = 3;
    const shared = cupSharedInfoFor(ctx);
    expect(shared.queueSizes).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(shared.practicing).toEqual(['Practicer']);
    expect(shared.board).toEqual([
      { name: 'Spectator', wins: 3 },
      { name: 'Aleph', wins: 0 },
      { name: 'Bet', wins: 0 },
      { name: 'Idler', wins: 0 },
      { name: 'Practicer', wins: 0 },
    ]);
    expect(shared.guildBoard).toEqual([]);
    // The RAW shared live strip equals liveMatchInfo of the running Sowfield match
    // (derived from the live match, not hardcoded); a dropped/null live reddens here.
    const m = sim.vcup.match!;
    expect(shared.live).toEqual({
      id: m.id,
      bracket: m.bracket,
      clock: Math.floor(m.clock + m.goldenClock),
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      nationA: m.nationA,
      nationB: m.nationB,
    });
  });
});
