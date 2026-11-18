// The Guardian of the Heat's lava waves on screen (heat_lava_wall_core.ts, the
// rework of 2026-11-18): the wall parts exactly at the sim's corridors, every yard
// of the floor shows the one corridor pair that saves whoever stands there, the
// wall rises out of the lip and sinks into the walls, the warning quickens to its
// launch, the roar is at the nearest burning point, the low tier keeps the wall and
// the corridors, and the in-air layers draw over every floor band.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  HEAT_SFX_KEYS,
  HEAT_WALL_LOOP,
  HEAT_WALL_PASS,
  wallRoarGain,
} from '../src/game/smith_heart_heat_audio_core';
import { FLOOR_VFX_LAYER_BASE, FLOOR_VFX_LAYER_SPAN } from '../src/render/floor_vfx_layer_core';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import { HEAT_FLOOR } from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import {
  acrossGap,
  corridorSpanPool,
  corridorSpans,
  gapWarnLook,
  LAVA_WALL,
  LAVA_WALL_POOLS,
  ringFront,
  wallBudget,
  wallLook,
  wallOpen,
  wallRoar,
} from '../src/render/smith_heart_fx/heat_lava_wall_core';
import { WALL_AIR_ORDER } from '../src/render/smith_heart_fx/heat_lava_wall_fx';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  HEAT_DIFFICULTY,
  inRingCorridor,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart';

describe('heat_lava_wall_core: where the wall burns and where it parts', () => {
  it('parts exactly where the sim lets a player through, and burns full a little past it', () => {
    const half = 4;
    expect(wallOpen(0, half)).toBe(0);
    expect(wallOpen(half, half)).toBe(0);
    expect(wallOpen(half + LAVA_WALL.part, half)).toBe(1);
    // The chord off a corridor's line at the ring's front is the sim's own
    // across (a point on the corridor's line is in it, the wall's point at the
    // corridor's edge is at its half width).
    const front = 20;
    const g = 0.7;
    for (const da of [0, 0.1, 0.19, 0.25, 0.6]) {
      const a = g + da;
      const across = acrossGap(a, g, front);
      const x = HEARTH_WELL.x + Math.sin(a) * front;
      const z = HEARTH_WELL.z + Math.cos(a) * front;
      expect(across <= half).toBe(inRingCorridor([g], half, x, z));
      // Where the sim strikes, flames stand (some of them); where it does not, none.
      if (across <= half) expect(wallOpen(across, half)).toBe(0);
      else expect(wallOpen(across, half)).toBeGreaterThan(0);
    }
    // Behind the well from the corridor: no parting.
    expect(acrossGap(g + Math.PI, g, front)).toBeGreaterThan(100);
    expect(ringFront(HEARTH_WELL.x + 12, HEARTH_WELL.z)).toBeCloseTo(12, 9);
  });

  it('rises out of the lip as it leaves, burns whitest fresh, sinks into the walls at the end', () => {
    expect(wallLook(0, T.ringStart).rise).toBe(0);
    expect(wallLook(LAVA_WALL.rise, 20).rise).toBeCloseTo(1, 9);
    expect(wallLook(5, T.ringEnd).rise).toBe(0);
    expect(wallLook(0.2, 20).heat).toBeGreaterThan(wallLook(4, 30).heat);
  });

  it('every yard of floor shows the one corridor pair of the next wall to reach it', () => {
    const pool = corridorSpanPool(LAVA_WALL_POOLS.rings + 1);
    const a = { front: 30, gaps: [0.2, 0.2 + Math.PI], half: 4 };
    const b = { front: 14, gaps: [1.1, 1.1 + Math.PI], half: 4 };
    const next = { gaps: [1.8, 1.8 + Math.PI], half: 4 };
    const n = corridorSpans([b, a], next, pool);
    expect(n).toBe(3);
    const spans = pool.slice(0, n);
    // The oldest ring's out to the walls, the newer one's up to it, the warning
    // from the lip up to the newest ring.
    expect(spans[0]).toMatchObject({ from: 30, to: T.ringEnd, warn: false, gaps: a.gaps });
    expect(spans[1]).toMatchObject({ from: 14, to: 30, warn: false, gaps: b.gaps });
    expect(spans[2]).toMatchObject({ from: T.ringStart, to: 14, warn: true, gaps: next.gaps });
    // No overlap and no hole from the lip to the walls.
    const sorted = [...spans].sort((x, y) => x.from - y.from);
    expect(sorted[0].from).toBe(T.ringStart);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].from).toBe(sorted[i - 1].to);
    expect(sorted[sorted.length - 1].to).toBe(T.ringEnd);
    // Only the warning before the first ring: the lip to the walls.
    expect(corridorSpans([], next, pool)).toBe(1);
    expect(pool[0]).toMatchObject({ from: T.ringStart, to: T.ringEnd, warn: true });
    // The last ring gone out, nothing more to come: nothing on the floor.
    expect(corridorSpans([], null, pool)).toBe(0);
    // The pool never overflows: the most rings any tier's overflow holds at
    // once (a ring's roll over the spacing), and the warning.
    for (const tier of Object.values(HEAT_DIFFICULTY))
      for (const w of tier.waves) {
        const most = Math.ceil((T.ringEnd - T.ringStart) / w.speed / w.every);
        expect(most).toBeLessThanOrEqual(LAVA_WALL_POOLS.rings);
      }
    expect(LAVA_WALL_POOLS.corridors).toBeGreaterThanOrEqual((LAVA_WALL_POOLS.rings + 1) * 2);
  });

  it('the warning brightens and throbs quicker to its launch', () => {
    const early = gapWarnLook(0.5, 4);
    const late = gapWarnLook(3.8, 4);
    expect(late.fill).toBeGreaterThan(early.fill);
    expect(late.glow).toBeGreaterThan(early.glow);
    expect(gapWarnLook(0, 4).glow).toBe(0);
  });

  it('roars from the nearest burning point, louder as it comes, quiet in a corridor', () => {
    const ring = { front: 20, gaps: [0, Math.PI], half: 4 };
    // A listener on the wall's line 2 yd ahead of it, off the corridors.
    const a = Math.PI / 2;
    const near = wallRoar(
      [ring],
      HEARTH_WELL.x + Math.sin(a) * 22,
      HEARTH_WELL.z + Math.cos(a) * 22,
    );
    const far = wallRoar(
      [ring],
      HEARTH_WELL.x + Math.sin(a) * 45,
      HEARTH_WELL.z + Math.cos(a) * 45,
    );
    expect(near?.near ?? 0).toBeGreaterThan(far?.near ?? 1);
    expect(near?.x).toBeCloseTo(HEARTH_WELL.x + 20, 6);
    const inGap = wallRoar([ring], HEARTH_WELL.x, HEARTH_WELL.z + 22);
    expect(inGap?.near ?? 1).toBeLessThan(near?.near ?? 0);
    expect(wallRoar([], 0, 0)).toBeNull();
    expect(wallRoarGain(1)).toBe(HEAT_WALL_LOOP.gain);
    expect(wallRoarGain(0)).toBe(HEAT_WALL_LOOP.quiet);
    expect(HEAT_SFX_KEYS).toContain(HEAT_WALL_LOOP.key);
    expect(HEAT_SFX_KEYS).toContain(HEAT_WALL_PASS.key);
  });

  it('the low tier keeps the wall and the corridors, sheds only the cosmetic layers', () => {
    const hi = wallBudget(true);
    const lo = wallBudget(false);
    expect(lo.sheets).toBeGreaterThanOrEqual(1);
    expect(lo.tongues).toBeGreaterThan(0);
    expect(lo.smoke).toBe(false);
    expect(lo.haze).toBe(false);
    expect(hi.sheets).toBe(LAVA_WALL.sheets);
    expect(hi.embers).toBeGreaterThan(lo.embers);
  });
});

describe('the wall on screen: its layers and orders', () => {
  it("stands in the air over every floor band, its foot and corridors on the Heat's ladder", () => {
    const top = FLOOR_VFX_LAYER_BASE.reticle + FLOOR_VFX_LAYER_SPAN.reticle;
    for (const o of Object.values(WALL_AIR_ORDER)) {
      expect(o).toBeGreaterThanOrEqual(top);
      expect(o).toBeLessThan(1000);
    }
    expect(WALL_AIR_ORDER.smoke).toBeLessThan(WALL_AIR_ORDER.dark);
    expect(WALL_AIR_ORDER.dark).toBeLessThan(WALL_AIR_ORDER.fire);
    expect(HEAT_FLOOR.wallChar).toMatchObject({ blend: 'multiply', owner: 'heat_lava_wall_fx' });
    expect(HEAT_FLOOR.wallGlow).toMatchObject({ blend: 'additive', owner: 'heat_lava_wall_fx' });

    const scene = new THREE.Scene();
    const fx = new HeatFightFx(scene, () => 0);
    const named = (name: string) => {
      const out: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name === name) out.push(o);
      });
      return out;
    };
    for (const name of [
      'smithHeartHeatWallFire',
      'smithHeartHeatWallBody',
      'smithHeartHeatWallGlow',
      'smithHeartHeatWallTongues',
      'smithHeartHeatWallEmbers',
      'smithHeartHeatWallFoot',
    ])
      expect(named(name).length, name).toBe(LAVA_WALL_POOLS.rings);
    for (const o of named('smithHeartHeatWallFire'))
      expect(o.renderOrder).toBe(WALL_AIR_ORDER.fire);
    expect(named('smithHeartHeatWallCorridor').length).toBe(LAVA_WALL_POOLS.corridors);
    for (const o of named('smithHeartHeatWallCorridor')) {
      const m = (o as THREE.Mesh).material as THREE.Material;
      expect(m.blending).toBe(THREE.AdditiveBlending);
    }
    fx.dispose();
  });
});
