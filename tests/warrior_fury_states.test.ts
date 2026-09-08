import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import {
  warriorBloodTexture,
  warriorSteelTexture,
} from '../src/render/ability_vfx/production_assets';
import type { RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import { WarriorFuryStates } from '../src/render/ability_vfx/warrior_fury_states';
import type { WarriorPowerAnchor } from '../src/render/warrior_power_anchor';
import type { WeaponAnchorSampler } from '../src/render/weapon_trail_anchor';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { Texture } = await import('three');
  const steel = new Texture(),
    blood = new Texture();
  return { warriorSteelTexture: () => steel, warriorBloodTexture: () => blood };
});

function fakeTex(): AbilityVfxTextures {
  const t = () => new THREE.Texture() as unknown as THREE.CanvasTexture;
  return {
    noise: t(),
    ribbon: t(),
    rune: t(),
    ember: t(),
    rime: t(),
    crack: t(),
    char: t(),
    overlay: t(),
  };
}

const SCENE_ANCHOR: RibbonAnchor = (_id, _frac, out = new THREE.Vector3()) => out.set(0, 1, 0);
const CAM = new THREE.PerspectiveCamera();
const CAM_POS = new THREE.Vector3();
const BODY: WarriorPowerAnchor = (_id, _piece, out) => {
  out.identity();
  return true;
};

function makeWeaponSampler(): WeaponAnchorSampler {
  return Object.assign(
    (out: THREE.Vector3) => {
      out.set(0.5, 1.2, 0);
      return true;
    },
    {
      frame: (out: THREE.Matrix4) => {
        out.identity();
        return true;
      },
    },
  ) as WeaponAnchorSampler;
}

function fixture(ready = true) {
  const scene = new THREE.Scene();
  const pool = new WarriorFuryStates(scene, SCENE_ANCHOR, fakeTex());
  if (ready) for (const p of pool.preparation) vi.spyOn(p, 'ready').mockReturnValue(true);
  const weaponSampler = makeWeaponSampler();
  const weapon = (_id: number, _hand: 0 | 1) => weaponSampler;
  const draw = (
    frame: number,
    dt = 0,
    reduced = false,
    body: WarriorPowerAnchor | undefined = BODY,
  ) => pool.draw(frame, dt, reduced, SCENE_ANCHOR, weapon, body, CAM, CAM_POS);
  return { pool, scene, weapon, draw };
}

it('constructs three instanced meshes with capacities [64,32,64]', () => {
  const { pool } = fixture();
  expect(pool.meshes.map((m) => m.instanceMatrix.count)).toEqual([64, 32, 64]);
  pool.dispose();
});

it('caps wearer pool at 32 with local priority and never grows when all slots are priority', () => {
  const { pool } = fixture(false);
  // fill with 32 non-priority
  for (let id = 1; id <= 32; id++) pool.hold(id, 0, { id: 'x', remaining: 10 }, 0, false);
  expect((pool as any).wearers.size).toBe(32);
  // 33rd non-priority is rejected
  pool.hold(99, 0, { id: 'x', remaining: 10 }, 0, false);
  expect((pool as any).wearers.size).toBe(32);
  expect((pool as any).wearers.has(99)).toBe(false);
  // 33rd as priority evicts one non-priority
  pool.hold(100, 0, { id: 'x', remaining: 10 }, 0, true);
  expect((pool as any).wearers.size).toBe(32);
  expect((pool as any).wearers.has(100)).toBe(true);
  pool.dispose();

  // all-priority pool: 33rd priority also rejected
  const { pool: p2 } = fixture(false);
  for (let id = 1; id <= 32; id++) p2.hold(id, 0, { id: 'x', remaining: 10 }, 0, true);
  p2.hold(99, 0, { id: 'x', remaining: 10 }, 0, true);
  expect((p2 as any).wearers.size).toBe(32);
  expect((p2 as any).wearers.has(99)).toBe(false);
  p2.dispose();
});

it('produces mesh counts [2,1,2] for three simultaneous states with native chest and weapon-frame callbacks', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 0, { id: 'x', remaining: 10 }, 0, true);
  pool.hold(1, 1, { id: 'x', remaining: 8 }, 0, true);
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  draw(0);
  expect(pool.meshes.map((m) => m.count)).toEqual([2, 1, 2]);
  pool.dispose();
});

it('sets used-prefix update ranges on each mesh to match the draw count', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 0, { id: 'x', remaining: 10 }, 0, true);
  pool.hold(1, 1, { id: 'x', remaining: 8 }, 0, true);
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  draw(0);
  for (const [k, n] of [2, 1, 2].entries())
    expect(pool.meshes[k].instanceMatrix.updateRanges).toEqual([{ start: 0, count: n * 16 }]);
  pool.dispose();
});

it('snapshots charge change from 2 to 1 immediately on the following draw', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  draw(0);
  expect(pool.meshes[2].count).toBe(2);
  pool.hold(1, 2, { id: 'x', remaining: 3.9, charges: 1 }, 1, true);
  draw(1);
  expect(pool.meshes[2].count).toBe(1);
  pool.dispose();
});

it('removes a stale wearer that was not held on the current draw frame', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 0, { id: 'x', remaining: 10 }, 0, true);
  draw(0);
  expect(pool.meshes[0].count).toBe(2);
  // frame advances, no re-hold issued
  draw(1);
  expect(pool.meshes.every((m) => m.count === 0)).toBe(true);
  pool.dispose();
});

it('clears a slept wearer immediately so the next draw produces no instances', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 0, { id: 'x', remaining: 10 }, 0, true);
  draw(0);
  expect(pool.meshes[0].count).toBe(2);
  pool.sleep(1);
  draw(0);
  expect(pool.meshes.every((m) => m.count === 0)).toBe(true);
  pool.dispose();
});

it('draws fallback ribbon lines and zero mesh instances when prewarm is cold or weapon callback is absent', () => {
  const { pool } = fixture(false); // preparation.ready() returns false
  pool.hold(1, 0, { id: 'x', remaining: 10 }, 0, true);
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  const appendHeld = vi.spyOn((pool as any).fallback, 'appendHeld');
  // pass weapon=undefined so the weapon-side paths also fall back
  pool.draw(0, 0, false, SCENE_ANCHOR, undefined, undefined, CAM, CAM_POS);
  expect(pool.meshes.every((m) => m.count === 0)).toBe(true);
  expect(appendHeld).toHaveBeenCalled();
  pool.dispose();
});

it('releases own geometry, material, mesh, and prewarm exactly once and never disposes borrowed textures', () => {
  const { pool } = fixture();
  const blood = vi.spyOn(warriorBloodTexture()!, 'dispose');
  const steel = vi.spyOn(warriorSteelTexture()!, 'dispose');
  const owned = pool.meshes.flatMap((m) => [
    vi.spyOn(m.geometry, 'dispose'),
    vi.spyOn(m.material as THREE.Material, 'dispose'),
    vi.spyOn(m, 'dispose'),
  ]);
  const prewarm = pool.preparation.map((p) => vi.spyOn(p, 'dispose'));
  pool.dispose();
  pool.dispose(); // terminal: second call is a no-op
  for (const spy of owned) expect(spy).toHaveBeenCalledOnce();
  for (const spy of prewarm) expect(spy).toHaveBeenCalledOnce();
  expect(blood).not.toHaveBeenCalled();
  expect(steel).not.toHaveBeenCalled();
});

it('keeps all 32 local wearers bounded and draws all five cold pieces per wearer independently of attack capacity', () => {
  const { pool } = fixture(false);
  for (let id = 1; id <= 32; id++)
    for (const kind of [0, 1, 2] as const)
      pool.hold(id, kind, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  pool.hold(33, 0, { id: 'x', remaining: 4 }, 0, true);
  const held = vi.spyOn((pool as any).fallback, 'appendHeld');
  pool.draw(0, 0.05, false, SCENE_ANCHOR, undefined, undefined, CAM, CAM_POS);
  expect(held).toHaveBeenCalledTimes(160);
  const fallback = (pool as any).fallback;
  expect(fallback.geo.drawRange.count).toBe(160 * 12);
  expect((pool as any).wearers.size).toBe(32);
  expect((pool as any).wearers.has(33)).toBe(false);
  pool.dispose();
});
it('retries a cold weapon after the deadline even while visible every frame', () => {
  const { pool } = fixture(),
    sampler = makeWeaponSampler();
  let loaded = false;
  const weapon = vi.fn(() => (loaded ? sampler : null));
  for (let frame = 0; frame < 8; frame++) {
    loaded = frame >= 1;
    pool.hold(1, 0, { id: 'x', remaining: 4 }, frame, true);
    pool.draw(frame, 0.05, false, SCENE_ANCHOR, weapon, BODY, CAM, CAM_POS);
    if (frame < 5) expect(pool.meshes[0].count).toBe(0);
  }
  expect(pool.meshes[0].count).toBe(2);
  expect(weapon).toHaveBeenCalledTimes(4);
  pool.dispose();
});
it('removes exhausted charges on the same draw without affecting the live weapon fire', () => {
  const { pool, draw } = fixture();
  pool.hold(1, 0, { id: 'x', remaining: 4 }, 0, true);
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  draw(0);
  pool.hold(1, 0, { id: 'x', remaining: 3 }, 1, true);
  pool.hold(1, 2, { id: 'x', remaining: 3, charges: 0 }, 1, true);
  draw(1);
  expect(pool.meshes.map((m) => m.count)).toEqual([2, 0, 0]);
  pool.dispose();
});
it('keeps cold charge silhouettes separated across a side camera and freezes their reduced-motion shader time', () => {
  const { pool } = fixture(false),
    camera = new THREE.PerspectiveCamera();
  camera.rotation.y = Math.PI / 2;
  const fallback = (pool as any).fallback;
  pool.hold(1, 2, { id: 'x', remaining: 4, charges: 2 }, 0, true);
  pool.draw(0, 0.1, true, SCENE_ANCHOR, undefined, undefined, camera, CAM_POS);
  const lines = (pool as any).lines;
  expect(Math.abs(lines[0].points[0].z - lines[1].points[0].z)).toBeGreaterThan(1);
  const time = fallback.mat.uniforms.uTime.value;
  pool.hold(1, 2, { id: 'x', remaining: 3, charges: 2 }, 1, true);
  pool.draw(1, 1, true, SCENE_ANCHOR, undefined, undefined, camera, CAM_POS);
  expect(fallback.mat.uniforms.uTime.value).toBe(time);
  pool.dispose();
});
