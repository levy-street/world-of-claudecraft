// The Mirefen muster's drill yard and quest chain (src/sim/muster_effigy.ts,
// src/sim/muster_drill.ts, content/mirefen_muster_quests.ts, quests/weekly_quest_lock.ts).
//
// What is pinned, each decisively:
//   - the chain: Fenwick -> the Commander (a quest NPC raised with the army at his post) ->
//     the pike drill -> the weekly, each gated on the one before;
//   - the drill's three steps credit (rack, lantern, blows in the window);
//   - the effigy is PER PLAYER: one player's thrust opens their own window only;
//   - the plank hide turns away Barrowhide's share, and a window lets the owner's blows
//     through in full, then closes after Balgath's own blind length;
//   - the drillmaster's mallet kicks a couched beam through the slam shockwave path;
//   - the weekly is a Balgath kill credited to every contributor carrying it (never a
//     corpse item), and locks until the weekly reset.
import { describe, expect, it } from 'vitest';
import {
  MUSTER_CAMPS,
  MUSTER_COMMAND_KEEP_OUT,
  MUSTER_COMMANDER_NPC_ID,
  MUSTER_DRILL_LANE,
  MUSTER_DRILL_LANE_REACH,
  MUSTER_DRILL_POST,
  MUSTER_DRILL_YARD,
  MUSTER_EFFIGY_CLEAR_RADIUS,
  MUSTER_EFFIGY_POST,
  MUSTER_RACK,
} from '../src/sim/content/mirefen_muster';
import {
  MUSTER_DRILL_WINDOW_HITS,
  MUSTER_PIKE_DRILL_QUEST_ID,
  MUSTER_SUMMONS_QUEST_ID,
  MUSTER_TROPHY_QUEST_ID,
} from '../src/sim/content/mirefen_muster_quests';
import { BUILTIN_WORLD, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { runBalgathQuestDev } from '../src/sim/dev/balgath_dev_quests';
import { drainDelayedEvents } from '../src/sim/entity_roster';
import { LANCE_FIXED_DAMAGE } from '../src/sim/lance_balance_core';
import { LANCE_SHOCK_KICK } from '../src/sim/lance_trial';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import {
  MUSTER_EFFIGY_COLLIDER_RADIUS,
  musterCampColliders,
  musterEffigyCollider,
} from '../src/sim/muster_camp_colliders';
import { musterFootprintDistance } from '../src/sim/muster_camp_layout';
import { musterCampPlan } from '../src/sim/muster_camp_plan';
import {
  isMusterDrillTrainee,
  MUSTER_DRILL_FIRST_BLOW,
  MUSTER_DRILL_POUND_EVERY,
  MUSTER_DRILL_WATCH_RANGE,
  musterDrillStake,
  poundMusterDrill,
} from '../src/sim/muster_drill';
import {
  EFFIGY_OPENED_AURA_ID,
  EFFIGY_WARD_AURA_ID,
  EFFIGY_WINDOW_SECONDS,
} from '../src/sim/muster_effigy';
import { EFFIGY_WARD_REDUCTION } from '../src/sim/muster_effigy_core';
import { MUSTER_SHARDPIKE_ID } from '../src/sim/muster_pike';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { weeklyQuestLockoutId } from '../src/sim/quests/weekly_quest_lock';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  DT,
  dist2d,
  type Entity,
  MELEE_RANGE,
  normAngle,
  type WorldContent,
} from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const BALGATH = 'balgath_cyclops';
const lair = (() => {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
})();
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { warden_fenwick: NPCS.warden_fenwick },
  groundObjects: [],
};

interface Internals {
  musterArmy: MusterArmyState;
  ctx: SimContext;
  spawnDevBoss(t: string, x: number, z: number): number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

const place = (sim: Sim, e: Entity, x: number, z: number) => {
  e.pos = { x, y: terrainHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  e.onGround = true;
};

/** A world with Balgath and his muster raised; the player a warrior at the drill lane. */
function drillYard() {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true, world: TEST_WORLD });
  sim.setPlayerLevel(10);
  inner(sim).spawnDevBoss(BALGATH, lair.x, lair.z);
  for (let i = 0; i < 25 && inner(sim).musterArmy.soldierIds.length === 0; i++) sim.tick();
  const army = inner(sim).musterArmy;
  const ctx = inner(sim).ctx;
  const effigy = sim.entities.get(army.effigyId ?? -1);
  if (!effigy) throw new Error('no effigy raised');
  // The trainee's mark (content/mirefen_muster.ts), `side` yards across the lane.
  const lane = (e: Entity, side = 0) => {
    const f = MUSTER_DRILL_LANE.facing;
    place(
      sim,
      e,
      MUSTER_DRILL_LANE.x + Math.cos(f) * side,
      MUSTER_DRILL_LANE.z - Math.sin(f) * side,
    );
    e.facing = f;
  };
  lane(sim.player);
  const meta = (pid = sim.playerId) => {
    const m = sim.players.get(pid);
    if (!m) throw new Error('no meta');
    return m;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      sim.time += DT;
      advancePendingProjectiles(ctx);
      drainDelayedEvents(ctx);
    }
  };
  /** Pike in hand, couched and set, then the thrust flies home. */
  const thrust = (pid = sim.playerId) => {
    sim.lanceBrace(pid);
    const m = meta(pid);
    if (!m.lance) throw new Error('brace failed');
    m.lance.phase = 'steadied';
    sim.lanceThrust(pid);
    step(30);
  };
  const takePike = (pid = sim.playerId) => {
    const p = sim.entities.get(pid) as Entity;
    const at = { x: p.pos.x, z: p.pos.z, facing: p.facing };
    place(sim, p, MUSTER_RACK.x + 1.5, MUSTER_RACK.z - 1.5);
    p.targetId = army.rackId;
    sim.interact(pid);
    place(sim, p, at.x, at.z);
    p.facing = at.facing;
  };
  return { sim, army, ctx, effigy, meta, step, thrust, takePike, lane };
}

describe('the drill yard is placed with care', () => {
  it('stands on dry ground inside the command camp keep-out, clear of every camp piece', () => {
    const y = terrainHeight(MUSTER_EFFIGY_POST.x, MUSTER_EFFIGY_POST.z, WORLD_SEED);
    expect(y).toBeGreaterThan(WATER_LEVEL + 1.5);
    const d = Math.hypot(
      MUSTER_EFFIGY_POST.x - MUSTER_COMMAND_KEEP_OUT.x,
      MUSTER_EFFIGY_POST.z - MUSTER_COMMAND_KEEP_OUT.z,
    );
    expect(d + 7 + MUSTER_EFFIGY_CLEAR_RADIUS).toBeLessThan(MUSTER_COMMAND_KEEP_OUT.radius);
    for (const p of musterCampPlan(WORLD_SEED)) {
      const d = musterFootprintDistance(
        p.key,
        p.x,
        p.z,
        p.rot,
        MUSTER_EFFIGY_POST.x,
        MUSTER_EFFIGY_POST.z,
      );
      expect(d, p.key).toBeGreaterThanOrEqual(MUSTER_EFFIGY_CLEAR_RADIUS);
    }
    const command = MUSTER_CAMPS.find((c) => c.id === 'command');
    expect(command?.soldiers.some((s) => s.templateId === 'muster_drillmaster')).toBe(true);
    expect(
      dist2d(
        { x: MUSTER_DRILL_POST.x, y: 0, z: MUSTER_DRILL_POST.z },
        { ...MUSTER_EFFIGY_POST, y: 0 },
      ),
    ).toBeLessThan(6);
  });
});

describe('the drill yard has its own ground', () => {
  const command = MUSTER_CAMPS.find((c) => c.id === 'command') as (typeof MUSTER_CAMPS)[number];
  const posts = command.soldiers.map((s) => ({
    id: s.templateId,
    x: command.center.x + s.dx,
    z: command.center.z + s.dz,
  }));

  it('keeps the whole yard bare: no camp piece reaches into it', () => {
    expect(command.reserved).toContainEqual(MUSTER_DRILL_YARD);
    // it takes in the effigy, the trainee's mark and the drillmaster's stake
    for (const p of [MUSTER_EFFIGY_POST, MUSTER_DRILL_LANE, musterDrillStake()]) {
      expect(Math.hypot(p.x - MUSTER_DRILL_YARD.x, p.z - MUSTER_DRILL_YARD.z)).toBeLessThan(
        MUSTER_DRILL_YARD.r,
      );
    }
    for (const p of musterCampPlan(WORLD_SEED)) {
      if (p.campId !== 'command') continue;
      const d = musterFootprintDistance(
        p.key,
        p.x,
        p.z,
        p.rot,
        MUSTER_DRILL_YARD.x,
        MUSTER_DRILL_YARD.z,
      );
      expect(d, p.key).toBeGreaterThanOrEqual(MUSTER_DRILL_YARD.r);
    }
  });

  it('stands only the drillmaster in the yard, well apart from the Commander and the rack', () => {
    for (const p of posts) {
      const inYard =
        Math.hypot(p.x - MUSTER_DRILL_YARD.x, p.z - MUSTER_DRILL_YARD.z) < MUSTER_DRILL_YARD.r;
      expect(inYard, p.id).toBe(p.id === 'muster_drillmaster');
    }
    const commander = posts.find((p) => p.id === MUSTER_COMMANDER_NPC_ID);
    if (!commander) throw new Error('no commander post');
    // the trainee's mark is nobody's post: the Commander and the rack stand a clear walk off
    expect(
      Math.hypot(commander.x - MUSTER_DRILL_LANE.x, commander.z - MUSTER_DRILL_LANE.z),
    ).toBeGreaterThan(5);
    expect(
      Math.hypot(MUSTER_RACK.x - MUSTER_DRILL_LANE.x, MUSTER_RACK.z - MUSTER_DRILL_LANE.z),
    ).toBeGreaterThan(5);
  });

  it('keeps the command camp sparse: the Commander, the drillmaster and three posted soldiers', () => {
    expect(posts.filter((p) => p.id === MUSTER_COMMANDER_NPC_ID)).toHaveLength(1);
    expect(posts.filter((p) => p.id === 'muster_drillmaster')).toHaveLength(1);
    expect(posts).toHaveLength(5);
    // no two posts close enough for their nameplates to stack from a normal camera
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        const a = posts[i];
        const b = posts[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id}/${b.id}`).toBeGreaterThan(5);
      }
    }
  });

  it('/dev balgath drill stands you on the mark, facing the effigy', () => {
    const h = drillYard();
    place(h.sim, h.sim.player, MUSTER_RACK.x, MUSTER_RACK.z + 3);
    const r = runBalgathQuestDev(h.ctx, h.sim.playerId, 'drill');
    expect(r.ok).toBe(true);
    const p = h.sim.player;
    expect(p.pos.x).toBeCloseTo(MUSTER_DRILL_LANE.x, 3);
    expect(p.pos.z).toBeCloseTo(MUSTER_DRILL_LANE.z, 3);
    const toEffigy = Math.atan2(MUSTER_EFFIGY_POST.x - p.pos.x, MUSTER_EFFIGY_POST.z - p.pos.z);
    expect(Math.abs(normAngle(p.facing - toEffigy))).toBeLessThan(1e-6);
    expect(dist2d(p.pos, h.effigy.pos)).toBeCloseTo(MUSTER_DRILL_LANE_REACH, 1);
  });
});

describe('the effigy is solid', () => {
  it('stands a post at its legs that a player bumps into, still inside melee reach', () => {
    const c = musterEffigyCollider(WORLD_SEED);
    expect(musterCampColliders(WORLD_SEED)).toContainEqual(c);
    expect(Math.hypot(c.x - MUSTER_EFFIGY_POST.x, c.z - MUSTER_EFFIGY_POST.z)).toBeLessThan(1);
    expect(c.r).toBe(MUSTER_EFFIGY_COLLIDER_RADIUS);
    expect(c.r + 1).toBeLessThan(MELEE_RANGE);
  });
});

describe('the muster quest chain', () => {
  it('Fenwick sends you up, the Commander briefs you, and the briefing opens the rest', () => {
    const { sim, army } = drillYard();
    const commander = sim.entities.get(army.commanderId ?? -1);
    expect(commander?.kind).toBe('npc');
    expect(commander?.templateId).toBe(MUSTER_COMMANDER_NPC_ID);
    expect(NPCS[MUSTER_COMMANDER_NPC_ID]?.questIds).toEqual([
      MUSTER_SUMMONS_QUEST_ID,
      MUSTER_PIKE_DRILL_QUEST_ID,
      MUSTER_TROPHY_QUEST_ID,
    ]);
    expect(NPCS.warden_fenwick.questIds).toContain(MUSTER_SUMMONS_QUEST_ID);
    expect(QUESTS[MUSTER_PIKE_DRILL_QUEST_ID].requiresQuest).toBe(MUSTER_SUMMONS_QUEST_ID);
    // The weekly hangs off the briefing, not the drill: the drill is level 19 and under
    // (the rack's cap), and a level 20 still has to be able to join the kill.
    expect(QUESTS[MUSTER_TROPHY_QUEST_ID].requiresQuest).toBe(MUSTER_SUMMONS_QUEST_ID);
    expect(sim.questState(MUSTER_SUMMONS_QUEST_ID)).toBe('available');
    expect(sim.questState(MUSTER_PIKE_DRILL_QUEST_ID)).toBe('unavailable');
    const fenwick = [...sim.entities.values()].find((e) => e.templateId === 'warden_fenwick');
    if (!fenwick) throw new Error('no Fenwick');
    place(sim, sim.player, fenwick.pos.x + 1, fenwick.pos.z);
    sim.acceptQuest(MUSTER_SUMMONS_QUEST_ID);
    expect(sim.questState(MUSTER_SUMMONS_QUEST_ID)).toBe('active');
    // Report in: walk to the Commander and speak to him.
    if (!commander) throw new Error('no commander');
    place(sim, sim.player, commander.pos.x + 1, commander.pos.z);
    sim.talkToNpc(commander.id);
    expect(sim.questState(MUSTER_SUMMONS_QUEST_ID)).toBe('ready');
    sim.turnInQuest(MUSTER_SUMMONS_QUEST_ID);
    expect(sim.questState(MUSTER_SUMMONS_QUEST_ID)).toBe('done');
    expect(sim.questState(MUSTER_PIKE_DRILL_QUEST_ID)).toBe('available');
    expect(sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('available');
  });

  it('the drill credits the rack, the lantern and the blows in the window, then opens the weekly', () => {
    const h = drillYard();
    const m = h.meta();
    m.questsDone.add(MUSTER_SUMMONS_QUEST_ID);
    m.questLog.set(MUSTER_PIKE_DRILL_QUEST_ID, {
      questId: MUSTER_PIKE_DRILL_QUEST_ID,
      counts: [0, 0, 0],
      state: 'active',
    });
    const before = m.equipment.mainhand;
    h.takePike();
    expect(m.equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    expect(m.questLog.get(MUSTER_PIKE_DRILL_QUEST_ID)?.counts).toEqual([1, 0, 0]);
    h.thrust();
    expect(m.questLog.get(MUSTER_PIKE_DRILL_QUEST_ID)?.counts).toEqual([1, 1, 0]);
    // The lent pike went back to the rack and the player's own weapon is in hand.
    expect(m.equipment.mainhand).toBe(before);
    expect(h.sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(0);
    for (let i = 0; i < MUSTER_DRILL_WINDOW_HITS; i++) {
      h.sim.dealDamage(h.sim.player, h.effigy, 40, false, 'physical', 'Strike', 'hit');
    }
    const qp = m.questLog.get(MUSTER_PIKE_DRILL_QUEST_ID);
    expect(qp?.counts).toEqual([1, 1, MUSTER_DRILL_WINDOW_HITS]);
    expect(qp?.state).toBe('ready');
  });
});

describe('the Straw Foreman', () => {
  it('wears a plank hide that turns away what Barrowhide does', () => {
    const { effigy } = drillYard();
    expect(MOBS.muster_effigy.dummy).toBe(true);
    expect(EFFIGY_WARD_REDUCTION).toBe(MOBS[BALGATH].eyeWard?.reduction);
    expect(EFFIGY_WINDOW_SECONDS).toBe(MOBS[BALGATH].eyeWard?.blindSeconds);
    const ward = effigy.auras.find((a) => a.id === EFFIGY_WARD_AURA_ID);
    expect(ward?.kind).toBe('buff_dr');
    expect(ward?.value).toBe(EFFIGY_WARD_REDUCTION);
  });

  it('a thrust puts the lantern out and the window lets the blows through, then it closes', () => {
    const h = drillYard();
    const hit = () => {
      const hp = h.effigy.hp;
      h.sim.dealDamage(h.sim.player, h.effigy, 100, false, 'physical', 'Strike', 'hit');
      return hp - h.effigy.hp;
    };
    const shielded = hit();
    expect(shielded).toBe(Math.round(100 * (1 - EFFIGY_WARD_REDUCTION)));
    h.takePike();
    const hp = h.effigy.hp;
    h.thrust();
    // The thrust itself lands in full, like the real eye.
    expect(hp - h.effigy.hp).toBe(LANCE_FIXED_DAMAGE);
    expect(h.sim.player.auras.some((a) => a.id === EFFIGY_OPENED_AURA_ID)).toBe(true);
    expect(hit()).toBe(100);
    h.step(Math.ceil(EFFIGY_WINDOW_SECONDS / DT) + 2);
    h.sim.tick(); // the muster pass closes the window and takes the timer aura
    expect(h.sim.player.auras.some((a) => a.id === EFFIGY_OPENED_AURA_ID)).toBe(false);
    expect(hit()).toBe(shielded);
  });

  it("is per player: one thrust opens only its thruster's window", () => {
    const h = drillYard();
    const other = h.sim.addPlayer('warrior', 'Second');
    const otherE = h.sim.entities.get(other) as Entity;
    h.lane(otherE, 2);
    h.takePike();
    h.thrust();
    expect(otherE.auras.some((a) => a.id === EFFIGY_OPENED_AURA_ID)).toBe(false);
    const hp = h.effigy.hp;
    h.sim.dealDamage(otherE, h.effigy, 100, false, 'physical', 'Strike', 'hit');
    expect(hp - h.effigy.hp).toBe(Math.round(100 * (1 - EFFIGY_WARD_REDUCTION)));
    // And the second player's own thrust still finds a lit lantern.
    h.takePike(other);
    h.thrust(other);
    expect(otherE.auras.some((a) => a.id === EFFIGY_OPENED_AURA_ID)).toBe(true);
  });
});

describe("the drillmaster's mallet", () => {
  it('kicks a couched beam through the slam shockwave, harder the nearer the stake', () => {
    const h = drillYard();
    h.takePike();
    h.sim.lanceBrace();
    const m = h.meta();
    if (!m.lance) throw new Error('brace failed');
    const v0 = m.lance.beam.velocity;
    poundMusterDrill(h.ctx, h.army);
    // Nothing until the mallet meets the stake.
    expect(m.lance.beam.velocity).toBe(v0);
    h.step(20);
    const kick = (m.lance?.beam.velocity ?? v0) - v0;
    expect(Math.abs(kick)).toBeGreaterThan(0.1);
    expect(Math.abs(kick)).toBeLessThanOrEqual(LANCE_SHOCK_KICK);
    // The stake is on the trainee's left (facing the effigy), so the shove goes right.
    const stake = musterDrillStake();
    const bearing = Math.atan2(stake.x - h.sim.player.pos.x, stake.z - h.sim.player.pos.z);
    expect(Math.sign(kick)).toBe(Math.sin(bearing - h.sim.player.facing) >= 0 ? 1 : -1);
  });

  it('stands at ease until a trainee couches a pike, pounds on the beat, and settles when the brace ends', () => {
    const h = drillYard();
    const m = h.meta();
    /** Ticks, holding any live beam steady so the brace lasts; counts his windups. */
    const run = (seconds: number) => {
      let n = 0;
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        if (m.lance) {
          m.lance.beam.balance = 0;
          m.lance.beam.velocity = 0;
        }
        n += h.sim
          .tick()
          .filter((ev) => ev.type === 'spellfx' && ev.ability === 'muster_mallet_pound').length;
      }
      return n;
    };
    // nobody in the yard: at ease
    expect(run(10)).toBe(0);
    expect(h.army.drillTraining).toBe(false);
    // a pike in hand on the lane is not training yet: only a couched pike is
    h.takePike();
    expect(run(10)).toBe(0);
    expect(h.army.drillTraining).toBe(false);
    // couched: a breath to find the balance, then a blow on every beat
    h.sim.lanceBrace();
    expect(m.lance).toBeDefined();
    expect(run(MUSTER_DRILL_FIRST_BLOW - 0.2)).toBe(0);
    expect(h.army.drillTraining).toBe(true);
    const busy = run(MUSTER_DRILL_POUND_EVERY * 3);
    expect(busy).toBeGreaterThanOrEqual(3);
    expect(busy).toBeLessThanOrEqual(4);
    // the brace ends (lifting the pike): he settles back, facing the lane, and stays at ease
    m.lance = undefined;
    h.sim.player.bracing = false;
    run(1);
    expect(h.army.drillTraining).toBe(false);
    const dm = h.sim.entities.get(h.army.drillmasterId ?? -1) as Entity;
    expect(dm.facing).toBeCloseTo(MUSTER_DRILL_POST.facing, 6);
    expect(run(10)).toBe(0);
  });

  it('a braced player outside the drill yard neither starts the drill nor feels its blows', () => {
    const h = drillYard();
    h.takePike();
    // far from the effigy (well outside the yard), couched
    place(
      h.sim,
      h.sim.player,
      MUSTER_EFFIGY_POST.x + MUSTER_DRILL_WATCH_RANGE + 6,
      MUSTER_EFFIGY_POST.z,
    );
    h.sim.lanceBrace();
    const m = h.meta();
    if (!m.lance) throw new Error('brace failed');
    expect(isMusterDrillTrainee(h.ctx, h.sim.playerId)).toBe(false);
    const v0 = m.lance.beam.velocity;
    poundMusterDrill(h.ctx, h.army);
    h.step(20);
    expect(m.lance?.beam.velocity ?? v0).toBe(v0);
  });

  it('lands the mallet on the ground in front of him, never on the effigy', () => {
    const stake = musterDrillStake();
    const f = MUSTER_DRILL_POST.facing;
    const dx = stake.x - MUSTER_DRILL_POST.x;
    const dz = stake.z - MUSTER_DRILL_POST.z;
    // ahead of him, a stride out
    expect(dx * Math.sin(f) + dz * Math.cos(f)).toBeGreaterThan(0.8);
    // he faces the trainee's mark, not the effigy
    const toMark = Math.atan2(
      MUSTER_DRILL_LANE.x - MUSTER_DRILL_POST.x,
      MUSTER_DRILL_LANE.z - MUSTER_DRILL_POST.z,
    );
    expect(Math.abs(normAngle(f - toMark))).toBeLessThan(0.01);
    // the blow lands well clear of the effigy's body
    expect(
      Math.hypot(stake.x - MUSTER_EFFIGY_POST.x, stake.z - MUSTER_EFFIGY_POST.z),
    ).toBeGreaterThan(MUSTER_EFFIGY_COLLIDER_RADIUS + 2);
  });
});

describe('the weekly trophy', () => {
  /** A drill yard with the weekly taken by the player (and anyone else in `takers`). */
  function weekly(extraTakers = 0) {
    const h = drillYard();
    const takers = [h.sim.playerId];
    for (let i = 0; i < extraTakers; i++) {
      const pid = h.sim.addPlayer('warrior', `Taker${i}`);
      h.sim.setPlayerLevel(10, pid);
      takers.push(pid);
    }
    const commander = h.sim.entities.get(h.army.commanderId ?? -1) as Entity;
    for (const pid of takers) {
      const m = h.meta(pid);
      m.questsDone.add(MUSTER_SUMMONS_QUEST_ID);
      m.questsDone.add(MUSTER_PIKE_DRILL_QUEST_ID);
      place(h.sim, h.sim.entities.get(pid) as Entity, commander.pos.x + 1, commander.pos.z);
      expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID, pid)).toBe('available');
      h.sim.acceptQuest(MUSTER_TROPHY_QUEST_ID, pid);
      expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID, pid)).toBe('active');
    }
    const boss = [...h.sim.entities.values()].find((e) => e.templateId === BALGATH) as Entity;
    return { ...h, takers, boss };
  }

  it('asks for the kill itself: one Balgath objective, and no trophy item anywhere', () => {
    const quest = QUESTS[MUSTER_TROPHY_QUEST_ID];
    expect(quest.objectives).toEqual([
      { type: 'kill', targetMobId: BALGATH, count: 1, label: 'Balgath slain' },
    ]);
    expect(ITEMS.barrowhide_slab).toBeUndefined();
    expect(Object.values(ITEMS).some((item) => item.questId === MUSTER_TROPHY_QUEST_ID)).toBe(
      false,
    );
  });

  it('credits every contributor carrying it, not just the tagger, and nobody else', () => {
    const h = weekly(1);
    const [tagger, raider] = h.takers;
    const bystander = h.sim.addPlayer('warrior', 'Bystander');
    const untaken = h.sim.addPlayer('warrior', 'Untaken');
    // the raider and the untaken player fought in a different group; the bystander never did
    for (const pid of [tagger, raider, untaken]) h.boss.bossDamagers.add(pid);
    h.boss.hp = 1;
    h.sim.dealDamage(h.sim.player, h.boss, 10, false, 'physical', 'Strike', 'hit');
    expect(h.boss.dead).toBe(true);
    for (const pid of [tagger, raider]) {
      expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID, pid)).toBe('ready');
      // capped: the tagger's ordinary kill credit and the contributor credit never stack
      expect(h.meta(pid).questLog.get(MUSTER_TROPHY_QUEST_ID)?.counts).toEqual([1]);
    }
    for (const pid of [bystander, untaken]) {
      expect(h.meta(pid).questLog.has(MUSTER_TROPHY_QUEST_ID)).toBe(false);
    }
    // no quest trophy rides the corpse any more
    expect(h.boss.loot?.items.some((slot) => ITEMS[slot.itemId]?.kind === 'quest') ?? false).toBe(
      false,
    );
  });

  it('counts only while the weekly is active: a kill before accepting it does not', () => {
    const h = drillYard();
    const m = h.meta();
    m.questsDone.add(MUSTER_SUMMONS_QUEST_ID);
    m.questsDone.add(MUSTER_PIKE_DRILL_QUEST_ID);
    const boss = [...h.sim.entities.values()].find((e) => e.templateId === BALGATH) as Entity;
    boss.bossDamagers.add(h.sim.playerId);
    boss.hp = 1;
    h.sim.dealDamage(h.sim.player, boss, 10, false, 'physical', 'Strike', 'hit');
    expect(boss.dead).toBe(true);
    const commander = h.sim.entities.get(h.army.commanderId ?? -1) as Entity;
    place(h.sim, h.sim.player, commander.pos.x + 1, commander.pos.z);
    h.sim.acceptQuest(MUSTER_TROPHY_QUEST_ID);
    expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('active');
    expect(m.questLog.get(MUSTER_TROPHY_QUEST_ID)?.counts).toEqual([0]);
  });

  it('/dev balgath trophy grants the kill credit, and only with the weekly in the log', () => {
    const h = drillYard();
    expect(runBalgathQuestDev(h.ctx, h.sim.playerId, 'trophy').ok).toBe(false);
    const w = weekly();
    const r = runBalgathQuestDev(w.ctx, w.sim.playerId, 'trophy');
    expect(r.ok).toBe(true);
    expect(w.sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('ready');
    expect(runBalgathQuestDev(w.ctx, w.sim.playerId, 'trophy').ok).toBe(false);
  });

  it('locks until the weekly reset once turned in', () => {
    const h = weekly();
    const m = h.meta();
    h.boss.bossDamagers.add(h.sim.playerId);
    h.boss.hp = 1;
    h.sim.dealDamage(h.sim.player, h.boss, 10, false, 'physical', 'Strike', 'hit');
    expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('ready');
    h.sim.turnInQuest(MUSTER_TROPHY_QUEST_ID);
    // Done for the week: unavailable until the weekly reset instant.
    const until = m.raidLockouts.get(weeklyQuestLockoutId(MUSTER_TROPHY_QUEST_ID));
    expect(until).toBeGreaterThan(h.ctx.lockoutNowMs());
    expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('unavailable');
    expect(h.sim.craftingIdentity?.cadenceBlockedQuests).toContain(MUSTER_TROPHY_QUEST_ID);
    // The reset passes: the Commander offers it again.
    m.raidLockouts.set(weeklyQuestLockoutId(MUSTER_TROPHY_QUEST_ID), h.ctx.lockoutNowMs() - 1);
    expect(h.sim.questState(MUSTER_TROPHY_QUEST_ID)).toBe('available');
  });
});
