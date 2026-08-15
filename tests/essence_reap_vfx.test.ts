import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { usesCrescendoScale } from '../src/render/ability_vfx/spectacle';
import {
  shouldDrawLegacyCastSparkle,
  syncAbilityVfxCast,
} from '../src/render/ability_vfx_registry';
import { RUINBOLT_VFX_FULL_SPEC } from '../src/render/destruction_vfx_specs';
import {
  ESSENCE_REAP_VFX_FULL_SPEC,
  ESSENCE_REAP_VFX_SPEC,
  SOUL_LANCE_VFX_FULL_SPEC,
} from '../src/render/necromancy_vfx_specs';
import { ABILITIES } from '../src/sim/content/classes';

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

function painterHarness(now: () => number = () => 0) {
  const sequenceBolt = vi.fn();
  const windup = vi.fn(() => true);
  const update = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    windup,
    update,
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
  } as unknown as AbilityVfxFx;
  const projectile = vi.fn();
  const lightningProjectile = vi.fn();
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile,
        lightningProjectile,
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
    now,
  );
  return { painter, projectile, lightningProjectile, sequenceBolt, windup, update };
}

function spawnEssenceReapRibbon(
  ribbons: AbilityVfxRibbons,
  onArrive: ((x: number, y: number, z: number) => void) | null = null,
  onTerminate: ((x: number, y: number, z: number) => void) | null = null,
): void {
  ribbons.spawnTrailStyled(
    1,
    2,
    0x6f42b5,
    0.15424,
    {
      speed: 26,
      style: 'essenceLance',
      headSize: 0.964,
      coreHex: 0x25143a,
      accentHex: 0x80d8d2,
      coils: true,
      jagTrail: false,
      forkEvery: 0,
      tracer: false,
      delay: 0,
      aimX: 0,
      aimY: 0,
      aimZ: 0,
      groundY: () => 0,
    },
    onArrive,
    onTerminate,
  );
}

describe('Essence Reap premium filler VFX', () => {
  it('preserves the exact existing filler gameplay contract', () => {
    const ability = ABILITIES.soul_harvest;
    expect(ability).toMatchObject({
      id: 'soul_harvest',
      name: 'Essence Reap',
      learnLevel: 1,
      cost: 30,
      castTime: 1.8,
      cooldown: 0,
      range: 30,
      school: 'shadow',
      requiresTarget: true,
    });
    expect(ability.effects).toEqual([
      { type: 'directDamage', min: 16, max: 20 },
      { type: 'gainSoulFragments', amount: 1 },
    ]);
    expect(ability.ranks).toEqual([
      {
        rank: 2,
        level: 10,
        cost: 45,
        effects: [
          { type: 'directDamage', min: 32, max: 39 },
          { type: 'gainSoulFragments', amount: 1 },
        ],
      },
      {
        rank: 3,
        level: 20,
        cost: 55,
        effects: [
          { type: 'directDamage', min: 44, max: 55 },
          { type: 'gainSoulFragments', amount: 1 },
        ],
      },
    ]);
  });

  it('claims the existing projectile with a restrained derivative of Soul Lance DNA', () => {
    const h = painterHarness();

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'projectile',
        ability: 'soul_harvest',
      }),
    ).toBe(true);

    expect(h.projectile).not.toHaveBeenCalled();
    expect(h.lightningProjectile).not.toHaveBeenCalled();
    expect(h.sequenceBolt).toHaveBeenCalledOnce();
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      'soul_harvest',
      ESSENCE_REAP_VFX_FULL_SPEC,
      1,
      2,
      0x6f42b5,
      expect.any(Number),
      0,
      1,
      expect.any(Number),
    );
    const sequenceCall = h.sequenceBolt.mock.calls[0];
    expect(sequenceCall[5]).toBeCloseTo(0.15424, 6);
    expect(sequenceCall[8]).toBeCloseTo(0.964, 6);
    expect(ESSENCE_REAP_VFX_FULL_SPEC).toMatchObject({
      filler: true,
      screenFx: false,
      bolt: {
        style: 'essenceLance',
        speed: 26,
        coils: true,
        jagged: false,
        tracer: false,
      },
      impact: {
        focused: true,
        flipbook: false,
        ring: false,
        smoke: true,
      },
    });
    expect(ESSENCE_REAP_VFX_SPEC.pw).toBeLessThan(SOUL_LANCE_VFX_FULL_SPEC.power ?? 0);
    expect(ESSENCE_REAP_VFX_FULL_SPEC.bolt?.headScale).toBeLessThan(
      SOUL_LANCE_VFX_FULL_SPEC.bolt?.headScale ?? 0,
    );
    expect(ESSENCE_REAP_VFX_FULL_SPEC.impact?.sparks).toBeLessThan(
      SOUL_LANCE_VFX_FULL_SPEC.impact?.sparks ?? 0,
    );
    expect(ESSENCE_REAP_VFX_SPEC.pw).toBeLessThan(RUINBOLT_VFX_FULL_SPEC.power ?? 0);
    expect(usesCrescendoScale(ESSENCE_REAP_VFX_FULL_SPEC)).toBe(false);
    expect(usesCrescendoScale(RUINBOLT_VFX_FULL_SPEC)).toBe(true);
  });

  it('feeds two compact streams from real cast progress and stops refreshing on interruption', () => {
    const h = painterHarness();
    const casting = {
      id: 1,
      castingAbility: 'soul_harvest',
      castRemaining: 0.45,
      castTotal: 1.8,
      auras: [],
    };

    h.painter.syncEntity(casting);
    expect(h.windup).toHaveBeenCalledWith(1, 0x6f42b5, 0.75, 'compression', true, 2, 0xd8d0ea);

    h.painter.syncEntity({
      ...casting,
      castingAbility: null,
      castRemaining: 0,
    });
    expect(h.windup).toHaveBeenCalledOnce();
  });

  it('renders a compact bone-spear silhouette like Soul Lance instead of a round orb', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const bolt = ESSENCE_REAP_VFX_FULL_SPEC.bolt;
    if (!bolt) throw new Error('Essence Reap bolt DNA missing');

    spawnEssenceReapRibbon(ribbons);

    const head = vi.fn();
    ribbons.drawHeads(0, head);
    expect(head).toHaveBeenCalledTimes(7);
    expect(head.mock.calls[0][0]).toBeGreaterThan(head.mock.calls[1][0]);
    expect(head.mock.calls.map((call) => call[3])).toEqual(
      expect.arrayContaining([0xf2f0ff, 0x6f42b5, 0x25143a, 0x80d8d2]),
    );
    expect(head.mock.calls.every((call) => call[4] <= 0.47)).toBe(true);
    expect(head.mock.calls.every((call) => call[4] >= 0.1)).toBe(true);
    expect(head.mock.calls.every((call) => call[6] >= 0.7)).toBe(true);
    expect(head.mock.calls.every((call) => call[7] >= 1.6)).toBe(true);
  });

  it('keeps the tapered wake compact at both low and high frame sampling rates', () => {
    function wakeSpanAt(fps: number): number {
      const scene = new THREE.Scene();
      const anchors = new Map([
        [1, new THREE.Vector3(0, 1, 0)],
        [2, new THREE.Vector3(20, 1, 0)],
      ]);
      const ribbons = new AbilityVfxRibbons(
        scene,
        (id) => anchors.get(id)?.clone() ?? null,
        fakeTextures(),
      );
      spawnEssenceReapRibbon(ribbons);
      for (let frame = 0; frame < Math.round(0.3 * fps); frame++) {
        ribbons.update(1 / fps, new THREE.Vector3(0, 4, 8));
      }
      const trailState = ribbons as unknown as {
        trails: Array<{
          active: boolean;
          head: THREE.Vector3;
        }>;
        v: number;
      };
      const trail = trailState.trails.find((candidate) => candidate.active);
      if (!trail) throw new Error('Essence Reap trail ended before cadence probe');
      const positions = (scene.children[0] as THREE.Mesh).geometry.getAttribute('position');
      let oldestRenderedX = Number.POSITIVE_INFINITY;
      for (let vertex = 0; vertex < trailState.v; vertex++) {
        oldestRenderedX = Math.min(oldestRenderedX, positions.getX(vertex));
      }
      return trail.head.x - oldestRenderedX;
    }

    const at60Hz = wakeSpanAt(60);
    const at240Hz = wakeSpanAt(240);
    expect(at60Hz).toBeGreaterThanOrEqual(2.8);
    expect(at240Hz).toBeGreaterThanOrEqual(2.8);
    expect(Math.abs(at60Hz - at240Hz)).toBeLessThan(0.45);
    expect(at60Hz).toBeLessThanOrEqual(3.25);
    expect(at240Hz).toBeLessThanOrEqual(3.25);
  });

  it('keeps the directional read but removes fast coils and pulsing for reduced motion', () => {
    function drawCount(reducedMotion: boolean): number {
      const scene = new THREE.Scene();
      const anchors = new Map([
        [1, new THREE.Vector3(0, 1, 0)],
        [2, new THREE.Vector3(10, 1, 0)],
      ]);
      const ribbons = new AbilityVfxRibbons(
        scene,
        (id) => anchors.get(id)?.clone() ?? null,
        fakeTextures(),
      );
      spawnEssenceReapRibbon(ribbons);
      ribbons.update(1 / 60, new THREE.Vector3(0, 4, 8), reducedMotion);
      const head = vi.fn();
      ribbons.drawHeads(1, head, reducedMotion);
      expect(head).toHaveBeenCalledTimes(7);
      return (scene.children[0] as THREE.Mesh).geometry.drawRange.count;
    }

    const normal = drawCount(false);
    const reduced = drawCount(true);
    expect(reduced).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(reduced);

    function headSizesAt(time: number, reducedMotion: boolean): number[] {
      const ribbons = new AbilityVfxRibbons(
        new THREE.Scene(),
        (id) =>
          id === 1 ? new THREE.Vector3(0, 1, 0) : id === 2 ? new THREE.Vector3(10, 1, 0) : null,
        fakeTextures(),
      );
      spawnEssenceReapRibbon(ribbons);
      const trail = (
        ribbons as unknown as { trails: Array<{ active: boolean; seed: number }> }
      ).trails.find((candidate) => candidate.active);
      if (!trail) throw new Error('Essence Reap head missing');
      trail.seed = 0;
      const head = vi.fn();
      ribbons.drawHeads(time, head, reducedMotion);
      return head.mock.calls.map((call) => call[4] as number);
    }

    expect(headSizesAt(0, true)).toEqual(headSizesAt(Math.PI / 80, true));
    expect(headSizesAt(0, false)).not.toEqual(headSizesAt(Math.PI / 80, false));
  });

  it('keeps a reduced-motion compression windup stable at fixed cast progress', () => {
    function compressionDrawAt(time: number, reducedMotion: boolean) {
      const push = vi.fn();
      const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
      Object.assign(fx as unknown as Record<string, unknown>, {
        time,
        qualityLevel: 1,
        anchor: () => new THREE.Vector3(0, 1, 0),
        overlay: { push },
      });
      (
        fx as unknown as {
          drawWindup(
            entityId: number,
            style: string,
            colorHex: number,
            progress: number,
            streams: number,
            accentHex: number,
            reducedMotion: boolean,
          ): void;
        }
      ).drawWindup(1, 'compression', 0x6f42b5, 0.5, 2, 0xd8d0ea, reducedMotion);
      return push.mock.calls;
    }

    expect(compressionDrawAt(0, true)).toEqual(compressionDrawAt(1, true));
    expect(compressionDrawAt(0, false)).not.toEqual(compressionDrawAt(1, false));
  });

  it('keeps every normal-frequency repeated cast at full quality without accumulation pressure', () => {
    let now = 0;
    const h = painterHarness(() => now);

    for (let cast = 0; cast < 8; cast++) {
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'projectile',
        ability: 'soul_harvest',
      });
      now += 1.8;
    }

    expect(h.sequenceBolt).toHaveBeenCalledTimes(8);
    expect(h.sequenceBolt.mock.calls.every((call) => call[6] === 0)).toBe(true);
  });

  it('turns target loss into one compact dissipation and never lands the impact', () => {
    const slot = { active: true };
    const cancel = vi.fn(() => {
      slot.active = false;
    });
    const spawnTrailStyled = vi.fn();
    const particleBurst = vi.fn();
    const triggerImpact = vi.fn();
    const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
    Object.assign(fx as unknown as Record<string, unknown>, {
      sequencer: {
        start: vi.fn(() => slot),
        cancel,
        triggerImpact,
      },
      ribbons: { spawnTrailStyled },
      groundY: () => 0,
      particleBurst,
    });

    fx.sequenceBolt('soul_harvest', ESSENCE_REAP_VFX_FULL_SPEC, 1, 2, 0x6f42b5, 0.24, 0);
    const terminate = spawnTrailStyled.mock.calls[0][6] as (
      x: number,
      y: number,
      z: number,
    ) => void;
    terminate(4, 1, 3);

    expect(cancel).toHaveBeenCalledWith(slot);
    expect(triggerImpact).not.toHaveBeenCalled();
    expect(particleBurst).toHaveBeenCalledWith(4, 1, 3, 0x6f42b5, 6, 0.35, 'smoke');
    expect(particleBurst).toHaveBeenCalledWith(4, 1, 3, 0xd8d0ea, 4, 0.3, 'embers');
  });

  it('releases its pooled trail slot exactly once after natural arrival', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(5, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const arrive = vi.fn();
    const terminate = vi.fn();
    spawnEssenceReapRibbon(ribbons, arrive, terminate);

    for (let frame = 0; frame < 30; frame++) {
      ribbons.update(1 / 60, new THREE.Vector3(0, 4, 8));
    }
    const head = vi.fn();
    ribbons.drawHeads(1, head);

    expect(arrive).toHaveBeenCalledOnce();
    expect(terminate).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });

  it('terminates once when the real target anchor disappears', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(8, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const arrive = vi.fn();
    const terminate = vi.fn();
    spawnEssenceReapRibbon(ribbons, arrive, terminate);

    anchors.delete(2);
    ribbons.update(1 / 60, new THREE.Vector3(0, 4, 8));
    ribbons.update(1 / 60, new THREE.Vector3(0, 4, 8));

    expect(arrive).not.toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('recycles the fixed trail pool across repeated normal-frequency casts', () => {
    const scene = new THREE.Scene();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(5, 1, 0)],
    ]);
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => anchors.get(id)?.clone() ?? null,
      fakeTextures(),
    );
    const arrive = vi.fn();
    const terminate = vi.fn();

    for (let cast = 0; cast < 24; cast++) {
      spawnEssenceReapRibbon(ribbons, arrive, terminate);
      for (let frame = 0; frame < Math.round(1.8 * 60); frame++) {
        ribbons.update(1 / 60, new THREE.Vector3(0, 4, 8));
      }
    }

    const activeTrails = (
      ribbons as unknown as { trails: Array<{ active: boolean }> }
    ).trails.filter((trail) => trail.active);
    expect(arrive).toHaveBeenCalledTimes(24);
    expect(terminate).not.toHaveBeenCalled();
    expect(activeTrails).toHaveLength(0);
  });

  it('wires real renderer sync, sparkle suppression, and reduced-motion updates', () => {
    const h = painterHarness();
    const casting = {
      id: 1,
      castingAbility: 'soul_harvest',
      castRemaining: 0.9,
      castTotal: 1.8,
      auras: [],
    };

    expect(syncAbilityVfxCast('soul_harvest', h.painter, casting)).toBe(true);
    expect(h.windup).toHaveBeenCalledOnce();
    expect(
      syncAbilityVfxCast('shadow_bolt', h.painter, {
        ...casting,
        castingAbility: 'shadow_bolt',
      }),
    ).toBe(true);
    expect(h.windup).toHaveBeenCalledTimes(2);
    expect(shouldDrawLegacyCastSparkle(true, 'soul_harvest')).toBe(false);
    expect(shouldDrawLegacyCastSparkle(true, 'shadow_bolt')).toBe(false);
    expect(shouldDrawLegacyCastSparkle(false, 'shadow_bolt')).toBe(false);

    h.painter.update(1 / 60, true);
    expect(h.update).toHaveBeenCalledWith(1 / 60, true);

    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );

    expect(rendererSource).toContain(
      'if (!syncAbilityVfxCast(e.castingAbility, this.abilityVfx, e))',
    );
    expect(rendererSource).toContain(
      'if (shouldDrawLegacyCastSparkle(st.casting, e.castingAbility))',
    );
    expect(
      rendererSource.match(/this\.abilityVfx\.update\(dt, this\.reducedMotion\(\)\);/g),
    ).toHaveLength(2);
  });
});
