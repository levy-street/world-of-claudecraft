// The Forgefather's Isle LIVE-KERNEL route gate: a real Sim walks the
// fortress with actual movement input, so every gate the engine applies
// (tread step-up commits, the steep-ground control strip, the terrain wall
// gate, blocker clearance) is exercised for real instead of modeled. This
// is the suite that catches what the geometric walkability model cannot:
// the tier-three trench froze a platform-stander with zero displacement in
// all eight directions while every static scan read the court as walkable,
// and the bailey towers' square colliders pinched that flight shut. Slow
// by nature (one shared world, ~90 sim-seconds of walking): keep new legs
// on the shared Sim and keep each leg's tick budget tight.
import { beforeAll, describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const input = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

let sim: Sim;

function tickWith(over: Partial<MoveInput>): void {
  const meta = (sim as any).players.get(sim.player.id);
  Object.assign(meta.moveInput, input(over));
  sim.player.hp = sim.player.maxHp; // the walk is a movement probe, never a fight
  sim.tick();
}

function seat(x: number, z: number, yGuess: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = yGuess;
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = false;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  for (let i = 0; i < 30; i++) tickWith({});
}

function walk(dirX: number, dirZ: number, seconds: number): void {
  sim.player.facing = Math.atan2(dirX, dirZ);
  const ticks = Math.round(seconds * 20);
  for (let i = 0; i < ticks; i++) tickWith({ forward: true });
}

beforeAll(() => {
  sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(60);
  // Park every mob near the fortress far away so aggro and knockback never
  // pollute the movement measurements.
  for (const e of (sim as any).entities.values()) {
    if (e === sim.player) continue;
    // Mobs only: sweeping every hp-bearing entity also carried off the
    // raid DOOR object, which un-wired the door leg below.
    if (e.kind !== 'mob') continue;
    if (Math.hypot(e.pos.x - 490, e.pos.z - 2225) < 150) {
      e.pos.x -= 3000;
      e.prevPos = { ...e.pos };
    }
  }
}, 120_000);

describe('forgefather fortress live-kernel route', () => {
  it('climbs the bailey stair from the forecourt to the middle court', () => {
    seat(507.8, 2203.0, 4);
    walk(0, 1, 12);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeGreaterThan(2211.5);
    expect(sim.player.pos.y).toBeGreaterThan(6.5);
  });

  it('climbs the court stair onto tier three', () => {
    seat(504.1, 2217.3, 8);
    walk(0, 1, 10);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeGreaterThan(2225.5);
    expect(sim.player.pos.y).toBeGreaterThan(11.3);
  });

  it('crosses tier three north over the old trench band', () => {
    seat(504.0, 2225.5, 12.2);
    walk(0, 1, 8);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeGreaterThan(2231.5);
  });

  it('climbs the upper and keep stairs to the keep threshold', () => {
    // The keep tower's drum crowns the summit: the keep stair deliberately
    // ends AT the tower's south face (the future raid-door threshold), so
    // arrival means the top treads, not ground past the drum.
    seat(503.35, 2231.6, 12.2);
    walk(0, 1, 16);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeGreaterThan(2242.3);
    expect(sim.player.pos.y).toBeGreaterThan(17.9);
  });

  it('descends the bailey stair back to the forecourt', () => {
    seat(507.8, 2210.8, 8);
    walk(0, -1, 10);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeLessThan(2204);
  });

  it('descends from the keep threshold to the landing court', () => {
    seat(503.05, 2244.2, 19.5);
    walk(0, -1, 10);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeLessThan(2239);
  });

  it('descends the court stair back to the middle court', () => {
    seat(504.1, 2225.4, 12.2);
    walk(0, -1, 10);
    expect(
      sim.player.pos.z,
      `stalled at (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`,
    ).toBeLessThan(2218);
  });

  it('walking into the keep face trips the raid door trigger', () => {
    // The owner's chosen raid entrance: the keep tower's south face at the
    // top of the keep stair. Walking north into the doorway must reach the
    // door trigger: a raid group zones in, and a solo walker gets the
    // convert-to-raid refusal, which equally proves the trigger fired.
    seat(503.05, 2242.4, 19.3);
    sim.player.facing = 0;
    let doorReached = false;
    for (let i = 0; i < 80 && !doorReached; i++) {
      const meta = (sim as any).players.get(sim.player.id);
      Object.assign(meta.moveInput, input({ forward: true }));
      sim.player.hp = sim.player.maxHp;
      for (const ev of sim.tick() as Array<{ type: string; text?: string }>)
        if (ev.type === 'error' && String(ev.text ?? '').includes('raid group')) doorReached = true;
      if (sim.player.pos.x > 1000) doorReached = true;
    }
    expect(
      doorReached,
      `door never triggered; body at (${sim.player.pos.x.toFixed(1)}, ${sim.player.pos.z.toFixed(1)})`,
    ).toBe(true);
  });

  it('is never penned at the reported stuck spot (503, 2226)', () => {
    // The original report: zero displacement in every direction. Require
    // real freedom: most directions move, and at least one moves far.
    const moved: number[] = [];
    for (const [dx, dz] of [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, -1],
      [-1, 0],
      [-1, 1],
    ] as const) {
      seat(503, 2226, 13);
      const start = { x: sim.player.pos.x, z: sim.player.pos.z };
      walk(dx, dz, 2.5);
      moved.push(Math.hypot(sim.player.pos.x - start.x, sim.player.pos.z - start.z));
    }
    const free = moved.filter((d) => d >= 1).length;
    expect(
      free,
      `displacements: ${moved.map((d) => d.toFixed(2)).join(', ')}`,
    ).toBeGreaterThanOrEqual(4);
    expect(Math.max(...moved)).toBeGreaterThan(2);
  });
});
