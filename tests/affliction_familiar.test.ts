import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AfflictionFamiliar } from '../src/render/affliction_familiar';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/props/maledict_eye.glb');
// Re-pinned for the KTX2 texture conversion (scripts/assets/
// compress_glb_textures.mjs): larger on disk, ~8x smaller resident on GPU.
const ASSET_BYTES = 201_436;
const ASSET_SHA256 = '0c1ad6838925ae4202af8e7cedbfb750e1122daa7c3f3c34d8d2aefeb14531a1';

function afflictionWorld(player: Entity): IWorld {
  return {
    playerId: player.id,
    player,
    talentSpec: 'affliction',
    entities: new Map([[player.id, player]]),
  } as unknown as IWorld;
}

describe('Affliction Maledict Eye familiar', () => {
  it('pins the approved generated eye artifact and its compact static shape', async () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.length).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    // 200 KiB, was 150: KTX2 textures trade disk bytes for ~8x smaller GPU
    // residency (the glb_texture_compression gate requires the conversion).
    expect(bytes.length).toBeLessThanOrEqual(200 * 1024);

    const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(ASSET_PATH);
    const root = document.getRoot();
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listMeshes()).toHaveLength(1);
    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives).toHaveLength(1);
    expect((primitives[0].getIndices()?.getCount() ?? 0) / 3).toBe(1_577);
    expect(primitives[0].getAttribute('POSITION')?.getCount()).toBe(1_386);
    expect(root.listTextures().map((texture) => texture.getMimeType())).toEqual([
      'image/ktx2',
      'image/ktx2',
      'image/ktx2',
    ]);
  });

  it('attaches one scale-independent eye and removes it immediately on spec change', () => {
    const player = {
      id: 7,
      kind: 'player',
      templateId: 'warlock',
      dead: false,
      scale: 2,
      auras: [],
    } as unknown as Entity;
    const world = afflictionWorld(player);
    const host = new THREE.Group();
    host.scale.setScalar(player.scale);
    const views = new Map([[player.id, { group: host }]]);
    const factory = vi.fn(() => {
      const model = new THREE.Group();
      model.name = 'approved-maledict-eye-model';
      return model;
    });
    const familiar = new AfflictionFamiliar(factory);

    familiar.update(world, views, true, 0);
    const root = host.getObjectByName('affliction-familiar') as THREE.Group;
    expect(root).toBeDefined();
    expect(root.scale.x).toBeCloseTo(0.5, 5);
    expect(root.getObjectByName('approved-maledict-eye-model')).toBeDefined();
    expect(factory).toHaveBeenCalledOnce();

    familiar.update(world, views, true, 1);
    expect(factory).toHaveBeenCalledOnce();
    expect(host.getObjectByName('affliction-familiar')).toBe(root);

    world.talentSpec = 'necromancy';
    familiar.update(world, views, true, 2);
    expect(host.getObjectByName('affliction-familiar')).toBeUndefined();

    world.talentSpec = 'affliction';
    familiar.update(world, views, true, 3);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(host.getObjectByName('affliction-familiar')).toBeDefined();

    familiar.clear();
    expect(host.getObjectByName('affliction-familiar')).toBeUndefined();
  });

  it('preloads the model and keeps the manager in the renderer frame update', () => {
    const familiarSource = readFileSync(
      path.join(REPO_ROOT, 'src/render/affliction_familiar.ts'),
      'utf8',
    );
    const rendererSource = readFileSync(path.join(REPO_ROOT, 'src/render/renderer.ts'), 'utf8');
    expect(familiarSource).toContain("const MODEL_URL = '/models/props/maledict_eye.glb'");
    expect(familiarSource).toContain('loadGltf(MODEL_URL)');
    // Deferred, never eager: the launch-burst OOM lane (defer_launcher_preloads).
    expect(familiarSource).toContain('registerDeferredPreload(');
    expect(rendererSource).toContain('new AfflictionFamiliar()');
    expect(rendererSource).toContain(
      'this.afflictionFamiliar.update(this.sim, this.views, this.reducedMotion(), this.time)',
    );
  });

  it('renders Maledict Gaze as an Eye-origin ray instead of a generic projectile', () => {
    const vfxSource = readFileSync(path.join(REPO_ROOT, 'src/render/drain_life_vfx.ts'), 'utf8');
    const rendererSource = readFileSync(path.join(REPO_ROOT, 'src/render/renderer.ts'), 'utf8');

    expect(rendererSource).toContain("ev.fx === 'evilEyeGaze'");
    expect(rendererSource).toContain(
      'this.vfx.evilEyeGaze(ev.sourceId, ev.targetId, ev.duration ?? 0.28)',
    );
    expect(vfxSource).toContain('evilEyeGaze(casterId: number, targetId: number');
    expect(vfxSource).toContain('AFFLICTION_FAMILIAR_LOCAL_X');
    expect(vfxSource).toContain("slot.kind === 'evilEyeGaze'");
    expect(vfxSource).toContain('const GAZE_CORE = 0xc8ff86');
    expect(vfxSource).toContain('const GAZE_FLOW = 0x7d36bd');
  });
});
