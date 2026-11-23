import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';

const root = path.join(__dirname, '..', 'public', 'map_art');

// Zones whose painted plate has not been made yet. The Studio editor's map
// (loadMapArt) falls back to the procedural painter for them, and the game HUD
// keeps plates parked (GAME_MAP_ART_ENABLED in src/ui/map_art.ts). Delete a row
// when its plate lands; the stale-entry check below fails if one is forgotten.
const PLATE_PENDING = new Set<string>(['proving_shore']);

function platePath(id: string): string {
  return path.join(root, `${id}.png`);
}

function expectPaintedPng(id: string): void {
  const file = platePath(id);
  const bytes = fs.readFileSync(file);
  expect(bytes.byteLength, file).toBeGreaterThan(100_000);
  expect([...bytes.subarray(0, 8)], file).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}

describe('static painted map atlas', () => {
  it('ships a substantial PNG for the world and every zone', () => {
    expectPaintedPng('world');
    for (const zone of ZONES) {
      if (PLATE_PENDING.has(zone.id)) continue;
      expectPaintedPng(zone.id);
    }
  });

  it('lists only real zones that still lack a plate as pending', () => {
    const zoneIds = new Set(ZONES.map((zone) => zone.id));
    for (const id of PLATE_PENDING) {
      expect(zoneIds.has(id), `${id} is not a zone`).toBe(true);
      expect(
        fs.existsSync(platePath(id)),
        `${id} has a plate now; drop it from PLATE_PENDING`,
      ).toBe(false);
    }
  });
});
