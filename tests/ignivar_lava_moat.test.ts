import { afterEach, describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { dungeonFloorLift } from '../src/sim/dungeon_floor';
import {
  IGNIVAR_ARENA_SHELL_POLYGON,
  IGNIVAR_FLOOR_GRID_X_ORIGIN,
  IGNIVAR_FLOOR_GRID_Z_ORIGIN,
  IGNIVAR_FLOOR_TILE_SIZE,
  IGNIVAR_LAVA_MOAT_ABILITY_ID,
  IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION,
  IGNIVAR_LAVA_MOAT_DEPTH,
  IGNIVAR_PLAYABLE_FLOOR_POLYGON,
  ignivarArenaFloorTileCenterHasStone,
  ignivarArenaHasStoneFloorAt,
  ignivarArenaPointInLava,
} from '../src/sim/ignivar_arena';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { tickIgnivarLavaHazard } from '../src/sim/instances/ignivar_lava_hazard';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { abilityDisplayNameFromSource } from '../src/ui/ability_display_name';
import { setLanguage } from '../src/ui/i18n';

function enterIgnivar(difficulty: 'normal' | 'heroic' = 'normal'): {
  sim: Sim;
  origin: { x: number; z: number };
} {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
  sim.chat(`/dev dungeon ignivar_raid_arena ${difficulty}`);
  const instance = sim.instances.find((entry) => entry.dungeonId === 'ignivar_raid_arena');
  if (!instance) throw new Error('Ignivar instance did not spawn');
  for (const mobId of instance.mobIds) sim.entities.delete(mobId);
  instance.mobIds.length = 0;
  return {
    sim,
    origin: instanceOrigin(DUNGEONS.ignivar_raid_arena.index, instance.slot),
  };
}

afterEach(() => setLanguage('en'));

describe('Ignivar perimeter lava moat', () => {
  it('keeps one inner octagonal platform and two stone bridges over a continuous moat', () => {
    expect(IGNIVAR_PLAYABLE_FLOOR_POLYGON).toEqual([
      { x: -12, z: -29 },
      { x: 12, z: -29 },
      { x: 29, z: -12 },
      { x: 29, z: 12 },
      { x: 12, z: 29 },
      { x: -12, z: 29 },
      { x: -29, z: 12 },
      { x: -29, z: -12 },
    ]);
    expect(ignivarArenaHasStoneFloorAt(0, 0)).toBe(true);
    expect(ignivarArenaHasStoneFloorAt(18, 18)).toBe(true);
    expect(ignivarArenaPointInLava(31, 0)).toBe(true);
    expect(ignivarArenaPointInLava(22, 22)).toBe(true);
    expect(ignivarArenaPointInLava(0, -31)).toBe(false);
    expect(ignivarArenaPointInLava(0, 31)).toBe(false);
    expect(ignivarArenaPointInLava(34, 0)).toBe(false);
  });

  it('uses the exact visible 4x4 floor-tile union as the authoritative dry boundary', () => {
    expect(IGNIVAR_FLOOR_TILE_SIZE).toBe(4);
    expect(IGNIVAR_FLOOR_GRID_X_ORIGIN).toBe(-33);
    expect(IGNIVAR_FLOOR_GRID_Z_ORIGIN).toBe(-35);

    // This is the concrete regression that previously looked like stone but
    // burned: the retained tile centered at (11,-27) owns the whole sample.
    expect(ignivarArenaFloorTileCenterHasStone(11, -27)).toBe(true);
    expect(ignivarArenaHasStoneFloorAt(12.1, -28.9)).toBe(true);
    expect(ignivarArenaPointInLava(12.1, -28.9)).toBe(false);

    for (let centerZ = -35; centerZ <= 33; centerZ += 4) {
      for (let centerX = -33; centerX <= 31; centerX += 4) {
        const rendered = ignivarArenaFloorTileCenterHasStone(centerX, centerZ);
        for (const dx of [-1.99, 0, 1.99]) {
          for (const dz of [-1.99, 0, 1.99]) {
            const x = centerX + dx;
            const z = centerZ + dz;
            const inShell = ignivarArenaPointInLava(x, z) || ignivarArenaHasStoneFloorAt(x, z);
            if (!inShell) continue;
            if (rendered) {
              expect(ignivarArenaPointInLava(x, z), `visible tile at ${x},${z}`).toBe(false);
            }
          }
        }
      }
    }

    // Past the last platform tile, the custom bridge owns exactly x=-4..4.
    expect(ignivarArenaPointInLava(3.99, 32)).toBe(false);
    expect(ignivarArenaPointInLava(4.01, 32)).toBe(true);
    expect(IGNIVAR_ARENA_SHELL_POLYGON).toHaveLength(8);
  });

  it('routes the exposed perimeter through real groundHeight and lands on the lava bed', () => {
    expect(IGNIVAR_LAVA_MOAT_DEPTH).toBe(0.8);
    const { sim, origin } = enterIgnivar();
    expect(dungeonFloorLift(origin.x, origin.z)).toBe(0);
    expect(dungeonFloorLift(origin.x + 18, origin.z + 18)).toBe(0);
    expect(dungeonFloorLift(origin.x + 31, origin.z)).toBe(-IGNIVAR_LAVA_MOAT_DEPTH);
    expect(dungeonFloorLift(origin.x, origin.z - 31)).toBe(0);

    const platformY = groundHeight(origin.x, origin.z, sim.cfg.seed);
    const lavaY = groundHeight(origin.x + 31, origin.z, sim.cfg.seed);
    expect(platformY - lavaY).toBeCloseTo(IGNIVAR_LAVA_MOAT_DEPTH, 6);

    const player = sim.player;
    player.pos = { x: origin.x + 31, y: platformY, z: origin.z };
    player.prevPos = { ...player.pos };
    player.onGround = false;
    player.jumping = false;
    player.vy = 0;
    player.fallStartY = platformY;
    for (let tick = 0; tick < 10; tick++) sim.tick();
    expect(player.onGround).toBe(true);
    expect(player.pos.y).toBeCloseTo(lavaY, 6);
  });

  it.each([
    ['normal', 0.25],
    ['heroic', 0.45],
  ] as const)('burns a grounded player once per second on %s', (difficulty, fraction) => {
    expect(IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION[difficulty]).toBe(fraction);
    const { sim, origin } = enterIgnivar(difficulty);
    const player = sim.player;
    player.pos.x = origin.x + 31;
    player.pos.z = origin.z;
    player.pos.y = dungeonFloorLift(player.pos.x, player.pos.z);
    player.prevPos = { ...player.pos };
    player.onGround = true;
    player.jumping = false;
    const before = player.hp;
    const firstEvents = [];
    for (let tick = 0; tick < 19; tick++) firstEvents.push(...sim.tick());
    expect(player.hp).toBe(before);
    expect(firstEvents.some((event) => event.type === 'damage')).toBe(false);

    const events = [...sim.tick()];

    expect(player.hp).toBe(before - Math.max(1, Math.round(player.maxHp * fraction)));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        sourceId: -1,
        targetId: player.id,
        school: 'fire',
        ability: 'Crucible Perimeter',
        abilityId: 'ignivar_crucible_perimeter',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        x: player.pos.x,
        z: player.pos.z,
        school: 'fire',
        fx: 'burst',
      }),
    );

    const secondEvents = [];
    for (let tick = 0; tick < 20; tick++) secondEvents.push(...sim.tick());
    const pulses = [...events, ...secondEvents].filter(
      (event) => event.type === 'damage' && event.abilityId === IGNIVAR_LAVA_MOAT_ABILITY_ID,
    );
    expect(pulses).toHaveLength(2);
    expect(pulses.map((event) => (event.type === 'damage' ? event.amount : 0))).toEqual([
      Math.max(1, Math.round(player.maxHp * fraction)),
      Math.max(1, Math.round(player.maxHp * fraction)),
    ]);
  });

  it('does not burn the inner platform or either bridge', () => {
    const cases = [
      { x: 0, z: 0, jumping: false },
      { x: 18, z: 18, jumping: false },
      { x: 0, z: -31, jumping: false },
      { x: 0, z: 31, jumping: false },
    ];
    for (const point of cases) {
      const { sim, origin } = enterIgnivar();
      const player = sim.player;
      player.pos.x = origin.x + point.x;
      player.pos.z = origin.z + point.z;
      player.pos.y = dungeonFloorLift(player.pos.x, player.pos.z);
      player.prevPos = { ...player.pos };
      player.onGround = !point.jumping;
      player.jumping = point.jumping;
      const events = [];
      for (let tick = 0; tick < 20; tick++) events.push(...sim.tick());
      expect(
        events.some(
          (event) => event.type === 'damage' && event.abilityId === IGNIVAR_LAVA_MOAT_ABILITY_ID,
        ),
        `${point.x},${point.z}`,
      ).toBe(false);
    }
  });

  it('independently skips jumping and airborne players above the lava', () => {
    for (const state of [
      { jumping: true, onGround: true },
      { jumping: false, onGround: false },
    ]) {
      const { sim, origin } = enterIgnivar();
      const player = sim.player;
      player.pos = { x: origin.x + 31, y: player.pos.y, z: origin.z };
      player.prevPos = { ...player.pos };
      player.jumping = state.jumping;
      player.onGround = state.onGround;
      const before = player.hp;
      tickIgnivarLavaHazard(sim.ctx);
      expect(player.hp, JSON.stringify(state)).toBe(before);
    }
  });

  it('localizes the lethal environmental ability in Spanish death feedback', () => {
    setLanguage('es_ES');
    expect(abilityDisplayNameFromSource('Crucible Perimeter')).toBe('Perímetro del Crisol');
  });

  it('uses the normal dev bypass path as well as the command helper', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
  });
});
