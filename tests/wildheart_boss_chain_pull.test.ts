// The premature-boss-pull punish (src/sim/instances/boss_chain_pull.ts), opted
// into by DungeonDef.bossChainPull and live only in the Wildheart Basin.
//
// The basin is an open field with two wings, so running past every pack to
// pull Zulgar alone was trivial there in a way it is not in a corridor
// dungeon. The rework (docs/design/dungeon-rework/wildheart_basin.md) gates
// every pack (instances/dungeon_gates.ts), and keeps this as the belt and
// braces: pulling him while ANY of the route is still alive sends the whole
// instance at the puller at once. The arrival cases below open the gates the
// way a dev walk does, since a closed gate is exactly what keeps a far pack
// from crossing the basin in play.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { setDungeonGatesDevOpen } from '../src/sim/instances/dungeon_gates';
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
/** The packs on the Upper Convergence and the Shrine Stair: the ones a premature
 *  Zulgar pull meets on the pyramid, with an open stair between them and him. */
const NORTH_PACKS = new Set(['g10', 'g11', 'g12', 'g13', 'pd']);

/** The pack id a claimed mob was placed with (the claim's roster runs in
 *  spawn order, one mob per DungeonSpawn). */
function packOf(instance: InstanceSlot, mob: Entity): string | undefined {
  const i = instance.mobIds.indexOf(mob.id);
  return i < 0 ? undefined : DUNGEONS.wildheart_basin.spawns[i]?.packId;
}

function northOf(instance: InstanceSlot, others: Entity[]): Entity[] {
  return others.filter((m) => NORTH_PACKS.has(packOf(instance, m) ?? ''));
}

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
    // Wildheart and the open-air five-player reworks opt in (README section 2,
    // docs/design/dungeon-rework: bossChainPull stays on everywhere).
    const OPTED_IN = new Set([
      'wildheart_basin',
      'hollow_crypt',
      'sunken_bastion',
      'drowned_temple',
      'gravewyrm_sanctum',
    ]);
    for (const id of OPTED_IN) expect(DUNGEONS[id].bossChainPull, id).toBe(true);
    // Every other dungeon keeps classic pull behavior.
    for (const dungeon of Object.values(DUNGEONS)) {
      if (OPTED_IN.has(dungeon.id)) continue;
      expect(dungeon.bossChainPull, dungeon.id).toBeUndefined();
    }
  });

  it('sends every living mob in the instance at the puller when Zulgar is pulled early', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    // The whole authored route is standing: every spawn besides Zulgar.
    expect(others.length).toBe(DUNGEONS.wildheart_basin.spawns.length - 1);
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

  it('lands every pulled mob of the pyramid on the puller, down the open stair', () => {
    const { sim, instance, player, boss, others } = claim(
      'wildheart_basin',
      'wildheart_high_priest',
    );
    setDungeonGatesDevOpen(instance, true);
    standAtShrine(sim, player, boss);

    sim.aggroMob(boss, player, false);
    // 100 yards at chase speed is about 14 seconds; 60 leaves real headroom.
    tickWithImmortalPuller(sim, player, 20 * 60);

    const north = northOf(instance, others);
    expect(north.length).toBeGreaterThanOrEqual(15);
    for (const mob of north) {
      expect(mob.aiState, `${mob.templateId} ${mob.id}`).toBe('attack');
      expect(mob.aggroTargetId, `${mob.templateId} ${mob.id}`).toBe(player.id);
    }
  });

  it('spends the transit grace on arrival and keeps the pull anchored at the pull point', () => {
    const { sim, instance, player, boss, others } = claim(
      'wildheart_basin',
      'wildheart_high_priest',
    );
    setDungeonGatesDevOpen(instance, true);
    standAtShrine(sim, player, boss);
    const pullPoint = { ...player.pos };

    sim.aggroMob(boss, player, false);
    tickWithImmortalPuller(sim, player, 20 * 60);

    // Arrived means anchored again: the transit grace is spent and the anchor
    // still reads the pull point (the hold below is what keeps the pull now).
    for (const mob of northOf(instance, others)) {
      expect(mob.chainPullInbound, `${mob.templateId} ${mob.id}`).toBe(false);
      expect(mob.leashAnchor, `${mob.templateId} ${mob.id}`).toEqual(pullPoint);
      expect(dist2d(mob.pos, pullPoint), `${mob.templateId} ${mob.id}`).toBeLessThanOrEqual(
        DUNGEON_LEASH_DISTANCE,
      );
    }
  });

  // The farm this pull was being used for: kite the whole basin around without
  // getting hit until every add leashes or stalls home, then take the boss alone.
  // Inside a claimed instance slot nothing sheds an attacker by distance
  // (instances/instance_combat_hold.ts): the pull follows the kiter across the
  // basin and past the old leash until he leaves the instance.
  it('follows a kiter past the old leash instead of shedding the pull', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    standAtShrine(sim, player, boss);
    sim.aggroMob(boss, player, false);
    tickWithImmortalPuller(sim, player, 20 * 40);
    for (const mob of others)
      expect(mob.aggroTargetId, `${mob.templateId} ${mob.id}`).toBe(player.id);

    // Kite the pack 100 yards back down the basin toward the entrance, past
    // DUNGEON_LEASH_DISTANCE from the pull point (still inside the slot's claim
    // envelope), and wait out the old stall window several times over.
    const anchor = { ...player.pos };
    player.pos = sim.ctx.groundPos(player.pos.x, player.pos.z - 100);
    player.prevPos = { ...player.pos };
    sim.ctx.rebucket(player);
    tickWithImmortalPuller(sim, player, 20 * 30);

    for (const mob of others) {
      const tag = `${mob.templateId} ${mob.id}`;
      expect(mob.aiState, tag).not.toBe('evade');
      expect(mob.inCombat, tag).toBe(true);
      expect(mob.threat.has(player.id), tag).toBe(true);
      expect(mob.aggroTargetId, tag).toBe(player.id);
    }
    // At least the front of the pack is now well past the old leash sphere.
    const chased = others.filter((m) => dist2d(m.pos, anchor) > DUNGEON_LEASH_DISTANCE);
    expect(chased.length).toBeGreaterThan(0);
    expect(player.inCombat).toBe(true);
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
    const { sim, instance, player, boss, others } = claim(
      'wildheart_basin',
      'wildheart_high_priest',
    );
    const trash = others.find((m) => m.templateId === 'wildheart_ravager');
    if (!trash) throw new Error('no ravager spawned');

    sim.aggroMob(trash, player, false);

    expect(trash.aiState).toBe('chase');
    expect(boss.aiState).toBe('idle');
    // Everything else stays asleep: a trash pull is still a local pull (its
    // own pack comes with it, nothing more).
    const pack = others.filter((m) => packOf(instance, m) === packOf(instance, trash));
    const stillIdle = others.filter((m) => m.id !== trash.id && m.aiState === 'idle');
    expect(stillIdle.length).toBe(others.length - pack.length);
  });

  it('wakes the whole Gravewyrm Sanctum too now that its Ice Tomb rework opts in', () => {
    const { sim, player, boss, others } = claim('gravewyrm_sanctum', 'korzul_the_gravewyrm');

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    for (const mob of others) {
      expect(mob.aiState, mob.templateId).toBe('chase');
      expect(mob.aggroTargetId, mob.templateId).toBe(player.id);
    }
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
