// The Sunken Bastion's first two bosses wear their own sculpted Blender bodies
// (scripts/assets/sunken_bastion_drowned/olen/ and ossick/) instead of the
// KayKit skeletons they shared with other dungeons: every clip their VISUALS
// rows name ships in their GLB, each bar plays its own bar-locked clip, they
// tower over their garrison, and their gameplay is untouched (only the drawn
// height grew).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { OLEN_STARS_UP } from '../src/render/sunken_bastion/bastion_boss_fx_core';
import {
  OSSICK_ANCHOR_AWAY_GESTURE,
  OSSICK_ANCHOR_BACK_MESH,
  OSSICK_ANCHOR_HOME_GESTURE,
  ossickAnchorGesture,
} from '../src/render/sunken_bastion/bastion_gaol_reaper_core';
import {
  OLEN_SHIELD_AWAY_GESTURE,
  OLEN_SHIELD_BONE,
  OLEN_SHIELD_CATCH_GESTURE,
  OLEN_SHIELD_HOME_GESTURE,
} from '../src/render/sunken_bastion/bastion_olen_fx_core';
import { MOBS } from '../src/sim/data';
import {
  OLEN_HALLOWED_BRINE,
  OLEN_OATH_KNEEL,
  OLEN_OATH_VIGIL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_TIDE_SENTENCE,
  OSSICK_ANCHOR,
  OSSICK_CUDGEL,
  OSSICK_SHACKLE,
} from '../src/sim/encounters/sunken_bastion/ids';
import type { Entity } from '../src/sim/types';

function glbJson(url: string): { animations?: { name: string }[]; nodes?: { name?: string }[] } {
  const buf = readFileSync(join('public', url));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
}

function glbNodeNames(url: string): Set<string> {
  return new Set((glbJson(url).nodes ?? []).map((n) => n.name ?? ''));
}

function glbClips(url: string): Set<string> {
  return new Set((glbJson(url).animations ?? []).map((a) => a.name));
}

const keyOf = (mobId: string) => visualKeyFor({ kind: 'mob', templateId: mobId } as Entity);
const drawn = (mobId: string) => VISUALS[keyOf(mobId)].height * (MOBS[mobId].scale ?? 1);

/** Every clip name a VISUALS row's ClipMap references. */
function referencedClips(key: string): string[] {
  const clips = VISUALS[key].clips as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const value of Object.values(clips)) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value))
      out.push(...value.filter((v): v is string => typeof v === 'string'));
    else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

describe('Knight-Commander Olen', () => {
  const key = keyOf('knight_commander_olen');
  const def = VISUALS[key];

  it('wears his own sculpted body with every clip he plays', () => {
    expect(key).toBe('bastion_olen');
    expect(def.url).toBe('models/creatures/woc_bastion_olen.glb');
    expect(def.url).not.toMatch(/skeleton/);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.attach ?? []).toEqual([]);
    expect(def.tint).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    const shipped = glbClips(def.url);
    for (const clip of referencedClips(key)) expect(shipped.has(clip), clip).toBe(true);
    for (const clip of [
      'Idle',
      'CombatIdle',
      'Walk',
      'Run',
      'Attack3',
      'Stunned',
      'Consecrate',
      'ShieldThrow',
      'ShieldCatch',
      'Judgement',
      'OathKneel',
      'OathVigil',
    ])
      expect(shipped.has(clip), clip).toBe(true);
  });

  it("plays the fallen paladin's bars bar-locked and loops the vigil", () => {
    const by = def.clips.castByAbility ?? {};
    expect(by[OLEN_HALLOWED_BRINE]).toBe('Consecrate');
    expect(by[OLEN_REBOUNDING_BULWARK]).toBe('ShieldThrow');
    expect(by[OLEN_TIDE_SENTENCE]).toBe('Judgement');
    expect(by[OLEN_OATH_KNEEL]).toBe('OathKneel');
    expect(by[OLEN_OATH_VIGIL]).toBe('OathVigil');
    const synced = def.castClipSync as readonly string[];
    for (const id of [
      OLEN_HALLOWED_BRINE,
      OLEN_REBOUNDING_BULWARK,
      OLEN_TIDE_SENTENCE,
      OLEN_OATH_KNEEL,
    ])
      expect(synced).toContain(id);
    // The vigil's 60 s bar never locks its loop.
    expect(synced).not.toContain(OLEN_OATH_VIGIL);
    expect(def.clips.attackByAbility?.[OLEN_SHIELD_CATCH_GESTURE]).toBe('ShieldCatch');
    // The held shield hides while the thrown one flies, and comes home.
    expect(def.meshToggles).toEqual([
      {
        nodes: [OLEN_SHIELD_BONE],
        hideNow: OLEN_SHIELD_AWAY_GESTURE,
        showNow: OLEN_SHIELD_HOME_GESTURE,
      },
    ]);
    expect(glbNodeNames(def.url).has(OLEN_SHIELD_BONE)).toBe(true);
    // Breached reels in its own dazed loop.
    expect(def.clips.stunned).toBe('Stunned');
  });

  it('towers over his garrison, gameplay untouched', () => {
    expect(MOBS.knight_commander_olen.scale).toBe(1.2);
    for (const mobId of ['bastion_revenant', 'drowned_sergeant', 'gaol_turnkey'])
      expect(drawn('knight_commander_olen'), mobId).toBeGreaterThan(drawn(mobId));
    // Never smaller than the stand-in he replaced (5.4 at his scale).
    expect(def.height).toBeGreaterThanOrEqual(5.4);
  });

  it("circles Breached's stars round his helm", () => {
    expect(OLEN_STARS_UP).toBeGreaterThan(def.height * 0.75);
    expect(OLEN_STARS_UP).toBeLessThan(def.height * 0.95);
  });
});

describe('Gaoler Ossick', () => {
  const key = keyOf('gaoler_ossick');
  const def = VISUALS[key];

  it('wears his own sculpted body with every clip he plays', () => {
    expect(key).toBe('bastion_ossick');
    expect(def.url).toBe('models/creatures/woc_bastion_ossick.glb');
    expect(def.url).not.toMatch(/skeleton/);
    expect(def.animUrls ?? []).toEqual([]);
    expect(def.weaponFix ?? []).toEqual([]);
    expect(def.tint).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
    const shipped = glbClips(def.url);
    for (const clip of referencedClips(key)) expect(shipped.has(clip), clip).toBe(true);
    for (const clip of ['Idle', 'Walk', 'Run', 'AnchorHurl', 'ShackleHeave', 'CudgelSlam'])
      expect(shipped.has(clip), clip).toBe(true);
  });

  it('plays each bar bar-locked, its follow-through played out', () => {
    const clips = def.clips;
    expect(clips.castByAbility?.[OSSICK_ANCHOR]).toBe('AnchorHurl');
    expect(clips.castByAbility?.[OSSICK_SHACKLE]).toBe('ShackleHeave');
    expect(clips.castByAbility?.[OSSICK_CUDGEL]).toBe('CudgelSlam');
    for (const id of [OSSICK_ANCHOR, OSSICK_SHACKLE, OSSICK_CUDGEL])
      expect(clips.castTimeScaleByAbility?.[id], id).toBe(1);
    expect(def.castClipSync).toBe(true);
    expect([...(clips.castPlayOut ?? [])].sort()).toEqual([
      'AnchorHurl',
      'CudgelSlam',
      'ShackleHeave',
    ]);
  });

  it('hides the anchor on his back while his thrown one lies on a victim', () => {
    expect(glbNodeNames(def.url).has(OSSICK_ANCHOR_BACK_MESH)).toBe(true);
    expect(def.meshToggles).toEqual([
      {
        nodes: [OSSICK_ANCHOR_BACK_MESH],
        hideNow: OSSICK_ANCHOR_AWAY_GESTURE,
        showNow: OSSICK_ANCHOR_HOME_GESTURE,
      },
    ]);
    expect(ossickAnchorGesture(0)).toBe(OSSICK_ANCHOR_HOME_GESTURE);
    expect(ossickAnchorGesture(1)).toBe(OSSICK_ANCHOR_AWAY_GESTURE);
    expect(ossickAnchorGesture(2)).toBe(OSSICK_ANCHOR_AWAY_GESTURE);
  });

  it('looms over the Turnkey and Olen, gameplay untouched', () => {
    expect(MOBS.gaoler_ossick.scale).toBe(1.4);
    for (const mobId of ['gaol_turnkey', 'knight_commander_olen', 'drowned_sergeant'])
      expect(drawn('gaoler_ossick'), mobId).toBeGreaterThan(drawn(mobId));
    // Never smaller than the stand-in he replaced (6.2 at his scale).
    expect(def.height).toBeGreaterThanOrEqual(6.2);
  });
});
