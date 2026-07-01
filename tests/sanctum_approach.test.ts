import { describe, expect, it } from 'vitest';
import { ZONE3_CAMPS } from '../src/sim/content/zone3';
import { MOBS } from '../src/sim/data';

// The Gravewyrm Sanctum gate sits at (0, 880) and the "Sanctum Approach" road
// runs straight up the x=0 corridor to z=860. Players must be able to walk that
// last stretch and step in/out of the instance without a camp aggroing them, so
// no camp may be able to spawn a mob within its aggroRadius of the corridor or
// the gate. (A camp spawns mobs within `radius` of its center, so the closest a
// mob can ever be to a point P is dist(center, P) - radius.)
const GATE = { x: 0, z: 880 };
// Sample the central approach from where the camps cluster up to the gate.
const APPROACH = Array.from({ length: 17 }, (_, i) => ({ x: 0, z: 800 + i * 5 }));
const POINTS = [...APPROACH, GATE];

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('Gravewyrm Sanctum approach is a clear walk', () => {
  it('no Thornpeak camp can aggro a player on the x=0 approach road or at the gate', () => {
    const offenders: string[] = [];
    for (const camp of ZONE3_CAMPS) {
      const aggro = MOBS[camp.mobId]?.aggroRadius;
      if (aggro == null) continue;
      for (const p of POINTS) {
        const nearestSpawn = dist(camp.center, p) - camp.radius;
        if (nearestSpawn <= aggro) {
          offenders.push(
            `${camp.mobId} @ (${camp.center.x},${camp.center.z}) r${camp.radius} can reach (${p.x},${p.z}) within aggro ${aggro} (nearest ${nearestSpawn.toFixed(1)})`,
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('still has both Boneclad Revenant packs, in the western Revenant Fields off the corridor', () => {
    const revenants = ZONE3_CAMPS.filter((c) => c.mobId === 'boneclad_revenant');
    expect(revenants).toHaveLength(2);
    for (const camp of revenants) {
      // West of the corridor and its eastern edge clears the x=0 road by margin.
      expect(camp.center.x).toBeLessThan(0);
      expect(camp.center.x + camp.radius).toBeLessThan(-(MOBS.boneclad_revenant.aggroRadius ?? 11));
    }
  });
});
