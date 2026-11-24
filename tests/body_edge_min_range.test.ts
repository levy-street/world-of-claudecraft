// A range-banded gap closer (one that authors a minRange: the warrior's Charge,
// the druid's Bruin Rush) measures BOTH ends of its band from a big body's
// edge, the way its melee and short reach do (player_attack_reach.ts). Found in
// Jose's playtest of 2026-11-24: with the Guardian of the Heat's body grown to
// 13.5 yd (its lip wall), a warrior standing in melee could still Charge it
// (8 yd minimum, measured from the pivot) and Charge reached only 11.5 yd past
// its edge.
import { describe, expect, it } from 'vitest';
import {
  bodyEdgeMeleeRange,
  playerAbilityBand,
  targetBodyRadius,
} from '../src/sim/combat/player_attack_reach';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { emptyModifiers } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { heatFight } from './helpers/heat_fight';
import { EMPTY_TEST_WORLD } from './sim_shared';

const HEAT = 'heart_heat_guardian';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void };

function warrior(): TestSim {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
  sim.setPlayerLevel(20);
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('no warrior');
  meta.known = abilitiesKnownAt('warrior', 20, emptyModifiers()) as typeof meta.known;
  return sim;
}

/** A hostile `templateId` mob `distance` yards (pivot to pivot) in front. */
function foeAt(sim: TestSim, templateId: string, distance: number): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS[templateId], 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + distance,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 500_000;
  sim.addEntity(mob);
  p.facing = 0;
  p.targetId = mob.id;
  return mob;
}

/** Charge `distance` yards (pivot to pivot) at a `templateId`: the refusal, or null. */
function charge(templateId: string, distance: number): string | null {
  const sim = warrior();
  foeAt(sim, templateId, distance);
  sim.drainEvents();
  sim.castAbility('charge', sim.playerId);
  const events: SimEvent[] = sim.tick();
  const err = events.find(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === sim.playerId,
  );
  if (err) return err.text;
  expect(sim.player.chargeTargetId).not.toBeNull();
  return null;
}

describe('a gap closer measures its band from a big body edge', () => {
  const body = MOBS[HEAT].bodyRadius ?? 0;
  const c = ABILITIES.charge;

  it('the shipped gap closers author an 8 to 25 yd band', () => {
    for (const id of ['charge', 'bear_charge', 'intervene']) {
      expect(ABILITIES[id].minRange).toBe(8);
      expect(ABILITIES[id].range).toBe(25);
    }
    expect(body).toBeGreaterThan(8);
  });

  it('the band: from the edge on a body, from the pivot on anything without one', () => {
    expect(targetBodyRadius({ kind: 'mob', templateId: HEAT })).toBe(body);
    expect(targetBodyRadius({ kind: 'mob', templateId: 'training_dummy' })).toBe(0);
    expect(targetBodyRadius({ kind: 'player', templateId: 'warrior' })).toBe(0);
    expect(playerAbilityBand({ kind: 'mob', templateId: HEAT }, c.range, c.minRange)).toEqual({
      min: (c.minRange ?? 0) + body,
      max: c.range + body,
    });
    expect(
      playerAbilityBand({ kind: 'mob', templateId: 'training_dummy' }, c.range, c.minRange),
    ).toEqual({ min: c.minRange, max: c.range });
    // An ability with no minimum keeps the plain reach (the short-reach rule).
    expect(playerAbilityBand({ kind: 'mob', templateId: HEAT }, 8, undefined)).toEqual({
      min: 0,
      max: 8 + body,
    });
  });

  it('refuses a Charge from melee on the Heat guardian (its melee reach is inside the band)', () => {
    // Where a warrior's melee lands on it: from its edge out to the melee reach.
    expect(charge(HEAT, body + 0.5)).toBe('Too close!');
    expect(charge(HEAT, bodyEdgeMeleeRange(HEAT))).toBe('Too close!');
    expect(charge(HEAT, body + 7.5)).toBe('Too close!');
  });

  it('charges the Heat guardian from 8 to 25 yd past its edge', () => {
    expect(charge(HEAT, body + 9)).toBeNull();
    expect(charge(HEAT, body + 24.5)).toBeNull();
    expect(charge(HEAT, body + 25.5)).toBe('Out of range.');
  });

  it('a body-less mob keeps the pivot band', () => {
    expect(charge('training_dummy', 7.5)).toBe('Too close!');
    expect(charge('training_dummy', 8.5)).toBeNull();
    expect(charge('training_dummy', 25.5)).toBe('Out of range.');
  });

  it('a Charge at the Heat guardian arrives at its lip wall and starts swinging', () => {
    // Its pivot sits behind the lip wall's colliders: the run ends at the
    // body's edge, never grinding into the wall until its budget runs out.
    for (const out of [9, 20]) {
      const f = heatFight(1, 31);
      const [p] = f.players;
      f.put(p, HEARTH_WELL.x + body + out, HEARTH_WELL.z);
      const boss = f.boss();
      p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
      p.targetId = boss.id;
      p.autoAttack = false;
      const meta = f.sim.meta(p.id);
      if (!meta) throw new Error('no raider');
      meta.known = abilitiesKnownAt('warrior', 20, emptyModifiers()) as typeof meta.known;
      f.sim.drainEvents();
      f.sim.castAbility('charge', p.id);
      expect(p.chargeTargetId).toBe(boss.id);
      let ticks = 0;
      while (p.chargeTargetId !== null && ticks < 80) {
        f.tick(1);
        ticks++;
      }
      expect(p.chargeTargetId).toBeNull();
      // Arrived (well inside the 3 s budget) and swinging.
      expect(ticks).toBeLessThan(40);
      expect(p.autoAttack).toBe(true);
    }
  });
});
