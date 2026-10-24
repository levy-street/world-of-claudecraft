// Lantern Hall's name on its gateway (src/render/highwatch_guild_sign.ts): two painted faces,
// each turned to read the right way round, standing at the model's board in the guild's own
// frame, the lettering localized through t() and repainted in place on a language switch,
// and the town kit adding them to the guild's model before its materials convert (so they
// fade, cull and reveal with the building: highwatch_town.ts highwatchBuildingExtras through
// eastbrook_placed_building.ts buildPlacedTownBuilding).
// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPlacedTownBuilding } from '../src/render/eastbrook_placed_building';
import { guildSignLabels } from '../src/render/entity_labels';
import {
  buildHighwatchGuildSign,
  HIGHWATCH_GUILD_SIGN,
  highwatchGuildSignInternalsForTest,
} from '../src/render/highwatch_guild_sign';
import { highwatchBuildingExtras } from '../src/render/highwatch_town';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';

// jsdom ships no 2D context: a recording stand-in, so the paint path runs
const drawn: string[] = [];
beforeAll(() => {
  const ctx = {
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    strokeRect: () => undefined,
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: (text: string) => drawn.push(text),
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});

describe("the guild's gateway sign", () => {
  it('reads the guild name and its line through the catalog', () => {
    expect(guildSignLabels()).toEqual({ name: 'Lantern Hall', subtitle: "Adventurers' Guild" });
  });

  it('stands two faces at the board, one toward the road and one toward the yard', () => {
    highwatchGuildSignInternalsForTest.clearForTest();
    const group = buildHighwatchGuildSign();
    const s = HIGHWATCH_GUILD_SIGN;
    expect(group.position.toArray()).toEqual([s.x, s.y, s.z]);
    const faces = group.children as THREE.Mesh[];
    expect(faces.map((f) => f.name)).toEqual(['GuildSignText', 'GuildSignText']);
    group.updateMatrixWorld(true);
    const normals = faces.map((f) =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(f.getWorldQuaternion(new THREE.Quaternion())),
    );
    // the road face looks down model -z (out of the yard), the yard face up +z
    expect(normals[0].z).toBeCloseTo(-1, 9);
    expect(normals[1].z).toBeCloseTo(1, 9);
    expect(faces[0].position.z).toBe(-s.face);
    expect(faces[1].position.z).toBe(s.face);
    // never mirrored, one shared geometry and material
    for (const f of faces) expect(f.scale.x).toBeGreaterThan(0);
    expect(faces[0].material).toBe(faces[1].material);
    expect(faces[0].geometry).toBe(faces[1].geometry);
  });

  it('repaints the canvas in place, never a new material', () => {
    const group = buildHighwatchGuildSign();
    const material = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const texture = material.map as THREE.CanvasTexture;
    const version = texture.version;
    highwatchGuildSignInternalsForTest.repaint();
    expect(texture.version).toBeGreaterThan(version);
    // the localized name and its line are what the canvas paints
    expect(drawn).toContain('Lantern Hall');
    expect(drawn).toContain("Adventurers' Guild");
    expect((buildHighwatchGuildSign().children[0] as THREE.Mesh).material).toBe(material);
  });

  it('joins the guild model through the town kit, and no other building', () => {
    expect(highwatchBuildingExtras('highwatch_manor')).toEqual([]);
    const extras = highwatchBuildingExtras('highwatch_guild');
    expect(extras.map((o) => o.name)).toEqual(['highwatchGuildSign']);
    // a stand-in model: the sign lands inside the building and takes its fade records
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial()));
    const built = buildPlacedTownBuilding(
      'highwatch',
      HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild,
      source,
      () => 0,
      extras,
    );
    const texts: THREE.Mesh[] = [];
    built.group.traverse((o) => {
      if (o.name === 'GuildSignText') texts.push(o as THREE.Mesh);
    });
    expect(texts).toHaveLength(2);
    expect(built.mats.some((record) => record.mat === texts[0].material)).toBe(true);
  });
});
