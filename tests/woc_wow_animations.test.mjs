import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, LoopOnce, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { retargetClip, worldPose } from '../scripts/assets/wow_human/retarget.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { wocEntryBodyUrls } from '../src/render/characters/woc_entry_core';
import { wocWowAnimsUrl } from '../src/render/characters/woc_wow_animations';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const basePath = (fit) => `public/models/chars/players/woc/base_${fit}.glb`;
const runtimeNames = [
  'WoW_a_idle',
  'WoW_a_walkN',
  'WoW_a_runN',
  'WoW_a_walkS',
  'WoW_a_swimN',
  'WoW_a_idle_swim',
  'WoW_a_jump',
  'WoW_a_sit',
  'WoW_act_death',
  'WoW_act_wave',
  'WoW_act_laugh',
  'WoW_act_muscle',
  'WoW_act_bow',
];

describe.each(['male', 'female'])('WoW human animations: %s', (fit) => {
  it('retargets the real source idle onto the target bind lengths and facing', async () => {
    const doc = await io.read(basePath(fit));
    const nodes = doc
      .getRoot()
      .listNodes()
      .filter((n) => !n.getMesh());
    const bones = nodes.map((n) => ({
      name: n.getName(),
      parent: nodes.indexOf(n.getParentNode()),
      t: n.getTranslation(),
      q: n.getRotation(),
    }));
    const source = JSON.parse(fs.readFileSync(`tests/fixtures/wow_human/${fit}_idle.json`, 'utf8'));
    const clip = retargetClip(source, bones, fit, source.clips[0]);
    const world = worldPose(bones, clip.tracks);
    expect(world.get('wrist.l').p.x).toBeGreaterThan(0.15);
    expect(world.get('wrist.r').p.x).toBeLessThan(-0.15);
    expect(world.get('head').p.y).toBeGreaterThan(0.95);
    expect(world.get('head').p.y).toBeLessThan(1.1);
    expect(Math.abs(world.get('wrist.l').p.z)).toBeLessThan(0.15);
    for (const bone of bones.filter((b) => b.name !== 'hips')) {
      expect(clip.tracks[bone.name].t[0]).toEqual(bone.t);
    }
    for (const name of ['handslot.l', 'handslot.r']) {
      expect(clip.tracks[name].q[0]).toEqual(
        bones.find((b) => b.name === name).q.map((q) => expect.closeTo(q, 5)),
      );
    }
    for (const side of ['l', 'r']) {
      const leg = bones.find((b) => b.name === `upperleg.${side}`);
      const delta = new Quaternion(...clip.tracks[leg.name].q[0]).multiply(
        new Quaternion(...leg.q).normalize().invert(),
      );
      for (const name of [`skirt.front.${side}`, `skirt.back.${side}`, `tassel.side.${side}`]) {
        const bone = bones.find((b) => b.name === name);
        const follow = new Quaternion(...clip.tracks[name].q[0]).multiply(
          new Quaternion(...bone.q).normalize().invert(),
        );
        const amount = name.startsWith('tassel.') ? 0.4 : 1;
        expect(follow.angleTo(new Quaternion().slerp(delta, amount))).toBeLessThan(1e-5);
      }
    }
    expect(() => retargetClip({ ...source, bones: [] }, bones, fit, source.clips[0])).toThrow(
      'Missing retarget bone',
    );
  });

  it('ships all distinct clips with valid tracks bound only to this body', async () => {
    const base = await io.read(basePath(fit));
    const names = new Set(
      base
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    const doc = await io.read(`public/${wocWowAnimsUrl(fit)}`);
    expect(doc.getRoot().listMeshes()).toHaveLength(0);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    const clips = doc.getRoot().listAnimations();
    expect(clips).toHaveLength(36);
    expect(new Set(clips.map((c) => c.getName())).size).toBe(36);
    expect(clips.map((c) => c.getName())).toEqual(expect.arrayContaining(runtimeNames));
    for (const clip of clips) {
      expect(clip.listChannels().length).toBeGreaterThan(0);
      for (const channel of clip.listChannels()) {
        expect(names.has(channel.getTargetNode().getName())).toBe(true);
        const sampler = channel.getSampler();
        const times = sampler.getInput().getArray();
        expect(times[0]).toBe(0);
        expect(times.at(-1)).toBeGreaterThan(0);
        for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
        expect(Array.from(sampler.getOutput().getArray()).every(Number.isFinite)).toBe(true);
      }
    }
    expect(fs.statSync(`public/${wocWowAnimsUrl(fit)}`).size).toBeLessThan(400_000);
  });

  it('matches planted-foot travel to the game walk, run and backpedal speeds', async () => {
    const data = new Uint8Array(fs.readFileSync(`public/${wocWowAnimsUrl(fit)}`));
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(data.buffer, '');
    const anatomy = JSON.parse(
      fs.readFileSync('scripts/assets/woc_character/export_split.json', 'utf8'),
    );
    const scale = 2.86 / anatomy.anatomyTop[fit];
    const mixer = new AnimationMixer(gltf.scene);
    for (const [name, expected, direction] of [
      ['WoW_a_walkN', 2.2, -1],
      ['WoW_a_runN', 7, -1],
      ['WoW_a_walkS', 4.55, 1],
    ]) {
      mixer.stopAllAction();
      const clip = gltf.animations.find((c) => c.name === name);
      mixer.clipAction(clip).setLoop(LoopOnce, 1).play();
      const feet = [[], []];
      const steps = Math.ceil(clip.duration * 120);
      const dt = clip.duration / steps;
      for (let i = 0; i < steps; i++) {
        mixer.setTime(i * dt);
        gltf.scene.updateMatrixWorld(true);
        ['footl', 'footr'].forEach((bone, side) => {
          feet[side].push(gltf.scene.getObjectByName(bone).getWorldPosition(new Vector3()));
        });
      }
      const speeds = [];
      for (const samples of feet) {
        const floor = Math.min(...samples.map((p) => p.y));
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1],
            b = samples[i];
          const speed = ((b.z - a.z) * direction * scale) / dt;
          if (Math.max(a.y, b.y) < floor + 0.05 && speed > 0) speeds.push(speed);
        }
      }
      speeds.sort((a, b) => a - b);
      expect(speeds.length).toBeGreaterThan(3);
      expect(speeds[Math.floor(speeds.length / 2)], name).toBeGreaterThan(expected * 0.85);
      expect(speeds[Math.floor(speeds.length / 2)], name).toBeLessThan(expected * 1.15);
    }
  });

  it('plays movement and death through the real Three mixer without lateral facing or a standing corpse', async () => {
    const data = new Uint8Array(fs.readFileSync(`public/${wocWowAnimsUrl(fit)}`));
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(data.buffer, '');
    const mixer = new AnimationMixer(gltf.scene);
    const play = (name, fraction) => {
      mixer.stopAllAction();
      const clip = gltf.animations.find((c) => c.name === name);
      const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      mixer.setTime(clip.duration * fraction);
      gltf.scene.updateMatrixWorld(true);
      return (name) => gltf.scene.getObjectByName(name).getWorldPosition(new Vector3());
    };
    const idle = play('WoW_a_idle', 0.5);
    expect(idle('wristl').x).toBeGreaterThan(0.15);
    expect(idle('wristr').x).toBeLessThan(-0.15);
    const run = play('WoW_a_runN', 0.25);
    expect(run('head').y).toBeGreaterThan(0.8);
    expect(run('footl').distanceTo(run('footr'))).toBeGreaterThan(0.2);
    const wave = play('WoW_act_wave', 0.5);
    expect(wave('wristr').y).toBeGreaterThan(wave('head').y);
    const death = play('WoW_act_death', 1);
    expect(death('hips').y).toBeLessThan(0.15);
    expect(death('head').y).toBeLessThan(0.2);
    expect(play('WoW_a_idle', 0.5)('head').y).toBeGreaterThan(0.95);
  });
});

it('all player classes load their own sex library before world entry and retain combat contacts', () => {
  const bodies = Object.entries(VISUALS).filter(
    ([key, def]) => key.startsWith('player_') && !key.endsWith('_modular') && def.wocCharacter,
  );
  expect(bodies).toHaveLength(18);
  for (const [key, def] of bodies) {
    const fit = def.wocCharacter.fit;
    expect(def.animUrls, key).toContain(wocWowAnimsUrl(fit));
    expect(wocEntryBodyUrls(), key).toContain(wocWowAnimsUrl(fit));
    expect(def.height).toBeCloseTo(2.86, 6);
    expect(def.clips).toMatchObject({
      idle: 'WoW_a_idle',
      walk: 'WoW_a_walkN',
      run: 'WoW_a_runN',
      walkBack: 'WoW_a_walkS',
      swim: 'WoW_a_swimN',
      swimSurface: 'WoW_a_swimN',
      swimIdle: 'WoW_a_idle_swim',
      jump: 'WoW_a_jump',
      death: 'WoW_act_death',
      emote: {
        wave: { clips: ['WoW_act_wave'] },
        laugh: { clips: ['WoW_act_laugh'] },
        flex: { clips: ['WoW_act_muscle'] },
        bow: { clips: ['WoW_act_bow'] },
      },
    });
    expect(def.clips.sitIdle).toBe('Sit_Idle');
    expect(def.clips.sitDown).toBe('Sit_Down');
    expect(['Cast_Loop', 'Ranged_Shoot#aim', 'Cast_Raise']).toContain(def.clips.cast);
    expect(def.clips.contacts['1H_Chop']).toBeDefined();
    expect(def.clips.attack.some((clip) => clip.startsWith('WoW_'))).toBe(false);
  }
});
