import { describe, expect, it } from 'vitest';
import { PALADIN_AEGIS_DOME_RADIUS, PaladinAegisVisual } from '../src/render/paladin_aegis_visual';

describe('PaladinAegisVisual', () => {
  it('builds a readable dome, holy sun, planted weapon, and rotating runes', () => {
    const visual = new PaladinAegisVisual();
    visual.update(true, 0.5, true);

    expect(visual.group.visible).toBe(true);
    expect(PALADIN_AEGIS_DOME_RADIUS).toBe(10);
    expect(visual.group.getObjectByName('paladin-aegis-dome')).toBeTruthy();
    expect(visual.group.getObjectByName('paladin-aegis-sun')).toBeTruthy();
    expect(visual.group.getObjectByName('paladin-aegis-planted-weapon')).toBeTruthy();
    const firstRune = visual.group.getObjectByName('paladin-aegis-rune-1');
    if (!firstRune) throw new Error('missing first solar rune');
    const frozen = firstRune.position.clone();

    visual.update(true, 0.5, true);
    expect(firstRune.position.equals(frozen)).toBe(true);
    visual.update(true, 0.5, false);
    expect(firstRune.position.equals(frozen)).toBe(false);

    visual.update(true, 0.5, true, 1.9);
    expect(visual.group.scale.x).toBeCloseTo(1 / 1.9, 10);

    visual.update(false, 0.5, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });
});
