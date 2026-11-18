import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mobVisualKey, VISUALS } from '../src/render/characters/manifest';
import { QUARTERED_ISLE_ZONE } from '../src/sim/content/quartered_isle';
import {
  QUARTERED_ISLE_CAMPS,
  QUARTERED_ISLE_MOBS,
  REMNANT_CAMP_CENTER,
} from '../src/sim/content/quartered_isle_mobs';
import { CAMPS, MOBS, PROPS, zoneAt } from '../src/sim/data';
import { dominantQuarterAt } from '../src/sim/quartered_quarters';
import { isleFissureAt } from '../src/sim/quartered_shatter';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The Quartered Isle's creatures (content/quartered_isle_mobs.ts). The Remnant of the
// First Colossus is the first: the Heavestone Wilds' named elite at the Fallen Giant.

describe('the Quartered Isle mobs', () => {
  it('register in the merged tables, camps appended last and offStream', () => {
    for (const [id, m] of Object.entries(QUARTERED_ISLE_MOBS)) expect(MOBS[id]).toBe(m);
    // appended after every shipped camp: a camp inserted mid-array would move every
    // later camp's world-gen draws
    expect(CAMPS.slice(-QUARTERED_ISLE_CAMPS.length)).toEqual(QUARTERED_ISLE_CAMPS);
    for (const c of QUARTERED_ISLE_CAMPS) expect(c.offStream, c.mobId).toBe(true);
  });

  it('are level 20, the zone cap', () => {
    for (const m of Object.values(QUARTERED_ISLE_MOBS)) {
      expect([m.minLevel, m.maxLevel]).toEqual(QUARTERED_ISLE_ZONE.levelRange);
    }
  });
});

describe('the Remnant of the First Colossus', () => {
  const m = QUARTERED_ISLE_MOBS.remnant_first_colossus;

  it('is a named elite on the level-20 named band (the Wreck Warden: base 155 + 34/level, 17 + 3.0/level)', () => {
    expect(m.elite).toBe(true);
    expect(m.family).toBe('elemental');
    expect([m.hpBase, m.hpPerLevel, m.dmgBase, m.dmgPerLevel]).toEqual([155, 34, 17, 3.0]);
    expect(MOBS.the_wreck_warden.hpBase).toBe(m.hpBase);
    expect(m.bodyRadius).toBeGreaterThan(1);
  });

  it('stands guard at the Fallen Giant, in the Heavestone Wilds, on dry plate ground', () => {
    const [camp] = QUARTERED_ISLE_CAMPS.filter((c) => c.mobId === m.id);
    expect(camp.count).toBe(1);
    const { x, z } = camp.center;
    expect(zoneAt(x, z).id).toBe('quartered_isle');
    expect(dominantQuarterAt(x, z)).toBe('earth');
    const giant = QUARTERED_ISLE_ZONE.pois?.find((p) => p.id === 'the_fallen_giant');
    expect(giant).toBeDefined();
    expect(Math.hypot(x - (giant?.x ?? 0), z - (giant?.z ?? 0))).toBeLessThan(20);
    expect(groundHeight(x, z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
    expect(isleFissureAt(x, z, 1)).toBe(0);
    expect(camp.center).toEqual(REMNANT_CAMP_CENTER);
  });

  it('spawns clear of every decor collider round the giant', () => {
    const [camp] = QUARTERED_ISLE_CAMPS.filter((c) => c.mobId === m.id);
    for (const d of PROPS.decorProps ?? []) {
      if (!d.r) continue;
      const gap = Math.hypot(d.x - camp.center.x, d.z - camp.center.z) - d.r - (m.bodyRadius ?? 1);
      expect(gap, `${d.key} at (${d.x}, ${d.z})`).toBeGreaterThan(1);
    }
  });

  it('draws its own shipped model, with every clip the game plays', () => {
    const key = mobVisualKey(m.id);
    expect(key).toBe('mob_remnant_first_colossus');
    const def = VISUALS[key];
    expect(def.url).toMatch(/remnant_first_colossus\.glb$/);
    expect(existsSync(resolve(__dirname, '../public', def.url.replace(/^\//, '')))).toBe(true);
    for (const clip of ['idle', 'walk', 'run', 'attack', 'hit', 'death'] as const) {
      expect(def.clips?.[clip], clip).toBeTruthy();
    }
  });
});
