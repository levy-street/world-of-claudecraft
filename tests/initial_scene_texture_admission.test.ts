import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectInitialSceneTextures,
  InitialSceneTextureAdmission,
  initialPresentationViewRoots,
} from '../src/render/initial_scene_texture_admission';

it('collects visible scene textures plus only explicitly prioritized hidden roots', () => {
  const scene = new THREE.Scene();
  const sceneTexture = new THREE.Texture();
  const hiddenSceneTexture = new THREE.Texture();
  const priorityTexture = new THREE.Texture();
  const deferredTexture = new THREE.Texture();
  scene.add(
    new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: sceneTexture })),
  );
  const hiddenSceneMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ map: hiddenSceneTexture }),
  );
  hiddenSceneMesh.visible = false;
  scene.add(hiddenSceneMesh);
  const priorityRoot = new THREE.Group();
  priorityRoot.visible = false;
  priorityRoot.add(
    new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ map: priorityTexture }),
    ),
  );
  const deferredRoot = new THREE.Group();
  deferredRoot.visible = false;
  deferredRoot.add(
    new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ map: deferredTexture }),
    ),
  );

  expect(collectInitialSceneTextures(scene, [priorityRoot])).toEqual([
    sceneTexture,
    priorityTexture,
  ]);
  expect(collectInitialSceneTextures(scene, [])).toEqual([sceneTexture]);
  expect(collectInitialSceneTextures(scene, [priorityRoot])).not.toContain(deferredTexture);
});

it('keeps only self and current target in the initial entity presentation cohort', () => {
  const self = { group: new THREE.Group() };
  const target = { group: new THREE.Group() };
  const nearby = { group: new THREE.Group() };
  const views = new Map([
    [1, self],
    [2, target],
    [3, nearby],
  ]);

  expect(initialPresentationViewRoots(views, 1, 2)).toEqual([self.group, target.group]);
  expect(initialPresentationViewRoots(views, 1, null)).toEqual([self.group]);
});

describe('InitialSceneTextureAdmission', () => {
  it('interleaves one texture, then drains the remaining cursor without duplicates', async () => {
    const uploaded: string[] = [];
    const yields: number[] = [];
    const admission = new InitialSceneTextureAdmission(
      ['near', 'middle', 'far', 'middle'],
      (texture) => uploaded.push(texture),
      () => 0,
      async () => {
        yields.push(uploaded.length);
      },
    );

    expect(admission.admitOneBefore(1)).toBe(true);
    expect(admission.progress()).toEqual({ initialized: 1, planned: 3, trimmed: true });

    await expect(admission.drainBefore(1, 1)).resolves.toEqual({
      initialized: 3,
      planned: 3,
      trimmed: false,
    });
    expect(uploaded).toEqual(['near', 'middle', 'far']);
    expect(yields).toEqual([2]);
    expect(admission.remaining()).toEqual([]);
  });

  it('stops before starting another indivisible upload once the deadline is reached', async () => {
    let now = 0;
    const uploaded: string[] = [];
    const admission = new InitialSceneTextureAdmission(
      ['near', 'middle', 'far'],
      (texture) => {
        uploaded.push(texture);
        now++;
      },
      () => now,
      async () => {},
    );

    await expect(admission.drainBefore(2, 8)).resolves.toEqual({
      initialized: 2,
      planned: 3,
      trimmed: true,
    });
    expect(uploaded).toEqual(['near', 'middle']);
    expect(admission.remaining()).toEqual(['far']);
    expect(admission.admitOneBefore(2)).toBe(false);
  });

  it('keeps a failed upload in the explicit resume remainder', () => {
    let attempts = 0;
    const admission = new InitialSceneTextureAdmission(
      ['near', 'far'],
      (texture) => {
        attempts++;
        if (texture === 'near' && attempts === 1) throw new Error('transient GPU failure');
      },
      () => 0,
    );

    expect(() => admission.admitOneBefore(1)).toThrow('transient GPU failure');
    expect(admission.progress()).toEqual({ initialized: 0, planned: 2, trimmed: true });
    expect(admission.remaining()).toEqual(['near', 'far']);

    expect(admission.admitOneBefore(1)).toBe(true);
    expect(admission.remaining()).toEqual(['far']);
  });
});
