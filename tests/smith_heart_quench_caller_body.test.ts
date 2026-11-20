// The Quench Vein Caller's own body (scripts/assets/specs/heart_quench_caller.json): the Quench's
// caster draws its shipped GLB in place of the borrowed water elemental, every clip its ClipMap names
// ships, Rime Bolt has a clip that is locked to its bar and plays out past it (the orbs flung at the
// bar's end, gone into the bolt, grown back over the palms), its light blows land inside the longest
// contact hold, it floats at its template's speed, the ice is one welded skin of rigid plates, and
// the file ships small.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { dungeonCharacterBodyUrls } from '../src/render/characters/rift_body_stream_core';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { weldedSkinReport } from './helpers/welded_skin';

const MOB = 'heart_quench_caller';
const URL = 'models/creatures/heart_quench_caller.glb';
const RIME_BOLT = 'heart_rime_bolt';

interface GltfJson {
  animations: {
    name: string;
    samplers: { input: number }[];
    channels: { target: { path: string } }[];
  }[];
  accessors: { count: number; max?: number[] }[];
  bufferViews: { byteOffset?: number }[];
  images: { mimeType: string; bufferView: number }[];
  materials: { emissiveTexture?: { index: number } }[];
  meshes: { primitives: { indices: number }[] }[];
  extensionsUsed: string[];
}

const file = readFileSync(`public/${URL}`);
const json = glbJsonChunk(file) as GltfJson;
const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: MOB } as Entity)];
const shipped = new Map(
  json.animations.map((a) => [
    a.name,
    Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)),
  ]),
);

describe('the Quench Vein Caller body', () => {
  it('draws its own painted GLB, never the borrowed water elemental', () => {
    expect(def.url).toBe(URL);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    expect(def.tint).toBeUndefined();
  });

  it('towers over a player (drawn big, the template untouched)', () => {
    // The owner's call: these must read far larger than the player body (player_warrior's drawn
    // height). The size is the drawn height alone; the template's scale (reach, spacing) stays.
    const drawn = def.height * MOBS[MOB].scale;
    expect(drawn).toBeGreaterThanOrEqual(1.6 * VISUALS.player_warrior.height);
  });

  it('ships every clip its ClipMap names', () => {
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
      clips.cast,
      ...Object.values(clips.castByAbility ?? {}),
      ...(clips.hit ?? []),
      clips.death,
    ].filter((c): c is string => typeof c === 'string');
    for (const clip of named) expect(shipped.has(clip), clip).toBe(true);
    expect(new Set(named).size).toBe(13);
  });

  it('casts Rime Bolt through its own clip, locked to the bar and playing out past it', () => {
    const bolt = MOBS[MOB].trashKit?.bolt;
    expect(bolt?.castId).toBe(RIME_BOLT);
    // CastBolt flings the orbs at 2.0 s at 1x (tmp clips: BOLT_RELEASE): the bar's end.
    expect(bolt?.castTime).toBe(2);
    expect(def.clips.castByAbility?.[RIME_BOLT]).toBe('CastBolt');
    expect(def.castClipSync).toContain(RIME_BOLT);
    expect(def.clips.castPlayOut).toContain('CastBolt');
    expect(shipped.get('CastBolt') ?? 0).toBeGreaterThan((bolt?.castTime ?? 0) + 0.5);
  });

  it('flings its orbs and grows them back: only the cast scales anything', () => {
    for (const a of json.animations) {
      const scales = a.channels.filter((c) => c.target.path === 'scale').length;
      expect(scales, a.name).toBe(a.name === 'CastBolt' ? 2 : 0);
    }
  });

  it('lands every blow inside the longest contact hold, at rate 1, inside its swing', () => {
    expect(def.attackTimeScale).toBe(1);
    expect(def.deathTimeScale).toBe(1);
    expect(def.clips.attack).toEqual(['Attack', 'Attack2']);
    for (const clip of def.clips.attack) {
      const contact = def.clips.contacts?.[clip]?.[0] ?? 0;
      expect(contact, clip).toBeGreaterThan(0);
      expect(contact, clip).toBeLessThanOrEqual(CONTACT_HOLD_MAX_SEC);
      expect(shipped.get(clip) ?? 0, clip).toBeGreaterThan(contact + 0.5);
      expect(shipped.get(clip) ?? 0, clip).toBeLessThanOrEqual(MOBS[MOB].attackSpeed);
    }
  });

  it('floats at 1x at the speed its template chases', () => {
    expect(def.runRef).toBe(MOBS[MOB].moveSpeed);
  });

  it('ships its glow map, and its light goes out as it dies', () => {
    expect(json.materials[0].emissiveTexture).toBeDefined();
    expect(def.glowPulses?.deathFade).toBeGreaterThan(0);
  });

  it('is one welded skin: no seam can open into a see-through gap, the plates stay rigid', async () => {
    // The owner's call: never split the model (a seam cut between two bones' plates opened into a
    // gap you could see through as it fought): every copy of one point carries one joint mix.
    const skin = await weldedSkinReport(`public/${URL}`);
    expect(skin.count).toBeGreaterThan(1000);
    expect(skin.parted).toBe(0);
    // Rigid plates: all but the seam vertices ride one bone at full weight.
    expect(skin.singleShare).toBeGreaterThan(0.8);
  });

  it('came through the compression steps and streams with the raid', () => {
    expect(file.length).toBeLessThanOrEqual(600 * 1024);
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
    );
    expect(json.accessors[json.meshes[0].primitives[0].indices].count / 3).toBe(5551);
    expect(json.images.map((i) => i.mimeType)).toEqual(['image/ktx2', 'image/ktx2']);
    const binStart = 20 + file.readUInt32LE(12) + 8;
    for (const image of json.images) {
      const ktx = binStart + (json.bufferViews[image.bufferView].byteOffset ?? 0);
      expect(file.readUInt32LE(ktx + 20)).toBe(1024);
      expect(file.readUInt32LE(ktx + 24)).toBe(1024);
      expect(file.readUInt32LE(ktx + 44)).toBe(1);
    }
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(URL);
  });
});
