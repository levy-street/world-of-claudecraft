import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { tintedMaterial } from '../src/render/characters/assets';
import { manifestUrls, VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { createGroundFireAoe } from '../src/render/ignivar_fire_vfx';
import {
  attachIgnivarModelVfx,
  disposeIgnivarModelVfx,
  syncIgnivarModelVfx,
} from '../src/render/ignivar_model_vfx';
import { MOBS } from '../src/sim/data';
import {
  IGNIVAR_APOCALYPSE_ADD_ID,
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
} from '../src/sim/encounters/ignivar';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/creatures/ignivar_herald.glb');
const ASHCALLER_ASSET_PATH = path.join(REPO_ROOT, 'public/models/creatures/ignivar_ashcaller.glb');
const RETIRED_HEART_ASSET_PATH = path.join(
  REPO_ROOT,
  'public/models/creatures/ignivar_heart_of_the_end.glb',
);
const ASHCALLER_SHA256 = '0f92aa55d5f031cc2ae1c9368102edde96a3345827592cb3c56351d1b4fd4396';
const SHIPPED_CLIPS = [
  'Attack',
  'Channel',
  'ChannelEnd',
  'ChannelStart',
  'Death',
  'FistSpin360',
  'Idle',
  'Idle2',
  'Idle3',
  'JumpAttack',
  'Run',
  'Walk',
];
const ASHCALLER_SHIPPED_CLIPS = ['Cast', 'Channel', 'ChannelStart', 'Death', 'Idle', 'Move'];

describe('Ignivar boss model', () => {
  it('routes the raid boss to the contributor Colossus and its authored clips', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: IGNIVAR_BOSS_ID } as never);

    expect(key).toBe('mob_ignivar');
    expect(VISUALS.mob_ignivar).toMatchObject({
      url: 'models/creatures/ignivar_herald.glb',
      height: 2.65,
      yaw: 0,
      // The contributor atlas ships metallicFactor 1 + a metallic-roughness
      // texture; matte kills that specular sheen under the forge key light.
      matte: true,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attack: ['Attack'],
        cast: 'Channel',
        death: 'Death',
        flourish: 'FistSpin360',
      },
    });
    expect(manifestUrls()).toContain('models/creatures/ignivar_herald.glb');
  });

  it('routes Ignivar Ashcaller to its stationary caster visual', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: IGNIVAR_APOCALYPSE_ADD_ID } as never);

    expect(MOBS[IGNIVAR_APOCALYPSE_ADD_ID].name).toBe('Ignivar Ashcaller');

    expect(key).toBe('mob_ignivar_heart_of_the_end');
    expect(VISUALS.mob_ignivar_heart_of_the_end).toMatchObject({
      url: 'models/creatures/ignivar_ashcaller.glb',
      height: 1.8,
      yaw: 0,
      selfIllumination: 0.16,
      matte: true,
      deathTimeScale: 3,
      clips: {
        idle: 'Idle',
        walk: 'Move',
        run: 'Move',
        attack: ['Cast'],
        cast: 'Channel',
        death: 'Death',
      },
    });
    expect(VISUALS.mob_ignivar_heart_of_the_end.clips?.hit).toBeUndefined();
    expect(manifestUrls()).toContain('models/creatures/ignivar_ashcaller.glb');
  });

  it('ships Ashcaller as a compressed rig with channel and death clips', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASHCALLER_ASSET_PATH);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.byteLength).toBeLessThan(3_000_000);
    expect(sha256).toBe(ASHCALLER_SHA256);
    expect(MEDIA_ASSETS['models/creatures/ignivar_ashcaller.glb']).toBe(
      `/media/models/creatures/ignivar_ashcaller.${sha256.slice(0, 12)}.glb`,
    );
    expect(existsSync(RETIRED_HEART_ASSET_PATH)).toBe(false);
    expect(MEDIA_ASSETS['models/creatures/ignivar_heart_of_the_end.glb']).toBeUndefined();

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.readBinary(bytes)).getRoot();
    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu']);
    expect(root.listSkins()).toHaveLength(1);
    const skin = root.listSkins()[0];
    expect(skin.listJoints()).toHaveLength(51);
    expect(skin.getInverseBindMatrices()?.getCount()).toBe(51);
    expect(root.listNodes().filter((node) => node.getMesh() && node.getSkin())).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(5);
    expect(root.listTextures().every((texture) => texture.getMimeType() === 'image/ktx2')).toBe(
      true,
    );
    expect(
      root
        .listAnimations()
        .map((animation) => animation.getName())
        .sort(),
    ).toEqual([...ASHCALLER_SHIPPED_CLIPS].sort());

    for (const clipName of ['Channel', 'Death']) {
      const animation = root.listAnimations().find((clip) => clip.getName() === clipName);
      expect(animation, `${clipName} clip`).toBeDefined();
      expect(animation?.listChannels()).toHaveLength(153);
      const samplers = animation?.listSamplers() ?? [];
      expect(
        samplers.reduce((count, sampler) => count + (sampler.getInput()?.getCount() ?? 0), 0),
      ).toBeGreaterThan(1_500);
      let duration = 0;
      let maxPoseDelta = 0;
      for (const sampler of samplers) {
        const times = sampler.getInput()?.getArray() ?? [];
        const values = sampler.getOutput()?.getArray() ?? [];
        for (const time of times) duration = Math.max(duration, Number(time));
        if (times.length === 0 || values.length === 0) continue;
        const stride = values.length / times.length;
        for (let offset = stride; offset < values.length; offset += stride) {
          for (let component = 0; component < stride; component++) {
            maxPoseDelta = Math.max(
              maxPoseDelta,
              Math.abs(Number(values[offset + component]) - Number(values[component])),
            );
          }
        }
      }
      expect(duration).toBeGreaterThanOrEqual(3);
      expect(maxPoseDelta, `${clipName} must contain authored pose motion`).toBeGreaterThan(0.01);
      const targetNodes = new Set(
        (animation?.listChannels() ?? [])
          .map((channel) => channel.getTargetNode())
          .filter((node) => node !== null),
      );
      expect(targetNodes.size).toBe(51);
      for (const joint of skin.listJoints()) expect(targetNodes.has(joint)).toBe(true);
    }

    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives).toHaveLength(2);
    for (const primitive of primitives) {
      expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
      expect(primitive.listSemantics().sort()).toEqual([
        'JOINTS_0',
        'NORMAL',
        'POSITION',
        'TEXCOORD_0',
        'WEIGHTS_0',
      ]);
    }
    expect(
      primitives.reduce(
        (vertices, primitive) => vertices + (primitive.getAttribute('POSITION')?.getCount() ?? 0),
        0,
      ),
    ).toBe(13_257);
    expect(
      primitives.reduce(
        (triangles, primitive) => triangles + (primitive.getIndices()?.getCount() ?? 0) / 3,
        0,
      ),
    ).toBe(10_670);
    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[0]).toBeCloseTo(-0.873775, 6);
    expect(bounds.min[1]).toBeCloseTo(-1, 6);
    expect(bounds.min[2]).toBeCloseTo(-0.350261, 6);
    expect(bounds.max[0]).toBeCloseTo(0.873775, 6);
    expect(bounds.max[1]).toBeCloseTo(1, 6);
    expect(bounds.max[2]).toBeCloseTo(0.350261, 6);
  });

  it('applies its readability controls without mutating the source material', () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.8 });
    const material = tintedMaterial(
      source,
      null,
      0,
      null,
      null,
      'body',
      null,
      'rig',
      '',
      0.32,
      2.4,
    );

    expect(material).not.toBe(source);
    expect((material as THREE.MeshStandardMaterial).emissiveMap).toBe(map);
    expect((material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.32);
    expect((material as THREE.MeshStandardMaterial).envMapIntensity).toBe(2.4);
    expect(source.emissiveMap).toBeNull();
  });

  it('ships the skinned PBR Colossus with every handoff clip and VFX socket', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.byteLength).toBeLessThan(2_000_000);
    expect(MEDIA_ASSETS['models/creatures/ignivar_herald.glb']).toMatch(
      /^\/media\/models\/creatures\/ignivar_herald\.[a-f0-9]{12}\.glb$/,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.readBinary(bytes)).getRoot();
    expect(bytes.toString('utf8')).toContain('EXT_meshopt_compression');
    expect(bytes.toString('utf8')).toContain('KHR_texture_basisu');
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listSkins()[0].listJoints()).toHaveLength(25);
    expect(root.listTextures()).toHaveLength(4);
    expect(root.listTextures().map((texture) => texture.getMimeType())).toEqual([
      'image/ktx2',
      'image/ktx2',
      'image/ktx2',
      'image/ktx2',
    ]);
    expect(
      root
        .listAnimations()
        .map((animation) => animation.getName())
        .sort(),
    ).toEqual([...SHIPPED_CLIPS].sort());

    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives).toHaveLength(1);
    expect(primitives[0].getMode()).toBe(Primitive.Mode.TRIANGLES);
    expect(primitives[0].listSemantics().sort()).toEqual([
      'JOINTS_0',
      'NORMAL',
      'POSITION',
      'TEXCOORD_0',
      'WEIGHTS_0',
    ]);

    const nodes = new Set(root.listNodes().map((node) => node.getName()));
    expect(nodes.size).toBeGreaterThan(20);
    for (const socket of [
      'vfx_core',
      'vfx_vent.l',
      'vfx_vent.r',
      'vfx_eyes',
      'handslot.l',
      'handslot.r',
    ]) {
      expect(nodes.has(socket)).toBe(true);
    }
    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[1]).toBeCloseTo(0, 4);
    expect(bounds.max[1]).toBeCloseTo(0.81604, 4);
  });

  it('attaches all authored furnace effects idempotently and follows cast state', () => {
    const textureLoad = vi
      .spyOn(THREE.TextureLoader.prototype, 'load')
      .mockReturnValue(new THREE.Texture());
    const model = new THREE.Group();
    // GLTFLoader strips dots from animated node names at runtime.
    for (const name of ['vfx_core', 'vfx_ventl', 'vfx_ventr']) {
      const socket = new THREE.Bone();
      socket.name = name;
      model.add(socket);
    }
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() }),
    );
    model.add(body);

    expect(attachIgnivarModelVfx(model)).toBe(true);
    expect(attachIgnivarModelVfx(model)).toBe(false);
    expect(model.getObjectByName('vfx_core__plume')).toBeDefined();
    expect(model.getObjectByName('vfx_ventl__plume')).toBeDefined();
    expect(model.getObjectByName('vfx_ventr__plume')).toBeDefined();
    expect(model.getObjectByName('vfx_core__flame')).toBeDefined();
    expect(model.getObjectByName('ignivar__pulse_shell')).toBeDefined();
    expect(model.getObjectByName('ignivar__shockwave')).toBeDefined();

    const plume = model.getObjectByName('vfx_core__plume') as THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    const smoke = model.getObjectByName('vfx_core__smoke') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    const shimmer = model.getObjectByName('vfx_core__shimmer') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    for (const material of [plume.material, smoke.material, shimmer.material]) {
      expect(material.vertexShader).toContain('float mscale = length(modelMatrix[1].xyz);');
    }
    expect(plume.material.vertexShader).toContain('gl_PointSize = aSize * mscale * grow');
    // The pow bases are clamped with max(x, 0.0): GLSL pow is undefined for a
    // negative base, and some drivers return NaN, which blanks the whole plume.
    expect(plume.material.vertexShader).toMatch(
      /\(pow\(max\(life, 0\.0\), 1\.3\) \* uReach \* 2\.0\s*\+\s*sin\([^;]+\) \* mscale;/s,
    );
    expect(smoke.material.vertexShader).toContain('float width = (0.018 + t * 0.085) * mscale;');
    expect(smoke.material.vertexShader).toContain(
      'world.y += pow(max(t, 0.0), 1.15) * uReach * 2.6 * mscale;',
    );
    expect(shimmer.material.vertexShader).toContain(
      'float s = 0.55 * (0.8 + 0.4 * uIntensity) * mscale;',
    );

    const coreFlame = model.getObjectByName('vfx_core__flame') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >;
    for (let frame = 0; frame < 20; frame++) {
      syncIgnivarModelVfx(model, 1 / 60, undefined, {
        dead: false,
        castingAbility: IGNIVAR_SKYFIRE_CAST_ID,
        channeling: false,
      });
    }
    expect(coreFlame.material.uniforms.uFlame.value).toBeGreaterThan(0.75);

    for (let frame = 0; frame < 30; frame++) {
      syncIgnivarModelVfx(model, 1 / 60, undefined, {
        dead: false,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        channeling: true,
      });
    }
    expect(coreFlame.material.uniforms.uFlame.value).toBeLessThan(0.3);

    for (let frame = 0; frame < 20; frame++) {
      syncIgnivarModelVfx(model, 1 / 60, undefined, {
        dead: false,
        castingAbility: IGNIVAR_FORGE_WAVE_CAST_ID,
        channeling: true,
      });
    }
    expect(coreFlame.material.uniforms.uFlame.value).toBeGreaterThan(0.75);

    for (let frame = 0; frame < 30; frame++) {
      syncIgnivarModelVfx(model, 1 / 60, undefined, {
        dead: false,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        channeling: true,
      });
    }
    expect(coreFlame.material.uniforms.uFlame.value).toBeLessThan(0.3);

    for (let frame = 0; frame < 20; frame++) {
      syncIgnivarModelVfx(model, 1 / 60, undefined, {
        dead: false,
        castingAbility: IGNIVAR_FRONTAL_CAST_ID,
        channeling: false,
      });
    }
    expect(coreFlame.material.uniforms.uFlame.value).toBeGreaterThan(0.75);

    disposeIgnivarModelVfx(model);
    expect(model.getObjectByName('ignivar__shockwave')).toBeUndefined();
    textureLoad.mockRestore();
  });

  it('drives the contributor ground-fire AoE through warning, eruption, and shutdown', () => {
    const scene = new THREE.Scene();
    const aoe = createGroundFireAoe({ radius: 3, count: 8 });
    scene.add(aoe.group);

    expect(aoe.group.name).toBe('ground_fire_aoe');
    expect(aoe.group.scale.toArray()).toEqual([3, 3, 3]);
    expect(aoe.phase()).toBe('off');
    aoe.heatup();
    aoe.update(1 / 60);
    expect(aoe.phase()).toBe('heatup');
    const disc = aoe.group.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.CircleGeometry,
      THREE.ShaderMaterial
    >;
    expect(disc.material.fragmentShader).toMatch(
      /1\.0\s*-\s*smoothstep\(\s*uHeat \* 1\.15 - 0\.35,\s*uHeat \* 1\.15,\s*r \+ \(n - 0\.5\) \* 0\.2\s*\)/s,
    );
    aoe.erupt();
    aoe.update(1 / 60);
    expect(aoe.phase()).toBe('fire');
    aoe.stop();
    expect(aoe.phase()).toBe('off');

    aoe.dispose();
    expect(scene.getObjectByName('ground_fire_aoe')).toBeUndefined();
  });
});
