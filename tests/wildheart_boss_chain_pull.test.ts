// The premature-boss-pull punish (src/sim/instances/boss_chain_pull.ts), opted
// into by DungeonDef.bossChainPull and live only in the Wildheart Basin.
//
// The basin is an open field with two routes to the shrine, so running past
// every pack to pull Zulgar alone is trivial there in a way it is not in a
// corridor dungeon. With the flag on, pulling him while ANY of the route is
// still alive sends the whole instance at the puller at once.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  CHAIN_PULL_ARRIVAL_MARGIN,
  chainPullTransitHoldsLeash,
  clearChainPullInbound,
  markChainPullInbound,
} from '../src/sim/mob/chain_pull_transit';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { DUNGEON_LEASH_DISTANCE, dist2d, type Entity, type WorldContent } from '../src/sim/types';

const WILDHEART_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 91): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WILDHEART_TEST_WORLD });
}

interface Claimed {
  sim: Sim;
  instance: InstanceSlot;
  player: Entity;
  boss: Entity;
  others: Entity[];
}

function claim(dungeonId: string, finalBossId: string): Claimed {
  const sim = makeSim();
  const pid = sim.addPlayer('warrior', 'Alpha');
  expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
  const instance = sim.instances.find((c) => c.dungeonId === dungeonId && c.partyKey !== null);
  if (!instance) throw new Error(`${dungeonId} instance was not claimed`);
  const player = sim.entities.get(sim.players.get(pid)!.entityId);
  if (!player) throw new Error('player entity missing');
  const mobs = instance.mobIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && e.kind === 'mob');
  const boss = mobs.find((m) => m.templateId === finalBossId);
  if (!boss) throw new Error(`${finalBossId} did not spawn`);
  return { sim, instance, player, boss, others: mobs.filter((m) => m.id !== boss.id) };
}

// Stand the puller at the shrine, where a group that ran the route past every
// pack actually pulls Zulgar from. claim() leaves the player at the entrance
// ~210 yards away, which is not where this mechanic is exercised in play.
function standAtShrine(sim: Sim, player: Entity, boss: Entity): void {
  player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z - 8);
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
}

// Run the pull forward with a puller who cannot die (devGod nulls incoming
// damage in combat/damage.ts). Nineteen level-20 mobs delete the reference
// warrior in a couple of swings, and a dead puller ends the pull through the
// normal threat-scrub path, which would mask what is actually under test:
// whether the pulled mobs stay pulled long enough to cross the basin.
function tickWithImmortalPuller(sim: Sim, player: Entity, ticks: number): void {
  player.devGod = true;
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('Wildheart Basin premature boss pull', () => {
  it('opts in through content, not through a hardcoded dungeon id in sim logic', () => {
    expect(DUNGEONS.wildheart_basin.bossChainPull).toBe(true);
    // Every other dungeon keeps classic pull behavior.
    for (const dungeon of Object.values(DUNGEONS)) {
      if (dungeon.id === 'wildheart_basin') continue;
      expect(dungeon.bossChainPull, dungeon.id).toBeUndefined();
    }
  });

  it('sends every living mob in the instance at the puller when Zulgar is pulled early', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    // The whole authored route is standing: 20 spawns, so 19 besides Zulgar.
    expect(others.length).toBe(19);
    for (const mob of others) expect(mob.aiState).toBe('idle');

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    for (const mob of others) {
      expect(mob.aiState, mob.templateId).toBe('chase');
      expect(mob.aggroTargetId, mob.templateId).toBe(player.id);
      expect(mob.inCombat, mob.templateId).toBe(true);
      // Hate table seeded, so a taunt or a heal has a baseline to work against.
      expect(mob.threat.get(player.id), mob.templateId).toBeGreaterThan(0);
      // Leash anchored on the PULLER, not where the mob stood: the route is
      // ~180 yards end to end against a 70-yard dungeon leash, so a
      // self-anchored mob would run 70 yards, hit its leash and evade home
      // without ever reaching the shrine. The anchor governs the FIGHT; the
      // inbound flag below is what gets the mob there (chain_pull_transit.ts).
      expect(mob.leashAnchor, mob.templateId).toEqual({ ...player.pos });
      expect(mob.chainPullInbound, mob.templateId).toBe(true);
    }
  });

  // The regression this file exists to hold. Flipping every mob to 'chase' is
  // only half the mechanic: the pulled mob then has to survive its own leash
  // check long enough to cross the basin. The pull anchors the leash on the
  // PULLER, and DUNGEON_LEASH_DISTANCE is 70 against a ~180-yard route, so
  // every mob further out than 70 yards started the fight already outside its
  // own leash sphere and evaded home on its first engaged tick. Thirteen of the
  // nineteen never took a step, which read in play as the mechanic only working
  // near the shrine.
  it('holds the pull while a far mob is still crossing the basin', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    standAtShrine(sim, player, boss);
    const far = others.filter((m) => dist2d(m.pos, player.pos) > DUNGEON_LEASH_DISTANCE);
    // The authored route really does put most of the roster out past the leash.
    expect(far.length).toBeGreaterThan(10);

    sim.aggroMob(boss, player, false);
    tickWithImmortalPuller(sim, player, 1);

    for (const mob of far) {
      expect(mob.aiState, `${mob.templateId} ${mob.id}`).not.toBe('evade');
      expect(mob.aggroTargetId, `${mob.templateId} ${mob.id}`).toBe(player.id);
    }
  });

  it('lands every pulled mob on the puller, from the entrance packs to the shrine', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    standAtShrine(sim, player, boss);

    sim.aggroMob(boss, player, false);
    // 170 yards at chase speed is about 23 seconds; 60 leaves real headroom.
    tickWithImmortalPuller(sim, player, 20 * 60);

    for (const mob of others) {
      expect(mob.aiState, `${mob.templateId} ${mob.id}`).toBe('attack');
      expect(mob.aggroTargetId, `${mob.templateId} ${mob.id}`).toBe(player.id);
    }
  });

  it('re-arms the leash once an arriving mob reaches the pull point', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    standAtShrine(sim, player, boss);
    const pullPoint = { ...player.pos };

    sim.aggroMob(boss, player, false);
    tickWithImmortalPuller(sim, player, 20 * 60);

    // Arrived means anchored again: the transit grace is spent and the leash is
    // live from the pull point, so the group still cannot walk the instance out
    // through the door one pack at a time.
    for (const mob of others) {
      expect(mob.chainPullInbound, `${mob.templateId} ${mob.id}`).toBe(false);
      expect(mob.leashAnchor, `${mob.templateId} ${mob.id}`).toEqual(pullPoint);
      expect(dist2d(mob.pos, pullPoint), `${mob.templateId} ${mob.id}`).toBeLessThanOrEqual(
        DUNGEON_LEASH_DISTANCE,
      );
    }
  });

  it('is a no-op once the route is cleared, so a clean clear fights the boss alone', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    for (const mob of others) mob.dead = true;

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    expect(boss.aggroTargetId).toBe(player.id);
    for (const mob of others) {
      expect(mob.aiState, mob.templateId).toBe('idle');
      expect(mob.aggroTargetId, mob.templateId).toBeNull();
    }
  });

  it('never fires for a mob that is not the boss', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    const trash = others.find((m) => m.templateId === 'wildheart_ravager');
    if (!trash) throw new Error('no ravager spawned');

    sim.aggroMob(trash, player, false);

    expect(trash.aiState).toBe('chase');
    expect(boss.aiState).toBe('idle');
    // Everything else stays asleep: a trash pull is still a local pull.
    const stillIdle = others.filter((m) => m.id !== trash.id && m.aiState === 'idle');
    expect(stillIdle.length).toBe(others.length - 1);
  });

  it('leaves a dungeon that did not opt in on classic boss-pull behavior', () => {
    const { sim, player, boss, others } = claim('gravewyrm_sanctum', 'korzul_the_gravewyrm');

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    for (const mob of others) expect(mob.aiState, mob.templateId).toBe('idle');
  });

  it('draws no rng, so the shared draw order and the parity goldens are unaffected', () => {
    const { sim, player, boss } = claim('wildheart_basin', 'wildheart_high_priest');
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.aggroMob(boss, player, false);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

// The transit grace on its own, away from a live instance: the predicate the
// leash prelude consults every engaged tick.
describe('chain-pull transit grace', () => {
  const ANCHOR = { x: 0, y: 0, z: 0 };
  const LEASH = DUNGEON_LEASH_DISTANCE;

  function mobAt(z: number): Entity {
    const mob = createMob(1, MOBS.wildheart_ravager, 20, { x: 0, y: 0, z });
    return mob;
  }

  it('holds nothing for a mob that was never chain-pulled', () => {
    // The far-away mob is the interesting case: without the flag it must still
    // read as leash-broken, or the grace would exempt every dragged pull.
    const mob = mobAt(150);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(false);
    expect(mob.chainPullInbound).toBe(false);
  });

  it('holds the leash while the mob is still outside the sphere', () => {
    const mob = mobAt(150);
    markChainPullInbound(mob);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(true);
    expect(mob.chainPullInbound).toBe(true);
  });

  it('spends the grace on the tick the mob reaches the sphere', () => {
    const mob = mobAt(LEASH - CHAIN_PULL_ARRIVAL_MARGIN);
    markChainPullInbound(mob);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(false);
    expect(mob.chainPullInbound).toBe(false);
  });

  it('clears one yard inside the edge, so arrival and a leash break never collide', () => {
    // Between leash - MARGIN and leash the mob is still inbound but is not far
    // enough out to break either, which is the whole point of the hysteresis.
    const mob = mobAt(LEASH - CHAIN_PULL_ARRIVAL_MARGIN + 0.5);
    markChainPullInbound(mob);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(true);
    expect(mob.chainPullInbound).toBe(true);
  });

  it('does not re-arm when an arrived mob is dragged back out', () => {
    const mob = mobAt(0);
    markChainPullInbound(mob);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(false);
    mob.pos = { x: 0, y: 0, z: LEASH + 40 };
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(false);
  });

  it('clears on the shared pull-over reset', () => {
    const mob = mobAt(150);
    markChainPullInbound(mob);
    clearChainPullInbound(mob);
    expect(chainPullTransitHoldsLeash(mob, ANCHOR, LEASH)).toBe(false);
  });
});
