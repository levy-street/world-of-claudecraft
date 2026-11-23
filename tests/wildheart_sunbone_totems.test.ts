// The Totem-Binder's two totems on their Blender bodies (src/render/
// wildheart_basin/basin_trash_model_core.ts, src/render/characters/
// wildheart_creature_looks.ts, the rise and pulse gestures in basin_trash_fx.ts
// and basin_fx.ts): both GLBs carry every clip their looks play and their eyes'
// glow, they stand at their authored sizes over the sim's scale, a totem rises
// out of the ground once when planted, the Sunbone Totem flares on its mending
// pulse and the Dread Totem's Rattle screams on its 2 s bar's last frame.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  WILDHEART_SUNBONE_DREAD_TOTEM_LOOK,
  WILDHEART_SUNBONE_TOTEM_LOOK,
} from '../src/render/characters/wildheart_creature_looks';
import {
  isSunboneTotem,
  TOTEM_RISE_GESTURE,
  TOTEM_RISE_WINDOW,
  TRASH_BODY_HEIGHT,
  trashCastSeconds,
} from '../src/render/wildheart_basin/basin_trash_fx_core';
import {
  DREAD_TOTEM_MODEL,
  dreadRattleRate,
  SUN_TOTEM_MODEL,
  TOTEM_CLIP,
  TOTEM_SIM_SCALE,
  trashLookHeight,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import { MOBS } from '../src/sim/data';
import {
  SUNBONE_DREAD_TOTEM_ID,
  SUNBONE_TOTEM_ID,
  TOTEM_BINDER_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_RATTLING_DREAD,
  WILDHEART_TOTEM_PULSE,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
  nodes: { name?: string }[];
  materials: { name: string; emissiveTexture?: unknown }[];
  images?: { mimeType?: string }[];
}

function glbJson(url: string): GlbJson {
  const buf = readFileSync(`public/${url}`);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as GlbJson;
}

function clipLength(json: GlbJson, name: string): number {
  const a = json.animations.find((x) => x.name === name);
  if (!a) return 0;
  return Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
}

const key = (templateId: string) => visualKeyFor({ kind: 'mob', templateId } as unknown as Entity);

describe('the Sunbone totems', () => {
  for (const [id, look, model, material] of [
    [SUNBONE_TOTEM_ID, WILDHEART_SUNBONE_TOTEM_LOOK, SUN_TOTEM_MODEL, 'SunboneTotemBody'],
    [
      SUNBONE_DREAD_TOTEM_ID,
      WILDHEART_SUNBONE_DREAD_TOTEM_LOOK,
      DREAD_TOTEM_MODEL,
      'SunboneDreadTotemBody',
    ],
  ] as const) {
    it(`${id}: its Blender body at its authored size, every clip, its glow`, () => {
      expect(VISUALS[key(id)]).toBe(look);
      expect(MOBS[id].scale).toBe(TOTEM_SIM_SCALE);
      expect(look.url).toBe(model.url);
      expect(look.height).toBeCloseTo(trashLookHeight(model, TOTEM_SIM_SCALE), 9);
      expect(look.height * TOTEM_SIM_SCALE).toBeCloseTo(model.idleTop - model.idleMin, 9);
      // Over two players tall.
      expect(model.idleTop).toBeGreaterThan(2.6 * 2.3);
      expect(TRASH_BODY_HEIGHT[id]).toBeCloseTo(look.height, 9);
      const json = glbJson(model.url);
      const c = look.clips;
      for (const clip of [
        c.idle,
        c.death,
        c.entrance,
        ...c.attack,
        ...(c.hit ?? []),
        ...Object.values(c.attackByAbility ?? {}),
        ...Object.values(c.castByAbility ?? {}),
      ]) {
        if (clip === undefined) continue;
        expect(clipLength(json, clip), clip).toBeGreaterThan(0.5);
      }
      expect(json.materials.map((m) => m.name)).toEqual([material]);
      expect(json.materials[0].emissiveTexture).toBeDefined();
      expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
      expect(statSync(`public/${model.url}`).size).toBeLessThan(2.5 * 1024 * 1024);
      expect(clipLength(json, 'Death')).toBeGreaterThan(TOTEM_CLIP.deathDown);
    });
  }

  it('rises out of the ground once when the Binder plants it', () => {
    for (const look of [WILDHEART_SUNBONE_TOTEM_LOOK, WILDHEART_SUNBONE_DREAD_TOTEM_LOOK]) {
      expect(look.clips.entrance).toBe('Rise');
      expect(look.entranceGesture).toBe(TOTEM_RISE_GESTURE);
      expect(look.oneShotsHoldAttacks).toContain('Rise');
    }
    expect(MOBS[TOTEM_BINDER_ID].trashKit?.wildheart?.totems?.summons).toEqual([
      SUNBONE_TOTEM_ID,
      SUNBONE_DREAD_TOTEM_ID,
    ]);
    expect(isSunboneTotem(SUNBONE_TOTEM_ID)).toBe(true);
    expect(isSunboneTotem(SUNBONE_DREAD_TOTEM_ID)).toBe(true);
    expect(isSunboneTotem(TOTEM_BINDER_ID)).toBe(false);
    // The offer outlasts a late view but ends well before the clip does.
    expect(TOTEM_RISE_WINDOW).toBeGreaterThan(0.2);
    expect(TOTEM_RISE_WINDOW).toBeLessThan(TOTEM_CLIP.riseUp);
    expect(clipLength(glbJson(SUN_TOTEM_MODEL.url), 'Rise')).toBeCloseTo(TOTEM_CLIP.riseLength, 2);
  });

  it('the Sunbone Totem flares on its mending pulse', () => {
    expect(MOBS[SUNBONE_TOTEM_ID].trashKit?.pulse?.castId).toBe(WILDHEART_TOTEM_PULSE);
    const c = WILDHEART_SUNBONE_TOTEM_LOOK.clips;
    expect(c.attackByAbility?.[WILDHEART_TOTEM_PULSE]).toBe('Pulse');
    // It flares and settles well inside the 2 s between pulses.
    const every = MOBS[SUNBONE_TOTEM_ID].trashKit?.pulse?.every ?? 0;
    expect(clipLength(glbJson(SUN_TOTEM_MODEL.url), 'Pulse')).toBeLessThan(every);
  });

  it("the Dread Totem's Rattle screams on the Rattling Dread's last frame", () => {
    const bar = trashCastSeconds(WILDHEART_RATTLING_DREAD);
    expect(bar).toBe(MOBS[SUNBONE_DREAD_TOTEM_ID].trashKit?.wildheart?.dread?.castTime);
    const c = WILDHEART_SUNBONE_DREAD_TOTEM_LOOK.clips;
    expect(c.castByAbility?.[WILDHEART_RATTLING_DREAD]).toBe('Rattle');
    const rate = c.castTimeScaleByAbility?.[WILDHEART_RATTLING_DREAD] ?? 1;
    expect(rate).toBeCloseTo(dreadRattleRate(bar), 9);
    expect(bar * rate).toBeCloseTo(TOTEM_CLIP.rattleScream, 9);
    expect(c.castPlayOut).toContain('Rattle');
    expect(WILDHEART_SUNBONE_DREAD_TOTEM_LOOK.castClipSync).toBe(true);
    const names = new Set(glbJson(DREAD_TOTEM_MODEL.url).nodes.map((n) => n.name));
    for (const bone of ['Crown', 'Jaw', 'L_Charm1', 'R_Charm2'])
      expect(names.has(bone), bone).toBe(true);
  });
});
