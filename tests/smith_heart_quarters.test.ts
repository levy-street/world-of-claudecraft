// The Anvil of the World's four quarters (phase 2K, design doc section 5.21):
// the pure geometry core src/sim/content/smith_heart_quarters.ts that the
// renderer and the future fight read.
//   - each altar stands in its own vein's quarter, well clear of the ridges;
//   - the central ring wins inside its radius, the quarters outside it;
//   - a ridge's centre line is the border: a hair either side reads the two
//     neighbouring quarters, the line itself the clockwise one;
//   - the ridges curve (swept at the ring, straight out at the rim) and end
//     clear of the Heart Bridge's landing;
//   - turning a point a quarter turn about the centre turns its quarter by
//     one (the pinwheel is rotation-invariant);
//   - neighbours, ridges between them, preview spots inside their quarters.

import { describe, expect, it } from 'vitest';
import {
  HEART_ALTARS,
  HEART_BRIDGE_GATE,
  HEART_ROOM,
  HEART_TERRACE,
} from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTER_ZONES,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterIndexAt,
  heartQuarterRidges,
  heartQuarterSpot,
  heartRidgeBearingDeg,
  heartRidgeBetween,
  heartRidgeDistance,
  heartRidgePoint,
  heartRoomBearingDeg,
} from '../src/sim/content/smith_heart_quarters';

const C = HEART_ROOM;
const at = (deg: number, r: number) => ({
  x: C.x + Math.sin((deg * Math.PI) / 180) * r,
  z: C.z + Math.cos((deg * Math.PI) / 180) * r,
});

describe('the four quarters: the order and the altars', () => {
  it('orders the quarters clockwise from north by their altars', () => {
    expect(HEART_QUARTER_ORDER).toEqual(['breath', 'quench', 'hammer', 'heat']);
    expect(HEART_QUARTER_ZONES).toEqual(['breath', 'quench', 'hammer', 'heat', 'ring']);
  });

  it('stands each altar in its own quarter, its whole collider clear of every ridge', () => {
    for (const a of HEART_ALTARS) {
      expect(heartQuarterAt(a.x, a.z), a.vein).toBe(a.vein);
      for (let k = 0; k < 4; k++) {
        // The collider's radius (3) and the ridge's foot, with room to spare.
        expect(heartRidgeDistance(k, a.x, a.z), `${a.vein} ridge ${k}`).toBeGreaterThan(
          3 + HEART_QUARTERS.ridgeHalfWidth + 8,
        );
      }
    }
  });
});

describe('the central ring and the quarters round it', () => {
  it('reads the ring inside its radius, a quarter just outside', () => {
    for (let deg = 0; deg < 360; deg += 7.5) {
      expect(heartQuarterAt(at(deg, 0.01).x, at(deg, 0.01).z)).toBe('ring');
      const inside = at(deg, HEART_QUARTERS.ringR - 0.01);
      expect(heartQuarterAt(inside.x, inside.z)).toBe('ring');
      const outside = at(deg, HEART_QUARTERS.ringR + 0.01);
      expect(heartQuarterAt(outside.x, outside.z)).not.toBe('ring');
    }
    expect(heartQuarterAt(C.x, C.z)).toBe('ring');
  });

  it('splits the walk into four quarters of equal share', () => {
    const count = new Map<string, number>();
    for (let r = HEART_QUARTERS.ringR + 0.5; r < C.r; r += 1)
      for (let deg = 0; deg < 360; deg += 1) {
        const p = at(deg, r);
        const z = heartQuarterAt(p.x, p.z);
        count.set(z, (count.get(z) ?? 0) + 1);
      }
    const values = [...count.values()];
    expect(count.size).toBe(4);
    for (const v of values) expect(v).toBe(values[0]);
  });
});

describe('the ridges', () => {
  it('is the border: a hair either side reads its two neighbours, the line the clockwise one', () => {
    for (let k = 0; k < 4; k++) {
      for (let r = HEART_QUARTERS.ringR + 0.2; r < C.r; r += 1.3) {
        const b = heartRidgeBearingDeg(k, r);
        const hair = (0.02 / r) * (180 / Math.PI);
        const ccw = at(b - hair, r);
        const cw = at(b + hair, r);
        expect(heartQuarterAt(ccw.x, ccw.z), `ridge ${k} r ${r}`).toBe(HEART_QUARTER_ORDER[k]);
        expect(heartQuarterAt(cw.x, cw.z), `ridge ${k} r ${r}`).toBe(
          HEART_QUARTER_ORDER[(k + 1) % 4],
        );
        const on = heartRidgePoint(k, r);
        expect(heartQuarterIndexAt(on.x, on.z)).toBe((k + 1) % 4);
        expect(heartRidgeDistance(k, on.x, on.z)).toBeLessThan(1e-6);
      }
    }
  });

  it('curves: swept back at the ring, straight out at the rim', () => {
    const { ringR, rimR, sweepDeg, rimOffsetDeg } = HEART_QUARTERS;
    for (let k = 0; k < 4; k++) {
      expect(heartRidgeBearingDeg(k, rimR)).toBeCloseTo((45 + 90 * k + rimOffsetDeg) % 360, 9);
      expect(heartRidgeBearingDeg(k, ringR)).toBeCloseTo(
        (((45 + 90 * k + rimOffsetDeg - sweepDeg) % 360) + 360) % 360,
        9,
      );
      // Past the rim it runs straight out.
      expect(heartRidgeBearingDeg(k, rimR + 6)).toBeCloseTo(heartRidgeBearingDeg(k, rimR), 9);
      // The turn per yard is steepest at the ring and never turns back.
      let prev = -1;
      let firstStep = 0;
      for (let r = ringR; r <= rimR; r += 1) {
        const step = (heartRidgeBearingDeg(k, r + 1) - heartRidgeBearingDeg(k, r) + 360) % 360;
        if (r === ringR) firstStep = step;
        expect(step).toBeLessThan(10);
        if (prev >= 0) expect(step).toBeLessThanOrEqual(prev + 1e-9);
        prev = step;
      }
      expect(firstStep).toBeGreaterThan(3);
    }
  });

  it('ends every ridge clear of the Heart Bridge where it lands on the rim', () => {
    const bridge = heartRoomBearingDeg(HEART_TERRACE.x, HEART_TERRACE.z);
    expect(bridge).toBeCloseTo(225, 6);
    // The bridge is 7 yd either side of its line; its newels a little more.
    const half = (Math.asin(7 / C.r) * 180) / Math.PI + 2;
    for (let k = 0; k < 4; k++) {
      const end = heartRidgeBearingDeg(k, C.r);
      const off = Math.abs(((end - bridge + 540) % 360) - 180) * (Math.PI / 180) * C.r;
      expect(off, `ridge ${k}`).toBeGreaterThan(half * (Math.PI / 180) * C.r + 3);
    }
    // The gate on the bridge stands in no ridge's way either.
    expect(heartQuarterAt(HEART_BRIDGE_GATE.x, HEART_BRIDGE_GATE.z)).not.toBe('ring');
  });

  it('names the ridge between two neighbours, none between opposites or the ring', () => {
    expect(heartRidgeBetween('breath', 'quench')).toBe(0);
    expect(heartRidgeBetween('quench', 'breath')).toBe(0);
    expect(heartRidgeBetween('quench', 'hammer')).toBe(1);
    expect(heartRidgeBetween('hammer', 'heat')).toBe(2);
    expect(heartRidgeBetween('heat', 'breath')).toBe(3);
    expect(heartRidgeBetween('breath', 'hammer')).toBeNull();
    expect(heartRidgeBetween('heat', 'quench')).toBeNull();
    expect(heartRidgeBetween('ring', 'heat')).toBeNull();
    expect(heartRidgeBetween('heat', 'heat')).toBeNull();
    for (const v of HEART_QUARTER_ORDER) {
      const [a, b] = heartQuarterRidges(v);
      const i = HEART_QUARTER_ORDER.indexOf(v);
      expect(heartRidgeBetween(HEART_QUARTER_ORDER[(i + 3) % 4], v)).toBe(a);
      expect(heartRidgeBetween(v, HEART_QUARTER_ORDER[(i + 1) % 4])).toBe(b);
    }
  });
});

describe('rotation invariance', () => {
  it('turns a point a quarter turn and its quarter by one, its ridge distances with it', () => {
    for (let r = HEART_QUARTERS.ringR + 0.3; r < C.r + 4; r += 2.1)
      for (let deg = 0; deg < 360; deg += 3.7) {
        const p = at(deg, r);
        const q = at(deg + 90, r);
        const i = heartQuarterIndexAt(p.x, p.z);
        expect(heartQuarterIndexAt(q.x, q.z), `r ${r} deg ${deg}`).toBe((i + 1) % 4);
        for (let k = 0; k < 4; k++)
          expect(heartRidgeDistance((k + 1) % 4, q.x, q.z)).toBeCloseTo(
            heartRidgeDistance(k, p.x, p.z),
            6,
          );
      }
  });
});

describe('the preview spots', () => {
  it('stands the boss in the middle of each quarter, the ring at the centre', () => {
    for (const zone of HEART_QUARTER_ZONES) {
      const s = heartQuarterSpot(zone);
      expect(heartQuarterAt(s.x, s.z)).toBe(zone);
      if (zone === 'ring') {
        expect(s).toEqual({ x: C.x, z: C.z });
        continue;
      }
      const [a, b] = heartQuarterRidges(zone);
      // Equally far from both its ridges, and clear of its altar.
      expect(heartRidgeDistance(a, s.x, s.z)).toBeCloseTo(heartRidgeDistance(b, s.x, s.z), 6);
      expect(heartRidgeDistance(a, s.x, s.z)).toBeGreaterThan(12);
      const altar = HEART_ALTARS.find((q) => q.vein === zone);
      if (altar) expect(Math.hypot(altar.x - s.x, altar.z - s.z)).toBeGreaterThan(10);
    }
  });

  it('is pure: the same answers every call', () => {
    const a = HEART_QUARTER_ZONES.map((z) => heartQuarterSpot(z));
    const b = HEART_QUARTER_ZONES.map((z) => heartQuarterSpot(z));
    expect(b).toEqual(a);
    expect(heartQuarterAt(C.x + 20, C.z - 5)).toBe(heartQuarterAt(C.x + 20, C.z - 5));
  });
});
