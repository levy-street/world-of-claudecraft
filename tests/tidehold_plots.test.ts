// Tidehold housing plots: fewer, size-varied plots clear of every landmark,
// a for-sale sign at each gate, deeds priced by ground and closeness to the
// crown, and the sign's read/buy loop through the sim (Troy, 2026-09-08).
import { describe, expect, it } from 'vitest';
import { setActiveWorldContent } from '../src/sim/data';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import {
  PLOT_DIMS,
  plotPrice,
  RING_PLOT_DEEDS,
  RING_PLOT_SIGNS,
  RING_PLOTS,
  ringPlacements,
} from '../src/sim/deepglass/citadel_ring';
import { plotSignEntityId } from '../src/sim/plots';
import { Sim } from '../src/sim/sim';
import { PLOT_SIGN_TEMPLATE_ID } from '../src/sim/types';

describe('the plots and their signs', () => {
  it('lays a handful of plots in three sizes, one sign and one deed each', () => {
    expect(RING_PLOTS.length).toBeGreaterThanOrEqual(12);
    expect(RING_PLOTS.length).toBeLessThanOrEqual(20);
    expect(new Set(RING_PLOTS.map((p) => p.size))).toEqual(new Set(['small', 'medium', 'large']));
    expect(RING_PLOT_SIGNS.length).toBe(RING_PLOTS.length);
    expect(RING_PLOT_DEEDS.length).toBe(RING_PLOTS.length);
    expect(new Set(RING_PLOT_DEEDS.map((d) => d.name)).size).toBe(RING_PLOTS.length);
    const signs = ringPlacements().filter((p) => p.path === '/models/props/plot_sign.glb');
    expect(signs.length).toBe(RING_PLOTS.length);
    // every sign stands INSIDE its own plot, in the gate opening, and clear of
    // every other placement the city puts down (the verge carries clutter)
    RING_PLOT_SIGNS.forEach((s, i) => {
      const plot = RING_PLOTS[i];
      const c = { x: 0 + Math.sin(plot.phi) * plot.r, z: 495 + Math.cos(plot.phi) * plot.r };
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const along = dx * Math.cos(plot.phi) - dz * Math.sin(plot.phi);
      const radial = dx * Math.sin(plot.phi) + dz * Math.cos(plot.phi);
      expect(Math.abs(radial)).toBeLessThan(plot.d / 2);
      expect(Math.abs(radial)).toBeGreaterThan(plot.d / 2 - 1.5);
      expect(Math.abs(along)).toBeLessThan(plot.w / 2);
    });
    const others = ringPlacements().filter((p) => p.path !== '/models/props/plot_sign.glb');
    for (const s of RING_PLOT_SIGNS) {
      for (const p of others) {
        expect(Math.hypot(p.x - s.x, p.z - s.z), `${p.path} under a plot sign`).toBeGreaterThan(1.6);
      }
    }
  });

  it('prices by ground and by closeness to the crown', () => {
    const small = PLOT_DIMS.small;
    const large = PLOT_DIMS.large;
    expect(plotPrice({ r: 258, ...large })).toBeGreaterThan(plotPrice({ r: 258, ...small }));
    expect(plotPrice({ r: 118, ...small })).toBeGreaterThan(plotPrice({ r: 258, ...small }));
    for (const d of RING_PLOT_DEEDS) {
      expect(d.priceCopper % 50_000).toBe(0); // whole fives of gold
      // Sanity band, not a pin: the price is per square yard, so it moved with
      // the 2026-09-09 doubling of the plots (today ~185g to ~640g).
      expect(d.priceCopper).toBeGreaterThanOrEqual(50 * 10_000);
      expect(d.priceCopper).toBeLessThanOrEqual(1200 * 10_000);
    }
  });

  it('reads the deed at the sign and sells it once, saving the deed with the character', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true, world: buildDeepglassWorld() });
    const signId = plotSignEntityId(0);
    const sign = sim.entities.get(signId);
    expect(sign?.templateId).toBe(PLOT_SIGN_TEMPLATE_ID);
    if (!sign) return;
    const p = sim.entities.get(sim.primaryId)!;
    p.pos.x = sign.pos.x + 1.5;
    p.pos.z = sign.pos.z;
    p.pos.y = sign.pos.y;
    sim.drainEvents();
    expect(sim.pickUpObject(signId)).toBe(true);
    const read = sim.drainEvents().find((e) => e.type === 'plotSign');
    expect(read && read.type === 'plotSign' ? read.plot : null).toMatchObject({
      id: RING_PLOT_DEEDS[0].id,
      name: RING_PLOT_DEEDS[0].name,
      ownedByYou: false,
      ownerName: null,
    });
    // too poor
    expect(sim.buyPlot(RING_PLOT_DEEDS[0].id)).toBe(false);
    const meta = sim.meta(sim.primaryId)!;
    meta.copper = RING_PLOT_DEEDS[0].priceCopper + 123;
    sim.drainEvents();
    expect(sim.buyPlot(RING_PLOT_DEEDS[0].id)).toBe(true);
    expect(meta.copper).toBe(123);
    expect(meta.ownedPlots).toEqual([RING_PLOT_DEEDS[0].id]);
    const sold = sim.drainEvents().find((e) => e.type === 'plotSign');
    expect(sold && sold.type === 'plotSign' ? sold.plot : null).toMatchObject({ ownedByYou: true, ownerName: p.name });
    // a second sale is refused, the deed rides the character save
    expect(sim.buyPlot(RING_PLOT_DEEDS[0].id)).toBe(false);
    expect(sim.serializeCharacter(sim.primaryId)?.ownedPlots).toEqual([RING_PLOT_DEEDS[0].id]);
  });
});
