// The Hollow Crypt's trash bodies remade through the art guide (concept, Tripo P2, a skeleton
// and every clip built in Blender): each mob template draws its own shipped GLB, every clip its
// ClipMap names ships in that GLB, and each bar-locked cast clip is long enough to land its
// strike on the bar's end the sim actually runs (the content's castTime) and play out after it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';
import {
  CRYPT_GRAVE_BOLT,
  CRYPT_GRAVE_CLEAVE,
  CRYPT_GRAVESPARK_VOLLEY,
  CRYPT_MARROW_CRUSH,
  CRYPT_RAISE_BONES,
} from '../src/sim/mob/trash_kit/cast_ids';
import type { Entity } from '../src/sim/types';

const BODIES: Record<string, string> = {
  crypt_ossuary_warrior: 'models/creatures/woc_crypt_ossuary_warrior.glb',
  crypt_gravecaller_adept: 'models/creatures/woc_crypt_gravecaller_adept.glb',
  crypt_ossuary_cutthroat: 'models/creatures/woc_crypt_ossuary_cutthroat.glb',
  crypt_gravecaller_necromancer: 'models/creatures/woc_crypt_gravecaller_necromancer.glb',
  hollow_chorister: 'models/creatures/woc_crypt_hollow_chorister.glb',
  crypt_bone_brute: 'models/creatures/woc_crypt_bone_brute.glb',
};

interface GltfJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
}

function clipsOf(url: string): Map<string, number> {
  const json = glbJsonChunk(readFileSync(`public/${url}`)) as GltfJson;
  const out = new Map<string, number>();
  for (const a of json.animations) {
    const end = Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
    out.set(a.name, end);
  }
  return out;
}

const defOf = (templateId: string) => VISUALS[visualKeyFor({ kind: 'mob', templateId } as Entity)];

describe('the Hollow Crypt trash bodies', () => {
  it('draws each mob from its own art-guide GLB, never a KayKit rig', () => {
    for (const [mob, url] of Object.entries(BODIES)) {
      const def = defOf(mob);
      expect(def.url, mob).toBe(url);
      expect(def.animUrls ?? [], mob).toEqual([]);
      expect(def.authoredAtlas, mob).toBe(true);
      // the painted atlas carries its own colour: no entity tint washing it toward the template's
      expect(def.tint, mob).toBeUndefined();
    }
    expect(defOf('crypt_bone_minion').tint).toBeUndefined();
  });

  it('ships every clip each ClipMap names', () => {
    for (const [mob, url] of Object.entries(BODIES)) {
      const { clips } = defOf(mob);
      const shipped = clipsOf(url);
      const named = [
        clips.idle,
        clips.walk,
        clips.run,
        ...clips.attack,
        ...(clips.hit ?? []),
        clips.death,
        clips.flourish,
        clips.cast,
        ...Object.values(clips.castByAbility ?? {}),
        ...(clips.castPlayOut ?? []),
      ].filter((c): c is string => typeof c === 'string');
      for (const clip of named) expect(shipped.has(clip), `${mob}: ${clip}`).toBe(true);
    }
  });

  it('keeps each bar-locked clip at rate 1 and longer than the bar the sim runs, with a recovery', () => {
    const cases: [string, string, string, number][] = [
      [
        'crypt_ossuary_warrior',
        CRYPT_GRAVE_CLEAVE,
        'Cleave',
        MOBS.crypt_ossuary_warrior.breathCone?.castTime ?? 0,
      ],
      [
        'crypt_gravecaller_adept',
        CRYPT_GRAVE_BOLT,
        'Bolt',
        MOBS.crypt_gravecaller_adept.trashKit?.bolt?.castTime ?? 0,
      ],
      [
        'crypt_gravecaller_adept',
        CRYPT_GRAVESPARK_VOLLEY,
        'Volley',
        MOBS.crypt_gravecaller_adept.trashKit?.nova?.castTime ?? 0,
      ],
      [
        'crypt_bone_brute',
        CRYPT_MARROW_CRUSH,
        'Slam',
        MOBS.crypt_bone_brute.breathCone?.castTime ?? 0,
      ],
    ];
    for (const [mob, ability, clip, bar] of cases) {
      const def = defOf(mob);
      expect(bar, `${mob} ${ability} bar`).toBeGreaterThan(1);
      expect(def.clips.castByAbility?.[ability], mob).toBe(clip);
      expect(def.castClipSync, mob).toContain(ability);
      expect(def.clips.castPlayOut, mob).toContain(clip);
      // authored at the bar's own length: played at rate 1, the contact frame is the bar's end
      expect(def.clips.castTimeScaleByAbility?.[ability] ?? 1, mob).toBe(1);
      const length = clipsOf(BODIES[mob]).get(clip) ?? 0;
      expect(length, `${mob} ${clip}`).toBeGreaterThan(bar + 0.3);
    }
  });

  it('channels Raise Bones on its own loop and stands the dead back up on revive', () => {
    expect(defOf('crypt_gravecaller_necromancer').clips.castByAbility?.[CRYPT_RAISE_BONES]).toBe(
      'Raise',
    );
    // Reassemble stands the ossuary warrior up; heroic Encore stands a Chorister up
    for (const mob of ['crypt_ossuary_warrior', 'hollow_chorister']) {
      const def = defOf(mob);
      expect(def.clips.flourish, mob).toBe('Awaken');
      expect(def.oneShotsHoldAttacks, mob).toContain('Awaken');
    }
  });

  it('arms each fighter with its prop at the WOC hold size', () => {
    const held = (mob: string) => (defOf(mob).attach ?? []).map((a) => [a.bone, a.size]);
    expect(held('crypt_ossuary_warrior')).toEqual([['handslot.r', 0.76]]);
    expect(held('crypt_gravecaller_adept')).toEqual([['handslot.r', 0.76]]);
    expect(held('crypt_gravecaller_necromancer')).toEqual([['handslot.r', 0.76]]);
    expect(held('crypt_ossuary_cutthroat')).toEqual([
      ['handslot.r', 0.76],
      ['handslot.l', 0.76],
    ]);
    expect(held('hollow_chorister')).toEqual([]);
    expect(held('crypt_bone_brute')).toEqual([]);
  });
});
