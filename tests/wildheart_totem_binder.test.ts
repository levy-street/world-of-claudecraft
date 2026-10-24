// The Sunbone Totem-Binder on his Blender body (src/render/wildheart_basin/
// basin_trash_model_core.ts, src/render/characters/wildheart_creature_looks.ts):
// the shipped GLB carries every clip the look plays, he draws at his authored
// size over the sim's scale (twice a player and more), his gaits match the sim's
// speed, and the Plant Totem bar plays his own PlantTotem clip whose staff
// strikes the earth on the bar's last frame.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { WILDHEART_TOTEM_BINDER_LOOK } from '../src/render/characters/wildheart_creature_looks';
import { trashCastSeconds } from '../src/render/wildheart_basin/basin_trash_fx_core';
import {
  BINDER_CLIP,
  BINDER_MODEL,
  BINDER_SIM_SCALE,
  binderPlantRate,
  trashLookHeight,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import { MOBS } from '../src/sim/data';
import { TOTEM_BINDER_ID } from '../src/sim/encounters/wildheart_basin/ids';
import { WILDHEART_PLANT_TOTEM } from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
  nodes: { name?: string }[];
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

describe('the Sunbone Totem-Binder', () => {
  it('maps the template to his Blender body at his authored size', () => {
    expect(key(TOTEM_BINDER_ID)).toBe('wildheart_totem_binder');
    expect(VISUALS.wildheart_totem_binder).toBe(WILDHEART_TOTEM_BINDER_LOOK);
    expect(MOBS[TOTEM_BINDER_ID].scale).toBe(BINDER_SIM_SCALE);
    const def = WILDHEART_TOTEM_BINDER_LOOK;
    expect(def.url).toBe(BINDER_MODEL.url);
    expect(def.height).toBeCloseTo(trashLookHeight(BINDER_MODEL, BINDER_SIM_SCALE), 9);
    expect(def.height * BINDER_SIM_SCALE).toBeCloseTo(
      BINDER_MODEL.idleTop - BINDER_MODEL.idleMin,
      9,
    );
    // Imposing: twice a 2.6 yd player and more.
    expect(BINDER_MODEL.idleTop).toBeGreaterThan(2.6 * 2);
  });

  it('ships every clip the look plays, compressed', () => {
    const json = glbJson(BINDER_MODEL.url);
    const c = WILDHEART_TOTEM_BINDER_LOOK.clips;
    for (const clip of [
      c.idle,
      c.combatIdle,
      c.walk,
      c.run,
      c.death,
      c.cast,
      ...c.attack,
      ...(c.hit ?? []),
      ...Object.values(c.castByAbility ?? {}),
    ]) {
      if (clip === undefined) continue;
      expect(clipLength(json, clip), clip).toBeGreaterThan(0.5);
    }
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(statSync(`public/${BINDER_MODEL.url}`).size).toBeLessThan(3.5 * 1024 * 1024);
    const names = new Set(json.nodes.map((n) => n.name));
    for (const bone of ['Weapon', 'Head', 'Jaw', 'R_Hand', 'Bundle'])
      expect(names.has(bone), bone).toBe(true);
    expect(clipLength(json, 'PlantTotem')).toBeCloseTo(BINDER_CLIP.plantLength, 2);
  });

  it("drives his staff into the earth on the Plant Totem bar's last frame", () => {
    const bar = trashCastSeconds(WILDHEART_PLANT_TOTEM);
    expect(bar).toBe(MOBS[TOTEM_BINDER_ID].trashKit?.wildheart?.totems?.castTime);
    const c = WILDHEART_TOTEM_BINDER_LOOK.clips;
    expect(c.castByAbility?.[WILDHEART_PLANT_TOTEM]).toBe('PlantTotem');
    const rate = c.castTimeScaleByAbility?.[WILDHEART_PLANT_TOTEM] ?? 1;
    expect(rate).toBeCloseTo(binderPlantRate(bar), 9);
    expect(bar * rate).toBeCloseTo(BINDER_CLIP.plantStrike, 9);
    // The strike's recovery finishes as a play-out, his swings held for it.
    expect(c.castPlayOut).toContain('PlantTotem');
    expect(WILDHEART_TOTEM_BINDER_LOOK.castPlayOutHoldsAttacks).toBe(true);
    expect(WILDHEART_TOTEM_BINDER_LOOK.castClipSync).toBe(true);
  });

  it('plays his gaits near 1x at the sim speed', () => {
    const run = (MOBS[TOTEM_BINDER_ID].moveSpeed ?? 6) / (WILDHEART_TOTEM_BINDER_LOOK.runRef ?? 1);
    expect(run).toBeGreaterThan(0.9);
    expect(run).toBeLessThan(1.3);
  });
});
