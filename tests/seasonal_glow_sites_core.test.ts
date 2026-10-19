// Where the seasonal dressing's candlelight is (src/render/seasonal_glow_sites_core.ts):
// a halo at every lit piece, ground light only where something lights the street,
// nearby sites merged so a cluster is one pool, the stall's own lights turned with it,
// and the nearest-first pick that hands out the few budgeted point lights.
import { describe, expect, it } from 'vitest';
import {
  haloFalloff,
  LIGHT_MERGE_DISTANCE,
  nearestLightSites,
  seasonalHalos,
  seasonalLightSites,
} from '../src/render/seasonal_glow_sites_core';
import type { SeasonalDecorLayout, SeasonalGroundPiece } from '../src/sim/seasonal_decor_layout';
import { resolveSeasonalDecor } from '../src/sim/seasonal_decor_layout';
import { WORLD_SEED } from '../src/sim/world_seed';

function piece(
  kind: SeasonalGroundPiece['kind'],
  x: number,
  z: number,
  yaw = 0,
): SeasonalGroundPiece {
  return { kind, x, y: 2, z, yaw, scale: 1, anchor: `t:${kind}:${x}:${z}` };
}

function layoutOf(ground: SeasonalGroundPiece[]): SeasonalDecorLayout {
  return { ground, lanterns: [], garlands: [], stalls: [] };
}

describe('seasonal glow sites', () => {
  it('haloes every lit piece above its candle and none of the unlit harvest', () => {
    const halos = seasonalHalos(
      layoutOf([
        piece('pumpkin_lit', 0, 0),
        piece('gourd', 10, 0),
        piece('corn_shock', 20, 0),
        piece('pumpkin_small', 30, 0),
      ]),
    );
    expect(halos).toHaveLength(2);
    expect(halos[0].x).toBe(0);
    expect(halos[0].y).toBeGreaterThan(2);
    expect(halos[1].x).toBe(30);
    // the big pumpkin's halo is the wider one
    expect(halos[0].size).toBeGreaterThan(halos[1].size);
  });

  it('turns an off-centre candle with its piece (the bale pumpkin, the pole lantern)', () => {
    const [east] = seasonalHalos(layoutOf([piece('hay_bale', 0, 0, 0)]));
    const [turned] = seasonalHalos(layoutOf([piece('hay_bale', 0, 0, Math.PI)]));
    // local -x at yaw 0 maps to world -x; a half turn swings it to +x
    expect(east.x).toBeLessThan(0);
    expect(turned.x).toBeCloseTo(-east.x, 9);
    expect(turned.y).toBeCloseTo(east.y, 9);
  });

  it('merges a cluster of lit pieces into one ground light, keeps far ones apart', () => {
    const sites = seasonalLightSites(
      layoutOf([
        piece('pumpkin_lit', 0, 0),
        piece('pumpkin_small', LIGHT_MERGE_DISTANCE * 0.5, 0),
        piece('gourd', 1, 1),
        piece('pumpkin_lit', 40, 0),
      ]),
    );
    expect(sites).toHaveLength(2);
    const [cluster, far] = sites;
    // strength-weighted: the centre leans toward the big pumpkin
    expect(cluster.x).toBeGreaterThan(0);
    expect(cluster.x).toBeLessThan(LIGHT_MERGE_DISTANCE * 0.25);
    expect(cluster.strength).toBeGreaterThan(1);
    expect(cluster.radius).toBeGreaterThan(far.radius);
    expect(far.x).toBe(40);
  });

  it('lights and haloes the keeper stall in the shipped world, turned with it', () => {
    const layout = resolveSeasonalDecor(WORLD_SEED);
    expect(layout.stalls.length).toBeGreaterThanOrEqual(3);
    const stall = layout.stalls[0];
    const only: SeasonalDecorLayout = { ground: [], lanterns: [], garlands: [], stalls: [stall] };
    const halos = seasonalHalos(only);
    expect(halos.length).toBeGreaterThanOrEqual(6);
    // every stall halo stands over the booth, within its reach
    for (const h of halos) {
      expect(Math.hypot(h.x - stall.x, h.z - stall.z)).toBeLessThan(4.5);
      expect(h.y).toBeGreaterThan(stall.y + 1);
    }
    const sites = seasonalLightSites(only);
    expect(sites.length).toBeGreaterThanOrEqual(1);
    // the counter's pool lies out front: along the stall's facing from the keeper
    const front = sites[0];
    const along =
      (front.x - stall.x) * Math.sin(stall.yaw) + (front.z - stall.z) * Math.cos(stall.yaw);
    expect(along).toBeGreaterThan(1);
  });

  it('fades the halo sprite smoothly from a full core to nothing at its rim', () => {
    expect(haloFalloff(0)).toBe(1);
    expect(haloFalloff(1)).toBe(0);
    expect(haloFalloff(1.5)).toBe(0);
    let prev = 2;
    for (let r = 0; r <= 1; r += 0.05) {
      const a = haloFalloff(r);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
    // no hard disc: the last tenth of the radius is already nearly clear
    expect(haloFalloff(0.9)).toBeLessThan(0.01);
  });

  it('picks the nearest sites within reach, nearest first', () => {
    const sites = [
      { x: 10, y: 0, z: 0, radius: 5, strength: 1 },
      { x: 3, y: 0, z: 0, radius: 5, strength: 1 },
      { x: 50, y: 0, z: 0, radius: 5, strength: 1 },
      { x: 6, y: 0, z: 0, radius: 5, strength: 1 },
    ];
    const pick = [0, 0];
    const d2 = [0, 0];
    expect(nearestLightSites(sites, 0, 0, 20, pick, d2)).toBe(2);
    expect(pick).toEqual([1, 3]);
    // only one within a short reach
    expect(nearestLightSites(sites, 0, 0, 4, pick, d2)).toBe(1);
    expect(pick[0]).toBe(1);
    expect(nearestLightSites(sites, 1000, 0, 4, pick, d2)).toBe(0);
  });
});
