// The Warrior kit's program links on a real WebGL driver: the browser half of
// tests/warrior_kit_boot_programs.test.ts. The boot warm-up links the kit
// family's programs for every class; the kit's sheets and fragment geometry
// land later, at the first Warrior seen, and its recipe binds them, compiles
// every piece and draws each once into an 8x8 target. Counted here through
// renderer.info.programs, which grows by one per program three links:
//   - on a composer tier (Ultra) the kit load links nothing, since every
//     piece draws the offscreen variant the boot already linked;
//   - on Low, which draws straight to the canvas, the kit load links only
//     the offscreen "upload twins" of its bounded draws, never a canvas
//     program the boot should have linked.
// The control leg skips the boot link and sees the kit load link programs, so
// the harness does see links when they happen.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const kit = vi.hoisted(() => ({
  landed: false,
  textures: new Map<string, unknown>(),
  fragment: null as unknown,
}));

vi.mock('../../src/render/ability_vfx/production_assets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/render/ability_vfx/production_assets')>();
  const sheet = (name: string) => () => (kit.landed ? (kit.textures.get(name) ?? null) : null);
  return {
    ...actual,
    warriorBloodTexture: sheet('blood'),
    warriorSteelTexture: sheet('steel'),
    warriorRockTexture: sheet('rock'),
    warriorPressureTexture: sheet('pressure'),
    bakedTexture: sheet('baked'),
    fragmentGeometry: () => (kit.landed ? kit.fragment : null),
  };
});
vi.mock('../../src/render/ability_vfx/contact_assets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/render/ability_vfx/contact_assets')>();
  return {
    ...actual,
    contactTexture: () => (kit.landed ? (kit.textures.get('contact') ?? null) : null),
  };
});

import { ACTIVE_WARRIOR_CRESTS } from '../../src/render/ability_vfx/active_kit_prewarm';
import { AbilityVfxFx } from '../../src/render/ability_vfx/fx';
import { inCastVfxKit } from '../../src/render/cast_vfx_family';
import { castVfxProgramUnits } from '../../src/render/cast_vfx_prewarm';
import { type CompileArmHost, linkColorPrograms } from '../../src/render/compile_arms';
import type { GfxTier } from '../../src/render/gfx';
import { createVfxAnchor } from '../../src/render/vfx_anchor';
import { activateTier } from '../helpers/gfx_tier';

type ProgramInfo = { cacheKey: string; diagnostics?: { runnable?: boolean } };

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  kit.landed = false;
});

function landTextures(): void {
  for (const name of ['blood', 'steel', 'rock', 'pressure', 'baked', 'contact']) {
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    kit.textures.set(name, texture);
  }
  kit.fragment = new THREE.IcosahedronGeometry(1, 0);
}

/** A renderer on the tier's colour arm, driven through the production seams:
 *  the boot through castVfxProgramUnits over the real colour arm
 *  (compile_arms.ts), the kit load through the kit recipe with the same arm
 *  (the renderer's compilePrewarmColorPrograms) and a bounded 8x8 upload draw.
 *  Low draws to the canvas; the other tiers draw through a composer target. */
function rig(tier: GfxTier) {
  activateTier(tier);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 64, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const offscreen = new THREE.WebGLRenderTarget(8, 8);
  const upload = new THREE.WebGLRenderTarget(8, 8);
  const arms: CompileArmHost = {
    webgl: () => renderer,
    camera: () => camera,
    scene: () => scene,
    shadowCamera: () => sun.shadow.camera,
    offscreen: () => tier !== 'low',
    offscreenTarget: () => offscreen,
    depthMaterials: () => new Map(),
    shadowArm: () => false,
  };
  const fx = new AbilityVfxFx(
    scene,
    camera,
    createVfxAnchor(() => false),
    () => 0,
  );
  const programs = () => (renderer.info.programs ?? []) as unknown as ProgramInfo[];
  /** Every program three holds for a kit-tagged material, carriers and the
   *  fragment batches included (they share or are kit materials). */
  const kitPrograms = () => {
    const owned = new Set<unknown>();
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (!inCastVfxKit(object) || !material) return;
      const properties = renderer.properties.get(material) as { programs?: Map<string, unknown> };
      for (const program of properties.programs?.values() ?? []) owned.add(program);
    });
    return owned;
  };
  dispose = () => {
    fx.dispose();
    renderer.dispose();
    offscreen.dispose();
    upload.dispose();
    canvas.remove();
  };
  return {
    fx,
    programs,
    kitPrograms,
    /** The boot warm-up's cast units, the kit family included. */
    bootLink: async () => {
      const units = castVfxProgramUnits(scene, null, arms, renderer, undefined, false);
      for (const unit of units) await unit.run();
    },
    /** The kit recipe on the kit's own lane, once its assets landed. */
    kitLoad: async () => {
      landTextures();
      kit.landed = true;
      const host = {
        properties: renderer.properties as never,
        compile: (root: THREE.Object3D, includeOffscreen: boolean) =>
          linkColorPrograms(arms, root, includeOffscreen),
        draw: (group: THREE.Group, child: THREE.Object3D) => {
          const visibility = scene.children.map((entry) => entry.visible);
          const children = group.children.map((entry) => entry.visible);
          try {
            for (const entry of scene.children) {
              entry.visible = entry === group || (entry as THREE.Light).isLight === true;
            }
            group.visible = true;
            for (const entry of group.children) entry.visible = entry === child;
            renderer.setRenderTarget(upload);
            renderer.render(scene, camera);
          } finally {
            renderer.setRenderTarget(null);
            group.children.forEach((entry, i) => {
              entry.visible = children[i];
            });
            scene.children.forEach((entry, i) => {
              entry.visible = visibility[i];
            });
          }
        },
      };
      for (const unit of fx.authoredPrewarmUnits(host, ACTIVE_WARRIOR_CRESTS)) await unit.run();
    },
  };
}

const isOffscreenVariant = (program: ProgramInfo) => program.cacheKey.includes('srgb-linear');

describe('the Warrior kit load on a real WebGL driver', () => {
  it('control: without the boot link, the kit load links its programs itself', async () => {
    const h = rig('ultra');
    const before = h.programs().length;
    await h.kitLoad();
    expect(h.programs().length).toBeGreaterThan(before);
  });

  it('links nothing at kit load on a composer tier (Ultra)', async () => {
    const h = rig('ultra');
    await h.bootLink();
    const boot = h.programs().length;
    expect(h.kitPrograms().size).toBeGreaterThan(0);
    await h.kitLoad();
    const linked = h.programs().slice(boot);
    expect(linked.map((program) => program.cacheKey)).toEqual([]);
    expect(h.programs().filter((program) => program.diagnostics?.runnable === false)).toEqual([]);
  });

  it('links only the offscreen upload twins at kit load on Low', async () => {
    const h = rig('low');
    await h.bootLink();
    const boot = h.programs().length;
    const bootKit = h.kitPrograms();
    expect(bootKit.size).toBeGreaterThan(0);
    expect(h.programs().filter(isOffscreenVariant)).toEqual([]);
    await h.kitLoad();
    const linked = h.programs().slice(boot);
    // One twin per boot kit program, each held by a kit material: every kit
    // piece's bounded draw, and nothing the canvas draws.
    const kitAfter = h.kitPrograms();
    expect(linked.filter((program) => !kitAfter.has(program))).toEqual([]);
    expect(linked).toHaveLength(bootKit.size);
    expect(kitAfter.size).toBe(bootKit.size * 2);
    expect(linked.filter((program) => !isOffscreenVariant(program))).toEqual([]);
    expect(h.programs().filter((program) => program.diagnostics?.runnable === false)).toEqual([]);
  });
});
