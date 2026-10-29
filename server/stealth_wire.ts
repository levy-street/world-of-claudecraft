// The Stealth Rework's snapshot suffixes behind ONE broadcast call site
// (server/game.ts sits at its monolith ceiling): the lagged footprints (`sfp`,
// stealth_footprint_wire.ts) and the shimmer band (`ssh`,
// stealth_shimmer_wire.ts). Each keeps its own rules and pacing; this only
// builds both once per pass and joins the two suffixes per viewer.

import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { StealthFootprintWire } from './stealth_footprint_wire';
import { type ShimmerSentSet, StealthShimmerWire } from './stealth_shimmer_wire';

export class StealthWire {
  private readonly footprints: StealthFootprintWire;
  private readonly shimmers: StealthShimmerWire;

  constructor(sim: Sim) {
    this.footprints = new StealthFootprintWire(sim);
    this.shimmers = new StealthShimmerWire(sim);
  }

  beginBroadcast(): this {
    this.footprints.beginBroadcast();
    this.shimmers.beginBroadcast();
    return this;
  }

  suffixFor(
    viewer: Entity,
    session: { lastSent: Record<string, string>; sentEnts: ShimmerSentSet },
  ): string {
    return (
      this.footprints.suffixFor(viewer, session.lastSent) +
      this.shimmers.suffixFor(viewer, session.lastSent, session.sentEnts)
    );
  }
}
