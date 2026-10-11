// server/dungeon_finder_commands.ts: the nine df_* frame guards, moved whole
// out of server/game.ts. Each frame either reaches its sim method with exactly
// the validated payload or is dropped whole (no partial laundering).

import { describe, expect, it, vi } from 'vitest';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import type { Sim } from '../src/sim/sim';

function fakeSim() {
  return {
    dungeonFinderSetRoles: vi.fn(),
    dungeonFinderQueueJoin: vi.fn(),
    dungeonFinderQueueLeave: vi.fn(),
    dungeonFinderRespond: vi.fn(),
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderListingClose: vi.fn(),
    dungeonFinderApply: vi.fn(),
    dungeonFinderApplyCancel: vi.fn(),
    dungeonFinderApplicationRespond: vi.fn(),
  };
}

const run = (sim: ReturnType<typeof fakeSim>, msg: Record<string, unknown>) =>
  dispatchDungeonFinderCommand(sim as unknown as Sim, msg, 7);

describe('dispatchDungeonFinderCommand', () => {
  it('passes valid frames through with the sender', () => {
    const sim = fakeSim();
    run(sim, { cmd: 'df_roles', roles: ['tank', 'healer'] });
    expect(sim.dungeonFinderSetRoles).toHaveBeenCalledWith(['tank', 'healer'], 7);
    run(sim, { cmd: 'df_queue', activities: ['drowned_temple'] });
    expect(sim.dungeonFinderQueueJoin).toHaveBeenCalledWith(['drowned_temple'], 7);
    run(sim, { cmd: 'df_queue_leave' });
    expect(sim.dungeonFinderQueueLeave).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_proposal', accept: true });
    expect(sim.dungeonFinderRespond).toHaveBeenCalledWith(true, 7);
    run(sim, { cmd: 'df_list_close' });
    expect(sim.dungeonFinderListingClose).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_apply', listing: 12 });
    expect(sim.dungeonFinderApply).toHaveBeenCalledWith(12, 7);
    run(sim, { cmd: 'df_apply_cancel' });
    expect(sim.dungeonFinderApplyCancel).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_app_respond', applicant: 3, accept: 'yes' });
    expect(sim.dungeonFinderApplicationRespond).toHaveBeenCalledWith(3, false, 7);
  });

  it('drops a frame whole when any field fails its guard', () => {
    const sim = fakeSim();
    run(sim, { cmd: 'df_roles', roles: ['tank', 'healer', 'damage', 'tank'] });
    run(sim, { cmd: 'df_roles', roles: ['tank', 'wizard'] });
    run(sim, { cmd: 'df_queue', activities: Array.from({ length: 17 }, () => 'x') });
    run(sim, { cmd: 'df_queue', activities: ['ok', 3] });
    run(sim, { cmd: 'df_list_create', activity: 'x'.repeat(65), tags: [] });
    run(sim, { cmd: 'df_list_create', activity: 'ok', tags: 'nope' });
    run(sim, { cmd: 'df_apply', listing: Number.NaN });
    run(sim, { cmd: 'df_app_respond', applicant: 'x' });
    expect(sim.dungeonFinderSetRoles).not.toHaveBeenCalled();
    expect(sim.dungeonFinderQueueJoin).not.toHaveBeenCalled();
    expect(sim.dungeonFinderListingCreate).not.toHaveBeenCalled();
    expect(sim.dungeonFinderApply).not.toHaveBeenCalled();
    expect(sim.dungeonFinderApplicationRespond).not.toHaveBeenCalled();
  });
});
