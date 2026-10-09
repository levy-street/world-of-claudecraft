import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  startGhostCaptainMove,
  TURRETBACK_DEED,
  tickGhostCaptain,
} from '../src/sim/encounters/sunken_bastion/ghost_captain';
import {
  GHOST_ANCHOR_DRAG,
  GHOST_ANCHOR_LANE,
  GHOST_BOARDING_LANE,
  GHOST_BROADSIDE_FIRE,
  GHOST_BROADSIDE_LANE,
  GHOST_BROADSIDE_SHIP,
  GHOST_CAPTAIN_ANCHOR,
  GHOST_CAPTAIN_BOARDING,
  GHOST_CAPTAIN_BROADSIDE,
  GHOST_CAPTAIN_ID,
  inGhostLane,
  GHOST_CAPTAIN_TUNING as T,
} from '../src/sim/encounters/sunken_bastion/ghost_captain_ids';
import { DT, type Entity } from '../src/sim/types';
import { boss, earned, engage, fight, live, put, run, tick, took } from './helpers/bastion_fight';

vi.setConfig({ testTimeout: 60_000 });

function setup(difficulty: 'normal' | 'heroic' = 'normal') {
  const f = fight(difficulty, 1, new Set([GHOST_CAPTAIN_ID]));
  const captain = boss(f, GHOST_CAPTAIN_ID);
  put(f, captain, 57, 130);
  put(f, f.tank, 57, 127);
  put(f, f.others[0], 57, 138);
  engage(f, captain);
  tick(f);
  return { f, captain };
}

function placeInLane(
  f: ReturnType<typeof setup>['f'],
  p: Entity,
  lane: Entity,
  distance: number,
  side = 0,
) {
  put(
    f,
    p,
    lane.pos.x - f.ox + Math.sin(lane.facing) * distance + Math.cos(lane.facing) * side,
    lane.pos.z - f.oz + Math.cos(lane.facing) * distance - Math.sin(lane.facing) * side,
  );
}

describe('Shipwreck Captain authoritative encounters', () => {
  it('replaces the shell kit while preserving the health and weapon records', () => {
    const mob = MOBS[GHOST_CAPTAIN_ID];
    expect([mob.hpBase, mob.hpPerLevel, mob.dmgBase, mob.dmgPerLevel]).toEqual([150, 32, 12, 2.8]);
    expect(mob.family).toBe('undead');
    expect(mob.trashKit).toBeUndefined();
    expect(mob.breathCone).toBeUndefined();
    expect(mob.summonAdds).toEqual({ mobId: 'barnacle_crawler', count: 2, atHpPct: [0.6, 0.3] });
  });

  it.each(['normal', 'heroic'] as const)(
    '%s broadside warns first, hits lanes once, and leaves safe gaps',
    (difficulty) => {
      const { f, captain } = setup(difficulty);
      expect(captain.mechanicDamageMult ?? 1).toBe(difficulty === 'heroic' ? 8 : 1);
      expect(startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'broadside')).toBe(true);
      const lanes = live(f, GHOST_BROADSIDE_LANE);
      expect(lanes).toHaveLength(5);
      expect(
        lanes.every(
          (e) => e.castingAbility === GHOST_CAPTAIN_BROADSIDE && e.castTotal === T.broadsideWarning,
        ),
      ).toBe(true);
      const center = lanes[2];
      const ship = live(f, GHOST_BROADSIDE_SHIP)[0];
      const shipLife = T.broadsideWarning + T.flashSeconds;
      expect(ship.castTotal).toBe(shipLife);
      const hold = () => {
        placeInLane(f, f.tank, center, 12);
        placeInLane(f, f.others[0], center, 12, 2.5);
      };
      run(f, T.broadsideWarning - 0.1, hold);
      expect(took(f, f.tank, GHOST_CAPTAIN_BROADSIDE)).toBe(0);
      run(f, 0.2, hold);
      expect(live(f, GHOST_BROADSIDE_FIRE)).toHaveLength(5);
      expect(ship.castTotal).toBe(shipLife);
      expect(ship.castRemaining).toBeLessThanOrEqual(T.flashSeconds);
      const damage = took(f, f.tank, GHOST_CAPTAIN_BROADSIDE);
      expect(damage).toBeGreaterThanOrEqual(difficulty === 'heroic' ? 720 : 90);
      expect(damage).toBeLessThanOrEqual(difficulty === 'heroic' ? 880 : 110);
      expect(took(f, f.others[0], GHOST_CAPTAIN_BROADSIDE)).toBe(0);
      run(f, T.flashSeconds, hold);
      expect(took(f, f.tank, GHOST_CAPTAIN_BROADSIDE)).toBe(damage);
      expect(live(f, GHOST_BROADSIDE_FIRE)).toHaveLength(0);
    },
  );

  it.each(['normal', 'heroic'] as const)(
    '%s anchor locks its launch lane and sweeps back over each victim only once',
    (difficulty) => {
      const { f, captain } = setup(difficulty);
      startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'anchor');
      const lane = live(f, GHOST_ANCHOR_LANE)[0];
      const locked = { ...lane.pos };
      const hold = () => {
        placeInLane(f, f.tank, lane, 5);
        placeInLane(f, f.others[0], lane, 5, 4);
      };
      run(f, T.anchorWarning + 0.3, hold);
      expect(lane.pos).toEqual(locked);
      expect(lane.templateId).toBe(GHOST_ANCHOR_DRAG);
      expect(took(f, f.tank, GHOST_CAPTAIN_ANCHOR)).toBe(0);
      run(f, T.anchorSeconds, hold);
      expect(took(f, f.tank, GHOST_CAPTAIN_ANCHOR)).toBeGreaterThanOrEqual(
        difficulty === 'heroic' ? 400 : 50,
      );
      expect(took(f, f.tank, GHOST_CAPTAIN_ANCHOR)).toBeLessThanOrEqual(
        difficulty === 'heroic' ? 480 : 60,
      );
      expect(
        f.hits.filter((h) => h.targetId === f.tank.id && h.ability === GHOST_CAPTAIN_ANCHOR),
      ).toHaveLength(1);
      expect(took(f, f.others[0], GHOST_CAPTAIN_ANCHOR)).toBe(0);
    },
  );

  it.each(['normal', 'heroic'] as const)(
    '%s boarding gives a stationary saber tell before the captain crosses it',
    (difficulty) => {
      const { f, captain } = setup(difficulty);
      startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'boarding');
      const lane = live(f, GHOST_BOARDING_LANE)[0];
      const start = { ...captain.pos };
      const hold = () => {
        placeInLane(f, f.tank, lane, 4);
        placeInLane(f, f.others[0], lane, 4, 4);
      };
      run(f, T.boardingWarning - 0.1, hold);
      expect(captain.pos.x).toBeCloseTo(start.x);
      expect(captain.pos.z).toBeCloseTo(start.z);
      expect(took(f, f.tank, GHOST_CAPTAIN_BOARDING)).toBe(0);
      run(f, 0.2, hold);
      expect(took(f, f.tank, GHOST_CAPTAIN_BOARDING)).toBeGreaterThanOrEqual(
        difficulty === 'heroic' ? 400 : 50,
      );
      expect(took(f, f.tank, GHOST_CAPTAIN_BOARDING)).toBeLessThanOrEqual(
        difficulty === 'heroic' ? 480 : 60,
      );
      expect(took(f, f.others[0], GHOST_CAPTAIN_BOARDING)).toBe(0);
      expect(Math.hypot(captain.pos.x - start.x, captain.pos.z - start.z)).toBeGreaterThan(1);
    },
  );

  it.each(['evade', 'death', 'wipe', 'cancel'] as const)(
    '%s clears every pending warning without a delayed hit',
    (reason) => {
      const { f, captain } = setup();
      expect(startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'broadside')).toBe(true);
      const owned = [
        ...(captain.bastionFight?.kind === 'ghostCaptain'
          ? (captain.bastionFight.action?.objects ?? [])
          : []),
      ];
      expect(owned).toHaveLength(6);
      if (reason === 'death') captain.dead = true;
      if (reason === 'evade') captain.aiState = 'evade';
      if (reason === 'wipe') for (const p of [f.tank, ...f.others]) p.dead = true;
      if (reason === 'cancel') captain.castingAbility = null;
      tick(f);
      for (const id of owned) {
        expect(f.sim.ctx.entities.has(id)).toBe(false);
        expect(f.inst.objectIds).not.toContain(id);
      }
      run(f, T.broadsideWarning + 0.1);
      expect(f.hits.filter((h) => h.ability === GHOST_CAPTAIN_BROADSIDE)).toHaveLength(0);
    },
  );

  it('keeps the existing deed id, awarded only when the broadside never struck a player', () => {
    expect(TURRETBACK_DEED).toBe('dgn_turretback');
    for (const struck of [false, true]) {
      const { f, captain } = setup();
      const st = captain.bastionFight;
      if (st?.kind !== 'ghostCaptain') throw new Error('captain state missing');
      st.struck = struck;
      captain.dead = true;
      tickGhostCaptain(f.sim.ctx, f.inst, captain, false);
      expect(earned(f, f.tank, TURRETBACK_DEED)).toBe(!struck);
    }
  });

  it('defines rotated flat-ended lanes with no damage beyond their telegraph', () => {
    const lane = { x: 10000, z: 20000, yaw: Math.PI / 2, width: 3, length: 18 };
    expect(inGhostLane(lane, 10004, 20001)).toBe(true);
    expect(inGhostLane(lane, 10004, 20002)).toBe(false);
    expect(inGhostLane(lane, 10019, 20000)).toBe(false);
    expect(inGhostLane(lane, 9999, 20000)).toBe(false);
  });

  it('does not mark players elsewhere in the claim or on a different floor', () => {
    const { f, captain } = setup();
    put(f, f.others[0], 57, 210);
    expect(startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'anchor')).toBe(true);
    expect(captain.castTargetId).toBe(f.tank.id);
    captain.castingAbility = null;
    tickGhostCaptain(f.sim.ctx, f.inst, captain, true);
    put(f, f.others[0], 57, 138);
    f.others[0].pos.y = captain.pos.y + 20;
    expect(startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'boarding')).toBe(true);
    expect(captain.castTargetId).toBe(f.tank.id);
  });

  it('rechecks elevation at impact after a player leaves the warned floor', () => {
    const { f, captain } = setup();
    expect(startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'broadside')).toBe(true);
    const lane = live(f, GHOST_BROADSIDE_LANE)[2];
    const hold = () => {
      placeInLane(f, f.tank, lane, 12);
      placeInLane(f, f.others[0], lane, 12);
    };
    run(f, T.broadsideWarning - DT, hold);
    expect(took(f, f.others[0], GHOST_CAPTAIN_BROADSIDE)).toBe(0);
    // Move only after the warning is established, keeping identical X/Z geometry.
    // The direct encounter tick preserves this test's deliberate floor transition
    // instead of allowing the unrelated player-gravity phase to alter the elevation.
    hold();
    f.others[0].pos.y = captain.pos.y + 20;
    tickGhostCaptain(f.sim.ctx, f.inst, captain, true);
    const damage = f.sim
      .drainEvents()
      .filter((e) => e.type === 'damage' && e.ability === GHOST_CAPTAIN_BROADSIDE);
    expect(
      damage.some((e) => e.type === 'damage' && e.targetId === f.tank.id && e.amount > 0),
    ).toBe(true);
    expect(damage.some((e) => e.type === 'damage' && e.targetId === f.others[0].id)).toBe(false);
    expect(lane.templateId).toBe(GHOST_BROADSIDE_FIRE);
  });

  it('replays identical warning geometry without sharing state across simulations', () => {
    const trace = () => {
      const { f, captain } = setup();
      startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'broadside');
      return live(f, GHOST_BROADSIDE_LANE).map((e) => [
        e.pos.x,
        e.pos.z,
        e.facing,
        e.scale,
        e.castTotal,
      ]);
    };
    expect(trace()).toEqual(trace());
  });

  it('automatically cycles all three mechanics with deterministic cadence, damage, state and RNG', () => {
    const trace = () => {
      const { f, captain } = setup();
      const casts: { at: number; id: string }[] = [];
      const frames: unknown[] = [];
      const draws: number[] = [];
      f.sim.rng.setObserver((value) => draws.push(value));
      let previous: string | null = null;
      for (let i = 0; i < 28 / DT; i++) {
        tick(f, () => {
          const action =
            captain.bastionFight?.kind === 'ghostCaptain' ? captain.bastionFight.action : null;
          const laneId = action?.objects[action.move === 'broadside' ? 2 : 0];
          const lane = laneId === undefined ? undefined : f.sim.ctx.entities.get(laneId);
          if (lane) {
            placeInLane(f, f.tank, lane, action?.move === 'broadside' ? 12 : 4);
            placeInLane(f, f.others[0], lane, action?.move === 'broadside' ? 12 : 4, 2.5);
          } else {
            put(f, f.tank, captain.pos.x - f.ox, captain.pos.z - f.oz + 3);
            put(f, f.others[0], captain.pos.x - f.ox + 3, captain.pos.z - f.oz + 6);
          }
        });
        if (captain.castingAbility && captain.castingAbility !== previous)
          casts.push({ at: (i + 1) * DT, id: captain.castingAbility });
        previous = captain.castingAbility;
        frames.push({
          state: structuredClone(captain.bastionFight),
          position: { ...captain.pos },
          objects: f.inst.objectIds.map((id) => {
            const e = f.sim.ctx.entities.get(id);
            return e
              ? [
                  id,
                  e.templateId,
                  e.pos.x,
                  e.pos.z,
                  e.facing,
                  e.scale,
                  e.castTotal,
                  e.castRemaining,
                ]
              : [id];
          }),
        });
      }
      f.sim.rng.setObserver(null);
      return { casts, frames, hits: f.hits, draws, tail: [f.sim.rng.next(), f.sim.rng.next()] };
    };
    const first = trace();
    expect(first.casts.slice(0, 3).map((c) => c.id)).toEqual([
      GHOST_CAPTAIN_BROADSIDE,
      GHOST_CAPTAIN_ANCHOR,
      GHOST_CAPTAIN_BOARDING,
    ]);
    expect(first.casts[0].at).toBeCloseTo(T.first, 1);
    for (const [actual, authored] of [
      [first.casts[1].at - first.casts[0].at, T.broadsideWarning + T.flashSeconds + T.recovery],
      [first.casts[2].at - first.casts[1].at, T.anchorWarning + T.anchorSeconds + T.recovery],
    ]) {
      // A countdown starts on the next fixed tick, never before the authored time.
      expect(actual).toBeGreaterThanOrEqual(authored - 1e-6);
      expect(actual).toBeLessThanOrEqual(authored + DT + 1e-6);
    }
    for (const id of [GHOST_CAPTAIN_BROADSIDE, GHOST_CAPTAIN_ANCHOR, GHOST_CAPTAIN_BOARDING])
      expect(
        first.hits.some((h) => h.ability === id && h.amount > 0),
        id,
      ).toBe(true);
    expect(first.draws.length).toBeGreaterThan(0);
    expect(trace()).toEqual(first);
  });

  it('does not erase a failed deed when players briefly leave the targeting area', () => {
    const { f, captain } = setup();
    startGhostCaptainMove(f.sim.ctx, f.inst, captain, 'broadside');
    const lane = live(f, GHOST_BROADSIDE_LANE)[2];
    run(f, T.broadsideWarning + 0.1, () => {
      placeInLane(f, f.tank, lane, 12);
      placeInLane(f, f.others[0], lane, 12, 2.5);
    });
    expect(took(f, f.tank, GHOST_CAPTAIN_BROADSIDE)).toBeGreaterThan(0);
    const st = captain.bastionFight;
    if (st?.kind !== 'ghostCaptain') throw new Error('captain state missing');
    expect(st.struck).toBe(true);
    for (const p of [f.tank, ...f.others]) put(f, p, 57, 210);
    tickGhostCaptain(f.sim.ctx, f.inst, captain, true);
    expect(captain.bastionFight).toBe(st);
    expect(st.struck).toBe(true);
    put(f, f.tank, 57, 127);
    f.sim.ctx.handleDeath(captain, f.tank);
    tickGhostCaptain(f.sim.ctx, f.inst, captain, false);
    expect(earned(f, f.tank, TURRETBACK_DEED)).toBe(false);
  });
});
