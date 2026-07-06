// Hodric's Castle course layout: geometry integrity, band placement, and the
// analytic obstacle motion contract (pure functions of absolute sim time,
// zero rng). These pins protect the "what you see is what you collide with"
// guarantee shared by sim/hodrics_layout.ts consumers on both sides.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import {
  DELVE_BAND_X_MAX,
  DELVE_LIST,
  DELVE_X_MIN,
  HODRICS_X_MAX,
  HODRICS_X_MIN,
  hodricsOrigin,
  hodricsOriginAt,
  isDelvePos,
  isHodricsPos,
} from '../src/sim/data';
import {
  HC_AXES,
  HC_BOULDER_LANES,
  HC_CHASM_Y,
  HC_CHECKPOINTS,
  HC_DRAWSPANS,
  HC_FIELD_SIZE,
  HC_FINISH_Z,
  HC_FLAILS,
  HC_KILL_Y,
  HC_ROTORS,
  HC_SURFACES,
  hcAxeHead,
  hcCheckpointSpawn,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcProgressFrac,
  hcSectionAt,
  hcStartPlate,
  hodricsColliders,
  hodricsGroundLocal,
  hodricsGroundWorld,
  hodricsSurfaceAt,
} from '../src/sim/hodrics_layout';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { groundHeight } from '../src/sim/world';

const SEED = 1337;

describe('band placement', () => {
  it('sits past the delve cap and clear of the reserved battleground band', () => {
    expect(DELVE_BAND_X_MAX).toBeLessThanOrEqual(HODRICS_X_MIN);
    // x 9600..10200 is reserved for the battleground band on its branch.
    expect(HODRICS_X_MIN).toBeGreaterThanOrEqual(10200);
    expect(HODRICS_X_MAX).toBeGreaterThan(HODRICS_X_MIN);
  });

  it('every delve fits under the band cap', () => {
    for (const d of DELVE_LIST) {
      const x = DELVE_X_MIN + d.index * 600;
      // Room footprint stays inside the capped band with margin for walls.
      expect(x + 60).toBeLessThan(DELVE_BAND_X_MAX);
      expect(isDelvePos(x)).toBe(true);
    }
  });

  it('the race band is never classified as delve or dungeon ground', () => {
    const o = hodricsOrigin(0);
    expect(isDelvePos(o.x)).toBe(false);
    expect(isHodricsPos(o.x)).toBe(true);
    expect(isHodricsPos(DELVE_X_MIN)).toBe(false);
  });

  it('hodricsOriginAt picks the nearest slot by z', () => {
    const o0 = hodricsOrigin(0);
    const o1 = hodricsOrigin(1);
    expect(hodricsOriginAt(o0.z + 10).slot).toBe(0);
    expect(hodricsOriginAt(o1.z - 10).slot).toBe(1);
  });
});

describe('course surfaces', () => {
  it('adjacent sections meet at the same height (no seams)', () => {
    const byZ = [...HC_SURFACES].sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < byZ.length; i++) {
      const prev = byZ[i - 1];
      const next = byZ[i];
      if (prev.z1 !== next.z0) continue; // the Drawspan gap is intentional
      const prevEnd = prev.y1 ?? prev.y0;
      expect(prevEnd).toBe(next.y0);
    }
  });

  it('ramps stay under the climb limit so racers can walk them', () => {
    for (const s of HC_SURFACES) {
      if (s.y1 === undefined) continue;
      const slope = Math.abs(s.y1 - s.y0) / (s.z1 - s.z0);
      expect(slope).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('ground function: surfaces, ramps, chasm', () => {
    expect(hodricsGroundLocal(0, -100)).toBe(0); // start yard
    expect(hodricsGroundLocal(0, 96)).toBeCloseTo(4, 5); // mid boulder alley ramp
    expect(hodricsGroundLocal(0, 125)).toBe(14); // finish keep
    expect(hodricsGroundLocal(12, -70)).toBe(HC_CHASM_Y); // beside the bridge
    expect(hodricsGroundLocal(0, 68)).toBe(HC_CHASM_Y); // the Drawspan gap
    expect(HC_KILL_Y).toBeGreaterThan(HC_CHASM_Y);
  });

  it('routes through world.groundHeight for the whole band', () => {
    const o = hodricsOrigin(0);
    expect(groundHeight(o.x, o.z - 100, SEED)).toBe(0);
    expect(groundHeight(o.x, o.z + 125, SEED)).toBe(14);
    expect(groundHeight(o.x + 20, o.z - 70, SEED)).toBe(HC_CHASM_Y);
    // Slot 1 resolves independently.
    const o1 = hodricsOrigin(1);
    expect(groundHeight(o1.x, o1.z - 100, SEED)).toBe(0);
    // Other instance bands keep their flat floors.
    expect(groundHeight(4200, -1250, SEED)).toBe(0);
  });
});

describe('race line', () => {
  it('start plates seat ten racers on the yard', () => {
    const seen = new Set<string>();
    for (let seat = 0; seat < HC_FIELD_SIZE; seat++) {
      const p = hcStartPlate(seat);
      seen.add(`${p.x},${p.z}`);
      expect(hodricsSurfaceAt(p.x, p.z)?.id).toBe('start_yard');
    }
    expect(seen.size).toBe(HC_FIELD_SIZE);
  });

  it('checkpoints march forward and respawn onto solid ground', () => {
    for (let i = 1; i < HC_CHECKPOINTS.length; i++) {
      expect(HC_CHECKPOINTS[i].z).toBeGreaterThan(HC_CHECKPOINTS[i - 1].z);
    }
    for (let cp = 0; cp < HC_CHECKPOINTS.length; cp++) {
      for (let seat = 0; seat < HC_FIELD_SIZE; seat++) {
        const s = hcCheckpointSpawn(cp, seat);
        expect(hodricsGroundLocal(s.x, s.z)).toBeGreaterThan(HC_CHASM_Y);
      }
    }
    expect(HC_FINISH_Z).toBeGreaterThan(HC_CHECKPOINTS[HC_CHECKPOINTS.length - 1].z);
  });

  it('progress metric spans start to finish', () => {
    expect(hcProgressFrac(HC_CHECKPOINTS[0].z)).toBe(0);
    expect(hcProgressFrac(HC_FINISH_Z)).toBe(1);
    expect(hcProgressFrac(0)).toBeGreaterThan(0);
    expect(hcProgressFrac(0)).toBeLessThan(1);
  });

  it('section labels cover the course in order', () => {
    expect(hcSectionAt(-100)).toBe('start_yard');
    expect(hcSectionAt(-60)).toBe('flail_bridge');
    expect(hcSectionAt(-10)).toBe('log_court');
    expect(hcSectionAt(30)).toBe('axe_walk');
    expect(hcSectionAt(68)).toBe('drawspan');
    expect(hcSectionAt(96)).toBe('boulder_alley');
    expect(hcSectionAt(112)).toBe('red_ascent');
    expect(hcSectionAt(125)).toBe('finish_keep');
  });
});

describe('analytic obstacles (pure functions of time)', () => {
  it('flail bobs swing across the bridge and stay on their chains', () => {
    for (const f of HC_FLAILS) {
      const reach = f.chainLen * Math.sin(f.amp);
      for (let t = 0; t < 12; t += 0.05) {
        const b = hcFlailBob(f, t);
        expect(Math.abs(b.x)).toBeLessThanOrEqual(reach + 1e-9);
        expect(b.y).toBeGreaterThanOrEqual(f.pivotY - f.chainLen - 1e-9);
        expect(b.y).toBeLessThanOrEqual(f.pivotY - f.chainLen * Math.cos(f.amp) + 1e-9);
      }
      // Determinism: the same instant always gives the same pose.
      expect(hcFlailBob(f, 3.21)).toEqual(hcFlailBob(f, 3.21));
    }
  });

  it('axe heads sweep the full walkway width', () => {
    for (const a of HC_AXES) {
      let maxX = 0;
      for (let t = 0; t < a.period; t += 0.02) {
        maxX = Math.max(maxX, Math.abs(hcAxeHead(a, t).x));
      }
      // The blade reaches past the walk edge (x 4) so no lane is always safe.
      expect(maxX + a.headR).toBeGreaterThan(4);
    }
  });

  it('rotors turn in opposite directions', () => {
    expect(HC_ROTORS[0].omega * HC_ROTORS[1].omega).toBeLessThan(0);
    for (const r of HC_ROTORS) {
      // Jumpable: the beam top sits under the jump apex (1.125 at velocity 6).
      expect(r.beamTopY).toBeLessThan(1.125);
    }
  });

  it('drawspan platforms stay in the gap, in antiphase, at constant speed', () => {
    const [a, b] = HC_DRAWSPANS;
    const speed = ((a.xMax - a.xMin) * 2) / a.period;
    for (let t = 0; t < a.period * 2; t += 0.05) {
      const xa = hcDrawspanX(a, t);
      const xb = hcDrawspanX(b, t);
      expect(xa).toBeGreaterThanOrEqual(a.xMin - 1e-9);
      expect(xa).toBeLessThanOrEqual(a.xMax + 1e-9);
      expect(xa + xb).toBeCloseTo(a.xMin + a.xMax, 6); // mirrored pair
      const dx = Math.abs(hcDrawspanX(a, t + 0.05) - xa);
      expect(dx).toBeLessThanOrEqual(speed * 0.05 + 1e-6);
    }
    expect(hcDrawspanX(a, 1.23 + a.period)).toBeCloseTo(hcDrawspanX(a, 1.23), 9);
  });

  it('boulder lanes release on schedule and roll inside their lane', () => {
    for (const lane of HC_BOULDER_LANES) {
      const travel = (lane.zTop - lane.zEnd) / lane.speed;
      const maxActive = Math.ceil(travel / lane.period);
      for (let t = 0; t < 40; t += 0.1) {
        const list = hcLaneBoulders(lane, t);
        expect(list.length).toBeLessThanOrEqual(maxActive);
        for (const b of list) {
          expect(b.z).toBeLessThanOrEqual(lane.zTop + 1e-9);
          expect(b.z).toBeGreaterThanOrEqual(lane.zEnd - 1e-9);
          expect(b.y).toBeGreaterThan(HC_CHASM_Y);
        }
      }
      expect(hcLaneBoulders(lane, 0).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('static colliders', () => {
  it('gates stay open and walls block, through the world routing arm', () => {
    const o = hodricsOrigin(0);
    // The log court entry gate center (local 0, -35) is walkable.
    const gate = resolvePosition(SEED, o.x, o.z - 35, 0.5);
    expect(gate.x).toBeCloseTo(o.x, 5);
    expect(gate.z).toBeCloseTo(o.z - 35, 5);
    // A point inside the east log court wall (local 14, -10) is pushed out.
    const wall = resolvePosition(SEED, o.x + 14, o.z - 10, 0.5);
    expect(Math.hypot(wall.x - (o.x + 14), wall.z - (o.z - 10))).toBeGreaterThan(0.1);
  });

  it('never overlaps a start plate or checkpoint spawn', () => {
    const cols = hodricsColliders();
    const points: { x: number; z: number }[] = [];
    for (let seat = 0; seat < HC_FIELD_SIZE; seat++) {
      points.push(hcStartPlate(seat));
      for (let cp = 0; cp < HC_CHECKPOINTS.length; cp++) {
        points.push(hcCheckpointSpawn(cp, seat));
      }
    }
    for (const pt of points) {
      for (const c of cols) {
        if (c.type === 'circle') {
          expect(Math.hypot(pt.x - c.x, pt.z - c.z)).toBeGreaterThan(c.r + 0.5);
        } else {
          const dx = Math.abs(pt.x - c.x);
          const dz = Math.abs(pt.z - c.z);
          const clear = dx > c.hw + 0.5 || dz > c.hd + 0.5;
          expect(clear).toBe(true);
        }
      }
    }
  });

  it('leaves the bridge sides and the Drawspan gap open for falls', () => {
    const o = hodricsOrigin(0);
    // Walking off the bridge side is unobstructed (the fall is the point).
    const off = resolvePosition(SEED, o.x + 5.2, o.z - 62, 0.5);
    expect(off.x).toBeCloseTo(o.x + 5.2, 5);
    // Mid-gap has no floor and no collider.
    const gap = resolvePosition(SEED, o.x, o.z + 68, 0.5);
    expect(gap.z).toBeCloseTo(o.z + 68, 5);
    expect(hodricsGroundWorld(o.x, o.z + 68)).toBe(HC_CHASM_Y);
  });
});
