import { describe, expect, it } from 'vitest';
import { runOwnedHealerProbe } from '../scripts/owned_class_balance_probe';

// Part of the owned-class level 20 balance family (docs/qa-gate.md, "The
// long-sims lanes"). This file reads no diet flag: its probes run the same
// configuration at PR time and nightly.
describe('owned-class level 20 balance harness (Groveheart)', () => {
  it('counts Groveheart heal-over-time ticks in the effective-healing profile', () => {
    const groveheart = runOwnedHealerProbe('groveheart', 3, 29_913);

    expect(groveheart.healingBySource.Wildbloom).toBeGreaterThan(0);
    expect(groveheart.hps).toBeGreaterThan(0);
  });

  it('holds the Groveheart interim healer contract on both profiles', () => {
    // Single target: inside the peer envelope at the shared seed.
    const singlePeers = (['spiritmend', 'doctrine', 'benison'] as const).map(
      (spec) => runOwnedHealerProbe(spec, 1, 29_914).hps,
    );
    const single = runOwnedHealerProbe('groveheart', 1, 29_914).hps;
    expect(single).toBeGreaterThanOrEqual(Math.min(...singlePeers));
    expect(single).toBeLessThanOrEqual(Math.max(...singlePeers) * 1.15);

    // Group profile: INTERIM floor, not the envelope. The v0.31 healer
    // retunes lifted every peer's three-ally throughput while Groveheart
    // still carries its v0.29 values, and under the heavier pressure the
    // garden never plants (pure triage). Closing that gap is the flagged
    // PBE values pass for the druid stack; this floor only guards against
    // regressions below the measured interim state.
    const groupPeers = (['spiritmend', 'doctrine', 'benison'] as const).map(
      (spec) => runOwnedHealerProbe(spec, 3, 29_914).hps,
    );
    const group = runOwnedHealerProbe('groveheart', 3, 29_914).hps;
    expect(group).toBeGreaterThanOrEqual(Math.min(...groupPeers) * 0.45);
    expect(group).toBeLessThanOrEqual(Math.max(...groupPeers) * 1.15);

    // Absolute floors so the whole band cannot sink together unnoticed: the
    // agility-loadout regression measured 65.0 and 26.2 here.
    expect(single).toBeGreaterThanOrEqual(80);
    expect(group).toBeGreaterThanOrEqual(40);
  }, 300_000);
});
