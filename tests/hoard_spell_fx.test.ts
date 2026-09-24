// Buried Hoard spell effects: the pure plans (src/render/hoard_spell_fx_core.ts)
// and the pooled adapter that paints them (src/render/hoard_spell_fx.ts).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoardSpellFx } from '../src/render/hoard_spell_fx';
import {
  collapseBurst,
  collapseRing,
  gustBlast,
  gustStreak,
  horizonEye,
  horizonStreak,
  horizonWave,
  STRIKE_BOLT_POINTS,
  STRIKE_IMPACT_SEC,
  STRIKE_RIM_ARCS,
  strikeBolt,
  strikeBranch,
  strikeCharge,
  strikeGroundFork,
  strikeImpact,
  strikeRimArc,
  voidfallStar,
  voidfallSwirl,
} from '../src/render/hoard_spell_fx_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const ROOT = 'hoard-spell-fx';
const CALM_OFF = () => false;

function cue(overrides: Partial<HoardBossCueView> = {}): HoardBossCueView {
  return {
    instanceId: 2,
    cueId: 1_000_001,
    kind: 'mark',
    variant: 'storm-strike',
    phase: 'warning',
    x: 10,
    z: 20,
    radius: 3.2,
    remaining: 1,
    total: 1,
    ...overrides,
  };
}

function drawn(scene: THREE.Scene): { quads: number; shapes: number } {
  let quads = 0;
  let shapes = 0;
  scene.getObjectByName(ROOT)?.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const range = mesh.geometry.drawRange.count;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (position.usage === THREE.DynamicDrawUsage) quads += range / 6;
    else shapes++;
  });
  return { quads, shapes };
}

describe('Lightning Strike plan', () => {
  it('builds the charge toward impact: more arcs, deeper reach, a late pre-flash and leader', () => {
    const early = strikeCharge(0.05);
    const late = strikeCharge(0.97);
    expect(late.arcs).toBeGreaterThan(early.arcs);
    expect(late.arcs).toBeLessThanOrEqual(STRIKE_RIM_ARCS);
    expect(late.reach).toBeGreaterThan(early.reach);
    expect(late.coreOpacity).toBeGreaterThan(early.coreOpacity);
    // The flash is BRIEF: nothing until the last moments.
    expect(strikeCharge(0.8).preFlash).toBe(0);
    expect(late.preFlash).toBeGreaterThan(0.5);
    expect(early.leader).toBe(0);
    expect(late.leader).toBeGreaterThan(0.8);
  });

  it('keeps the rim arcs inside the circle, so they never blur its boundary', () => {
    for (let arc = 0; arc < STRIKE_RIM_ARCS; arc++) {
      const points = strikeRimArc(9, arc, 3, 0.6);
      for (let index = 0; index < points.length; index += 2) {
        expect(Math.hypot(points[index], points[index + 1])).toBeLessThanOrEqual(1.0001);
      }
      expect(strikeRimArc(9, arc, 3, 0.6)).toEqual(points);
      expect(strikeRimArc(9, arc, 4, 0.6)).not.toEqual(points);
    }
  });

  it('lands the bolt dead centre, from the sky, with branches that start on the trunk', () => {
    const trunk = strikeBolt(5, 0);
    expect(trunk).toHaveLength(STRIKE_BOLT_POINTS * 3);
    expect(trunk[1]).toBe(1);
    // The last point is the mark itself: x 0, y 0, z 0.
    for (const value of trunk.slice(-3)) expect(Math.abs(value)).toBe(0);
    for (let point = 1; point < STRIKE_BOLT_POINTS; point++) {
      expect(trunk[point * 3 + 1]).toBeLessThan(trunk[point * 3 - 2]);
    }
    const branch = strikeBranch(5, 1, 0, trunk);
    const joints: number[][] = [];
    for (let point = 0; point < STRIKE_BOLT_POINTS; point++)
      joints.push(trunk.slice(point * 3, point * 3 + 3));
    expect(joints).toContainEqual(branch.slice(0, 3));
    expect(branch[branch.length - 2]).toBeLessThan(branch[1]);
  });

  it('strikes hard and brief, echoes once, then fades to residue and ends', () => {
    expect(strikeImpact(0).bolt).toBe(1);
    expect(strikeImpact(0.13).bolt).toBe(0);
    expect(strikeImpact(0.2).bolt).toBeGreaterThan(0);
    expect(strikeImpact(0.3).bolt).toBe(0);
    expect(strikeImpact(0).flash).toBe(1);
    expect(strikeImpact(0.25).flash).toBe(0);
    // The ring outruns the circle; the aftermath outlives the bolt but not by long.
    expect(strikeImpact(0.34).ringScale).toBeGreaterThan(1.5);
    expect(strikeImpact(0.4).residue).toBeGreaterThan(0);
    expect(strikeImpact(STRIKE_IMPACT_SEC).done).toBe(true);
    expect(STRIKE_IMPACT_SEC).toBeLessThan(1);
    const fork = strikeGroundFork(5, 2, 0);
    for (const value of fork.slice(0, 2)) expect(Math.abs(value)).toBe(0);
  });
});

describe('Whiteout Gust plan', () => {
  it('fills the cone with wind that thickens as the gust winds up, then blasts through', () => {
    const out = { bearing: 0, head: 0, tail: 0, lift: 0, opacity: 0 };
    let early = 0;
    let late = 0;
    for (let index = 0; index < 22; index++) {
      const a = gustStreak(3, index, 1.3, 0.1, out);
      expect(Math.abs(a.bearing)).toBeLessThanOrEqual(1);
      expect(a.head).toBeLessThanOrEqual(1);
      expect(a.head).toBeGreaterThanOrEqual(a.tail);
      early += a.opacity;
      late += gustStreak(3, index, 1.3, 0.95, out).opacity;
    }
    expect(late).toBeGreaterThan(early * 1.5);
    expect(gustBlast(0).front).toBe(0);
    expect(gustBlast(0.28).front).toBe(1);
    expect(gustBlast(1).done).toBe(true);
  });
});

describe('Archon Nyxaris plans', () => {
  it('drags every Event Horizon streak inward and never into the safe eye', () => {
    const out = { angle: 0, head: 0, tail: 0, lift: 0, opacity: 0 };
    const eye = 5.5 / 30;
    for (let index = 0; index < 40; index++) {
      for (const elapsed of [0.2, 1.7, 3.1]) {
        const streak = horizonStreak(8, index, elapsed, 0.6, eye, out);
        expect(streak.head).toBeGreaterThanOrEqual(eye);
        expect(streak.tail).toBeLessThanOrEqual(1);
        expect(streak.tail).toBeGreaterThanOrEqual(streak.head);
      }
    }
    expect(horizonEye(1, 0, true).columnOpacity).toBeGreaterThan(
      horizonEye(0, 0, true).columnOpacity,
    );
    expect(horizonEye(0.5, 0.2, true)).toEqual(horizonEye(0.5, 0.9, true));
    expect(horizonWave(0, eye).scale).toBeCloseTo(eye);
    expect(horizonWave(0.45, eye).scale).toBeCloseTo(1);
    expect(horizonWave(1, eye).done).toBe(true);
  });

  it('pulls the Collapse rings inward, then blows a ring out past the circle', () => {
    for (let ring = 0; ring < 3; ring++) {
      const plan = collapseRing(ring, 0.8, 0.5);
      expect(plan.scale).toBeGreaterThan(0);
      expect(plan.scale).toBeLessThanOrEqual(1);
    }
    expect(collapseRing(0, 0, 1).core).toBeGreaterThan(collapseRing(0, 0, 0).core);
    expect(collapseBurst(0).flash).toBe(1);
    expect(collapseBurst(0.4).ringScale).toBeGreaterThan(1.4);
    expect(collapseBurst(0.9).done).toBe(true);
  });

  it('hangs the Voidfall star high, then drops it onto the mark exactly at impact', () => {
    expect(voidfallStar(0.2).height).toBe(voidfallStar(0).height);
    expect(voidfallStar(0.7).height).toBeLessThan(voidfallStar(0.2).height);
    expect(voidfallStar(1).height).toBe(0);
    const arm = voidfallSwirl(1, 0.5, 9);
    for (let index = 0; index < arm.length; index += 2)
      expect(Math.hypot(arm[index], arm[index + 1])).toBeLessThanOrEqual(1);
  });
});

describe('Buried Hoard spell effects adapter', () => {
  it('attaches through the compile gate and builds nothing on the low tier', async () => {
    const gated: string[] = [];
    const gate = async (target: THREE.Object3D) => {
      gated.push(target.name);
    };
    const scene = new THREE.Scene();
    const fx = new HoardSpellFx(scene, () => 0, gate, CALM_OFF, 'high');
    await fx.readyForEntry;
    expect(gated).toEqual([ROOT]);
    expect(scene.getObjectByName(ROOT)?.userData.actionable).toBeUndefined();
    scene.traverse((node) => expect(node).not.toBeInstanceOf(THREE.Light));
    fx.dispose();

    const lowScene = new THREE.Scene();
    const low = new HoardSpellFx(lowScene, () => 0, gate, CALM_OFF, 'low');
    await low.readyForEntry;
    low.sync([cue()]);
    low.update(0.1);
    expect(gated).toEqual([ROOT]);
    expect(lowScene.children).toHaveLength(0);
    low.dispose();
  });

  it('charges a Lightning Strike, bolts when it lands, and leaves nothing behind', async () => {
    const scene = new THREE.Scene();
    let samples = 0;
    const fx = new HoardSpellFx(
      scene,
      () => {
        samples++;
        return 0;
      },
      undefined,
      CALM_OFF,
      'high',
    );
    await fx.readyForEntry;
    fx.update(0.05);
    expect(drawn(scene)).toEqual({ quads: 0, shapes: 0 });

    fx.sync([cue({ remaining: 0.9 })]);
    fx.update(0.05);
    const early = drawn(scene).quads;
    expect(early).toBeGreaterThan(0);
    fx.sync([cue({ remaining: 0.1 })]);
    fx.update(0.05);
    expect(drawn(scene).quads).toBeGreaterThan(early);
    // The ground under a circle is sampled once, never per frame.
    expect(samples).toBe(1);

    // It lands: the bolt (many more quads than the charge) plus flash, ring, glow.
    fx.sync([]);
    fx.update(0.02);
    const impact = drawn(scene);
    expect(impact.quads).toBeGreaterThan(40);
    expect(impact.shapes).toBeGreaterThanOrEqual(3);

    for (let frame = 0; frame < 30; frame++) fx.update(0.05);
    expect(drawn(scene)).toEqual({ quads: 0, shapes: 0 });
    fx.dispose();
  });

  it('draws no bolt for a strike that was interrupted or reset', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardSpellFx(scene, () => 0, undefined, CALM_OFF, 'high');
    await fx.readyForEntry;
    fx.sync([cue({ remaining: 0.7 })]);
    fx.update(0.05);
    fx.sync([]);
    fx.update(0.05);
    fx.update(0.05);
    expect(drawn(scene)).toEqual({ quads: 0, shapes: 0 });
    fx.dispose();
  });

  it('dresses the gust and all three Nyxaris casts, and bursts each as it resolves', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardSpellFx(scene, () => 0, undefined, CALM_OFF, 'high');
    await fx.readyForEntry;
    const cases: HoardBossCueView[] = [
      cue({
        cueId: 1,
        kind: 'sweep',
        variant: 'frost-gust',
        radius: 20,
        facing: 1,
        halfAngle: 0.9,
      }),
      cue({ cueId: 2, variant: 'arcane-horizon', radius: 30, innerRadius: 5.5 }),
      cue({ cueId: 3, variant: 'arcane-collapse', radius: 9.5 }),
    ];
    for (const item of cases) {
      fx.sync([{ ...item, remaining: 0.2, total: 2 }]);
      fx.update(0.4);
      fx.update(0.05);
      const live = drawn(scene);
      expect(live.quads + live.shapes, item.variant).toBeGreaterThan(0);
      fx.sync([]);
      fx.update(0.02);
      const burst = drawn(scene);
      expect(burst.quads + burst.shapes, `${item.variant} burst`).toBeGreaterThan(0);
      for (let frame = 0; frame < 30; frame++) fx.update(0.05);
      expect(drawn(scene), `${item.variant} cleanup`).toEqual({ quads: 0, shapes: 0 });
    }

    // Voidfall: the star, then the splash as the mark turns into its pool.
    const mark = cue({ cueId: 4, variant: 'arcane-voidfall', radius: 3.2, total: 1.7 });
    fx.sync([{ ...mark, remaining: 0.3 }]);
    fx.update(0.05);
    expect(drawn(scene).quads).toBeGreaterThan(0);
    fx.sync([{ ...mark, phase: 'hazard', remaining: 4, total: 4 }]);
    fx.update(0.02);
    const pool = drawn(scene);
    expect(pool.shapes).toBeGreaterThanOrEqual(2);
    expect(pool.quads).toBeGreaterThan(10);
    fx.dispose();
  });

  it('releases every geometry and material exactly once', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardSpellFx(scene, () => 0, undefined, CALM_OFF, 'high');
    await fx.readyForEntry;
    const disposed = new Map<string, number>();
    const owned = new Set<THREE.BufferGeometry | THREE.Material>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) owned.add(mesh.geometry);
      if (mesh.material) owned.add(mesh.material as THREE.Material);
    });
    for (const resource of owned) {
      resource.addEventListener('dispose', () => {
        disposed.set(resource.uuid, (disposed.get(resource.uuid) ?? 0) + 1);
      });
    }
    fx.dispose();
    fx.dispose();
    expect(scene.getObjectByName(ROOT)).toBeUndefined();
    expect(disposed.size).toBe(owned.size);
    expect([...disposed.values()].every((count) => count === 1)).toBe(true);
  });
});
