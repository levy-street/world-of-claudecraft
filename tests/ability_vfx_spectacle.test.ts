// Spectacle calibration (src/render/ability_vfx/spectacle.ts): the crescendo
// constants measured against the gallery apply ONLY to the targeted
// archetypes (bolt/strike/burst/dot) at the sequencer's spawn seams, leave
// the already-at-parity radial families (nova/shout) untouched, preserve the
// tier degradation ratios, and hold a bounded afterglow after impact.
import { describe, expect, it } from 'vitest';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  isCrescendoArchetype,
  SPECTACLE,
  slashWidthScale,
} from '../src/render/ability_vfx/spectacle';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';

interface RingCall {
  maxR: number;
  vertical: boolean;
  y: number;
}
interface BurstCall {
  kind: string;
  count: number;
  power: number;
}
interface FlipCall {
  size: number;
}
interface SlashCall {
  scale: number;
}
interface LightCall {
  intensity: number;
}

// Minimal recording host: fixed anchors, flat ground, quality 1.
function makeHost() {
  const rings: RingCall[] = [];
  const bursts: BurstCall[] = [];
  const flips: FlipCall[] = [];
  const slashes: SlashCall[] = [];
  const lights: LightCall[] = [];
  const host: SequencerHost = {
    anchorOf: (id, frac) => ({ x: id * 10, y: frac * 2, z: 0 }),
    groundYAt: () => 0,
    ringAt: (_x, y, _z, maxR, _dur, _c, _i, vertical) => {
      rings.push({ maxR, vertical, y });
    },
    decalXZ: () => {},
    flipbookAt: (_x, _y, _z, size) => {
      flips.push({ size });
    },
    pillarAt: () => {},
    shellFlash: () => {},
    burstAt: (_x, _y, _z, _c, count, power, kind) => {
      bursts.push({ kind, count, power });
    },
    pulseLight: (_id, _p, intensity) => {
      lights.push({ intensity });
    },
    glowPulse: () => {},
    boltBetween: () => {},
    boltPoints: () => {},
    slashStyled: (_at, _c, _style, scale = 1) => {
      slashes.push({ scale });
    },
    pathRibbon: () => {},
    pushOverlay: () => {},
    overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
    windupDraw: () => {},
    quality: () => 1,
    timeNow: () => 0,
    countPrimitive: () => {},
    shakeAt: () => {},
    heldCcBand: () => false,
  };
  return { host, rings, bursts, flips, slashes, lights };
}

function step(seq: ArchetypeSequencer, host: SequencerHost, seconds: number, dt = 0.05): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) seq.update(host, dt);
}

const BOLT_SPEC: AbilityVfxFullSpec = { archetype: 'bolt', palette: 'storm', power: 1 };
const NOVA_SPEC: AbilityVfxFullSpec = {
  archetype: 'nova',
  palette: 'frost',
  power: 1,
  nova: { radius: 8 },
};
const STRIKE_SPEC: AbilityVfxFullSpec = {
  archetype: 'strike',
  palette: 'physical',
  power: 1,
  strike: { swings: 1, arc: 'horizontal' },
  impact: { trail: 'arc', sparks: 18, flipbook: false },
};

describe('spectacle crescendo classification', () => {
  it('boosts exactly the targeted archetypes', () => {
    for (const a of ['bolt', 'strike', 'burst', 'dot'] as const)
      expect(isCrescendoArchetype(a)).toBe(true);
    for (const a of ['nova', 'shout', 'heal', 'buff', 'cc', 'summon', 'dash', 'beam'] as const)
      expect(isCrescendoArchetype(a)).toBe(false);
  });

  it('constants stay in sane spectacle bounds', () => {
    // multiplicative constants: real boosts, but never order-of-magnitude
    for (const k of [
      'releaseStar',
      'releaseLight',
      'releaseSparks',
      'boltWidth',
      'boltHead',
      'flipbook',
      'impactSparkCount',
      'impactSparkPower',
      'impactLight',
      'vRing',
      'followRing',
      'strikeArc',
    ] as const) {
      expect(SPECTACLE[k]).toBeGreaterThanOrEqual(1);
      expect(SPECTACLE[k]).toBeLessThanOrEqual(4);
    }
    expect(SPECTACLE.afterglowDur).toBeLessThanOrEqual(4);
    expect(slashWidthScale(1)).toBeCloseTo(1, 5);
    expect(slashWidthScale(2)).toBeGreaterThan(1);
  });
});

describe('sequencer applies the crescendo boosts at the spawn seams', () => {
  it('bolt impact flipbook scales by SPECTACLE.flipbook; release ring fires at tier 0 only', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'bolt_t0', BOLT_SPEC, 1, 2, 0xffffff, 0, false);
    // release already fired: the caster's vertical release halo
    const releaseRing = a.rings.find(
      (r) => r.vertical && Math.abs(r.maxR - SPECTACLE.releaseRingR) < 1e-6,
    );
    expect(releaseRing).toBeDefined();
    // the release cast-off flipbook fires immediately at tier 0
    expect(a.flips[0]?.size).toBeCloseTo(SPECTACLE.releaseFlipbook, 5);
    step(seq, a.host, 0.3);
    // then the impact sheet, scaled by the crescendo multiplier
    expect(a.flips[1]?.size).toBeCloseTo(2 * SPECTACLE.flipbook, 5);
    // and the staggered second sheet stretches the hot window
    step(seq, a.host, SPECTACLE.flipbook2Delay + 0.1);
    expect(a.flips[2]?.size).toBeCloseTo(2 * SPECTACLE.flipbook * 0.85, 5);

    const b = makeHost();
    const seq1 = new ArchetypeSequencer();
    seq1.start(b.host, 'bolt_t1', BOLT_SPEC, 1, 2, 0xffffff, 1, false);
    expect(
      b.rings.find((r) => r.vertical && Math.abs(r.maxR - SPECTACLE.releaseRingR) < 1e-6),
    ).toBeUndefined();
  });

  it('nova ground ring keeps its authored radius (no inflation past parity)', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'nova', NOVA_SPEC, 1, 1, 0xffffff, 0, false);
    step(seq, a.host, 0.3);
    // the impact ground ring is the authored nova radius, untouched
    expect(a.rings.some((r) => !r.vertical && Math.abs(r.maxR - 8) < 1e-6)).toBe(true);
    // and no flipbook boost path: frost nova authored none here (default gentle
    // check does not apply to nova, but size must NOT carry the bolt multiplier)
    for (const f of a.flips) expect(f.size).toBeCloseTo(2, 5);
  });

  it('strike arcs swing at SPECTACLE.strikeArc scale', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'strike', STRIKE_SPEC, 1, 2, 0xffffff, 0, false);
    step(seq, a.host, 0.3);
    expect(a.slashes.length).toBeGreaterThanOrEqual(2); // impact trail + archetype arc
    for (const s of a.slashes) expect(s.scale).toBeCloseTo(SPECTACLE.strikeArc, 5);
  });

  it('tier 1 keeps the half-spark degradation ratio under the boost', () => {
    const spark = (tier: 0 | 1) => {
      const a = makeHost();
      const seq = new ArchetypeSequencer();
      seq.start(a.host, 'bolt', BOLT_SPEC, 1, 2, 0xffffff, tier, false);
      step(seq, a.host, 0.3);
      // the impact spark burst: 'sparks' kind, at the accent color, post-release
      const impactSparks = a.bursts.filter((b) => b.kind === 'sparks');
      return impactSparks[impactSparks.length - 1]?.count ?? 0;
    };
    const t0 = spark(0);
    const t1 = spark(1);
    expect(t0).toBeGreaterThan(0);
    expect(t1 / t0).toBeGreaterThan(0.4);
    expect(t1 / t0).toBeLessThan(0.6);
  });

  it('afterglow embers pop after a crescendo impact, then the slot frees', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    const slot = seq.start(a.host, 'bolt', BOLT_SPEC, 1, 2, 0xffffff, 0, false);
    expect(slot).not.toBeNull();
    step(seq, a.host, 0.3);
    const before = a.bursts.filter((b) => b.kind === 'embers').length;
    step(seq, a.host, SPECTACLE.afterglowDur);
    const after = a.bursts.filter((b) => b.kind === 'embers').length;
    expect(after - before).toBeGreaterThanOrEqual(2);
    // the slot must not dwell past its afterglow + linger
    step(seq, a.host, 1.0);
    expect(slot?.active).toBe(false);
  });

  it('non-crescendo sequences never arm the afterglow', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    const slot = seq.start(a.host, 'nova', NOVA_SPEC, 1, 1, 0xffffff, 0, false);
    step(seq, a.host, 0.3);
    expect(slot?.afterglowUntil).toBe(0);
  });

  it('strikes hold only the short hot-metal afterglow', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    const slot = seq.start(a.host, 'strike', STRIKE_SPEC, 1, 2, 0xffffff, 0, false);
    step(seq, a.host, 0.3);
    if (!slot) throw new Error('sequencer rejected the strike slot');
    expect(slot.afterglowUntil).toBeGreaterThan(0);
    expect(slot.afterglowUntil - slot.t).toBeLessThanOrEqual(SPECTACLE.strikeAfterglowDur);
  });

  it('single-swing tier-0 strikes echo the arc a beat later', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'strike', STRIKE_SPEC, 1, 2, 0xffffff, 0, false);
    step(seq, a.host, 0.3);
    const before = a.slashes.length;
    step(seq, a.host, SPECTACLE.strikeEchoDelay + 0.1);
    expect(a.slashes.length).toBeGreaterThan(before); // the follow-through echo
  });

  it('a numeric impact.blood multiplies the contact spray (Bleed Out gush)', () => {
    const dotSpec = (blood: boolean | number): AbilityVfxFullSpec => ({
      archetype: 'dot',
      palette: 'blood',
      power: 1,
      impact: { blood, sparks: 0, flipbook: false, ring: false, vRing: false },
    });
    const base = makeHost();
    const seqBase = new ArchetypeSequencer();
    seqBase.start(base.host, 'dot_base', dotSpec(true), 1, 2, 0xffffff, 0, false);
    step(seqBase, base.host, 0.3);
    const gush = makeHost();
    const seqGush = new ArchetypeSequencer();
    seqGush.start(gush.host, 'dot_gush', dotSpec(2.2), 1, 2, 0xffffff, 0, false);
    step(seqGush, gush.host, 0.3);
    const baseBlood = base.bursts.find((b) => b.kind === 'blood');
    const gushBlood = gush.bursts.find((b) => b.kind === 'blood');
    if (!baseBlood || !gushBlood) throw new Error('expected blood bursts on both sides');
    // the multiplier rides the same crescendo-scaled baseline count (each
    // side rounds independently, so allow the rounding seam)
    expect(Math.abs(gushBlood.count - baseBlood.count * 2.2)).toBeLessThanOrEqual(1.2);
    expect(gushBlood.power).toBeGreaterThan(baseBlood.power);
    expect(gushBlood.power).toBeLessThanOrEqual(baseBlood.power * 1.35 + 1e-9);
  });

  it("cc style 'dust' flings the grit cone and still arms the wander stars", () => {
    const DUST_SPEC: AbilityVfxFullSpec = {
      archetype: 'cc',
      palette: 'physical',
      power: 0.8,
      cc: { style: 'dust' },
      linger: 4,
      impact: { sparks: 0, flipbook: false, ring: false, vRing: false },
    };
    const a = makeHost();
    let overlays = 0;
    a.host.pushOverlay = () => {
      overlays++;
    };
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'blind', DUST_SPEC, 1, 2, 0xc2b280, 0, false);
    step(seq, a.host, 0.3);
    // the staggered hand-to-face grit plus the face-height landing pair
    expect(a.bursts.filter((b) => b.kind === 'debris').length).toBeGreaterThanOrEqual(3);
    expect(a.bursts.some((b) => b.kind === 'smoke')).toBe(true);
    // the stunned-star band still runs off the linger like the poof style
    step(seq, a.host, 1);
    expect(overlays).toBeGreaterThan(0);
  });

  it('finishers fire the gallery double shockwave at +0.12s', () => {
    const FIN_SPEC: AbilityVfxFullSpec = {
      archetype: 'bolt',
      palette: 'fire',
      power: 1,
      finisher: true,
    };
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'fin', FIN_SPEC, 1, 2, 0xffffff, 0, false);
    step(seq, a.host, 0.2); // impact fired, ring3 still pending
    const beforeGround = a.rings.filter(
      (r) => !r.vertical && Math.abs(r.maxR - SPECTACLE.finisherWaveR) < 1e-6,
    ).length;
    expect(beforeGround).toBe(0);
    step(seq, a.host, 0.2); // +0.12 beat passes
    expect(
      a.rings.some((r) => !r.vertical && Math.abs(r.maxR - SPECTACLE.finisherWaveR) < 1e-6),
    ).toBe(true);
    expect(
      a.rings.some(
        (r) =>
          r.vertical && Math.abs(r.maxR - SPECTACLE.finisherWaveVR * SPECTACLE.followRing) < 1e-6,
      ),
    ).toBe(true);
  });

  it('non-gentle impacts pop the vertical halo by default; gentle stay quiet', () => {
    const a = makeHost();
    const seq = new ArchetypeSequencer();
    seq.start(a.host, 'bolt', BOLT_SPEC, 1, 2, 0xffffff, 0, false);
    step(seq, a.host, 0.2);
    // default-on vRing at the crescendo multiplier (gallery o.vRing !== false)
    expect(a.rings.some((r) => r.vertical && Math.abs(r.maxR - 2.6 * SPECTACLE.vRing) < 1e-6)).toBe(
      true,
    );
    const HEAL_SPEC: AbilityVfxFullSpec = { archetype: 'heal', palette: 'holy', power: 1 };
    const b = makeHost();
    const seq2 = new ArchetypeSequencer();
    seq2.start(b.host, 'heal', HEAL_SPEC, 1, 1, 0xffffff, 0, false);
    step(seq2, b.host, 0.2);
    expect(b.rings.some((r) => r.vertical && Math.abs(r.maxR - 2.6) < 1e-6)).toBe(false);
  });
});
