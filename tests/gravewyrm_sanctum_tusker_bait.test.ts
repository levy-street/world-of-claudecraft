// The Sledge Tusker's bait rework (src/sim/encounters/gravewyrm_sanctum/
// sledge_tusker.ts and its siblings tusker_road.ts, tusker_outcrops.ts and
// tusker_trail.ts): a Trample baited into an ice outcrop of the Sledge Road
// buries its tusks in it (Stuck in the Ice: 4 s held, 25 percent more damage
// taken), the hitched sledge leaves a soulfire trail down every charged lane
// until it tips at half health, and the road never closes: a solo player and a
// group of four walk a whole pull on it. On a real claimed Sanctum, on the
// real road.

import { describe, expect, it } from 'vitest';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { handleGravewyrmSanctumDevChat } from '../src/sim/dev/gravewyrm_sanctum_dev';
import {
  inTrail,
  onSledgeRoad,
  outcropObjects,
  outcropsStanding,
  planTrampleLane,
  SANCTUM_DEED_IDS,
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_ICE_OUTCROP_STRUCK,
  SANCTUM_OBJECT_TEMPLATES,
  SANCTUM_OUTCROP_HELD,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  SANCTUM_TRAIL_BURN,
  SLEDGE_TUSKER_ID,
  standingOutcrops,
  TUSKER_TUNING as T,
  TRAIL_DAMAGE_NAME,
  TUSKER_BODY,
  TUSKER_BREAKS_FREE,
  TUSKER_KNOCKDOWN,
  TUSKER_OUTCROPS,
  TUSKER_STUCK,
  TUSKER_STUCK_EXPOSED,
  TUSKER_STUCK_LOG,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
  TUSKER_TUSKS_STICK,
  tickSanctumEncounters,
  trampleAimLocked,
  trampleReach,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type TuskerFightState } from '../src/sim/types';

const DUNGEON = 'gravewyrm_sanctum';

interface Road {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  me: Entity;
  others: Entity[];
  tusker: Entity;
  events: SimEvent[];
}

/** A claimed Sanctum with `extra` party members beside the player; every
 *  pack but the Tusker is dead, so nothing else on the road pulls. */
function road(difficulty: 'normal' | 'heroic' = 'normal', extra = 0): Road {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const me = sim.player;
  sim.chat('/dev level 20', me.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Roadhand${i}`);
    sim.partyInvite(pid, me.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev sanctum enter ${difficulty}`, me.id);
  for (const pid of ids) enterDungeon(sim.ctx, DUNGEON, pid);
  const inst = claimedInstanceAt(sim.ctx, me.pos);
  if (!inst) throw new Error('no sanctum claim');
  let tusker: Entity | null = null;
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (!e || e.dead) continue;
    if (e.templateId === SLEDGE_TUSKER_ID) tusker = e;
    else sim.ctx.handleDeath(e, me);
  }
  if (!tusker) throw new Error('no tusker');
  tusker.dungeonPatrol = undefined;
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [me, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, me, others, tusker, events: [] };
}

function put(r: Road, e: Entity, x: number, z: number): void {
  e.pos = r.sim.ctx.groundPos(r.ox + x, r.oz + z);
  e.prevPos = { ...e.pos };
  r.sim.ctx.grid.update(e);
}

function local(r: Road, e: Entity): { x: number; z: number } {
  return { x: e.pos.x - r.ox, z: e.pos.z - r.oz };
}

function hold(r: Road): void {
  const t = r.tusker;
  if (t.dead) return;
  t.inCombat = true;
  t.aiState = 'attack';
  t.aggroTargetId ??= r.me.id;
}

/** Drive only the encounter (the mob AI never runs: the bodies stand where
 *  the test puts them, and the charge moves the Tusker itself). */
function run(r: Road, seconds: number): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    hold(r);
    tickTrashKits(r.sim.ctx);
    tickSanctumEncounters(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

/** Straight to the handler: the chat seam's rate limit would drop a burst. */
function dev(r: Road, line: string): void {
  handleGravewyrmSanctumDevChat(r.sim.ctx, line, r.me.id);
}

function state(r: Road): TuskerFightState {
  const st = r.tusker.sanctumFight;
  if (st?.kind !== 'tusker') throw new Error('no tusker fight');
  return st;
}

function dealt(r: Road, targetId: number, ability: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === ability,
    )
    .map((e) => e.amount);
}

function objectsOf(r: Road, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e !== undefined && e.templateId === templateId);
}

function fx(r: Road, ability: string): number {
  return r.events.filter((e) => e.type === 'spellfx' && e.ability === ability).length;
}

/** The unit vector from a to b. */
function toward(a: { x: number; z: number }, b: { x: number; z: number }) {
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / d, z: (b.z - a.z) / d, d };
}

/** A spot on the Sledge Road's middle leg: `s` yards down its centre line
 *  from its upper end, `side` yards off it (positive: the rim the fourth
 *  outcrop stands on). */
function leg(s: number, side = 0): { x: number; z: number } {
  const u = toward({ x: -26, z: -137.9 }, { x: 16, z: -116.1 });
  return { x: -26 + u.x * s + u.z * side, z: -137.9 + u.z * s - u.x * side };
}

/** The fourth outcrop (index 3): 24 yd down the middle leg, on its rim. */
const O3 = TUSKER_OUTCROPS[3];
/** On the road's centre line 16 yd up the leg from it: a clear run at it. */
const MID = leg(8);
/** Behind it: further down the leg, tucked in toward the rim. */
const BEHIND = leg(27.5, 4.5);

/** Stand the Tusker at MID and the pulled player behind the fourth outcrop,
 *  the farthest body. Returns the lane the sim should plan. */
function baitSetup(r: Road): { yaw: number } {
  put(r, r.tusker, MID.x, MID.z);
  put(r, r.me, BEHIND.x, BEHIND.z);
  const u = toward(MID, BEHIND);
  const yaw = Math.atan2(u.x, u.z);
  r.tusker.facing = yaw;
  return { yaw };
}

describe('the ice outcrops stand on the Sledge Road', () => {
  it('the test stance is what it says: the fourth outcrop on the rim, a spot behind it on the road', () => {
    expect(Math.hypot(leg(24, 6).x - O3.x, leg(24, 6).z - O3.z)).toBeLessThan(0.2);
    expect(onSledgeRoad(MID.x, MID.z)).toBe(true);
    expect(onSledgeRoad(BEHIND.x, BEHIND.z)).toBe(true);
    expect(Math.hypot(MID.x - O3.x, MID.z - O3.z)).toBeGreaterThan(15);
  });

  it('five of them rise with the claim, whole, before the pull, each on the road rim', () => {
    const r = road();
    expect(outcropObjects(r.sim.ctx, r.inst)).toHaveLength(0);
    // The encounters tick once, with nobody pulled.
    tickSanctumEncounters(r.sim.ctx);
    const outcrops = outcropObjects(r.sim.ctx, r.inst);
    expect(outcrops).toHaveLength(TUSKER_OUTCROPS.length);
    expect(TUSKER_OUTCROPS).toHaveLength(5);
    outcrops.forEach((obj, i) => {
      expect(obj.templateId).toBe(SANCTUM_ICE_OUTCROP);
      expect(obj.kind).toBe('object');
      expect(obj.lootable).toBe(false);
      expect(obj.scale).toBe(T.outcropRadius);
      const at = local(r, obj);
      expect(at.x).toBeCloseTo(TUSKER_OUTCROPS[i].x, 6);
      expect(at.z).toBeCloseTo(TUSKER_OUTCROPS[i].z, 6);
      expect(onSledgeRoad(at.x, at.z)).toBe(true);
      // On the rim: the road ends within 3 yd of it somewhere round it.
      let rim = false;
      for (let a = 0; a < 16; a++) {
        const x = at.x + Math.cos((a / 16) * Math.PI * 2) * 3;
        const z = at.z + Math.sin((a / 16) * Math.PI * 2) * 3;
        if (!onSledgeRoad(x, z)) rim = true;
      }
      expect(rim, `outcrop ${i} stands on the rim`).toBe(true);
    });
    // Raised once: a second tick adds none.
    tickSanctumEncounters(r.sim.ctx);
    expect(outcropObjects(r.sim.ctx, r.inst)).toHaveLength(5);
    // Never loot, however long the claim stands.
    run(r, 2);
    for (const obj of outcropObjects(r.sim.ctx, r.inst)) expect(obj.lootable).toBe(false);
  });

  it('they wait for a player near the road: a claim fought far off mints none (the parity ids)', () => {
    const r = road();
    // The whole party across the cirque at the Gravewyrm's lake, and the
    // Tusker pulled onto one of them from afar: no outcrop rises.
    put(r, r.me, 0, 152);
    hold(r);
    for (let i = 0; i < 5; i++) tickSanctumEncounters(r.sim.ctx);
    expect(outcropObjects(r.sim.ctx, r.inst)).toHaveLength(0);
    // Back at the Gate Landing (68 yd from the nearest): they rise.
    expect(Math.hypot(0 - TUSKER_OUTCROPS[0].x, -224 - TUSKER_OUTCROPS[0].z)).toBeLessThan(
      T.outcropWake,
    );
    put(r, r.me, 0, -224);
    tickSanctumEncounters(r.sim.ctx);
    expect(outcropObjects(r.sim.ctx, r.inst)).toHaveLength(5);
  });

  it('every state of an outcrop and the trail are templates the Sanctum draws itself', () => {
    for (const id of [
      SANCTUM_ICE_OUTCROP,
      SANCTUM_ICE_OUTCROP_STRUCK,
      SANCTUM_ICE_OUTCROP_BROKEN,
      SANCTUM_SOULFIRE_TRAIL,
    ])
      expect(SANCTUM_OBJECT_TEMPLATES.has(id), id).toBe(true);
  });

  it('stand clear of the layout: no prop within 4 yd, the floor level under each', () => {
    for (const spot of TUSKER_OUTCROPS) {
      const h = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, spot.x, spot.z);
      expect(h).toBeGreaterThan(41.5);
      for (const prop of GRAVEWYRM_SANCTUM_FIELD.props ?? []) {
        const reach = 'r' in prop && prop.r !== undefined ? prop.r : 2;
        expect(Math.hypot(prop.x - spot.x, prop.z - spot.z) - reach).toBeGreaterThan(4);
      }
    }
  });
});

describe('the lane plan (pure)', () => {
  const spots = TUSKER_OUTCROPS.map((o, i) => ({ id: 100 + i, x: o.x, z: o.z }));

  it('a lane with no outcrop in it is the lane it always was', () => {
    const yaw = Math.atan2(1, 0.5);
    const lane = planTrampleLane(MID.x, MID.z, yaw, []);
    expect(lane.outcropId).toBeNull();
    expect(lane.length).toBe(trampleReach(MID.x, MID.z, yaw, T.trampleLength));
    expect(lane.reach).toBe(lane.length + TUSKER_BODY);
  });

  it('a lane through an outcrop stops with the tusks in it and strikes no further than its middle', () => {
    const u = toward(MID, O3);
    const lane = planTrampleLane(MID.x, MID.z, Math.atan2(u.x, u.z), spots);
    expect(lane.outcropId).toBe(103);
    const face = u.d - T.outcropRadius;
    expect(lane.length).toBeCloseTo(face - T.tuskReach, 6);
    expect(lane.reach).toBeCloseTo(u.d, 6);
    // The beast stops short of the outcrop, its tusk tips just past the face.
    expect(lane.length + T.tuskReach).toBeLessThanOrEqual(u.d);
  });

  it('touching counts: the strip only has to brush the outcrop (4.5 yd off the line)', () => {
    // Lanes straight down the leg, parallel to its centre line: the outcrop
    // stands 6 yd off that line.
    const down = toward(leg(0), leg(10));
    const yaw = Math.atan2(down.x, down.z);
    const limit = T.trampleHalfWidth + T.outcropRadius;
    expect(limit).toBe(4.5);
    const brushes = leg(4, 6 - limit + 0.2);
    const misses = leg(4, 6 - limit - 0.2);
    expect(planTrampleLane(brushes.x, brushes.z, yaw, spots).outcropId).toBe(103);
    expect(planTrampleLane(misses.x, misses.z, yaw, spots).outcropId).toBeNull();
    // Down the very middle of the road it misses: the bait has to be aimed.
    expect(planTrampleLane(leg(4).x, leg(4).z, yaw, spots).outcropId).toBeNull();
  });

  it('it needs a run-up: an outcrop beside its head is no bait', () => {
    const u = toward(MID, O3);
    const yaw = Math.atan2(u.x, u.z);
    // Its centre this far from the outcrop's face: under and over the run-up.
    const from = (gap: number) => ({
      x: O3.x - u.x * (gap + T.outcropRadius),
      z: O3.z - u.z * (gap + T.outcropRadius),
    });
    const close = from(T.tuskReach + T.baitMinRun - 0.5);
    const ok = from(T.tuskReach + T.baitMinRun + 0.5);
    expect(planTrampleLane(close.x, close.z, yaw, spots).outcropId).toBeNull();
    expect(planTrampleLane(ok.x, ok.z, yaw, spots).outcropId).toBe(103);
  });

  it('the nearest outcrop along the lane wins, and one across the crevasse never counts', () => {
    // From the upper leg's top straight at the second outcrop: the first
    // stands off this line, the second on it.
    const from = { x: -7, z: -166.5 };
    const u = toward(from, TUSKER_OUTCROPS[1]);
    const lane = planTrampleLane(from.x, from.z, Math.atan2(u.x, u.z), spots);
    expect(lane.outcropId).toBe(101);
    // From the upper leg at the fourth outcrop, across the gulf between the
    // legs: the lane stops at the crevasse and meets nothing.
    const across = toward(from, O3);
    const gulf = planTrampleLane(from.x, from.z, Math.atan2(across.x, across.z), spots);
    expect(gulf.outcropId).toBeNull();
    expect(gulf.length).toBeLessThan(across.d - 10);
  });
});

/** Across the road from BEHIND: a lane from MID to here misses the outcrop. */
const OPEN = leg(27.5, -5);

/** Run until the Trample's lane locks (its bar's last trampleLock seconds). */
function runToLock(r: Road): void {
  for (let i = 0; i < 200 && !trampleAimLocked(r.tusker.castRemaining); i++) run(r, DT);
}

describe('the Trample follows its target until the lock (the readability pass)', () => {
  it('the bar runs 3 s and its lane locks for the last 0.9 s', () => {
    expect(T.trampleCast).toBe(3);
    expect(T.trampleLock).toBe(0.9);
    expect(T.trampleLock).toBeGreaterThanOrEqual(0.6);
    expect(T.trampleLock).toBeLessThanOrEqual(1);
    // Steering time: a few yards at a run, at least.
    expect((T.trampleCast - T.trampleLock) * RUN_SPEED).toBeGreaterThan(12);
    expect(trampleAimLocked(T.trampleCast)).toBe(false);
    expect(trampleAimLocked(T.trampleLock + 0.05)).toBe(false);
    expect(trampleAimLocked(T.trampleLock)).toBe(true);
    expect(trampleAimLocked(0)).toBe(true);
  });

  it('before the lock the lane turns to follow its target onto an outcrop', () => {
    const r = road();
    put(r, r.tusker, MID.x, MID.z);
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleFirst + 0.05);
    expect(r.tusker.castingAbility).toBe(TUSKER_TRAMPLE);
    expect(r.tusker.castTargetId).toBe(r.me.id);
    const st = state(r);
    // Opened on the open side of the road: no outcrop in the lane.
    expect(st.lane?.outcropId).toBeNull();
    const yaw0 = st.lane?.yaw ?? 0;
    // The target walks behind the fourth outcrop while the lane still aims.
    put(r, r.me, BEHIND.x, BEHIND.z);
    run(r, 0.1);
    expect(trampleAimLocked(r.tusker.castRemaining)).toBe(false);
    const u = toward(MID, BEHIND);
    const outcrop = outcropObjects(r.sim.ctx, r.inst)[3];
    expect(st.lane?.yaw).toBeCloseTo(Math.atan2(u.x, u.z), 6);
    expect(st.lane?.yaw).not.toBeCloseTo(yaw0, 3);
    expect(st.lane?.outcropId).toBe(outcrop.id);
    // The beast turns with it (the mirrored facing the client paints from).
    expect(r.tusker.facing).toBeCloseTo(st.lane?.yaw ?? 0, 9);
    // The lane is the planner's own from the planted spot.
    const plan = planTrampleLane(
      MID.x,
      MID.z,
      Math.atan2(u.x, u.z),
      standingOutcrops(r.sim.ctx, r.inst),
    );
    expect(st.lane?.reach).toBeCloseTo(plan.reach, 6);
    expect(local(r, r.tusker).x).toBeCloseTo(MID.x, 6);
  });

  it('after the lock the lane holds still, whatever its target does', () => {
    const r = road();
    baitSetup(r);
    run(r, T.trampleFirst + 0.05);
    runToLock(r);
    const st = state(r);
    const locked = { ...(st.lane as NonNullable<typeof st.lane>) };
    expect(locked.outcropId).not.toBeNull();
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleLock - 0.2);
    expect(r.tusker.castingAbility).toBe(TUSKER_TRAMPLE);
    expect(st.lane).toEqual(locked);
    expect(r.tusker.facing).toBeCloseTo(locked.yaw, 9);
  });

  it('the locked lane decides the bait: led into the ice it sticks, though the target stepped off', () => {
    const r = road();
    put(r, r.tusker, MID.x, MID.z);
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleFirst + 0.05);
    // Lead it behind the outcrop before the lock, then step away after it.
    put(r, r.me, BEHIND.x, BEHIND.z);
    runToLock(r);
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleLock + T.trampleRun + 0.2);
    const st = state(r);
    expect(st.baits).toBe(1);
    expect(st.stuck).not.toBeNull();
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(0);
  });

  it('the locked lane decides the miss: led off the ice before the lock, no bait', () => {
    const r = road();
    baitSetup(r);
    run(r, T.trampleFirst + 0.05);
    expect(state(r).lane?.outcropId).not.toBeNull();
    // The target walks off to open road while it still aims: the lane follows.
    put(r, r.me, OPEN.x, OPEN.z);
    runToLock(r);
    const st = state(r);
    expect(st.lane?.outcropId).toBeNull();
    // They sidestep the locked lane (out of its strip) and it runs on past.
    const u = toward(MID, OPEN);
    put(r, r.me, OPEN.x + u.z * 6, OPEN.z - u.x * 6);
    run(r, T.trampleLock + T.trampleRun + 0.2);
    expect(st.baits).toBe(0);
    expect(st.stuck).toBeNull();
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(5);
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(0);
  });

  it('a target standing still in the locked lane is still run over (the lock is a dodge, not a pass)', () => {
    const r = road();
    put(r, r.tusker, MID.x, MID.z);
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleFirst + 0.05);
    const st = state(r);
    expect(st.lane?.outcropId).toBeNull();
    run(r, T.trampleCast + 0.1);
    expect(st.lane).toBeNull();
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(1);
  });

  it('a target who leaves the claim leaves the lane where it last pointed', () => {
    const r = road();
    baitSetup(r);
    run(r, T.trampleFirst + 0.05);
    const st = state(r);
    const before = { ...(st.lane as NonNullable<typeof st.lane>) };
    // Ported out: far outside the instance (still alive, still an entity).
    r.me.pos = { x: r.ox + 5000, y: r.me.pos.y, z: r.oz + 5000 };
    r.me.prevPos = { ...r.me.pos };
    run(r, 0.3);
    expect(trampleAimLocked(r.tusker.castRemaining)).toBe(false);
    expect(st.lane).toEqual(before);
  });

  it('a target who dies leaves the lane where it last pointed', () => {
    const r = road();
    baitSetup(r);
    run(r, T.trampleFirst + 0.05);
    const st = state(r);
    const before = { ...(st.lane as NonNullable<typeof st.lane>) };
    // Dead where the lane pointed, then dragged across the road: a corpse
    // steers nothing.
    r.me.hp = 0;
    r.me.dead = true;
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, 0.3);
    expect(trampleAimLocked(r.tusker.castRemaining)).toBe(false);
    expect(st.lane).toEqual(before);
  });

  it('draws nothing from the shared rng while it aims', () => {
    const r = road();
    put(r, r.tusker, MID.x, MID.z);
    put(r, r.me, OPEN.x, OPEN.z);
    run(r, T.trampleFirst + 0.05);
    expect(r.tusker.castingAbility).toBe(TUSKER_TRAMPLE);
    // Count every draw while the target walks the whole aim.
    const rng = r.sim.ctx.rng as unknown as Record<string, (...a: unknown[]) => unknown>;
    let draws = 0;
    for (const key of ['next', 'range', 'int', 'chance', 'pick']) {
      const fn = rng[key];
      if (typeof fn !== 'function') continue;
      rng[key] = (...args: unknown[]) => {
        draws++;
        return fn.apply(rng, args);
      };
    }
    const yaws = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const k = i / 19;
      put(r, r.me, OPEN.x + (BEHIND.x - OPEN.x) * k, OPEN.z + (BEHIND.z - OPEN.z) * k);
      run(r, DT);
      yaws.add(state(r).lane?.yaw ?? 0);
    }
    // It really aimed (the lane turned with every step) and drew nothing.
    expect(yaws.size).toBeGreaterThan(10);
    expect(draws).toBe(0);
  });
});

describe('a baited Trample', () => {
  it('the lane ends in the outcrop, the player behind it is not struck, and the tusks stick', () => {
    const r = road();
    const { yaw } = baitSetup(r);
    run(r, T.trampleFirst + 0.05);
    expect(r.tusker.castingAbility).toBe(TUSKER_TRAMPLE);
    expect(r.tusker.castTargetId).toBe(r.me.id);
    const st = state(r);
    const outcrop = outcropObjects(r.sim.ctx, r.inst)[3];
    expect(st.lane?.outcropId).toBe(outcrop.id);
    const plan = planTrampleLane(MID.x, MID.z, yaw, standingOutcrops(r.sim.ctx, r.inst));
    expect(st.lane?.length).toBeCloseTo(plan.length, 6);
    expect(st.lane?.reach).toBeCloseTo(plan.reach, 6);
    // The lane stops short of the player hiding behind the outcrop.
    const me = toward(MID, BEHIND);
    expect(plan.reach).toBeLessThan(me.d);
    const from = { ...r.tusker.pos };
    run(r, T.trampleCast + 0.05);
    // Launched: nobody was in the lane this side of the outcrop.
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(0);
    expect(st.trampleLanded).toBe(false);
    run(r, T.trampleRun + 0.1);
    // It ran the planned lane and stopped with its tusk tips in the outcrop.
    const ran = Math.hypot(r.tusker.pos.x - from.x, r.tusker.pos.z - from.z);
    expect(ran).toBeCloseTo(plan.length, 2);
    expect(ran).toBeGreaterThan(5);
    const at = local(r, r.tusker);
    const tips = { x: at.x + Math.sin(yaw) * T.tuskReach, z: at.z + Math.cos(yaw) * T.tuskReach };
    expect(Math.hypot(tips.x - O3.x, tips.z - O3.z)).toBeLessThanOrEqual(
      T.outcropRadius + T.trampleHalfWidth + 0.01,
    );
    expect(st.stuck?.outcropId).toBe(outcrop.id);
    expect(st.baits).toBe(1);
    expect(outcrop.templateId).toBe(SANCTUM_ICE_OUTCROP_STRUCK);
    expect(outcrop.castingAbility).toBe(SANCTUM_OUTCROP_HELD);
    expect(outcrop.castTotal).toBe(T.stuckSeconds);
    expect(fx(r, TUSKER_TUSKS_STICK)).toBe(1);
    expect(r.events.some((e) => e.type === 'log' && e.text === TUSKER_STUCK_LOG)).toBe(true);
    // The player behind stands where they stood.
    expect(local(r, r.me).x).toBeCloseTo(BEHIND.x, 3);
  });

  it('Stuck in the Ice: 4 s held fast, no swing, no bar, and 25 percent more damage taken', () => {
    const r = road();
    baitSetup(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + T.trampleRun + 0.15);
    const st = state(r);
    expect(st.stuck).not.toBeNull();
    const stun = r.tusker.auras.find((a) => a.id === TUSKER_STUCK);
    const exposed = r.tusker.auras.find((a) => a.id === TUSKER_STUCK_EXPOSED);
    expect(stun?.kind).toBe('stun');
    expect(exposed?.kind).toBe('vulnerability');
    expect(exposed?.value).toBe(T.stuckVuln);
    expect(T.stuckSeconds).toBe(4);
    expect(T.stuckVuln).toBe(0.25);
    expect(r.sim.ctx.isStunned(r.tusker)).toBe(true);
    // A plain hit lands a quarter harder for the window.
    const hit = () => {
      const before = r.tusker.hp;
      r.sim.ctx.dealDamage(r.me, r.tusker, 1000, false, 'holy', 'Test', 'hit', true);
      return before - r.tusker.hp;
    };
    expect(hit()).toBe(1250);
    // Held: it neither moves nor opens a bar for the whole window, though its
    // Tusk Sweep came due long ago.
    const held = { ...r.tusker.pos };
    st.sweepTimer = 0;
    run(r, T.stuckSeconds - 0.6);
    expect(st.stuck).not.toBeNull();
    expect(r.tusker.castingAbility).toBeNull();
    expect(r.tusker.pos.x).toBe(held.x);
    expect(r.tusker.pos.z).toBe(held.z);
    expect(hit()).toBe(1250);
    // It wrenches free: the outcrop bursts, the window closes.
    run(r, 0.6);
    expect(st.stuck).toBeNull();
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK)).toBe(false);
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK_EXPOSED)).toBe(false);
    expect(hit()).toBe(1000);
    const outcrop = outcropObjects(r.sim.ctx, r.inst)[3];
    expect(outcrop.templateId).toBe(SANCTUM_ICE_OUTCROP_BROKEN);
    expect(outcrop.castingAbility).toBeNull();
    expect(fx(r, TUSKER_BREAKS_FREE)).toBe(1);
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(4);
    // It takes a breath before its next strike.
    expect(st.sweepTimer).toBeGreaterThanOrEqual(T.stuckRecover - DT * 2);
    expect(r.tusker.castingAbility).toBeNull();
  });

  it('an outcrop takes one charge: the next lane through its stump runs on', () => {
    const r = road();
    baitSetup(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + T.trampleRun + T.stuckSeconds + 0.3);
    expect(outcropObjects(r.sim.ctx, r.inst)[3].templateId).toBe(SANCTUM_ICE_OUTCROP_BROKEN);
    // The same stance again: the stump is no bait.
    baitSetup(r);
    dev(r, '/dev sanctum trigger trample');
    const st = state(r);
    expect(st.lane?.outcropId).toBeNull();
    expect(standingOutcrops(r.sim.ctx, r.inst).some((o) => o.id === st.lane?.outcropId)).toBe(
      false,
    );
  });

  it('a body in the lane this side of the outcrop is still run over', () => {
    const r = road('normal', 1);
    baitSetup(r);
    // The second player stands in the lane, halfway to the outcrop.
    const u = toward(MID, BEHIND);
    put(r, r.others[0], MID.x + u.x * 7, MID.z + u.z * 7);
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    const hits = dealt(r, r.others[0].id, 'Trample');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(T.trampleMin);
    expect(hits[0]).toBeLessThanOrEqual(T.trampleMax);
    expect(r.others[0].auras.some((a) => a.id === TUSKER_KNOCKDOWN)).toBe(true);
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(0);
    expect(state(r).trampleLanded).toBe(true);
  });

  it('a charge that meets no outcrop behaves as it always did', () => {
    const r = road();
    // Along the middle leg's centre line, away from every outcrop's reach.
    put(r, r.tusker, -22, -135.9);
    const along = toward({ x: -26, z: -137.9 }, { x: 16, z: -116.1 });
    put(r, r.me, -22 + along.x * 20, -135.9 + along.z * 20);
    r.tusker.facing = Math.atan2(along.x, along.z);
    run(r, T.trampleFirst + 0.05);
    const st = state(r);
    expect(st.lane?.outcropId).toBeNull();
    expect(st.lane?.length).toBe(T.trampleLength);
    run(r, T.trampleCast + 0.05);
    const hits = dealt(r, r.me.id, 'Trample');
    expect(hits).toHaveLength(1);
    run(r, T.trampleRun + 0.1);
    expect(st.stuck).toBeNull();
    expect(st.baits).toBe(0);
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(5);
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK)).toBe(false);
  });

  it('a wipe stands every outcrop up again; a kill leaves them as they fell', () => {
    const r = road();
    baitSetup(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + T.trampleRun + 1);
    expect(state(r).stuck).not.toBeNull();
    // It evades mid-window.
    r.tusker.inCombat = false;
    r.tusker.aggroTargetId = null;
    r.tusker.aiState = 'evade';
    tickSanctumEncounters(r.sim.ctx);
    expect(r.tusker.sanctumFight).toBeUndefined();
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(5);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(0);
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK)).toBe(false);
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK_EXPOSED)).toBe(false);
    for (const obj of outcropObjects(r.sim.ctx, r.inst)) expect(obj.castingAbility).toBeNull();

    // A kill while its tusks are in: that outcrop bursts and stays burst.
    const k = road();
    baitSetup(k);
    run(k, T.trampleFirst + T.trampleCast + T.trampleRun + 1);
    expect(state(k).stuck).not.toBeNull();
    k.sim.ctx.handleDeath(k.tusker, k.me);
    run(k, 0.2);
    expect(outcropObjects(k.sim.ctx, k.inst)[3].templateId).toBe(SANCTUM_ICE_OUTCROP_BROKEN);
    expect(outcropsStanding(k.sim.ctx, k.inst)).toBe(4);
  });

  it('a stuck beast still wrenches free while the fight pauses on a lost target', () => {
    const r = road();
    baitSetup(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + T.trampleRun + 0.2);
    const st = state(r);
    expect(st.stuck).not.toBeNull();
    for (let k = 0; k < (T.stuckSeconds + 0.5) / DT; k++) {
      r.tusker.inCombat = true;
      r.tusker.aiState = 'chase';
      r.tusker.aggroTargetId = null;
      tickSanctumEncounters(r.sim.ctx);
    }
    expect(st.stuck).toBeNull();
    expect(outcropObjects(r.sim.ctx, r.inst)[3].templateId).toBe(SANCTUM_ICE_OUTCROP_BROKEN);
  });
});

describe('the soulfire trail', () => {
  /** A plain 30 yd charge down the middle leg from its upper end. */
  function plainCharge(r: Road): { start: { x: number; z: number }; yaw: number } {
    const start = { x: -22, z: -135.9 };
    put(r, r.tusker, start.x, start.z);
    const along = toward({ x: -26, z: -137.9 }, { x: 16, z: -116.1 });
    put(r, r.me, start.x + along.x * 34, start.z + along.z * 34);
    const yaw = Math.atan2(along.x, along.z);
    r.tusker.facing = yaw;
    return { start, yaw };
  }

  it('the hitched sledge lays one down the lane the beast ran, as the charge sets off', () => {
    const r = road();
    const { start, yaw } = plainCharge(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast - 0.1);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(0);
    run(r, 0.2);
    const [trail] = objectsOf(r, SANCTUM_SOULFIRE_TRAIL);
    expect(trail).toBeDefined();
    const at = local(r, trail);
    expect(at.x).toBeCloseTo(start.x, 3);
    expect(at.z).toBeCloseTo(start.z, 3);
    expect(trail.facing).toBeCloseTo(yaw, 6);
    expect(trail.scale).toBe(T.trampleLength);
    expect(trail.lootable).toBe(false);
    expect(trail.castingAbility).toBe(SANCTUM_TRAIL_BURN);
    expect(trail.castTotal).toBe(T.trailSeconds);
    const st = state(r);
    expect(st.trails).toHaveLength(1);
    expect(st.trails[0].length).toBe(T.trampleLength);
  });

  it('burns whoever stands in the strip each second, at the spilled patches rate, and nobody beside it', () => {
    const r = road('normal', 2);
    const { start, yaw } = plainCharge(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const mid = { x: start.x + Math.sin(yaw) * 12, z: start.z + Math.cos(yaw) * 12 };
    // One player in the strip's middle, one just outside its edge.
    put(r, r.others[0], mid.x, mid.z);
    put(
      r,
      r.others[1],
      mid.x + side.x * (T.trailHalfWidth + 0.4),
      mid.z + side.z * (T.trailHalfWidth + 0.4),
    );
    // The far player baits the lane and then steps out of it.
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    put(r, r.me, start.x + Math.sin(yaw) * 34 + side.x * 6, start.z + Math.cos(yaw) * 34);
    r.events.length = 0;
    run(r, 3.05);
    const burns = dealt(r, r.others[0].id, TRAIL_DAMAGE_NAME);
    expect(burns).toHaveLength(3);
    for (const b of burns) {
      expect(b).toBeGreaterThanOrEqual(T.patchMin);
      expect(b).toBeLessThanOrEqual(T.patchMax);
    }
    expect(dealt(r, r.others[1].id, TRAIL_DAMAGE_NAME)).toHaveLength(0);
    expect(dealt(r, r.me.id, TRAIL_DAMAGE_NAME)).toHaveLength(0);
    expect(T.trailHalfWidth).toBeLessThan(T.trampleHalfWidth);
  });

  it('a trampled player takes the Trample and one tick of the trail: what a Trample cost before', () => {
    const r = road();
    const { start, yaw } = plainCharge(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    // The player stands in the lane's middle and is run over.
    put(r, r.me, start.x + Math.sin(yaw) * 20, start.z + Math.cos(yaw) * 20);
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    expect(dealt(r, r.me.id, 'Trample')).toHaveLength(1);
    // Knocked down for 1 s in the burning lane: the first tick lands.
    run(r, T.knockdown + 0.05);
    expect(dealt(r, r.me.id, TRAIL_DAMAGE_NAME)).toHaveLength(1);
    // The budget: the old Trample band against the new one plus one tick.
    expect(T.trampleMin + T.patchMin).toBe(196);
    expect(T.trampleMax + T.patchMax).toBe(244);
    expect(Math.abs(T.trampleMin + T.patchMin - 200)).toBeLessThanOrEqual(4);
    expect(Math.abs(T.trampleMax + T.patchMax - 240)).toBeLessThanOrEqual(4);
    const total = dealt(r, r.me.id, 'Trample')[0] + dealt(r, r.me.id, TRAIL_DAMAGE_NAME)[0];
    expect(total).toBeGreaterThanOrEqual(196);
    expect(total).toBeLessThanOrEqual(244);
  });

  it('goes out after 30 s, and its clock rides the object', () => {
    const r = road();
    plainCharge(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    expect(T.trailSeconds).toBe(30);
    const [trail] = objectsOf(r, SANCTUM_SOULFIRE_TRAIL);
    run(r, 10);
    expect(trail.castRemaining).toBeGreaterThan(T.trailSeconds - 10.3);
    expect(trail.castRemaining).toBeLessThan(T.trailSeconds - 9.9);
    // Park its clocks so no second trail is laid meanwhile.
    state(r).trampleTimer = 999;
    run(r, T.trailSeconds - 10.3);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(1);
    run(r, 0.4);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(0);
    expect(state(r).trails).toHaveLength(0);
  });

  it('two trails at most ever burn at once', () => {
    expect(T.trailSeconds).toBeLessThan(2 * T.trampleEvery);
    const r = road();
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    plainCharge(r);
    run(r, 0.1);
    let most = 0;
    for (let i = 0; i < 6; i++) {
      plainCharge(r);
      dev(r, '/dev sanctum trigger trample');
      // The dev trigger starts the bar; let it land, then wait out the cadence.
      for (let t = 0; t < T.trampleEvery; t += 1) {
        state(r).trampleTimer = 999;
        state(r).sweepTimer = 999;
        run(r, 1);
        most = Math.max(most, objectsOf(r, SANCTUM_SOULFIRE_TRAIL).length);
      }
    }
    expect(most).toBe(2);
  });

  it('a third trail puts the oldest out: never more than two, whatever lays them', () => {
    expect(T.trailMax).toBe(2);
    expect(T.trailHalfWidth).toBe(2);
    const r = road();
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    plainCharge(r);
    run(r, 0.1);
    state(r).trampleTimer = 999;
    dev(r, '/dev sanctum trigger trail');
    const [first] = objectsOf(r, SANCTUM_SOULFIRE_TRAIL);
    expect(first).toBeDefined();
    dev(r, '/dev sanctum trigger trail');
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(2);
    // The dev trigger ignores the Trample's clock: only the cap holds it.
    dev(r, '/dev sanctum trigger trail');
    const now = objectsOf(r, SANCTUM_SOULFIRE_TRAIL);
    expect(now).toHaveLength(2);
    expect(state(r).trails).toHaveLength(2);
    expect(now.map((e) => e.id)).not.toContain(first.id);
    expect(state(r).trails.map((t) => t.objectId)).not.toContain(first.id);
  });

  it('a baited charge leaves a trail only as far as the beast ran', () => {
    const r = road();
    const { yaw } = baitSetup(r);
    const plan = planTrampleLane(MID.x, MID.z, yaw, [{ id: 1, x: O3.x, z: O3.z }]);
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    const st = state(r);
    const [trail] = objectsOf(r, SANCTUM_SOULFIRE_TRAIL);
    expect(plan.outcropId).toBe(1);
    expect(plan.length).toBeLessThan(T.trampleLength - 10);
    expect(trail.scale).toBeCloseTo(plan.length, 4);
    expect(st.trails[0].length).toBeCloseTo(trail.scale, 6);
    // The player hiding behind the outcrop stands clear of the fire.
    const me = local(r, r.me);
    expect(inTrail(MID.x, MID.z, st.trails[0].yaw, st.trails[0].length, me.x, me.z)).toBe(false);
  });

  it('once the sledge has tipped at half health it charges unladen: no more trails', () => {
    const r = road();
    plainCharge(r);
    run(r, 0.1);
    r.tusker.hp = Math.floor(r.tusker.maxHp * 0.49);
    run(r, 0.1);
    expect(state(r).spilled).toBe(true);
    expect(objectsOf(r, SANCTUM_SOULFIRE_PATCH)).toHaveLength(3);
    r.tusker.hp = Math.floor(r.tusker.maxHp * 0.49);
    run(r, T.trampleFirst + T.trampleCast + T.trampleRun + 0.2);
    expect(state(r).casts).toBeGreaterThan(0);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(0);
  });

  it('keeps burning out after the Tusker falls and while the fight pauses', () => {
    const r = road();
    plainCharge(r);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, T.trampleFirst + T.trampleCast + 0.1);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(1);
    for (let k = 0; k < 5 / DT; k++) {
      r.tusker.inCombat = true;
      r.tusker.aiState = 'chase';
      r.tusker.aggroTargetId = null;
      tickSanctumEncounters(r.sim.ctx);
    }
    expect(state(r).trails[0].remaining).toBeLessThan(T.trailSeconds - 4.9);
    r.sim.ctx.handleDeath(r.tusker, r.me);
    for (let k = 0; k < T.trailSeconds / DT; k++) tickSanctumEncounters(r.sim.ctx);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(0);
    expect(r.tusker.sanctumFight).toBeUndefined();
  });
});

describe('Spilled Braziers after the rework', () => {
  it('the sledge tips where the beast stands at half health, not where it was pulled', () => {
    const r = road();
    put(r, r.tusker, -22, -135.9);
    put(r, r.me, -18, -133.8);
    run(r, 0.2);
    expect(state(r).sledge).toBeNull();
    // Dragged 20 yd down the road before half health.
    put(r, r.tusker, MID.x, MID.z);
    r.tusker.facing = 1;
    r.tusker.hp = Math.floor(r.tusker.maxHp * 0.49);
    run(r, 0.1);
    const st = state(r);
    expect(st.sledge?.x).toBeCloseTo(r.tusker.pos.x, 6);
    expect(st.sledge?.z).toBeCloseTo(r.tusker.pos.z, 6);
    const patches = objectsOf(r, SANCTUM_SOULFIRE_PATCH);
    expect(patches).toHaveLength(3);
    for (const p of patches)
      expect(Math.hypot(p.pos.x - r.tusker.pos.x, p.pos.z - r.tusker.pos.z)).toBeLessThan(16);
  });
});

describe('/dev sanctum trigger: the bait rework', () => {
  it('bait, stick, trail and outcrops each jump to their moment', () => {
    const r = road();
    put(r, r.tusker, MID.x, MID.z);
    put(r, r.me, leg(11).x, leg(11).z);
    r.tusker.maxHp = 1e6;
    r.tusker.hp = 1e6;
    run(r, 0.1);
    const lines = (): string[] =>
      r.events.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text);
    dev(r, '/dev sanctum trigger trail');
    run(r, 0.05);
    expect(objectsOf(r, SANCTUM_SOULFIRE_TRAIL)).toHaveLength(1);
    dev(r, '/dev sanctum trigger bait');
    run(r, 0.05);
    expect(r.tusker.castingAbility).toBe(TUSKER_TRAMPLE);
    expect(state(r).lane?.outcropId).not.toBeNull();
    run(r, T.trampleCast + T.trampleRun + 0.2);
    expect(state(r).stuck).not.toBeNull();
    run(r, T.stuckSeconds + 0.2);
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(4);
    put(r, r.tusker, MID.x, MID.z);
    dev(r, '/dev sanctum trigger stick');
    run(r, 0.05);
    expect(state(r).stuck).not.toBeNull();
    expect(r.tusker.auras.some((a) => a.id === TUSKER_STUCK)).toBe(true);
    run(r, T.stuckSeconds + 0.2);
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(3);
    dev(r, '/dev sanctum trigger outcrops');
    run(r, 0.05);
    expect(outcropsStanding(r.sim.ctx, r.inst)).toBe(5);
    expect(lines().some((l) => l.includes('Every ice outcrop stands whole again.'))).toBe(true);
  });
});

// ---- the road never closes: a solo player and a group of four walk a pull ----
//
// A scripted party plays a whole pull on the real road. The encounter is the
// real one, ticked as the dungeon ticks it; the walking is scripted at the
// bodies' own speeds (the whole-world sim.tick costs about 10 ms a tick, and a
// pull is thousands): the Tusker walks at its template's 6 yd a second toward
// its tank and stops at its reach, as its chase does, and the players walk at
// a player's run speed, never faster. They follow four plain rules a real
// group follows:
//   1. in a painted Trample lane: step out of it sideways;
//   2. in a Tusk Sweep's cone: step round to its flank;
//   3. on burning ground: step to the nearest ground that is not burning;
//   4. otherwise: the baiter stands so the nearest ice outcrop is in the line
//      of the charge (behind it in a group; alone, between the beast and the
//      outcrop, stepping aside when the lane is painted).
// Every tick the suite checks that every player HAS safe ground in reach, and
// at the end that every outcrop was reachable (all five baited), that nobody
// was ever trampled and that the deed was earned.

const RUN_SPEED = 7;
const LEGS = [
  { p: { x: -6, z: -168.5 }, q: { x: -30, z: -150.5 } },
  { p: { x: -26, z: -137.9 }, q: { x: 16, z: -116.1 } },
] as const;

interface Pt {
  x: number;
  z: number;
}

/** On the road with a stride of floor all round (never on the rim itself). */
function roomy(p: Pt, margin = 0.9): boolean {
  return (
    onSledgeRoad(p.x, p.z) &&
    onSledgeRoad(p.x + margin, p.z) &&
    onSledgeRoad(p.x - margin, p.z) &&
    onSledgeRoad(p.x, p.z + margin) &&
    onSledgeRoad(p.x, p.z - margin)
  );
}

/** Is a spot burning (a trail's strip or a spilled patch, with a small margin)? */
function burning(r: Road, st: TuskerFightState | null, p: Pt, margin = 0.35): boolean {
  if (!st) return false;
  for (const t of st.trails) {
    const dx = p.x - (t.x - r.ox);
    const dz = p.z - (t.z - r.oz);
    const along = dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw);
    const side = Math.abs(dx * Math.cos(t.yaw) - dz * Math.sin(t.yaw));
    if (along >= -margin && along <= t.length + margin && side <= T.trailHalfWidth + margin)
      return true;
  }
  for (const patch of st.patches)
    if (Math.hypot(p.x - (patch.x - r.ox), p.z - (patch.z - r.oz)) <= T.patchRadius + margin)
      return true;
  return false;
}

/** Is a spot inside the strip a lane strikes (with a margin)? */
function inStrip(
  lane: { x: number; z: number; yaw: number; reach: number },
  p: Pt,
  margin: number,
): boolean {
  const dx = p.x - lane.x;
  const dz = p.z - lane.z;
  const along = dx * Math.sin(lane.yaw) + dz * Math.cos(lane.yaw);
  const side = Math.abs(dx * Math.cos(lane.yaw) - dz * Math.sin(lane.yaw));
  return along >= -margin && along <= lane.reach + margin && side <= T.trampleHalfWidth + margin;
}

/** The nearest roomy spot to `from` that is not burning and passes `ok`,
 *  within `reach` yards; null when there is none. */
function nearestGround(
  r: Road,
  st: TuskerFightState | null,
  from: Pt,
  reach: number,
  ok: (p: Pt) => boolean = () => true,
): Pt | null {
  if (roomy(from) && !burning(r, st, from) && ok(from)) return from;
  for (let d = 0.5; d <= reach + 1e-9; d += 0.5)
    for (let a = 0; a < 24; a++) {
      const p = {
        x: from.x + Math.cos((a / 24) * Math.PI * 2) * d,
        z: from.z + Math.sin((a / 24) * Math.PI * 2) * d,
      };
      if (roomy(p) && !burning(r, st, p) && ok(p)) return p;
    }
  return null;
}

/** The road's centre line, court's foot to lower bend, as one walk. */
const ROAD_LINE: readonly Pt[] = [LEGS[0].p, LEGS[0].q, { x: -36, z: -144 }, LEGS[1].p, LEGS[1].q];

/** How far along ROAD_LINE the spot nearest `p` lies (yards from its start). */
function roadMile(p: Pt): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  let walked = 0;
  for (let i = 0; i + 1 < ROAD_LINE.length; i++) {
    const u = toward(ROAD_LINE[i], ROAD_LINE[i + 1]);
    const s = Math.max(
      0,
      Math.min(u.d, (p.x - ROAD_LINE[i].x) * u.x + (p.z - ROAD_LINE[i].z) * u.z),
    );
    const d = Math.hypot(p.x - ROAD_LINE[i].x - u.x * s, p.z - ROAD_LINE[i].z - u.z * s);
    if (d < bestD) {
      bestD = d;
      best = walked + s;
    }
    walked += u.d;
  }
  return best;
}

/** The spot on ROAD_LINE `mile` yards along it. */
function roadAt(mile: number): Pt {
  let left = Math.max(0, mile);
  for (let i = 0; i + 1 < ROAD_LINE.length; i++) {
    const u = toward(ROAD_LINE[i], ROAD_LINE[i + 1]);
    if (left <= u.d || i + 2 === ROAD_LINE.length)
      return {
        x: ROAD_LINE[i].x + u.x * Math.min(left, u.d),
        z: ROAD_LINE[i].z + u.z * Math.min(left, u.d),
      };
    left -= u.d;
  }
  return ROAD_LINE[ROAD_LINE.length - 1];
}

/** Is the straight walk from a to b on the road the whole way? */
function straightOnRoad(a: Pt, b: Pt): boolean {
  const u = toward(a, b);
  for (let d = 1; d < u.d; d += 1) if (!onSledgeRoad(a.x + u.x * d, a.z + u.z * d)) return false;
  return true;
}

/** Where to head this tick to get from a to b: straight there when the road
 *  allows it, else down the road's centre line toward it (round the bend). */
function wayTo(a: Pt, b: Pt): Pt {
  if (straightOnRoad(a, b)) return b;
  const from = roadMile(a);
  const to = roadMile(b);
  return roadAt(from + Math.sign(to - from) * 5);
}

/** A point on the road's centre line 16 yd along it from the outcrop (toward
 *  the longer side of its own leg): where a tank holds the beast. */
function holdPoint(o: Pt): Pt {
  let best: Pt = o;
  let bestD = Number.POSITIVE_INFINITY;
  for (const leg of LEGS) {
    const u = toward(leg.p, leg.q);
    const s = (o.x - leg.p.x) * u.x + (o.z - leg.p.z) * u.z;
    const c = Math.max(0, Math.min(u.d, s));
    const d = Math.hypot(o.x - leg.p.x - u.x * c, o.z - leg.p.z - u.z * c);
    if (d >= bestD) continue;
    bestD = d;
    const to = c >= u.d / 2 ? c - 16 : c + 16;
    best = { x: leg.p.x + u.x * to, z: leg.p.z + u.z * to };
  }
  return best;
}

interface Walk {
  /** Tramples that opened while an outcrop still stood, and how many of those
   *  ran into one. */
  tramplesWithOutcrop: number;
  baited: number;
  tramples: number;
  trampled: number;
  /** The most burning ticks any one player took. */
  burns: number;
  mostTrails: number;
  /** The least safe ground any player had in reach, in yards away (0: stood
   *  on it already). */
  farthestSafe: number;
  seconds: number;
  deed: boolean;
  dead: boolean;
}

/** Play one whole pull with the scripted party. `dps` is what the party deals
 *  the Tusker each second (through the real damage seam). */
function walkPull(extra: number, dps: number, limit: number): Walk {
  const r = road('normal', extra);
  const ctx = r.sim.ctx;
  const t = r.tusker;
  const party = [r.me, ...r.others];
  const solo = extra === 0;
  const baiter = solo ? r.me : r.others[r.others.length - 1];
  // The pull: the party at the court's foot, the beast on the upper leg.
  put(r, t, -9.2, -166.1);
  for (const [i, p] of party.entries()) put(r, p, -4 - i * 1.5, -170 + i);
  tickSanctumEncounters(ctx);
  hold(r);
  const out: Walk = {
    tramplesWithOutcrop: 0,
    baited: 0,
    tramples: 0,
    trampled: 0,
    burns: 0,
    mostTrails: 0,
    farthestSafe: 0,
    seconds: 0,
    deed: false,
    dead: false,
  };
  const burned = new Map<number, number>();
  let barSeen = false;
  let lockSeen = false;
  const fight = (): TuskerFightState | null =>
    t.sanctumFight?.kind === 'tusker' ? t.sanctumFight : null;
  // Seconds each player has stood blocked by fire across their way.
  const blocked = new Map<number, number>();
  /** One tick's walk toward `goal`: round burning ground, never into it. A
   *  player walled off by a trail for a whole second runs through it (4 yd of
   *  fire is under a second at a run: one tick at most). */
  const step = (e: Entity, goal: Pt): void => {
    const at = local(r, e);
    const via = wayTo(at, goal);
    const d = Math.hypot(via.x - at.x, via.z - at.z);
    if (d < 1e-6) return;
    const len = Math.min(d, RUN_SPEED * DT);
    const base = Math.atan2(via.x - at.x, via.z - at.z);
    const st = fight();
    const inFire = burning(r, st, at, 0.1);
    const waited = blocked.get(e.id) ?? 0;
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1]) {
      const next = { x: at.x + Math.sin(base + turn) * len, z: at.z + Math.cos(base + turn) * len };
      if (!onSledgeRoad(next.x, next.z)) continue;
      if (!inFire && waited < 1 && burning(r, st, next, 0.25)) continue;
      put(r, e, next.x, next.z);
      blocked.set(e.id, turn === 0 && !burning(r, st, next, 0.25) ? 0 : waited);
      return;
    }
    blocked.set(e.id, waited + DT);
  };
  // What each player is walking toward (their plan is redrawn four times a
  // second, as a person re-reads the floor; rules 1 to 3 are read every tick).
  const plans = new Map<number, Pt | null>();
  let frame = 0;
  for (let time = 0; time < limit; time += DT) {
    frame++;
    const st = fight();
    const T0 = local(r, t);
    const standing = t.dead ? [] : standingOutcrops(ctx, r.inst);
    const bar = t.dead ? null : t.castingAbility;
    const lane = st && bar === TUSKER_TRAMPLE ? st.lane : null;
    // A Trample opening: was there an outcrop to bait? And at its lock (the
    // lane follows its target until then): did it take it?
    if (lane && !barSeen) {
      out.tramples++;
      if (standing.length > 0) out.tramplesWithOutcrop++;
    }
    barSeen = lane !== null;
    const locked = lane !== null && trampleAimLocked(t.castRemaining);
    if (locked && !lockSeen && lane.outcropId !== null) out.baited++;
    lockSeen = locked;
    const sweeping = bar === TUSKER_TUSK_SWEEP && st?.sweepYaw != null;
    const inSweep = (p: Pt): boolean => {
      if (!sweeping || st?.sweepYaw == null) return false;
      const dx = p.x - T0.x;
      const dz = p.z - T0.z;
      const d = Math.hypot(dx, dz);
      if (d > T.sweepRange + TUSKER_BODY + 1) return false;
      const cos = (dx * Math.sin(st.sweepYaw) + dz * Math.cos(st.sweepYaw)) / (d || 1);
      return cos >= Math.cos(((T.sweepArcDeg / 2 + 12) * Math.PI) / 180);
    };
    // The outcrop the party plays for: the nearest one down the road (alone,
    // the nearest that still leaves the beast a run-up).
    const mile = roadMile(T0);
    let target: { id: number; x: number; z: number } | null = null;
    let targetScore = Number.POSITIVE_INFINITY;
    for (const o of standing) {
      const gap = Math.abs(roadMile(o) - mile);
      const score = gap < 11 ? 100 - gap : gap;
      if (score < targetScore) {
        target = o;
        targetScore = score;
      }
    }
    const replan = frame % 5 === 1;
    for (const p of party) {
      const at = local(r, p);
      let goal: Pt | null = null;
      if (lane && !locked && p.id === t.castTargetId) {
        // Rule 1a: the lane follows its target until the lock: they lead it
        // (they hold the spot they took to bait it, or keep their plan).
        goal = plans.get(p.id) ?? null;
      } else if (lane) {
        // Rule 1: out of the painted lane, sideways (its target once it locks).
        if (inStrip(lane, at, 0.9))
          goal = nearestGround(r, st, at, 12, (q) => !inStrip(lane, q, 1.3));
        plans.delete(p.id);
      } else if (st?.charge) {
        goal = null;
      } else if (inSweep(at)) {
        // Rule 2: round to its flank.
        goal = nearestGround(r, st, at, 14, (q) => !inSweep(q));
        plans.delete(p.id);
      } else if (!replan && plans.has(p.id)) {
        goal = plans.get(p.id) ?? null;
      } else if (target && !st?.stuck) {
        const dir = toward(T0, target);
        const aimed =
          planTrampleLane(T0.x, T0.z, Math.atan2(dir.x, dir.z), standing).outcropId === target.id;
        if (solo) {
          // Alone: between the beast and the outcrop, on the line to it; out
          // of line (round the bend), lead it to where it has a run at it.
          goal = aimed ? { x: target.x - dir.x * 7, z: target.z - dir.z * 7 } : holdPoint(target);
        } else if (p === baiter) {
          // Behind the outcrop: the nearest roomy spot from which the line of
          // the charge still runs into it, past where the charge strikes.
          const lure = target;
          goal = nearestGround(r, st, { x: lure.x + dir.x * 3, z: lure.z + dir.z * 3 }, 7, (q) => {
            const aim = toward(T0, q);
            const plan = planTrampleLane(T0.x, T0.z, Math.atan2(aim.x, aim.z), standing);
            return plan.outcropId === lure.id && aim.d > plan.reach + 0.6;
          });
          if (!goal) goal = holdPoint(lure);
        } else if (p === r.me) {
          // The tank holds the beast a run-up from the outcrop.
          goal = !aimed || dir.d < 12 || dir.d > 24 ? holdPoint(target) : null;
        } else {
          // The others fight at its flank.
          const k = p === r.others[0] ? 1 : -1;
          goal = nearestGround(
            r,
            st,
            { x: T0.x + Math.cos(t.facing) * 6.5 * k, z: T0.z - Math.sin(t.facing) * 6.5 * k },
            8,
          );
        }
        plans.set(p.id, goal);
      }
      // Rule 3: never stand on burning ground (out of it first, then never
      // toward a spot that burns).
      if (burning(r, st, at, 0.1))
        goal = nearestGround(r, st, at, 12, (q) => !lane || !inStrip(lane, q, 1.3));
      else if (goal && burning(r, st, goal))
        goal = nearestGround(r, st, goal, 12, (q) => !lane || !inStrip(lane, q, 1.3));
      else if (goal === null && !roomy(at))
        goal = nearestGround(r, st, at, 12, (q) => !lane || !inStrip(lane, q, 1.3));
      if (goal) step(p, goal);
      // The check, four times a second: safe ground in reach of this player.
      if (frame % 5 !== 0) continue;
      const here = local(r, p);
      const safe = nearestGround(r, st, here, 12, (q) => !lane || !inStrip(lane, q, 0.3));
      if (!safe) throw new Error(`no safe ground for player ${p.id} at ${time.toFixed(2)} s`);
      out.farthestSafe = Math.max(out.farthestSafe, Math.hypot(safe.x - here.x, safe.z - here.z));
    }
    if (!t.dead && st) ctx.dealDamage(r.me, t, dps * DT, false, 'holy', 'Test', 'hit', true);
    for (const p of party) if (p.hp < 1e6) p.hp = 1e7;
    // The beast's chase: toward its tank at its own speed, to its reach.
    if (!t.dead && bar === null && !st?.charge && !st?.stuck) {
      const tank = local(r, r.me);
      const gap = toward(T0, tank);
      t.facing = Math.atan2(gap.x, gap.z);
      if (gap.d > TUSKER_BODY + 2) {
        const via = wayTo(T0, tank);
        const u = toward(T0, via);
        const k = Math.min(u.d, MOBS[SLEDGE_TUSKER_ID].moveSpeed * DT);
        put(r, t, T0.x + u.x * k, T0.z + u.z * k);
      }
    }
    hold(r);
    tickTrashKits(ctx);
    tickSanctumEncounters(ctx);
    for (const ev of r.sim.drainEvents()) {
      if (ev.type !== 'damage') continue;
      if (ev.ability === 'Trample') out.trampled++;
      if (ev.ability === TRAIL_DAMAGE_NAME || ev.ability === 'Spilled Braziers')
        burned.set(ev.targetId, (burned.get(ev.targetId) ?? 0) + 1);
    }
    out.mostTrails = Math.max(out.mostTrails, fight()?.trails.length ?? 0);
    out.seconds = time;
    if (t.dead) {
      out.dead = true;
      break;
    }
  }
  for (const n of burned.values()) out.burns = Math.max(out.burns, n);
  out.deed = r.sim.players.get(r.me.id)?.deedsEarned.has(SANCTUM_DEED_IDS.sledgeTusker) ?? false;
  return out;
}

describe('the road never closes (a scripted pull on the real road)', () => {
  it('a solo player always has safe ground and a reachable outcrop, and earns Cold Cargo', () => {
    const w = walkPull(0, 45, 400);
    expect(w.dead).toBe(true);
    // Every one of the five outcrops was reached and took its Trample; a few
    // charges opened while the player was still leading the beast to the next.
    expect(w.baited).toBe(5);
    expect(w.tramplesWithOutcrop).toBeLessThanOrEqual(8);
    // And the pull outlasted them: the rest were plain lanes, all dodged.
    expect(w.tramples).toBeGreaterThan(w.tramplesWithOutcrop);
    expect(w.trampled).toBe(0);
    expect(w.deed).toBe(true);
    expect(w.mostTrails).toBe(2);
    // Safe ground was never more than a stride or two away.
    expect(w.farthestSafe).toBeLessThanOrEqual(4.5);
    expect(w.burns).toBeLessThanOrEqual(1);
  });

  it('a group of four always has safe ground and a reachable outcrop, and earns Cold Cargo', () => {
    const w = walkPull(3, 60, 300);
    expect(w.dead).toBe(true);
    expect(w.baited).toBe(5);
    expect(w.tramplesWithOutcrop).toBeLessThanOrEqual(7);
    expect(w.trampled).toBe(0);
    expect(w.deed).toBe(true);
    expect(w.mostTrails).toBeLessThanOrEqual(2);
    expect(w.farthestSafe).toBeLessThanOrEqual(4.5);
    expect(w.burns).toBeLessThanOrEqual(1);
  });

  it('whoever stands in a lane, anywhere on the road, has room to step out of it in the bar', () => {
    // Every lane the road allows: from every 3 yd of both legs, sixteen ways.
    // A bystander the lane stands on through its aim reaches clear road in
    // the bar less a half second to see it. (A lane that swings onto someone
    // on its last aiming tick leaves them only the lock: the next test holds
    // that bound for the hardest spot, the lane's own line.)
    const reach = RUN_SPEED * (T.trampleCast - 0.5);
    let lanes = 0;
    let worst = 0;
    for (const legDef of LEGS) {
      const u = toward(legDef.p, legDef.q);
      for (let s = 2; s <= u.d - 2; s += 3)
        for (const side of [-4, 0, 4]) {
          const from = {
            x: legDef.p.x + u.x * s + u.z * side,
            z: legDef.p.z + u.z * s - u.x * side,
          };
          if (!roomy(from)) continue;
          for (let a = 0; a < 16; a++) {
            const yaw = (a / 16) * Math.PI * 2;
            const lane = planTrampleLane(from.x, from.z, yaw, []);
            if (lane.length < 4) continue;
            lanes++;
            for (let along = 0; along <= lane.reach; along += 2)
              for (const off of [-2.4, 0, 2.4]) {
                const p = {
                  x: from.x + Math.sin(yaw) * along + Math.cos(yaw) * off,
                  z: from.z + Math.cos(yaw) * along - Math.sin(yaw) * off,
                };
                if (!onSledgeRoad(p.x, p.z)) continue;
                let near = Number.POSITIVE_INFINITY;
                for (let d = 0.5; d <= reach && near === Number.POSITIVE_INFINITY; d += 0.5)
                  for (let b = 0; b < 24; b++) {
                    const q = {
                      x: p.x + Math.cos((b / 24) * Math.PI * 2) * d,
                      z: p.z + Math.sin((b / 24) * Math.PI * 2) * d,
                    };
                    if (roomy(q, 0.5) && !inStrip(lane, q, 0.3)) {
                      near = d;
                      break;
                    }
                  }
                expect(
                  near,
                  `lane from ${from.x.toFixed(1)}, ${from.z.toFixed(1)}`,
                ).toBeLessThanOrEqual(reach);
                worst = Math.max(worst, near);
              }
          }
        }
    }
    expect(lanes).toBeGreaterThan(200);
    // In fact a few strides: the road is 14 yd wide and a lane 5.
    expect(worst).toBeLessThanOrEqual(6);
  });

  it('the target, on the lane line when it locks, steps clear inside the lock anywhere on the road', () => {
    // The lane follows its target until the lock, so at the lock they stand
    // on its line. From there clear road (past the half width the charge
    // tests) is within the lock less a quarter second to see it, at a run.
    const reach = RUN_SPEED * (T.trampleLock - 0.25);
    expect(reach).toBeGreaterThan(T.trampleHalfWidth + 1);
    let checked = 0;
    for (const legDef of LEGS) {
      const u = toward(legDef.p, legDef.q);
      for (let s = 2; s <= u.d - 2; s += 3)
        for (const side of [-4, 0, 4]) {
          const from = {
            x: legDef.p.x + u.x * s + u.z * side,
            z: legDef.p.z + u.z * s - u.x * side,
          };
          if (!roomy(from)) continue;
          for (let a = 0; a < 16; a++) {
            const yaw = (a / 16) * Math.PI * 2;
            const lane = planTrampleLane(from.x, from.z, yaw, []);
            if (lane.length < 8) continue;
            // The target 8 yd and more down the line (it is the farthest body).
            for (let along = 8; along <= lane.reach; along += 3) {
              const p = { x: from.x + Math.sin(yaw) * along, z: from.z + Math.cos(yaw) * along };
              if (!onSledgeRoad(p.x, p.z)) continue;
              checked++;
              // Any straight step of that length (most often sideways; by the
              // rim, out past the lane's end or back along the rim).
              let clear = false;
              for (let b = 0; b < 24 && !clear; b++) {
                const q = {
                  x: p.x + Math.cos((b / 24) * Math.PI * 2) * reach,
                  z: p.z + Math.sin((b / 24) * Math.PI * 2) * reach,
                };
                if (straightOnRoad(p, q) && onSledgeRoad(q.x, q.z) && !inStrip(lane, q, 0.3))
                  clear = true;
              }
              expect(clear, `target at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(true);
            }
          }
        }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('same seed, same road', () => {
  it('two runs of the same baited pull agree on every bait, trail, burn and health', () => {
    const play = (): string => {
      const r = road();
      baitSetup(r);
      r.tusker.maxHp = 1e6;
      r.tusker.hp = 1e6;
      // A bait into the ice, its window and burst, then a plain charge whose
      // trail burns (the trail's damage is rolled through the shared rng).
      run(r, T.trampleFirst + T.trampleCast + T.trampleRun + T.stuckSeconds + 1);
      put(r, r.me, OPEN.x, OPEN.z);
      run(r, T.trampleEvery + T.trampleCast + 4);
      const st = state(r);
      const damage = r.events
        .filter((e) => e.type === 'damage')
        .map((e) => (e.type === 'damage' ? `${e.ability}:${e.amount}` : ''));
      return JSON.stringify({
        baits: st.baits,
        trails: st.trails.map((t) => [t.x.toFixed(4), t.z.toFixed(4), t.length.toFixed(4)]),
        hp: [r.tusker.hp, r.me.hp],
        damage,
      });
    };
    const a = play();
    expect(JSON.parse(a).baits).toBe(1);
    expect(play()).toBe(a);
  });
});
