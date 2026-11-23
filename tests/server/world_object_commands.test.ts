// server/world_object_commands.ts: the `loot` and `pickup` boundary
// validators the dispatchMessage switch (server/game.ts) delegates to. Pins the
// type gate per field (a malformed payload never reaches the sim), the
// authenticated pid pass-through, and that the sim's own verdict is returned.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  lootCommandOutcome,
  pickupCommandOutcome,
  type WorldObjectCommandSim,
} from '../../server/world_object_commands';

type Call = [method: string, arg: number, pid: number | undefined];

function fakeSim(verdict: boolean): { sim: WorldObjectCommandSim; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    sim: {
      lootCorpse: (id, pid) => {
        calls.push(['lootCorpse', id, pid]);
        return verdict;
      },
      pickUpObject: (id, pid) => {
        calls.push(['pickUpObject', id, pid]);
        return verdict;
      },
    },
  };
}

describe('world object command outcomes', () => {
  it('forwards a numeric loot id with the session pid and returns the sim verdict', () => {
    const ok = fakeSim(true);
    expect(lootCommandOutcome(ok.sim, { id: 41 }, 7)).toBe(true);
    expect(ok.calls).toEqual([['lootCorpse', 41, 7]]);
    const refused = fakeSim(false);
    expect(lootCommandOutcome(refused.sim, { id: 41 }, 7)).toBe(false);
    expect(refused.calls).toEqual([['lootCorpse', 41, 7]]);
  });

  it('forwards a numeric pickup id with the session pid', () => {
    const { sim, calls } = fakeSim(true);
    expect(pickupCommandOutcome(sim, { id: 12 }, 3)).toBe(true);
    expect(calls).toEqual([['pickUpObject', 12, 3]]);
  });

  it('refuses a malformed field before the sim is reached', () => {
    const { sim, calls } = fakeSim(true);
    for (const id of ['41', null, undefined, {}, [1]]) {
      expect(lootCommandOutcome(sim, { id }, 1)).toBe(false);
      expect(pickupCommandOutcome(sim, { id }, 1)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('is what server/game.ts dispatches the two cases through', () => {
    const game = readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8');
    expect(game).toContain("import * as objectCmds from './world_object_commands';");
    for (const fn of ['lootCommandOutcome', 'pickupCommandOutcome']) {
      expect(game).toContain(
        `this.sendCommandOutcome(session, msg, objectCmds.${fn}(sim, msg, pid));`,
      );
    }
  });
});
