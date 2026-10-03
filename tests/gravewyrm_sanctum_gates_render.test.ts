// The Gravewyrm Sanctum's gate looks, pure half (src/render/gravewyrm_sanctum/
// sanctum_gates_core.ts): every gate kind wears a rig, the rigs' own clocks
// snap on first sight and play a reveal only on a real change, the ice
// wall's shards tile the wall and fall clear of the way, the grate's lift and
// the ward's guttering settle at their ends, and the Chain Bridge, taut, lies
// exactly on the sim's own walkway.

import { describe, expect, it } from 'vitest';
import {
  CHAIN_BRIDGE_DECK,
  CHAIN_BRIDGE_LAND,
  CHAIN_BRIDGE_PIVOT_Z,
  chainBridgeCrust,
  chainBridgeDeckAt,
  chainBridgeDeckHeight,
  chainBridgeLength,
  chainBridgePivotS,
  chainBridgePoint,
  chainGateLift,
  ICE_WALL,
  ICE_WALL_PIECES,
  iceWallCell,
  iceWallCracks,
  iceWallShardPose,
  riteWardCharge,
  SANCTUM_GATE_SECONDS,
  SanctumGateClock,
  sanctumGateRig,
} from '../src/render/gravewyrm_sanctum/sanctum_gates_core';
import { GRAVEWYRM_SANCTUM_GATES } from '../src/sim/content/gravewyrm_sanctum';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

function area(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

describe('gravewyrm sanctum gate rigs', () => {
  it('gives every Sanctum gate kind a rig', () => {
    const kinds = new Set(GRAVEWYRM_SANCTUM_GATES.map((g) => g.kind));
    expect([...kinds].sort()).toEqual(['chain_bridge', 'chain_gate', 'ice_wall', 'rite_ward']);
    for (const g of GRAVEWYRM_SANCTUM_GATES) expect(sanctumGateRig(g.kind), g.id).not.toBeNull();
    expect(sanctumGateRig('ice_wall')).toBe('iceWall');
    expect(sanctumGateRig('chain_gate')).toBe('chainGate');
    expect(sanctumGateRig('chain_bridge')).toBe('chainBridge');
    expect(sanctumGateRig('rite_ward')).toBe('riteWard');
    expect(sanctumGateRig('portcullis')).toBeNull();
  });

  it('snaps on first sight and plays only a real change', () => {
    const open = new SanctumGateClock(SANCTUM_GATE_SECONDS.iceWall);
    // First seen open (the memory snapped it): stands open, no reveal.
    expect(open.step(1, 0.1, true)).toBe(1);
    expect(open.played).toBe(false);
    const shut = new SanctumGateClock(SANCTUM_GATE_SECONDS.iceWall);
    expect(shut.step(0, 0.1, false)).toBe(0);
    expect(shut.played).toBe(false);
    // Then the gate opens: the reveal plays on the rig's own clock.
    const mid = shut.step(0.2, 1, true);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(shut.played).toBe(true);
    expect(shut.step(1, SANCTUM_GATE_SECONDS.iceWall.open, true)).toBe(1);
    // Caught mid-reveal at first sight: plays from the far end.
    const caught = new SanctumGateClock(SANCTUM_GATE_SECONDS.chainGate);
    expect(caught.step(0.5, 0, true)).toBe(0);
    expect(caught.played).toBe(true);
    // A seal slams faster than the hoist opens.
    expect(SANCTUM_GATE_SECONDS.chainGate.close).toBeLessThan(SANCTUM_GATE_SECONDS.chainGate.open);
  });

  it('cuts the ice wall into seven shards that tile it', () => {
    expect(ICE_WALL_PIECES).toHaveLength(7);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const cell = iceWallCell(i);
      expect(cell.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of cell) {
        expect(Math.abs(x)).toBeLessThanOrEqual(ICE_WALL.half + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(ICE_WALL.height + 1e-9);
      }
      total += area(cell);
    }
    expect(total).toBeCloseTo(ICE_WALL.half * 2 * ICE_WALL.height, 6);
  });

  it('shatters the wall: cracks first, the shards fall clear and settle', () => {
    expect(iceWallCracks(0)).toBe(0);
    expect(iceWallCracks(1)).toBe(1);
    for (let i = 0; i < 7; i++) {
      const shut = iceWallShardPose(i, 0);
      expect(shut.dx).toBeCloseTo(0, 12);
      expect(shut.dz).toBeCloseTo(0, 12);
      expect(shut.angle).toBeCloseTo(0, 12);
      const open = iceWallShardPose(i, 1);
      expect(open.fall).toBe(1);
      // Lying at the side of the way (outside the wall's own span), sunk low.
      const cx = iceWallCell(i).reduce((a, p) => a + p[0], 0) / iceWallCell(i).length;
      expect(Math.abs(cx + open.dx)).toBeGreaterThan(ICE_WALL.half);
      let prev = -1;
      for (let k = 0; k <= 1.0001; k += 0.05) {
        const f = iceWallShardPose(i, k).fall;
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
    }
  });

  it('hoists the grate monotonically from down to up', () => {
    expect(chainGateLift(0)).toBe(0);
    expect(chainGateLift(1)).toBeCloseTo(1, 9);
    let prev = -1;
    for (let k = 0; k <= 1.0001; k += 0.02) {
      const l = chainGateLift(k);
      expect(l).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = l;
    }
  });

  it('gutters the rite ward out', () => {
    expect(riteWardCharge(0, 3)).toBe(1);
    expect(riteWardCharge(1, 3)).toBe(0);
    for (let t = 0; t < 4; t += 0.37) {
      const c = riteWardCharge(0.5, t);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
  });
});

describe('gravewyrm sanctum chain bridge', () => {
  it('lies the taut deck exactly on the sim walkway', () => {
    for (let z = CHAIN_BRIDGE_DECK.fromZ; z <= CHAIN_BRIDGE_DECK.toZ; z += 0.25) {
      expect(chainBridgeDeckHeight(z)).toBeCloseTo(
        authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, CHAIN_BRIDGE_DECK.x, z),
        6,
      );
    }
    const L = chainBridgeLength();
    for (let s = 0; s <= L; s += 0.5) {
      const p = chainBridgePoint(s, 1);
      const sim = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, CHAIN_BRIDGE_DECK.x, p.z);
      expect(Math.abs(p.y - sim)).toBeLessThan(0.06);
    }
  });

  it('spans the gulf from the Lock Terrace to the Thaw Works', () => {
    // The terrace's rim at the walk's centre is z 0, the works' z 28.
    expect(chainBridgeDeckAt(0).z).toBeLessThan(0);
    expect(chainBridgeDeckAt(chainBridgeLength()).z).toBeGreaterThan(28);
  });

  it('hangs slack from the rim into the crevasse when shut', () => {
    const sR = chainBridgePivotS();
    const pivot = chainBridgeDeckAt(sR);
    expect(pivot.z).toBeGreaterThanOrEqual(CHAIN_BRIDGE_PIVOT_Z - 0.3);
    const L = chainBridgeLength();
    for (let s = sR + 1; s <= L; s += 1) {
      const p = chainBridgePoint(s, 0);
      expect(p.z).toBeCloseTo(pivot.z, 6);
      expect(p.y).toBeCloseTo(pivot.y - (s - sR), 6);
    }
    // The links before the pivot never leave the terrace floor.
    for (const k of [0, 0.3, CHAIN_BRIDGE_LAND, 0.8, 1]) {
      expect(chainBridgePoint(sR * 0.5, k)).toEqual(chainBridgeDeckAt(sR * 0.5));
    }
  });

  it('swings across without a jump and seats on the clock', () => {
    const L = chainBridgeLength();
    for (let s = 0; s <= L; s += 2) {
      const a = chainBridgePoint(s, CHAIN_BRIDGE_LAND - 1e-7);
      const b = chainBridgePoint(s, CHAIN_BRIDGE_LAND);
      expect(Math.hypot(a.z - b.z, a.y - b.y)).toBeLessThan(1e-3);
    }
    // Every step of the clock moves a link a bounded distance (no teleport).
    for (let s = 0; s <= L; s += 3) {
      let prev = chainBridgePoint(s, 0);
      for (let k = 0.01; k <= 1.0001; k += 0.01) {
        const p = chainBridgePoint(s, k);
        expect(Math.hypot(p.z - prev.z, p.y - prev.y)).toBeLessThan(2.5);
        prev = p;
      }
    }
    expect(chainBridgeCrust(0)).toBe(0);
    expect(chainBridgeCrust(CHAIN_BRIDGE_LAND)).toBe(0);
    expect(chainBridgeCrust(1)).toBe(1);
  });
});
