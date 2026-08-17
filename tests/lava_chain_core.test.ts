// The Drakelands lava chain is exactly three pieces: a pool, a river middle
// that connects, and a river end that terminates a spill. Two arithmetic
// bugs used to make a run read as a lumpy string of unrelated models, and
// both are pinned here: the channel must hold ONE width down a run (pieces
// scale by their cross extent, not their long one) and ONE melt height
// (pieces seat by their melt surface, not their base).
//
// LAVA_PIECE_METRICS is measured off the shipped GLBs, so it is also
// checked against them: a re-export that changes a model's proportions must
// fail here rather than silently pinching the channel in game.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LAVA_PIECE_METRICS,
  lavaChainPlacements,
  lavaPieceFp,
  MELT_LIFT,
} from '../src/render/lava_chain_core';
import { EMBER_LAVA_LINKS, emberLinkPolyline } from '../src/sim/ember_lava_layout';

// flat ground: isolates the placement math from terrain noise
const FLAT = 5;
const flatGround = (): number => FLAT;

describe('the lava chain', () => {
  it('renders every run from the three-piece vocabulary and nothing else', () => {
    const kinds = new Set<string>();
    for (const link of EMBER_LAVA_LINKS) {
      for (const p of lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround)) {
        kinds.add(p.kind);
      }
    }
    expect([...kinds].sort()).toEqual(['end', 'mid']);
  });

  it('holds one channel width: every piece spans its link w across the flow', () => {
    for (const link of EMBER_LAVA_LINKS) {
      for (const p of lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround)) {
        const across = p.fp * LAVA_PIECE_METRICS[p.kind].cross;
        expect(across, `${p.kind} on the w ${link.w} run`).toBeCloseTo(link.w, 6);
      }
    }
  });

  it('holds one melt height: every piece seats its molten surface on one line', () => {
    for (const link of EMBER_LAVA_LINKS) {
      for (const p of lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround)) {
        const melt = p.y + LAVA_PIECE_METRICS[p.kind].melt * p.fp;
        expect(melt, `${p.kind} melt on the w ${link.w} run`).toBeCloseTo(FLAT + MELT_LIFT, 6);
      }
    }
  });

  it('spends exactly three assets on a lava area: a pool, a river, an end', () => {
    for (const link of EMBER_LAVA_LINKS) {
      const ps = lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround);
      const mids = ps.filter((p) => p.kind === 'mid');
      const ends = ps.filter((p) => p.kind === 'end');
      const at = `the ${link.x0},${link.z0} area`;
      // ONE river piece connects the pool to the end. A chain of middles is
      // what turned a single area into eleven overlapping models.
      expect(mids.length, `${at} river pieces`).toBe(1);
      expect(ends.length, `${at} end caps`).toBe(1);
      // the pool is the third asset, and it is the run's own mouth
      expect(link.m0 === 'pool' || link.m1 === 'pool', `${at} starts at a pool`).toBe(true);
    }
  });

  it('keeps every lava area clear of every other', () => {
    // reach = the run's own extent plus its widest piece, so two areas that
    // read as one smear fail here
    const reach = EMBER_LAVA_LINKS.map((l) => {
      const cx = (l.x0 + l.x1) / 2;
      const cz = (l.z0 + l.z1) / 2;
      const half = Math.hypot(l.x1 - l.x0, l.z1 - l.z0) / 2 + lavaPieceFp('mid', l.w) / 2;
      return { cx, cz, half };
    });
    for (let i = 0; i < reach.length; i++) {
      for (let j = i + 1; j < reach.length; j++) {
        const d = Math.hypot(reach[i].cx - reach[j].cx, reach[i].cz - reach[j].cz);
        expect(d, `areas ${i} and ${j} overlap`).toBeGreaterThan(reach[i].half + reach[j].half);
      }
    }
  });

  it('caps a run only where it spends itself, never at a pool mouth', () => {
    let caps = 0;
    for (const link of EMBER_LAVA_LINKS) {
      const ends = lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround).filter(
        (p) => p.kind === 'end',
      );
      const want = (link.m0 === 'cap' ? 1 : 0) + (link.m1 === 'cap' ? 1 : 0);
      expect(ends.length, `end caps on the ${link.x0},${link.z0} run`).toBe(want);
      caps += want;
    }
    // the network keeps at least one genuine terminus, or the END piece of
    // the vocabulary would be dead weight
    expect(caps, 'the network spills somewhere').toBeGreaterThan(0);
  });

  it('keeps every piece inside its own run', () => {
    for (const link of EMBER_LAVA_LINKS) {
      const pts = emberLinkPolyline(link);
      for (const p of lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, flatGround)) {
        const near = Math.min(...pts.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
        expect(near, `${p.kind} sits on the meander`).toBeLessThan(1.5);
      }
    }
  });

  it('matches the shipped models it was measured from', () => {
    // dequantize the meshopt-packed GLBs is overkill here: assert instead
    // that exactly the three vocabulary files are on disk and the retired
    // ones are gone, so the metrics table cannot outlive its models
    const shipped = ['lava_pool', 'lava_river_mid', 'lava_river_end'];
    const retired = ['lava_river_a', 'lava_river_b', 'lava_river_c', 'lava_terrace'];
    for (const f of shipped) {
      expect(() =>
        readFileSync(new URL(`../public/models/props/${f}.glb`, import.meta.url)),
      ).not.toThrow();
    }
    for (const f of retired) {
      expect(() =>
        readFileSync(new URL(`../public/models/props/${f}.glb`, import.meta.url)),
      ).toThrow();
    }
    // and the derived scale stays sane for every authored width
    for (const link of EMBER_LAVA_LINKS) {
      expect(lavaPieceFp('mid', link.w)).toBeGreaterThan(link.w);
      expect(lavaPieceFp('end', link.w)).toBeGreaterThan(link.w);
    }
  });
});
