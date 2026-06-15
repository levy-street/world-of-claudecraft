import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// The self-only readout reuses the 'error' channel, like /who and the other
// readout commands; grab the most recent one addressed to the player.
function lastReadout(sim: Sim, pid: number): string | undefined {
  const errs = sim.events.filter(
    (e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return errs.length ? errs[errs.length - 1].text : undefined;
}

describe('/bags command', () => {
  it('reports empty bags with the purse', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 0;

    expect(sim.chat('/bags', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
  });

  it('lists items sorted by quality with stack counts and the purse', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 12 * 10000 + 4 * 100 + 5; // 12g 4s 5c

    // Added out of quality order to prove the readout sorts them.
    sim.addItem('wolf_fang', 5, pid); // poor
    sim.addItem('fen_reaver_glaive', 1, pid); // rare
    sim.addItem('minor_healing_potion', 3, pid); // common
    sim.addItem('redbrook_blade', 1, pid); // uncommon

    sim.chat('/bags', pid);
    expect(lastReadout(sim, pid)).toBe(
      'Bags (4): Fen Reaver Glaive, Redbrook Militia Blade, ' +
        'Minor Healing Potion x3, Cracked Wolf Fang x5. Purse: 12g 4s 5c.',
    );
  });

  it('works through the /inv and /inventory aliases', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 0;

    expect(sim.chat('/inv', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
    expect(sim.chat('/inventory', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
  });
});
