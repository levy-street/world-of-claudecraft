// The private scatter stream for an `offStream` camp (see CampDef.offStream),
// moved verbatim out of sim.ts (monolith ratchet). Seeded from the world seed
// plus the camp's AUTHORED identity (mob id, centre, radius, count) and the
// index WITHIN that camp, never the camp's position in the CAMPS array, so
// reordering or inserting camps cannot move an existing one. Pure and
// wall-clock-free, so offline, server and headless all place these spawns
// identically.

import { Rng } from './rng';
import type { CampDef } from './types';

export function campPrivateRng(seed: number, camp: CampDef, index: number): Rng {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  const mix = (n: number): void => {
    h = (h ^ (n >>> 0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < camp.mobId.length; i++) mix(camp.mobId.charCodeAt(i));
  // Quantized so a float re-authored to the same place cannot drift the seed.
  mix(Math.round(camp.center.x * 100));
  mix(Math.round(camp.center.z * 100));
  mix(Math.round(camp.radius * 100));
  mix(camp.count);
  mix(index);
  return new Rng(h >>> 0);
}
