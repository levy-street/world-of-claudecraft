import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lanes = vi.hoisted(() => ({
  events: [] as string[],
  upload: vi.fn(),
  touch: vi.fn(),
}));
vi.mock('../src/render/shader_warm_gate', () => ({
  runPiecesWarmed: async (
    _arms: unknown,
    _scene: unknown,
    pieces: unknown[],
    options: {
      submit: (pieces: unknown[], first: number) => Promise<unknown>;
    },
  ) => options.submit(pieces, 0),
}));
vi.mock('../src/render/program_variant_settle', () => ({
  pieceProgramSettle: () => async () => {
    lanes.events.push('settle');
  },
}));
vi.mock('../src/render/texture_prep_lane', () => ({
  runTexturePrepLane: async (...args: unknown[]) => {
    lanes.events.push('upload');
    lanes.upload(...args);
  },
}));
vi.mock('../src/render/linked_program_touch_lane', () => ({
  runWorldGateTouchLane: async (...args: unknown[]) => {
    lanes.events.push('touch');
    lanes.touch(...args);
  },
}));

import { prepareSceneryAtlas } from '../src/render/scenery_bands/atlas_preparation';

describe('scenery atlas preparation', () => {
  beforeEach(() => {
    lanes.events.length = 0;
    lanes.upload.mockClear();
    lanes.touch.mockClear();
  });

  it('links the bake light/target variant then settles, uploads and touches it before return', async () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()));
    scene.add(new THREE.DirectionalLight());
    const camera = new THREE.OrthographicCamera();
    const target = new THREE.WebGLRenderTarget(16, 16);
    const prior = new THREE.WebGLRenderTarget(8, 8);
    let bound = prior;
    let queueHeld = false;
    const properties = {};
    const webgl = {
      properties,
      getContext: () => null,
      getRenderTarget: () => bound,
      setRenderTarget: (value: THREE.WebGLRenderTarget) => {
        bound = value;
      },
      compileAsync: async (_root: THREE.Object3D, view: THREE.Camera, lights: THREE.Scene) => {
        expect(queueHeld).toBe(true);
        expect(bound).toBe(target);
        expect(view).toBe(camera);
        expect(lights).toBe(scene);
        lanes.events.push('link');
        await Promise.resolve();
        expect(bound).toBe(prior);
      },
    } as unknown as THREE.WebGLRenderer;
    const queue = {
      run: async <T>(work: () => T | Promise<T>): Promise<T> => {
        expect(queueHeld).toBe(false);
        queueHeld = true;
        try {
          return await work();
        } finally {
          queueHeld = false;
        }
      },
    };
    await prepareSceneryAtlas(queue, webgl, scene, camera, target);
    expect(lanes.events).toEqual(['link', 'settle', 'upload', 'touch']);
    expect(lanes.upload.mock.calls[0][3]).toBe(scene);
    expect(lanes.touch.mock.calls[0][2]).toBe(scene);
    expect(bound).toBe(prior);
    expect(queueHeld).toBe(false);
  });
});
