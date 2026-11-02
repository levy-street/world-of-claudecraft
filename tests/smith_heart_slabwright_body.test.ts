// The Slabwright's own body (scripts/assets/specs/heart_slabwright.json): the Council member draws
// its shipped GLB in place of the provisional pieces, every clip its ClipMap names ships, each of
// its four casts has its own clip that outlasts the bar, its blows land inside the longest contact
// hold, and the file ships small: a 1024 ETC1S atlas and only the tracks that move.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { dungeonCharacterBodyUrls } from '../src/render/characters/rift_body_stream_core';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import {
  COUNCIL_BODY_HEIGHTS,
  COUNCIL_MODELLED,
  councilBodyKindOf,
} from '../src/render/smith_heart_fx/council_bodies_core';
import { MOBS } from '../src/sim/data';
import { COUNCIL_CASTS, COUNCIL_TUNING } from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity } from '../src/sim/types';

const MOB = 'heart_slabwright';
const URL = 'models/creatures/heart_slabwright.glb';

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  images: { mimeType: string; bufferView: number }[];
  bufferViews: { byteOffset?: number }[];
  meshes: { primitives: { indices: number }[] }[];
  skins: { joints: number[] }[];
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

describe('the Slabwright body', () => {
  it('draws its own painted GLB in place of the provisional pieces', () => {
    expect(def.url).toBe(URL);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    expect(def.tint).toBeUndefined();
    const kind = councilBodyKindOf(MOB);
    if (!kind) throw new Error('no council kind');
    expect(COUNCIL_MODELLED.has(kind)).toBe(true);
    // The Singer has no model yet, so its provisional body still draws.
    expect(COUNCIL_MODELLED.has('singer')).toBe(false);
    expect(VISUALS.smith_heart_seam_singer.bodyless).toBe(true);
  });

  it('stands at the height the shell and the dust are sized to', () => {
    expect(def.height * MOBS[MOB].scale).toBeCloseTo(COUNCIL_BODY_HEIGHTS.slabwright);
  });

  it('ships every clip its ClipMap names', () => {
    const { clips } = def;
    const named = [
      clips.idle,
      ...(clips.idleVariants ?? []),
      clips.combatIdle,
      clips.turn,
      clips.walk,
      clips.run,
      ...clips.attack,
      clips.cast,
      ...Object.values(clips.castByAbility ?? {}),
      ...(clips.hit ?? []),
      clips.death,
      clips.flourish,
    ].filter((c): c is string => typeof c === 'string');
    for (const clip of named) expect(shipped.has(clip), clip).toBe(true);
    expect(shipped.size).toBe(16);
  });

  it('gives each of its casts its own clip, longer than the bar, finishing after it', () => {
    const by = def.clips.castByAbility ?? {};
    const bars: [string, string, number][] = [
      [COUNCIL_CASTS.wake, 'CastWake', COUNCIL_TUNING.wakeCast],
      [COUNCIL_CASTS.rock, 'CastRock', COUNCIL_TUNING.rockCast],
      [COUNCIL_CASTS.prison, 'CastPrison', COUNCIL_TUNING.prisonCast],
      [COUNCIL_CASTS.wrath, 'CastWrath', COUNCIL_TUNING.heirWrathCast],
    ];
    for (const [id, clip, bar] of bars) {
      expect(by[id], id).toBe(clip);
      expect(shipped.get(clip) ?? 0, clip).toBeGreaterThan(bar);
      expect(def.clips.castPlayOut, clip).toContain(clip);
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

  it('runs at 1x at the speed its template chases', () => {
    expect(def.runRef).toBe(MOBS[MOB].moveSpeed);
  });

  it('came through the compression steps and streams with the raid', () => {
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
    );
    expect(json.images.map((i) => i.mimeType)).toEqual(['image/ktx2']);
    // A 1024 atlas (the KTX2 header's width and height) in ETC1S, the repo's size codec: its
    // supercompression word is BasisLZ, 1, where UASTC's is zstd, 2.
    const binStart = 20 + file.readUInt32LE(12) + 8;
    const ktx = binStart + (json.bufferViews[json.images[0].bufferView].byteOffset ?? 0);
    expect(file.readUInt32LE(ktx + 20)).toBe(1024);
    expect(file.readUInt32LE(ktx + 24)).toBe(1024);
    expect(file.readUInt32LE(ktx + 44)).toBe(1);
    expect(json.accessors[json.meshes[0].primitives[0].indices].count / 3).toBe(4980);
    expect(json.skins[0].joints.length).toBe(43);
    expect(file.length).toBeLessThanOrEqual(900 * 1024);
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(URL);
  });
});
