import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';

const root = path.join(__dirname, '..', 'public', 'map_art');

function expectPaintedPng(id: string): void {
  const file = path.join(root, `${id}.png`);
  const bytes = fs.readFileSync(file);
  expect(bytes.byteLength, file).toBeGreaterThan(100_000);
  expect([...bytes.subarray(0, 8)], file).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}

describe('static painted map atlas', () => {
  it('ships a substantial PNG for the world and every zone', () => {
    expectPaintedPng('world');
    for (const zone of ZONES) expectPaintedPng(zone.id);
  });
});
