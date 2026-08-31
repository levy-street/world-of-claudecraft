import { describe, expect, it } from 'vitest';
import {
  computeOverrideSignature,
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  overrideActive,
  updateMovementOverrideEpochs,
} from '../../server/movement_override_epoch';
import { Sim } from '../../src/sim/sim';
import { type Aura, DT, RUN_SPEED } from '../../src/sim/types';

function fixture(): { sim: Sim; session: MovementOverrideSessionState } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior' });
  return {
    sim,
    session: {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    },
  };
}

function aura(kind: Aura['kind'], id: string = kind, value = 0): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 1,
    duration: 1,
    value,
    sourceId: 0,
    school: 'physical',
  };
}

describe('computeOverrideSignature', () => {
  it('covers each crowd-control and forced-movement arm', () => {
    const { sim } = fixture();
    const entity = sim.player;
    const meta = sim.meta(entity.id)!;
    for (const kind of ['stun', 'root', 'incapacitate', 'polymorph'] as const) {
      entity.auras = [aura(kind)];
      expect(overrideActive(computeOverrideSignature(entity, meta, 1)), kind).toBe(true);
    }
    entity.auras = [];
    const forcedModes = [
      () => (entity.chargeTargetId = 2),
      () => (entity.followTargetId = 2),
      () => (entity.leap = {} as NonNullable<typeof entity.leap>),
      () => (entity.valkyrsCalling = {} as NonNullable<typeof entity.valkyrsCalling>),
      () => (meta.mountRace = { phase: 'countdown' } as NonNullable<typeof meta.mountRace>),
      () => (entity.climb = {} as NonNullable<typeof entity.climb>),
    ];
    for (const arm of forcedModes) {
      arm();
      expect(overrideActive(computeOverrideSignature(entity, meta, 1))).toBe(true);
      entity.chargeTargetId = null;
      entity.followTargetId = null;
      entity.leap = null;
      entity.valkyrsCalling = null;
      meta.mountRace = null;
      entity.climb = null;
    }
  });

  it('keeps death, ghost, swimming, and speed-only changes out of the active flag', () => {
    const { sim } = fixture();
    const entity = sim.player;
    entity.dead = true;
    entity.ghost = true;
    entity.pos.y = -100;
    expect(overrideActive(computeOverrideSignature(entity, sim.meta(entity.id)!, 1.75))).toBe(
      false,
    );
  });
});

describe('updateMovementOverrideEpochs', () => {
  it('drives every crowd-control and forced-movement arm through the live updater', () => {
    const { sim, session } = fixture();
    const entity = sim.player;
    const meta = sim.meta(entity.id)!;
    updateMovementOverrideEpochs(sim, [session]);

    for (const kind of ['stun', 'root', 'incapacitate', 'polymorph'] as const) {
      entity.auras = [aura(kind)];
      updateMovementOverrideEpochs(sim, [session]);
      expect(session.movementOverrideActive, kind).toBe(true);
      entity.auras = [];
      updateMovementOverrideEpochs(sim, [session]);
    }

    const forcedModes = [
      () => (entity.chargeTargetId = 2),
      () => (entity.followTargetId = 2),
      () => (entity.leap = {} as NonNullable<typeof entity.leap>),
      () => (entity.valkyrsCalling = {} as NonNullable<typeof entity.valkyrsCalling>),
      () => (meta.mountRace = { phase: 'countdown' } as NonNullable<typeof meta.mountRace>),
      () => (entity.climb = {} as NonNullable<typeof entity.climb>),
    ];
    for (const arm of forcedModes) {
      arm();
      updateMovementOverrideEpochs(sim, [session]);
      expect(session.movementOverrideActive).toBe(true);
      entity.chargeTargetId = null;
      entity.followTargetId = null;
      entity.leap = null;
      entity.valkyrsCalling = null;
      meta.mountRace = null;
      entity.climb = null;
      updateMovementOverrideEpochs(sim, [session]);
    }
  });

  it('classifies fear through the crowd-control arm with one aura scan', () => {
    const { sim, session } = fixture();
    const auras = [aura('incapacitate', 'fear_incap')];
    const some = auras.some.bind(auras);
    let scans = 0;
    auras.some = ((predicate: Parameters<typeof auras.some>[0]) => {
      scans++;
      return some(predicate);
    }) as typeof auras.some;
    sim.player.auras = auras;
    sim.moveSpeedMult(sim.player);
    const speedScans = scans;
    scans = 0;

    updateMovementOverrideEpochs(sim, [session]);

    expect(session.movementOverrideActive).toBe(true);
    expect(scans).toBe(speedScans + 1);
  });

  it('increments on signature transitions and exact speed multiplier changes', () => {
    const { sim, session } = fixture();
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(0);
    sim.player.auras.push(aura('root', 'test_root'));
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(1);
    expect(session.movementOverrideActive).toBe(true);
    sim.player.auras = [];
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(2);
    sim.player.auras.push(aura('buff_speed', 'test_speed', 1.5));
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(3);
    expect(session.movementOverrideActive).toBe(false);
    expect(session.movementMoveSpeedMult).toBe(1.5);
  });

  it('increments on teleports and knockbacks but not a maximum-speed intent step', () => {
    const { sim, session } = fixture();
    const entity = sim.player;
    updateMovementOverrideEpochs(sim, [session]);

    const legalStep = RUN_SPEED * sim.moveSpeedMult(entity) * DT;
    entity.prevPos = { ...entity.pos };
    entity.pos.x += legalStep;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(0);

    entity.pos.x += 2;
    entity.prevPos = { ...entity.pos };
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(1);

    entity.prevPos = { ...entity.pos };
    entity.pos.z += 1;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(2);
  });

  it('leaves movement v1 session state untouched', () => {
    const { sim, session } = fixture();
    session.movementWireVersion = 1;
    sim.player.chargeTargetId = 2;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session).toMatchObject(createMovementOverrideSessionState());
  });

  it('reuses the stored signature and authoritative position objects', () => {
    const { sim, session } = fixture();
    updateMovementOverrideEpochs(sim, [session]);
    const signature = session.movementOverrideSignature;
    const position = session.movementAuthoritativePosition;

    sim.player.auras.push(aura('root', 'test_root'));
    sim.player.pos.x += 1;
    updateMovementOverrideEpochs(sim, [session]);

    expect(session.movementOverrideSignature).toBe(signature);
    expect(session.movementAuthoritativePosition).toBe(position);
  });
});
