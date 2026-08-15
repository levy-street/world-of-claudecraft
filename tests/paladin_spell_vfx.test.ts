import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  PALADIN_BASTION_SWEEP_DURATION,
  PALADIN_BASTION_SWEEP_IMPACT_TIME,
  PALADIN_DAWNFALL_IMPACT_NORMALIZED,
  PALADIN_SUNWARD_PROJECTILE_SPEED,
  PaladinSpellVfxController,
  type PaladinSpellVfxParticle,
} from '../src/render/paladin_spell_vfx';

function fixture(): {
  anchors: Map<number, THREE.Vector3>;
  emitted: PaladinSpellVfxParticle[];
  fx: PaladinSpellVfxController;
} {
  const anchors = new Map([
    [1, new THREE.Vector3(0, 1, 0)],
    [2, new THREE.Vector3(6, 1, 1)],
    [3, new THREE.Vector3(9, 1, -2)],
    [4, new THREE.Vector3(12, 1, 2)],
  ]);
  const emitted: PaladinSpellVfxParticle[] = [];
  return {
    anchors,
    emitted,
    fx: new PaladinSpellVfxController(
      (id, height) => anchors.get(id)?.clone().setY(height) ?? null,
      (particle) => emitted.push(particle),
    ),
  };
}

describe('Paladin spell VFX timelines', () => {
  it('runs Solar Invocation as a snap, then follows a moving target through impact', () => {
    const { anchors, emitted, fx } = fixture();
    fx.holyShock({ mode: 'heal', sourceId: 1, targetId: 2 });
    expect(emitted.some((particle) => particle.tag === 'holy-caster-flash')).toBe(true);

    fx.update(0.06);
    expect(emitted.some((particle) => particle.tag === 'holy-link')).toBe(true);

    anchors.set(2, new THREE.Vector3(9, 1, 4));
    fx.update(0.06);
    const impact = emitted.find((particle) => particle.tag === 'holy-heal-impact');
    expect(impact).toBeDefined();
    expect(impact?.position.x).toBeCloseTo(9);
    expect(impact?.position.z).toBeCloseTo(4);
    expect(emitted.some((particle) => particle.tag === 'holy-heal-halo')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'holy-damage-crack')).toBe(false);

    fx.update(0.44);
    expect(fx.activeEffectCount).toBe(0);
  });

  it('uses the same Holy Shock timeline with a sharper damage-only judgment accent', () => {
    const { emitted, fx } = fixture();
    fx.holyShock({ mode: 'damage', sourceId: 1, targetId: 2 });
    fx.update(0.12);

    expect(emitted.some((particle) => particle.tag === 'holy-damage-impact')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'holy-damage-crack')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'holy-heal-halo')).toBe(false);
  });

  it('sequences Dawnfall blades and shockwave at the authored impact time and radius', () => {
    const { emitted, fx } = fixture();
    fx.dawnfall({ casterId: 1, radius: 6, bladeCount: 6 });
    expect(emitted.some((particle) => particle.tag === 'dawn-rune')).toBe(true);

    fx.update(0.18);
    expect(emitted.some((particle) => particle.tag === 'dawn-crescent')).toBe(true);
    fx.update(0.08);
    expect(emitted.filter((particle) => particle.tag === 'dawn-blade')).toHaveLength(12);
    fx.update(0.08);
    expect(emitted.some((particle) => particle.tag === 'dawn-shockwave')).toBe(true);
    expect(
      emitted
        .filter((particle) => particle.tag === 'dawn-blade')
        .every((particle) => Math.hypot(particle.position.x, particle.position.z) <= 6),
    ).toBe(true);
    expect(fx.dawnfallImpactTime).toBe(0.34);
    expect(fx.dawnfallDuration).toBe(0.9);
    expect(PALADIN_DAWNFALL_IMPACT_NORMALIZED).toBeCloseTo(0.62, 2);
  });

  it('schedules compact Dawnfall marks on affected moving enemies and clears all state', () => {
    const { anchors, emitted, fx } = fixture();
    fx.dawnfallTarget(2);
    anchors.set(2, new THREE.Vector3(8, 1, -2));
    fx.update(0.34);

    const impact = emitted.find((particle) => particle.tag === 'dawn-target-impact');
    expect(impact?.position.x).toBeCloseTo(8);
    expect(impact?.position.z).toBeCloseTo(-2);
    fx.clear();
    expect(fx.activeEffectCount).toBe(0);
  });

  it('casts a solar ward through three readable hops and breaks on the final target', () => {
    const { emitted, fx } = fixture();
    fx.sunwardDisc({ sourceId: 1, targetId: 2, hopIndex: 0, totalHits: 3 });

    expect(emitted.some((particle) => particle.tag === 'sunward-caster-sigil')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'sunward-launch-ray')).toBe(true);
    expect(PALADIN_SUNWARD_PROJECTILE_SPEED).toBe(26);

    fx.update(0.04);
    expect(emitted.some((particle) => particle.tag === 'sunward-disc-rune')).toBe(true);
    expect(
      emitted
        .filter((particle) => particle.tag === 'sunward-disc-rune')
        .every((particle) => particle.size >= 1.1),
    ).toBe(true);
    expect(
      emitted
        .filter((particle) => particle.tag === 'sunward-disc-core')
        .every((particle) => particle.size >= 1.18),
    ).toBe(true);
    expect(
      emitted
        .filter(
          (particle) => particle.tag.includes('sunward-disc') && particle.tag.includes('halo'),
        )
        .every((particle) => particle.size >= 1.9),
    ).toBe(true);
    fx.update(0.24);
    expect(emitted.filter((particle) => particle.tag === 'sunward-impact')).toHaveLength(1);

    const firstLaunches = emitted.filter((particle) => particle.tag === 'sunward-disc-core').length;
    fx.sunwardDisc({ sourceId: 2, targetId: 3, hopIndex: 1, totalHits: 3 });
    expect(emitted.filter((particle) => particle.tag === 'sunward-disc-core')).toHaveLength(
      firstLaunches + 1,
    );
    fx.update(0.18);
    expect(emitted.filter((particle) => particle.tag === 'sunward-impact')).toHaveLength(2);

    fx.sunwardDisc({ sourceId: 3, targetId: 4, hopIndex: 2, totalHits: 3 });
    fx.update(0.22);
    expect(emitted.filter((particle) => particle.tag === 'sunward-impact-final')).toHaveLength(1);
    expect(emitted.some((particle) => particle.tag === 'sunward-fragment')).toBe(true);
    expect(emitted.filter((particle) => particle.tag === 'sunward-downward-ray')).toHaveLength(3);
    expect(emitted.filter((particle) => particle.tag === 'sunward-impact-rune')).toHaveLength(3);
    expect(emitted.filter((particle) => particle.tag === 'sunward-impact-ring')).toHaveLength(3);

    fx.update(0.3);
    expect(fx.activeEffectCount).toBe(0);
  });

  it('waits for authoritative arrival before showing a moving-target Sunward impact', () => {
    const { anchors, emitted, fx } = fixture();
    fx.sunwardDisc({
      sourceId: 1,
      targetId: 2,
      hopIndex: 0,
      totalHits: 3,
      awaitImpact: true,
    });

    fx.update(0.5);
    expect(emitted.some((particle) => particle.tag === 'sunward-impact')).toBe(false);

    anchors.set(2, new THREE.Vector3(14, 1, -3));
    fx.sunwardDiscImpact(1, 2, 0, 3);

    const impact = emitted.find((particle) => particle.tag === 'sunward-impact');
    expect(impact?.position.x).toBeCloseTo(14);
    expect(impact?.position.z).toBeCloseTo(-3);
    fx.update(0.2);
    expect(fx.activeEffectCount).toBe(0);
  });

  it('uses a short raised spellcast instead of a thrown-shield attack clip', () => {
    expect(VISUALS.player_paladin.clips.attackByAbility?.sunward_disc).toBe('Spellcast_Raise');
  });

  it('builds Bastion Sweep at the exact impact frame and only across its frontal arc', () => {
    const { emitted, fx } = fixture();
    fx.bastionSweep({
      sourceId: 1,
      radius: 6,
      halfAngle: Math.PI / 2,
      facing: 0,
    });

    fx.update(PALADIN_BASTION_SWEEP_IMPACT_TIME - 0.01);
    expect(emitted.some((particle) => particle.tag === 'bastion-leading-edge')).toBe(false);
    expect(emitted.some((particle) => particle.tag === 'bastion-target-flash')).toBe(false);

    fx.update(0.01);
    fx.bastionSweepTarget(2);
    const leadingEdge = emitted.filter((particle) => particle.tag === 'bastion-leading-edge');
    expect(leadingEdge.length).toBeGreaterThanOrEqual(24);
    expect(
      leadingEdge.every(
        (particle) =>
          Math.hypot(particle.position.x, particle.position.z) <= 6.01 &&
          particle.position.z >= -0.01,
      ),
    ).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'bastion-golden-trail')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'bastion-shield-segment')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'bastion-ground-wave')).toBe(true);
    expect(emitted.filter((particle) => particle.tag === 'bastion-radiant-wall')).toHaveLength(28);
    expect(emitted.some((particle) => particle.tag === 'bastion-target-flash')).toBe(true);
    expect(emitted.some((particle) => particle.tag === 'bastion-target-rune')).toBe(true);
    expect(PALADIN_BASTION_SWEEP_IMPACT_TIME).toBe(0.32);
    expect(PALADIN_BASTION_SWEEP_DURATION).toBe(0.72);

    fx.update(0.41);
    expect(fx.activeEffectCount).toBe(0);
  });
});
