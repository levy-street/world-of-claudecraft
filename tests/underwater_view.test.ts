// The underwater blend and fog override moved out of Renderer.updateUnderwater
// into src/render/underwater.ts (the renderer.ts monolith ratchet). The pins:
// the moved step reproduces the renderer body it replaced on sample inputs,
// and UnderwaterView.frame drives the view and the fog from the camera's own
// waterline exactly as the renderer did.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  applyUnderwaterFog,
  UNDERWATER_FOG_COLOR,
  UNDERWATER_FOG_FAR,
  UNDERWATER_FOG_NEAR,
  UnderwaterView,
  underwaterBlendStep,
} from '../src/render/underwater';

const WATERLINE = 4;

vi.mock('../src/sim/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/world')>();
  return {
    ...actual,
    waterLevelAt: (x: number) => (x < 0 ? Number.NEGATIVE_INFINITY : WATERLINE),
  };
});

// The pre-move Renderer.updateUnderwater body, verbatim in its arithmetic.
function legacyStep(
  blend: number,
  level: number,
  cameraY: number,
  dt: number,
  fog: THREE.Fog,
): number {
  const depth = Number.isFinite(level) ? level - cameraY : -1;
  const target = Math.min(1, Math.max(0, depth / 0.45));
  const next = blend + (target - blend) * (1 - Math.exp(-dt * 7));
  if (next <= 0.002) return next;
  fog.color.lerp(new THREE.Color().setHex(0x11466a), next);
  fog.near += (1.5 - fog.near) * next;
  fog.far += (46 - fog.far) * next;
  return next;
}

const freshFog = (): THREE.Fog => new THREE.Fog(0x88aacc, 30, 220);

function sceneWith(fog: THREE.Fog): THREE.Scene {
  const scene = new THREE.Scene();
  scene.fog = fog;
  return scene;
}

function camera(x: number, y: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  cam.position.set(x, y, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('underwater blend step (moved from the renderer)', () => {
  it('keeps the fog constants the renderer eased toward', () => {
    expect(UNDERWATER_FOG_COLOR).toBe(0x11466a);
    expect(UNDERWATER_FOG_NEAR).toBe(1.5);
    expect(UNDERWATER_FOG_FAR).toBe(46);
  });

  const cases: [string, number, number, number, number][] = [
    ['dry ground, easing out', 0.6, Number.NEGATIVE_INFINITY, 2, 1 / 60],
    ['above a waterline', 0.3, WATERLINE, WATERLINE + 1, 1 / 30],
    ['just under the line', 0, WATERLINE, WATERLINE - 0.1, 1 / 60],
    ['half a yard under', 0.2, WATERLINE, WATERLINE - 0.45, 1 / 20],
    ['deep, long frame', 0.9, WATERLINE, WATERLINE - 6, 0.5],
    ['at the threshold from dry', 0, WATERLINE, WATERLINE - 0.0001, 1 / 144],
    ['barely under, a faint first fog pull', 0, WATERLINE, WATERLINE - 0.045, 1 / 60],
  ];
  for (const [name, blend, level, cameraY, dt] of cases) {
    it(`matches the renderer body: ${name}`, () => {
      const legacyFog = freshFog();
      const movedFog = freshFog();
      const expected = legacyStep(blend, level, cameraY, dt, legacyFog);
      const moved = underwaterBlendStep(blend, level, cameraY, dt);
      applyUnderwaterFog(movedFog, moved, new THREE.Color());
      expect(moved).toBe(expected);
      expect(movedFog.near).toBe(legacyFog.near);
      expect(movedFog.far).toBe(legacyFog.far);
      expect(movedFog.color.getHex()).toBe(legacyFog.color.getHex());
    });
  }

  it('fades fully in across the first half-yard under the line', () => {
    const step = (cameraY: number) => underwaterBlendStep(0, WATERLINE, cameraY, 10);
    expect(step(WATERLINE - 0.45)).toBeCloseTo(1, 12);
    expect(step(WATERLINE - 0.225)).toBeCloseTo(0.5, 12);
    expect(step(WATERLINE + 0.5)).toBe(0);
  });

  it('leaves the fog untouched at or below the dry threshold', () => {
    const fog = freshFog();
    applyUnderwaterFog(fog, 0.002, new THREE.Color());
    expect(fog.near).toBe(30);
    expect(fog.far).toBe(220);
    expect(fog.color.getHex()).toBe(0x88aacc);
  });
});

describe('UnderwaterView.frame', () => {
  it('reads the waterline under the camera and drives the view and the fog from it', () => {
    const view = new UnderwaterView(true);
    const fog = freshFog();
    const legacyFog = freshFog();
    let legacyBlend = 0;
    const cam = camera(10, WATERLINE - 2);
    const scene = sceneWith(fog);
    for (let i = 0; i < 5; i++) {
      view.frame(cam, scene, { x: 10, z: 0 }, 7, 1 / 60);
      legacyBlend = legacyStep(legacyBlend, WATERLINE, cam.position.y, 1 / 60, legacyFog);
    }
    expect(view.group.visible).toBe(true);
    expect(fog.near).toBe(legacyFog.near);
    expect(fog.far).toBe(legacyFog.far);
    expect(fog.color.getHex()).toBe(legacyFog.color.getHex());
  });

  it('stays dry, hidden and fog-neutral where the camera is over no water', () => {
    const view = new UnderwaterView(false);
    const fog = freshFog();
    view.frame(camera(-10, -50), sceneWith(fog), { x: -10, z: 0 }, 7, 1 / 60);
    expect(view.group.visible).toBe(false);
    expect(fog.near).toBe(30);
    expect(fog.far).toBe(220);
  });
});
