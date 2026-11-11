// The Quarryheart Charger, the Smith's Heart raid's reward mount: the shipped GLB's contract
// (scripts/assets/quarryheart_charger/ship_charger.mjs), its registry wiring (the manifest visual,
// the mount spec, the prewarm and lifecycle hooks), its draw budget, and the body rig's material
// swap, restore and parking (src/render/quarryheart_charger_fx.ts). The rig's pure decisions are
// pinned in tests/quarryheart_charger_fx_core.test.ts; the catalog and reserved-reward pins in
// tests/mounts.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mountAudioKey } from '../src/game/mount_audio_key';
import { VISUALS } from '../src/render/characters/manifest';
import { mountPrewarmKeys, mountPrewarmSpec } from '../src/render/mount_prewarm';
import { MOUNT_VISUAL_SPECS, mountSummonFx } from '../src/render/mount_visuals';
import {
  QuarryheartChargerFx,
  quarryheartDequant,
  resetQuarryheartProfileCaches,
} from '../src/render/quarryheart_charger_fx';
import {
  QUARRYHEART_CORE_BONE,
  QUARRYHEART_HOOF_BONES,
  QUARRYHEART_HORN_BONE,
  QUARRYHEART_MANE_BONES,
  QUARRYHEART_STONE_MATERIAL,
  QUARRYHEART_TAIL_BONE,
  QUARRYHEART_WIND_MATERIAL,
} from '../src/render/quarryheart_charger_fx_core';

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, 'public/models/mounts/quarryheart_charger.glb');

interface GltfJson {
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes: {
    primitives: { attributes: Record<string, number>; material?: number; indices?: number }[];
  }[];
  materials: {
    name: string;
    extras?: Record<string, unknown>;
    alphaMode?: string;
    doubleSided?: boolean;
  }[];
  accessors: {
    count: number;
    min?: number[];
    max?: number[];
    normalized?: boolean;
    componentType: number;
  }[];
  animations: { name: string }[];
  images?: { mimeType?: string }[];
  skins: { joints: number[] }[];
  extensionsUsed?: string[];
}

function glbJson(): GltfJson {
  const bytes = readFileSync(GLB);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as GltfJson;
}

describe('the shipped Quarryheart Charger GLB', () => {
  const json = glbJson();
  const prims = json.meshes.flatMap((m) => m.primitives);

  it('draws in two primitives: the stone body and the wind ribbons, each its own material', () => {
    expect(prims).toHaveLength(2);
    expect(json.materials.map((m) => m.name).sort()).toEqual([
      QUARRYHEART_STONE_MATERIAL,
      QUARRYHEART_WIND_MATERIAL,
    ]);
    const wind = json.materials.find((m) => m.name === QUARRYHEART_WIND_MATERIAL);
    // the GLB alone (a preview without the rig) still draws the wind as a translucent sheet
    expect(wind?.alphaMode).toBe('BLEND');
    expect(wind?.doubleSided).toBe(true);
  });

  it('stays inside its triangle budget', () => {
    const tris = prims.reduce((n, p) => n + json.accessors[p.indices as number].count / 3, 0);
    expect(tris).toBeGreaterThan(5000); // really parsed
    expect(tris).toBeLessThan(10000);
  });

  it('carries the plate attributes the body rig reads, and the vertex shading', () => {
    for (const p of prims) {
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', '_DIR', '_CEN', '_KIND']) {
        expect(Object.keys(p.attributes), a).toContain(a);
      }
    }
    // _KIND spans 0 (body), 1 (plate) and 2 (core), so it is never squeezed into a normalized type
    const kind = json.accessors[prims[0].attributes._KIND] as {
      normalized?: boolean;
      componentType: number;
    };
    expect(kind.normalized ?? false).toBe(false);
    expect(kind.componentType).toBe(5126); // FLOAT
  });

  it('ships every authored clip, its atlases as KTX2 only, and the rig the renderer names', () => {
    expect(json.animations.map((a) => a.name).sort()).toEqual(
      ['Idle', 'Jump', 'Land', 'Rear', 'Run', 'Walk', 'WalkBack'].sort(),
    );
    expect(json.images?.length).toBe(2);
    for (const image of json.images ?? []) expect(image.mimeType).toBe('image/ktx2');
    // GLTFLoader strips '.' from node names: the runtime bone names the rig looks up
    const runtime = new Set(json.nodes.map((n) => (n.name ?? '').replace(/\./g, '')));
    for (const bone of [
      ...QUARRYHEART_HOOF_BONES,
      ...QUARRYHEART_MANE_BONES,
      QUARRYHEART_TAIL_BONE,
      QUARRYHEART_HORN_BONE,
      QUARRYHEART_CORE_BONE,
      'saddle',
    ]) {
      expect(runtime.has(bone), bone).toBe(true);
    }
  });

  it('records its dequantization, and its bind height is the manifest height', () => {
    const stone = json.materials.find((m) => m.name === QUARRYHEART_STONE_MATERIAL);
    const d = stone?.extras?.quarryheartDequant as number[];
    expect(d).toHaveLength(4);
    const wind = json.materials.find((m) => m.name === QUARRYHEART_WIND_MATERIAL);
    expect(wind?.extras?.quarryheartDequant).toEqual(d);
    // the quantized POSITION bounds, carried back to bind space, span the whole beast
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of prims) {
      const acc = json.accessors[p.attributes.POSITION] as {
        min?: number[];
        max?: number[];
        normalized?: boolean;
        componentType: number;
      };
      // meshopt stores it as normalized int16: back to -1..1, then to bind space
      const unit = acc.normalized ? (acc.componentType === 5122 ? 32767 : 127) : 1;
      lo = Math.min(lo, ((acc.min?.[1] ?? 0) / unit) * d[3] + d[1]);
      hi = Math.max(hi, ((acc.max?.[1] ?? 0) / unit) * d[3] + d[1]);
    }
    expect(lo).toBeGreaterThan(-0.05);
    expect(lo).toBeLessThan(0.05);
    expect(hi - lo).toBeCloseTo(VISUALS.mount_quarryheart_charger.height, 1);
  });
});

describe('the registry wiring', () => {
  it('names its own visual, clips and gait references', () => {
    const def = VISUALS.mount_quarryheart_charger;
    expect(def.url).toBe('models/mounts/quarryheart_charger.glb');
    expect(def.lazyPreload).toBe(true);
    expect(def.clips).toMatchObject({
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      walkBack: 'WalkBack',
      jump: 'Jump',
      land: 'Land',
      flourish: 'Rear',
      death: 'Idle',
    });
    // the build's planted-hoof speeds (charger_rig.py gait_ref): a mounted gallop plants
    const rig = readFileSync(
      path.join(ROOT, 'scripts/assets/quarryheart_charger/charger_rig.py'),
      'utf8',
    );
    const gait = (name: string) => {
      const m = new RegExp(
        `^${name} = dict\\(period=([\\d.]+), duty=([\\d.]+), stride=([\\d.]+)`,
        'm',
      ).exec(rig);
      expect(m, `${name} gait table moved`).not.toBeNull();
      const [, period, duty, stride] = (m as RegExpExecArray).map(Number);
      return stride / (duty * period);
    };
    expect(def.walkRef).toBeCloseTo(gait('WALK'), 1);
    expect(def.runRef).toBeCloseTo(gait('RUN'), 1);
    expect(def.walkBackRef).toBeCloseTo(gait('BACK'), 1);
  });

  it('rides its saddle bone, carries no light, rears, and plays its own arrival', () => {
    const spec = MOUNT_VISUAL_SPECS.quarryheart_charger;
    expect(spec.visualKey).toBe('mount_quarryheart_charger');
    expect(spec.fx).toBe('quarryheart');
    expect(spec.summonFx).toBe('quarryheart');
    expect(mountSummonFx('quarryheart_charger')).toBe('quarryheart');
    expect(spec.rear).toBe(true);
    expect(spec.lamps).toEqual([]); // no lights: the heart's light is emissive and bloom
    expect(spec.glows).toEqual([]);
    expect(spec.seatBone).toEqual({ bone: 'saddle', offset: [0, -0.02, 0] });
    expect(spec.ride?.reins).toBe(true);
    expect(mountAudioKey('quarryheart_charger')).toBe('valorsteed');
  });

  it('prewarms with its rig (owned), and the live build creates the rig before the gate', () => {
    expect(mountPrewarmKeys(['quarryheart_charger'])).toContain('quarryheart_charger');
    expect(mountPrewarmSpec('quarryheart_charger').fx).toBe('quarryheart');
    const prewarm = readFileSync(path.join(ROOT, 'src/render/mount_prewarm.ts'), 'utf8');
    expect(prewarm).toMatch(
      /spec\.fx === 'quarryheart'[\s\S]*QuarryheartChargerFx\.create\(visual\.root, null, visual\)/,
    );
    const lifecycle = readFileSync(path.join(ROOT, 'src/render/mount_lifecycle.ts'), 'utf8');
    const create = lifecycle.indexOf('v.quarryheartFx = QuarryheartChargerFx.create(');
    const gate = lifecycle.indexOf('gateMountSwapOnCompile(v, v.mountVisual.root');
    expect(create).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(create);
    // and every teardown path disposes it
    expect(lifecycle).toMatch(/v\.quarryheartFx\?\.dispose\(\);\s*v\.quarryheartFx = null;/);
    const visualLifecycle = readFileSync(
      path.join(ROOT, 'src/render/mount_visual_lifecycle.ts'),
      'utf8',
    );
    expect(visualLifecycle).toMatch(
      /view\.quarryheartFx\?\.dispose\(\);\s*view\.quarryheartFx = null;/,
    );
  });
});

/** A stand-in charger rig: the two named materials on skinned meshes and the bones the rig reads. */
function fakeCharger(dequant: number[] | null): THREE.Group {
  const root = new THREE.Group();
  const bones = [
    ...QUARRYHEART_HOOF_BONES,
    ...QUARRYHEART_MANE_BONES,
    QUARRYHEART_TAIL_BONE,
    QUARRYHEART_CORE_BONE,
  ].filter((name, i, all) => all.indexOf(name) === i);
  const list = bones.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    root.add(b);
    return b;
  });
  const skeleton = new THREE.Skeleton(list);
  for (const name of [QUARRYHEART_STONE_MATERIAL, QUARRYHEART_WIND_MATERIAL]) {
    const material = new THREE.MeshStandardMaterial({ name });
    if (dequant) material.userData.quarryheartDequant = dequant;
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material);
    mesh.bind(skeleton);
    root.add(mesh);
  }
  return root;
}

describe('the body rig', () => {
  it('swaps in its own stone, wind and halo, restores the originals and parks its clones', () => {
    resetQuarryheartProfileCaches();
    const root = fakeCharger([0.1, 2.4, -0.2, 3.2]);
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const originals = meshes.map((m) => m.material);
    const fx = QuarryheartChargerFx.create(root, null);
    const swapped = meshes.map((m) => m.material as THREE.Material);
    expect(swapped[0]).not.toBe(originals[0]);
    expect(swapped[0].name).toBe(QUARRYHEART_STONE_MATERIAL);
    expect(swapped[1]).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(swapped[1].transparent).toBe(true);
    expect(swapped[1].depthWrite).toBe(false);
    // the wind casts no shadow, and says so to the visual's caster policy too
    expect(meshes[1].castShadow).toBe(false);
    expect(meshes[1].userData.shadowCaster).toBe(false);
    // exactly one extra drawable: the heart's halo on the core bone
    const sprites: THREE.Sprite[] = [];
    root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite);
    });
    expect(sprites.length).toBeLessThanOrEqual(1);
    expect(fx.materials()).toHaveLength(2 + sprites.length);
    // each spliced program keys itself apart from the GLB's own
    for (const m of fx.materials().slice(0, 2)) {
      expect(m.customProgramCacheKey()).toMatch(/quarryheart-(stone|wind)-v1$/);
    }
    // a running frame allocates nothing it keeps and never throws without a particle cloud
    fx.update({
      dt: 0.016,
      time: 3,
      moving: true,
      running: true,
      facing: 0,
      groundY: 0,
      reducedMotion: false,
      present: false,
      vfx: null,
      rearStart: null,
      sinceSummon: null,
    });
    fx.dispose();
    expect(meshes.map((m) => m.material)).toEqual(originals);
    root.traverse((o) => expect((o as THREE.Sprite).isSprite ?? false).toBe(false));
    // the next charger built from the same GLB reuses the parked clones: no new program
    const again = QuarryheartChargerFx.create(fakeCharger([0.1, 2.4, -0.2, 3.2]), null);
    const reused = again.materials();
    expect(reused[0]).toBe(swapped[0]);
    expect(reused[1]).toBe(swapped[1]);
    again.dispose();
    resetQuarryheartProfileCaches();
  });

  it('splices every anchor it needs into the Standard, Lambert and Basic programs', () => {
    resetQuarryheartProfileCaches();
    const run = (
      material: THREE.Material,
      lib: { vertexShader: string; fragmentShader: string },
    ) => {
      const shader = {
        vertexShader: lib.vertexShader,
        fragmentShader: lib.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };
      material.onBeforeCompile(shader as never, undefined as never);
      return shader;
    };
    for (const [Ctor, lib] of [
      [THREE.MeshStandardMaterial, THREE.ShaderLib.standard],
      [THREE.MeshLambertMaterial, THREE.ShaderLib.lambert],
    ] as const) {
      const root = fakeCharger([0, 0, 0, 1]);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.Material).name === QUARRYHEART_STONE_MATERIAL) {
          mesh.material = new Ctor({ name: QUARRYHEART_STONE_MATERIAL });
        }
      });
      const fx = QuarryheartChargerFx.create(root, null);
      const [stone, wind] = fx.materials();
      const s = run(stone, lib);
      expect(s.vertexShader).toContain('attribute vec3 _dir;');
      expect(s.vertexShader).toContain('transformed = (qhP - uQhDequant.xyz) / uQhDequant.w;');
      expect(s.fragmentShader).toContain('totalEmissiveRadiance *= vQhGlow;');
      expect(s.uniforms.uQhAssemble).toBeDefined();
      const w = run(wind, THREE.ShaderLib.basic);
      expect(w.vertexShader).toContain('vQhUv = uv;');
      expect(w.fragmentShader).toContain('vec4 diffuseColor = vec4(qhCol,');
      expect(w.fragmentShader).not.toContain('vec4 diffuseColor = vec4( diffuse, opacity );');
      fx.dispose();
      resetQuarryheartProfileCaches();
    }
  });

  it('never parks a material across a graphics-profile reset', () => {
    resetQuarryheartProfileCaches();
    const fx = QuarryheartChargerFx.create(fakeCharger(null), null);
    const before = fx.materials();
    resetQuarryheartProfileCaches();
    fx.dispose();
    const again = QuarryheartChargerFx.create(fakeCharger(null), null);
    const after = again.materials();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    again.dispose();
    resetQuarryheartProfileCaches();
  });

  it('reads the dequantization off the material, and falls back to identity', () => {
    const m = new THREE.MeshStandardMaterial();
    expect(quarryheartDequant(m, new THREE.Vector4()).toArray()).toEqual([0, 0, 0, 1]);
    m.userData.quarryheartDequant = [1, 2, 3, 4];
    expect(quarryheartDequant(m, new THREE.Vector4()).toArray()).toEqual([1, 2, 3, 4]);
    m.userData.quarryheartDequant = [1, 2, 3, 0];
    expect(quarryheartDequant(m, new THREE.Vector4()).toArray()).toEqual([0, 0, 0, 1]);
  });

  it('keeps every pow() out of its shaders and wraps the clock inside every hash', () => {
    const src = readFileSync(path.join(ROOT, 'src/render/quarryheart_charger_fx.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/\bpow\s*\(/);
    // no light is ever created
    expect(src).not.toMatch(/new THREE\.(Point|Spot|Directional|Hemisphere|Rect)Light/);
    for (const use of src.matchAll(/qhHash\(([^;]*)\)/g)) {
      if (use[1].includes('float n')) continue;
      expect(use[1]).toMatch(/qhTick|qhSeg|vQhSeed/);
    }
    expect(src).toMatch(/float qhTick = floor\(qhT \* 13\.0\);/);
    expect(src).toMatch(/float qhT = mod\(uQhTime, 512\.0\);/);
  });
});
