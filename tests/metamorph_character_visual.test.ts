import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

function skinnedBox(
  name: string,
  size: [number, number, number],
  skeleton: THREE.Skeleton,
  material: THREE.Material,
): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(...size);
  const count = geometry.getAttribute('position').count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(skeleton);
  return mesh;
}

function stubMetamorphRig(): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
} {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'Root';
  const chest = new THREE.Bone();
  chest.name = 'Spine02';
  chest.position.y = 1;
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.y = 0.35;
  const leftHand = new THREE.Bone();
  leftHand.name = 'L_Hand';
  leftHand.position.set(0.75, 0.1, 0);
  const rightHand = new THREE.Bone();
  rightHand.name = 'R_Hand';
  rightHand.position.set(-0.75, 0.1, 0);
  root.add(chest);
  chest.add(head, leftHand, rightHand);

  const leftWing = new THREE.Group();
  leftWing.name = 'metamorph_wing_left_hinge';
  leftWing.rotation.set(-0.05, 0.08, -0.045);
  const rightWing = new THREE.Group();
  rightWing.name = 'metamorph_wing_right_hinge';
  rightWing.rotation.set(-0.05, -0.08, 0.045);
  chest.add(leftWing, rightWing);
  scene.add(root);
  scene.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton([root, chest, head, leftHand, rightHand]);
  skeleton.calculateInverses();
  scene.add(
    skinnedBox(
      'metamorph_body',
      [1.4, 2.1, 0.7],
      skeleton,
      new THREE.MeshStandardMaterial({ color: 0x17151c }),
    ),
    skinnedBox(
      'metamorph_armor',
      [1.8, 0.5, 0.8],
      skeleton,
      new THREE.MeshStandardMaterial({ color: 0x29242f }),
    ),
    skinnedBox(
      'metamorph_accent',
      [0.2, 0.2, 0.2],
      skeleton,
      new THREE.MeshStandardMaterial({
        color: 0x9f54ce,
        emissive: 0x491267,
      }),
    ),
  );
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0x30253e });
  const wingGeometry = new THREE.BoxGeometry(1.4, 1.2, 0.12);
  const leftMembrane = new THREE.Mesh(wingGeometry, wingMaterial);
  leftMembrane.name = 'metamorph_wing_left_membrane';
  leftMembrane.position.x = 0.75;
  const rightMembrane = new THREE.Mesh(wingGeometry, wingMaterial);
  rightMembrane.name = 'metamorph_wing_right_membrane';
  rightMembrane.position.x = -0.75;
  leftWing.add(leftMembrane);
  rightWing.add(rightMembrane);

  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.VectorKeyframeTrack('Spine02.position', [0, 1], [0, 1, 0, 0, 1.02, 0]),
    ]);
  return {
    scene,
    animations: [
      clip('Idle'),
      clip('Walk'),
      clip('Run'),
      clip('Attack'),
      clip('Hit'),
      clip('Death'),
      clip('Cast'),
    ],
  };
}

const idleState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

describe('Metamorphosis character integration', () => {
  it('uses a dedicated form without renderer-side scale or material substitution', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      "this.createCharacterVisualWithRetry(e, 'form_metamorph', 'form_metamorph')",
    );
    expect(source).toContain('v.metamorphVisual?.setFar(v.isFar && active === v.metamorphVisual);');
    expect(source).toContain("createCharacterVisual(metamorphEntity, 'form_metamorph')");
    expect(source).toContain('for (const visual of playerPrewarmInstances) visual.dispose();');
    expect(source).toContain('v.metamorphVisual?.setActive(');
    expect(source).toContain(
      'formVisibility.metamorph && v.formCompilePending !== v.metamorphVisual.root',
    );
    expect(source).toContain('characterFormShadowPlan(');
    expect(source).toContain(
      'v.metamorphVisual?.setProxyShadow(shadowPlan.formProxy && active === v.metamorphVisual)',
    );
    expect(source).toContain('const displayScale = e.scale;');
    expect(source).not.toContain('setMetamorph(');
    expect(source).not.toContain('LICH_FORM_SCALE');
  });

  it('animates rigged wings, hands, shadows, LOD, and disposal without extra body geometry', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubMetamorphRig())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      // assets.ts resolves skin atlases through the KTX2 path since the
      // fleet conversion; the mock must provide it (review 3050).
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));

    const { charactersReady } = await import('../src/render/characters/assets');
    await charactersReady();
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const visual = new CharacterVisual('form_metamorph', 0xffffff, 0);
    const owner = new THREE.Group();
    owner.add(visual.root);
    owner.updateMatrixWorld(true);
    expect(visual.height).toBe(2.55);
    expect(visual.root.getObjectByName('metamorph_body')).toBeDefined();
    expect(visual.root.getObjectByName('Rogue_Body')).toBeUndefined();

    const leftWing = visual.root.getObjectByName('metamorph_wing_left_hinge') as THREE.Group;
    const rightWing = visual.root.getObjectByName('metamorph_wing_right_hinge') as THREE.Group;
    const leftRest = leftWing.rotation.clone();
    const rightRest = rightWing.rotation.clone();
    visual.update(0.12, idleState, true);
    expect(leftWing.rotation.y).toBeGreaterThan(leftRest.y);
    expect(rightWing.rotation.y).toBeLessThan(rightRest.y);

    visual.update(0.5, { ...idleState, casting: true }, true);
    expect(leftWing.rotation.y).toBeLessThan(leftRest.y + 0.1);
    expect(rightWing.rotation.y).toBeGreaterThan(rightRest.y - 0.1);

    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    expect(visual.metamorphHandWorldPositions(left, right)).toBe(true);
    expect(left.distanceTo(right)).toBeGreaterThan(0.5);
    owner.visible = false;
    expect(visual.metamorphHandWorldPositions(left, right)).toBe(false);
    owner.visible = true;
    owner.matrixWorldAutoUpdate = false;
    expect(visual.metamorphHandWorldPositions(left, right)).toBe(false);
    owner.matrixWorldAutoUpdate = true;
    visual.setFar(true);
    expect(visual.metamorphHandWorldPositions(left, right)).toBe(false);
    visual.setFar(false);
    visual.update(0.5, idleState, true);
    const idleWingY = leftWing.rotation.y;
    visual.pulseMetamorphosis();
    visual.update(0.01, idleState, true);
    expect(leftWing.rotation.y).toBeLessThan(idleWingY);

    visual.setActive(false);
    visual.setActive(true);
    visual.update(0.01, idleState, true);
    expect(leftWing.rotation.y).toBeGreaterThan(leftRest.y + 0.5);

    const modelWrap = visual.root.getObjectByName('character_model_wrap');
    const farMesh = visual.root.getObjectByName('character_far_mesh') as THREE.Mesh;
    visual.setFar(true);
    expect(modelWrap?.visible).toBe(false);
    expect(farMesh.visible).toBe(true);
    const shadowProxy = visual.root.getObjectByName('character_shadow_proxy') as THREE.Mesh;
    visual.setShadow(false);
    visual.setProxyShadow(true);
    expect(shadowProxy.visible).toBe(true);
    expect(shadowProxy.castShadow).toBe(true);
    visual.setProxyShadow(false);
    visual.pulseMetamorphosis();
    visual.update(1, idleState, true);
    expect((visual as unknown as { metamorphPulse: number }).metamorphPulse).toBe(0);
    visual.setFar(false);
    expect(modelWrap?.visible).toBe(true);
    expect(farMesh.visible).toBe(false);

    visual.setActive(false);
    visual.setActive(true);
    visual.update(0.2, idleState, true);
    const normalMotionY = leftWing.rotation.y;
    visual.setActive(false);
    visual.setActive(true);
    visual.update(0.2, idleState, true, true);
    expect(leftWing.rotation.y).not.toBeCloseTo(normalMotionY, 4);

    const demonMeshes: THREE.Mesh[] = [];
    visual.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.name.startsWith('metamorph_')) demonMeshes.push(mesh);
    });
    expect(demonMeshes.length).toBeGreaterThan(2);
    expect(demonMeshes.every((mesh) => !mesh.castShadow)).toBe(true);
    visual.setShadow(true);
    expect(demonMeshes.every((mesh) => mesh.castShadow)).toBe(true);

    visual.update(0.5, { ...idleState, moving: true, running: true }, true);
    visual.update(0.06, { ...idleState, airborne: true }, true);
    const jumpActions = (visual as unknown as { actions: Map<string, THREE.AnimationAction> })
      .actions;
    expect(
      (visual as unknown as { current: THREE.AnimationAction | null }).current?.getClip().name,
    ).toBe('Idle');
    expect(jumpActions.get('Run')?.getEffectiveWeight()).toBe(0);
    expect(jumpActions.get('Idle')?.getEffectiveWeight()).toBeCloseTo(1, 5);

    visual.update(0.1, { ...idleState, dead: true }, true);
    const deathAction = (visual as unknown as { current: THREE.AnimationAction | null }).current;
    expect(deathAction?.getClip().name).toBe('Death');
    visual.update(0.1, idleState, true);
    const revivedAction = (visual as unknown as { current: THREE.AnimationAction | null }).current;
    expect(revivedAction?.getClip().name).toBe('Idle');

    const skeleton = (visual.root.getObjectByName('metamorph_body') as THREE.SkinnedMesh).skeleton;
    const disposeSkeleton = vi.spyOn(skeleton, 'dispose');
    visual.dispose();
    expect(disposeSkeleton).toHaveBeenCalledOnce();

    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  }, 15_000);
});
