// The Quartered Isle's frozen lakes (src/sim/quartered_frozen_lakes.ts): every
// lake is a level sheet of ice on dry, ice-quarter ground, clear of the roads
// and every placed content spot; standing on one puts the slippery-ground aura
// on a player (so the shared motion kernel slides them), stepping off or
// flying high over it takes it off again, and an ice aura from any other
// source (the Bonechill crypt's rime) is never touched. The Heavestone Wilds'
// plates are level-topped plateaus on a few stepped heights.

import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { QUARTERED_ISLE_ROADS } from '../src/sim/content/quartered_isle_ways';
import { TREASURE_SITES } from '../src/sim/content/treasure_maps';
import {
  FROZEN_LAKE_AURA_NAME,
  FROZEN_LAKE_GRIP,
  onFrozenLake,
  updateFrozenLakeSlick,
} from '../src/sim/quartered_frozen_lakes';
import { frozenLakeAt, QUARTERED_FROZEN_LAKES } from '../src/sim/quartered_landmarks';
import { quarterWeightsAt } from '../src/sim/quartered_quarters';
import { ISLE_SHATTER } from '../src/sim/quartered_shatter';
import { Sim } from '../src/sim/sim';
import { SLIPPERY_GROUND_AURA, slipperyGrip } from '../src/sim/slippery_ground';
import type { Aura, Entity, MoveInput } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 1;
const h = (x: number, z: number) => terrainHeight(x, z, SEED);

function segDistance(x: number, z: number, line: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k];
    const b = line[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - a.x - dx * u, z - a.z - dz * u));
  }
  return best;
}

function player(x: number, y: number, z: number, auras: Aura[] = []): Entity {
  return { id: 7, dead: false, pos: { x, y, z }, auras } as unknown as Entity;
}

describe('the frozen lakes', () => {
  it('are level sheets of ice on dry ice-quarter ground', () => {
    expect(QUARTERED_FROZEN_LAKES.length).toBeGreaterThanOrEqual(4);
    for (const lake of QUARTERED_FROZEN_LAKES) {
      expect(quarterWeightsAt(lake.x, lake.z).ice, `lake ${lake.x},${lake.z}`).toBeGreaterThan(0.5);
      expect(lake.y).toBeGreaterThan(WATER_LEVEL + 1);
      for (let r = 0; r <= lake.r; r += lake.r / 4) {
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const x = lake.x + Math.cos(ang) * r;
          const z = lake.z + Math.sin(ang) * r;
          expect(Math.abs(h(x, z) - lake.y), `ice at ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThan(
            0.05,
          );
        }
      }
    }
  });

  it('keep clear of the roads, each other and every placed content spot', () => {
    const isle = (row: { zoneId: string }) => row.zoneId === 'quartered_isle';
    const spots = [...GATHER_NODES.filter(isle).map((n) => n.pos), ...TREASURE_SITES.filter(isle)];
    for (const [i, lake] of QUARTERED_FROZEN_LAKES.entries()) {
      for (const road of QUARTERED_ISLE_ROADS) {
        expect(segDistance(lake.x, lake.z, road)).toBeGreaterThan(lake.blendR + 4);
      }
      for (const s of spots)
        expect(Math.hypot(s.x - lake.x, s.z - lake.z)).toBeGreaterThan(lake.r + 4);
      for (const other of QUARTERED_FROZEN_LAKES.slice(i + 1)) {
        expect(Math.hypot(other.x - lake.x, other.z - lake.z)).toBeGreaterThan(
          lake.blendR + other.blendR,
        );
      }
    }
  });

  it('count a player on the ice, or hopping just over it, but not off it or flying high', () => {
    const lake = QUARTERED_FROZEN_LAKES[0];
    expect(frozenLakeAt(lake.x, lake.z)).toBe(lake);
    expect(onFrozenLake(lake.x, lake.y, lake.z)).toBe(true);
    expect(onFrozenLake(lake.x + lake.r - 0.5, lake.y + 1, lake.z)).toBe(true);
    expect(onFrozenLake(lake.x + lake.r + 1, lake.y, lake.z)).toBe(false);
    expect(onFrozenLake(lake.x, lake.y + 10, lake.z)).toBe(false);
    expect(onFrozenLake(0, 0, -40)).toBe(false);
  });
});

describe('the frozen lakes slick', () => {
  it('goes on a player who stands on the ice and comes off when they leave', () => {
    const lake = QUARTERED_FROZEN_LAKES[1];
    const p = player(lake.x, lake.y, lake.z);
    updateFrozenLakeSlick(p);
    expect(slipperyGrip(p)).toBe(FROZEN_LAKE_GRIP);
    expect(p.auras).toHaveLength(1);
    // standing on, it is topped up, never stacked
    for (let i = 0; i < 40; i++) {
      p.auras[0].remaining -= 0.05;
      updateFrozenLakeSlick(p);
    }
    expect(p.auras).toHaveLength(1);
    expect(p.auras[0].remaining).toBeGreaterThan(0);
    p.pos.x = lake.x + lake.r + 3;
    updateFrozenLakeSlick(p);
    expect(slipperyGrip(p)).toBe(0);
    expect(p.auras).toHaveLength(0);
  });

  it('never goes on the dead and never strips an ice aura from another source', () => {
    const lake = QUARTERED_FROZEN_LAKES[0];
    const dead = player(lake.x, lake.y, lake.z);
    dead.dead = true;
    updateFrozenLakeSlick(dead);
    expect(dead.auras).toHaveLength(0);

    const rime: Aura = {
      id: SLIPPERY_GROUND_AURA,
      name: 'Rime-Slick',
      kind: 'slow',
      remaining: 1.5,
      duration: 1.5,
      value: 1,
      value2: 8,
      sourceId: 99,
      school: 'frost',
    };
    const crypt = player(0, 0, -40, [rime]);
    updateFrozenLakeSlick(crypt);
    expect(crypt.auras).toEqual([rime]);
    const onLake = player(lake.x, lake.y, lake.z, [rime]);
    updateFrozenLakeSlick(onLake);
    expect(onLake.auras).toEqual([rime]);
    expect(onLake.auras[0].name).not.toBe(FROZEN_LAKE_AURA_NAME);
    // the literal the client matcher re-localizes (src/ui/sim_i18n.ts)
    expect(FROZEN_LAKE_AURA_NAME).toBe('Slick Ice');
  });

  it('slides a player on the live Sim: a run released on the ice carries on', () => {
    const lake = QUARTERED_FROZEN_LAKES[0];
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = lake.x;
    p.pos.z = lake.z - lake.r + 3;
    p.pos.y = lake.y;
    p.prevPos = { ...p.pos };
    p.fallStartY = p.pos.y;
    p.onGround = true;
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.facing = 0;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    const input = (forward: boolean): MoveInput => ({ ...meta.moveInput, forward }) as MoveInput;
    for (let i = 0; i < 40; i++) {
      Object.assign(meta.moveInput, input(true));
      sim.tick();
    }
    expect(p.auras.some((a) => a.name === FROZEN_LAKE_AURA_NAME)).toBe(true);
    const released = { x: p.pos.x, z: p.pos.z };
    for (let i = 0; i < 10; i++) {
      Object.assign(meta.moveInput, input(false));
      sim.tick();
    }
    // on ordinary ground a released run stops dead; on the ice it slides on
    expect(Math.hypot(p.pos.x - released.x, p.pos.z - released.z)).toBeGreaterThan(1);
  });
});

describe("the Heavestone Wilds' plateaus", () => {
  it('stand on a few stepped heights, never past the climbable ceiling', () => {
    const s = ISLE_SHATTER;
    expect(s.plateauMax % s.plateauStep).toBe(0);
    // a plateau's full rise eases over a closed border's 10.5yd run at a
    // smoothstep's steepest 1.5x the mean slope: under the climb limit (1.5)
    expect((s.plateauMax * 1.5) / 10.5).toBeLessThan(1.5);
    expect((s.shardRise * 1.5) / 10.5).toBeLessThan(1.5);
  });
});
