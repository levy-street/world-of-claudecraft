// The Slabwright's own body (scripts/assets/specs/heart_slabwright.json). The Slabwright left the
// Hammer Council when the raid made it two bosses, so no template draws it now; the model is kept
// for reuse and pinned as an asset: every clip its ClipMap names ships, each of its casts has its
// own clip that plays out, its blows land inside the longest contact hold, and the file ships
// small: a 1024 ETC1S atlas and only the tracks that move.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import { councilBodyKindOf } from '../src/render/smith_heart_fx/council_bodies_core';
import { MOBS } from '../src/sim/data';

const URL = 'models/creatures/heart_slabwright.glb';
/** The swing it was built for (the old template's attack speed). */
const SWING_SEC = 2.8;

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
const def = VISUALS.smith_heart_slabwright;

const shipped = new Map(
  json.animations.map((a) => [
    a.name,
    Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)),
  ]),
);

describe('the Slabwright body', () => {
  it('is its own painted GLB, kept while no template draws it', () => {
    expect(def.url).toBe(URL);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    expect(def.tint).toBeUndefined();
    // The two-boss council: no Slabwright template, and no provisional body for one.
    expect(MOBS.heart_slabwright).toBeUndefined();
    expect(councilBodyKindOf('heart_slabwright')).toBeNull();
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

  it('gives each of its casts its own clip, played out past the bar', () => {
    const casts = Object.values(def.clips.castByAbility ?? {});
    expect(new Set(casts).size).toBe(4);
    for (const clip of casts) {
      expect(shipped.get(clip) ?? 0, clip).toBeGreaterThan(1);
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
      expect(shipped.get(clip) ?? 0, clip).toBeLessThanOrEqual(SWING_SEC);
    }
  });

  it('came through the compression steps', () => {
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
  });
});
