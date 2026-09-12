// src/sim/saved_pos_exit.ts: where a durable save resolves on rejoin, and the
// zone id the character list labels each roster row with. The rule used to be
// inline in Sim.addPlayer; extracting it lets the server read the SAME rule, so
// the roster's zone can never disagree with where the character actually lands
// (the last suite here asserts exactly that against a real addPlayer).
import { describe, expect, it } from 'vitest';
import {
  BG_BAND_X_MIN,
  DELVE_LIST,
  DUNGEON_LIST,
  delveOrigin,
  INSTANCE_X_BASE,
  PLAYER_START,
  zoneAt,
} from '../src/sim/data';
import { resolveSavedPosExit, savedZoneId } from '../src/sim/saved_pos_exit';
import { type CharacterState, Sim } from '../src/sim/sim';

// Derived from the band constants so the next instance-plane move keeps these
// honest: dungeon 0 (Hollow Crypt) sits 700 yd past the plane base, the delve
// origin is delve 1 (Drowned Litany), and the legacy plane is the pre-move
// literal layout migrateLegacyInstancePos freezes.
const INSIDE_HOLLOW_CRYPT = { x: INSTANCE_X_BASE + 700, z: 0 };
const INSIDE_DROWNED_LITANY = { x: delveOrigin(1, 0).x + 23, z: 0 };
const INSIDE_BATTLEGROUND = { x: BG_BAND_X_MIN + 10, z: 0 };
const INSTANCE_PLANE_STRIP = { x: INSTANCE_X_BASE + 100, z: 0 };
const LEGACY_SUNKEN_BASTION = { x: 1500, z: 0 };
const OVERWORLD = { x: 12, z: 300 };
const WORLD_START_ZONE = zoneAt(PLAYER_START.x, PLAYER_START.z).id;

const door = (d: { doorPos: { x: number; z: number } }) => ({
  x: d.doorPos.x,
  z: d.doorPos.z - 4,
});
const dungeon = (id: string) => {
  const d = DUNGEON_LIST.find((x) => x.id === id);
  if (!d) throw new Error(`fixture dungeon ${id} missing`);
  return d;
};
const delve = (id: string) => {
  const d = DELVE_LIST.find((x) => x.id === id);
  if (!d) throw new Error(`fixture delve ${id} missing`);
  return d;
};

describe('resolveSavedPosExit', () => {
  it('keeps an overworld save where it is, with no instance exemption', () => {
    expect(resolveSavedPosExit(OVERWORLD)).toEqual({ pos: { x: 12, z: 300 }, instanceExit: false });
  });

  it('returns no position for a missing save (world start)', () => {
    expect(resolveSavedPosExit(null)).toEqual({ pos: null, instanceExit: false });
    expect(resolveSavedPosExit(undefined)).toEqual({ pos: null, instanceExit: false });
  });

  it('treats a malformed stored position as no position, not as dungeon 0', () => {
    // Untrusted JSONB: `{}` or a string would otherwise ride NaN through the
    // legacy-plane arithmetic into DUNGEON_LIST[0]'s door.
    expect(resolveSavedPosExit({} as { x: number; z: number })).toEqual({
      pos: null,
      instanceExit: false,
    });
    expect(resolveSavedPosExit({ x: Number.NaN, z: 0 })).toEqual({
      pos: null,
      instanceExit: false,
    });
    expect(resolveSavedPosExit({ x: 0, z: Number.POSITIVE_INFINITY })).toEqual({
      pos: null,
      instanceExit: false,
    });
  });

  it('ejects a dungeon save to that dungeon door', () => {
    expect(resolveSavedPosExit(INSIDE_HOLLOW_CRYPT)).toEqual({
      pos: door(dungeon('hollow_crypt')),
      instanceExit: true,
    });
  });

  it('ejects a delve save to that delve door, never a dungeon door', () => {
    const r = resolveSavedPosExit(INSIDE_DROWNED_LITANY);
    expect(r).toEqual({ pos: door(delve('drowned_litany')), instanceExit: true });
    // The delve band sits past the dungeon threshold, so a wrong branch order
    // would send it to DUNGEON_LIST[0]'s door instead.
    expect(r.pos).not.toEqual(door(DUNGEON_LIST[0]));
  });

  it('drops a mid-match battleground save to the world start', () => {
    expect(resolveSavedPosExit(INSIDE_BATTLEGROUND)).toEqual({ pos: null, instanceExit: false });
  });

  it('resolves a pre-move legacy instance save to its door as an instance exit', () => {
    expect(resolveSavedPosExit(LEGACY_SUNKEN_BASTION)).toEqual({
      pos: door(dungeon('sunken_bastion')),
      instanceExit: true,
    });
  });

  it("does not alias the caller's position object", () => {
    const saved = { ...OVERWORLD };
    expect(resolveSavedPosExit(saved).pos).not.toBe(saved);
  });
});

describe('savedZoneId', () => {
  it('is the zone of an overworld save', () => {
    expect(savedZoneId(OVERWORLD)).toBe('mirefen_marsh');
    expect(savedZoneId({ x: 0, z: 0 })).toBe('eastbrook_vale');
    expect(savedZoneId(OVERWORLD)).toBe(zoneAt(OVERWORLD.x, OVERWORLD.z).id);
  });

  it('is the door zone for an instance save (the character is not "in" a dungeon)', () => {
    expect(savedZoneId(INSIDE_HOLLOW_CRYPT)).toBe('eastbrook_vale');
    expect(savedZoneId(INSIDE_DROWNED_LITANY)).toBe('mirefen_marsh');
    expect(savedZoneId(LEGACY_SUNKEN_BASTION)).toBe('mirefen_marsh');
  });

  it('is the world-start zone for a battleground save, a fresh character, or a bad position', () => {
    expect(WORLD_START_ZONE).toBe('eastbrook_vale');
    expect(savedZoneId(INSIDE_BATTLEGROUND)).toBe(WORLD_START_ZONE);
    expect(savedZoneId(null)).toBe(WORLD_START_ZONE);
    expect(savedZoneId(undefined)).toBe(WORLD_START_ZONE);
    expect(savedZoneId({ x: Number.NaN, z: 0 })).toBe(WORLD_START_ZONE);
  });

  it('is null for a position the exit rule leaves on the instance plane', () => {
    // The strip west of dungeon 0 belongs to no band; zoneAt would clamp it
    // onto an overworld zone the character is nowhere near.
    expect(savedZoneId(INSTANCE_PLANE_STRIP)).toBeNull();
  });
});

describe('savedZoneId agrees with where Sim.addPlayer lands the character', () => {
  const SEED = 2307;
  const baseState = (): CharacterState => {
    const source = new Sim({ seed: SEED, playerClass: 'warrior' });
    const state = source.serializeCharacter(source.playerId);
    if (!state) throw new Error('failed to create the saved-state fixture');
    return state;
  };

  it('for every arm of the rejoin rule', () => {
    const base = baseState();
    const cases = [
      OVERWORLD,
      INSIDE_HOLLOW_CRYPT,
      INSIDE_DROWNED_LITANY,
      INSIDE_BATTLEGROUND,
      LEGACY_SUNKEN_BASTION,
    ];
    for (const pos of cases) {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
      const pid = sim.addPlayer('warrior', 'Saved', {
        state: { ...structuredClone(base), pos: { ...pos } },
      });
      const player = sim.entities.get(pid);
      if (!player) throw new Error('saved player did not load');
      expect(savedZoneId(pos), `saved at ${pos.x},${pos.z}`).toBe(
        zoneAt(player.pos.x, player.pos.z).id,
      );
    }
  });
});
