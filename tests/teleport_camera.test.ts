// Authored teleport camera snaps: ferry arrivals and dungeon entries use the
// landed facing, while walked movement and unrelated teleports preserve yaw.
// The threshold is shared with zone_transition.ts so "what is a teleport"
// has exactly one definition.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newKeyboardTurnState } from '../src/game/keyboard_turn_facing';
import {
  isDungeonEntryTeleport,
  isIslandFerryTeleport,
  islandTeleportCameraYaw,
  teleportCameraArrivalAfterTick,
  teleportCameraArrivalBetween,
  teleportCameraArrivalKind,
  teleportCameraFacingState,
  teleportCameraYaw,
} from '../src/game/teleport_camera';
import { TELEPORT_DISPLACEMENT_YD, zoneWarmupMode } from '../src/game/zone_transition';
import { PROVING_SHORE_ARRIVAL } from '../src/sim/content/proving_shore';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { FERRY_BELL_TOWN_LANDING } from '../src/sim/interactions/ferry_bell';

describe('teleportCameraYaw', () => {
  it('snaps to the landed facing past the teleport threshold', () => {
    expect(teleportCameraYaw(TELEPORT_DISPLACEMENT_YD + 1, 2.4, 0.1)).toBe(2.4);
    expect(teleportCameraYaw(290, -3.09, 0.1)).toBe(-3.09); // the ferry crossing
  });

  it('leaves a walked frame alone, exactly where the warmup classifier does', () => {
    expect(teleportCameraYaw(0.7, 2.4, 0.1)).toBe(0.1); // a mounted sprint frame
    expect(teleportCameraYaw(TELEPORT_DISPLACEMENT_YD, 2.4, 0.1)).toBe(0.1);
    // The same boundary the loading-screen decision uses: the two can never
    // disagree about what counts as a teleport.
    expect(zoneWarmupMode(TELEPORT_DISPLACEMENT_YD)).toBe('background');
    expect(zoneWarmupMode(TELEPORT_DISPLACEMENT_YD + 1)).toBe('blocking');
  });
});

describe('islandTeleportCameraYaw (the ferry scoping)', () => {
  const JUMP = TELEPORT_DISPLACEMENT_YD + 100;

  it('snaps both ferry rides: town to island and island to town', () => {
    // Outbound: from beside the town bell to the authored arrival.
    expect(
      islandTeleportCameraYaw(
        3,
        -7.5,
        PROVING_SHORE_ARRIVAL.x,
        PROVING_SHORE_ARRIVAL.z,
        JUMP,
        PROVING_SHORE_ARRIVAL.facing,
        0.1,
      ),
    ).toBe(PROVING_SHORE_ARRIVAL.facing);
    // Home: from the Old Pier bell to the town landing.
    expect(
      islandTeleportCameraYaw(
        -280,
        0,
        FERRY_BELL_TOWN_LANDING.x,
        FERRY_BELL_TOWN_LANDING.z,
        JUMP,
        FERRY_BELL_TOWN_LANDING.facing,
        0.1,
      ),
    ).toBe(FERRY_BELL_TOWN_LANDING.facing);
  });

  it('never re-aims a mainland teleport, however large (PR #3467 review, finding 6)', () => {
    // A hearthstone or dungeon door wholly off the island keeps the player's
    // yaw: re-aiming every teleport in the game is a global feel change that
    // must not ride inside the tutorial island.
    expect(islandTeleportCameraYaw(120, 40, 4, -6, JUMP, 2.4, 0.1)).toBe(0.1);
    // Including one that lands in the island's x COLUMN but not its z band
    // (the Willowfen strand): the scoping is the zone rectangle, both axes.
    expect(islandTeleportCameraYaw(120, 40, -232, 220, JUMP, 2.4, 0.1)).toBe(0.1);
  });
});

describe('isIslandFerryTeleport (the shared crossing predicate)', () => {
  const JUMP = TELEPORT_DISPLACEMENT_YD + 1;
  // main.ts reads this for the always-cover arrival rule (the harbor kit
  // links its building programs across the first frames even when the zone
  // is resident), and the camera snap reads it for the yaw. One authority.
  it('is true for a teleport-scale jump that starts or ends on the island', () => {
    // Out: the Old Pier bell to the town landing.
    expect(
      isIslandFerryTeleport(-280, 0, FERRY_BELL_TOWN_LANDING.x, FERRY_BELL_TOWN_LANDING.z, JUMP),
    ).toBe(true);
    // Back: the town bell to the island arrival.
    expect(
      isIslandFerryTeleport(-7.5, -100, PROVING_SHORE_ARRIVAL.x, PROVING_SHORE_ARRIVAL.z, JUMP),
    ).toBe(true);
  });

  it('is false for a mainland teleport and for any walked displacement', () => {
    expect(isIslandFerryTeleport(120, 40, 4, -6, JUMP)).toBe(false);
    // A walked frame on the island itself never reads as the crossing.
    expect(isIslandFerryTeleport(-280, 0, -279, -1, 1.4)).toBe(false);
  });
});

describe('dungeon entry camera facing', () => {
  const JUMP = TELEPORT_DISPLACEMENT_YD + 100;

  it('snaps the reported Ignivar walk-in from its stale approach yaw to the landed facing', () => {
    const raid = DUNGEONS.ignivar_forge_approach;
    const origin = instanceOrigin(raid.index, 0);

    expect(
      teleportCameraArrivalKind(
        raid.doorPos.x,
        raid.doorPos.z,
        origin.x + raid.entry.x,
        origin.z + raid.entry.z,
        JUMP,
      ),
    ).toBe('dungeon');
  });

  it('recognizes every current dungeon destination and internal raid-room transition', () => {
    for (const dungeon of Object.values(DUNGEONS)) {
      const origin = instanceOrigin(dungeon.index, 0);
      expect(isDungeonEntryTeleport(0, origin.x + dungeon.entry.x, JUMP), dungeon.id).toBe(true);
    }

    const rooms = [
      DUNGEONS.ignivar_forge_approach,
      DUNGEONS.ignivar_raid_arena,
      DUNGEONS.ignivar_molten_assembly,
      DUNGEONS.ignivar_inner_crucible,
    ];
    for (let index = 1; index < rooms.length; index++) {
      const from = rooms[index - 1];
      const to = rooms[index];
      expect(
        isDungeonEntryTeleport(
          instanceOrigin(from.index, 0).x + from.entry.x,
          instanceOrigin(to.index, 0).x + to.entry.x,
          JUMP,
        ),
        `${from.id} -> ${to.id}`,
      ).toBe(true);
    }
  });

  it('gives dungeon entry precedence over an overlapping ferry origin', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);

    expect(
      teleportCameraArrivalKind(-280, 0, origin.x + crypt.entry.x, origin.z + crypt.entry.z, JUMP),
    ).toBe('dungeon');
  });

  it('keeps walked movement outside the dungeon arrival classifier', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);

    expect(isDungeonEntryTeleport(0, origin.x + crypt.entry.x, TELEPORT_DISPLACEMENT_YD)).toBe(
      false,
    );
  });

  it('does not classify dungeon exits or unrelated mainland teleports for a camera snap', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);

    expect(
      teleportCameraArrivalKind(
        origin.x + crypt.entry.x,
        origin.z + crypt.entry.z,
        crypt.doorPos.x,
        crypt.doorPos.z,
        JUMP,
      ),
    ).toBeNull();
    expect(teleportCameraArrivalKind(10, 10, 300, 300, JUMP)).toBeNull();
  });
});

describe('live teleport camera facing state', () => {
  const staleKeyboardTurn = {
    ...newKeyboardTurnState(),
    facing: Math.PI,
    releaseMs: 120,
    wireFacing: Math.PI,
    suppressTurnFlags: true,
    wasTurning: true,
  };

  it('clears every stale heading owner before held W streams its next facing', () => {
    const next = teleportCameraFacingState('dungeon', 0, {
      camYaw: Math.PI,
      lastInterpFacing: Math.PI,
      pendingReleaseFacing: Math.PI,
      prevCameraDrivenFacing: true,
      keyboardTurn: staleKeyboardTurn,
    });

    expect(next).toEqual({
      camYaw: 0,
      lastInterpFacing: 0,
      pendingReleaseFacing: null,
      prevCameraDrivenFacing: false,
      keyboardTurn: newKeyboardTurnState(),
      movementFacing: 0,
    });
    // Mouse Camera mode sends camYaw as the authoritative facing while W is
    // held, so this is the next heading the offline or online path consumes.
    expect(next.camYaw).toBe(0);
  });

  it('keeps the frame-loop wiring and offline catch-up ordering intact', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(mainSource).toContain(`input.camYaw = next.camYaw;
    lastInterpFacing = next.lastInterpFacing;
    pendingReleaseFacing = next.pendingReleaseFacing;
    prevCameraDrivenFacing = next.prevCameraDrivenFacing;
    Object.assign(kbTurn, next.keyboardTurn);
    return next.movementFacing;`);

    expect(mainSource).toContain(
      'if (cameraArrival !== null) alignTeleportCameraFacing(cameraArrival, player.facing);',
    );
    expect(mainSource).toContain('if (!warm && !dungeonEntryChanged) return;');
    expect(mainSource).toContain(
      "movementFacing = alignTeleportCameraFacing('dungeon', dungeonEntryFacing);",
    );
    expect(mainSource).toContain('const stepFacing = movementFacing ?? facing;');
    const tickClassifier = mainSource.indexOf(
      'const tickArrival = teleportCameraArrivalAfterTick(',
    );
    const tickAlignment = mainSource.indexOf(
      'movementFacing = alignTeleportCameraFacing(tickArrival, tickPlayer.facing);',
      tickClassifier,
    );
    const nextTickBoundary = mainSource.indexOf('acc -= DT;', tickAlignment);
    expect(tickClassifier).toBeGreaterThan(-1);
    expect(tickAlignment).toBeGreaterThan(tickClassifier);
    expect(nextTickBoundary).toBeGreaterThan(tickAlignment);
  });

  it('feeds the authored facing into the next offline catch-up tick', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    const cryptX = origin.x + crypt.entry.x;
    const arrival = teleportCameraArrivalBetween(
      crypt.doorPos.x,
      crypt.doorPos.z,
      cryptX,
      origin.z + crypt.entry.z,
    );
    if (arrival === null) throw new Error('dungeon entry was not classified');
    const aligned = teleportCameraFacingState(arrival, 0, {
      camYaw: Math.PI,
      lastInterpFacing: Math.PI,
      pendingReleaseFacing: Math.PI,
      prevCameraDrivenFacing: true,
      keyboardTurn: staleKeyboardTurn,
    });

    const nextTickFacing = aligned.movementFacing;
    expect(nextTickFacing).toBe(0);
    expect(teleportCameraArrivalAfterTick(cryptX, 0, cryptX, 0, 1, 2)).toBe('dungeon');
  });

  it('keeps ferry heading handoffs while snapping only the camera yaw', () => {
    const next = teleportCameraFacingState('ferry', 1.25, {
      camYaw: Math.PI,
      lastInterpFacing: 0.5,
      pendingReleaseFacing: 0.75,
      prevCameraDrivenFacing: true,
      keyboardTurn: staleKeyboardTurn,
    });

    expect(next).toEqual({
      camYaw: 1.25,
      lastInterpFacing: 0.5,
      pendingReleaseFacing: 0.75,
      prevCameraDrivenFacing: true,
      keyboardTurn: staleKeyboardTurn,
      movementFacing: 1.25,
    });
    expect(next.keyboardTurn).not.toBe(staleKeyboardTurn);
  });

  it('classifies both live ferry directions', () => {
    const jump = TELEPORT_DISPLACEMENT_YD + 1;
    expect(
      teleportCameraArrivalKind(-7.5, -100, PROVING_SHORE_ARRIVAL.x, PROVING_SHORE_ARRIVAL.z, jump),
    ).toBe('ferry');
    expect(
      teleportCameraArrivalKind(
        -280,
        0,
        FERRY_BELL_TOWN_LANDING.x,
        FERRY_BELL_TOWN_LANDING.z,
        jump,
      ),
    ).toBe('ferry');
  });
});
