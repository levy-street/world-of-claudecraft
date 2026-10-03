// The Sunken Bastion's floors as the online client predicts the local player
// across them (the live report: in the Lower Bailey only the player's head
// showed above the paving). The server's Sim stands the body on the authored
// field; the reconciling predictor replays the same kernel over the same
// groundHeight a few ticks ahead of each acknowledgement, and the drawn floor
// (the clipped terrain tops) sits where both put the feet.
import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import { drawnTopAt, planFieldTops } from '../src/render/authored_field/field_mesh_core';
import { MovementPredictionPipeline, type SelfPredictionWire } from '../src/render/self_prediction';
import type { MotionState } from '../src/render/self_prediction_core';
import { BAILEY_CHAPEL, SUNKEN_BASTION_FIELD } from '../src/sim/content/sunken_bastion_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { Sim } from '../src/sim/sim';
import { emptyMoveInput, type MoveInput, type Vec3 } from '../src/sim/types';

class BastionWire implements SelfPredictionWire {
  movementWireVersion: 1 | 2 = 2;
  onMovementWireNegotiated: ((version: 1 | 2, now: number) => void) | null = null;
  onMovementWireNeutral: ((now: number) => boolean) | null = null;
  reconAuthoritativeX: number | null = null;
  reconAuthoritativeY: number | null = null;
  reconAuthoritativeZ: number | null = null;
  reconAuthoritativeFacing: number | null = null;
  reconAckClientTick = -1;
  reconOverrideEpoch = 0;
  reconOverrideActive = false;
  reconMoveSpeedMult = 1;

  netPipeline() {
    return { noteReconcileOutcome: () => {} };
  }
  movementWireIsOpen(): boolean {
    return true;
  }
  sendMovementFrame(): boolean {
    return true;
  }
  acknowledge(ct: number, pose: Vec3, facing: number): void {
    this.reconAckClientTick = ct;
    this.reconAuthoritativeX = pose.x;
    this.reconAuthoritativeY = pose.y;
    this.reconAuthoritativeZ = pose.z;
    this.reconAuthoritativeFacing = facing;
  }
}

interface PipelineInternals {
  predictFrame(frame: InputTickFrame): void;
  predicted: MotionState | null;
}

/** A cleared Bastion run (every pack and boss dead, every gate open) and the
 *  slot origin its instance-local layout is drawn at. */
function clearedBastion(): { sim: Sim; origin: { x: number; z: number } } {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  const id = sim.player.id;
  for (const cmd of [
    '/dev level 20',
    '/dev god',
    '/dev bastion enter',
    '/dev bastion gates',
    '/dev bastion kill all',
    '/dev bastion tp landing',
  ]) {
    sim.chat(cmd, id);
    for (let t = 0; t < 4; t++) sim.tick();
  }
  // The landing arrival is instance-local (-10, -230).
  const origin = { x: sim.player.pos.x + 10, z: sim.player.pos.z + 230 };
  return { sim, origin };
}

const TOPS = planFieldTops(SUNKEN_BASTION_FIELD, { maxEdge: 3, layerLift: 0 });

describe('the Sunken Bastion floor, predicted online', () => {
  // The acknowledgement trails the prediction by a few ticks, as it does over
  // any real connection: the replayed ticks are the ones that would fall.
  const LAG = 4;

  const walks: {
    name: string;
    from: [number, number];
    facing: number;
    done: (lx: number, lz: number) => boolean;
    through: (lx: number, lz: number) => boolean;
  }[] = [
    {
      name: 'across the Lower Bailey into the moat and up onto the chapel island',
      from: [-46, -88],
      facing: Math.PI / 2,
      done: (lx) => lx > -12,
      through: (lx, lz) =>
        Math.hypot(lx - BAILEY_CHAPEL.x, lz - BAILEY_CHAPEL.z) < BAILEY_CHAPEL.moat - 1 &&
        Math.hypot(lx - BAILEY_CHAPEL.x, lz - BAILEY_CHAPEL.z) > BAILEY_CHAPEL.island + 1,
    },
    {
      name: 'from the Tidal Flats up the Sea Gate ramp into the bailey',
      from: [0, -150],
      facing: 0,
      done: (_lx, lz) => lz > -120,
      through: (_lx, lz) => lz > -130 && lz < -127,
    },
  ];

  for (const walk of walks) {
    it(`keeps the player on the drawn floor walking ${walk.name}`, () => {
      const { sim, origin } = clearedBastion();
      const p = sim.player;
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('meta');
      p.pos = sim.ctx.groundPos(origin.x + walk.from[0], origin.z + walk.from[1]);
      p.prevPos = { ...p.pos };
      p.facing = walk.facing;
      p.prevFacing = walk.facing;
      sim.rebucket(p);
      sim.tick();

      const wire = new BastionWire();
      const history = new Map<number, { pos: Vec3; facing: number }>();
      history.set(0, { pos: { ...p.pos }, facing: p.facing });
      wire.acknowledge(0, p.pos, p.facing);
      const pipeline = new MovementPredictionPipeline(sim.cfg.seed, sim.ctx.riftCollisionToken);
      const internals = pipeline as unknown as PipelineInternals;
      pipeline.prepare(wire, p, true);

      const forward: MoveInput = { ...emptyMoveInput(), forward: true };
      let worstPredicted = 0;
      let worstWalked = 0;
      let worstDrawn = 0;
      let crossed = false;
      let ct = 0;
      while (!walk.done(p.pos.x - origin.x, p.pos.z - origin.z) && ct < 900) {
        ct++;
        Object.assign(meta.moveInput, forward);
        sim.tick();
        history.set(ct, { pos: { ...p.pos }, facing: p.facing });
        internals.predictFrame({ ct, mi: forward, facing: null });
        const acked = history.get(ct - LAG);
        if (acked) wire.acknowledge(ct - LAG, acked.pos, acked.facing);
        const predicted = internals.predicted;
        if (!predicted) throw new Error('no prediction');
        const server = history.get(ct)?.pos ?? p.pos;
        worstPredicted = Math.max(worstPredicted, Math.abs(predicted.pos.y - server.y));
        const lx = server.x - origin.x;
        const lz = server.z - origin.z;
        if (p.onGround) {
          const walked = authoredFieldHeight(SUNKEN_BASTION_FIELD, lx, lz);
          worstWalked = Math.max(worstWalked, Math.abs(server.y - walked));
          const drawn = drawnTopAt(TOPS.stone, lx, lz);
          const drawnSoil = drawnTopAt(TOPS.soil, lx, lz);
          const top = Number.isNaN(drawn)
            ? drawnSoil
            : Number.isNaN(drawnSoil)
              ? drawn
              : Math.max(drawn, drawnSoil);
          worstDrawn = Math.max(worstDrawn, top - predicted.pos.y);
        }
        if (walk.through(lx, lz)) crossed = true;
      }
      expect(walk.done(p.pos.x - origin.x, p.pos.z - origin.z), 'reached the far side').toBe(true);
      expect(crossed, 'walked through the lower floor').toBe(true);
      expect(worstPredicted).toBeLessThan(1e-6);
      expect(worstWalked).toBeLessThan(1e-6);
      expect(worstDrawn).toBeLessThanOrEqual(0.05);
    });
  }
});
