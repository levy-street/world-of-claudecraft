// The Ring's and the Heart's painted pass (2026-11-11; design doc section 5.26): the Ring's
// grey-mauve stone, its pit's mist and each vein's rune on its standing stones; the Heart's
// crown dressed with the four veins' own painted rock; the area clips the painted kits draw
// under; the Heat's set round its hall; the four-way skies over the Heart and the Ring.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { envAreaClip } from '../src/render/smith_heart/env_area_clip';
import {
  HEART_ENV_DRESS,
  HEART_ENV_OPEN,
  HEART_ENV_PIECES,
  heartEnvMeasure,
  heartEnvOpenGlsl,
  planHeartEnvDress,
} from '../src/render/smith_heart/heart_env_dress_core';
import {
  HEART_FOUR_SKY,
  HEART_RING_SKY,
  SMITH_HEART_FOUR_SKY_URL,
  SMITH_HEART_RING_SKY_URL,
} from '../src/render/smith_heart/heart_four_sky';
import { HEART_LANDMARK_FRAME } from '../src/render/smith_heart/heart_landmarks_core';
import {
  heartRockCoreUniform,
  heartRockHeatOpenUniform,
} from '../src/render/smith_heart/heart_rock_cutaway';
import { heartFloorClearance } from '../src/render/smith_heart/heart_walls_core';
import { HEAT_ENV_OPEN } from '../src/render/smith_heart/heat_env_plan_core';
import {
  HEAT_ENV_LAKE,
  HEAT_FALL_RIBBON,
  heatFallRibbons,
  heatLakeMesh,
  onHeatLake,
  planHeatSet,
} from '../src/render/smith_heart/heat_env_set_core';
import { planRingProps } from '../src/render/smith_heart/ring_kit_plan_core';
import {
  planRingRunes,
  RING_MIST,
  RING_RUNE,
  RING_RUNE_LIGHT,
  ringMistMesh,
  ringRuneLevel,
  ringRuneVein,
  ringRuneVeinIndex,
} from '../src/render/smith_heart/ring_set_core';
import { RING_STONE_GRADE, ringStoneGrade } from '../src/render/smith_heart/ring_stone_look';
import {
  HEART_ROOM,
  HEART_ROOM_AREA_R,
  HEART_ROOM_CHASM_R,
  RING,
  SEAL_DAIS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../src/sim/content/smith_heart_layout';

const bearingOf = (x: number, z: number, cx: number, cz: number) =>
  (Math.atan2(x - cx, z - cz) * 180) / Math.PI;
const angleOff = (a: number, b: number) => {
  const d = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return d;
};
const luma = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

describe("the Ring's runes", () => {
  const stones = planRingProps().filter((p) => RING_RUNE.stones[p.piece]);
  const runes = planRingRunes();

  it('carves one rune on every standing stone and on each of the Hammer jambs', () => {
    expect(stones.filter((p) => p.piece === 'Kit_RingMonolith').length).toBe(6);
    expect(stones.filter((p) => p.piece === 'Kit_JambHammer').length).toBe(2);
    expect(runes.length).toBe(stones.length);
  });

  it("marks each vein's mouth with its own element, every vein at least twice", () => {
    const count = Object.fromEntries(SMITH_HEART_VEINS.map((v) => [v, 0])) as Record<
      SmithHeartVein,
      number
    >;
    for (const r of runes) count[r.vein]++;
    for (const v of SMITH_HEART_VEINS) expect(count[v]).toBeGreaterThanOrEqual(2);
    // Each stone's vein is the mouth it stands by.
    expect(ringRuneVein('Kit_RingMonolith', 0, RING.outerR)).toBe('breath');
    expect(ringRuneVein('Kit_RingMonolith', RING.outerR, 0)).toBe('quench');
    expect(ringRuneVein('Kit_RingMonolith', -RING.outerR, 0)).toBe('heat');
    expect(ringRuneVein('Kit_JambHammer', 10, -60)).toBe('hammer');
    for (const v of SMITH_HEART_VEINS)
      expect(ringRuneVeinIndex(v)).toBe(SMITH_HEART_VEINS.indexOf(v));
  });

  it('sits on the face that looks into the Ring, just off the stone', () => {
    runes.forEach((r, i) => {
      const s = stones[i];
      const S = RING_RUNE.stones[s.piece];
      // Its face looks toward the Ring's middle.
      expect(r.nx * (RING.x - r.x) + r.nz * (RING.z - r.z)).toBeGreaterThan(0);
      expect(Math.hypot(r.nx, r.nz)).toBeCloseTo(1, 6);
      // Out from the stone's own frame by its face's measured depth and the clearance.
      const out = (r.x - s.x) * r.nx + (r.z - s.z) * r.nz;
      expect(out).toBeGreaterThanOrEqual(Math.min(S.front, S.back) + RING_RUNE.clear - 1e-6);
      expect(out).toBeLessThanOrEqual(Math.max(S.front, S.back) + RING_RUNE.clear + 1e-6);
      expect(r.y - s.y).toBeCloseTo(S.y, 6);
    });
  });

  it('glows low while its vein sleeps and blazes once it is lit', () => {
    expect(ringRuneLevel(-1)).toBe(RING_RUNE_LIGHT.asleep);
    let prev = ringRuneLevel(0);
    expect(prev).toBeGreaterThanOrEqual(RING_RUNE_LIGHT.asleep);
    for (let t = 0.1; t < 10; t += 0.1) {
      const l = ringRuneLevel(t);
      expect(l).toBeGreaterThanOrEqual(RING_RUNE_LIGHT.asleep);
      expect(l).toBeLessThanOrEqual(RING_RUNE_LIGHT.lit + RING_RUNE_LIGHT.flash + 1e-9);
      if (t > RING_RUNE_LIGHT.rise) expect(l).toBeCloseTo(RING_RUNE_LIGHT.lit, 9);
      prev = l;
    }
    expect(prev).toBe(RING_RUNE_LIGHT.lit);
  });
});

describe("the Ring's pit mist", () => {
  it('lies only in the pit, every sheet under the walks', () => {
    const m = ringMistMesh();
    expect(m.positions.length / 3).toBe(m.sheet.length);
    for (let i = 0; i < m.positions.length; i += 3) {
      const r = Math.hypot(m.positions[i] - RING.x, m.positions[i + 2] - RING.z);
      expect(r).toBeGreaterThan(SEAL_DAIS.r);
      expect(r).toBeLessThan(RING.innerR);
      // Under the dais (the lowest walk over the pit: the stairs fall to it), so no eye's
      // line to the seal crosses a sheet.
      expect(m.positions[i + 1]).toBeLessThan(SEAL_DAIS.h - 4);
    }
    for (const k of m.indices) expect(k).toBeLessThan(m.sheet.length);
  });

  it('keeps fewer sheets on the low tier, the deepest first', () => {
    const full = ringMistMesh();
    const low = ringMistMesh(2);
    expect(new Set(low.sheet).size).toBe(2);
    expect(low.indices.length).toBeLessThan(full.indices.length);
    const ys = RING_MIST.sheets.map((s) => s.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});

describe("the Ring's stone", () => {
  it("turns the kit's sand tan to a pale grey-mauve, the paint's value kept", () => {
    const tan: [number, number, number] = [0.5, 0.36, 0.2];
    const g = ringStoneGrade(tan);
    // Mauve: blue over green, red over green.
    expect(g[2]).toBeGreaterThan(g[1]);
    expect(g[0]).toBeGreaterThan(g[1]);
    // The value is the paint's (times its lift), within a breath.
    expect(luma(g)).toBeCloseTo(luma(tan) * RING_STONE_GRADE.lift, 2);
  });

  it("keeps every slab's own value, light over dark", () => {
    const dark = ringStoneGrade([0.2, 0.15, 0.09]);
    const light = ringStoneGrade([0.7, 0.55, 0.35]);
    expect(luma(light)).toBeGreaterThan(luma(dark) * 2);
  });
});

describe("the Heart's crown, dressed with the four veins' rock", () => {
  const plan = planHeartEnvDress();

  it("dresses every quarter with its own vein's kit pieces", () => {
    for (const v of SMITH_HEART_VEINS) {
      expect(plan[v].length).toBeGreaterThanOrEqual(8);
      const allowed = new Set([
        ...HEART_ENV_PIECES[v].near,
        ...HEART_ENV_PIECES[v].far,
        ...(HEART_ENV_PIECES[v].hero ? [HEART_ENV_PIECES[v].hero] : []),
      ]);
      for (const p of plan[v]) {
        expect(allowed.has(p.piece)).toBe(true);
        expect(() => heartEnvMeasure(v, p.piece)).not.toThrow();
      }
    }
    expect(plan.heat.some((p) => p.piece === HEART_ENV_PIECES.heat.hero)).toBe(true);
  });

  it("stands each piece behind its element's landmark, past the chasm's edge", () => {
    for (const v of SMITH_HEART_VEINS)
      for (const p of plan[v]) {
        const r = Math.hypot(p.x - HEART_ROOM.x, p.z - HEART_ROOM.z);
        expect(r).toBeGreaterThanOrEqual(HEART_ROOM_CHASM_R);
        const b = bearingOf(p.x, p.z, HEART_ROOM.x, HEART_ROOM.z);
        expect(angleOff(b, HEART_LANDMARK_FRAME.bearing[v])).toBeLessThanOrEqual(
          HEART_ENV_DRESS.arc + HEART_ENV_DRESS.jitter.deg + 1e-6,
        );
      }
  });

  it("keeps every footprint clear of the Heart's walks, no bluff grown past its cap", () => {
    for (const v of SMITH_HEART_VEINS)
      for (const p of plan[v]) {
        const m = heartEnvMeasure(v, p.piece);
        const s = p.scale ?? 1;
        expect(s).toBeLessThanOrEqual(HEART_ENV_DRESS.maxScale + 1e-9);
        expect(m.w * s).toBeLessThanOrEqual(HEART_ENV_DRESS.maxWidth + 1e-6);
        // Front corners and middle, inside the Heart's own area.
        const ux = Math.cos(p.rot);
        const uz = -Math.sin(p.rot);
        for (const k of [-1, 0, 1]) {
          const x = p.x + ux * ((m.w * s) / 2) * k;
          const z = p.z + uz * ((m.w * s) / 2) * k;
          if (Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z) > HEART_ROOM_AREA_R) continue;
          expect(heartFloorClearance(x, z).d).toBeGreaterThanOrEqual(HEART_ENV_DRESS.clear - 1e-6);
        }
      }
  });

  it('opens the mountain only between the chasm and the dressing, over its feet', () => {
    expect(HEART_ENV_OPEN.r0).toBe(HEART_ROOM_CHASM_R);
    expect(HEART_ENV_OPEN.r1).toBeGreaterThan(HEART_ENV_DRESS.tiers[1].r);
    expect(HEART_ENV_OPEN.y0).toBeGreaterThan(HEART_ROOM.h + HEART_ENV_DRESS.tiers[0].foot);
    expect(heartEnvOpenGlsl()).toContain('float heartEnvOpen( vec3 p )');
  });
});

describe("the painted kits' area clips", () => {
  it('names each area apart and shares the rock cutaway uniforms', () => {
    const band = envAreaClip('heatBand');
    const ring = envAreaClip('heatRing');
    const heart = envAreaClip('heart');
    expect(new Set([band.key, ring.key, heart.key]).size).toBe(3);
    expect(heart.uniforms.uHeartCore).toBe(heartRockCoreUniform());
    expect(band.uniforms.uHeatOpen).toBe(heartRockHeatOpenUniform());
    expect(ring.uniforms.uHeatOpen).toBe(heartRockHeatOpenUniform());
    expect(band.head).toContain('heatEnvOpen');
    expect(ring.head).not.toContain('heatEnvOpen');
  });
});

describe("the Heat's set round its hall", () => {
  it('lays the magma lake round the hall, never down the way in', () => {
    const lake = heatLakeMesh();
    for (let i = 0; i < lake.positions.length; i += 3) {
      expect(lake.positions[i + 1]).toBe(HEAT_ENV_LAKE.y);
      expect(lake.positions[i + 1]).toBeGreaterThanOrEqual(HEAT_ENV_OPEN.y0 - 1.5);
    }
    // Inside the ring of the lake, round the west; nothing due east of the hall.
    expect(onHeatLake(-214 - 100, 0)).toBe(true);
    expect(onHeatLake(-214 + 100, 0)).toBe(false);
    expect(onHeatLake(-214, 0)).toBe(false);
  });

  it('runs every fall from its ledge down to the lake, on the painted river', () => {
    const falls = heatFallRibbons();
    expect(falls.length).toBeGreaterThanOrEqual(2);
    for (const f of falls) {
      expect(f.top.y).toBeGreaterThan(f.foot.y + 20);
      expect(f.foot.y).toBe(HEAT_ENV_LAKE.y);
      expect(f.half).toBeGreaterThanOrEqual(1.2);
    }
    for (const k of Object.values(HEAT_FALL_RIBBON)) {
      expect(k.back).toBeGreaterThan(0);
      expect(k.back).toBeLessThan(1);
    }
  });

  it('glows where each fall lands and thins its smoke on the low tier', () => {
    const full = planHeatSet(1);
    const low = planHeatSet(0.35);
    expect(full.glows.length).toBeGreaterThanOrEqual(full.falls.length);
    expect(low.smoke.length).toBeLessThan(full.smoke.length);
  });
});

describe('the four-way skies', () => {
  const ktx2Size = (path: string) => {
    const b = readFileSync(path);
    // The KTX2 identifier, then vkFormat, typeSize, pixelWidth, pixelHeight.
    expect(b.subarray(1, 7).toString('latin1')).toBe('KTX 20');
    return [b.readUInt32LE(20), b.readUInt32LE(24)];
  };

  it("ships the Heart's painting seen straight up and the Ring's panorama, both registered", () => {
    for (const url of [SMITH_HEART_FOUR_SKY_URL, SMITH_HEART_RING_SKY_URL]) {
      const path = `public${url}`;
      expect(existsSync(path)).toBe(true);
      expect(MEDIA_ASSETS[url.slice(1)]).toBeTruthy();
    }
    expect(ktx2Size(`public${SMITH_HEART_FOUR_SKY_URL}`)).toEqual([1024, 1024]);
    expect(ktx2Size(`public${SMITH_HEART_RING_SKY_URL}`)).toEqual([2048, 1024]);
  });

  it('keeps both well under the paintings their own colour (the owner: less colourful)', () => {
    for (const S of [HEART_FOUR_SKY, HEART_RING_SKY]) {
      expect(S.sat).toBeGreaterThan(0);
      expect(S.sat).toBeLessThanOrEqual(0.5);
      expect(S.grade).toBeLessThanOrEqual(1);
    }
    // The Ring's quarters blend into one colour overhead, above the cliffs' band.
    expect(HEART_RING_SKY.zenith[0]).toBeLessThan(HEART_RING_SKY.zenith[1]);
    expect(HEART_RING_SKY.zenith[1]).toBeLessThanOrEqual(1);
    // The painting's foot pressed down behind the Ring's cliffs (they hide the sky under
    // about 25 degrees), its clouds filling the band over them.
    const footUp = (HEART_RING_SKY.horizon - 1) / HEART_RING_SKY.stretch;
    expect(footUp).toBeGreaterThan(Math.sin((5 * Math.PI) / 180));
    expect(footUp).toBeLessThan(Math.sin((25 * Math.PI) / 180));
  });
});
