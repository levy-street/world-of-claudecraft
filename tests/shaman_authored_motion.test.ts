import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Animation, type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Object3D, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { ABILITIES } from '../src/sim/data';

const PATH = 'public/models/chars/players/shaman_polish_anims.glb';
const ACTIVE = [
  'lightning_bolt',
  'chain_lightning',
  'earth_shock',
  'flame_shock',
  'frost_shock',
  'stormstrike',
  'healing_wave',
  'chain_heal',
  'tidecall',
  'stoneward',
  'lightning_shield',
  'rockbiter_weapon',
  'flametongue_weapon',
  'galeheart_weapon',
  'lifespring_weapon',
  'earthbind',
  'earthquake',
  'elemental_mastery',
  'primal_exaltation',
  'bloodlust',
  'elemental_trance',
  'ghost_wolf',
  'ancestor_return',
  'unleash_weapon',
] as const;
const CHARGED = [
  'lightning_bolt',
  'chain_lightning',
  'healing_wave',
  'chain_heal',
  'ghost_wolf',
  'ancestor_return',
];
let donor: Document;
let source: Document;
let clips: Map<string, Animation>;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  [donor, source] = await Promise.all([
    io.read(resolve(PATH)),
    io.read(resolve('public/models/chars/players/barbarian.glb')),
  ]);
  clips = new Map(
    donor
      .getRoot()
      .listAnimations()
      .map((a) => [a.getName(), a]),
  );
});

function sample(clip: Animation, time: number): Map<string, number[]> {
  return new Map(
    clip.listChannels().map((channel) => {
      const sampler = channel.getSampler()!;
      const times = sampler.getInput()!.getArray()!;
      const values = sampler.getOutput()!.getArray()!;
      const path = channel.getTargetPath();
      const size = path === 'rotation' ? 4 : 3;
      let hi = 0;
      while (hi < times.length - 1 && times[hi] < time) hi++;
      const lo = Math.max(0, hi - 1);
      const weight =
        hi === lo ? 0 : Math.max(0, Math.min(1, (time - times[lo]) / (times[hi] - times[lo])));
      const a = Array.from(values.slice(lo * size, (lo + 1) * size));
      const b = Array.from(values.slice(hi * size, (hi + 1) * size));
      const value =
        path === 'rotation'
          ? new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), weight).toArray()
          : a.map((v, i) => v + (b[i] - v) * weight);
      return [`${channel.getTargetNode()!.getName()}|${path}`, value];
    }),
  );
}

function duration(clip: Animation): number {
  return Math.max(...clip.listSamplers().map((s) => s.getInput()!.getMax([])[0]));
}

function makeRig() {
  const objects = new Map<string, Object3D>();
  for (const node of source.getRoot().listNodes()) {
    const object = new Object3D();
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    objects.set(node.getName(), object);
  }
  for (const node of source.getRoot().listNodes()) {
    for (const child of node.listChildren())
      objects.get(node.getName())!.add(objects.get(child.getName())!);
  }
  return {
    objects,
    apply(pose: Map<string, number[]>) {
      for (const [key, value] of pose) {
        const [bone, path] = key.split('|');
        const object = objects.get(bone)!;
        if (path === 'rotation') object.quaternion.fromArray(value);
        if (path === 'translation') object.position.fromArray(value);
        if (path === 'scale') object.scale.fromArray(value);
      }
      for (const object of objects.values()) if (!object.parent) object.updateMatrixWorld(true);
    },
  };
}

describe('Shaman authored motion', () => {
  it('ships 25 release gestures and six independent charge loops without meshes or skins', () => {
    expect(clips.size).toBe(31);
    expect(donor.getRoot().listMeshes()).toHaveLength(0);
    expect(donor.getRoot().listSkins()).toHaveLength(0);
    const def = VISUALS.player_shaman;
    expect(def.animUrls).toContain('models/chars/players/shaman_polish_anims.glb');
    for (const id of [...ACTIVE, 'healing_stream']) {
      expect(ABILITIES[id]?.class).toBe('shaman');
      const name = def.clips.attackByAbility![id];
      expect(name).toMatch(/^Shaman_/);
      expect(clips.has(name), id).toBe(true);
      expect(def.clips.attackTimeScaleByAbility![id]).toBe(1);
    }
    expect(new Set(ACTIVE.map((id) => def.clips.attackByAbility![id])).size).toBe(24);
    expect(def.clips.attackByAbility!.frostbrand_weapon).toBe('Spellcast_Raise');
    expect(Object.keys(def.clips.castByAbility!).sort()).toEqual([...CHARGED].sort());
    for (const id of CHARGED) {
      const name = def.clips.castByAbility![id];
      expect(clips.has(name)).toBe(true);
      expect(name).toBe(`${def.clips.attackByAbility![id]}_Charge`);
      expect(def.clips.castTimeScaleByAbility![id]).toBe(1);
    }
  });

  it('binds finite normalized transforms to existing bones and keeps weapon sockets intact', () => {
    const idle = sample(
      source
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === 'Idle')!,
      0.3,
    );
    const bones = new Set(
      source
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const clip of clips.values())
      for (const channel of clip.listChannels()) {
        const bone = channel.getTargetNode()!.getName();
        expect(bones.has(bone), `${clip.getName()}: ${bone}`).toBe(true);
        const path = channel.getTargetPath();
        const values = channel.getSampler()!.getOutput()!.getArray()!;
        const size = path === 'rotation' ? 4 : 3;
        for (let i = 0; i < values.length; i += size) {
          const value = Array.from(values.slice(i, i + size));
          expect(value.every(Number.isFinite)).toBe(true);
          if (path === 'rotation') expect(Math.hypot(...value)).toBeCloseTo(1, 5);
          if (bone.startsWith('handslot') || path === 'scale') {
            const baseline = idle.get(`${bone}|${path}`)!;
            for (let n = 0; n < size; n++) expect(value[n]).toBeCloseTo(baseline[n], 5);
          }
        }
      }
  });

  it.each(ACTIVE)('%s has real anticipation, contact hold and recovery within one GCD', (id) => {
    const clip = clips.get(VISUALS.player_shaman.clips.attackByAbility![id])!;
    expect(duration(clip)).toBeLessThanOrEqual(1.5);
    const load = sample(clip, 0.06);
    const heldLoad = sample(clip, 0.09);
    const impact = sample(clip, 0.15);
    const heldImpact = sample(clip, 0.17);
    const recovered = sample(clip, duration(clip));
    const idle = sample(
      source
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === 'Idle')!,
      0.3,
    );
    const angle = (a: Map<string, number[]>, b: Map<string, number[]>, bone: string) =>
      new Quaternion()
        .fromArray(a.get(`${bone}|rotation`)!)
        .angleTo(new Quaternion().fromArray(b.get(`${bone}|rotation`)!));
    expect(angle(load, heldLoad, 'chest')).toBeLessThan(0.001);
    expect(angle(impact, heldImpact, 'chest')).toBeLessThan(0.001);
    expect(
      Math.max(angle(load, impact, 'chest'), angle(load, impact, 'upperarm.r')),
    ).toBeGreaterThan(0.08);
    expect(angle(recovered, idle, 'chest')).toBeLessThan(0.001);
    expect(angle(recovered, idle, 'upperarm.r')).toBeLessThan(0.001);
  });

  it('keeps both feet planted throughout every release and charge, including between baked frames', () => {
    const rig = makeRig();
    const idle = sample(
      source
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === 'Idle')!,
      0.3,
    );
    rig.apply(idle);
    const names = ['foot.l', 'foot.r'];
    const anchors = names.map((name) => rig.objects.get(name)!.getWorldPosition(new Vector3()));
    let maxError = 0;
    for (const clip of clips.values()) {
      for (let t = 0; t <= duration(clip); t += 1 / 120) {
        rig.apply(sample(clip, t));
        for (let i = 0; i < names.length; i++) {
          const error = rig.objects
            .get(names[i])!
            .getWorldPosition(new Vector3())
            .distanceTo(anchors[i]);
          maxError = Math.max(maxError, error);
          expect(error, `${clip.getName()} t=${t.toFixed(3)} ${names[i]}`).toBeLessThan(0.012);
        }
      }
    }
    expect(maxError).toBeLessThan(0.012);
  });

  it('charge loops breathe gently, close exactly and never play a release', () => {
    for (const id of CHARGED) {
      const clip = clips.get(VISUALS.player_shaman.clips.castByAbility![id])!;
      const start = sample(clip, 0);
      const end = sample(clip, duration(clip));
      const middle = sample(clip, duration(clip) * 0.25);
      for (const [key, value] of start) {
        for (let i = 0; i < value.length; i++) expect(end.get(key)![i]).toBeCloseTo(value[i], 5);
      }
      const q = (pose: Map<string, number[]>) =>
        new Quaternion().fromArray(pose.get('chest|rotation')!);
      expect(q(start).angleTo(q(middle))).toBeGreaterThan(0.015);
      expect(q(start).angleTo(q(middle))).toBeLessThan(0.06);
    }
  });

  it('does not add the donor to any unrelated fixed class', () => {
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!key.startsWith('player_') || key.includes('shaman')) continue;
      expect(
        def.animUrls?.some((url) => url.endsWith('shaman_polish_anims.glb')) ?? false,
        key,
      ).toBe(false);
    }
    // Retain the original five-donor payload and its rigorous legacy test.
    const bytes = readFileSync(resolve('public/models/chars/players/shaman_ability_anims.glb'));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.animations.map((a: { name: string }) => a.name).sort()).toEqual([
      'Cast_Bolt',
      'Cast_Heal',
      'Cast_Quake',
      'Cast_Shock',
      'Storm_Strike',
    ]);
  });
});
