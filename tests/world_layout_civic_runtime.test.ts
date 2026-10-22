import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
    civic: {
      eastbrook_weekly_vault: { x: -72, z: -102, rotation: 0.7, lift: -1.45, groundY: 20 },
      eastbrook_market_stall_world_market: { x: -13, z: -124, rotation: 2.9, lift: 0, groundY: 10 },
      fenbridge_provision_stall: { x: -7, z: 288, rotation: 3.8, lift: 0.2, groundY: 12 },
      fenbridge_mirelight_cistern: { x: 1, z: 301, rotation: 0.4, lift: 0.3, groundY: 15 },
    },
  },
}));

import { authoredTownDressingPlacements } from '../src/editor/authored_town_dressing_placements';
import { eastbrookVaultPlacements } from '../src/editor/feature_prop_placements';
import { buildEastbrookWeeklyVault } from '../src/render/eastbrook_weekly_vault';
import { buildingRecordColliders } from '../src/sim/authored_town_buildings';
import { queryOpenWorldColliders } from '../src/sim/colliders';
import { BUILTIN_WORLD, NPCS } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { applyEastbrookVaultPad } from '../src/sim/eastbrook_vault_terrain';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('native civic layout activation', () => {
  it('moves canonical props, vendor sockets and interactions together', () => {
    const stall = FENBRIDGE_LAYOUT.civic.provisionStall;
    expect(stall.position).toEqual({ x: -7, z: 288 });
    expect(stall.footprint.center).toEqual(stall.position);
    expect(stall.footprint.rotation).toBe(3.8);
    expect(BUILTIN_WORLD.props.stalls.find((p) => p.id === stall.id)).toMatchObject({
      x: -7,
      z: 288,
      rot: 3.8,
    });
    const merchant = EASTBROOK_LAYOUT.market.stalls[0];
    expect(merchant.position).toEqual({ x: -13, z: -124 });
    expect(
      Math.hypot(
        NPCS.the_merchant.pos!.x - merchant.position.x,
        NPCS.the_merchant.pos!.z - merchant.position.z,
      ),
    ).toBeLessThan(3);
    expect(
      BUILTIN_WORLD.props.wells.find((p) => p.id === 'fenbridge_mirelight_cistern'),
    ).toMatchObject({ x: 1, z: 301 });
  });
  it('moves the vault model, roof-hide envelope, collider and terrain seat together', () => {
    const vault = buildEastbrookWeeklyVault(() => 999);
    expect(vault.group.position.toArray()).toEqual([-72, 20, -102]);
    expect(vault.group.rotation.y).toBe(0.7);
    expect(vault.hideTarget).toMatchObject({ x: -72, z: -102, topY: 33 });
    const record = BUILTIN_WORLD.props.buildings.find((p) => p.id === 'eastbrook_weekly_vault')!;
    const collider = buildingRecordColliders(record, 1012, () => 999, WORLD_SEED)[0];
    expect(collider).toMatchObject({ x: -72, z: -102, rot: 0.7, underY: 20, cameraTopY: 33 });
    expect(applyEastbrookVaultPad(-72, -102, WORLD_SEED, 99, () => 999, false)).toBeCloseTo(20, 10);
  });
  it('preserves raised civic collision and exports the same fixed seats back to Studio', () => {
    const nearby = queryOpenWorldColliders(WORLD_SEED, -10, 285, -4, 291, []);
    expect(nearby).toContainEqual(
      expect.objectContaining({
        type: 'obb',
        x: -7,
        z: 288,
        rot: 3.8,
        cameraTopY: 15,
        moveTopY: 15,
      }),
    );
    const placements = authoredTownDressingPlacements(WORLD_SEED);
    expect(placements.find((p) => p.name === 'Fenbridge provision stall')).toMatchObject({
      x: -7,
      z: 288,
      rotY: 3.8,
      y: 0.2,
      detached: true,
      groundY: 12,
    });
    expect(placements.find((p) => p.name === 'Fenbridge mirelight cistern')).toMatchObject({
      x: 1,
      z: 301,
      rotY: 0.4,
      y: 0.3,
      groundY: 15,
    });
    expect(eastbrookVaultPlacements(WORLD_SEED)[0]).toMatchObject({
      x: -72,
      z: -102,
      rotY: 0.7,
      y: -1.45,
      detached: true,
      groundY: 20,
    });
  });
});
