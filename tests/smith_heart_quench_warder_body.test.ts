// The Quench Vein Warder's own body (scripts/assets/specs/heart_quench_warder.json): the Quench's melee
// trash draws its shipped GLB in place of the borrowed elemental, every clip its ClipMap names ships,
// each blow lands inside the longest contact hold, its chase plays the skate at a rate the gait allows,
// the ice is one welded skin of rigid plates (no seam can open; only seam vertices share bones), its
// glow map ships
// and goes out as it dies, and the file came through the compression steps at its budget.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  type AnimState,
  DEFAULT_RUN_TIME_SCALE_MAX,
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
import { weldedSkinReport } from './helpers/welded_skin';

const MOB = 'heart_quench_warder';
const URL = 'models/creatures/heart_quench_warder.glb';

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  images: { mimeType: string; bufferView: number }[];
  materials: {
    emissiveTexture?: { index: number };
    pbrMetallicRoughness: { baseColorTexture?: { index: number } };
  }[];
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

describe('the Quench Vein Warder body', () => {
  it('draws its own painted GLB, never the borrowed elemental', () => {
    expect(def.url).toBe(URL);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    // The painted atlas carries its own colour: no entity tint washing the ice toward the template's.
    expect(def.tint).toBeUndefined();
  });

  it('towers over a player (drawn big, the template untouched)', () => {
    // The owner's call: these must read far larger than the player body (player_warrior's drawn
    // height). The size is the drawn height alone; the template's scale (reach, spacing) stays.
    const drawn = def.height * MOBS[MOB].scale;
    expect(drawn).toBeGreaterThanOrEqual(2.2 * VISUALS.player_warrior.height);
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
    ].filter((c): c is string => typeof c === 'string');
    expect(named.length).toBe(13);
    for (const clip of named) expect(shipped.has(clip), clip).toBe(true);
    // Not dormant like the Hammer's warder: no sleep loop and no wake.
    expect(clips.sleep).toBeUndefined();
    expect(clips.wake).toBeUndefined();
  });

  it('lands every blow inside the longest contact hold, at rate 1, with a recovery after it', () => {
    const shipped = clipLengths();
    expect(def.attackTimeScale).toBe(1);
    expect(def.deathTimeScale).toBe(1);
    const blows = [...def.clips.attack, def.clips.attackByAbility?.brood_cleave ?? ''];
    expect(blows).toEqual(['Attack', 'Attack2', 'Cleave']);
    for (const clip of blows) {
      const contact = def.clips.contacts?.[clip]?.[0] ?? 0;
      expect(contact, clip).toBeGreaterThan(0);
      expect(contact, clip).toBeLessThanOrEqual(CONTACT_HOLD_MAX_SEC);
      expect(shipped.get(clip) ?? 0, clip).toBeGreaterThan(contact + 0.5);
    }
  });

  it('answers the template cleave with its own sweep, its cracks flaring as it lands', () => {
    expect(MOBS[MOB].arcCleave?.name).toBe('Rime Sweep');
    expect(def.clips.attackByAbility?.brood_cleave).toBe('Cleave');
    const pulse = def.glowPulses?.pulses.find((p) => p.gesture === 'brood_cleave');
    expect(pulse).toBeDefined();
    // The flare peaks round the sweep's 1.0 s contact.
    const contact = def.clips.contacts?.Cleave?.[0] ?? 0;
    const peakAt = (pulse?.delay ?? 0) + (pulse?.rise ?? 0);
    expect(Math.abs(peakAt - contact)).toBeLessThan(0.1);
  });

  it('times its walk at the size the template draws it', () => {
    // Walk's planted-foot speed in rig units/s on the 2.2 tall rig, carried to the template's size.
    const size = (def.height / 2.2) * MOBS[MOB].scale;
    expect(def.walkRef).toBeCloseTo(0.672 * size, 1);
  });

  it('skates its chase at the template speed, inside the gait cap', () => {
    // Looks only: the template keeps its chase speed, and the Run clip is a skate whose gliding foot
    // slides by design, so it only has to play at a rate the gait allows.
    const speed = MOBS[MOB].moveSpeed;
    expect(speed).toBe(7.2);
    const track = newLocoTrack();
    const loco = newLocoState();
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
    expect(rate).toBeLessThanOrEqual(def.runTimeScaleMax ?? DEFAULT_RUN_TIME_SCALE_MAX);
    expect(Math.abs(rate * (def.runRef ?? 0) - speed)).toBeLessThan(0.1);
  });

  it('ships its glow map, and its light goes out as it dies', () => {
    const mat = json.materials[0];
    expect(mat.emissiveTexture).toBeDefined();
    expect(mat.emissiveTexture?.index).not.toBe(mat.pbrMetallicRoughness.baseColorTexture?.index);
    expect(def.glowPulses?.deathFade).toBeGreaterThan(0);
  });

  it('is one welded skin: no seam can open into a see-through gap, the plates stay rigid', async () => {
    // The owner's call: never split the model (a seam cut between two bones' plates opened into a
    // gap you could see through as it fought): every copy of one point carries one joint mix.
    const skin = await weldedSkinReport(`public/${URL}`);
    expect(skin.count).toBeGreaterThan(1000);
    expect(skin.parted).toBe(0);
    // Rigid plates: all but the seam vertices ride one bone at full weight (its plates are small, so
    // about a quarter of its vertices sit on a seam).
    expect(skin.singleShare).toBeGreaterThan(0.7);
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
    expect(triangles).toBe(5624);
    // Two maps, the albedo and the glow, each a 1024 KTX2 in ETC1S (supercompression word BasisLZ, 1).
    expect(json.images.map((i) => i.mimeType)).toEqual(['image/ktx2', 'image/ktx2']);
    const binStart = 20 + file.readUInt32LE(12) + 8;
    for (const image of json.images) {
      const ktx = binStart + (json.bufferViews[image.bufferView].byteOffset ?? 0);
      expect(file.readUInt32LE(ktx + 20)).toBe(1024);
      expect(file.readUInt32LE(ktx + 24)).toBe(1024);
      expect(file.readUInt32LE(ktx + 44)).toBe(1);
    }
  });
});
