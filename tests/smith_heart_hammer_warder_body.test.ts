// The Hammer Vein Warder's own body (scripts/assets/specs/heart_hammer_warder.json, the first row
// of smith_heart_placeholder_looks.ts replaced by a model of the raid's own): the mob draws its
// shipped GLB, every clip its ClipMap names ships in that GLB, each blow lands inside the longest
// hold a contact gets, and the file came through the compression steps (meshopt plus a 1024 KTX2
// ETC1S atlas) at its budget.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  type AnimState,
  desiredBaseState,
  locomotionTimeScale,
} from '../src/render/characters/anim_state';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  characterStreamPlan,
  dungeonCharacterBodyUrls,
} from '../src/render/characters/rift_body_stream_core';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import { newLocoState, newLocoTrack, updateLocomotionInto } from '../src/render/locomotion';
import { MOBS } from '../src/sim/data';
import { DT, type Entity } from '../src/sim/types';

const MOB = 'heart_hammer_warder';
const URL = 'models/creatures/heart_hammer_warder.glb';

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  images: { mimeType: string; bufferView: number }[];
  meshes: { primitives: { indices: number }[] }[];
  extensionsUsed: string[];
}

const file = readFileSync(`public/${URL}`);
const json = glbJsonChunk(file) as GltfJson;
const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: MOB } as Entity)];

function clipLengths(): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of json.animations) {
    out.set(a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)));
  }
  return out;
}

describe('the Hammer Vein Warder body', () => {
  it('draws its own painted GLB, never the borrowed elemental', () => {
    expect(def.url).toBe(URL);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    // The painted atlas carries its own colour: no entity tint washing it toward the template's.
    expect(def.tint).toBeUndefined();
  });

  it('ships every clip its ClipMap names', () => {
    const shipped = clipLengths();
    const { clips } = def;
    const named = [
      clips.idle,
      ...(clips.idleVariants ?? []),
      clips.combatIdle,
      clips.stunned,
      clips.turn,
      clips.walk,
      clips.run,
      ...clips.attack,
      ...Object.values(clips.attackByAbility ?? {}),
      ...(clips.hit ?? []),
      clips.death,
      clips.flourish,
    ].filter((c): c is string => typeof c === 'string');
    expect(named.length).toBe(14);
    for (const clip of named) expect(shipped.has(clip), clip).toBe(true);
  });

  it('lands every blow inside the longest contact hold, at rate 1, with a recovery after it', () => {
    const shipped = clipLengths();
    // The default attack rate would run these heavy clips 1.3 times too fast and move every contact.
    expect(def.attackTimeScale).toBe(1);
    const blows = [...def.clips.attack, def.clips.attackByAbility?.brood_cleave ?? ''];
    expect(blows).toEqual(['Attack', 'Attack2', 'Cleave']);
    for (const clip of blows) {
      const contact = def.clips.contacts?.[clip]?.[0] ?? 0;
      expect(contact, clip).toBeGreaterThan(0);
      expect(contact, clip).toBeLessThanOrEqual(CONTACT_HOLD_MAX_SEC);
      expect(shipped.get(clip) ?? 0, clip).toBeGreaterThan(contact + 0.5);
    }
  });

  it('falls at its authored rate', () => {
    // The default death rate would hurry the kneel and the topple.
    expect(def.deathTimeScale).toBe(1);
  });

  it('times its gait at the size the template draws it', () => {
    // The clips' planted-foot speeds in rig units/s on the 2.2 tall rig (scripts/anim/
    // measure_gait.mjs). A resized body covers more ground per stride, so it owes new refs.
    const size = (def.height / 2.2) * MOBS[MOB].scale;
    expect(def.walkRef).toBeCloseTo(0.672 * size, 1);
    expect(def.runRef).toBeCloseTo(1.542 * size, 1);
  });

  it('chases on its run clip with its feet on the floor', () => {
    const speed = MOBS[MOB].moveSpeed;
    const track = newLocoTrack();
    const loco = newLocoState();
    // What the renderer reads off a body chasing at its sim speed, until the cadence settles.
    for (let i = 0; i < 60; i++) updateLocomotionInto(loco, track, 0, speed * DT, 0, DT, def.gait);
    const state: AnimState = {
      ...loco,
      airborne: false,
      dead: false,
      casting: false,
      swimming: false,
      submerged: false,
      swimPitch: 0,
      wading: false,
      sitting: false,
    };
    const base = desiredBaseState(state, false);
    expect(base).toBe('run');
    const rate =
      locomotionTimeScale(
        base,
        state,
        def.walkRef,
        def.runRef,
        undefined,
        undefined,
        undefined,
        def.walkTimeScaleMax,
        def.runTimeScaleMax,
      ) ?? 0;
    // Run covers runRef yd/s at 1x and the rate is capped: past the cap the feet slide.
    expect(Math.abs(rate * (def.runRef ?? 0) - speed)).toBeLessThan(0.1);
  });

  it('answers the template cleave with its own sweep', () => {
    expect(MOBS[MOB].arcCleave?.name).toBe('Stone Sweep');
    expect(def.clips.attackByAbility?.brood_cleave).toBe('Cleave');
  });

  it('loads on arrival at the raid on a phone, never in the entry stream', () => {
    const plan = characterStreamPlan([URL], new Set<string>(), true);
    expect(plan.onDemand).toEqual([URL]);
    expect(plan.postEntry).toEqual([]);
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(URL);
  });

  it('came through the compression steps at its budget', () => {
    expect(file.length).toBeLessThanOrEqual(600 * 1024);
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
    );
    const triangles = json.accessors[json.meshes[0].primitives[0].indices].count / 3;
    expect(triangles).toBe(5000);
    // One atlas, KTX2, 1024 square (the header's pixelWidth and pixelHeight words).
    expect(json.images.map((i) => i.mimeType)).toEqual(['image/ktx2']);
    const binStart = 20 + file.readUInt32LE(12) + 8;
    const view = json.bufferViews[json.images[0].bufferView];
    const ktx = binStart + (view.byteOffset ?? 0);
    expect(file.readUInt32LE(ktx + 20)).toBe(1024);
    expect(file.readUInt32LE(ktx + 24)).toBe(1024);
    // ETC1S, the repo's size codec: its supercompression word is BasisLZ, 1, where UASTC's is zstd, 2.
    expect(file.readUInt32LE(ktx + 44)).toBe(1);
  });
});
