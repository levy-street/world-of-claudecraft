import { describe, expect, it } from 'vitest';
import {
  activeVarkhulCinderFires,
  activeVarkhulCinderOrbProjectiles,
  VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP,
  VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP_HEROIC,
  VARKHUL_CINDER_FIRE_MAX_FIELDS,
  VARKHUL_CINDER_FIRE_RADIUS,
  VARKHUL_CINDER_ORB_DAMAGE_MAX_HP,
  VARKHUL_CINDER_ORB_DAMAGE_MAX_HP_HEROIC,
  VARKHUL_CINDER_ORB_DURATION,
  VARKHUL_CINDER_ORB_HIT_RADIUS,
  VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET,
  VARKHUL_CINDER_ORB_SPEED,
  VARKHUL_CINDER_ORBS_MARK_SECONDS,
  VARKHUL_CINDER_ORBS_TARGETS,
  varkhulCinderFireCanSpawn,
  varkhulCinderFireId,
  varkhulCinderOrbProjectileId,
} from '../src/sim/varkhul_cinder_orbs';

describe('Varkhul Cinder Orbs projection', () => {
  it('pins three spread marks, permanent fire, and six traveling orbs per target', () => {
    expect(VARKHUL_CINDER_ORBS_TARGETS).toBe(3);
    expect(VARKHUL_CINDER_ORBS_MARK_SECONDS).toBe(4);
    expect(VARKHUL_CINDER_FIRE_RADIUS).toBe(3.5);
    expect(VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP).toBe(0.12);
    expect(VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP_HEROIC).toBe(0.25);
    expect(VARKHUL_CINDER_FIRE_MAX_FIELDS).toBe(60);
    expect(VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET).toBe(6);
    expect(VARKHUL_CINDER_ORB_SPEED).toBe(9);
    expect(VARKHUL_CINDER_ORB_DURATION).toBe(5.5);
    expect(VARKHUL_CINDER_ORB_HIT_RADIUS).toBe(1.1);
    expect(VARKHUL_CINDER_ORB_DAMAGE_MAX_HP).toBe(0.35);
    expect(VARKHUL_CINDER_ORB_DAMAGE_MAX_HP_HEROIC).toBe(0.55);
  });

  it('projects permanent fires and reconnect-safe moving projectiles with stable ids', () => {
    const fireId = varkhulCinderFireId(91, 4, 2);
    const orbId = varkhulCinderOrbProjectileId(91, 4, 2, 5);
    expect(fireId).toBe('91:cinder-fire:4:2');
    expect(orbId).toBe('91:cinder-orbs:4:2:5');
    const state = {
      cinderFires: [
        {
          id: fireId,
          pos: { x: 8, y: 0, z: 9 },
          tickTimer: 0.5,
        },
      ],
      cinderOrbProjectiles: [
        {
          id: orbId,
          ownerId: 17,
          pos: { x: 10, y: 0, z: 11 },
          dir: { x: 0.6, z: -0.8 },
          remaining: 3,
          hitPlayerIds: [17],
        },
      ],
    };

    expect(activeVarkhulCinderFires(91, state)).toEqual([
      {
        id: fireId,
        sourceId: 91,
        x: 8,
        z: 9,
        radius: 3.5,
      },
    ]);
    expect(activeVarkhulCinderOrbProjectiles(91, state)).toEqual([
      {
        id: orbId,
        sourceId: 91,
        x: 10,
        z: 11,
        dirX: 0.6,
        dirZ: -0.8,
        radius: 1.1,
        duration: 5.5,
        remaining: 3,
      },
    ]);
  });

  it('keeps permanent fires but omits expired projectiles', () => {
    const state = {
      cinderFires: [{ id: 'fire', pos: { x: 0, y: 0, z: 0 }, tickTimer: 1 }],
      cinderOrbProjectiles: [
        {
          id: 'expired',
          ownerId: 17,
          pos: { x: 1, y: 0, z: 2 },
          dir: { x: 1, z: 0 },
          remaining: 0,
          hitPlayerIds: [17],
        },
      ],
    };
    expect(activeVarkhulCinderFires(3, state)).toHaveLength(1);
    expect(activeVarkhulCinderOrbProjectiles(3, state)).toEqual([]);
  });

  it('bounds permanent snapshot work after twenty full releases', () => {
    expect(varkhulCinderFireCanSpawn(VARKHUL_CINDER_FIRE_MAX_FIELDS - 1)).toBe(true);
    expect(varkhulCinderFireCanSpawn(VARKHUL_CINDER_FIRE_MAX_FIELDS)).toBe(false);
    expect(varkhulCinderFireCanSpawn(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
