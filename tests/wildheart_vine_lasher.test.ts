// The Snarlvine Lasher and the Thorn Sprout on their Blender bodies
// (src/render/wildheart_basin/lasher_model_core.ts and lasher_fx_core.ts, the
// sprout's burst in gorgebloom_fx_core.ts, src/render/characters/
// wildheart_creature_looks.ts and the once-per-entity entrance clip): both
// shipped GLBs carry the clips their looks play, they draw at their authored
// sizes over the sim's scales, the Entangling Lash's tip lands on its lane on
// the bar's last frame and the thorn wave carries the lane on to the sim's 20
// yd, and a sprout bursts out of its pod with Emerge (and bites: it has no
// other swing).
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  WILDHEART_THORN_SPROUT_LOOK,
  WILDHEART_VINE_LASHER_LOOK,
} from '../src/render/characters/wildheart_creature_looks';
import { laneWaveDelay, laneWaveStations } from '../src/render/wildheart_basin/basin_thorns_core';
import {
  bloomEventTrigger,
  gorgebloomBeats,
  THORN_SPROUT_EMERGE_GESTURE,
  THORN_SPROUT_EMERGE_WINDOW,
} from '../src/render/wildheart_basin/gorgebloom_fx_core';
import {
  LASHER_WAVE_SPEED,
  lasherLane,
  lasherLashRate,
  lasherTipReach,
  lasherWaveDelay,
  lasherWaveStations,
  lasherWhipEnd,
} from '../src/render/wildheart_basin/lasher_fx_core';
import {
  authoredLookHeight,
  LASHER_CLIP,
  LASHER_MODEL,
  LASHER_SIM_SCALE,
  SPROUT_CLIP,
  SPROUT_MODEL,
  SPROUT_SIM_SCALE,
} from '../src/render/wildheart_basin/lasher_model_core';
import { MOBS } from '../src/sim/data';
import {
  BLOOM_SEED_SPROUT,
  THORN_SPROUT_ID,
  VINE_LASHER_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
import { WILDHEART_ENTANGLING_LASH } from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  meshes: { primitives: { indices?: number }[] }[];
  nodes: { name?: string }[];
  materials: { name: string; emissiveTexture?: unknown }[];
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

describe('the shipped GLBs', () => {
  for (const [def, material, joints, triangles] of [
    [WILDHEART_VINE_LASHER_LOOK, 'SnarlvineLasherBody', 46, 31_893],
    [WILDHEART_THORN_SPROUT_LOOK, 'ThornSproutBody', 46, 17_620],
  ] as const) {
    it(`${material}: every clip the look plays, its glow map, compressed`, () => {
      const json = glbJson(def.url);
      const c = def.clips;
      for (const clip of [
        c.idle,
        c.walk,
        c.run,
        c.death,
        c.cast,
        c.entrance,
        ...c.attack,
        ...(c.hit ?? []),
        ...Object.values(c.castByAbility ?? {}),
      ]) {
        if (clip === undefined) continue;
        expect(clipLength(json, clip), clip).toBeGreaterThan(0.5);
      }
      expect(json.skins[0].joints).toHaveLength(joints);
      expect(json.materials.map((m) => m.name)).toEqual([material]);
      expect(json.materials[0].emissiveTexture).toBeDefined();
      expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
      expect(tris(json)).toBe(triangles);
      expect(statSync(`public/${def.url}`).size).toBeLessThan(3.5 * 1024 * 1024);
    });
  }

  it('the lash arm and its whip bones are where the effects anchor', () => {
    const names = new Set(glbJson(LASHER_MODEL.url).nodes.map((n) => n.name));
    for (let i = 1; i <= 7; i++) expect(names.has(`R_Vine${i}`), `R_Vine${i}`).toBe(true);
    for (const bone of ['Jaw', 'Head', 'Chest', 'L_Toes', 'R_Toes'])
      expect(names.has(bone)).toBe(true);
  });

  it('the Sprout has Emerge and Bite and no Attack clip; the clips outlive their beats', () => {
    const json = glbJson(SPROUT_MODEL.url);
    expect(clipLength(json, 'Attack')).toBe(0);
    expect(clipLength(json, 'Emerge')).toBeCloseTo(SPROUT_CLIP.emergeLength, 2);
    expect(clipLength(json, 'Emerge')).toBeGreaterThan(SPROUT_CLIP.emergeTall);
    expect(clipLength(json, 'Bite')).toBeGreaterThan(SPROUT_CLIP.bite);
    expect(clipLength(json, 'Wither')).toBeGreaterThan(SPROUT_CLIP.witherGone);
    const lasher = glbJson(LASHER_MODEL.url);
    expect(clipLength(lasher, 'LashCast')).toBeCloseTo(LASHER_CLIP.lashLength, 2);
    expect(clipLength(lasher, 'LashCast')).toBeGreaterThan(LASHER_CLIP.lashLiesUntil);
    expect(clipLength(lasher, 'Death')).toBeGreaterThan(LASHER_CLIP.deathPile);
  });
});

describe('the looks agree with the sim', () => {
  it('map both templates to their Blender bodies at their authored sizes', () => {
    expect(key(VINE_LASHER_ID)).toBe('wildheart_vine_lasher');
    expect(key(THORN_SPROUT_ID)).toBe('wildheart_thorn_sprout');
    expect(VISUALS.wildheart_vine_lasher).toBe(WILDHEART_VINE_LASHER_LOOK);
    expect(VISUALS.wildheart_thorn_sprout).toBe(WILDHEART_THORN_SPROUT_LOOK);
    expect(MOBS.vine_lasher.scale).toBe(LASHER_SIM_SCALE);
    expect(MOBS.thorn_sprout.scale).toBe(SPROUT_SIM_SCALE);
    for (const [def, model, scale] of [
      [WILDHEART_VINE_LASHER_LOOK, LASHER_MODEL, LASHER_SIM_SCALE],
      [WILDHEART_THORN_SPROUT_LOOK, SPROUT_MODEL, SPROUT_SIM_SCALE],
    ] as const) {
      expect(def.url).toBe(model.url);
      expect(def.height).toBeCloseTo(authoredLookHeight(model, scale), 9);
      // One model yard per game yard, its ground on the pivot.
      expect(def.height * scale).toBeCloseTo(model.idleTop - model.idleMin, 9);
      expect((def.hover ?? 0) * scale).toBeCloseTo(model.idleMin, 9);
    }
    // Imposing, never toy-like: the Lasher two and a half players tall, the
    // Sprout over a player's head.
    expect(LASHER_MODEL.idleTop).toBeGreaterThan(6);
    expect(SPROUT_MODEL.idleTop).toBeGreaterThan(2.6);
  });

  it("lands the Entangling Lash's tip on its lane on the bar's last frame", () => {
    const c = WILDHEART_VINE_LASHER_LOOK.clips;
    expect(c.castByAbility?.[WILDHEART_ENTANGLING_LASH]).toBe('LashCast');
    const rate = c.castTimeScaleByAbility?.[WILDHEART_ENTANGLING_LASH] ?? 1;
    expect(rate).toBeCloseTo(lasherLashRate(), 9);
    expect(lasherLane().castTime).toBe(MOBS.vine_lasher.trashKit?.line?.castTime);
    expect(lasherLane().castTime * rate).toBeCloseTo(LASHER_CLIP.lashSlam, 9);
    expect(c.castPlayOut).toContain('LashCast');
    expect(c.attack).toEqual(['Attack', 'Attack2']);
  });

  it('plays its gaits near 1x at the sim speeds', () => {
    const lasher = WILDHEART_VINE_LASHER_LOOK;
    const run = (MOBS.vine_lasher.moveSpeed ?? 6) / (lasher.runRef ?? 1);
    expect(run).toBeGreaterThan(0.9);
    expect(run).toBeLessThan(1.3);
    // The Sprout's half-scale sprint is sped up, inside its own ceiling.
    const sprout = WILDHEART_THORN_SPROUT_LOOK;
    const sprint = (MOBS.thorn_sprout.moveSpeed ?? 7) / (sprout.runRef ?? 1);
    expect(sprint).toBeLessThanOrEqual(sprout.runTimeScaleMax ?? 1.6);
  });

  it('the Sprout bites, and bursts out of its pod with Emerge once', () => {
    const def = WILDHEART_THORN_SPROUT_LOOK;
    expect(def.clips.attack).toEqual(['Bite']);
    expect(def.clips.entrance).toBe('Emerge');
    expect(def.entranceGesture).toBe(THORN_SPROUT_EMERGE_GESTURE);
    expect(def.oneShotsHoldAttacks).toContain('Emerge');
    // The pod splits on the Emerge clip's own burst frame.
    expect(bloomEventTrigger(BLOOM_SEED_SPROUT)).toBe('sprout');
    expect(gorgebloomBeats('sprout')).toEqual([
      { kind: 'sproutBurst', at: SPROUT_CLIP.emergeBurst },
    ]);
    // The gesture is offered past the burst frame (a view built a little late
    // still rises out of its pod).
    expect(THORN_SPROUT_EMERGE_WINDOW).toBeGreaterThan(0.2);
    expect(THORN_SPROUT_EMERGE_WINDOW).toBeLessThan(SPROUT_CLIP.emergeTall + 0.2);
  });
});

describe('the lash lane', () => {
  it('the tip lands inside the lane, the wave runs from the whip to its end', () => {
    const lane = lasherLane();
    expect(lane.length).toBe(MOBS.vine_lasher.trashKit?.line?.length);
    expect(Math.abs(LASHER_CLIP.lashTipImpact.x)).toBeLessThan(lane.halfWidth);
    const tip = lasherTipReach(LASHER_SIM_SCALE);
    expect(tip).toBeCloseTo(8.42, 6);
    expect(lasherWhipEnd(LASHER_SIM_SCALE)).toBeGreaterThan(tip);
    const stations = lasherWaveStations(LASHER_SIM_SCALE, []);
    expect(stations.length).toBeGreaterThanOrEqual(4);
    expect(stations[0]).toBeGreaterThan(lasherWhipEnd(LASHER_SIM_SCALE));
    expect(stations[stations.length - 1]).toBeLessThanOrEqual(lane.length);
    expect(stations[stations.length - 1]).toBeGreaterThan(lane.length - 3);
    const end = lasherWaveDelay(lane.length, LASHER_SIM_SCALE);
    expect(end).toBeCloseTo((lane.length - lasherWhipEnd(LASHER_SIM_SCALE)) / LASHER_WAVE_SPEED, 9);
    expect(end).toBeLessThan(0.3);
  });

  it('lane stations and delays: in order, none at the club, none past the end', () => {
    expect(laneWaveStations(8, 20, 3, [])).toEqual([11, 14, 17, 19.4]);
    expect(laneWaveStations(8, 20, 0, [])).toEqual([]);
    expect(laneWaveStations(25, 20, 2, [])).toEqual([]);
    expect(laneWaveDelay(14, 8, 60)).toBeCloseTo(0.1, 9);
    expect(laneWaveDelay(4, 8, 60)).toBe(0);
    expect(laneWaveDelay(14, 8, 0)).toBe(0);
  });
});
