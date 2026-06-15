import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

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
      'Arena: Rating 1530 — 12 wins, 8 losses (60% win rate).',
    );
  });

  it('reports an unranked character with no matches played', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph'); // defaults: 1500 / 0 / 0
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe('Arena: Rating 1500 — no matches played yet.');
  });

  it('does not divide by zero when all games were draws (no wins or losses)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.arenaRating = 1490;
    meta.arenaWins = 0;
    meta.arenaLosses = 0;
    sim.tick();

    sim.chat('/arena', a);
    expect(errorText(sim.tick(), a)).toBe('Arena: Rating 1490 — no matches played yet.');
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
      'Arena: Rating 1602 — 1 wins, 2 losses (33% win rate).',
    );

    sim.chat('/rating', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Arena: Rating 1602 — 1 wins, 2 losses (33% win rate).',
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
