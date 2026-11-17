// The Gyre's wind as geometry (src/render/gyre_wind_core.ts): the chevron ribbon laid on each gale
// lane, the translucent ribbons of air and the leaves and feathers they carry, and the spiral of
// wisps at each launch pocket. Node-only (RENDER_PURE_CORES): no Three, no DOM.

import { describe, expect, it } from 'vitest';
import {
  buildLaneRibbons,
  buildLaneStrands,
  buildPocketSpirals,
  buildStrandRibbons,
  buildWindMotes,
  FEATHERS_PER_LANE,
  LEAVES_PER_LANE,
  type MotePose,
  motePose,
  padSpots,
  pocketSpots,
  type RibbonOptions,
  SPIRAL_LEAN,
  SPIRAL_STRANDS,
  STRANDS_PER_LANE,
  sampleLane,
  sampleRange,
  strandLateral,
  strandPointAt,
  WIND_LANES,
} from '../src/render/gyre_wind_core';
import { GYRE_WIND_PADS } from '../src/sim/quartered_gyre_pads';
import {
  GYRE_LAUNCH_POCKETS,
  GYRE_PATH_YARDS,
  GYRE_WIND_LANES,
  gyreTAtYards,
} from '../src/sim/quartered_gyre_wind';
import { GYRE_PEAK, gyrePathAt, gyrePathPoint } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);
const OPT: RibbonOptions = { width: 4, step: 1, lift: 0.1, tile: 6 };

describe('a lane sampled along its centre line', () => {
  const lane = GYRE_WIND_LANES[4];
  const samples = sampleLane(lane, 1);

  it('runs from the lane start to its end on the path, every yard or so', () => {
    expect(WIND_LANES).toBe(GYRE_WIND_LANES);
    const first = gyrePathPoint(gyreTAtYards(lane.yd0));
    const last = gyrePathPoint(gyreTAtYards(lane.yd1));
    expect(samples[0].x).toBeCloseTo(first.x, 9);
    expect(samples[samples.length - 1].z).toBeCloseTo(last.z, 9);
    expect(samples[0].along).toBe(0);
    expect(samples[samples.length - 1].along).toBeCloseTo(lane.yd1 - lane.yd0, 9);
    for (let k = 1; k < samples.length; k++) {
      const d = Math.hypot(samples[k].x - samples[k - 1].x, samples[k].z - samples[k - 1].z);
      expect(d).toBeGreaterThan(0.7);
      expect(d).toBeLessThan(1.3);
    }
  });

  it('carries unit frames: up the climb, and out over the drop', () => {
    for (const s of samples) {
      expect(Math.hypot(s.tx, s.tz)).toBeCloseTo(1, 6);
      expect(Math.hypot(s.ox, s.oz)).toBeCloseTo(1, 6);
      // out is away from the peak's axis, and at right angles to the way up
      const out = Math.atan2(s.z - GYRE_PEAK.z, s.x - GYRE_PEAK.x);
      expect(Math.atan2(s.oz, s.ox)).toBeCloseTo(out, 6);
      expect(Math.abs(s.tx * s.ox + s.tz * s.oz)).toBeLessThan(0.12);
    }
    // up the climb is the way the path runs: toward the next sample
    for (let k = 0; k + 1 < samples.length; k++) {
      const dx = samples[k + 1].x - samples[k].x;
      const dz = samples[k + 1].z - samples[k].z;
      expect(dx * samples[k].tx + dz * samples[k].tz).toBeGreaterThan(0);
    }
  });
});

describe('the lane ribbons', () => {
  const rib = buildLaneRibbons(GYRE_WIND_LANES, ground, OPT);
  const verts = rib.positions.length / 3;

  it('are one indexed strip per lane, every index inside the vertex list', () => {
    expect(rib.uvs.length / 2).toBe(verts);
    expect(rib.indices.length % 6).toBe(0);
    for (const i of rib.indices) expect(i).toBeLessThan(verts);
    let expected = 0;
    for (const lane of GYRE_WIND_LANES) expected += (sampleLane(lane, OPT.step).length - 1) * 6;
    expect(rib.indices.length).toBe(expected);
  });

  it('lie on the road: every vertex is on the path, a hand over the ground', () => {
    for (let i = 0; i < verts; i++) {
      const x = rib.positions[i * 3];
      const y = rib.positions[i * 3 + 1];
      const z = rib.positions[i * 3 + 2];
      expect(gyrePathAt(x, z), `vertex ${i}`).not.toBeNull();
      expect(y - ground(x, z), `vertex ${i}`).toBeCloseTo(OPT.lift, 3);
    }
  });

  it('are as wide as asked, drop side on u 0, and run up the climb in v', () => {
    // vertices come in (drop side, inside) pairs along each lane
    for (let i = 0; i < verts; i += 2) {
      const w = Math.hypot(
        rib.positions[i * 3] - rib.positions[(i + 1) * 3],
        rib.positions[i * 3 + 2] - rib.positions[(i + 1) * 3 + 2],
      );
      expect(w).toBeCloseTo(OPT.width, 3);
      // the u = 0 vertex is the one out over the drop: farther from the peak's axis
      const rOut = Math.hypot(
        rib.positions[i * 3] - GYRE_PEAK.x,
        rib.positions[i * 3 + 2] - GYRE_PEAK.z,
      );
      const rIn = Math.hypot(
        rib.positions[(i + 1) * 3] - GYRE_PEAK.x,
        rib.positions[(i + 1) * 3 + 2] - GYRE_PEAK.z,
      );
      expect(rOut - rIn).toBeCloseTo(OPT.width, 2);
      expect(rib.uvs[i * 2]).toBe(0);
      expect(rib.uvs[(i + 1) * 2]).toBe(1);
      expect(rib.uvs[i * 2 + 1]).toBe(rib.uvs[(i + 1) * 2 + 1]);
    }
    // v starts at each lane's own distance up the path and only grows along it
    let at = 0;
    for (const lane of GYRE_WIND_LANES) {
      const n = sampleLane(lane, OPT.step).length;
      expect(rib.uvs[at * 4 + 1]).toBeCloseTo(lane.yd0 / OPT.tile, 4);
      for (let k = 1; k < n; k++) {
        expect(rib.uvs[(at + k) * 4 + 1]).toBeGreaterThan(rib.uvs[(at + k - 1) * 4 + 1]);
      }
      at += n;
    }
  });
});

describe('the pocket spots', () => {
  it('stand at every launch pocket', () => {
    expect(pocketSpots()).toBe(GYRE_LAUNCH_POCKETS);
  });
});

describe('the wind pad spots', () => {
  it('stands an upright updraft on the ground at the centre of each wind pad', () => {
    const ground = (x: number, z: number) => 3 + x * 0.01 + z * 0.001;
    const spots = padSpots(ground);
    expect(spots).toHaveLength(GYRE_WIND_PADS.length);
    for (const [i, pad] of GYRE_WIND_PADS.entries()) {
      expect(spots[i]).toEqual({ x: pad.x, y: ground(pad.x, pad.z), z: pad.z });
      // no lean: a pad's spiral stands straight up
      expect(spots[i].ox).toBeUndefined();
      expect(spots[i].oz).toBeUndefined();
    }
    // the spirals build for them as for the pockets, upright
    const geo = buildPocketSpirals(spots);
    expect(geo.positions.length).toBeGreaterThan(0);
  });
});

describe('a range of the path sampled in yards', () => {
  it('runs end to end in even steps, both ends included', () => {
    const pts = sampleRange(40, 52, 1.5);
    expect(pts.length).toBe(9);
    expect(pts[0].along).toBe(0);
    expect(pts[pts.length - 1].along).toBeCloseTo(12, 9);
    const first = gyrePathPoint(gyreTAtYards(40));
    const last = gyrePathPoint(gyreTAtYards(52));
    expect(pts[0].x).toBeCloseTo(first.x, 9);
    expect(pts[0].z).toBeCloseTo(first.z, 9);
    expect(pts[8].x).toBeCloseTo(last.x, 9);
    expect(pts[8].z).toBeCloseTo(last.z, 9);
  });

  it('still gives a start and an end for a span shorter than one step', () => {
    expect(sampleRange(10, 10.2, 1).length).toBe(2);
  });
});

describe('the ribbons of air', () => {
  const strands = buildLaneStrands(GYRE_WIND_LANES, ground);

  it('are STRANDS_PER_LANE to a lane, each running its lane and a little past both ends', () => {
    expect(strands.length).toBe(GYRE_WIND_LANES.length * STRANDS_PER_LANE);
    strands.forEach((st, i) => {
      const li = Math.floor(i / STRANDS_PER_LANE);
      const lane = GYRE_WIND_LANES[li];
      expect(st.lane).toBe(li);
      expect(st.yd0).toBeLessThanOrEqual(lane.yd0);
      expect(st.yd0).toBeGreaterThanOrEqual(Math.max(0, lane.yd0 - 5.01));
      expect(st.yd1).toBeGreaterThanOrEqual(lane.yd1);
      expect(st.yd1).toBeLessThanOrEqual(lane.yd1 + 5.01);
      expect(st.len).toBeCloseTo(st.yd1 - st.yd0, 9);
      // the spacing is the span cut into whole samples
      expect(st.step * (st.pts.length / 3 - 1)).toBeCloseTo(st.len, 9);
    });
  });

  it('stay over the road, inside the railing, a little above the ground', () => {
    for (const st of strands) {
      for (let k = 0; k < st.pts.length / 3; k++) {
        const x = st.pts[k * 3];
        const y = st.pts[k * 3 + 1];
        const z = st.pts[k * 3 + 2];
        const at = gyrePathAt(x, z);
        expect(at, `lane ${st.lane} sample ${k}`).not.toBeNull();
        expect(Math.abs(at?.off ?? 99), `lane ${st.lane} sample ${k}`).toBeLessThanOrEqual(
          3 + 1e-3,
        );
        expect(y - ground(x, z), `lane ${st.lane} sample ${k}`).toBeGreaterThan(0.05);
        expect(y - ground(x, z), `lane ${st.lane} sample ${k}`).toBeLessThan(2.2);
      }
    }
  });

  it('are thin, each at its own tilt, and no two show the same dashes', () => {
    const offsets = new Set<number>();
    for (const st of strands) {
      expect(st.width).toBeGreaterThanOrEqual(0.7);
      expect(st.width).toBeLessThanOrEqual(1.5);
      expect(st.tilt).toBeGreaterThanOrEqual(-0.2);
      expect(st.tilt).toBeLessThanOrEqual(2.4);
      offsets.add(st.vOffset);
    }
    expect(offsets.size).toBe(strands.length);
  });

  it('are the same wind on every build', () => {
    const again = buildLaneStrands(GYRE_WIND_LANES, ground);
    expect(again.length).toBe(strands.length);
    for (let i = 0; i < strands.length; i++) {
      expect(again[i].tilt).toBe(strands[i].tilt);
      expect(again[i].width).toBe(strands[i].width);
      expect(again[i].yd0).toBe(strands[i].yd0);
      expect(again[i].yd1).toBe(strands[i].yd1);
      expect(again[i].vOffset).toBe(strands[i].vOffset);
      expect(Array.from(again[i].pts)).toEqual(Array.from(strands[i].pts));
    }
  });
});

describe('a point along a strand', () => {
  // a straight strand on the x axis, 20 yards long, a sample a yard, 5 yards up
  const pts = new Float32Array(21 * 3);
  for (let k = 0; k <= 20; k++) pts.set([k, 5 + k * 0.1, 0], k * 3);
  const st = { pts, step: 1, len: 20 };
  const out = { x: 0, y: 0, z: 0 };

  it('is the first sample at the start and the last at the end', () => {
    strandPointAt(st, 0, out);
    expect([out.x, out.y, out.z]).toEqual([0, 5, 0]);
    strandPointAt(st, 20, out);
    expect(out.x).toBeCloseTo(20, 6);
    expect(out.y).toBeCloseTo(7, 6);
  });

  it('blends the two samples either side of it', () => {
    strandPointAt(st, 6.25, out);
    expect(out.x).toBeCloseTo(6.25, 6);
    expect(out.y).toBeCloseTo(5.625, 6);
  });

  it('stays on the strand past either end', () => {
    strandPointAt(st, -4, out);
    expect(out.x).toBe(0);
    strandPointAt(st, 31, out);
    expect(out.x).toBeCloseTo(20, 6);
  });
});

describe('the ribbons of air as geometry', () => {
  const strands = buildLaneStrands(GYRE_WIND_LANES, ground);
  const rib = buildStrandRibbons(strands);
  const verts = rib.positions.length / 3;
  /** the width of strand-sample k of the strand starting at vertex pair `at` */
  const widthAt = (at: number, k: number) => {
    const a = (at + k) * 2;
    return Math.hypot(
      rib.positions[a * 3] - rib.positions[(a + 1) * 3],
      rib.positions[a * 3 + 1] - rib.positions[(a + 1) * 3 + 1],
      rib.positions[a * 3 + 2] - rib.positions[(a + 1) * 3 + 2],
    );
  };

  it('are one indexed strip per strand, every index inside the vertex list', () => {
    expect(rib.uvs.length / 2).toBe(verts);
    let expectedVerts = 0;
    let expectedIdx = 0;
    for (const st of strands) {
      const n = st.pts.length / 3;
      expectedVerts += n * 2;
      expectedIdx += (n - 1) * 6;
    }
    expect(verts).toBe(expectedVerts);
    expect(rib.indices.length).toBe(expectedIdx);
    for (const i of rib.indices) expect(i).toBeLessThan(verts);
  });

  it('are gone at both ends and as wide as asked between', () => {
    let at = 0;
    for (const st of strands) {
      const n = st.pts.length / 3;
      expect(widthAt(at, 0)).toBe(0);
      expect(widthAt(at, n - 1)).toBe(0);
      const mid = widthAt(at, Math.floor(n / 2));
      expect(mid).toBeGreaterThan(st.width * 0.9);
      expect(mid).toBeLessThanOrEqual(st.width + 1e-3);
      at += n;
    }
  });

  it('texture across in u, and along in v which only grows from the strand offset', () => {
    let at = 0;
    for (const st of strands) {
      const n = st.pts.length / 3;
      expect(rib.uvs[at * 4 + 1]).toBeCloseTo(st.vOffset, 5);
      for (let k = 0; k < n; k++) {
        const a = (at + k) * 2;
        expect(rib.uvs[a * 2]).toBe(0);
        expect(rib.uvs[(a + 1) * 2]).toBe(1);
        expect(rib.uvs[a * 2 + 1]).toBe(rib.uvs[(a + 1) * 2 + 1]);
        if (k > 0) expect(rib.uvs[a * 2 + 1]).toBeGreaterThan(rib.uvs[(a - 2) * 2 + 1]);
      }
      at += n;
    }
  });
});

describe('the pocket spirals', () => {
  const spots = pocketSpots();
  const sp = buildPocketSpirals(spots);
  const verts = sp.positions.length / 3;

  it('are SPIRAL_STRANDS wisps to a pocket, every index inside the vertex list', () => {
    expect(sp.uvs.length / 2).toBe(verts);
    // 30 samples to a wisp, two vertices to a sample
    expect(verts).toBe(spots.length * SPIRAL_STRANDS * 60);
    expect(sp.indices.length % 6).toBe(0);
    for (const i of sp.indices) expect(i).toBeLessThan(verts);
  });

  it('rise out of each pad, leaning in toward the mountain, within a few yards of the leaning axis', () => {
    const per = verts / spots.length;
    spots.forEach((spot, pi) => {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let inward = 0;
      for (let i = pi * per; i < (pi + 1) * per; i++) {
        const h = sp.positions[i * 3 + 1] - spot.y;
        // the axis the wisps wind round: up from the pad, bent in toward the peak as it rises
        const lean = SPIRAL_LEAN * Math.max(0, h - 0.1);
        const ax = spot.x - spot.ox * lean;
        const az = spot.z - spot.oz * lean;
        const dx = sp.positions[i * 3] - ax;
        const dz = sp.positions[i * 3 + 2] - az;
        expect(Math.hypot(dx, dz), `pocket ${pi} vertex ${i}`).toBeLessThan(2.9);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        if (h > 10) {
          // inward is away from the drop's direction
          inward = Math.max(
            inward,
            -(
              (sp.positions[i * 3] - spot.x) * spot.ox +
              (sp.positions[i * 3 + 2] - spot.z) * spot.oz
            ),
          );
        }
      }
      expect(lo, `pocket ${pi}`).toBeGreaterThanOrEqual(0.05);
      expect(hi, `pocket ${pi}`).toBeGreaterThan(10);
      // near the top the column stands well in from the pad
      expect(inward, `pocket ${pi}`).toBeGreaterThan(SPIRAL_LEAN * 10 - 1);
    });
  });
});

describe('the leaves and feathers', () => {
  const strands = buildLaneStrands(GYRE_WIND_LANES, ground);
  const motes = buildWindMotes(strands);

  it('are LEAVES_PER_LANE leaves and FEATHERS_PER_LANE feathers to a lane, on its own strands', () => {
    const leaves = motes.filter((m) => m.kind === 'leaf').length;
    const feathers = motes.filter((m) => m.kind === 'feather').length;
    expect(leaves).toBe(GYRE_WIND_LANES.length * LEAVES_PER_LANE);
    expect(feathers).toBe(GYRE_WIND_LANES.length * FEATHERS_PER_LANE);
    const perLane = new Map<number, number>();
    for (const m of motes) {
      const st = strands[m.strand];
      perLane.set(st.lane, (perLane.get(st.lane) ?? 0) + 1);
      expect(m.s0).toBeGreaterThanOrEqual(0);
      expect(m.s0).toBeLessThan(st.len);
      expect(m.speed).toBeGreaterThan(0);
      expect(m.size).toBeGreaterThan(0.3);
      expect(m.size).toBeLessThan(0.9);
    }
    for (let l = 0; l < GYRE_WIND_LANES.length; l++) {
      expect(perLane.get(l)).toBe(LEAVES_PER_LANE + FEATHERS_PER_LANE);
    }
  });

  it('are the same on every build', () => {
    expect(buildWindMotes(strands)).toEqual(motes);
  });

  it('ride their strand: never farther off it than their drift', () => {
    const out: MotePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    const on = { x: 0, y: 0, z: 0 };
    for (const m of motes) {
      const st = strands[m.strand];
      for (const t of [0, 0.37, 4.2, 31.5, 400]) {
        motePose(m, st, t, out);
        const s = (((m.s0 + m.speed * t) % st.len) + st.len) % st.len;
        strandPointAt(st, s, on);
        expect(Math.abs(out.x - on.x)).toBeLessThanOrEqual(Math.abs(m.drift[0]) + 1e-9);
        expect(Math.abs(out.z - on.z)).toBeLessThanOrEqual(Math.abs(m.drift[0]) + 1e-9);
        // the up-drift is its second drift times a factor between 0.2 and 1
        const dy = out.y - on.y;
        expect(dy).toBeGreaterThanOrEqual(Math.min(m.drift[1] * 0.2, m.drift[1]) - 1e-9);
        expect(dy).toBeLessThanOrEqual(Math.max(m.drift[1] * 0.2, m.drift[1]) + 1e-9);
      }
    }
  });
});

describe('a leaf carried down a straight strand', () => {
  // 20 yards on the x axis at height 5, a sample a yard
  const pts = new Float32Array(21 * 3);
  for (let k = 0; k <= 20; k++) pts.set([k, 5, 0], k * 3);
  const st = { lane: 0, yd0: 0, yd1: 20, len: 20, step: 1, width: 1, tilt: 0, vOffset: 0, pts };
  const leaf = {
    kind: 'leaf' as const,
    strand: 0,
    s0: 6,
    speed: 10,
    drift: [0, 0] as [number, number],
    spin: [1, 2, 3] as [number, number, number],
    angle: [0.1, 0.2, 0.3] as [number, number, number],
    size: 0.5,
  };
  const out: MotePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

  it('moves at its speed, and wraps to the start at the end', () => {
    motePose(leaf, st, 0, out);
    expect([out.x, out.y, out.z]).toEqual([6, 5, 0]);
    motePose(leaf, st, 0.5, out);
    expect(out.x).toBeCloseTo(11, 9);
    // 6 + 10 * 1.5 = 21, one yard past the end: back to 1
    motePose(leaf, st, 1.5, out);
    expect(out.x).toBeCloseTo(1, 9);
    // a whole lap later it is where it began
    motePose(leaf, st, 2, out);
    expect(out.x).toBeCloseTo(6, 9);
  });

  it('tumbles at its spin rates from its starting angles', () => {
    motePose(leaf, st, 2, out);
    expect(out.rx).toBeCloseTo(0.1 + 2, 9);
    expect(out.ry).toBeCloseTo(0.2 + 4, 9);
    expect(out.rz).toBeCloseTo(0.3 + 6, 9);
  });
});

describe('the lane strands reach past the lane ends', () => {
  it('run at least three yards beyond each end of their lane', () => {
    for (const st of buildLaneStrands(GYRE_WIND_LANES, ground)) {
      const lane = GYRE_WIND_LANES[st.lane];
      expect(lane.yd0 - st.yd0).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(st.yd1 - lane.yd1).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });

  it('stop at the foot and at the crown of the path however near a lane runs to them', () => {
    const nearFoot = { ...GYRE_WIND_LANES[0], yd0: 1, yd1: 10 };
    for (const st of buildLaneStrands([nearFoot], ground)) expect(st.yd0).toBe(0);
    const nearCrown = {
      ...GYRE_WIND_LANES[0],
      yd0: GYRE_PATH_YARDS - 10,
      yd1: GYRE_PATH_YARDS - 1,
    };
    for (const st of buildLaneStrands([nearCrown], ground)) expect(st.yd1).toBe(GYRE_PATH_YARDS);
  });
});

describe('a strand swing off the centre line', () => {
  // (s, amp, wave, phase, amp2, wave2, phase2)
  it('is two sines summed', () => {
    expect(strandLateral(0.25, 1, 1, 0, 0, 1, 0)).toBeCloseTo(1, 9);
    expect(strandLateral(0, 2, 1, 0, 0.5, 1, 0)).toBeCloseTo(0, 9);
    expect(strandLateral(0.25, 1, 1, 0, 0.5, 1, 0)).toBeCloseTo(1.5, 9);
  });

  it('is held inside the railing: three yards out over the drop or in, no more', () => {
    expect(strandLateral(0.25, 5, 1, 0, 0, 1, 0)).toBe(3);
    expect(strandLateral(0.75, 5, 1, 0, 0, 1, 0)).toBe(-3);
  });
});

describe('the pocket spirals, wisp by wisp', () => {
  const spots = pocketSpots();
  const sp = buildPocketSpirals(spots);

  it('turn both ways, alternately, one to two full turns each', () => {
    spots.forEach((spot, pi) => {
      for (let j = 0; j < SPIRAL_STRANDS; j++) {
        const base = (pi * SPIRAL_STRANDS + j) * 60;
        let sweep = 0;
        let prev = 0;
        for (let k = 0; k < 30; k++) {
          const a = base + k * 2;
          const cy = (sp.positions[a * 3 + 1] + sp.positions[(a + 1) * 3 + 1]) / 2;
          const lean = SPIRAL_LEAN * Math.max(0, cy - spot.y - 0.1);
          const cx =
            (sp.positions[a * 3] + sp.positions[(a + 1) * 3]) / 2 - (spot.x - spot.ox * lean);
          const cz =
            (sp.positions[a * 3 + 2] + sp.positions[(a + 1) * 3 + 2]) / 2 -
            (spot.z - spot.oz * lean);
          const ang = Math.atan2(cz, cx);
          if (k > 0) {
            let d = ang - prev;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            sweep += d;
          }
          prev = ang;
        }
        expect(Math.sign(sweep), `pocket ${pi} wisp ${j}`).toBe(j % 2 === 0 ? 1 : -1);
        expect(Math.abs(sweep), `pocket ${pi} wisp ${j}`).toBeGreaterThan(6.5);
        expect(Math.abs(sweep), `pocket ${pi} wisp ${j}`).toBeLessThan(13);
      }
    });
  });

  it('stand on edge or lean flat in turn, so one or the other faces the eye from any side', () => {
    spots.forEach((_, pi) => {
      for (let j = 0; j < SPIRAL_STRANDS; j++) {
        // the middle sample's pair of vertices: how much of its width stands up
        const a = (pi * SPIRAL_STRANDS + j) * 60 + 30;
        const w = Math.hypot(
          sp.positions[a * 3] - sp.positions[(a + 1) * 3],
          sp.positions[a * 3 + 1] - sp.positions[(a + 1) * 3 + 1],
          sp.positions[a * 3 + 2] - sp.positions[(a + 1) * 3 + 2],
        );
        const up = Math.abs(sp.positions[a * 3 + 1] - sp.positions[(a + 1) * 3 + 1]) / w;
        expect(up, `pocket ${pi} wisp ${j}`).toBeCloseTo(Math.sin(j % 3 === 2 ? 0.9 : 1.5), 2);
      }
    });
  });
});

describe('a leaf carried backwards or to the exact end', () => {
  const pts = new Float32Array(21 * 3);
  for (let k = 0; k <= 20; k++) pts.set([k, 5, 0], k * 3);
  const st = { lane: 0, yd0: 0, yd1: 20, len: 20, step: 1, width: 1, tilt: 0, vOffset: 0, pts };
  const leaf = {
    kind: 'leaf' as const,
    strand: 0,
    s0: 6,
    speed: 10,
    drift: [0, 0] as [number, number],
    spin: [0, 0, 0] as [number, number, number],
    angle: [0, 0, 0] as [number, number, number],
    size: 0.5,
  };
  const out: MotePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

  it('wraps a position before the start round to the far end', () => {
    // 6 + 10 * -0.7 = -1: one yard before the start is 19 yards up the strand
    motePose(leaf, st, -0.7, out);
    expect(out.x).toBeCloseTo(19, 9);
  });

  it('wraps the exact end to the start', () => {
    motePose({ ...leaf, s0: 0 }, st, 2, out);
    expect(out.x).toBe(0);
  });
});

describe('the figures the painter relies on', () => {
  it('are pinned', () => {
    expect(STRANDS_PER_LANE).toBe(5);
    expect(LEAVES_PER_LANE).toBe(5);
    expect(FEATHERS_PER_LANE).toBe(2);
    expect(SPIRAL_STRANDS).toBe(6);
  });
});
