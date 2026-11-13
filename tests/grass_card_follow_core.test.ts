// Where a grass card follows the ground's colour (src/render/grass_card_follow_core.ts):
// wholly inside the marsh and the jungle, not at all in the other zones, and eased across a
// border with the ground palette's own window, so the cards never step where the ground
// they stand on blends.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cardFollowAt,
  STRIP_BLEND_LEAD_YD,
  STRIP_BLEND_SPAN_YD,
} from '../src/render/grass_card_follow_core';
import { ZONES } from '../src/sim/data';

const zone = (id: string) => {
  const found = ZONES.find((entry) => entry.id === id);
  if (!found) throw new Error(`no zone ${id}`);
  return found;
};

describe('grass card follow', () => {
  it('is whole in the marsh and the jungle and nothing in the zones round them', () => {
    expect(cardFollowAt(zone('mirefen_marsh').hub.x, zone('mirefen_marsh').hub.z)).toBe(1);
    expect(cardFollowAt(zone('palmreach').hub.x, zone('palmreach').hub.z)).toBe(1);
    for (const id of ['eastbrook_vale', 'thornpeak_heights', 'willowfen', 'galecrest']) {
      expect(cardFollowAt(zone(id).hub.x, zone(id).hub.z), id).toBe(0);
    }
  });

  it('eases across the Vale and marsh border with the palette window, never in a step', () => {
    const border = zone('eastbrook_vale').zMax;
    expect(zone('mirefen_marsh').zMin).toBe(border);
    expect(cardFollowAt(0, border - STRIP_BLEND_LEAD_YD)).toBe(0);
    expect(cardFollowAt(0, border - STRIP_BLEND_LEAD_YD + STRIP_BLEND_SPAN_YD)).toBe(1);
    // on the line itself the ground is 44% marsh, and so are the cards
    const t = STRIP_BLEND_LEAD_YD / STRIP_BLEND_SPAN_YD;
    expect(cardFollowAt(0, border)).toBeCloseTo(t * t * (3 - 2 * t), 12);
    expect(cardFollowAt(0, border)).toBeGreaterThan(0.4);
    expect(cardFollowAt(0, border)).toBeLessThan(0.5);
    let last = 0;
    let stepMax = 0;
    for (let z = border - 40; z <= border + 45; z += 0.5) {
      const w = cardFollowAt(0, z);
      expect(w).toBeGreaterThanOrEqual(last);
      stepMax = Math.max(stepMax, w - last);
      last = w;
    }
    expect(last).toBe(1);
    // half a yard never moves the cards by more than a hundredth and a half
    expect(stepMax).toBeLessThan(0.015);
  });

  it('eases into the jungle across its column border as well', () => {
    const palm = zone('palmreach');
    const z = (palm.zMin + palm.zMax) / 2;
    const edge = palm.xMax as number;
    const values: number[] = [];
    for (let x = edge - 60; x <= edge + 60; x += 1) values.push(cardFollowAt(x, z));
    expect(values[0]).toBe(1);
    expect(values[values.length - 1]).toBe(0);
    let stepMax = 0;
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      stepMax = Math.max(stepMax, values[i - 1] - values[i]);
    }
    expect(stepMax).toBeLessThan(0.05);
  });

  it('reads the same window the ground palette blends with, and feeds the tuft builder', () => {
    const terrain = readFileSync('src/render/terrain_chunk_build.ts', 'utf8');
    expect(terrain).toContain(
      `clamp01((z - (b - ${STRIP_BLEND_LEAD_YD})) / ${STRIP_BLEND_SPAN_YD})`,
    );
    const foliage = readFileSync('src/render/foliage.ts', 'utf8');
    expect(foliage).toContain(
      'grassCardTintRgb(c.r, c.g, c.b, accent, cardTint, cardGain, cardFollowAt(x, z));',
    );
  });
});
