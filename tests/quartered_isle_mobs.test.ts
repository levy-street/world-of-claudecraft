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
    // the band's swing, armour and pace too (the Wreck Warden, the Pale Huntsman, the
    // Topiary Bull): 2.2 to 2.3 s, 17 armour a level, 8 to 8.5 yd/s
    expect(m.attackSpeed).toBeGreaterThanOrEqual(2.2);
    expect(m.attackSpeed).toBeLessThanOrEqual(2.3);
    expect(m.armorPerLevel).toBe(17);
    expect(m.moveSpeed).toBeGreaterThanOrEqual(8);
    expect(m.moveSpeed).toBeLessThanOrEqual(8.5);
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

describe('every Quartered Isle camp', () => {
  const quarterOf: Record<string, string> = {
    quench_shardling: 'ice',
    rimeglass_bear: 'ice',
    warden_of_the_quench: 'ice',
    heatsworn_ember: 'fire',
    cinderscar_caller: 'fire',
    ember_hound: 'fire',
    the_glassfield_brute: 'fire',
    heaved_shardling: 'earth',
    veinback_burrower: 'earth',
    remnant_first_colossus: 'earth',
  };

  it('puts every isle mob in a camp of its own quarter, named elites alone', () => {
    expect(Object.keys(quarterOf).sort()).toEqual(Object.keys(QUARTERED_ISLE_MOBS).sort());
    for (const id of Object.keys(QUARTERED_ISLE_MOBS)) {
      const camps = QUARTERED_ISLE_CAMPS.filter((c) => c.mobId === id);
      expect(camps.length, id).toBeGreaterThan(0);
      for (const c of camps) {
        expect(dominantQuarterAt(c.center.x, c.center.z), `${id} at ${c.center.x}`).toBe(
          quarterOf[id],
        );
        if (QUARTERED_ISLE_MOBS[id].elite) expect(c.count, id).toBe(1);
      }
    }
  });

  it('stands on dry plate ground, off the crater ring and the town', () => {
    const hub = QUARTERED_ISLE_ZONE.hub;
    for (const c of QUARTERED_ISLE_CAMPS) {
      const { x, z } = c.center;
      const at = `${c.mobId} at (${x}, ${z})`;
      expect(zoneAt(x, z).id, at).toBe('quartered_isle');
      expect(groundHeight(x, z, WORLD_SEED), at).toBeGreaterThan(WATER_LEVEL + 1);
      expect(isleFissureAt(x, z, 1), at).toBe(0);
      // clear of the Challengers' Ring (the King of the Hill arena) and of Rivalmoot
      expect(Math.hypot(x, z - 2122), at).toBeGreaterThan(70);
      expect(Math.hypot(x - hub.x, z - hub.z), at).toBeGreaterThan(40);
    }
  });

  it('draws every mob through a shipped body', () => {
    for (const id of Object.keys(QUARTERED_ISLE_MOBS)) {
      const def = VISUALS[mobVisualKey(id)];
      expect(def, id).toBeDefined();
      const file = resolve(__dirname, '../public', def.url.replace(/^\//, ''));
      expect(existsSync(file), id).toBe(true);
    }
  });

  it('keeps regulars on the open-ground band and named elites on the named band', () => {
    for (const mob of Object.values(QUARTERED_ISLE_MOBS)) {
      if (mob.elite) {
        expect([mob.hpBase, mob.hpPerLevel, mob.dmgBase, mob.dmgPerLevel], mob.id).toEqual([
          155, 34, 17, 3.0,
        ]);
        continue;
      }
      expect(mob.hpBase, mob.id).toBeGreaterThanOrEqual(52);
      expect(mob.hpBase, mob.id).toBeLessThanOrEqual(58);
      expect(mob.hpPerLevel, mob.id).toBeGreaterThanOrEqual(18);
      expect(mob.hpPerLevel, mob.id).toBeLessThanOrEqual(19);
      expect(mob.dmgBase, mob.id).toBeGreaterThanOrEqual(11);
      expect(mob.dmgBase, mob.id).toBeLessThanOrEqual(12);
      expect(mob.loot, mob.id).toEqual([{ copper: 105, chance: 1 }]);
    }
  });
});
