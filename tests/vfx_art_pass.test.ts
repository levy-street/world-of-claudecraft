import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { drawBuffCeremony, drawHealingCeremony } from '../src/render/ability_vfx/ceremonies';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { usesCrescendoScale } from '../src/render/ability_vfx/spectacle';
import { RestorativeWaterVolumes } from '../src/render/ability_vfx/water_volumes';
import { ABILITY_VFX_ART_PROFILES } from '../src/render/ability_vfx_art_profiles';
import { ABILITY_VFX_FULL_SPECS } from '../src/render/ability_vfx_full_specs';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';

function host() {
  return {
    anchorOf: (id: number, frac: number) => ({ x: id * 5, y: frac * 2, z: 0 }),
    groundYAt: () => 0,
    quality: () => 1,
    timeNow: () => 0,
    overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
    heldCcBand: () => false,
    ringAt: vi.fn(),
    decalXZ: vi.fn(),
    flipbookAt: vi.fn(),
    pillarAt: vi.fn(),
    shellFlash: vi.fn(),
    burstAt: vi.fn(),
    pulseLight: vi.fn(),
    glowPulse: vi.fn(),
    boltBetween: vi.fn(),
    boltPoints: vi.fn(),
    slashStyled: vi.fn(),
    pathRibbon: vi.fn(),
    pushOverlay: vi.fn(),
    windupDraw: vi.fn(),
    countPrimitive: vi.fn(),
    shakeAt: vi.fn(),
    waterVolume: vi.fn(),
  } satisfies SequencerHost;
}

describe('catalogue art direction', () => {
  it('covers every gallery entry while preserving authored exclusions and nested effects', () => {
    expect(Object.keys(ABILITY_VFX_ART_PROFILES)).toEqual(Object.keys(ABILITY_VFX_FULL_SPECS));
    for (const [id, original] of Object.entries(ABILITY_VFX_FULL_SPECS)) {
      const profile = ABILITY_VFX_ART_PROFILES[id];
      for (const field of ['impact', 'bolt', 'strike', 'motifs', 'spirit', 'barrier'] as const)
        expect(profile[field], `${id}.${field}`).toEqual(original[field]);
      if (original.accent !== undefined) expect(profile.accent).toBe(original.accent);
    }
    expect(abilityVfxFullSpec('shadow_bolt')?.bolt?.style).toBe('shadowFang');
    expect(usesCrescendoScale(abilityVfxFullSpec('sinister_strike')!)).toBe(false);
    expect(abilityVfxFullSpec('execute')?.physical).toBeDefined();
    expect(usesCrescendoScale(abilityVfxFullSpec('execute')!)).toBe(false);
    expect(usesCrescendoScale(abilityVfxFullSpec('pyroblast')!)).toBe(true);
  });
  it('plays the authored accent and subsecond transformation at completion', () => {
    const h = host();
    const seq = new ArchetypeSequencer();
    seq.start(h, 'ghost_wolf', abilityVfxFullSpec('ghost_wolf')!, 1, 1, 0x6b91c7, 0, false);
    seq.update(h, 0.16);
    expect(h.shellFlash).toHaveBeenCalledWith(1, 0x6b91c7, 0.65);
    expect(h.pathRibbon.mock.calls.some(([color]) => color === 0xc6e8f2)).toBe(true);
    expect(h.waterVolume).not.toHaveBeenCalled();
  });
  it('gives each heal family a different open silhouette and sheds detail on tier one', () => {
    const at = { x: 5, y: 2, z: 7 };
    const shapes: number[][] = [];
    for (const id of ['healing_touch', 'flash_heal', 'temporal_echo']) {
      const h = host();
      const spec = abilityVfxFullSpec(id)!;
      expect(drawHealingCeremony(h, at, spec, 1, 2, false)).toBe(3);
      const fill = h.pathRibbon.mock.calls[0][3] as Parameters<SequencerHost['pathRibbon']>[3];
      const points = Array.from({ length: 12 }, () => new THREE.Vector3());
      fill(points);
      expect(points.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
      shapes.push(points.flatMap((p) => p.toArray()));
      h.pathRibbon.mockClear();
      expect(drawHealingCeremony(h, at, spec, 1, 2, true)).toBe(1);
      expect(h.pathRibbon).toHaveBeenCalledTimes(1);
    }
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(3);
    const h = host();
    drawBuffCeremony(h, at, abilityVfxFullSpec('ghost_wolf')!, 1, 2, true);
    expect(h.pathRibbon).toHaveBeenCalledTimes(1);
    drawHealingCeremony(h, at, abilityVfxFullSpec('chain_heal')!, 1, 2, false);
    expect(h.waterVolume).toHaveBeenCalledTimes(3);
  });
});

describe('prepared liquid volumes', () => {
  it('is compile-discoverable before a first cast, bounded, and retains real endpoints', () => {
    const scene = new THREE.Scene();
    const pool = new RestorativeWaterVolumes(scene);
    expect(
      collectAbilityVfxCompileTargets(scene).some((target) => target.object === pool.mesh),
    ).toBe(true);
    expect(pool.mesh.visible).toBe(false);
    const geometry = pool.mesh.geometry;
    for (let i = 0; i < 30; i++)
      pool.spawn({ x: i, y: 2, z: 3 }, { x: i + 5, y: 4, z: 7 }, 0x319cac, 0xbbeee8, 0.17);
    expect(scene.children).toHaveLength(1);
    expect(geometry.instanceCount).toBe(12);
    expect(geometry.getAttribute('aFrom').count).toBe(12);
    expect(geometry.getAttribute('aTo').getX(0) - geometry.getAttribute('aFrom').getX(0)).toBe(5);
    expect(pool.mesh.material.blending).toBe(THREE.NormalBlending);
    pool.update(0.2, true);
    expect(pool.mesh.material.uniforms.uMotion.value).toBe(0);
    pool.update(NaN, false);
    expect(pool.mesh.material.uniforms.uTime.value).toBe(0.2);
    pool.update(2, false);
    expect(pool.mesh.visible).toBe(false);
    const dispose = vi.spyOn(geometry, 'dispose');
    pool.dispose();
    pool.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });
  it('clears pending partial uploads before exposing a reused pool', () => {
    const pool = new RestorativeWaterVolumes(new THREE.Scene());
    const from = { x: 0, y: 0, z: 0 },
      to = { x: 1, y: 1, z: 1 };
    pool.spawn(from, to, 1, 2, 0.1);
    const life = pool.mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
    life.clearUpdateRanges();
    pool.spawn(from, to, 1, 2, 0.1);
    pool.clear();
    expect(life.updateRanges).toEqual([{ start: 0, count: 48 }]);
    pool.spawn(from, to, 1, 2, 0.1);
    expect(Array.from(life.array).filter((_, i) => i % 4 === 1 && life.array[i] > 0)).toHaveLength(
      1,
    );
    pool.dispose();
  });
});
