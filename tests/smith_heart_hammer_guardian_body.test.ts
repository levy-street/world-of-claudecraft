// The Guardian of the Hammer's body: the model first built for the Slabwright
// (scripts/assets/specs/heart_slabwright.json), worn by the Hammer Council's main boss since the
// council became two bosses. Pinned: the Guardian draws it in place of the borrowed golem, every
// clip its ClipMap names ships, each strike lands on its own bar or wind-up, its blows land inside
// the longest contact hold, it stands at the height the council's effects are anchored to, and
// the file ships small and streams with the raid.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { dungeonCharacterBodyUrls } from '../src/render/characters/rift_body_stream_core';
import { CONTACT_HOLD_MAX_SEC } from '../src/render/contact_queue';
import { councilBodyKindOf } from '../src/render/smith_heart_fx/council_bodies_core';
import { BOND_BODY } from '../src/render/smith_heart_fx/council_mechanic_look_core';
import { MOBS } from '../src/sim/data';
import { COUNCIL_CASTS, COUNCIL_TUNING } from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity } from '../src/sim/types';

const MOB = 'heart_hammer_guardian';
const URL = 'models/creatures/heart_slabwright.glb';
/** Where the authored casts strike at 1x (the Slabwright's build): CastWake's slam comes down at
 *  78 percent of the 1.2 s bar it was keyed for, CastWrath's burst at 3 s. */
const WAKE_SLAM_SEC = 0.78 * 1.2;
const WRATH_BURST_SEC = 3;

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
const mob = MOBS[MOB];

const shipped = new Map(
  json.animations.map((a) => [
    a.name,
    Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)),
  ]),
);

describe('the Guardian of the Hammer body', () => {
  it('draws the painted GLB in place of the borrowed golem', () => {
    expect(def).toBe(VISUALS.smith_heart_hammer_guardian);
    expect(def.url).toBe(URL);
    // Only its entrance's Dormant clip rides beside it (scripts/build_council_entrance_anims.mjs).
    expect(def.animUrls ?? []).toEqual([
      'models/creatures/heart_hammer_guardian_entrance_anims.glb',
    ]);
    expect(def.bodyless).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    expect(def.tint).toBeUndefined();
    // The Slabwright itself is gone from the council, and the Guardian was never a provisional
    // body: council_bodies.ts dresses neither.
    expect(MOBS.heart_slabwright).toBeUndefined();
    expect(councilBodyKindOf(MOB)).toBeNull();
  });

  it('stands at the height the bond, its sigil and the click are anchored to', () => {
    expect(def.height * mob.scale).toBeCloseTo(BOND_BODY.guardian.height);
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
      ...Object.values(clips.attackByAbility ?? {}).flat(),
      clips.cast,
      ...Object.values(clips.castByAbility ?? {}),
      ...(clips.hit ?? []),
      clips.death,
      clips.flourish,
    ].filter((c): c is string => typeof c === 'string');
    for (const clip of named) expect(shipped.has(clip), clip).toBe(true);
    expect(shipped.size).toBe(16);
  });

  it("strikes on the end of Hammer's Weight's and Mountain's Wrath's bars, locked to them", () => {
    const by = def.clips.castByAbility ?? {};
    const scale = def.clips.castTimeScaleByAbility ?? {};
    const casts = [
      [COUNCIL_CASTS.weight, 'CastWake', WAKE_SLAM_SEC, COUNCIL_TUNING.weightCast],
      [COUNCIL_CASTS.wrath, 'CastWrath', WRATH_BURST_SEC, COUNCIL_TUNING.wrathCast],
    ] as const;
    for (const [id, clip, strike, bar] of casts) {
      expect(by[id], id).toBe(clip);
      expect(strike / (scale[id] ?? 1), id).toBeCloseTo(bar, 1);
      // The recovery plays out after the bar.
      expect((shipped.get(clip) ?? 0) / (scale[id] ?? 1), id).toBeGreaterThan(bar);
      expect(def.clips.castPlayOut, id).toContain(clip);
      expect(def.castClipSync, id).toContain(id);
    }
    // Through Mountain's Rush's bar it braces on its combat stance, never a strike.
    expect(by[COUNCIL_CASTS.rush]).toBe(def.clips.combatIdle);
  });

  it("slams as Mountain's Rush runs and swings Hammerfall wide", () => {
    const atk = def.clips.attackByAbility ?? {};
    const rate = def.clips.attackTimeScaleByAbility ?? {};
    const windup = 'heart_mountains_rush_windup';
    expect(atk[windup]).toBe('Attack');
    const contact = def.clips.contacts?.Attack?.[0] ?? 0;
    expect(contact / (rate[windup] ?? 1)).toBeCloseTo(COUNCIL_TUNING.rushWindup, 2);
    // Hammerfall is the template's arcCleave, sent as its brood_cleave cue.
    expect(mob.arcCleave?.name).toBe('Hammerfall');
    expect(atk.brood_cleave).toBe('Attack2');
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
      expect(shipped.get(clip) ?? 0, clip).toBeLessThanOrEqual(mob.attackSpeed);
    }
  });

  it('hovers at 1x at the speed its template chases', () => {
    expect(def.runRef).toBe(mob.moveSpeed);
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
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(
      'models/creatures/heart_hammer_guardian_entrance_anims.glb',
    );
  });
});
