import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { AnimState } from '../../src/render/characters/anim_state';
import { CastLocomotion } from '../../src/render/characters/cast_locomotion';
import { prepareCasterClips } from '../../src/render/characters/caster_clips';
import { VISUALS } from '../../src/render/characters/manifest';

it('performs purposeful casts on every native caster and Moonwing body', async () => {
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
        'player_mage',
        ['fireball', 'dragons_breath', 'glacial_front', 'rune_of_power', 'evocation'],
      ],
      [
        'player_priest',
        ['heal', 'power_word_shield', 'mind_flay', 'choir_of_deliverance', 'smite', 'silence'],
      ],
      ['player_warlock', ['needle_of_fate', 'soul_harvest', 'raise_graveguard', 'drain_life']],
      ['player_shaman', ['healing_wave', 'chain_lightning', 'earthquake']],
      ['player_paladin', ['dawns_embrace', 'radiant_chorus', 'aegis_first_dawn']],
      ['player_hunter', ['tame_beast', 'revive_pet', 'stampede', 'shellskin']],
      ['player_rogue', ['venom_dart', 'melting_acid', 'nightshade_coating']],
      ['player_druid', ['regrowth', 'entangling_roots', 'tranquility']],
      ['form_moonkin', ['moonseed', 'moonlash', 'sunlance']],
    ] as const) {
      const def = VISUALS[key],
        gltf = await loader.loadAsync('/' + def.url),
        root = gltf.scene;
      const clips = new Map(gltf.animations.map((c) => [c.name, c]));
      for (const url of def.animUrls ?? [])
        for (const c of (await loader.loadAsync('/' + url)).animations) clips.set(c.name, c);
      prepareCasterClips(key, clips, root);
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
          ['heal', 'regrowth', 'entangling_roots'].includes(id) ? 'handslotl' : 'handslotr',
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
            'dragons_breath',
            'heal',
            'mind_flay',
            'needle_of_fate',
            'dawns_embrace',
            'moonlash',
          ].includes(id)
        )
          await page.screenshot({ path: `../../docs/screenshots/v25-${key}-${id}.png` });
        action.stop();
      }
      if (key === 'player_mage') {
        const cast = clips.get('Signature_Hold_fireball')!,
          action = mixer.clipAction(cast);
        action.reset().play();
        mixer.setTime(0.72);
        action.paused = true;
        const layer = new CastLocomotion(root, clips, def),
          foot = root.getObjectByName('footr')!,
          hand = root.getObjectByName('handslotr')!;
        const state = {
          speed: 7,
          moving: true,
          running: true,
          casting: true,
          castingAbility: 'fireball',
          dead: false,
          backwards: false,
          airborne: false,
          swimming: false,
          sitting: false,
        } as AnimState;
        const lower = [
          'hips',
          'upperlegr',
          'lowerlegr',
          'footr',
          'upperlegl',
          'lowerlegl',
          'footl',
        ].map((name) => root.getObjectByName(name)!);
        const expected = lower.map((node) => ({
          q: node.quaternion.clone(),
          p: node.position.clone(),
        }));
        const feet: THREE.Vector3[] = [],
          hands: THREE.Vector3[] = [];
        for (let frame = 0; frame < 30; frame++) {
          layer.restore();
          mixer.update(1 / 60);
          layer.update(1 / 60, state);
          root.updateMatrixWorld(true);
          feet.push(foot.getWorldPosition(new THREE.Vector3()));
          hands.push(hand.getWorldPosition(new THREE.Vector3()));
        }
        expect(Math.max(...feet.map((v) => v.distanceTo(feet[0])))).toBeGreaterThan(0.12);
        expect(hands.every((v) => Number.isFinite(v.length()))).toBe(true);
        // A paused hold still restores both feet after the final moving frame.
        layer.restore();
        mixer.update(1 / 60);
        layer.update(1 / 60, { ...state, moving: false });
        for (let i = 0; i < lower.length; i++) {
          expect(lower[i].quaternion.angleTo(expected[i].q)).toBeLessThan(0.001);
          expect(lower[i].position.distanceTo(expected[i].p)).toBeLessThan(0.00001);
        }
        // A quick off-GCD flick cannot displace the held cast's opposite arm or legs.
        const right = root.getObjectByName('upperarmr')!,
          left = root.getObjectByName('upperarml')!;
        const rightBefore = right.quaternion.clone(),
          leftBefore = left.quaternion.clone();
        expect(layer.triggerFlick()).toBe(true);
        layer.restore();
        mixer.update(0.05);
        layer.update(0.05, { ...state, moving: false });
        expect(right.quaternion.angleTo(rightBefore)).toBeGreaterThan(0.02);
        expect(left.quaternion.angleTo(leftBefore)).toBeLessThan(0.001);
        for (let i = 0; i < 20; i++) {
          layer.restore();
          mixer.update(0.02);
          layer.update(0.02, { ...state, moving: false });
        }
        expect(right.quaternion.angleTo(rightBefore)).toBeLessThan(0.001);
        expect(action.paused).toBe(true);
        action.stop();
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
