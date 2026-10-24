import { describe, expect, it, vi } from 'vitest';
import { createRealmReadoutMemo, realmReadoutObject } from '../server/realm_readout_memo';
import { visibleWhoRows, type WhoRosterEntry } from '../server/who_roster';
import { buildLiveWhoRosterEntries, readLiveWhoRows } from '../server/who_roster_host';
import { Sim } from '../src/sim/sim';

function session(pid: number, name: string) {
  return {
    pid,
    name,
    characterId: pid + 100,
    blockListLoaded: true,
    blockedIds: new Set<number>(),
  };
}

describe('live /who roster projection', () => {
  it('keeps hidden/incomplete sessions out, name order and live block handles inside the tick memo', () => {
    const sim = new Sim({ seed: 9, playerClass: 'mage', noPlayer: true });
    const beta = session(sim.addPlayer('mage', 'Beta'), 'Beta');
    const alpha = session(sim.addPlayer('warrior', 'Alpha'), 'Alpha');
    const hidden = session(sim.addPlayer('rogue', 'Hidden'), 'Hidden');
    const hiddenEntity = sim.entities.get(hidden.pid);
    if (!hiddenEntity) throw new Error('missing hidden player');
    hiddenEntity.gmHidden = true;
    const unfinished = session(-1, 'NotJoined');
    const sessions = [beta, hidden, unfinished, alpha];
    const presence = vi.fn(() => ({ zone: 'Synthetic zone', status: 'online' as const }));
    const memo = createRealmReadoutMemo<WhoRosterEntry<typeof alpha>[]>();
    const build = vi.fn(() => buildLiveWhoRosterEntries(sim, sessions, presence));
    const read = () => realmReadoutObject(memo, sim.tickCount, build);
    const rows = read();
    expect(read()).toBe(rows);
    expect(build).toHaveBeenCalledTimes(1);
    expect(presence).toHaveBeenCalledTimes(2);
    expect(rows.map((entry) => entry.row)).toEqual([
      {
        name: 'Alpha',
        cls: 'warrior',
        level: 1,
        guild: '',
        zone: 'Synthetic zone',
        status: 'online',
      },
      { name: 'Beta', cls: 'mage', level: 1, guild: '', zone: 'Synthetic zone', status: 'online' },
    ]);
    expect(rows[0].session).toBe(alpha);
    expect(visibleWhoRows(rows, beta).map((row) => row.name)).toEqual(['Alpha', 'Beta']);

    // Replacing a block set within a memoized tick must change viewer filtering.
    alpha.blockedIds = new Set([beta.characterId]);
    expect(visibleWhoRows(read(), beta).map((row) => row.name)).toEqual(['Beta']);
    expect(build).toHaveBeenCalledTimes(1);
    expect(readLiveWhoRows(sim, sessions, memo, beta, presence).map((row) => row.name)).toEqual([
      'Beta',
    ]);
    expect(memo.objectBuilds).toBe(1);
    alpha.blockedIds = new Set();
    beta.blockedIds = new Set([alpha.characterId]);
    expect(visibleWhoRows(read(), beta).map((row) => row.name)).toEqual(['Beta']);

    // The next tick rebuilds from current entity flags, not a captured roster.
    hiddenEntity.gmHidden = undefined;
    sim.tickCount++;
    expect(read().map((entry) => entry.row.name)).toEqual(['Alpha', 'Beta', 'Hidden']);
    expect(build).toHaveBeenCalledTimes(2);
    expect(readLiveWhoRows(sim, sessions, memo, beta, presence).map((row) => row.name)).toEqual([
      'Beta',
      'Hidden',
    ]);
    expect(memo.objectBuilds).toBe(2);
  });
});
