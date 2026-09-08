import { describe, expect, it } from 'vitest';
import { classCastPoint } from '../src/render/ability_vfx/ritual_choreography_core';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { ABILITIES } from '../src/sim/data';

describe('canonical class visual languages', () => {
  it('reserves the cast-circle language for Mage across the real ability catalogue', () => {
    const styles = new Map<string, Set<string>>();
    for (const def of Object.values(ABILITIES)) {
      const spec = abilityVfxFullSpec(def.id);
      if (!spec?.castIdentity || !def.class) continue;
      if (spec.windupStyle === 'runes') expect(def.class).toBe('mage');
      if (!styles.has(def.class)) styles.set(def.class, new Set());
      styles.get(def.class)!.add(spec.castIdentity);
      if (def.class === 'hunter' || def.class === 'priest') {
        expect(spec.impact?.ring).toBe(false);
        expect(spec.impact?.vRing).toBe(false);
      }
    }
    const castingClasses = ['mage', 'priest', 'shaman', 'druid', 'paladin', 'warlock', 'hunter'];
    expect(new Set(castingClasses.map((cls) => [...styles.get(cls)!].join(','))).size).toBe(7);
  });
  it('has distinct open silhouettes at the same colour and scale', () => {
    const shapes = ['quiver', 'scripture', 'conduction', 'bough', 'solar', 'occult'].map(
      (style) => {
        const p = { x: 0, y: 0, z: 0 },
          points: number[][] = [];
        for (let j = 0; j < 12; j++) {
          classCastPoint(style, j / 11, 0, 0.7, p);
          expect(Object.values(p).every(Number.isFinite)).toBe(true);
          points.push(Object.values(p));
        }
        expect(points[0]).not.toEqual(points[11]);
        return JSON.stringify(points);
      },
    );
    expect(new Set(shapes).size).toBe(6);
  });
  it('Moonwing has no bear summon and Thunder Ward has no rune, shell or stars', () => {
    const moon = abilityVfxFullSpec('moonkin_form')!;
    expect(moon.spirit).toBeNull();
    expect(moon.buff?.orbit).toBe('leaves');
    expect(moon.buff?.persist).toBe(true);
    const ward = abilityVfxFullSpec('lightning_shield')!;
    expect(ward.decal).toBeUndefined();
    expect(ward.buff?.shellDur).toBeUndefined();
    expect(ward.buff?.orbit).toBe('wardCharges');
    expect(ward.ritual?.shape).toBe('storm');
  });
});
