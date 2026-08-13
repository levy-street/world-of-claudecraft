import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  GLOOM_BOLT_VFX_FULL_SPEC,
  GLOOM_BOLT_VFX_SPEC,
  RUINBOLT_VFX_FULL_SPEC,
} from '../src/render/destruction_vfx_specs';

function fakeTextures(): AbilityVfxTextures {
  const texture = (): THREE.CanvasTexture => new THREE.Texture() as THREE.CanvasTexture;
  return {
    noise: texture(),
    ribbon: texture(),
    rune: texture(),
    ember: texture(),
    rime: texture(),
    crack: texture(),
    char: texture(),
    overlay: texture(),
  };
}

function painterHarness() {
  const sequenceBolt = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    windup: vi.fn(() => true),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
  } as unknown as AbilityVfxFx;
  const projectile = vi.fn();
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile,
        lightningProjectile: vi.fn(),
        burst: vi.fn(),
        nova: vi.fn(),
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
    },
    () => 0,
  );
  return { painter, projectile, sequenceBolt };
}

function travellingBoltHarness() {
  const scene = new THREE.Scene();
  const anchors = new Map([
    [1, new THREE.Vector3(0, 1, 0)],
    [2, new THREE.Vector3(10, 1, 0)],
  ]);
  const ribbons = new AbilityVfxRibbons(
    scene,
    (id, _height, out) => {
      const anchor = anchors.get(id);
      return anchor ? (out ?? new THREE.Vector3()).copy(anchor) : null;
    },
    fakeTextures(),
  );
  const slot = {};
  const sequencer = {
    start: vi.fn(() => slot),
    triggerImpact: vi.fn(),
    cancel: vi.fn(),
  };
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  Object.assign(fx as unknown as Record<string, unknown>, {
    ribbons,
    sequencer,
    groundY: () => 0,
    particleBurst: vi.fn(),
  });
  return { anchors, fx, ribbons, sequencer, slot };
}

describe('Gloom Bolt premium filler VFX', () => {
  it('owns the existing shadow_bolt registry entry with a green shadow-fang identity', () => {
    expect(abilityVfxSpec('shadow_bolt')).toBe(GLOOM_BOLT_VFX_SPEC);
    expect(abilityVfxFullSpec('shadow_bolt')).toBe(GLOOM_BOLT_VFX_FULL_SPEC);
    expect(GLOOM_BOLT_VFX_FULL_SPEC).toMatchObject({
      archetype: 'bolt',
      filler: true,
      screenFx: false,
      tint: '#48f06f',
      bolt: {
        speed: 26,
        headScale: 0.95,
        style: 'shadowFang',
        core: '#06170c',
        accent: '#c5ff86',
        coils: true,
      },
    });
  });

  it('borrows Ruinbolt final-hit layers at filler scale without stealing its hierarchy', () => {
    const impact = GLOOM_BOLT_VFX_FULL_SPEC.impact;
    const ruinImpact = RUINBOLT_VFX_FULL_SPEC.impact;
    expect(impact).toMatchObject({
      focused: true,
      flipbook: true,
      vRing: true,
      debris: true,
      smoke: true,
      liteAudio: true,
    });
    expect(GLOOM_BOLT_VFX_FULL_SPEC.power).toBe(0.9);
    expect(impact?.ring).toBe(0.8);
    expect(impact?.sparks).toBe(26);
    expect(impact?.light).toBe(0.95);
    expect(GLOOM_BOLT_VFX_FULL_SPEC.linger).toBe(0.65);
    expect(GLOOM_BOLT_VFX_FULL_SPEC.decal).toBe('scorch');
    expect(Number(impact?.ring)).toBeLessThan(Number(ruinImpact?.ring));
    expect(GLOOM_BOLT_VFX_FULL_SPEC.decal).toBe(RUINBOLT_VFX_FULL_SPEC.decal);
    expect(GLOOM_BOLT_VFX_FULL_SPEC.power).toBeLessThan(RUINBOLT_VFX_FULL_SPEC.power ?? 0);
  });

  it('claims the real projectile cue and launches only the pooled green sequence', () => {
    const h = painterHarness();
    const event = {
      sourceId: 1,
      targetId: 2,
      school: 'shadow',
      fx: 'projectile' as const,
      ability: 'shadow_bolt',
    };

    expect(h.painter.handleSpellfx(event)).toBe(true);

    expect(h.projectile).not.toHaveBeenCalled();
    const call = h.sequenceBolt.mock.calls[0];
    expect(call?.slice(0, 5)).toEqual(['shadow_bolt', GLOOM_BOLT_VFX_FULL_SPEC, 1, 2, 0x48f06f]);
    expect(call?.[5]).toBeCloseTo(0.14744, 5);
    expect(call?.slice(6, 8)).toEqual([0, 1]);
    expect(call?.[8]).toBeCloseTo(0.9215, 5);
  });

  it('passes the authored green accent and black-green core through the real sequence seam', () => {
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id, _height, out) => (out ?? new THREE.Vector3()).set(id === 1 ? 0 : 10, 1, 0),
      fakeTextures(),
    );
    const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
    Object.assign(fx as unknown as Record<string, unknown>, {
      ribbons,
      sequencer: { start: vi.fn(() => null) },
      groundY: () => 0,
    });
    fx.sequenceBolt('shadow_bolt', GLOOM_BOLT_VFX_FULL_SPEC, 1, 2, 0x48f06f, 0.14744, 0, 1, 0.9215);
    ribbons.update(1 / 60, new THREE.Vector3(0, 5, 8));
    const colors: number[] = [];

    ribbons.drawHeads(0.1, (_x, _y, _z, color) => colors.push(color));

    expect(colors).toEqual(expect.arrayContaining([0xc5ff86, 0x06170c, 0x48f06f]));
    expect(colors).not.toEqual(expect.arrayContaining([0xb896e8, 0x16091f]));
  });

  it('lands the Ruinbolt-derived impact exactly when the real green trail reaches its target', () => {
    const h = travellingBoltHarness();

    h.fx.sequenceBolt(
      'shadow_bolt',
      GLOOM_BOLT_VFX_FULL_SPEC,
      1,
      2,
      0x48f06f,
      0.14744,
      0,
      1,
      0.9215,
    );
    for (let frame = 0; frame < 30; frame++) {
      h.ribbons.update(1 / 60, new THREE.Vector3(0, 5, 8));
    }

    expect(h.sequencer.triggerImpact).toHaveBeenCalledOnce();
    expect(h.sequencer.triggerImpact).toHaveBeenCalledWith(h.fx, h.slot, 10, 1, 0);
    expect(h.sequencer.cancel).not.toHaveBeenCalled();
  });

  it('cancels the impact sequence if the target disappears during travel', () => {
    const h = travellingBoltHarness();

    h.fx.sequenceBolt(
      'shadow_bolt',
      GLOOM_BOLT_VFX_FULL_SPEC,
      1,
      2,
      0x48f06f,
      0.14744,
      0,
      1,
      0.9215,
    );
    h.anchors.delete(2);
    h.ribbons.update(1 / 60, new THREE.Vector3(0, 5, 8));

    expect(h.sequencer.cancel).toHaveBeenCalledOnce();
    expect(h.sequencer.cancel).toHaveBeenCalledWith(h.slot);
    expect(h.sequencer.triggerImpact).not.toHaveBeenCalled();
  });
});
