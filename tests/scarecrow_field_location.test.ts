import { afterEach, describe, expect, it } from 'vitest';
import { PATCH_PUMPKIN_SITES } from '../src/sim/content/gourdlight_eve_dailies';
import { THATCHGRIN_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import { resolvePatchPumpkinSites } from '../src/sim/seasonal_daily_sites';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { resolveSeasonalDecor, SCARECROW_FIELD_RING } from '../src/sim/seasonal_decor_layout';
import { Sim } from '../src/sim/sim';
import { groundHeight, isCliffFace } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const centre = { x: 119, z: -71 };
afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

describe('Thatchgrin at the relocated pumpkin patch', () => {
  it('spawns and respawns the boss at the requested centre', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    expect(resolveScarecrowField(WORLD_SEED)).toMatchObject(centre);
    for (const command of ['/dev scarecrow', '/dev scarecrow reset']) {
      sim.chat(command);
      sim.tick();
      const boss = [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID);
      expect(boss?.pos).toMatchObject(centre);
      expect(boss?.pos.y).toBeCloseTo(groundHeight(centre.x, centre.z, WORLD_SEED), 5);
    }
  });

  it('moves the decoration ring and daily pumpkins with the boss on walkable ground', () => {
    const decor = resolveSeasonalDecor(WORLD_SEED).ground.filter((p) =>
      p.anchor.startsWith('field:'),
    );
    expect(decor.length).toBeGreaterThanOrEqual(12);
    for (const piece of decor) {
      const distance = Math.hypot(piece.x - centre.x, piece.z - centre.z);
      expect(distance, piece.anchor).toBeGreaterThanOrEqual(SCARECROW_FIELD_RING.inner - 3);
      expect(distance, piece.anchor).toBeLessThanOrEqual(SCARECROW_FIELD_RING.outer + 3);
      expect(piece.y).toBeCloseTo(groundHeight(piece.x, piece.z, WORLD_SEED), 5);
    }
    const pumpkins = resolvePatchPumpkinSites(WORLD_SEED);
    expect(pumpkins.length).toBeGreaterThanOrEqual(5);
    for (const p of pumpkins) {
      const distance = Math.hypot(p.x - centre.x, p.z - centre.z);
      expect(distance).toBeGreaterThanOrEqual(PATCH_PUMPKIN_SITES.ring[0]);
      expect(distance).toBeLessThanOrEqual(PATCH_PUMPKIN_SITES.ring[1]);
    }
    // Sample the whole fighting disc, not only the handful of resolver spokes.
    for (let dx = -12; dx <= 12; dx += 2) {
      for (let dz = -12; dz <= 12; dz += 2) {
        if (Math.hypot(dx, dz) <= 12)
          expect(isCliffFace(centre.x + dx, centre.z + dz, WORLD_SEED)).toBe(false);
      }
    }
  });
});
