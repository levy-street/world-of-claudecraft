// The forge pair's wire dispatch (server/rift_forge_dispatch.ts).
//
// Pins: each well-formed frame reaches its sim method with the exact argument
// order the Sim wrappers expect (item, [stat | gem], pid, slot), a slot reads
// as undefined for anything but an integer (never 0), and every malformed
// shape (no item, no stat, no gem, a non-forge token) returns null so the
// caller sends no ack, the same silence every other malformed command gets.

import { describe, expect, it } from 'vitest';
import { dispatchRiftCommand } from '../server/rift_forge_dispatch';
import type { RiftForgeResult } from '../src/sim/rift/progression';

function recorder() {
  const calls: unknown[][] = [];
  const ok = (action: RiftForgeResult['action']): RiftForgeResult => ({
    ok: true,
    action,
    itemId: 'band',
  });
  return {
    calls,
    sim: {
      upgradeRiftItem: (...args: unknown[]) => {
        calls.push(['upgrade', ...args]);
        return ok('upgrade');
      },
      socketRiftGem: (...args: unknown[]) => {
        calls.push(['socket', ...args]);
        return ok('socket');
      },
    },
  };
}

describe('dispatchRiftCommand', () => {
  it('routes both tokens with the Sim wrapper argument order', () => {
    const { calls, sim } = recorder();
    expect(
      dispatchRiftCommand(sim as never, { cmd: 'rift_upgrade_item', item: 'band', slot: 3 }, 7)?.ok,
    ).toBe(true);
    expect(
      dispatchRiftCommand(
        sim as never,
        { cmd: 'rift_socket_gem', item: 'band', gem: 'rift_gem_azure', slot: '2' },
        7,
      )?.action,
    ).toBe('socket');
    expect(calls).toEqual([
      ['upgrade', 'band', 7, 3],
      // A string slot is not an integer: undefined, never 0 or 2.
      ['socket', 'band', 'rift_gem_azure', 7, undefined],
    ]);
  });

  it('answers null (no ack) for every malformed shape without touching the sim', () => {
    const { calls, sim } = recorder();
    expect(dispatchRiftCommand(sim as never, { cmd: 'rift_upgrade_item' }, 7)).toBeNull();
    expect(dispatchRiftCommand(sim as never, { cmd: 'rift_upgrade_item', item: 4 }, 7)).toBeNull();
    // The retired forge enchant is a no-op tombstone in game.ts, never a
    // forge frame: the dispatcher does not know the token.
    expect(
      dispatchRiftCommand(
        sim as never,
        { cmd: 'rift_enchant_item', item: 'band', stat: 'critRating' },
        7,
      ),
    ).toBeNull();
    expect(
      dispatchRiftCommand(sim as never, { cmd: 'rift_socket_gem', item: 'band', gem: 1 }, 7),
    ).toBeNull();
    expect(dispatchRiftCommand(sim as never, { cmd: 'salvage_item', item: 'band' }, 7)).toBeNull();
    expect(calls).toEqual([]);
  });
});
