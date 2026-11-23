import { afterEach, describe, expect, it } from 'vitest';

import { isBlocked } from '../src/sim/colliders';
import {
  BUILTIN_WORLD,
  DELVE_LIST,
  DUNGEON_LIST,
  delveOrigin,
  instanceOrigin,
  setActiveWorldContent,
} from '../src/sim/data';
import { EASTBROOK_BUILDINGS_BY_ID, EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { type CharacterState, Sim } from '../src/sim/sim';
import { emptyZoneProps, type WorldContent } from '../src/sim/types';

const SEED = 2307;

function baseState(): CharacterState {
  const source = new Sim({ seed: SEED, playerClass: 'warrior' });
  const state = source.serializeCharacter(source.playerId);
  if (!state) throw new Error('failed to create persisted-position fixture');
  return state;
}

function stateAt(position: { x: number; z: number }): CharacterState {
  return { ...structuredClone(baseState()), pos: { ...position } };
}

function loadAt(position: { x: number; z: number }, world?: WorldContent) {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    ...(world ? { world } : {}),
  });
  const pid = sim.addPlayer('warrior', 'Saved', { state: stateAt(position) });
  const player = sim.entities.get(pid);
  if (!player) throw new Error('saved player did not load');
  return { sim, player };
}

afterEach(() => setActiveWorldContent(null));

describe('persisted overworld position escape', () => {
  it('preserves an already-clear saved position exactly', () => {
    const position = { x: 2, z: -2 };
    const { player } = loadAt(position);
    expect({ x: player.pos.x, z: player.pos.z }).toEqual(position);
  });

  it('preserves a collision-free swimming save below the NPC dry-ground threshold', () => {
    const position = { x: -77, z: 88 };
    expect(isBlocked(SEED, position.x, position.z, 0.5)).toBe(false);

    const { player } = loadAt(position);

    expect({ x: player.pos.x, z: player.pos.z }).toEqual(position);
  });

  // Wall-wing row removed 2026-08 for the Eastbrook harbor move (d19aa33f76,
  // docs/design/eastbrook-revamp/site-plan.md): the ring wall is demolished
  // (EASTBROOK_LAYOUT.wall.segments is empty by design), so no wall geometry
  // is left to trap a save in; the remaining rows still exercise the escape
  // path against the moved buildings and stalls.
  // The barracks garrison lot row became the Weekly Vault (still sealed, no
  // walk-in) when the genshin artstyle merge (8bff2cec638) cleared the Wolf
  // Run barracks, leaving that lot open ground.
  it.each([
    [
      'Weekly Vault',
      { x: EASTBROOK_LAYOUT.weeklyVault.x, z: EASTBROOK_LAYOUT.weeklyVault.z } as {
        x: number;
        z: number;
      },
    ],
    // the quay cottage, because it is still sealed: the bank this row used to
    // name is a walk-in room now (the case below)
    ['quay cottage', EASTBROOK_BUILDINGS_BY_ID.eastbrook_quay_cottage.position],
    ['market stall', EASTBROOK_LAYOUT.market.stalls[0].position],
  ])('moves a save trapped inside the %s to deterministic clear ground', (_label, position) => {
    expect(isBlocked(SEED, position.x, position.z, 0.5)).toBe(true);
    const first = loadAt(position).player;
    const second = loadAt(position).player;
    const resolved = { x: first.pos.x, z: first.pos.z };

    expect(resolved).not.toEqual(position);
    expect({ x: second.pos.x, z: second.pos.z }).toEqual(resolved);
    expect(isBlocked(SEED, resolved.x, resolved.z, 0.5)).toBe(false);
  });

  it('keeps a save standing inside a walk-in building, which its door lets out', () => {
    // the bank's centre is its own floor (sim/town_walk_in.ts): the save
    // probes as a body standing there (sim/spawn_footing.ts), so its upper
    // storey overhead does not shove the player into the street
    const position = EASTBROOK_BUILDINGS_BY_ID.eastbrook_bank.position;
    const bank = EASTBROOK_LAYOUT.buildings.find((building) => building.id === 'eastbrook_bank');
    expect(bank?.walkIn).toBe(true);
    const { player } = loadAt(position);
    expect({ x: player.pos.x, z: player.pos.z }).toEqual(position);
  });

  it('does not apply built-in Eastbrook colliders to a custom world', () => {
    const world: WorldContent = { ...BUILTIN_WORLD, props: emptyZoneProps() };
    setActiveWorldContent(world);
    const position = EASTBROOK_BUILDINGS_BY_ID.eastbrook_bank.position;
    const { player } = loadAt(position, world);

    expect({ x: player.pos.x, z: player.pos.z }).toEqual(position);
  });

  it('does not draw RNG while resolving blocked persisted positions', () => {
    const clear = loadAt({ x: 2, z: -2 }).sim;
    const blocked = loadAt(EASTBROOK_BUILDINGS_BY_ID.eastbrook_bank.position).sim;

    expect(blocked.rng.next()).toBe(clear.rng.next());
  });

  it('keeps fresh starts and dungeon/delve ejection semantics unchanged', () => {
    const fresh = new Sim({ seed: SEED, playerClass: 'warrior' });
    expect({ x: fresh.player.pos.x, z: fresh.player.pos.z }).toEqual(BUILTIN_WORLD.playerStart);

    const dungeon = DUNGEON_LIST[0];
    const dungeonSaved = instanceOrigin(dungeon.index, 0);
    const dungeonPlayer = loadAt(dungeonSaved).player;
    expect({ x: dungeonPlayer.pos.x, z: dungeonPlayer.pos.z }).toEqual({
      x: dungeon.doorPos.x,
      z: dungeon.doorPos.z - 4,
    });

    const delve = DELVE_LIST[0];
    const delveSaved = delveOrigin(delve.index, 0);
    const delvePlayer = loadAt(delveSaved).player;
    expect({ x: delvePlayer.pos.x, z: delvePlayer.pos.z }).toEqual({
      x: delve.doorPos.x,
      z: delve.doorPos.z - 4,
    });
  });
});
