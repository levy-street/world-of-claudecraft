import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { prepareBeastAbilityClips } from '../../src/render/characters/beast_ability_clips';
import { VISUALS } from '../../src/render/characters/manifest';
import { prepareMeleeClips } from '../../src/render/characters/melee_clips';
import { prepareNamedActionClips } from '../../src/render/characters/named_action_clips';
import { CharacterSurfaceResponse } from '../../src/render/characters/surface_response';
import { meleeImpactProfile } from '../../src/render/melee_impact_core';

it('binds contact and named actions to shipped skeletons and renders target wounds on the native material', async () => {
  await page.viewport(1000, 740);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(980, 700);
  document.body.appendChild(renderer.domElement);
  const ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202833);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x45505a, 2));
  const sun = new THREE.DirectionalLight(0xffe5c0, 3);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(38, 980 / 700, 0.01, 100);
  camera.position.set(3, 2.3, 3.5);
  camera.lookAt(0, 1, 0);
  try {
    for (const [key, ids] of [
      [
        'player_rogue',
        [
          'ambush',
          'eviscerate',
          'rupture',
          'blind',
          'garrote',
          'body_blow',
          'knockout_blow',
          'gouge',
          'flurry_of_knives',
          'thieves_chorus',
        ],
      ],
      [
        'player_hunter',
        [
          'raptor_strike',
          'mongoose_bite',
          'wing_clip',
          'bloodhook',
          'frostjaw_trap',
          'shrapnel_charge',
          'pack_command',
          'unleash_beast',
        ],
      ],
      ['player_warrior', ['pummel']],
      ['player_druid', ['skull_bash']],
      [
        'form_bear',
        [
          'skull_bash',
          'feral_charge',
          'primal_reflexes',
          'maul',
          'swipe',
          'marrowbreak',
          'challenging_roar',
        ],
      ],
      ['form_cat', ['skull_bash']],
    ] as const) {
      const def = VISUALS[key],
        gltf = await loader.loadAsync('/' + def.url),
        root = gltf.scene;
      const clips = new Map(gltf.animations.map((c) => [c.name, c]));
      for (const url of def.animUrls ?? [])
        for (const c of (await loader.loadAsync('/' + url)).animations) clips.set(c.name, c);
      prepareMeleeClips(clips, def.clips.attackByAbility);
      prepareNamedActionClips(key, clips, root);
      prepareBeastAbilityClips(key, clips);
      const bounds = new THREE.Box3().setFromObject(root, true),
        scale = def.height / (bounds.max.y - bounds.min.y);
      root.scale.setScalar(scale);
      root.position.y = -bounds.min.y * scale;
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      for (const id of ids) {
        const clip = clips.get('Signature_' + id);
        expect(clip, id).toBeDefined();
        const action = mixer.clipAction(clip!);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.reset().play();
        const bone = root.getObjectByName(
          key === 'form_bear'
            ? 'head'
            : id === 'skull_bash'
              ? key === 'form_cat'
                ? 'Head'
                : 'head'
              : 'handslotr',
        );
        expect(bone, id).toBeDefined();
        const points = [];
        for (const time of [0, 0.1, 0.15, 0.32, 0.68]) {
          mixer.setTime(time);
          root.updateMatrixWorld(true);
          points.push(bone!.getWorldPosition(new THREE.Vector3()));
        }
        expect(points[1].distanceTo(points[2]), key + ':' + id).toBeGreaterThan(0.01);
        expect(points[0].distanceTo(points[4]), key + ':' + id + ' recovery').toBeLessThan(0.08);
        action.reset().play();
        mixer.setTime(0.15);
        renderer.render(scene, camera);
        if (
          [
            'ambush',
            'eviscerate',
            'rupture',
            'blind',
            'garrote',
            'body_blow',
            'mongoose_bite',
            'skull_bash',
            'feral_charge',
            'primal_reflexes',
          ].includes(id)
        )
          await page.screenshot({ path: `../../docs/screenshots/v25-${key}-${id}.png` });
        action.stop();
      }
      if (key === 'player_rogue') {
        const response = new CharacterSurfaceResponse();
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && !Array.isArray(mesh.material))
            mesh.material = response.material(mesh.material);
        });
        await renderer.compileAsync(scene, camera);
        const programs = renderer.info.programs?.length;
        response.trigger('physical-blood', 0.95, meleeImpactProfile('garrote'));
        response.update(0.08, root, def.height);
        renderer.render(scene, camera);
        expect(renderer.info.programs?.length).toBe(programs);
        await page.screenshot({ path: '../../docs/screenshots/v25-target-bleeding.png' });
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      scene.remove(root);
    }
    expect(errors.mock.calls).toEqual([]);
    expect(renderer.getContext().isContextLost()).toBe(false);
  } finally {
    ktx.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    errors.mockRestore();
  }
}, 90000);
