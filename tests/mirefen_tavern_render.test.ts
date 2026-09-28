import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import type * as THREE from 'three';
import { PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, type GfxTier, getActiveGfxProfile } from '../src/render/gfx';
import {
  activeCameraInterior,
  clampChaseCameraToInterior,
  interiorCameraInternalsForTest,
  interiorLensInAir,
} from '../src/render/interior_camera';
import {
  buildMirefenTavern,
  MIREFEN_TAVERN_FLAMES,
  MIREFEN_TAVERN_LIGHTS,
  mirefenTavernInternalsForTest,
  mirefenTavernLights,
  mirefenTavernPrewarmParts,
  mirefenTavernShellMeshes,
  updateMirefenTavernShell,
} from '../src/render/mirefen_tavern';
import {
  mirefenTavernParts,
  TAVERN_CRITICAL_PARTS,
  TAVERN_EYE_OVER_FEET,
  TAVERN_OPTIONAL_PARTS,
  TAVERN_SHELL_PARTS,
  TAVERN_TRIM_PARTS,
} from '../src/render/mirefen_tavern_core';
import { TAVERN_HALL_AIR_TOP } from '../src/render/mirefen_tavern_interior_core';
import { ditherFadeUniform, setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_LANTERNS,
  TAVERN_ORIGIN,
  TAVERN_PROPS,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_YAW,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import { TAVERN_DOG, TAVERN_TERRACE_LIGHTS } from '../src/sim/content/mirefen_tavern_grounds';
import { tavernInsideLocal } from '../src/sim/mirefen_tavern';

// The Mirefen tavern painter (src/render/mirefen_tavern.ts) over the shipped GLB: the model
// placed on the ground floor at the tavern's origin and turned to the road, what each
// graphics tier really draws (the whole walkable building, its furniture and every light on
// all of them), the prewarm parts the props warm-up links, the per-part shell materials,
// the camera cutaway (indoors the outer shell holds and only the bar's pillar cuts, walking
// in the front holds while the lens follows through the door, outdoors the shell ghosts,
// eased back, culled past the fog), the indoor camera interior it registers, and the
// firelight handed to the fire-light budget.

const internals = mirefenTavernInternalsForTest;
const GLB = path.join(__dirname, '..', 'public', internals.assetUrl.replace(/^\//, ''));

let gltf: GLTF;
const originalProfile = getActiveGfxProfile();

function withTier(tier: GfxTier): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, effectsTier: tier } });
  internals.setLoadedGltfForTest(gltf);
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // (the chimney smoke's billboards and the wall fire are the painter's own, not the model's)
    if (!mesh.isMesh || mesh.name === 'mirefenTavernSmoke') return;
    if (mesh.name.startsWith('mirefenTavernWallFire')) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

function partTriangles(names: readonly string[]): number {
  let n = 0;
  for (const name of names) {
    const node = gltf.scene.getObjectByName(name);
    if (node) n += triangles(node);
  }
  return n;
}

/** The eye over a player standing at local (lx, lz) with feet at local height ly. */
function eye(lx: number, lz: number, ly = 0) {
  const w = tavernToWorld(lx, lz);
  return { x: w.x, y: TAVERN_FLOOR_Y + ly + TAVERN_EYE_OVER_FEET, z: w.z };
}
/** A point at local (lx, ly, lz), in the world. */
function at(lx: number, ly: number, lz: number) {
  const w = tavernToWorld(lx, lz);
  return { x: w.x, y: TAVERN_FLOOR_Y + ly, z: w.z };
}
function step(e: ReturnType<typeof eye>, c: ReturnType<typeof at>, frames = 1): void {
  for (let i = 0; i < frames; i++) updateMirefenTavernShell(c.x, c.y, c.z, e.x, e.y, e.z, 1 / 60);
}
function part(name: string) {
  const r = internals.shell().find((x) => x.part === name);
  if (!r) throw new Error(name);
  return r;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(GLB);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
});

beforeEach(() => setDitherFadeEnabledForTest(false));

afterEach(() => {
  interiorCameraInternalsForTest.reset();
  setDitherFadeEnabledForTest(null);
  activateGfxProfile(originalProfile);
});

afterAll(() => {
  internals.setLoadedGltfForTest(null);
});

describe('mirefen tavern painter', () => {
  it('places the model on the ground floor at the origin, its door toward the road', () => {
    withTier('high');
    const model = buildMirefenTavern().getObjectByName('mirefenTavernModel');
    if (!model) throw new Error('model');
    expect(model.position.x).toBe(TAVERN_ORIGIN.x);
    expect(model.position.y).toBe(TAVERN_FLOOR_Y);
    expect(model.position.z).toBe(TAVERN_ORIGIN.z);
    expect(model.rotation.y).toBe(TAVERN_YAW);
  });

  it('draws the whole building on low, adds the trim on medium and the clutter from high', () => {
    const low = partTriangles(TAVERN_CRITICAL_PARTS);
    const trim = partTriangles(TAVERN_TRIM_PARTS);
    const clutter = partTriangles(TAVERN_OPTIONAL_PARTS);
    expect(trim).toBeGreaterThan(0);
    expect(clutter).toBeGreaterThan(0);
    for (const [tier, want] of [
      ['low', low],
      ['medium', low + trim],
      ['high', low + trim + clutter],
      ['ultra', low + trim + clutter],
    ] as const) {
      withTier(tier);
      const built = buildMirefenTavern();
      expect(triangles(built), tier).toBe(want);
      // the chimney smoke is cosmetic: none on low, from medium up
      expect(!!built.getObjectByName('mirefenTavernSmoke'), tier).toBe(tier !== 'low');
    }
    // every shell part, the frame, the furniture and the lights on every tier
    for (const name of [
      ...TAVERN_SHELL_PARTS,
      'TavernFrame',
      'TavernFurnishings',
      'TavernLights',
    ]) {
      expect(mirefenTavernParts('low')).toContain(name);
    }
  });

  it('lays the dog on the porch and makes it breathe, cosmetic and near the camera only', () => {
    withTier('low');
    buildMirefenTavern();
    const dog = internals.dog();
    expect(dog).not.toBeNull();
    if (!dog) return;
    // it lies where the content says, turned into the world with the model
    dog.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(dog.matrixWorld);
    const want = tavernToWorld(TAVERN_DOG.x, TAVERN_DOG.z);
    expect(Math.hypot(at.x - want.x, at.z - want.z)).toBeLessThan(0.1);
    expect(dog.children.length).toBeGreaterThan(0);
    // a camera nearby: its flank rises within a breath
    const ys = new Set<number>();
    for (let i = 0; i < 120; i++) {
      updateMirefenTavernShell(want.x + 6, 5, want.z, want.x, 2, want.z, 1 / 30);
      ys.add(Math.round(dog.scale.y * 1e4));
    }
    expect(ys.size).toBeGreaterThan(5);
    // reduced motion: it lies still
    updateMirefenTavernShell(want.x + 6, 5, want.z, want.x, 2, want.z, 1 / 30, true);
    expect(dog.scale.y).toBe(1);
  });

  it('hands the props prewarm every program it draws', () => {
    withTier('high');
    const tavern = buildMirefenTavern();
    const drawn = new Set<THREE.Material>();
    tavern.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) drawn.add(mesh.material as THREE.Material);
    });
    const warmed = new Set(mirefenTavernPrewarmParts().map((p) => p.material));
    for (const m of drawn) expect(warmed.has(m)).toBe(true);
  });

  it('draws each shell part with its own material clones, never the shared ones', () => {
    withTier('high');
    const tavern = buildMirefenTavern();
    const shell = new Set<THREE.Material>(
      mirefenTavernShellMeshes().map((m) => m.material as THREE.Material),
    );
    const shellNames = new Set<string>(TAVERN_SHELL_PARTS);
    tavern.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || shellNames.has(mesh.name)) return;
      expect(shell.has(mesh.material as THREE.Material)).toBe(false);
    });
    const byPart = new Map<string, Set<THREE.Material>>();
    for (const m of mirefenTavernShellMeshes()) {
      const set = byPart.get(m.name) ?? new Set<THREE.Material>();
      set.add(m.material as THREE.Material);
      byPart.set(m.name, set);
    }
    expect([...byPart.keys()].sort()).toEqual([...TAVERN_SHELL_PARTS].sort());
    const all = [...byPart.values()].flatMap((set) => [...set]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never opens the outer shell for a player inside, even with a camera out front', () => {
    withTier('high');
    buildMirefenTavern();
    // (the indoor camera clamp keeps the real camera in the room; the shell holds regardless)
    step(eye(0, 8), at(0, 5, 18), 30);
    for (const r of internals.shell()) expect(r.alpha, r.part).toBe(1);
  });

  it("follows the indoor camera clamp's verdict once it runs, never the lagged look point", () => {
    withTier('high');
    buildMirefenTavern();
    const cam = new PerspectiveCamera(70, 16 / 9, 0.2, 950);
    // the avatar already out on the porch while the lagged look point is still inside
    const porch = at(0, 0, 15.5);
    cam.position.set(porch.x, porch.y + 5, porch.z);
    clampChaseCameraToInterior(
      cam,
      new Vector3(porch.x, porch.y + 2, porch.z),
      new Vector3(porch.x, porch.y, porch.z),
      1 / 60,
      true,
    );
    step(eye(0, 10), at(0, 16, 20), 240);
    // outdoors: the gable over the door, between the camera and the look point, ghosts (it
    // would stay whole if the shell still took the look point for indoors)
    expect(part('HallWallFront').alpha).toBe(OCCLUDER_FADE_ALPHA);
    // back inside by the clamp's verdict: the outer shell holds
    const hall = at(0, 0, 8);
    clampChaseCameraToInterior(
      cam,
      new Vector3(hall.x, hall.y + 2, hall.z),
      new Vector3(hall.x, hall.y, hall.z),
      1 / 60,
      true,
    );
    step(eye(0, 10), at(0, 16, 20), 240);
    expect(part('HallWallFront').alpha).toBe(1);
  });

  it('holds the whole front while the lens follows a player in through the door', () => {
    withTier('high');
    buildMirefenTavern();
    const cam = new PerspectiveCamera(70, 16 / 9, 0.2, 950);
    // walking in from the road at a run, the camera behind, pitched well up (the owner's): the
    // lens comes down to thread the doorway and follows through it from outside, so no part of
    // the front, nor the roof, ever ghosts round the player (the old dollhouse cutaway)
    const pitch = 0.75;
    const dist = 18;
    let followed = 0;
    for (let lz = 24; lz > -6; lz -= 7 / 60) {
      const feet = at(0, 0, lz);
      cam.position.set(
        feet.x + Math.cos(pitch) * dist,
        feet.y + 2 + Math.sin(pitch) * dist,
        feet.z,
      );
      const look = new Vector3(feet.x, feet.y + 2, feet.z);
      clampChaseCameraToInterior(cam, look, new Vector3(feet.x, feet.y, feet.z), 1 / 60, false);
      if (activeCameraInterior() && !interiorLensInAir()) followed++;
      const c = cam.position;
      updateMirefenTavernShell(c.x, c.y, c.z, feet.x, feet.y + 2, feet.z, 1 / 60);
      for (const name of ['HallWallFront', 'HallWallFrontLeft', 'HallWallFrontRight', 'HallRoof']) {
        expect(part(name).alpha, `${name} at ${lz.toFixed(2)}`).toBe(1);
      }
    }
    expect(followed).toBeGreaterThan(30);
    expect(interiorLensInAir()).toBe(true);
  });

  it("cuts the bar's pillar away for a player at the bar with the pillar between", () => {
    withTier('high');
    buildMirefenTavern();
    const e = eye(7.5, -9, 0.5);
    step(e, at(1.5, 6, -6.2));
    const pillar = part('BarPillar');
    expect(pillar.alpha).toBe(0);
    for (const m of pillar.meshes) {
      const mat = m.material as THREE.Material;
      expect(mat.opacity).toBe(0);
      expect(mat.depthWrite).toBe(false);
      expect(mat.colorWrite).toBe(false);
    }
    for (const name of ['HallWallBack', 'HallWallLeft', 'HallWallRight', 'HallRoof']) {
      expect(part(name).alpha, name).toBe(1);
    }
    // the camera swings round clear of it: the pillar eases back to its authored state
    step(e, at(9, 5, 4), 240);
    expect(pillar.alpha).toBe(1);
    for (const m of pillar.meshes) {
      const mat = m.material as THREE.Material;
      expect(mat.transparent).toBe(false);
      expect(mat.depthWrite).toBe(true);
      expect(mat.colorWrite).toBe(true);
    }
  });

  it('under the dithered fade, a part cut away writes depth again once it is back', () => {
    setDitherFadeEnabledForTest(true);
    withTier('high');
    buildMirefenTavern();
    const e = eye(7.5, -9, 0.5);
    step(e, at(1.5, 6, -6.2));
    const pillar = part('BarPillar');
    expect(pillar.alpha).toBe(0);
    for (const m of pillar.meshes) {
      const mat = m.material as THREE.Material;
      expect(ditherFadeUniform(mat)?.value).toBe(0);
      expect(mat.depthWrite).toBe(false);
    }
    step(e, at(9, 5, 4), 240);
    expect(pillar.alpha).toBe(1);
    for (const m of pillar.meshes) {
      const mat = m.material as THREE.Material;
      expect(ditherFadeUniform(mat)?.value).toBe(1);
      expect(mat.depthWrite).toBe(true);
      expect(mat.colorWrite).toBe(true);
    }
  });

  it('spares the shadow pass for the parts inside the building', () => {
    withTier('high');
    buildMirefenTavern();
    for (const m of mirefenTavernShellMeshes()) {
      expect(m.castShadow, m.name).toBe(m.name !== 'BarPillar');
    }
  });

  it('ghosts only the parts that hide a player outside, and eases them back', () => {
    withTier('high');
    buildMirefenTavern();
    // behind the tavern's left wall, the camera out over the hall to the right
    const e = eye(-19, 0);
    step(e, at(22, 10, 0));
    expect(part('HallWallLeft').alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(part('HallWallRight').alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(part('WingWallBack').alpha).toBe(1);
    // the camera swings round in front of the player: nothing fades
    step(e, at(-30, 8, 0), 240);
    for (const r of internals.shell()) expect(r.alpha, r.part).toBe(1);
  });

  it('stops drawing the shell past the fog', () => {
    withTier('high');
    const shell = buildMirefenTavern().getObjectByName('mirefenTavernShell');
    if (!shell) throw new Error('shell');
    const far = tavernToWorld(0, 400);
    updateMirefenTavernShell(far.x, 20, far.z, 0, 20, 0, 1 / 60, false, 120);
    expect(shell.visible).toBe(false);
    const near = tavernToWorld(0, 60);
    updateMirefenTavernShell(near.x, 20, near.z, 0, 20, 0, 1 / 60, false, 120);
    expect(shell.visible).toBe(true);
  });

  it('lights the hearth, the wall fire, the chandelier, the lanterns, the stage, bar and nook', () => {
    withTier('high');
    buildMirefenTavern();
    const lights = mirefenTavernLights();
    expect(lights).toHaveLength(
      6 + TAVERN_LANTERNS.filter((l) => l.lit).length + TAVERN_TERRACE_LIGHTS.length,
    );
    const named = (n: string) => lights.filter((l) => l.name === n);
    expect(named('tavernHearth')).toHaveLength(1);
    expect(named('tavernWallFire')).toHaveLength(1);
    expect(named('tavernChandelier')).toHaveLength(1);
    expect(named('tavernStage')).toHaveLength(1);
    expect(named('tavernBar')).toHaveLength(1);
    // the lanterns hang high under the hammer beams, over the camera's air
    for (const l of named('tavernLantern')) {
      expect(l.position.y - TAVERN_FLOOR_Y).toBeGreaterThan(TAVERN_HALL_AIR_TOP);
    }
    // the stage's footlights light its deck from before its lip
    const stage = named('tavernStage')[0];
    const sx = TAVERN_ORIGIN.z - stage.position.z;
    expect(sx).toBeGreaterThan(TAVERN_STAGE.x0);
    expect(sx).toBeLessThan(TAVERN_STAGE.x1);
    // the nook's light stands in the tower's nook
    const nook = named('tavernNook');
    expect(nook).toHaveLength(1);
    const nx = TAVERN_ORIGIN.z - nook[0].position.z;
    const nz = nook[0].position.x - TAVERN_ORIGIN.x;
    expect(Math.hypot(nx - TAVERN_TOWER.x, nz - TAVERN_TOWER.z)).toBeLessThan(TAVERN_TOWER.rIn - 1);
    expect(lights[0].intensity).toBe(MIREFEN_TAVERN_LIGHTS.hearth.intensity);
    // the terrace's two warm pools, over the forecourt's cobbles before the front
    const terrace = named('tavernTerrace');
    expect(terrace).toHaveLength(TAVERN_TERRACE_LIGHTS.length);
    for (const l of terrace) {
      const lz = l.position.x - TAVERN_ORIGIN.x;
      expect(lz).toBeGreaterThan(TAVERN_HALL.z1);
      expect(l.userData.baseIntensity).toBe(l.intensity);
    }
    for (const l of lights) {
      if (l.name === 'tavernTerrace') continue;
      expect(l.isPointLight).toBe(true);
      expect(l.userData.baseIntensity).toBe(l.intensity);
      // every light inside the walls, over the floor, under the roof
      const lx = TAVERN_ORIGIN.z - l.position.z;
      const lz = l.position.x - TAVERN_ORIGIN.x;
      expect(tavernInsideLocal(lx, lz), l.name).toBe(true);
      expect(l.position.y).toBeGreaterThan(TAVERN_FLOOR_Y);
      expect(l.position.y).toBeLessThan(TAVERN_FLOOR_Y + 11);
    }
  });

  // The model's firebox is only a shallow soot panel in the breast's face: a flame set back
  // inside the breast burned hidden in the stone (an empty black firebox, stray embers). The
  // wall fire's flames must stand in the mouth, in view from the room, on every tier.
  it('burns the wall fire in the fireplace mouth, in view from the room', () => {
    const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
    if (!fire) throw new Error('fireplace');
    const wall = MIREFEN_TAVERN_FLAMES.filter((f) => {
      const lx = TAVERN_ORIGIN.z - f.z;
      const lz = f.x - TAVERN_ORIGIN.x;
      return Math.abs(lx - fire.x) < 3 && Math.abs(lz - fire.z) < (fire.hd ?? 0) + 1;
    });
    expect(wall.length).toBeGreaterThan(0);
    for (const tier of ['low', 'high'] as const) {
      withTier(tier);
      const tavern = buildMirefenTavern();
      tavern.updateMatrixWorld(true);
      const blockers: THREE.Mesh[] = [];
      tavern.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mesh.name.startsWith('mirefenTavernWallFire')) blockers.push(mesh);
      });
      const ray = new Raycaster();
      for (const f of wall) {
        // the middle of the flame, seen from a stride before the hearth (over the settle)
        const target = new Vector3(f.x, f.y + 0.45 * f.scale, f.z);
        const lz = f.x - TAVERN_ORIGIN.x;
        const from = at(fire.x - (fire.hw ?? 0) - 1.0, target.y - TAVERN_FLOOR_Y + 0.4, lz);
        const origin = new Vector3(from.x, from.y, from.z);
        const dir = target.clone().sub(origin);
        const dist = dir.length();
        ray.set(origin, dir.normalize());
        ray.far = dist;
        const hit = ray.intersectObjects(blockers, false)[0];
        expect(
          hit,
          `${tier}: the flame at ${f.x.toFixed(2)}, ${f.z.toFixed(2)} is hidden`,
        ).toBeUndefined();
      }
      // the logs, the embers and the glow are built with the tavern
      expect(tavern.getObjectByName('mirefenTavernWallFireLogs'), tier).toBeDefined();
      expect(tavern.getObjectByName('mirefenTavernWallFireEmbers'), tier).toBeDefined();
    }
  });

  it('flickers the firelight on the soot and the hearth, still under reduced motion', () => {
    withTier('medium');
    const tavern = buildMirefenTavern();
    const glows: THREE.MeshBasicMaterial[] = [];
    tavern.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name === 'mirefenTavernWallFireGlow') {
        glows.push(mesh.material as THREE.MeshBasicMaterial);
      }
    });
    expect(glows).toHaveLength(2);
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      updateMirefenTavernShell(0, 5, 0, 0, 2, 0, 1 / 20);
      seen.add(Math.round(glows[0].opacity * 1e4));
    }
    expect(seen.size).toBeGreaterThan(5);
    updateMirefenTavernShell(0, 5, 0, 0, 2, 0, 1 / 20, true);
    const still = glows[0].opacity;
    updateMirefenTavernShell(0, 5, 0, 0, 2, 0, 1 / 20, true);
    expect(glows[0].opacity).toBe(still);
  });
});
