import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

interface NecromancyRendererHarness {
  handleEvent(event: SimEvent): void;
}

interface HarnessResult {
  renderer: NecromancyRendererHarness;
  abilityVfx: {
    handleSpellfx: ReturnType<typeof vi.fn>;
    handleSpellfxAt: ReturnType<typeof vi.fn>;
  };
  vfx: {
    lichTransform: ReturnType<typeof vi.fn>;
    deathBolt: ReturnType<typeof vi.fn>;
    projectile: ReturnType<typeof vi.fn>;
    soulTravel: ReturnType<typeof vi.fn>;
    burst: ReturnType<typeof vi.fn>;
  };
  audio: ReturnType<typeof vi.fn>;
  pulseAt: ReturnType<typeof vi.fn>;
  pulseMetamorphosis: ReturnType<typeof vi.fn>;
  desecration: ReturnType<typeof vi.fn>;
  armyPortal: ReturnType<typeof vi.fn>;
}

function makeHarness({
  lich = true,
  hands = true,
  reducedMotion = false,
}: {
  lich?: boolean;
  hands?: boolean;
  reducedMotion?: boolean;
} = {}): HarnessResult {
  const sourceId = 11;
  const targetId = 22;
  const pulseMetamorphosis = vi.fn();
  const handPositions = vi.fn((left: THREE.Vector3, right: THREE.Vector3) => {
    if (!hands) return false;
    left.set(-1, 2, 3);
    right.set(1, 2, 3);
    return true;
  });
  const source = {
    id: sourceId,
    kind: 'player',
    pos: { x: 4, y: 5, z: 6 },
    facing: Math.PI / 4,
    auras: lich ? [{ kind: 'form_lich' }] : [],
    castingAbility: null,
  };
  const target = {
    id: targetId,
    kind: 'mob',
    pos: { x: 8, y: 0, z: 9 },
    facing: 0,
    auras: [],
    castingAbility: null,
  };
  const vfx = {
    lichTransform: vi.fn(),
    deathBolt: vi.fn(),
    projectile: vi.fn(),
    soulTravel: vi.fn(),
    burst: vi.fn(),
  };
  const abilityVfx = {
    handleSpellfx: vi.fn(
      (event: Extract<SimEvent, { type: 'spellfx' }>) => event.ability !== 'unknown_shadow_spell',
    ),
    handleSpellfxAt: vi.fn(() => true),
  };
  const audio = vi.fn();
  const pulseAt = vi.fn();
  const desecration = vi.fn();
  const armyPortal = vi.fn();
  const renderer = Object.create(Renderer.prototype) as NecromancyRendererHarness & {
    vfx: typeof vfx;
    views: Map<
      number,
      {
        group: THREE.Group;
        metamorphVisual: {
          metamorphHandWorldPositions: typeof handPositions;
          pulseMetamorphosis: typeof pulseMetamorphosis;
        };
      }
    >;
    sim: {
      playerId: number;
      player: { id: number };
      entities: Map<number, typeof source | typeof target>;
      cfg: { seed: number };
    };
    audioSink: { necromancy: typeof audio };
    pulseAt: typeof pulseAt;
    addShake: ReturnType<typeof vi.fn>;
    punchFov: ReturnType<typeof vi.fn>;
    triggerAttack: ReturnType<typeof vi.fn>;
    activeVisual: ReturnType<typeof vi.fn>;
    spawnAoeRing: ReturnType<typeof vi.fn>;
    necromancyGroundFx: { spawnDesecration: typeof desecration };
    necromancyArmyPortalFx: { spawn: typeof armyPortal };
    abilityVfx: typeof abilityVfx;
    tmpV: THREE.Vector3;
    tmpV2: THREE.Vector3;
    reducedMotion(): boolean;
  };
  const group = new THREE.Group();
  group.position.copy(source.pos);
  renderer.vfx = vfx;
  renderer.views = new Map([
    [
      sourceId,
      {
        group,
        metamorphVisual: {
          metamorphHandWorldPositions: handPositions,
          pulseMetamorphosis,
        },
      },
    ],
  ]);
  renderer.sim = {
    playerId: sourceId,
    player: { id: sourceId },
    entities: new Map([
      [sourceId, source],
      [targetId, target],
    ]),
    cfg: { seed: 42 },
  };
  renderer.audioSink = { necromancy: audio };
  renderer.pulseAt = pulseAt;
  renderer.addShake = vi.fn();
  renderer.punchFov = vi.fn();
  renderer.triggerAttack = vi.fn();
  renderer.activeVisual = vi.fn();
  renderer.spawnAoeRing = vi.fn();
  renderer.necromancyGroundFx = { spawnDesecration: desecration };
  renderer.necromancyArmyPortalFx = { spawn: armyPortal };
  renderer.abilityVfx = abilityVfx;
  renderer.tmpV = new THREE.Vector3();
  renderer.tmpV2 = new THREE.Vector3();
  renderer.reducedMotion = () => reducedMotion;
  return {
    renderer,
    abilityVfx,
    vfx,
    audio,
    pulseAt,
    pulseMetamorphosis,
    desecration,
    armyPortal,
  };
}

describe('Necromancy renderer routing', () => {
  it('opens the bespoke three-lane portal before the pooled Army ritual', () => {
    const harness = makeHarness();
    const event: SimEvent = {
      type: 'spellfxAt',
      x: 7,
      z: 12,
      school: 'shadow',
      fx: 'burst',
      sourceId: 11,
      ability: 'army_of_the_dead',
    };

    harness.renderer.handleEvent(event);

    expect(harness.armyPortal).toHaveBeenCalledWith({
      x: 7,
      z: 12,
      facing: Math.PI / 4,
      duration: 2.8,
    });
    expect(harness.abilityVfx.handleSpellfxAt).toHaveBeenCalledWith(event);
  });

  it('does not open the Army portal unless both the ability and burst event match', () => {
    const wrongAbility = makeHarness();
    const otherShadowBurst: SimEvent = {
      type: 'spellfxAt',
      x: 7,
      z: 12,
      school: 'shadow',
      fx: 'burst',
      sourceId: 11,
      ability: 'soul_lance',
    };
    wrongAbility.renderer.handleEvent(otherShadowBurst);
    expect(wrongAbility.armyPortal).not.toHaveBeenCalled();
    expect(wrongAbility.abilityVfx.handleSpellfxAt).toHaveBeenCalledWith(otherShadowBurst);

    const wrongFx = makeHarness();
    const armyProjectile: SimEvent = {
      type: 'spellfxAt',
      x: 7,
      z: 12,
      school: 'shadow',
      fx: 'nova',
      sourceId: 11,
      ability: 'army_of_the_dead',
    };
    wrongFx.renderer.handleEvent(armyProjectile);
    expect(wrongFx.armyPortal).not.toHaveBeenCalled();
    expect(wrongFx.abilityVfx.handleSpellfxAt).toHaveBeenCalledWith(armyProjectile);
  });

  it('routes Lich transformation feedback and suppresses the burst for reduced motion', () => {
    const normal = makeHarness();
    normal.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 11,
      school: 'shadow',
      fx: 'lichTransform',
      ability: 'metamorphosis',
    });

    expect(normal.vfx.lichTransform).toHaveBeenCalledWith(11);
    expect(normal.pulseAt).toHaveBeenCalledWith(11, 'shadow', 8, 0.6);
    expect(normal.audio).toHaveBeenCalledWith('lichTransform', 4, 5, 6, true, 11);

    const reduced = makeHarness({ reducedMotion: true });
    reduced.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 11,
      school: 'shadow',
      fx: 'lichTransform',
      ability: 'metamorphosis',
    });
    expect(reduced.vfx.lichTransform).not.toHaveBeenCalled();
    expect(reduced.pulseAt).not.toHaveBeenCalled();
    expect(reduced.audio).toHaveBeenCalledOnce();
  });

  it('launches transformed Soul Harvest from both hands with safe fallbacks', () => {
    const transformed = makeHarness();
    transformed.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'soul_harvest',
    });

    expect(transformed.vfx.deathBolt).toHaveBeenCalledWith(
      expect.objectContaining({ x: -1, y: 2, z: 3 }),
      expect.objectContaining({ x: 1, y: 2, z: 3 }),
      22,
    );
    expect(transformed.vfx.projectile).not.toHaveBeenCalled();
    expect(transformed.abilityVfx.handleSpellfx).not.toHaveBeenCalled();
    expect(transformed.pulseMetamorphosis).toHaveBeenCalledOnce();

    const noHands = makeHarness({ hands: false });
    noHands.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'soul_harvest',
    });
    expect(noHands.vfx.projectile).toHaveBeenCalledWith(11, 22, 'shadow', 1.3);
    expect(noHands.vfx.deathBolt).not.toHaveBeenCalled();
    expect(noHands.abilityVfx.handleSpellfx).not.toHaveBeenCalled();

    const mortal = makeHarness({ lich: false });
    mortal.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'soul_harvest',
    });
    expect(mortal.vfx.deathBolt).not.toHaveBeenCalled();
    expect(mortal.abilityVfx.handleSpellfx).toHaveBeenCalledWith({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'soul_harvest',
    });
    expect(mortal.vfx.projectile).not.toHaveBeenCalled();

    const otherAbility = makeHarness();
    otherAbility.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'unknown_shadow_spell',
    });
    expect(otherAbility.vfx.deathBolt).not.toHaveBeenCalled();
    expect(otherAbility.vfx.projectile).toHaveBeenCalledWith(11, 22, 'shadow');
  });

  it('plays soul-consumption audio only when the soul reaches its owner', () => {
    const harness = makeHarness();
    harness.renderer.handleEvent({
      type: 'spellfxAt',
      x: 3,
      z: 4,
      school: 'shadow',
      fx: 'soulTravel',
      targetId: 11,
      ability: 'sacrifice_undead',
    });

    expect(harness.vfx.soulTravel).toHaveBeenCalledOnce();
    expect(harness.audio).not.toHaveBeenCalled();
    const onImpact = harness.vfx.soulTravel.mock.calls[0]?.[4] as
      | ((position: THREE.Vector3) => void)
      | undefined;
    expect(onImpact).toBeTypeOf('function');
    onImpact?.(new THREE.Vector3(4, 5, 6));
    expect(harness.audio).toHaveBeenCalledWith('soulConsume', 4, 5, 6, true, 11);
  });

  it('creates a longer desecration for transformed Corpse Explosion', () => {
    const event: SimEvent = {
      type: 'spellfxAt',
      x: 12,
      z: 14,
      school: 'shadow',
      fx: 'nova',
      radius: 8,
      sourceId: 11,
      ability: 'corpse_explosion',
    };
    const transformed = makeHarness();
    transformed.renderer.handleEvent(event);
    expect(transformed.desecration).toHaveBeenCalledWith({
      x: 12,
      z: 14,
      radius: 8,
      duration: 5,
    });
    expect(transformed.pulseMetamorphosis).toHaveBeenCalledOnce();

    const mortal = makeHarness({ lich: false });
    mortal.renderer.handleEvent(event);
    expect(mortal.desecration).toHaveBeenCalledWith({
      x: 12,
      z: 14,
      radius: 8,
      duration: 2.5,
    });
    expect(mortal.pulseMetamorphosis).not.toHaveBeenCalled();

    const missingSource = makeHarness();
    missingSource.renderer.handleEvent({ ...event, sourceId: undefined });
    expect(missingSource.desecration).not.toHaveBeenCalled();

    const otherAbility = makeHarness();
    otherAbility.renderer.handleEvent({ ...event, ability: 'shadowfury' });
    expect(otherAbility.desecration).not.toHaveBeenCalled();
  });
});
