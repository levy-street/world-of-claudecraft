import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CANNON_ACTIONS, CANNON_ENEMIES, CANNON_WAVES } from '../src/sim/content/cannon_encounter';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { type CannonEnemyKind, TICK_RATE, type VehicleSession } from '../src/sim/types';

interface MockActor {
  key: string;
  root: THREE.Group;
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const actors = vi.hoisted(() => ({ made: [] as MockActor[], failAt: -1 }));
vi.mock('../src/render/characters', () => ({
  CharacterVisual: class {
    root = new THREE.Group();
    height = 2.6;
    update = vi.fn();
    dispose = vi.fn();
    setShadow = vi.fn();
    setProxyShadow = vi.fn();
    constructor(readonly key: string) {
      if (actors.made.length === actors.failAt) throw new Error('model assembly failed');
      actors.made.push(this);
    }
  },
}));

import { CANNON_ENEMY_LOOKS, CannonEnemyVisuals } from '../src/render/cannon_enemy_visuals';

function session(): VehicleSession {
  return {
    kind: 'cannon',
    stationId: 'north_watch_cannon',
    cycle: 'wq3_8',
    origin: { x: 442, y: 0, z: 1034 },
    encounter: createCannonEncounter(),
  };
}

describe('existing animated cannon enemy models', () => {
  it('tips killed actors briefly but always gives the only commander slot to a living actor', () => {
    const pool = new CannonEnemyVisuals();
    const s = session();
    s.encounter.enemies = [
      { id: 1, kind: 'commander', hp: 800, x: 440, z: 1000, slowUntilTick: 0 },
    ];
    pool.update(s, 0.05, () => 0);
    const body = pool.root.getObjectByName('cannon-commander')!;
    s.encounter.enemies = [];
    s.encounter.feedback = [{ id: 2, kind: 'death', tick: 0, x: 440, z: 1000, enemyId: 1 }];
    pool.update(s, 0.05, () => 0);
    s.encounter.tick = 4;
    pool.update(s, 0.05, () => 0);
    expect(body.visible).toBe(true);
    expect(body.rotation.x).toBeLessThan(0);
    s.encounter.enemies = [
      { id: 3, kind: 'commander', hp: 800, x: 445, z: 1000, slowUntilTick: 0 },
    ];
    pool.update(s, 0.05, () => 0);
    expect(body.userData.enemyId).toBe(3);
    expect(body.rotation.x).toBe(0);
    s.encounter.feedback.push({ id: 4, kind: 'death', tick: 4, x: 445, z: 1000, enemyId: 3 });
    s.encounter.enemies = [];
    pool.update(s, 0.05, () => 0, true);
    expect(body.visible).toBe(false);
    pool.dispose();
  });
  it('releases completed actors if another model fails during pool construction', () => {
    actors.made.length = 0;
    actors.failAt = 3;
    try {
      expect(() => new CannonEnemyVisuals()).toThrow('model assembly failed');
      expect(actors.made).toHaveLength(3);
      expect(actors.made.every((a) => a.dispose.mock.calls.length === 1)).toBe(true);
    } finally {
      actors.failAt = -1;
    }
  });
  it('prepares existing looks, reuses stable IDs without new rigs, and releases instance resources', () => {
    actors.made.length = 0;
    const pool = new CannonEnemyVisuals();
    expect(actors.made).toHaveLength(51);
    expect([...new Set(actors.made.map((a) => a.key))]).toEqual([
      'mob_bandit',
      'player_warrior',
      'npc_knight',
      'mob_bruiser',
    ]);
    const s = session();
    s.encounter.enemies = [1, 2].map((id) => ({
      id,
      kind: 'infantry',
      hp: 100,
      x: 442 + id,
      z: 1000,
      slowUntilTick: 0,
    }));
    const before = JSON.stringify(s);
    pool.update(s, 0.016, () => 3);
    expect(JSON.stringify(s)).toBe(before);
    const second = pool.root.children.find((c) => c.userData.enemyId === 2)!;
    expect(second?.position.toArray()).toEqual([444, 3, 1000]);
    s.encounter.enemies.shift();
    pool.update(s, 0.016, () => 3);
    expect(pool.root.children.find((c) => c.visible && c.userData.enemyId === 2)).toBe(second);
    expect(pool.root.children.filter((c) => c.visible)).toHaveLength(1);
    expect(actors.made).toHaveLength(51);
    pool.update(null, 0.016, () => 0);
    expect(pool.root.children.some((c) => c.visible)).toBe(false);
    pool.dispose();
    expect(actors.made.every((a) => a.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('runs runners at their scaled speed, reflects slows/health, and keeps commanders larger', () => {
    actors.made.length = 0;
    const pool = new CannonEnemyVisuals();
    const s = session();
    s.encounter.enemies = [{ id: 1, kind: 'runner', hp: 40, x: 440, z: 1000, slowUntilTick: 10 }];
    pool.update(s, 0.016, () => 2);
    const runner = pool.root.children.find((c) => c.visible)!;
    const actor = actors.made.find((a) => runner.children.includes(a.root));
    expect(actor?.update).toHaveBeenCalledWith(
      0.016,
      expect.objectContaining({
        running: true,
        moving: true,
        speed: (3.78 * 0.5) / 0.9,
        dead: false,
      }),
      true,
      false,
    );
    expect(runner.children[1].scale.x).toBe(0.5);
    expect(runner.children[2].visible).toBe(true);
    expect(pool.root.getObjectByName('cannon-commander')!.scale.x).toBe(1.5);
    pool.dispose();
  });

  it('has enough of each rig even when every enemy is permanently slowed and none killed', () => {
    const depth = NORTH_WATCH_CANNON.field.maxZ - NORTH_WATCH_CANNON.field.minZ;
    for (const wave of CANNON_WAVES)
      for (const boundary of wave) {
        for (const kind of Object.keys(CANNON_ENEMY_LOOKS) as CannonEnemyKind[]) {
          const alive = wave.filter(
            (spawn) =>
              spawn.kind === kind &&
              spawn.atTick <= boundary.atTick &&
              boundary.atTick - spawn.atTick <=
                (depth / (CANNON_ENEMIES[kind].speed * CANNON_ACTIONS.grapeshot.slowMultiplier)) *
                  TICK_RATE,
          );
          expect(alive.length).toBeLessThanOrEqual(CANNON_ENEMY_LOOKS[kind].capacity);
        }
      }
  });
});
