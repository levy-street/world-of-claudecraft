// The Basin Raptor on its Blender body (src/render/wildheart_basin/
// basin_trash_model_core.ts, src/render/characters/wildheart_creature_looks.ts,
// the frenzy gesture in basin_trash_fx.ts): the shipped GLB carries every clip
// the look plays, it draws at its authored size over the sim's scale (well over
// a player), its gaits match the sim's speeds, the trash kit's Pounce plays the
// leap clip whose feet land on the sim's flight end, and a packmate's death
// drives it screaming into its Pack Frenzy.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  WILDHEART_BASIN_RAPTOR_LOOK,
  WILDHEART_MOB_KEYS,
} from '../src/render/characters/wildheart_creature_looks';
import {
  RAPTOR_FRENZY_GESTURE,
  TRASH_BODY_HEIGHT,
  trashBodyHeight,
} from '../src/render/wildheart_basin/basin_trash_fx_core';
import {
  RAPTOR_CLIP,
  RAPTOR_MODEL,
  RAPTOR_SIM_SCALE,
  trashLookHeight,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import { MOBS } from '../src/sim/data';
import { BASIN_RAPTOR_ID } from '../src/sim/encounters/wildheart_basin/ids';
import { WILDHEART_POUNCE } from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  meshes: { primitives: { indices?: number }[] }[];
  nodes: { name?: string }[];
  materials: { name: string }[];
  images?: { mimeType?: string }[];
  skins: { joints: number[] }[];
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

function tris(json: GlbJson): number {
  let n = 0;
  for (const m of json.meshes)
    for (const p of m.primitives)
      if (p.indices !== undefined) n += json.accessors[p.indices].count / 3;
  return n;
}

const key = (templateId: string) => visualKeyFor({ kind: 'mob', templateId } as unknown as Entity);

describe('the Basin Raptor', () => {
  it('maps the template to its Blender body at its authored size', () => {
    expect(key(BASIN_RAPTOR_ID)).toBe('wildheart_basin_raptor');
    expect(WILDHEART_MOB_KEYS[BASIN_RAPTOR_ID]).toBe('wildheart_basin_raptor');
    expect(VISUALS.wildheart_basin_raptor).toBe(WILDHEART_BASIN_RAPTOR_LOOK);
    expect(MOBS[BASIN_RAPTOR_ID].scale).toBe(RAPTOR_SIM_SCALE);
    const def = WILDHEART_BASIN_RAPTOR_LOOK;
    expect(def.url).toBe(RAPTOR_MODEL.url);
    expect(def.height).toBeCloseTo(trashLookHeight(RAPTOR_MODEL, RAPTOR_SIM_SCALE), 9);
    // One model yard per game yard, its soles on the pivot.
    expect(def.height * RAPTOR_SIM_SCALE).toBeCloseTo(
      RAPTOR_MODEL.idleTop - RAPTOR_MODEL.idleMin,
      9,
    );
    expect((def.hover ?? 0) * RAPTOR_SIM_SCALE).toBeCloseTo(RAPTOR_MODEL.idleMin, 9);
    // Imposing, never toy-like: its skull well over a 2.6 yd player's head.
    expect(RAPTOR_MODEL.head).toBeGreaterThan(2.6 * 1.5);
    // The hunt's glows ride the same body.
    expect(TRASH_BODY_HEIGHT[BASIN_RAPTOR_ID]).toBeCloseTo(def.height, 9);
    expect(trashBodyHeight(BASIN_RAPTOR_ID, RAPTOR_SIM_SCALE)).toBeCloseTo(
      RAPTOR_MODEL.idleTop - RAPTOR_MODEL.idleMin,
      9,
    );
  });

  it('ships every clip the look plays, one material, compressed and lean', () => {
    const json = glbJson(RAPTOR_MODEL.url);
    const c = WILDHEART_BASIN_RAPTOR_LOOK.clips;
    for (const clip of [
      c.idle,
      c.walk,
      c.run,
      c.death,
      c.flourish,
      ...c.attack,
      ...(c.hit ?? []),
      ...Object.values(c.attackByAbility ?? {}),
    ]) {
      if (clip === undefined) continue;
      expect(clipLength(json, clip), clip).toBeGreaterThan(0.5);
    }
    expect(json.materials.map((m) => m.name)).toEqual(['BasinRaptorBody']);
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    // Four come at a time: it stays a lean trash body.
    expect(tris(json)).toBeLessThan(20_000);
    expect(statSync(`public/${RAPTOR_MODEL.url}`).size).toBeLessThan(3 * 1024 * 1024);
    const names = new Set(json.nodes.map((n) => n.name));
    for (const bone of ['Head', 'Jaw', 'Crest', 'L_Sickle', 'R_Sickle', 'Tail8'])
      expect(names.has(bone), bone).toBe(true);
  });

  it('the clips outlive their beats', () => {
    const json = glbJson(RAPTOR_MODEL.url);
    expect(clipLength(json, 'Bite')).toBeGreaterThan(RAPTOR_CLIP.bite);
    expect(clipLength(json, 'Slash')).toBeGreaterThan(RAPTOR_CLIP.slash);
    expect(clipLength(json, 'Pounce')).toBeGreaterThan(RAPTOR_CLIP.pounceLand);
    expect(clipLength(json, 'Screech')).toBeGreaterThan(RAPTOR_CLIP.screechPeak);
    expect(clipLength(json, 'Death')).toBeGreaterThan(RAPTOR_CLIP.deathBody);
  });

  it("lands the Pounce's feet on the sim's flight end, at 1x", () => {
    const leap = MOBS[BASIN_RAPTOR_ID].trashKit?.leap;
    expect(leap?.castId).toBe(WILDHEART_POUNCE);
    const c = WILDHEART_BASIN_RAPTOR_LOOK.clips;
    expect(c.attackByAbility?.[WILDHEART_POUNCE]).toBe('Pounce');
    // The windup leaves on the leap's first tick; the feet strike as the sim
    // sets it down, the clip played a touch fast to land on that tick.
    const rate = c.attackTimeScaleByAbility?.[WILDHEART_POUNCE] ?? 1;
    expect(RAPTOR_CLIP.pounceLand / rate).toBeCloseTo(leap?.seconds ?? 0, 9);
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThan(1.2);
    // A swing never cuts the leap short.
    expect(WILDHEART_BASIN_RAPTOR_LOOK.oneShotsHoldAttacks).toContain('Pounce');
  });

  it('screams into its Pack Frenzy, and swings a bite and a sickle slash', () => {
    const c = WILDHEART_BASIN_RAPTOR_LOOK.clips;
    expect(MOBS[BASIN_RAPTOR_ID].packFrenzy).toBeDefined();
    expect(c.attackByAbility?.[RAPTOR_FRENZY_GESTURE]).toBe('Screech');
    expect(c.flourish).toBe('Screech');
    expect(c.attack).toEqual(['Bite', 'Slash']);
  });

  it('plays its gaits near 1x at the sim speeds', () => {
    const def = WILDHEART_BASIN_RAPTOR_LOOK;
    const run = (MOBS[BASIN_RAPTOR_ID].moveSpeed ?? 8) / (def.runRef ?? 1);
    expect(run).toBeGreaterThan(0.9);
    expect(run).toBeLessThan(1.3);
  });
});
