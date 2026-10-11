import { describe, expect, it } from 'vitest';
import { TREASURE_MAP_RARITIES } from '../src/sim/content/treasure_maps';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { HOARD_TIDE_WAVE_HALF_DEPTH } from '../src/sim/rift/hoard_boss_kits';
import {
  tideExitClear,
  tideFloorBlocked,
  tideLaneColliders,
  tideLaneFits,
} from '../src/sim/rift/hoard_tide_fit';
import { hoardTidePattern } from '../src/sim/rift/hoard_tide_pattern';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { makeVaultSeed, VAULT_ZONE_IDS, type VaultSizeTier } from '../src/sim/rift/vault_seed';

describe('tide volleys fit actual generated hoard arenas', () => {
  for (const [tier, rarity] of TREASURE_MAP_RARITIES.entries()) {
    it(`${rarity}: a lane that is laid can always be left sideways, and most lanes are laid`, () => {
      const failures: string[] = [];
      let judged = 0;
      let lanes = 0;
      let laid = 0;
      for (let random = 0; random < 8; random++) {
        const seed = makeVaultSeed(tier as VaultSizeTier, random, {
          open: tier >= 2,
          zoneId: VAULT_ZONE_IDS[random % VAULT_ZONE_IDS.length],
        });
        const floor = generateRiftFloor(seed, 23, 0);
        const boss = floor.spawns.find((spawn) => spawn.boss)!;
        const colliders = layoutColliders(floor.layout);
        // A volley is laid round a PLAYER: aim points all over the fight's floor.
        for (let ax = -12; ax <= 12; ax += 6) {
          for (let az = -24; az <= 0; az += 6) {
            const aimX = boss.x + ax;
            const aimZ = boss.z + az;
            if (tideFloorBlocked(colliders, aimX, aimZ)) continue;
            for (const wave of hoardTidePattern(seed ^ (ax * 31 + az), rarity, true)) {
              lanes++;
              const x = aimX + wave.dx;
              const z = aimZ + wave.dz;
              if (!tideLaneFits(colliders, x, z, wave)) continue;
              laid++;
              const near = tideLaneColliders(colliders, x, z, wave);
              // Judged again on a FINER grid than the check itself walks.
              const cos = Math.cos(wave.facing);
              const sin = Math.sin(wave.facing);
              const extent = wave.radius / 2 + HOARD_TIDE_WAVE_HALF_DEPTH;
              for (let along = -extent; along <= extent; along += 0.75) {
                for (let lateral = -wave.span; lateral <= wave.span; lateral += 0.75) {
                  const px = x + lateral * cos + along * sin;
                  const pz = z - lateral * sin + along * cos;
                  if (tideFloorBlocked(near, px, pz)) continue;
                  judged++;
                  if (
                    !tideExitClear(near, px, pz, cos, sin, lateral, wave.span, 1) &&
                    !tideExitClear(near, px, pz, cos, sin, lateral, wave.span, -1)
                  )
                    failures.push(
                      `seed=${seed} aim=${ax},${az} facing=${wave.facing} at ${px},${pz}`,
                    );
                }
              }
            }
          }
        }
      }
      expect(judged).toBeGreaterThan(1000);
      // The check never starves the fight of its waves.
      expect(laid / lanes).toBeGreaterThan(0.6);
      expect(failures.length / judged, failures.slice(0, 6).join(' | ')).toBeLessThan(0.002);
    }, 60_000);
  }
});
