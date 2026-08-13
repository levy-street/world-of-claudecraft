// Grix the Tunnelking's physical presence: he is a rare elite that summons the
// very mob he shares a zone with, so "how much bigger is he" is a relationship,
// not a loose number. Pinning the RATIO rather than the literal is the point: a
// future retune of the Deeprock Diggers must move him with them or fail here.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { scaledDefaultMobMeleeRange } from '../src/sim/mob_combat';
import { MELEE_RANGE } from '../src/sim/types';

describe('Grix the Tunnelking - physical presence against his own adds', () => {
  it('stands half again as large as the Deeprock Diggers he summons', () => {
    const grix = MOBS.grix_the_tunnelking;
    const digger = MOBS.tunnel_rat;
    expect(grix.summonAdds?.mobId).toBe('tunnel_rat'); // the adds really are his
    expect(digger.scale).toBeDefined();
    expect(grix.scale).toBeDefined();
    expect(grix.scale! / digger.scale!).toBeCloseTo(1.5, 6);
  });

  it('converts that size into real melee reach, not just a bigger silhouette', () => {
    const grix = MOBS.grix_the_tunnelking;
    const digger = MOBS.tunnel_rat;
    // scaledDefaultMobMeleeRange adds 3 yd per unit of scale ABOVE 1, so the
    // Digger (0.85) sits at the floor and Grix reaches past it.
    expect(scaledDefaultMobMeleeRange(digger.scale!)).toBe(MELEE_RANGE);
    expect(scaledDefaultMobMeleeRange(grix.scale!)).toBeCloseTo(MELEE_RANGE + 0.825, 6);
    expect(scaledDefaultMobMeleeRange(grix.scale!)).toBeGreaterThan(
      scaledDefaultMobMeleeRange(digger.scale!),
    );
  });

  it('keeps the rare-elite framing that makes the size read as a boss', () => {
    const grix = MOBS.grix_the_tunnelking;
    expect(grix.rare).toBe(true);
    expect(grix.elite).toBe(true);
    // a colour is still authored even though mob_grix renders untinted: the
    // nameplate/minimap surfaces read it (see the mob_grix note in manifest.ts)
    expect(grix.color).toBe(0xb9770e);
  });
});
