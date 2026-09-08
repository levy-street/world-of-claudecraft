import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundDecals } from '../src/render/ability_vfx/decals';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { paintWarriorFracture } from '../src/render/ability_vfx/warrior_fracture_atlas';

// ---------------------------------------------------------------------------
// paintWarriorFracture: recording canvas context
// ---------------------------------------------------------------------------

class RecordingCtx {
  saves = 0;
  restores = 0;
  lineJoin = '';
  lineCap = '';
  strokeStyle = '';
  lineWidth = 0;
  private _pts: Array<{ type: 'moveTo' | 'lineTo'; x: number; y: number }> = [];
  readonly stroked: Array<{
    style: string;
    width: number;
    pts: ReadonlyArray<{ type: 'moveTo' | 'lineTo'; x: number; y: number }>;
  }> = [];

  save(): void {
    this.saves++;
  }
  restore(): void {
    this.restores++;
  }
  translate(_x: number, _y: number): void {
    /* origin shift baked into point coords */
  }
  beginPath(): void {
    this._pts = [];
  }
  moveTo(x: number, y: number): void {
    this._pts.push({ type: 'moveTo', x, y });
  }
  lineTo(x: number, y: number): void {
    this._pts.push({ type: 'lineTo', x, y });
  }
  stroke(): void {
    this.stroked.push({ style: this.strokeStyle, width: this.lineWidth, pts: [...this._pts] });
  }
}

const PRIMARY_STYLES = ['#332e29', '#c4b9a0', '#665e52'] as const;
const FORK_STYLE = '#8a806d';

describe('paintWarriorFracture', () => {
  // Use size=120 so unit=10 px/yd: the 6-yd footprint is 60 px and the 1.35-yd
  // pocket is 13.5 px from the translated origin.
  const SIZE = 120;
  const UNIT = SIZE / 12;
  const FOOTPRINT_PX = 6 * UNIT;
  const POCKET_PX = 1.35 * UNIT;

  function record(): RecordingCtx {
    const ctx = new RecordingCtx();
    paintWarriorFracture(ctx as unknown as CanvasRenderingContext2D, SIZE);
    return ctx;
  }

  it('balances save and restore calls', () => {
    const ctx = record();
    expect(ctx.saves).toBeGreaterThan(0);
    expect(ctx.saves).toBe(ctx.restores);
  });

  it('produces exactly 8 branches each with 3 primary-layer strokes (24 total)', () => {
    const ctx = record();
    const styleSet = new Set(PRIMARY_STYLES as readonly string[]);
    const primary = ctx.stroked.filter((s) => styleSet.has(s.style));
    expect(primary).toHaveLength(8 * 3);
  });

  it('primary layers follow the authored style order within every branch', () => {
    const ctx = record();
    const styleSet = new Set(PRIMARY_STYLES as readonly string[]);
    const primary = ctx.stroked.filter((s) => styleSet.has(s.style));
    for (let b = 0; b < 8; b++) {
      for (let l = 0; l < 3; l++) {
        expect(primary[b * 3 + l].style).toBe(PRIMARY_STYLES[l]);
      }
    }
  });

  it('produces 2 fork strokes per branch (16 total)', () => {
    const ctx = record();
    const forks = ctx.stroked.filter((s) => s.style === FORK_STYLE);
    expect(forks).toHaveLength(8 * 2);
  });

  it('all path coordinates are finite', () => {
    const ctx = record();
    for (const { pts } of ctx.stroked) {
      for (const { x, y } of pts) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it('all coordinates fall within the 6-yard bedrock footprint', () => {
    const ctx = record();
    for (const { pts } of ctx.stroked) {
      for (const { x, y } of pts) {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(FOOTPRINT_PX);
      }
    }
  });

  it('all coordinates are outside the 1.35-yard open landing pocket', () => {
    const ctx = record();
    for (const { pts } of ctx.stroked) {
      for (const { x, y } of pts) {
        expect(Math.hypot(x, y)).toBeGreaterThan(POCKET_PX);
      }
    }
  });

  it('fork endpoints stay within the 6-yard footprint and outside the pocket', () => {
    const ctx = record();
    const forks = ctx.stroked.filter((s) => s.style === FORK_STYLE);
    for (const { pts } of forks) {
      for (const { x, y } of pts) {
        const r = Math.hypot(x, y);
        expect(r).toBeLessThanOrEqual(FOOTPRINT_PX);
        expect(r).toBeGreaterThan(POCKET_PX);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// GroundDecals: fake scene + fake CanvasTextures
// ---------------------------------------------------------------------------

function makeFakeTex(): THREE.CanvasTexture {
  // THREE.CanvasTexture stores the canvas in this.image; no GL at construction.
  const stub = { width: 1, height: 1, getContext: () => null } as unknown as HTMLCanvasElement;
  return new THREE.CanvasTexture(stub);
}

function makeFakeTextures(): AbilityVfxTextures {
  return {
    noise: makeFakeTex(),
    ribbon: makeFakeTex(),
    rune: makeFakeTex(),
    ember: makeFakeTex(),
    rime: makeFakeTex(),
    crack: makeFakeTex(),
    leapFracture: makeFakeTex(),
    char: makeFakeTex(),
    overlay: makeFakeTex(),
  };
}

function makeScene(): { scene: THREE.Scene; meshes: THREE.Mesh[] } {
  const meshes: THREE.Mesh[] = [];
  const scene = { add: (m: THREE.Mesh) => meshes.push(m) } as unknown as THREE.Scene;
  return { scene, meshes };
}

const groundY = (x: number, z: number): number => x * 0.08 + z * 0.03;

describe('GroundDecals', () => {
  it('adds exactly 12 fixed scene meshes at construction', () => {
    const { scene, meshes } = makeScene();
    new GroundDecals(scene, makeFakeTextures(), groundY);
    expect(meshes).toHaveLength(12);
  });

  it('slot 0 overwritten by leap_fracture on 13th spawn: leapFracture texture, uDissolve=0, uStone=1, NormalBlending', () => {
    const { scene } = makeScene();
    const tex = makeFakeTextures();
    const decals = new GroundDecals(scene, tex, groundY);
    // Fill all 12 slots with a generic style (next wraps back to 0).
    for (let i = 0; i < 12; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'rune', 3);
    // 13th spawn lands in slot 0; canonical dur for leap_fracture is .72.
    decals.spawn(10, 0, 5, 2, 0xffffff, 'leap_fracture', 0.72);
    const slots: any[] = (decals as any).slots;
    const s = slots[0];
    expect(s.mat.uniforms.uMap.value).toBe(tex.leapFracture);
    expect(s.mat.uniforms.uDissolve.value).toBe(0);
    expect(s.mat.uniforms.uStone.value).toBe(1);
    expect(s.mat.blending).toBe(THREE.NormalBlending);
    expect(s.dur).toBeCloseTo(0.72, 10);
  });

  it('exactly one of the 12 slots owns the leapFracture texture after a single leap_fracture spawn', () => {
    const { scene } = makeScene();
    const tex = makeFakeTextures();
    const decals = new GroundDecals(scene, tex, groundY);
    for (let i = 0; i < 12; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'ember', 3);
    decals.spawn(0, 0, 0, 1, 0xffffff, 'leap_fracture', 0.72);
    const slots: any[] = (decals as any).slots;
    const leapCount = slots.filter(
      (s: any) => s.mat.uniforms.uMap.value === tex.leapFracture,
    ).length;
    expect(leapCount).toBe(1);
  });

  it('terrain-drapes leap_fracture slot: center vertex Y matches groundY formula', () => {
    const { scene } = makeScene();
    const tex = makeFakeTextures();
    const decals = new GroundDecals(scene, tex, groundY);
    for (let i = 0; i < 12; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'rune', 3);
    const cx = 10,
      baseY = 0,
      cz = 5,
      radius = 2;
    decals.spawn(cx, baseY, cz, radius, 0xffffff, 'leap_fracture', 0.72);
    const slots: any[] = (decals as any).slots;
    const pos = slots[0].mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Center vertex (index 0) has localXZ=[0,0], so worldX=cx, worldZ=cz.
    // drapeRingLocalY: outY[0] = (groundY(cx, cz) + DRAPE_LIFT - baseY) / radius
    const DRAPE_LIFT = 0.06;
    const expected = (groundY(cx, cz) + DRAPE_LIFT - baseY) / radius;
    expect(pos.getY(0)).toBeCloseTo(expected, 5);
  });

  it('immediate path: uDissolve=0 at spawn and advances past hold at t=0.72', () => {
    const { scene } = makeScene();
    const tex = makeFakeTextures();
    const decals = new GroundDecals(scene, tex, groundY);
    for (let i = 0; i < 12; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'rune', 3);
    decals.spawn(0, 0, 0, 1, 0xffffff, 'leap_fracture', 0.72);
    const slots: any[] = (decals as any).slots;
    const s = slots[0];
    expect(s.mat.uniforms.uDissolve.value).toBe(0);
    // Advance to t=0.72: age = 0.72 * dur.
    decals.update(0.72 * s.dur);
    // Immediate formula: Math.max(0, (t - .35) / .65) with t=0.72.
    const expectedDissolve = (0.72 - 0.35) / 0.65;
    expect(s.mat.uniforms.uDissolve.value).toBeCloseTo(expectedDissolve, 5);
    expect(s.mesh.visible).toBe(true);
    decals.update(0.72 * (1 - 0.72) + Number.EPSILON);
    expect(s.mesh.visible).toBe(false);
    expect(s.active).toBe(false);
  });

  it('replacement by rune resets blending to additive, uStone to 0, uSpin to 0; spin then accumulates', () => {
    const { scene } = makeScene();
    const tex = makeFakeTextures();
    const decals = new GroundDecals(scene, tex, groundY);
    // slot 0 ← leap_fracture (after 12 generics fill all slots)
    for (let i = 0; i < 12; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'ember', 3);
    decals.spawn(0, 0, 0, 1, 0xffffff, 'leap_fracture', 0.72);
    // Advance next pointer from 1 back to 0 with 11 more generic spawns.
    for (let i = 0; i < 11; i++) decals.spawn(0, 0, 0, 1, 0xffffff, 'ember', 3);
    // slot 0 ← rune; this must undo every leap_fracture-specific state.
    decals.spawn(0, 0, 0, 1, 0xffffff, 'rune', 3);
    const slots: any[] = (decals as any).slots;
    const s = slots[0];
    expect(s.mat.blending).toBe(THREE.AdditiveBlending);
    expect(s.mat.uniforms.uStone.value).toBe(0);
    expect(s.mat.uniforms.uSpin.value).toBe(0);
    // After one second, rune's spin=0.35 should have accumulated.
    decals.update(1);
    expect(s.mat.uniforms.uSpin.value).toBeCloseTo(0.35, 5);
  });
});
