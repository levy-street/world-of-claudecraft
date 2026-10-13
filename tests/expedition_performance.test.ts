import { describe, expect, it, vi } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { TALENTS } from '../src/sim/content/talents';
import { recordQueueDamage } from '../src/sim/instances/queue_participation';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DungeonFinderMachine } from '../src/sim/social/dungeon_finder';
import type { ExpeditionSocialState } from '../src/sim/social/expedition_social';
import type { DungeonFinderBoard } from '../src/world_api/dungeon_finder';
import { EMPTY_TEST_WORLD } from './sim_shared';

function fixture() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Fixture');
  sim.setPlayerLevel(8, pid);
  sim.setSpec(TALENTS.warrior.specs.find((spec) => spec.role === 'dps')!.id, pid);
  sim.enterDungeon('hollow_crypt', pid);
  return { sim, pid, ctx: (sim as unknown as { ctx: SimContext }).ctx };
}
describe('expedition recurring work bounds', () => {
  it('does not scan instance mob arrays for ordinary overworld damage', () => {
    const { sim, pid, ctx } = fixture();
    const source = sim.entities.get(pid)!;
    const mob = {
      ...source,
      id: 999,
      kind: 'mob' as const,
      ownerId: null,
      templateId: 'ordinary_wolf',
    };
    const scans = sim.instances.map((claim) => vi.spyOn(claim.mobIds, 'includes'));
    expect(scans.length).toBeGreaterThan(0);
    expect(sim.instances.some((claim) => claim.partyKey !== null && claim.mobIds.length > 0)).toBe(
      true,
    );
    recordQueueDamage(ctx, source, mob, 10);
    recordQueueDamage(ctx, mob, source, 10);
    // Even an authored boss template outside a claimed dungeon uses no scan.
    recordQueueDamage(
      ctx,
      source,
      {
        ...mob,
        templateId: FINDER_ACTIVITIES.find((a) => a.encounters.length)!.encounters[0].mobId,
        pos: sim.groundPos(0, 0),
      },
      10,
    );
    for (const scan of scans) expect(scan).not.toHaveBeenCalled();
  });
  it('indexes finder books once and resolves each viewer once for 1,000 helpers x 50 rows', () => {
    const { sim, pid, ctx } = fixture();
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const finder = new DungeonFinderMachine(ctx);
    const internal = finder as unknown as {
      social: ExpeditionSocialState;
      queue: { members: number[] }[];
      proposals: { roles: Map<number, string> }[];
      listings: { leaderPid: number; id: number }[];
      sweep(): void;
      buildBoard(): DungeonFinderBoard;
      unitFor(pid: number): unknown;
      proposalFor(pid: number): unknown;
      listingBy(pid: number): unknown;
    };
    const board = Array.from({ length: 50 }, (_, id) => ({
      id: id + 1,
      activityId: 'hollow_crypt_normal',
      leaderName: 'Leader',
      tags: [],
      size: 1,
      capacity: 5,
      needed: null,
      members: [],
      expedition: { bossesDefeated: 0, bossesTotal: 2 },
    })) as DungeonFinderBoard;
    for (let id = 1000; id < 2000; id++) {
      sim.players.set(id, { ...meta });
      sim.entities.set(id, { ...player, id });
      internal.social.setAvailable(id, true, ['dps']);
    }
    internal.queue = Array.from({ length: 500 }, (_, id) => ({ members: [3000 + id] }));
    internal.proposals = Array.from({ length: 200 }, (_, id) => ({
      roles: new Map([[4000 + id, 'dps']]),
    }));
    internal.listings = Array.from({ length: 500 }, (_, id) => ({
      leaderPid: 5000 + id,
      id: id + 1,
    }));
    // Isolate the added notification pass from existing lifecycle/matching costs.
    vi.spyOn(internal, 'sweep').mockImplementation(() => {});
    vi.spyOn(internal, 'buildBoard').mockReturnValue(board);
    const queueLookups = vi.spyOn(internal, 'unitFor');
    const proposalLookups = vi.spyOn(internal, 'proposalFor');
    const listingLookups = vi.spyOn(internal, 'listingBy');
    const partyLookups = vi.spyOn(ctx, 'partyOf');
    const started = performance.now();
    for (let step = 0; step < 20; step++) {
      sim.tickCount = step * 20;
      sim.time = step;
      finder.update();
    }
    const elapsed = performance.now() - started;
    expect(queueLookups).not.toHaveBeenCalled();
    expect(proposalLookups).not.toHaveBeenCalled();
    expect(listingLookups).not.toHaveBeenCalled();
    expect(partyLookups).toHaveBeenCalledTimes(20_000);
    expect(internal.social.readAvailability(1000).notice?.listingIds).toHaveLength(5);
    console.info(
      `Expedition fan-out: 20 passes, 1,000 subscribers, 50 rows, 500 queue units, 200 proposals, 500 listings; ${elapsed.toFixed(1)}ms total; 20,000 viewer reads, zero inner-loop global lookups.`,
    );
  });
});
