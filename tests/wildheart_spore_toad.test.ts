// The Spore Toad on its Blender body (src/render/wildheart_basin/
// basin_trash_model_core.ts, src/render/characters/wildheart_creature_looks.ts,
// the tongue's mouth in basin_trash_fx_core.ts): the shipped GLB carries every
// clip the look plays and its spore glow, it draws at its authored size over
// the sim's scale (over a player's head), the Snaring Tongue's jaws fly open
// on the bar's last frame where the fx tongue leaves the model's own mouth, its
// death bursts its puffballs as the spore cloud rises, and the Toad Hex wears
// the same body at a player's knee.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  WILDHEART_MOB_KEYS,
  WILDHEART_SPORE_TOAD_LOOK,
} from '../src/render/characters/wildheart_creature_looks';
import {
  TOAD_MOUTH,
  TRASH_BODY_HEIGHT,
  toadMouthInto,
  trashCastClipRate,
} from '../src/render/wildheart_basin/basin_trash_fx_core';
import {
  TOAD_CLIP,
  TOAD_MODEL,
  TOAD_SIM_SCALE,
  trashLookHeight,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import { MOBS } from '../src/sim/data';
import { SPORE_TOAD_ID } from '../src/sim/encounters/wildheart_basin/ids';
import { WILDHEART_SNARING_TONGUE } from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  meshes: { primitives: { indices?: number }[] }[];
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

function tris(json: GlbJson): number {
  let n = 0;
  for (const m of json.meshes)
    for (const p of m.primitives)
      if (p.indices !== undefined) n += json.accessors[p.indices].count / 3;
  return n;
}

const key = (templateId: string) => visualKeyFor({ kind: 'mob', templateId } as unknown as Entity);
const DRAWN = TOAD_MODEL.idleTop - TOAD_MODEL.idleMin;

describe('the Spore Toad', () => {
  it('maps the template to its Blender body at its authored size', () => {
    expect(key(SPORE_TOAD_ID)).toBe('wildheart_spore_toad');
    expect(WILDHEART_MOB_KEYS[SPORE_TOAD_ID]).toBe('wildheart_spore_toad');
    expect(VISUALS.wildheart_spore_toad).toBe(WILDHEART_SPORE_TOAD_LOOK);
    expect(MOBS[SPORE_TOAD_ID].scale).toBe(TOAD_SIM_SCALE);
    const def = WILDHEART_SPORE_TOAD_LOOK;
    expect(def.url).toBe(TOAD_MODEL.url);
    expect(def.height).toBeCloseTo(trashLookHeight(TOAD_MODEL, TOAD_SIM_SCALE), 9);
    expect(def.height * TOAD_SIM_SCALE).toBeCloseTo(DRAWN, 9);
    expect((def.hover ?? 0) * TOAD_SIM_SCALE).toBeCloseTo(TOAD_MODEL.idleMin, 9);
    // Imposing, never toy-like: its eyes over a 2.6 yd player's head.
    expect(TOAD_MODEL.eyes).toBeGreaterThan(2.6 * 1.25);
    expect(TRASH_BODY_HEIGHT[SPORE_TOAD_ID]).toBeCloseTo(def.height, 9);
  });

  it('ships every clip the look plays, one glowing material, compressed', () => {
    const json = glbJson(TOAD_MODEL.url);
    const c = WILDHEART_SPORE_TOAD_LOOK.clips;
    for (const clip of [
      c.idle,
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
    expect(json.materials.map((m) => m.name)).toEqual(['SporeToadBody']);
    expect(json.materials[0].emissiveTexture).toBeDefined();
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(tris(json)).toBeLessThan(24_000);
    expect(statSync(`public/${TOAD_MODEL.url}`).size).toBeLessThan(3.5 * 1024 * 1024);
    const names = new Set(json.nodes.map((n) => n.name));
    for (const bone of ['Head', 'Jaw', 'Throat', 'Tongue', 'Sac1', 'Sac2', 'Sac3'])
      expect(names.has(bone), bone).toBe(true);
  });

  it("opens its jaws on the Snaring Tongue's bar end and finishes the reel", () => {
    const c = WILDHEART_SPORE_TOAD_LOOK.clips;
    const bar = MOBS[SPORE_TOAD_ID].trashKit?.wildheart?.tongue?.castTime ?? 0;
    expect(bar).toBeGreaterThan(0);
    expect(c.castByAbility?.[WILDHEART_SNARING_TONGUE]).toBe('Tongue');
    const rate = c.castTimeScaleByAbility?.[WILDHEART_SNARING_TONGUE] ?? 1;
    expect(rate).toBeCloseTo(trashCastClipRate(WILDHEART_SNARING_TONGUE), 9);
    expect(bar * rate).toBeCloseTo(TOAD_CLIP.tongueFire, 9);
    // The jaws stay wide through the reel as a play-out, the swings held.
    expect(c.castPlayOut).toContain('Tongue');
    expect(WILDHEART_SPORE_TOAD_LOOK.castPlayOutHoldsAttacks).toBe(true);
    expect(clipLength(glbJson(TOAD_MODEL.url), 'Tongue')).toBeGreaterThan(TOAD_CLIP.tongueShut);
  });

  it("lets the fx tongue leave the model's own mouth", () => {
    expect(TOAD_MOUTH.up * DRAWN).toBeCloseTo(TOAD_MODEL.mouth.up, 9);
    expect(TOAD_MOUTH.forward * DRAWN).toBeCloseTo(TOAD_MODEL.mouth.forward, 9);
    const out = toadMouthInto({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, TOAD_SIM_SCALE);
    expect(out.y).toBeCloseTo(TOAD_MODEL.mouth.up, 6);
    expect(out.z).toBeCloseTo(TOAD_MODEL.mouth.forward, 6);
  });

  it('bursts its puffballs about as its spore cloud rises', () => {
    const rate = WILDHEART_SPORE_TOAD_LOOK.deathTimeScale ?? 1;
    const burstAt = TOAD_CLIP.burst / rate;
    expect(burstAt).toBeGreaterThan(0.3);
    expect(burstAt).toBeLessThan(0.9);
    expect(clipLength(glbJson(TOAD_MODEL.url), 'Death')).toBeGreaterThan(TOAD_CLIP.flat);
  });

  it('plays its gaits near 1x at the sim speeds', () => {
    const run = (MOBS[SPORE_TOAD_ID].moveSpeed ?? 6) / (WILDHEART_SPORE_TOAD_LOOK.runRef ?? 1);
    expect(run).toBeGreaterThan(0.85);
    expect(run).toBeLessThan(1.3);
  });

  it('the Toad Hex wears the same body at a player knee', () => {
    const toad = VISUALS.form_toad;
    expect(toad?.url).toBe(TOAD_MODEL.url);
    expect(toad?.height ?? 99).toBeLessThan(2.6);
    expect(toad?.clips.idle).toBe(WILDHEART_SPORE_TOAD_LOOK.clips.idle);
  });
});
