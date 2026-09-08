import { describe, expect, it, vi } from 'vitest';
import { refineCatalogueSpec } from '../src/render/ability_vfx/material_response_core';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { signatureMoment } from '../src/render/ability_vfx/signature_choreography';
import {
  chargeEnvelope,
  refineSignatureSpec,
  SIGNATURE_ABILITIES,
  signatureStrength,
  substanceOf,
} from '../src/render/ability_vfx/signature_core';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { ABILITIES } from '../src/sim/data';

function host(): SequencerHost {
  const values: Record<string, unknown> = {
    anchorOf: () => ({ x: 2, y: 1, z: 3 }),
    groundYAt: () => 0,
    quality: () => 1,
    timeNow: () => 0,
    overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
    heldCcBand: () => false,
    pathRibbon: vi.fn((_c, _w, _l, fill) =>
      fill(Array.from({ length: 16 }, () => ({ set: vi.fn() }))),
    ),
  };
  return new Proxy(values, {
    get(target, key: string) {
      if (target[key] === undefined) target[key] = vi.fn();
      return target[key];
    },
  }) as unknown as SequencerHost;
}
describe('signature direction', () => {
  it('preserves authored burst density, light and reach through both refinements', () => {
    for (const sparks of [0, 8, 26, 44, 60]) {
      const authored = {
        archetype: 'nova' as const,
        palette: 'frost',
        power: 1.8,
        nova: { radius: 8 },
        impact: { sparks, light: 3, ring: false },
      };
      const composed = refineSignatureSpec('frost_nova', refineCatalogueSpec(authored));
      expect(composed.impact?.sparks).toBe(sparks);
      expect(composed.impact?.light).toBe(3);
      expect(composed.nova).toBe(authored.nova);
      expect(composed.power).toBe(1.8);
    }
  });

  it.each(Object.keys(SIGNATURE_ABILITIES))(
    '%s resolves a real spell and composed silhouette',
    (id) => {
      expect(ABILITIES[id]).toBeDefined();
      const spec = abilityVfxFullSpec(id);
      expect(spec).toBeDefined();
      if (!spec) throw new Error('missing spec');
      const h = host();
      expect(
        signatureMoment(h, id, spec, { x: 2, y: 1, z: 3 }, 0x335577, 0xaaffcc, 0, 'impact'),
      ).toBeGreaterThan(0);
      expect(h.detailAt).toHaveBeenCalled();
    },
  );
  it('keeps anticipation monotone, bounded and delayed until the real end', () => {
    let last = 0;
    for (let i = 0; i <= 100; i++) {
      const v = chargeEnvelope(i / 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(chargeEnvelope(0)).toBe(0);
    expect(chargeEnvelope(1)).toBe(1);
    expect(chargeEnvelope(NaN)).toBe(0);
    expect(chargeEnvelope(0.3)).toBeLessThan(0.2);
  });
  it('protects filler contrast and retains reduced-tier identity', () => {
    const spec = abilityVfxFullSpec('fireball')!;
    expect(signatureStrength('fireball', spec, 0)).toBe(0);
    expect(signatureStrength('pyroblast', abilityVfxFullSpec('pyroblast')!, 2)).toBe(0);
    expect(signatureStrength('pyroblast', abilityVfxFullSpec('pyroblast')!, 1)).toBeGreaterThan(0);
  });
  it('keeps water distinct from ice and preserves gameplay radius in refinement', () => {
    expect(substanceOf(abilityVfxFullSpec('chain_heal')!)).toBe('water');
    const base = {
      archetype: 'nova' as const,
      palette: 'frost',
      nova: { radius: 8 },
      impact: { ring: false, light: 0 },
    };
    const refined = refineSignatureSpec('frost_nova', base);
    expect(refined.nova).toBe(base.nova);
    expect(refined.impact?.ring).toBe(false);
    expect(refined.impact?.light).toBe(0);
    expect(base.impact).toEqual({ ring: false, light: 0 });
  });
  it('fires projectile signature detail at actual arrival exactly once', () => {
    const h = host(),
      seq = new ArchetypeSequencer(),
      spec = abilityVfxFullSpec('pyroblast')!;
    const slot = seq.start(h, 'pyroblast', spec, 1, 2, 0xff8822, 0, true)!;
    vi.mocked(h.detailAt!).mockClear();
    vi.mocked(h.bakedAt!).mockClear();
    seq.update(h, 0.3);
    expect(h.detailAt).not.toHaveBeenCalled();
    expect(h.bakedAt).not.toHaveBeenCalled();
    seq.triggerImpact(h, slot, 5, 2, 8);
    expect(h.detailAt).toHaveBeenCalledWith(
      5,
      2.2,
      8,
      expect.closeTo(1.725),
      expect.any(Number),
      expect.any(Number),
      'fire',
      0.035,
      0.85,
    );
    expect(h.bakedAt).toHaveBeenCalledWith(
      'shockwave',
      5,
      0.09,
      8,
      expect.closeTo(6.9),
      0xbf541e,
      expect.any(Number),
      0.6,
      0,
      0.5,
      Math.atan2(3, 5),
    );
    expect(h.fragmentsAt).toHaveBeenCalledWith(
      'stone_chip',
      5,
      expect.closeTo(0.29),
      8,
      0x69574e,
      12,
      1.5,
      3,
      5,
    );
    const calls = vi.mocked(h.detailAt!).mock.calls.length;
    const bakedCalls = vi.mocked(h.bakedAt!).mock.calls.length;
    seq.triggerImpact(h, slot, 5, 2, 8);
    expect(vi.mocked(h.detailAt!).mock.calls).toHaveLength(calls);
    expect(vi.mocked(h.bakedAt!).mock.calls).toHaveLength(bakedCalls);
  });
});
