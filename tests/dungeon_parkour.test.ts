import { describe, expect, it } from 'vitest';
import { groundCueY } from '../src/render/dais_lift';
import { supportHeightAt } from '../src/sim/colliders';
import { DELVE_BAND_X_MIN, DUNGEON_FLOOR_Y, DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  CRYPT_LAYOUT,
  DAIS_HEIGHT,
  daisLiftAt,
  layoutColliders,
  NYTHRAXIS_LAYOUT,
  TEMPLE_LAYOUT,
  TOMB_CARGO_BOX_TIER,
  TOMB_CARGO_BOX_TOP,
  TOMB_CARGO_STACK_TIER,
  TOMB_CARGO_STACK_TOP,
  TOMB_COFFIN_DECORATED_EAVE,
  TOMB_COFFIN_DECORATED_TOP,
  TOMB_COFFIN_PLAIN_EAVE,
  TOMB_COFFIN_PLAIN_TOP,
  tombSlotRoll,
} from '../src/sim/dungeon_layout';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Dungeon interiors run the same traversal physics as the open world: the
// boss dais is REAL elevation (walked up like a kerb, stood on by mobs and
// players alike), and the wall-side furniture (coffin lids, cargo stacks)
// carries standable tops matched per slot to the props the renderer draws.

const SEED = 42;

const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function simWithPlayerAt(x: number, z: number, facing: number): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  return sim;
}

function hold(sim: Sim, input: Partial<MoveInput>, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, IDLE, input);
    sim.tick();
  }
}

describe('the boss dais is real elevation', () => {
  it('lifts the interior floor only inside a raised dais', () => {
    expect(daisLiftAt(CRYPT_LAYOUT, CRYPT_LAYOUT.dais.x, CRYPT_LAYOUT.dais.z)).toBe(DAIS_HEIGHT);
    expect(daisLiftAt(CRYPT_LAYOUT, 0, 40)).toBe(0);
    // The raid room's own dais stays flat, but its two flanking platforms
    // (the crypt's dais object reused, v0.42.2) are real elevation whatever
    // daisRaised says: the sigil stages the tank drags him onto.
    expect(daisLiftAt(NYTHRAXIS_LAYOUT, 0, NYTHRAXIS_LAYOUT.dais.z)).toBe(0);
    expect(NYTHRAXIS_LAYOUT.daisRaised).toBeUndefined();
    for (const platform of NYTHRAXIS_LAYOUT.platforms ?? []) {
      expect(daisLiftAt(NYTHRAXIS_LAYOUT, platform.x, platform.z)).toBe(DAIS_HEIGHT);
      expect(daisLiftAt(NYTHRAXIS_LAYOUT, platform.x + platform.r + 0.01, platform.z)).toBe(0);
      // Edge inclusive, like the dais.
      expect(daisLiftAt(NYTHRAXIS_LAYOUT, platform.x + platform.r, platform.z)).toBe(DAIS_HEIGHT);
    }
    expect(NYTHRAXIS_LAYOUT.platforms).toHaveLength(2);
    // The crypt's raised dais object reused, radius included.
    for (const platform of NYTHRAXIS_LAYOUT.platforms ?? []) {
      expect(platform.r).toBe(CRYPT_LAYOUT.dais.r);
    }
    // In line with the boss spawn, which the sigil anchors on: the shared
    // z lives in three files, so it is pinned here.
    expect(DUNGEONS.nythraxis_boss_arena.spawns.map((s) => [s.x, s.z])).toEqual([[0, 96]]);
    expect(NYTHRAXIS_LAYOUT.platforms?.map((pl) => pl.z)).toEqual([96, 96]);
  });

  it('stands the raid on the flanking platforms in world coordinates', () => {
    const o = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 0);
    expect(NYTHRAXIS_LAYOUT.platforms).toHaveLength(2);
    for (const platform of NYTHRAXIS_LAYOUT.platforms ?? []) {
      expect(groundHeight(o.x + platform.x, o.z + platform.z, SEED)).toBeCloseTo(
        DUNGEON_FLOOR_Y + DAIS_HEIGHT,
        6,
      );
    }
    const d = NYTHRAXIS_LAYOUT.dais;
    expect(groundHeight(o.x + d.x, o.z + d.z, SEED)).toBeCloseTo(DUNGEON_FLOOR_Y, 6);
  });

  it('lifts a flat ground cue straddling a platform rim onto the block tops', () => {
    const o = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 0);
    const platform = (NYTHRAXIS_LAYOUT.platforms ?? [])[0];
    const ground = (x: number, z: number) => groundHeight(x, z, SEED);
    const top = DUNGEON_FLOOR_Y + DAIS_HEIGHT;
    // A 3 yd flame patch centred 1 yd outside the rim: floor under its
    // centre, blocks under a third of it. It draws at the block tops.
    const cx = o.x + platform.x + platform.r + 1;
    const cz = o.z + platform.z;
    expect(groundHeight(cx, cz, SEED)).toBeCloseTo(DUNGEON_FLOOR_Y, 6);
    expect(groundCueY(ground, cx, cz, 3)).toBeCloseTo(top, 6);
    // Centred on the blocks near the rim: on the blocks, no sinking for the
    // floor beside them.
    expect(groundCueY(ground, o.x + platform.x + platform.r - 1, cz, 3)).toBeCloseTo(top, 6);
    // Clear of the rim by more than the radius: plain floor, as before.
    expect(groundCueY(ground, cx + 2.5, cz, 3)).toBeCloseTo(DUNGEON_FLOOR_Y, 6);
  });

  it('groundHeight stands everything on the stage, in world coordinates', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    expect(groundHeight(o.x + d.x, o.z + d.z, SEED)).toBeCloseTo(DUNGEON_FLOOR_Y + DAIS_HEIGHT, 6);
    expect(groundHeight(o.x, o.z + 40, SEED)).toBeCloseTo(DUNGEON_FLOOR_Y, 6);
  });

  it('a player WALKS up the dais rim, no jump, and walks back off', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    const sim = simWithPlayerAt(o.x + d.x, o.z + d.z - d.r - 2, 0); // south of the rim, facing +z
    const p = sim.player;
    hold(sim, { forward: true }, 40); // 2 s at run speed crosses the rim
    expect(p.onGround).toBe(true);
    expect(p.pos.y).toBeCloseTo(DUNGEON_FLOOR_Y + DAIS_HEIGHT, 3);
    // Turn around and walk off: the step-down is a stride too, never a fall.
    p.facing = Math.PI;
    let wentAirborne = false;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    for (let i = 0; i < 60; i++) {
      Object.assign(meta.moveInput, IDLE, { forward: true });
      sim.tick();
      if (!p.onGround) wentAirborne = true;
    }
    expect(p.pos.y).toBeCloseTo(DUNGEON_FLOOR_Y, 3);
    expect(wentAirborne).toBe(false);
  });

  it('a jump arcs onto the dais instead of bouncing off its rim', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    const sim = simWithPlayerAt(o.x + d.x, o.z + d.z - d.r - 1.2, 0);
    const p = sim.player;
    hold(sim, { forward: true, jump: true }, 30);
    expect(p.pos.y).toBeGreaterThanOrEqual(DUNGEON_FLOOR_Y + DAIS_HEIGHT - 1e-3);
  });
});

describe('dungeon furniture is standable per its real dressing', () => {
  it('temple altar slots stay full-height walls (no dressing, no top)', () => {
    const cols = layoutColliders(TEMPLE_LAYOUT, undefined, 0);
    const tombs = cols.filter((c) => c.type === 'obb' && c.hw === 1.1);
    expect(tombs.length).toBeGreaterThan(0);
    for (const t of tombs) expect(t.moveTopY).toBeUndefined();
  });

  it('a jumping player mantles onto a Hollow Crypt coffin lid hump', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const t = CRYPT_LAYOUT.tombs[0]; // (-19, 16), against the west wall
    const roll = tombSlotRoll(t.x, t.z);
    const plain = roll < 0.55;
    const top = plain ? TOMB_COFFIN_PLAIN_TOP : TOMB_COFFIN_DECORATED_TOP;
    const eave = plain ? TOMB_COFFIN_PLAIN_EAVE : TOMB_COFFIN_DECORATED_EAVE;
    // Approach from the aisle side, facing the wall (-x): the lid is a hump
    // ridging along the coffin's length, so the body lands somewhere on the
    // slope between the plinth edge and the crest and can walk up it.
    const sim = simWithPlayerAt(o.x + t.x + 3.2, o.z + t.z, -Math.PI / 2);
    const p = sim.player;
    let onLid = false;
    for (let i = 0; i < 100 && !onLid; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - DUNGEON_FLOOR_Y;
      if (p.onGround && rel > eave - 0.05 && rel <= top + 0.05) onLid = true;
    }
    expect(onLid).toBe(true);
  });

  it('a jumping player climbs the Sunken Bastion cargo staircase to its top crate', () => {
    const o = instanceOrigin(DUNGEONS.sunken_bastion.index, 0);
    const t = CRYPT_LAYOUT.tombs[0];
    const roll = tombSlotRoll(t.x, t.z);
    const crates = roll < 0.5;
    const tierTop = crates ? TOMB_CARGO_STACK_TIER : TOMB_CARGO_BOX_TIER;
    const stackTop = crates ? TOMB_CARGO_STACK_TOP : TOMB_CARGO_BOX_TOP;
    // The stack is a natural staircase: vault the broad lower tier, then
    // stride (or hop) onto the top crate. Approach along -z from the aisle.
    const sim = simWithPlayerAt(o.x + t.x, o.z + t.z - 1.0 - 1.0 - 1.6, 0);
    const p = sim.player;
    let onTier = false;
    let onTop = false;
    for (let i = 0; i < 160 && !onTop; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - DUNGEON_FLOOR_Y;
      if (p.onGround && Math.abs(rel - tierTop) < 0.05) onTier = true;
      if (p.onGround && Math.abs(rel - stackTop) < 0.05) onTop = true;
    }
    expect(onTier).toBe(true);
    expect(onTop).toBe(true);
  });

  it('support queries stay inert in the delve band', () => {
    expect(supportHeightAt(SEED, DELVE_BAND_X_MIN + 10, 0, 0.5, 100)).toBe(-Infinity);
  });
});
