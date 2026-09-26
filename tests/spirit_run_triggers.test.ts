// src/sim/spirit_run_triggers.ts: the trigger set a released spirit walks
// through on its corpse run. Pins the load-bearing claim in the module
// header: door, rift, then the overworld passage, the same order as the
// living arm of the player tick, so a ghost on overlapping triggers resolves
// the way a live player would. The end-to-end crossing (a ghost that rose in
// the Hollow comes back through the Duskfall passage) is in portals.test.ts.

import { describe, expect, it, vi } from 'vitest';

const calls: { name: string; ctx: unknown; p: unknown }[] = [];
vi.mock('../src/sim/instances/dungeons', () => ({
  updateDoorTriggers: (ctx: unknown, p: unknown) => calls.push({ name: 'door', ctx, p }),
}));
vi.mock('../src/sim/rift/runs', () => ({
  updateRiftTriggers: (ctx: unknown, p: unknown) => calls.push({ name: 'rift', ctx, p }),
}));
vi.mock('../src/sim/portals', () => ({
  updatePortalTriggers: (ctx: unknown, p: unknown) => calls.push({ name: 'portal', ctx, p }),
}));

const { updateSpiritRunTriggers } = await import('../src/sim/spirit_run_triggers');

describe('updateSpiritRunTriggers', () => {
  it('runs door, rift, then passage triggers, in the living arm order', () => {
    calls.length = 0;
    const ctx = {} as never;
    const ghost = { kind: 'player', dead: true, ghost: true } as never;
    updateSpiritRunTriggers(ctx, ghost);
    expect(calls.map((c) => c.name)).toEqual(['door', 'rift', 'portal']);
    // Every trigger receives the same context and the same entity, in that order.
    for (const c of calls) {
      expect(c.ctx).toBe(ctx);
      expect(c.p).toBe(ghost);
    }
  });
});
