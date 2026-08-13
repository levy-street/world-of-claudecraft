import { describe, expect, it } from 'vitest';
import {
  createSentenceBurstPlan,
  createSentenceInvocationPlan,
  SENTENCE_BUILDUP_SECONDS,
  SENTENCE_BURST_SECONDS,
  SENTENCE_CATACLYSM_SECONDS,
  SENTENCE_MARK_SECONDS,
  SENTENCE_TRANSFER_MAX_SECONDS,
  SENTENCE_TRANSFER_MIN_SECONDS,
  SENTENCE_TRANSFER_SPEED,
  sentenceImpactPlan,
  sentenceTransferSeconds,
  writeSentenceBurstPlan,
  writeSentenceInvocationPlan,
} from '../src/render/sentence_vfx_core';

describe('Sentence invocation VFX plan', () => {
  it('compresses a deliberate instant-cast invocation before release', () => {
    expect(SENTENCE_BUILDUP_SECONDS).toBe(0.16);
    const early = createSentenceInvocationPlan();
    const compressed = createSentenceInvocationPlan();
    const released = createSentenceInvocationPlan();

    writeSentenceInvocationPlan(early, 0.03, 0.3, false);
    writeSentenceInvocationPlan(compressed, 0.15, 0.3, false);
    writeSentenceInvocationPlan(released, 0.25, 0.3, false);

    expect(early.visible).toBe(true);
    expect(compressed.coreOpacity).toBeGreaterThan(early.coreOpacity);
    expect(compressed.coreScale).toBeLessThan(early.coreScale);
    expect(compressed.wispRadius).toBeLessThan(early.wispRadius);
    expect(compressed.sealOpacity).toBeGreaterThan(0.7);
    expect(released.release).toBeGreaterThan(0);
    expect(released.coreOpacity).toBeLessThan(compressed.coreOpacity);
  });

  it('bounds delivery timing at close, medium, and maximum range', () => {
    expect(SENTENCE_TRANSFER_SPEED).toBe(58);
    expect(SENTENCE_TRANSFER_MIN_SECONDS).toBe(0.08);
    expect(SENTENCE_TRANSFER_MAX_SECONDS).toBe(0.52);
    expect(sentenceTransferSeconds(0)).toBe(0.08);
    expect(sentenceTransferSeconds(17.4)).toBeCloseTo(0.3);
    expect(sentenceTransferSeconds(30)).toBeCloseTo(0.52, 2);
    expect(sentenceTransferSeconds(100)).toBe(0.52);
    expect(sentenceTransferSeconds(Number.NaN)).toBe(0.08);
  });

  it('keeps reduced-motion invocation poses spatially static', () => {
    const early = createSentenceInvocationPlan();
    const late = createSentenceInvocationPlan();

    writeSentenceInvocationPlan(early, 0.05, 0.4, true);
    writeSentenceInvocationPlan(late, 0.14, 0.4, true);

    expect(early.coreScale).toBe(late.coreScale);
    expect(early.sealScale).toBe(late.sealScale);
    expect(early.wispRadius).toBe(late.wispRadius);
    expect(early.rotation).toBe(0);
    expect(late.rotation).toBe(0);
  });
});

describe('Sentence burst VFX plan', () => {
  it('holds a readable condemnation mark before the payoff', () => {
    expect(SENTENCE_MARK_SECONDS).toBe(0.24);
    const marked = createSentenceBurstPlan();
    const payoff = createSentenceBurstPlan();

    writeSentenceBurstPlan(marked, 0.16, 100, false);
    writeSentenceBurstPlan(payoff, SENTENCE_MARK_SECONDS + 0.1, 100, false);

    expect(marked.visible).toBe(true);
    expect(marked.opacity).toBeGreaterThan(0.8);
    expect(marked.eyeScale).toBeGreaterThan(1);
    expect(marked.cataclysmOpacity).toBe(0);
    expect(marked.residueOpacity).toBe(0);
    expect(payoff.cataclysmOpacity).toBeGreaterThan(0.7);
    expect(payoff.detonationFlashOpacity).toBeGreaterThan(0.5);
    expect(payoff.residueOpacity).toBeGreaterThan(0);
    expect(payoff.soulOpacity).toBeGreaterThan(0);
  });

  it('pins the full finisher duration without overstaying its boundary', () => {
    expect(SENTENCE_BURST_SECONDS).toBe(1.7);
    expect(SENTENCE_CATACLYSM_SECONDS).toBe(2.35);
    const plan = createSentenceBurstPlan();

    writeSentenceBurstPlan(plan, 0.75, 100, false);
    expect(plan.visible).toBe(true);
    expect(plan.powerScale).toBe(1);
    expect(plan.waveScale).toBeGreaterThan(3);
    expect(plan.secondaryWaveScale).toBeGreaterThan(plan.waveScale);
    expect(plan.sparkDistance).toBeGreaterThan(2);
    expect(plan.residueScale).toBeGreaterThan(1);

    writeSentenceBurstPlan(plan, SENTENCE_CATACLYSM_SECONDS - 0.001, 100, false);
    expect(plan.visible).toBe(true);

    writeSentenceBurstPlan(plan, SENTENCE_CATACLYSM_SECONDS, 100, false);
    expect(plan.visible).toBe(false);
    expect(plan.opacity).toBe(0);
    expect(plan.flashOpacity).toBe(0);
    expect(plan.waveOpacity).toBe(0);
    expect(plan.pillarOpacity).toBe(0);
    expect(plan.sparkOpacity).toBe(0);
    expect(plan.residueOpacity).toBe(0);
    expect(plan.soulOpacity).toBe(0);
  });

  it('pins every Condemnation verdict tier and makes the maximum larger than its floor', () => {
    const tiers = [20, 50, 80, 100].map((condemnation) => {
      const plan = createSentenceBurstPlan();
      return writeSentenceBurstPlan(plan, 0.58, condemnation, false);
    });

    expect(tiers.map((plan) => plan.powerScale)).toEqual([0.76, 0.85, 0.94, 1]);
    expect(tiers[3].eyeScale).toBeGreaterThan(tiers[0].eyeScale);
    expect(tiers[3].waveScale).toBeGreaterThan(tiers[0].waveScale);
    expect(tiers[3].pillarScale).toBeGreaterThan(tiers[0].pillarScale);
    expect(tiers[3].sparkDistance).toBeGreaterThan(tiers[0].sparkDistance);
    expect(tiers[3].residueScale).toBeGreaterThan(tiers[0].residueScale);
  });

  it('reserves the largest implosion and eruption for exactly 100 Condemnation', () => {
    const nearMaximum = createSentenceBurstPlan();
    const compressed = createSentenceBurstPlan();
    const cataclysm = createSentenceBurstPlan();
    const expanded = createSentenceBurstPlan();

    writeSentenceBurstPlan(nearMaximum, 0.42, 80, false);
    writeSentenceBurstPlan(compressed, 0.18, 100, false);
    writeSentenceBurstPlan(cataclysm, 0.44, 100, false);
    writeSentenceBurstPlan(expanded, 0.84, 100, false);

    expect(nearMaximum.duration).toBe(SENTENCE_BURST_SECONDS);
    expect(nearMaximum.cataclysmOpacity).toBe(0);
    expect(nearMaximum.starburstOpacity).toBe(0);
    expect(nearMaximum.ruptureOpacity).toBe(0);
    expect(compressed.cataclysmOpacity).toBe(0);
    expect(cataclysm.duration).toBeGreaterThan(SENTENCE_BURST_SECONDS);
    expect(cataclysm.cataclysmOpacity).toBeGreaterThan(0.7);
    expect(cataclysm.cataclysmScale).toBeGreaterThan(2);
    expect(cataclysm.starburstScale).toBeGreaterThan(2.5);
    expect(cataclysm.ruptureScale).toBeGreaterThan(4.5);
    expect(cataclysm.verticalHaloScale).toBeGreaterThan(2);
    expect(expanded.cataclysmScale).toBeGreaterThan(5);
    expect(expanded.starburstScale).toBeGreaterThan(6);
    expect(expanded.ruptureScale).toBeGreaterThan(7.5);
    expect(expanded.verticalHaloScale).toBeGreaterThan(5);
  });

  it('keeps spatial poses static under reduced motion while preserving the verdict', () => {
    const early = createSentenceBurstPlan();
    const late = createSentenceBurstPlan();

    writeSentenceBurstPlan(early, 0.4, 100, true);
    writeSentenceBurstPlan(late, 0.9, 100, true);

    expect(early.visible).toBe(true);
    expect(late.visible).toBe(true);
    expect(early.vortexScale).toBe(late.vortexScale);
    expect(early.eyeScale).toBe(late.eyeScale);
    expect(early.irisScale).toBe(late.irisScale);
    expect(early.waveScale).toBe(late.waveScale);
    expect(early.secondaryWaveScale).toBe(late.secondaryWaveScale);
    expect(early.pillarScale).toBe(late.pillarScale);
    expect(early.crownScale).toBe(late.crownScale);
    expect(early.sparkDistance).toBe(late.sparkDistance);
    expect(early.cataclysmScale).toBe(late.cataclysmScale);
    expect(early.detonationFlashScale).toBe(late.detonationFlashScale);
    expect(early.starburstScale).toBe(late.starburstScale);
    expect(early.ruptureScale).toBe(late.ruptureScale);
    expect(early.verticalHaloScale).toBe(late.verticalHaloScale);
    expect(early.rotation).toBe(0);
    expect(late.rotation).toBe(0);
  });

  it('is deterministic for injected time, distance, and power', () => {
    const first = createSentenceBurstPlan();
    const second = createSentenceBurstPlan();
    const firstCast = createSentenceInvocationPlan();
    const secondCast = createSentenceInvocationPlan();

    writeSentenceBurstPlan(first, 0.57, 80, false);
    writeSentenceBurstPlan(second, 0.57, 80, false);
    writeSentenceInvocationPlan(firstCast, 0.13, sentenceTransferSeconds(22), false);
    writeSentenceInvocationPlan(secondCast, 0.13, sentenceTransferSeconds(22), false);

    expect(second).toEqual(first);
    expect(secondCast).toEqual(firstCast);
  });
});

describe('Sentence impact feedback plan', () => {
  it('scales the shadow pulse with the Condemnation spend tiers', () => {
    expect(sentenceImpactPlan(0, false)).toMatchObject({ light: 7.5, duration: 0.52 });
    expect(sentenceImpactPlan(49, false)).toMatchObject({ light: 7.5, duration: 0.52 });
    expect(sentenceImpactPlan(50, false)).toMatchObject({ light: 9, duration: 0.6 });
    expect(sentenceImpactPlan(80, false)).toMatchObject({ light: 10.5, duration: 0.68 });
    expect(sentenceImpactPlan(100, false)).toMatchObject({ light: 11.5, duration: 0.72 });
  });

  it('shakes and punches FOV only for the local caster', () => {
    expect(sentenceImpactPlan(80, false)).toMatchObject({ shake: 0, fovPunch: 0 });
    expect(sentenceImpactPlan(80, true)).toMatchObject({ shake: 0.48, fovPunch: 1.6 });
  });

  it('reserves the heavy shake for a maximum spend', () => {
    expect(sentenceImpactPlan(99, true)).toMatchObject({ shake: 0.48, fovPunch: 1.6 });
    expect(sentenceImpactPlan(100, true)).toMatchObject({ shake: 0.9, fovPunch: 4 });
  });
});
