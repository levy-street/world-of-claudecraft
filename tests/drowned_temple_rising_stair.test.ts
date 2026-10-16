// The Drowned Temple's stair and bridge after the Hydra and the Colossus
// (src/render/drowned_temple/temple_rising_stair_core.ts): the Prism Stair that
// rises from the lagoon is drawn by the field's own ground painter, so its
// drawn top is the walked floor (it used to be a white flight of loose boxes
// whose treads stood up to a step above the walked ramp), with balustrades on
// both sides; the Moonbridge's planks span only the open water.

import { describe, expect, it } from 'vitest';
import { drawnTopAt, planFieldTops } from '../src/render/authored_field/field_mesh_core';
import {
  moonbridgeSpan,
  planMoonbridgeEdges,
  planRisingStairEdges,
  RISING_STAIR_ID,
  risingStairField,
} from '../src/render/drowned_temple/temple_rising_stair_core';
import {
  DROWNED_TEMPLE_FIELD,
  MOONBRIDGE,
  PRISM_TERRACE,
} from '../src/sim/content/drowned_temple_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

const path = DROWNED_TEMPLE_FIELD.surfaces.find((s) => s.id === RISING_STAIR_ID);

describe('the Prism Stair rising out of the lagoon', () => {
  const tops = planFieldTops(risingStairField(), { maxEdge: 3, layerLift: 0 });

  it('is drawn in the field’s flagstone, like every other stair', () => {
    expect(tops.stone.positions.length).toBeGreaterThan(0);
    expect(tops.soil.positions.length).toBe(0);
  });

  it('draws its tread exactly where a body walks, the whole way up', () => {
    if (path?.kind !== 'path') throw new Error('no rising stair');
    const [, a, b] = path.points;
    let worst = 0;
    let samples = 0;
    for (let t = 0.02; t <= 0.98; t += 0.04) {
      for (const side of [-3.5, 0, 3.5]) {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        const x = a[0] + dx * t + (dz / len) * side;
        const z = a[1] + dz * t - (dx / len) * side;
        const drawn = drawnTopAt(tops.stone, x, z);
        if (Number.isNaN(drawn)) continue;
        samples++;
        worst = Math.max(worst, Math.abs(drawn - authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, z)));
      }
    }
    expect(samples).toBeGreaterThan(50);
    expect(worst).toBeLessThan(0.1);
  });

  it('rails both sides with balustrades, never across its ends', () => {
    const edges = planRisingStairEdges();
    expect(edges.length).toBeGreaterThanOrEqual(8);
    expect(edges.every((e) => e.piece === 'Kit_Balustrade')).toBe(true);
  });
});

describe('the Moonbridge', () => {
  it('spans the open water only: from the Prism Terrace’s rim to the Altar Landing', () => {
    const span = moonbridgeSpan();
    const rim = PRISM_TERRACE.x - PRISM_TERRACE.r;
    expect(span.fromX).toBeLessThanOrEqual(rim + 0.01);
    expect(span.toX).toBe(40);
    // Balustrades both sides, the whole way.
    const rails = planMoonbridgeEdges();
    expect(rails.filter((e) => e.z > MOONBRIDGE.z).length).toBeGreaterThanOrEqual(4);
    expect(rails.filter((e) => e.z < MOONBRIDGE.z).length).toBeGreaterThanOrEqual(4);
    // Its deck is the walked deck.
    for (let x = span.toX + 1; x < span.fromX; x += 2) {
      expect(span.deckAt(x)).toBeCloseTo(
        authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, MOONBRIDGE.z),
        1,
      );
    }
  });
});
