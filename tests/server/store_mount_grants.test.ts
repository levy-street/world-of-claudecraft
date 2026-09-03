import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materializeStoreMountGrants } from '../../server/store_mount_grants';
import { ITEMS } from '../../src/sim/data';

interface GrantCall {
  itemId: string;
  count: number;
  pid: number;
}

class FakeStoreMountSim {
  readonly grants: GrantCall[] = [];
  readonly ownershipReads: number[] = [];

  constructor(private readonly ownedByPid = new Map<number, Set<string>>()) {}

  ownedMountsFor(pid: number): readonly string[] {
    this.ownershipReads.push(pid);
    return [...(this.ownedByPid.get(pid) ?? [])];
  }

  addItem(itemId: string, count: number, pid: number): void {
    this.grants.push({ itemId, count, pid });
    const def = ITEMS[itemId];
    if (def?.kind !== 'mount' || !def.mount) return;
    const owned = this.ownedByPid.get(pid) ?? new Set<string>();
    owned.add(def.mount);
    this.ownedByPid.set(pid, owned);
  }
}

describe('store mount grant materialization', () => {
  it('grants only missing mount items to every live character on the target account', () => {
    const sim = new FakeStoreMountSim(new Map([[101, new Set(['mech_bird'])]]));
    const sessions = [
      { accountId: 7, pid: 101 },
      { accountId: 7, pid: 102 },
      { accountId: 8, pid: 201 },
    ];

    materializeStoreMountGrants(sessions, sim, 7, [
      'reins_mech_bird',
      'missing_reins',
      'worn_sword',
    ]);

    expect(sim.ownershipReads).toEqual([101, 102]);
    expect(sim.grants).toEqual([{ itemId: 'reins_mech_bird', count: 1, pid: 102 }]);
  });

  it('deduplicates one delivery and stays idempotent across repeated reconciliation', () => {
    const sim = new FakeStoreMountSim();
    const sessions = [{ accountId: 7, pid: 101 }];

    materializeStoreMountGrants(sessions, sim, 7, ['reins_mech_bird', 'reins_mech_bird']);
    materializeStoreMountGrants(sessions, sim, 7, ['reins_mech_bird']);

    expect(sim.grants).toEqual([{ itemId: 'reins_mech_bird', count: 1, pid: 101 }]);
  });

  it('does nothing when the account has no live session', () => {
    const sim = new FakeStoreMountSim();

    materializeStoreMountGrants([], sim, 7, ['reins_mech_bird']);

    expect(sim.ownershipReads).toEqual([]);
    expect(sim.grants).toEqual([]);
  });

  it('wires the Claudium hook to the live sessions and Sim in server/main', () => {
    const source = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
    const start = source.indexOf('configureClaudiumRuntime({');
    const end = source.indexOf('\n});', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const wiring = source.slice(start, end);

    expect(wiring).toContain('grantStoreMounts: (accountId, itemIds) => {');
    expect(wiring).toContain('const game = liveGame();');
    expect(wiring).toContain(
      'materializeStoreMountGrants(game.clients.values(), game.sim, accountId, itemIds);',
    );
  });
});
