// The Drowned Temple's sixth-pass bodies (src/render/characters/manifest.ts):
// Ysolei is the Codex-built serpent, every one of her clips riding a real
// mechanic; the Lagoon Eel ships its Spit clip for Lightning Spit; the
// Colossus walks on its own gait. Each row names its clips so a new body is a
// manifest swap.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';
import {
  YSOLEI_CALL,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_UNDERTOW,
  YSOLEI_WRATH,
} from '../src/sim/encounters/drowned_temple';
import {
  TEMPLE_LIGHTNING_SPIT,
  TEMPLE_STATIC_COIL,
} from '../src/sim/mob/trash_kit/temple_cast_ids';

function clipsOf(path: string): string[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name: string }[];
  };
  return (json.animations ?? []).map((a) => a.name);
}

function visualOf(templateId: string) {
  return VISUALS[visualKeyFor({ kind: 'mob', templateId } as never)];
}

describe('Ysolei: the Codex serpent on every mechanic', () => {
  it('ships its ten original clips', () => {
    expect(clipsOf('public/models/creatures/temple_ysolei.glb').sort()).toEqual(
      [
        'Bite',
        'Death',
        'Enrage',
        'Hit',
        'Idle',
        'Lunar_Tide',
        'Rise',
        'Summon',
        'Tail_Sweep',
        'Undertow',
      ].sort(),
    );
  });

  it('maps each cast bar to its clip at its authored pace, and keeps her materials', () => {
    const v = visualOf('ysolei');
    const c = v.clips;
    expect(c.castByAbility?.[YSOLEI_LUNAR_TIDE]).toBe('Lunar_Tide');
    expect(c.castByAbility?.[YSOLEI_UNDERTOW]).toBe('Undertow');
    expect(c.castByAbility?.[YSOLEI_CALL]).toBe('Summon');
    expect(c.castByAbility?.[YSOLEI_WRATH]).toBe('Enrage');
    // The Undertow's 3 s channel must never be shortened by a time scale.
    expect(c.castTimeScaleByAbility?.[YSOLEI_UNDERTOW]).toBe(1);
    expect(c.attack).toEqual(['Bite', 'Tail_Sweep']);
    expect(c.flourish).toBe('Rise');
    expect(c.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    expect(v.tint).toBeUndefined();
    // Drawn at native scale: about 24 world units, seven players to her head.
    expect(v.height * (MOBS.ysolei.scale ?? 1)).toBeCloseTo(23.97, 1);
  });
});

describe('the Lagoon Eel and the Colossus', () => {
  it('the eel spits its Lightning Spit on its own clip, and coils for Static Coil', () => {
    expect(clipsOf('public/models/creatures/temple_eel.glb')).toEqual(
      expect.arrayContaining(['Idle', 'Walk', 'Run', 'Coil', 'Spit']),
    );
    const c = visualOf('lagoon_eel').clips;
    expect(c.castByAbility?.[TEMPLE_LIGHTNING_SPIT]).toBe('Spit');
    expect(c.castByAbility?.[TEMPLE_STATIC_COIL]).toBe('Coil');
  });

  it('the walking Colossus is drawn at its old size under its larger reach', () => {
    const v = visualOf('tideglass_colossus');
    expect(clipsOf('public/models/creatures/temple_colossus.glb')).toEqual(
      expect.arrayContaining(['Walk', 'Run']),
    );
    expect(v.clips.walk).toBe('Walk');
    expect(v.height * (MOBS.tideglass_colossus.scale ?? 1)).toBeCloseTo(15, 3);
  });
});
