import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { runContextRestoreResets } from '../src/render/context_restore_registry';
import {
  buildInitialSceneCompileUnits,
  buildSceneRestoreCompileUnits,
  programContentKeys,
} from '../src/render/initial_scene_compile_units';
import {
  buildPrewarmProgramAnchors,
  disposePrewarmProgramAnchors,
} from '../src/render/prewarm_program_anchors';

it('retains one compact material/geometry representative per program shape', () => {
  const owner = {};
  const source = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BoxGeometry();
  source.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material.clone()));
  const anchors = buildPrewarmProgramAnchors(owner, source);
  expect(anchors.visible).toBe(false);
  expect(anchors.children).toHaveLength(1);
  const first = anchors.children[0] as THREE.Mesh;
  const update = vi.spyOn(first, 'updateMatrixWorld');
  anchors.updateMatrixWorld();
  expect(update).not.toHaveBeenCalled();
  anchors.updateMatrixWorld(true);
  expect(update).toHaveBeenCalledOnce();
  expect(first.material).not.toBe(material);
  expect(first.geometry).not.toBe(geometry);
  expect(first.geometry.getAttribute('position').count).toBe(3);
  expect(programContentKeys(first)).toEqual(programContentKeys(source.children[0]));
  const dispose = vi.fn();
  (first.material as THREE.Material).addEventListener('dispose', dispose);
  material.dispose();
  runContextRestoreResets();
  expect(dispose).not.toHaveBeenCalled();
  disposePrewarmProgramAnchors(owner);
  disposePrewarmProgramAnchors(owner);
  expect(dispose).toHaveBeenCalledOnce();
  geometry.dispose();
});

it('preserves skinned, morph and instanced structural variants without source skeletons', () => {
  const owner = {};
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(new Float32Array(72), 3),
    new THREE.Float32BufferAttribute(new Float32Array(72), 3),
  ];
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(96), 4));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const skin = new THREE.SkinnedMesh(geometry, material);
  skin.bind(new THREE.Skeleton([new THREE.Bone(), new THREE.Bone()]));
  skin.castShadow = true;
  const instances = new THREE.InstancedMesh(geometry, material, 50);
  instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(150), 3);
  instances.morphTexture = new THREE.DataTexture(new Float32Array(4), 1, 1);
  group.add(skin, instances);
  const anchors = buildPrewarmProgramAnchors(owner, group);
  expect(anchors.children.map(programContentKeys)).toEqual(group.children.map(programContentKeys));
  const compactSkin = anchors.children[0] as THREE.SkinnedMesh;
  expect(compactSkin.skeleton).not.toBe(skin.skeleton);
  expect(compactSkin.skeleton.bones).toHaveLength(1);
  expect(compactSkin.geometry.morphAttributes.position).toHaveLength(2);
  disposePrewarmProgramAnchors(owner);
});

it('gives anchors ownership before identical scene roots and relinks them during restore hold', async () => {
  const owner = {};
  const source = new THREE.Group();
  const live = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  source.add(live);
  const anchors = buildPrewarmProgramAnchors(owner, source);
  const scene = new THREE.Scene();
  scene.add(live, anchors);
  const compiled: THREE.Object3D[] = [];
  const common = {
    scene,
    playerX: 0,
    playerZ: 0,
    batchSize: 1,
    compileColor: async (root: THREE.Object3D) => {
      compiled.push(root);
    },
    compileShadow: async () => {},
  };
  const initial = buildInitialSceneCompileUnits({
    ...common,
    stagedGroups: [['players', anchors]],
    includeGroup: () => true,
    residentScene: true,
    sharedDedupe: { seen: new Set(), seenKeys: new Set() },
    onCompiledRoot() {},
  });
  for (const unit of initial) await unit.run();
  expect(compiled).toEqual(anchors.children);
  compiled.length = 0;
  runContextRestoreResets();
  const restored = buildSceneRestoreCompileUnits({
    ...common,
    reach: 'visible',
    sharedDedupe: { seen: new Set(), seenKeys: new Set() },
  });
  for (const unit of restored) await unit.run();
  expect(compiled).toEqual(anchors.children);
  disposePrewarmProgramAnchors(owner);
});
