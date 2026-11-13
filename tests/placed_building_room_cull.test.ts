// A painted lot is two meshes: a single-sided shell (`<model>_L0`) and its room
// (`<model>_INT_L0`: inside walls, floor, ceiling and furniture). The low tier stops drawing
// a building's indoor pieces past its reach (the town views flip buildPlacedTownBuilding's
// `interiors`); were the room one of them, every doorway of the house would show the world
// behind it. These pin that the room stays out of that list, and that Lantern Hall's shipped
// model still carries the parts its trophy room shows and hides by name.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildPlacedTownBuilding,
  isPlacedBuildingRoom,
} from '../src/render/eastbrook_placed_building';
import {
  GUILD_TROPHY_DUNGEONS,
  guildTrophyNodeNames,
} from '../src/render/highwatch_guild_trophies_core';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';

function mesh(name: string): THREE.Mesh {
  const made = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  made.name = name;
  return made;
}

function glbNodeNames(file: string): string[] {
  const bytes = readFileSync(file);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((node) => node.name ?? '');
}

describe('a painted lot room and the low tier interior cull', () => {
  it('names a lot room a room, as one mesh or as a group of meshes', () => {
    expect(isPlacedBuildingRoom(mesh('tavern_INT_L0'))).toBe(true);
    expect(isPlacedBuildingRoom(mesh('tavern_L0'))).toBe(false);
    expect(isPlacedBuildingRoom(mesh('G_INT_Trophy_hollow_crypt'))).toBe(false);
    expect(isPlacedBuildingRoom(mesh('Chair_INT_01'))).toBe(false);
    expect(isPlacedBuildingRoom(mesh('tavern_INT_L0_copy'))).toBe(false);
    // a part of several materials loads as a group of the part's name over numbered meshes
    const part = new THREE.Group();
    part.name = 'guild_INT_L0';
    const piece = mesh('guild_INT_L0_3');
    part.add(piece);
    expect(isPlacedBuildingRoom(piece)).toBe(true);
    const shellPart = new THREE.Group();
    shellPart.name = 'guild_L0';
    const shellPiece = mesh('guild_L0_3');
    shellPart.add(shellPiece);
    expect(isPlacedBuildingRoom(shellPiece)).toBe(false);
  });

  it('keeps the room out of the pieces the cull hides, and its trophies in', () => {
    // the shape the loader gives the shipped models: each part a group over one mesh a material
    const part = (name: string, pieces: number): THREE.Group => {
      const group = new THREE.Group();
      group.name = name;
      for (let i = 0; i < pieces; i++) group.add(mesh(`${name}_${i + 1}`));
      return group;
    };
    const source = new THREE.Group();
    source.add(
      part('guild_L0', 3),
      part('guild_INT_L0', 4),
      part('G_INT_Trophy_hollow_crypt', 2),
      mesh('G_INT_TrophyGilt_hollow_crypt'),
      mesh('Bench_INT_01'),
    );
    const built = buildPlacedTownBuilding(
      'highwatch',
      HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild,
      source,
      () => 0,
    );
    const names = built.interiors.map((object) => object.name).sort();
    expect(names).toEqual([
      'Bench_INT_01',
      'G_INT_TrophyGilt_hollow_crypt',
      'G_INT_Trophy_hollow_crypt_1',
      'G_INT_Trophy_hollow_crypt_2',
    ]);
    // the room is still indoors for shadows: it never casts one over the street
    const meshesOf = (name: string): THREE.Mesh[] =>
      (built.group.getObjectByName(name)?.children ?? []) as THREE.Mesh[];
    expect(meshesOf('guild_INT_L0')).toHaveLength(4);
    expect(meshesOf('guild_INT_L0').every((piece) => piece.castShadow === false)).toBe(true);
    expect(meshesOf('guild_L0')).toHaveLength(3);
    expect(meshesOf('guild_L0').every((piece) => piece.castShadow === true)).toBe(true);
  });

  it('ships Lantern Hall with every trophy and gilding its trophy room binds', () => {
    const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
    expect(guild.assetId).toBe('/models/tidehold/harbour_alpine/guild.glb');
    for (const tier of ['', '.half', '.quarter']) {
      const file = `public${guild.assetId.replace(/\.glb$/, `${tier}.glb`)}`;
      const names = glbNodeNames(file);
      expect(names, file).toContain('guild_L0');
      expect(names, file).toContain('guild_INT_L0');
      for (const dungeon of GUILD_TROPHY_DUNGEONS) {
        const part = guildTrophyNodeNames(dungeon);
        expect(names, file).toContain(part.trophy);
        expect(names, file).toContain(part.gilt);
      }
    }
  });
});
