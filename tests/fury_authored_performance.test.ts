import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { furyBeat } from '../src/render/ability_vfx/fury_choreography';
import { buildFuryCutShape } from '../src/render/ability_vfx/fury_shapes';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  createMultiStrikeClip,
  prepareSignatureClips,
} from '../src/render/characters/signature_clips';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

describe('Fury authored performance', () => {
  it('retains native tracks and neutral recovery while alternating torso and arm commitments', () => {
    const source = new THREE.AnimationClip('Dualwield_Melee_Attack_Chop', 1, [
      ...['chest', 'upperarmr', 'upperarml', 'legl', 'legr'].map(
        (bone) =>
          new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      ),
      new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 0, 1]),
    ]);
    for (const id of ['raging_gale', 'red_harvest']) {
      const clip = createMultiStrikeClip(source, id);
      expect(clip.duration).toBeLessThan(0.75);
      expect(clip.tracks.map((t) => t.name)).toEqual(source.tracks.map((t) => t.name));
      const chest = clip.tracks[0];
      const first = new THREE.Quaternion().fromArray(chest.values, 2 * 4);
      const second = new THREE.Quaternion().fromArray(chest.values, 4 * 4);
      expect(first.angleTo(second)).toBeGreaterThan(0.65);
      for (const t of clip.tracks.filter((t) => t.name.endsWith('.quaternion'))) {
        for (let i = 0; i < t.values.length; i += 4)
          expect(Math.hypot(...t.values.slice(i, i + 4))).toBeCloseTo(1);
        expect(Array.from(t.values.slice(-4))).toEqual([0, 0, 0, 1]);
      }
      expect(Array.from(clip.tracks[3].values).every((v, i) => v === (i % 4 === 3 ? 1 : 0))).toBe(
        true,
      );
      expect(Array.from(clip.tracks[5].values).every((v) => v === 0)).toBe(true);
    }
    expect(source.tracks[0].values).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]));
  });

  it('builds a broad open material sheet with irregular exits and finite indexed geometry', () => {
    const geometry = buildFuryCutShape();
    const position = geometry.getAttribute('position');
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(geometry.index!.array))).toBeLessThan(position.count);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(3.5);
    expect(size.y).toBeGreaterThan(1.1);
    expect(size.z).toBeGreaterThan(0.1);
    geometry.dispose();
  });

  it('tracks moved recipient anatomy, preserves the reduced-detail core and gives the finisher a larger climax', () => {
    let targetX = 3;
    const crest = vi.fn(),
      contact = vi.fn();
    const host = {
      anchorOf: (id: number, fraction: number, out: THREE.Vector3) =>
        Object.assign(out, {
          x: id === 1 ? 0 : targetX,
          y: fraction * (id === 1 ? 2 : 3),
          z: id === 1 ? 0 : 4,
        }),
      crestAt: crest,
      contact,
      pathRibbon: vi.fn(),
      flipbookAt: vi.fn(),
      burstAt: vi.fn(),
      fragmentsAt: vi.fn(),
      pulseLight: vi.fn(),
      groundYAt: () => 0,
      shakeAt: vi.fn(),
      countPrimitive: vi.fn(),
    } as unknown as SequencerHost;
    const slot = {
      abilityId: 'red_harvest',
      casterId: 1,
      targetId: 2,
      tier: 0,
      spec: WARRIOR_VFX_FULL_SPECS.red_harvest,
      color: 0xa93232,
      accent: 0xffd0ac,
    } as SeqSlot;
    furyBeat(host, slot, 0);
    expect(crest.mock.calls[0][0]).toBeCloseTo(3 - (3 / 5) * 0.65);
    expect(crest.mock.calls[0][1]).toBeCloseTo(3 * 0.51 + 0.08);
    const firstWidth = crest.mock.calls[0][3];
    const core = vi.mocked(host.pathRibbon).mock.calls[0];
    targetX = 8;
    furyBeat(host, slot, 2);
    expect(crest.mock.calls[1][0]).toBeCloseTo(8 - (8 / Math.hypot(8, 4)) * 0.65);
    expect(crest.mock.calls[1][3]).toBeGreaterThan(firstWidth * 1.3);
    expect(crest.mock.calls).toHaveLength(3);
    expect(crest.mock.calls[1][10]).toBeCloseTo(-crest.mock.calls[2][10]);
    expect(crest.mock.calls[1][3]).toBe(crest.mock.calls[2][3]);
    expect(contact).toHaveBeenCalledTimes(2);
    vi.mocked(host.pathRibbon).mockClear();
    slot.tier = 1;
    furyBeat(host, slot, 0);
    const reducedCore = vi.mocked(host.pathRibbon).mock.calls[0];
    expect(reducedCore.slice(0, 3)).toEqual(core.slice(0, 3));
    expect(crest.mock.calls.at(-1)![9]).toBe(0.23);
  });
});

it('loads the delivered native Fury clips with finite normalized joints and preserves their authored contact timing', async () => {
  const bytes = readFileSync('public/models/chars/players/warrior_fury_anims.glb');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  const overrides = { raging_gale: 'Fury_Twinstrike', red_harvest: 'Fury_Red_Harvest' };
  prepareSignatureClips(clips, overrides);
  for (const [id, name] of Object.entries(overrides)) {
    const source = clips.get(name)!;
    const prepared = clips.get(`Signature_${id}`)!;
    expect(source).toBeDefined();
    expect(source.duration).toBeLessThan(0.75);
    expect(prepared.duration).toBe(source.duration);
    expect(prepared.tracks.length).toBeGreaterThan(40);
    for (let i = 0; i < prepared.tracks.length; i++) {
      const track = prepared.tracks[i];
      expect(Array.from(track.times)).toEqual(Array.from(source.tracks[i].times));
      expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
      if (track.name.endsWith('.quaternion')) {
        for (let k = 0; k < track.values.length; k += 4)
          expect(Math.hypot(...track.values.slice(k, k + 4))).toBeCloseTo(1, 4);
      }
      if (track.name === 'root.position') {
        for (let k = 3; k < track.values.length; k++)
          expect(track.values[k]).toBe(track.values[k % 3]);
      }
    }
  }
});
