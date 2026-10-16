// The Fanglord Beastmaster on his Blender body (src/render/wildheart_basin/
// basin_trash_model_core.ts, src/render/characters/wildheart_creature_looks.ts,
// the gestures in basin_fx.ts): the shipped GLB carries every clip the look
// plays, he draws at his authored size over the sim's scale (a head over his
// jaguar), the Beast Pit Quake strikes on its bar's last frame, Call of the
// Hunt and Thickhide Ward play his own roar and ward, and the boss effects
// ride his real height.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { WILDHEART_BEASTMASTER_LOOK } from '../src/render/characters/wildheart_creature_looks';
import { bossBodyHeight } from '../src/render/wildheart_basin/basin_boss_fx_core';
import {
  BEASTMASTER_CLIP,
  BEASTMASTER_MODEL,
  BEASTMASTER_SIM_SCALE,
  beastmasterQuakeRate,
  trashLookHeight,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import { JAGUAR_MODEL } from '../src/render/wildheart_basin/jaguar_model_core';
import { MOBS } from '../src/sim/data';
import {
  BEAST_CALL_OF_THE_HUNT,
  BEAST_PIT_QUAKE,
  BEAST_THICKHIDE_WARD,
  BEAST_TUNING,
  BEASTMASTER_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
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

describe('the Fanglord Beastmaster', () => {
  it('wears his Blender body at its authored size, a head over his jaguar', () => {
    expect(VISUALS[key(BEASTMASTER_ID)]).toBe(WILDHEART_BEASTMASTER_LOOK);
    expect(MOBS[BEASTMASTER_ID].scale).toBe(BEASTMASTER_SIM_SCALE);
    const def = WILDHEART_BEASTMASTER_LOOK;
    expect(def.url).toBe(BEASTMASTER_MODEL.url);
    expect(def.height).toBeCloseTo(trashLookHeight(BEASTMASTER_MODEL, BEASTMASTER_SIM_SCALE), 9);
    expect(def.height * BEASTMASTER_SIM_SCALE).toBeCloseTo(
      BEASTMASTER_MODEL.idleTop - BEASTMASTER_MODEL.idleMin,
      9,
    );
    // A head over his jaguar's ears (its plumed headdress rises past them, to its withers' plumes).
    expect(BEASTMASTER_MODEL.idleTop).toBeGreaterThan(JAGUAR_MODEL.bondAnchor.up + 1);
    expect(BEASTMASTER_MODEL.idleTop).toBeGreaterThan(JAGUAR_MODEL.idleBoundsHeight);
    // The boss effects (the bond cord, the bursts) ride his real height (his drawn bounds,
    // a toe a hair under the ground).
    expect(bossBodyHeight(BEASTMASTER_ID, BEASTMASTER_SIM_SCALE)).toBeCloseTo(
      BEASTMASTER_MODEL.idleTop - BEASTMASTER_MODEL.idleMin,
      6,
    );
  });

  it('ships every clip the look plays, compressed', () => {
    const json = glbJson(BEASTMASTER_MODEL.url);
    const c = WILDHEART_BEASTMASTER_LOOK.clips;
    for (const clip of [
      c.idle,
      c.combatIdle,
      c.walk,
      c.run,
      c.death,
      c.cast,
      c.flourish,
      ...c.attack,
      ...(c.hit ?? []),
      ...Object.values(c.castByAbility ?? {}),
      ...Object.values(c.attackByAbility ?? {}),
    ]) {
      if (clip === undefined) continue;
      expect(clipLength(json, clip), clip).toBeGreaterThan(0.5);
    }
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(statSync(`public/${BEASTMASTER_MODEL.url}`).size).toBeLessThan(3.5 * 1024 * 1024);
    const names = new Set(json.nodes.map((n) => n.name));
    for (const bone of ['Weapon', 'Head', 'Jaw', 'Cape1', 'Cape3'])
      expect(names.has(bone), bone).toBe(true);
    expect(clipLength(json, 'Quake')).toBeGreaterThan(BEASTMASTER_CLIP.quakeStrike);
  });

  it("strikes the pit floor on the Beast Pit Quake bar's last frame", () => {
    const c = WILDHEART_BEASTMASTER_LOOK.clips;
    expect(c.castByAbility?.[BEAST_PIT_QUAKE]).toBe('Quake');
    const rate = c.castTimeScaleByAbility?.[BEAST_PIT_QUAKE] ?? 1;
    expect(rate).toBeCloseTo(beastmasterQuakeRate(BEAST_TUNING.quakeCast), 9);
    expect(BEAST_TUNING.quakeCast * rate).toBeCloseTo(BEASTMASTER_CLIP.quakeStrike, 9);
    expect(c.castPlayOut).toContain('Quake');
    expect(WILDHEART_BEASTMASTER_LOOK.castClipSync).toBe(true);
  });

  it('roars Call of the Hunt and wards his jaguar with his own clips', () => {
    const c = WILDHEART_BEASTMASTER_LOOK.clips;
    expect(c.attackByAbility?.[BEAST_CALL_OF_THE_HUNT]).toBe('WarCry');
    expect(c.attackByAbility?.[BEAST_THICKHIDE_WARD]).toBe('Ward');
    expect(WILDHEART_BEASTMASTER_LOOK.oneShotsHoldAttacks).toEqual(['WarCry', 'Ward']);
  });

  it('plays his gaits near 1x at the sim speed', () => {
    const run = (MOBS[BEASTMASTER_ID].moveSpeed ?? 6) / (WILDHEART_BEASTMASTER_LOOK.runRef ?? 1);
    expect(run).toBeGreaterThan(0.9);
    expect(run).toBeLessThan(1.3);
  });
});
