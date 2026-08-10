import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const ev = events.filter(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return ev.length ? ev[ev.length - 1].text : undefined;
}

describe('/arena command', () => {
  it('reports rating with a win/loss record and win rate', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.arenaRating = 1530;
    meta.arenaWins = 12;
    meta.arenaLosses = 8;
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1530 - 12 wins, 8 losses, 0 draws (60% win rate). 2v2 Rating 1500 - no matches played yet.',
    );
  });

  it('reports an unranked character with no matches played', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph'); // defaults: 1500 / 0 / 0
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1500 - no matches played yet. 2v2 Rating 1500 - no matches played yet.',
    );
  });

  it('counts a drawn bout as a match played, so /arena agrees with the ladder', () => {
    // This case used to read "no matches played yet" to a player the arena
    // window showed as 0-0-2 and the ladder already listed, because the
    // readout's denominator was wins + losses. The name of the old test said
    // "all games were draws" while setting no draws at all, so nothing
    // exercised it.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.arenaRating = 1490;
    meta.arenaWins = 0;
    meta.arenaLosses = 0;
    meta.arenaDraws = 2;
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1490 - 0 wins, 0 losses, 2 draws (0% win rate). 2v2 Rating 1500 - no matches played yet.',
    );
  });

  it('still says nothing was played when the record is genuinely empty', () => {
    // The divide-by-zero guard the old test meant to cover: no wins, no losses
    // and no draws is the one state that reports nothing played.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Beth');
    sim.players.get(a)!.arenaRating = 1490;
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1490 - no matches played yet. 2v2 Rating 1500 - no matches played yet.',
    );
  });

  it('rounds the win rate and works through the /pvp and /rating aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.arenaRating = 1602;
    meta.arenaWins = 1;
    meta.arenaLosses = 2; // 33.33% -> 33%
    sim.tick();

    sim.chat('/pvp', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1602 - 1 wins, 2 losses, 0 draws (33% win rate). 2v2 Rating 1500 - no matches played yet.',
    );

    sim.chat('/rating', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: 1v1 Rating 1602 - 1 wins, 2 losses, 0 draws (33% win rate). 2v2 Rating 1500 - no matches played yet.',
    );
  });

  it('does not emit a chat event (self-only, unlogged)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const result = sim.chat('/arena', a);
    expect(result).toBeNull();
    const chats = sim.tick().filter((e) => e.type === 'chat');
    expect(chats).toHaveLength(0);
  });
});
