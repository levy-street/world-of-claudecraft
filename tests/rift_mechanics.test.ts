import { describe, expect, it } from 'vitest';
import { DUNGEON_FLOOR_Y, isRiftPos, riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { solveLockActions } from '../src/sim/lockpick';
import { generateRiftFloor, isSetPieceSeed, riftPlatformLift } from '../src/sim/rift/rift_gen';
import type { RiftFloorPlan } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The rift's variety mechanics (v3): ice-slide, strength-boulder, sequence, the
// way-out beacon, lava, and the rolling-boulder hazard. Puzzle/hazard kind is a
// pure function of (seed, floorIndex), so we fish for a seed whose FLOOR 0 carries
// the mechanic under test (entering a rift lands you on floor 0), then drive it.

function seedWithFloor0(pred: (f: RiftFloorPlan) => boolean): number {
  for (let s = 1; s < 800; s++) {
    const f = generateRiftFloor(s, 20, 0);
    if (!f.isBoss && pred(f)) return s;
  }
  throw new Error('no seed found for the requested floor-0 mechanic');
}

function active(sim: Sim) {
  return sim.riftInstances.find((i) => i.partyKey !== null)!;
}

function killAll(sim: Sim): void {
  const inst = active(sim);
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

// Enter a floor-0 rift. The rift's mobs are baseLevel 20 while the fresh test
// player is level 1, so we clear the trash to stop it interfering; `god` makes the
// player invulnerable for puzzle-solving cases (a dead player skips triggers). The
// damage tests pass god:false so hazard/roller hits register.
function enter(seed: number, { god = true }: { god?: boolean } = {}): Sim {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.enterRift(seed, 20, sim.player.id);
  killAll(sim);
  sim.player.gm = god;
  return sim;
}

describe('rift mechanics: generator variety', () => {
  it('floor 0 across seeds surfaces every puzzle + hazard kind', () => {
    let ice = 0;
    let boulder = 0;
    let seq = 0;
    let pylons = 0;
    let hazards = 0;
    let rollers = 0;
    for (let s = 1; s <= 250; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (f.puzzle.kind === 'ice_slide') ice++;
      if (f.puzzle.kind === 'boulder_push') boulder++;
      if (f.puzzle.kind === 'sequence') seq++;
      if (f.puzzle.kind === 'rune_pylons') pylons++;
      if (f.hazards.length > 0) hazards++;
      if (f.rollers.length > 0) rollers++;
    }
    expect(ice, 'some floors are ice-slide').toBeGreaterThan(0);
    expect(boulder, 'some floors are boulder-push').toBeGreaterThan(0);
    expect(seq, 'some floors are sequence').toBeGreaterThan(0);
    expect(pylons, 'some floors are rune-pylons').toBeGreaterThan(0);
    expect(hazards, 'some floors have lava').toBeGreaterThan(0);
    expect(rollers, 'some floors have a rolling boulder').toBeGreaterThan(0);
  });

  it('boss floors never carry a puzzle, hazard, ice sheet, or roller', () => {
    let checked = 0;
    for (let s = 1; s <= 150; s++) {
      // The authored citadel is a boss floor by construction and DOES carry a lava
      // band (a hand-placed one, not a rolled hazard); it is pinned separately in
      // tests/rift_infernal.test.ts.
      if (isSetPieceSeed(s)) continue;
      const fc = generateRiftFloor(s, 20, 0).floorCount;
      const boss = generateRiftFloor(s, 20, fc - 1);
      expect(boss.isBoss).toBe(true);
      expect(boss.puzzle.kind).toBe('none');
      expect(boss.hazards.length).toBe(0);
      expect(boss.rollers.length).toBe(0);
      expect(boss.iceZone).toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('an ice-slide floor has a non-null ice zone and a Frost Sigil goal on the spine', () => {
    const seed = seedWithFloor0((f) => f.puzzle.kind === 'ice_slide');
    const f = generateRiftFloor(seed, 20, 0);
    expect(f.iceZone).not.toBeNull();
    const goal = f.objects.find((o) => o.kind === 'ice_goal');
    expect(goal).toBeTruthy();
    expect(goal?.x).toBe(0); // reachable by a straight northward slide
  });
});

describe('rift mechanics: ice-slide goal', () => {
  it('stopping on the Frost Sigil solves the floor', () => {
    const seed = seedWithFloor0((f) => f.puzzle.kind === 'ice_slide');
    const sim = enter(seed);
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const goal = floor.objects.find((o) => o.kind === 'ice_goal')!;
    const origin = riftInstanceOrigin(inst.slot, 0);
    expect(inst.puzzleSolved).toBe(false);
    // Stand (not moving) on the goal tile: the proximity check solves the floor.
    sim.player.pos = { ...sim.player.pos, x: origin.x + goal.x, z: origin.z + goal.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
    expect(inst.puzzleSolved).toBe(true);
  });

  it('a north slide glides across the sheet (not a teleport), stops at the edge, and solves', () => {
    const seed = seedWithFloor0((f) => f.puzzle.kind === 'ice_slide');
    const sim = enter(seed);
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const ice = floor.iceZone!;
    const origin = riftInstanceOrigin(inst.slot, 0);
    // Start on the ice near its south edge, on the spine, already gliding north
    // (as a real push-off would leave the player).
    sim.player.pos = { x: origin.x, y: 0, z: origin.z + ice.z - ice.hd + 2 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.riftSlideDirX = 0;
    sim.player.riftSlideDirZ = 1;
    sim.player.riftSliding = true; // the frozen-pose flag a real push-off sets

    const startZ = sim.player.pos.z;
    let maxStep = 0;
    let solved = false;
    let slidWhileGliding = false;
    for (let i = 0; i < 200; i++) {
      const z0 = sim.player.pos.z;
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      maxStep = Math.max(maxStep, Math.abs(sim.player.pos.z - z0));
      if ((sim.player.riftSlideDirZ ?? 0) !== 0) slidWhileGliding ||= !!sim.player.riftSliding;
      if (inst.puzzleSolved) {
        solved = true;
        break;
      }
      // Stopped sliding without solving would deadlock the test; guard it.
      if ((sim.player.riftSlideDirZ ?? 0) === 0 && !inst.puzzleSolved) break;
    }
    expect(solved, 'the northward glide should reach and solve the Frost Sigil').toBe(true);
    expect(slidWhileGliding, 'riftSliding flag drives the frozen pose mid-glide').toBe(true);
    expect(sim.player.pos.z, 'glided north across the sheet').toBeGreaterThan(startZ + ice.hd);
    // A glide, not a teleport: each tick advances at most ~one step (ICE_SLIDE_SPEED
    // * DT = 13 * 0.05 = 0.65yd), never the whole sheet in one jump.
    expect(maxStep, 'per-tick advance is a small glide step').toBeLessThan(1.5);
  });

  it('skating off the sheet stops the glide and plays the custom stop cue', () => {
    const seed = seedWithFloor0((f) => f.puzzle.kind === 'ice_slide');
    const sim = enter(seed);
    const origin = riftInstanceOrigin(active(sim).slot, 0);
    const floor = generateRiftFloor(seed, 20, 0);
    const ice = floor.iceZone!;
    // Already gliding north, parked one step short of the sheet's north edge
    // so the very next tick skates off onto solid ground and stops.
    sim.player.pos = { x: origin.x, y: 0, z: origin.z + ice.z + ice.hd - 0.3 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.riftSlideDirX = 0;
    sim.player.riftSlideDirZ = 1;
    sim.player.riftSliding = true;

    let stoppedKey: string | undefined;
    for (let i = 0; i < 10 && sim.player.riftSliding; i++) {
      sim.player.hp = sim.player.maxHp;
      const events = sim.tick();
      if (!sim.player.riftSliding) {
        const fx = events.find((e) => e.type === 'spellfxAt' && e.school === 'frost');
        stoppedKey = fx && fx.type === 'spellfxAt' ? fx.sfxKey : undefined;
      }
    }
    expect(sim.player.riftSliding, 'the glide stopped').toBe(false);
    expect(stoppedKey).toBe('rift_ice_stop');
  });
});

describe('rift mechanics: off-path treasure (every wall is solid)', () => {
  it('some floors carry an off-path treasure chest and NO floor carries a phantom wall', () => {
    let withTreasure = 0;
    for (const baseLevel of [20, 28]) {
      for (let s = 1; s <= 200; s++) {
        const fc = generateRiftFloor(s, baseLevel, 0).floorCount;
        for (let fi = 0; fi < fc; fi++) {
          const f = generateRiftFloor(s, baseLevel, fi);
          if (f.objects.some((o) => o.kind === 'treasure')) withTreasure++;
          // Phantom (illusion) walls are gone rift-wide: a wall that renders
          // solid must BE solid, so no generated layout may carry one.
          expect(f.layout.illusionWalls ?? [], `seed ${s} floor ${fi}`).toHaveLength(0);
        }
      }
    }
    expect(withTreasure, 'some floors still carry an off-path treasure').toBeGreaterThan(0);
  });

  it('every treasure chest stands in the open, clear of all wall/prop colliders', () => {
    const seed = seedWithFloor0((f) => f.objects.some((o) => o.kind === 'treasure'));
    const floor = generateRiftFloor(seed, 20, 0);
    const chest = floor.objects.find((o) => o.kind === 'treasure')!;
    const colliders = layoutColliders(floor.layout);
    const covered = colliders.some((c) => {
      if (c.type === 'circle') return Math.hypot(chest.x - c.x, chest.z - c.z) < c.r + 0.6;
      const dx = chest.x - c.x;
      const dz = chest.z - c.z;
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      return (
        Math.abs(dx * cos - dz * sin) < c.hw + 0.6 && Math.abs(dx * sin + dz * cos) < c.hd + 0.6
      );
    });
    expect(covered, 'treasure chest must be reachable (not embedded in a wall)').toBe(false);
  });

  it('opening a treasure on interact marks it open + no longer lootable (no lockpick)', () => {
    const seed = seedWithFloor0((f) => f.objects.some((o) => o.kind === 'treasure'));
    const sim = enter(seed);
    const chestId = [...sim.entities.values()].find((e) => e.templateId === 'rift_treasure')?.id;
    expect(chestId, 'treasure chest spawned').toBeTruthy();
    const chest = sim.entities.get(chestId!)!;
    expect(chest.lootable).toBe(true);
    sim.player.pos = { ...chest.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.riftOpenTreasure(chestId!, sim.player.id);
    expect(chest.templateId).toBe('rift_treasure_open');
    expect(chest.lootable).toBe(false);
  });
});

describe('rift mechanics: switch-gate', () => {
  it('some floors have a gate + switch; the gate spawns closed', () => {
    let withGate = 0;
    for (let s = 1; s <= 220; s++) {
      // The citadel's portcullis is orb-opened (no pressure plate); its own
      // suite covers it, this scan describes procedural switch-gates only.
      if (isSetPieceSeed(s)) continue;
      const fc = generateRiftFloor(s, 20, 0).floorCount;
      for (let fi = 0; fi < fc - 1; fi++) {
        const f = generateRiftFloor(s, 20, fi);
        if (f.gate) {
          withGate++;
          // A gate floor carries both the portcullis and its plate, and the plate
          // sits SOUTH of the gate (reachable first).
          expect(f.objects.some((o) => o.kind === 'gate')).toBe(true);
          expect(f.objects.some((o) => o.kind === 'switch')).toBe(true);
          expect(f.gate.switchZ).toBeLessThan(f.gate.z);
        }
      }
    }
    expect(withGate, 'some floors are switch-gated').toBeGreaterThan(0);
  });

  it('a closed gate blocks northward passage until the switch is thrown', () => {
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) {
      // The citadel's gate has no pressure plate (the Blood Orb opens it), so it is
      // not a switch-gate floor; its own suite covers it.
      if (isSetPieceSeed(s)) continue;
      if (generateRiftFloor(s, 20, 0).gate) seed = s;
    }
    expect(seed, 'found a floor-0 gate').toBeGreaterThan(0);
    const sim = enter(seed);
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const gate = floor.gate!;
    const origin = riftInstanceOrigin(inst.slot, 0);
    expect(inst.gateOpen).toBe(false);

    // Try to walk NORTH through the closed gate: the clamp shoves you back south.
    sim.player.pos = { x: origin.x, y: 0, z: origin.z + gate.z + 1 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.pos.z - origin.z, 'clamped south of the gate').toBeLessThan(gate.z);

    // Step the switch: the gate opens and stays open.
    const sw = sim.entities.get(inst.switchId!)!;
    sim.player.pos = { ...sw.pos };
    sim.player.prevPos = { ...sim.player.pos };
    const gateEvents = sim.tick();
    expect(inst.gateOpen).toBe(true);
    expect(sim.entities.get(inst.gateId!)?.templateId).toBe('rift_gate_open');
    // The custom grind recording (src/sim/rift/fx.ts) replaces the generic
    // nova/impact combo for the gate's own spellfxAt.
    expect(gateEvents.some((e) => e.type === 'spellfxAt' && e.sfxKey === 'rift_gate_grind')).toBe(
      true,
    );

    // Now the player can cross north past the gate line.
    sim.player.pos = { x: origin.x, y: 0, z: origin.z + gate.z + 3 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.pos.z - origin.z, 'passes once open').toBeGreaterThan(gate.z);
  });
});

describe('rift generator: rank level bands', () => {
  it('C/B/A floors cap mob level at 22; S-rank floors are flat 23', () => {
    // S-rank is no longer a 23-25 ramp; it is a flat 23 on every floor.
    let maxNonS = 0;
    let maxS = 0;
    let minS = Infinity;
    for (const baseLevel of [20, 22, 25, 28]) {
      for (let s = 1; s <= 120; s++) {
        const fc = generateRiftFloor(s, baseLevel, 0).floorCount;
        for (let fi = 0; fi < fc; fi++) {
          const floor = generateRiftFloor(s, baseLevel, fi);
          for (const sp of floor.spawns) {
            if (baseLevel >= 28) {
              maxS = Math.max(maxS, sp.level);
              minS = Math.min(minS, sp.level);
            } else {
              maxNonS = Math.max(maxNonS, sp.level);
            }
          }
        }
      }
    }
    expect(maxNonS, 'C/B/A floors still cap mob level at 22').toBeLessThanOrEqual(22);
    expect(maxNonS, 'sanity: the 22 cap is actually reached').toBeGreaterThanOrEqual(22);
    expect(minS, 'every S-rank mob is level 23').toBeGreaterThanOrEqual(23);
    // S-rank is flat 23 (no ramp to 25).
    expect(maxS, 'S-rank is flat 23, no ramp to 25').toBe(23);
  });
});

describe('rift mechanics: strength boulders', () => {
  it('every boulder resting on a socket pad solves the floor and marks it placed', () => {
    const seed = seedWithFloor0(
      (f) => f.puzzle.kind === 'boulder_push' && f.objects.some((o) => o.kind === 'boulder'),
    );
    const sim = enter(seed);
    const inst = active(sim);
    const origin = riftInstanceOrigin(inst.slot, 0);
    expect(inst.boulderIds.length).toBeGreaterThan(0);
    expect(inst.boulderPads.length).toBe(inst.boulderIds.length);
    expect(inst.puzzleSolved).toBe(false);
    // Drop each boulder onto its socket, then let the 1 Hz gate check run.
    for (let i = 0; i < inst.boulderIds.length; i++) {
      const b = sim.entities.get(inst.boulderIds[i])!;
      const pad = inst.boulderPads[i];
      b.pos = { ...b.pos, x: origin.x + pad.x, z: origin.z + pad.z };
    }
    for (let i = 0; i < 21; i++) {
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    expect(inst.puzzleSolved).toBe(true);
    for (const id of inst.boulderIds) {
      expect(sim.entities.get(id)?.templateId).toBe('rift_boulder_placed');
    }
  });
});

describe('rift mechanics: sequence runes', () => {
  it('stepping the runes south-to-north solves it; a skipped step resets progress', () => {
    const seed = seedWithFloor0(
      (f) =>
        f.puzzle.kind === 'sequence' && f.objects.filter((o) => o.kind === 'seq_rune').length >= 3,
    );
    const sim = enter(seed);
    const inst = active(sim);
    const stepOnto = (i: number) => {
      const rune = sim.entities.get(inst.seqRuneIds[i])!;
      sim.player.pos = { ...rune.pos };
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    };

    // Wrong order first: step rune 0 (ok), then skip ahead to rune 2 -> reset.
    stepOnto(0);
    expect(inst.seqStep).toBe(1);
    stepOnto(2);
    expect(inst.seqStep).toBe(0);

    // Correct order start-to-finish solves it.
    for (let i = 0; i < inst.seqRuneIds.length; i++) {
      stepOnto(i);
      expect(inst.seqStep).toBe(i + 1);
    }
    expect(inst.puzzleSolved).toBe(true);
  });
});

describe('rift mechanics: interaction VFX (animated feedback)', () => {
  // Each interactive moment (slide launch, boulder shove, rune flare, lava burn,
  // roller wallop) emits a `spellfxAt` the renderer turns into a themed burst/nova.
  // Reuses the already-wired world-fx event, so it renders on all three hosts.
  it('stepping a sequence rune emits a spellfxAt flare', () => {
    const seed = seedWithFloor0(
      (f) =>
        f.puzzle.kind === 'sequence' && f.objects.filter((o) => o.kind === 'seq_rune').length >= 3,
    );
    const sim = enter(seed);
    const inst = active(sim);
    const rune = sim.entities.get(inst.seqRuneIds[0])!;
    sim.player.pos = { ...rune.pos };
    sim.player.prevPos = { ...sim.player.pos };
    const events = sim.tick();
    const fx = events.filter((e) => e.type === 'spellfxAt');
    expect(fx.length).toBeGreaterThan(0);
    expect(inst.seqStep).toBe(1); // and it actually advanced the puzzle
  });

  it('a lava burn emits a fire spellfxAt at the player', () => {
    const seed = seedWithFloor0((f) => f.hazards.length > 0);
    const sim = enter(seed, { god: false });
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const hz = floor.hazards[0];
    const origin = riftInstanceOrigin(inst.slot, 0);
    let sawFire = false;
    let sawKey = false;
    for (let i = 0; i < 21 && !sawFire; i++) {
      sim.player.pos = { ...sim.player.pos, x: origin.x + hz.x, z: origin.z + hz.z };
      sim.player.jumping = false;
      const events = sim.tick();
      for (const e of events) {
        if (e.type !== 'spellfxAt' || e.school !== 'fire') continue;
        sawFire = true;
        if (e.sfxKey === 'rift_lava_tick') sawKey = true;
      }
    }
    expect(sawFire).toBe(true);
    // The custom recording (src/sim/rift/fx.ts) replaces the generic fire
    // impact; combat_sfx.ts's impactCueForDamage suppresses the duplicate.
    expect(sawKey).toBe(true);
  });
});

describe('rift mechanics: way-out beacon', () => {
  it('walking onto the beacon returns the player to the overworld', () => {
    const sim = enter(4242);
    const inst = active(sim);
    expect(inst.beaconId).not.toBeNull();
    expect(isRiftPos(sim.player.pos.x)).toBe(true);
    const beacon = sim.entities.get(inst.beaconId!)!;
    sim.player.pos = { ...beacon.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
    expect(isRiftPos(sim.player.pos.x)).toBe(false);
  });
});

describe('rift mechanics: lava hazard', () => {
  it('standing in a molten band chips HP (the shared delve blackwater model)', () => {
    const seed = seedWithFloor0((f) => f.hazards.length > 0);
    const sim = enter(seed, { god: false });
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const hz = floor.hazards[0];
    const origin = riftInstanceOrigin(inst.slot, 0);
    sim.player.hp = sim.player.maxHp;
    // Pin the player in the band (grounded) across a 1 Hz hazard boundary.
    for (let i = 0; i < 21; i++) {
      sim.player.pos = { ...sim.player.pos, x: origin.x + hz.x, z: origin.z + hz.z };
      sim.player.jumping = false;
      sim.tick();
    }
    expect(sim.player.hp).toBeLessThan(sim.player.maxHp);
  });
});

describe('rift mechanics: verticality (raised sanctum tier)', () => {
  it('the platform lift is 0 in the nave, ramps up monotonically, and flattens at height', () => {
    const seed = seedWithFloor0((f) => f.platform !== null);
    const p = generateRiftFloor(seed, 20, 0).platform!;
    expect(riftPlatformLift(p, p.rampZ0 - 5)).toBe(0); // nave: flat
    expect(riftPlatformLift(p, p.rampZ0)).toBe(0); // stair foot
    expect(riftPlatformLift(p, p.rampZ1)).toBeCloseTo(p.height); // stair top
    expect(riftPlatformLift(p, p.rampZ1 + 20)).toBe(p.height); // deck: flat raised
    const mid = riftPlatformLift(p, (p.rampZ0 + p.rampZ1) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(p.height);
  });

  it('boss floors and some non-boss floors generate a raised platform', () => {
    let bossWith = 0;
    let nonBossWith = 0;
    for (let s = 1; s <= 150; s++) {
      const fc = generateRiftFloor(s, 20, 0).floorCount;
      if (generateRiftFloor(s, 20, fc - 1).platform) bossWith++;
      for (let fi = 0; fi < fc - 1; fi++) {
        if (generateRiftFloor(s, 20, fi).platform) nonBossWith++;
      }
    }
    expect(bossWith, 'boss floors get the grand sanctum').toBeGreaterThan(0);
    expect(nonBossWith, 'some nave floors are raised too').toBeGreaterThan(0);
  });

  it('standing on the rear tier lifts the player Y; the nave stays flat', () => {
    const seed = seedWithFloor0((f) => f.platform !== null);
    const sim = enter(seed);
    const inst = active(sim);
    const floor = generateRiftFloor(seed, 20, 0);
    const plat = floor.platform!;
    const origin = riftInstanceOrigin(inst.slot, 0);
    // On the raised rear deck (north of the stairs): the post-motion lift raises Y.
    // (Teleports land at the flat floor Y, like groundPos/knockback do in play.)
    sim.player.pos = { x: origin.x, y: DUNGEON_FLOOR_Y, z: origin.z + plat.rampZ1 + 4 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.pos.y).toBeCloseTo(DUNGEON_FLOOR_Y + plat.height, 1);
    // Back down in the nave (south of the stairs): flat floor.
    sim.player.pos = { x: origin.x, y: DUNGEON_FLOOR_Y, z: origin.z + plat.rampZ0 - 8 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.pos.y).toBeCloseTo(DUNGEON_FLOOR_Y, 1);
  });
});

describe('rift mechanics: sealed cache lockpicking', () => {
  // Descend to the boss floor and kill everything, so openExit drops the cache.
  function toClearedBoss(sim: Sim) {
    const inst = active(sim);
    for (let g = 0; g < 12 && inst.floorIndex < inst.floorCount - 1; g++) {
      for (const id of inst.mobIds) {
        if (id === inst.bossId) continue;
        const e = sim.entities.get(id);
        if (e) {
          e.hp = 0;
          e.dead = true;
        }
      }
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true;
      for (let i = 0; i < 21; i++) {
        sim.player.hp = sim.player.maxHp;
        sim.tick();
      }
      if (inst.descentId === null) break;
      const desc = sim.entities.get(inst.descentId)!;
      sim.player.pos = { ...desc.pos };
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id);
      if (e) {
        e.hp = 0;
        e.dead = true;
      }
    }
    for (let i = 0; i < 21; i++) {
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    return inst;
  }

  it('the giga-boss drops a sealed cache; picking its lock opens it and pays spoils', () => {
    const sim = enter(4242);
    const inst = toClearedBoss(sim);
    expect(inst.cacheId).not.toBeNull();
    const cache = sim.entities.get(inst.cacheId!)!;
    expect(cache.templateId).toBe('rift_locked_chest');

    sim.player.pos = { ...cache.pos };
    sim.player.prevPos = { ...sim.player.pos };
    const meta = sim.players.get(sim.player.id)!;
    const before = meta.copper;
    sim.lockpickEngage(inst.cacheId!, 3, sim.player.id); // ante 3 = a single board
    expect(inst.lockpick).not.toBeNull();

    // Drive the engine's own winning action sequence for each page.
    let guard = 0;
    while (inst.lockpick && guard++ < 40) {
      const s = inst.lockpick;
      const actions = solveLockActions(s.pages[s.pageIndex]);
      if (!actions) break;
      for (const a of actions) {
        if (!inst.lockpick) break;
        sim.lockpickAction(a, sim.player.id);
      }
    }
    expect(inst.lockpick).toBeNull();
    expect(sim.entities.get(inst.cacheId!)?.templateId).toBe('rift_chest_open');
    expect(meta.copper).toBeGreaterThan(before);
  });

  it('aborting a pick preserves the cache for another attempt', () => {
    const sim = enter(4242);
    const inst = toClearedBoss(sim);
    const cacheId = inst.cacheId!;
    sim.player.pos = { ...sim.entities.get(cacheId)!.pos };
    sim.lockpickEngage(cacheId, 2, sim.player.id);
    expect(inst.lockpick).not.toBeNull();
    sim.lockpickAbort(sim.player.id);
    expect(inst.lockpick).toBeNull();
    expect(sim.entities.get(cacheId)?.templateId).toBe('rift_locked_chest');
  });
});

describe('rift mechanics: rolling boulder', () => {
  it('the boulder rolls down its lane and bowls over a player it overtakes', () => {
    const seed = seedWithFloor0((f) => f.rollers.length > 0);
    const sim = enter(seed, { god: false });
    const inst = active(sim);
    expect(inst.rollerIds.length).toBeGreaterThan(0);

    // Motion: with the player parked at the entry (clear of the lane), one tick
    // advances the boulder down its lane.
    const startZ = sim.entities.get(inst.rollerIds[0])!.pos.z;
    sim.player.hp = sim.player.maxHp;
    sim.tick();
    const roller = sim.entities.get(inst.rollerIds[0])!;
    expect(roller.pos.z).toBeGreaterThan(startZ);

    // Overlap: standing in its path chips HP, shoves the player aside, and arms
    // the hit cooldown so one pass costs one hit.
    sim.player.gm = false;
    sim.player.jumping = false;
    sim.player.pos = { ...sim.player.pos, x: roller.pos.x, z: roller.pos.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    const beforeHp = sim.player.hp;
    const hitEvents = sim.tick();
    expect(sim.player.hp).toBeLessThan(beforeHp);
    expect(sim.player.riftRollerUntil ?? 0).toBeGreaterThan(0);
    // Shoved clear of the lane centre (dodged sideways into the aisle).
    expect(Math.abs(sim.player.pos.x - roller.pos.x)).toBeGreaterThan(0.5);
    // The custom wallop recording (src/sim/rift/fx.ts) replaces the generic
    // nova/impact combo; combat_sfx.ts's impactCueForDamage suppresses the
    // duplicate generic physical impact from the damage event itself.
    expect(
      hitEvents.some((e) => e.type === 'spellfxAt' && e.sfxKey === 'rift_boulder_impact'),
    ).toBe(true);
  });
});
