import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { RUINBOLT_VFX_FULL_SPEC, RUINBOLT_VFX_SPEC } from '../src/render/destruction_vfx_specs';

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
  const windup = vi.fn(() => true);
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    windup,
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
  } as unknown as AbilityVfxFx;
  const projectile = vi.fn();
  const lightningProjectile = vi.fn();
  const vfx = {
    projectile,
    lightningProjectile,
    burst: vi.fn(),
    nova: vi.fn(),
    tick: vi.fn(),
    shoutwave: vi.fn(),
    buffSwirl: vi.fn(),
    beam: vi.fn(),
  };
  const painter = new AbilityVfx(
    {
      fx,
      vfx,
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
    },
    () => 0,
  );
  return { painter, projectile, lightningProjectile, sequenceBolt, windup };
}

function liveWindupHarness() {
  const push = vi.fn();
  const noopUpdate = { update: vi.fn() };
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  const state = fx as unknown as {
    windups: Map<number, unknown>;
  };
  Object.assign(fx as unknown as Record<string, unknown>, {
    qualityLevel: 1,
    time: 0,
    frame: 0,
    shakeRecent: 0,
    camRightX: 1,
    camRightZ: 0,
    camera: new THREE.PerspectiveCamera(),
    anchor: () => new THREE.Vector3(0, 1, 0),
    groundY: () => 0,
    screenFxQueue: [],
    ribbons: { update: vi.fn(), drawHeads: vi.fn() },
    rings: noopUpdate,
    flipbooks: noopUpdate,
    decals: { update: vi.fn(), setCameraPosition: vi.fn() },
    pillars: noopUpdate,
    shells: noopUpdate,
    groundAuras: noopUpdate,
    spirits: noopUpdate,
    overlay: { beginFrame: vi.fn(), push, commit: vi.fn() },
    sequencer: noopUpdate,
    windups: new Map(),
    orbits: new Map(),
    glows: new Map(),
    stunStars: new Map(),
    orbitBandCount: 0,
    applyGlow: null,
    // The release's CC band sweep in update() reads these; Object.create skips
    // the class field initializers, so the harness supplies them explicitly.
    ccBands: new Map(),
    ccPickIds: [],
    ccPickKeys: [],
    ccPickCount: 0,
  });
  return { fx, push, state };
}

describe('Ruinbolt premium VFX chain', () => {
  it('drives the production painter into the bespoke felLance sequence', () => {
    const h = painterHarness();

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'heavyBolt',
        ability: 'chaos_bolt',
      }),
    ).toBe(true);

    expect(h.projectile).not.toHaveBeenCalled();
    expect(h.sequenceBolt).toHaveBeenCalledOnce();
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      'chaos_bolt',
      RUINBOLT_VFX_FULL_SPEC,
      1,
      2,
      0x72ff38,
      expect.any(Number),
      0,
      1,
      2,
    );
    expect(RUINBOLT_VFX_FULL_SPEC.bolt).toMatchObject({
      style: 'felLance',
      speed: 26,
      coils: true,
      jagged: true,
    });
  });

  it('feeds three converging streams from the real cast progress and stops on interruption', () => {
    const h = painterHarness();
    const casting = {
      id: 1,
      castingAbility: 'chaos_bolt',
      castRemaining: 1.25,
      castTotal: 2.5,
      auras: [],
    };

    h.painter.syncEntity(casting);
    expect(h.windup).toHaveBeenCalledWith(1, 0x72ff38, 0.5, 'vortex', true, 3, 0xd8ff58);

    h.painter.syncEntity({
      ...casting,
      castingAbility: null,
      castRemaining: 0,
    });
    expect(h.windup).toHaveBeenCalledOnce();
  });

  it('draws all three production buildup streams and sweeps them after interruption', () => {
    const h = liveWindupHarness();

    expect(h.fx.windup(1, 0x72ff38, 0.5, 'vortex', true, 3, 0xd8ff58)).toBe(true);
    h.fx.update(1 / 60);

    expect(h.push).toHaveBeenCalledTimes(11);
    expect(h.push.mock.calls.filter((call) => call[3] === 0xd8ff58)).toHaveLength(3);
    expect(h.push.mock.calls.filter((call) => call[3] === 0x72ff38)).toHaveLength(8);

    h.push.mockClear();
    h.fx.update(1 / 60);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.state.windups.size).toBe(0);
  });

  it('renders a directional five-part felLance head rather than a glowing sphere', () => {
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
    const bolt = RUINBOLT_VFX_FULL_SPEC.bolt;
    if (!bolt) throw new Error('Ruinbolt bolt DNA missing');

    ribbons.spawnTrailStyled(1, 2, 0x72ff38, 0.32, {
      speed: bolt.speed ?? 26,
      style: bolt.style ?? 'comet',
      headSize: bolt.headScale ?? 1,
      coils: bolt.coils === true,
      jagTrail: bolt.jagged === true,
      forkEvery: bolt.forkEvery ?? 0,
      tracer: false,
      delay: 0,
      aimX: 0,
      aimY: 0,
      aimZ: 0,
      groundY: () => 0,
    });

    const head = vi.fn();
    ribbons.drawHeads(0, head);
    expect(head).toHaveBeenCalledTimes(5);
    expect(head.mock.calls[0][0]).toBeGreaterThan(head.mock.calls[1][0]);
    expect(head.mock.calls.filter((call) => call[3] === 0x0b3d1b)).toHaveLength(2);
    expect(head.mock.calls.map((call) => call[3])).toEqual(
      expect.arrayContaining([0x72ff38, 0x0b3d1b]),
    );
  });

  it('propagates target loss through the real ribbon termination callback exactly once', () => {
    const scene = new THREE.Scene();
    let targetAlive = true;
    const onArrive = vi.fn();
    const onTerminate = vi.fn();
    const ribbons = new AbilityVfxRibbons(
      scene,
      (id) => {
        if (id === 1) return new THREE.Vector3(0, 1, 0);
        if (id === 2 && targetAlive) return new THREE.Vector3(10, 1, 0);
        return null;
      },
      fakeTextures(),
    );

    ribbons.spawnTrailStyled(
      1,
      2,
      0x72ff38,
      0.32,
      {
        speed: 26,
        style: 'felLance',
        headSize: 1.65,
        coils: true,
        jagTrail: true,
        forkEvery: 0.1,
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

    targetAlive = false;
    ribbons.update(1 / 60, new THREE.Vector3());
    ribbons.update(1 / 60, new THREE.Vector3());
    expect(onTerminate).toHaveBeenCalledOnce();
    expect(onArrive).not.toHaveBeenCalled();
    const headsAfterTermination = vi.fn();
    ribbons.drawHeads(0.1, headsAfterTermination);
    expect(headsAfterTermination).not.toHaveBeenCalled();
  });

  it('turns production bolt cancellation into a small fizzle without an impact', () => {
    const slot = { active: true };
    const cancel = vi.fn(() => {
      slot.active = false;
    });
    const spawnTrailStyled = vi.fn();
    const particleBurst = vi.fn();
    const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
    Object.assign(fx as unknown as Record<string, unknown>, {
      sequencer: {
        start: vi.fn(() => slot),
        cancel,
        triggerImpact: vi.fn(),
      },
      ribbons: { spawnTrailStyled },
      groundY: () => 0,
      particleBurst,
    });

    fx.sequenceBolt('chaos_bolt', RUINBOLT_VFX_FULL_SPEC, 1, 2, 0x72ff38, 0.32, 0);
    const terminate = spawnTrailStyled.mock.calls[0][6] as (
      x: number,
      y: number,
      z: number,
    ) => void;
    terminate(4, 1, 3);

    expect(cancel).toHaveBeenCalledWith(slot);
    expect(slot.active).toBe(false);
    expect(particleBurst).toHaveBeenCalledWith(4, 1, 3, 0x72ff38, 6, 0.35, 'smoke');
    expect(particleBurst).toHaveBeenCalledWith(4, 1, 3, 0xd8ff58, 4, 0.3, 'embers');
    expect(RUINBOLT_VFX_SPEC.sp).toBe(52);
  });

  it('keeps the felLance silhouette but sheds garnish at degradation tier one', () => {
    const slot = { active: true };
    const spawnTrailStyled = vi.fn();
    const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
    Object.assign(fx as unknown as Record<string, unknown>, {
      sequencer: {
        start: vi.fn(() => slot),
        cancel: vi.fn(),
        triggerImpact: vi.fn(),
      },
      ribbons: { spawnTrailStyled },
      groundY: () => 0,
      particleBurst: vi.fn(),
    });

    fx.sequenceBolt('chaos_bolt', RUINBOLT_VFX_FULL_SPEC, 1, 2, 0x72ff38, 0.32, 1);

    expect(spawnTrailStyled).toHaveBeenCalledOnce();
    expect(spawnTrailStyled.mock.calls[0][4]).toMatchObject({
      speed: 26,
      style: 'felLance',
      coils: false,
      jagTrail: false,
      forkEvery: 0,
    });
  });

  it('falls back to one compact colored crack only at degradation tier two', () => {
    const h = painterHarness();

    for (let sourceId = 100; sourceId < 140; sourceId++) {
      expect(
        h.painter.handleSpellfx({
          sourceId,
          targetId: 2,
          school: 'shadow',
          fx: 'heavyBolt',
          ability: 'chaos_bolt',
        }),
      ).toBe(true);
    }
    expect(h.sequenceBolt.mock.calls.at(-1)?.[6]).toBe(1);

    h.sequenceBolt.mockClear();
    h.projectile.mockClear();
    h.lightningProjectile.mockClear();
    h.painter.handleSpellfx({
      sourceId: 140,
      targetId: 2,
      school: 'shadow',
      fx: 'heavyBolt',
      ability: 'chaos_bolt',
    });

    expect(h.sequenceBolt).not.toHaveBeenCalled();
    expect(h.projectile).not.toHaveBeenCalled();
    expect(h.lightningProjectile).toHaveBeenCalledOnce();
    expect(h.lightningProjectile).toHaveBeenCalledWith(140, 2, 0x72ff38);
  });
});
