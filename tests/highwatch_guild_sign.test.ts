// Lantern Hall's name over its doors (src/render/highwatch_guild_sign.ts): one painted face
// standing on the name board the hall's model wears, in the guild's own frame, the lettering
// localized through t() and repainted in place on a language switch, and the town kit adding
// it to the guild's model before its materials convert (so it fades, culls and reveals with
// the building: highwatch_town.ts highwatchBuildingExtras through
// eastbrook_placed_building.ts buildPlacedTownBuilding).
// @vitest-environment jsdom
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
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

describe("the guild's name board", () => {
  it('reads the guild name and its line through the catalog', () => {
    expect(guildSignLabels()).toEqual({ name: 'Lantern Hall', subtitle: "Adventurers' Guild" });
  });

  it('stands one face on the board, looking out with the doors', () => {
    highwatchGuildSignInternalsForTest.clearForTest();
    const group = buildHighwatchGuildSign();
    const s = HIGHWATCH_GUILD_SIGN;
    expect(group.position.toArray()).toEqual([s.x, s.y, s.z]);
    const faces = group.children as THREE.Mesh[];
    expect(faces.map((f) => f.name)).toEqual(['GuildSignText']);
    group.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      faces[0].getWorldQuaternion(new THREE.Quaternion()),
    );
    // the doors look down model -z, and so does the lettering; never mirrored
    expect(normal.z).toBeCloseTo(-1, 9);
    expect(faces[0].position.z).toBe(-s.face);
    expect(faces[0].scale.x).toBeGreaterThan(0);
  });

  it('sits on the name board the shipped hall wears, proud of its oak and inside its frame', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
    const doc = await io.read(path.join(process.cwd(), 'public', guild.assetId));
    const board = doc
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === 'G_SignBoard');
    if (!board) throw new Error('the guild model has no G_SignBoard object');
    const { min, max } = getBounds(board);
    const s = HIGHWATCH_GUILD_SIGN;
    // centred on the board, every edge of the lettering inside the gilded frame
    expect(s.x).toBeCloseTo((min[0] + max[0]) / 2, 2);
    expect(s.y).toBeCloseTo((min[1] + max[1]) / 2, 2);
    expect(s.x - s.width / 2).toBeGreaterThan(min[0] + 0.13);
    expect(s.x + s.width / 2).toBeLessThan(max[0] - 0.13);
    expect(s.y - s.height / 2).toBeGreaterThan(min[1] + 0.13);
    expect(s.y + s.height / 2).toBeLessThan(max[1] - 0.13);
    // the board hangs on the front wall (max z); its frame's lip is the front (min z). The
    // lettering stands in front of the oak and behind the lip, so it neither sinks nor floats.
    const face = s.z - s.face;
    expect(face).toBeLessThan(max[2] - 0.18 - 0.02);
    expect(face).toBeGreaterThan(min[2] + 0.02);
    // well over a player's head (a player stands 2.6) and over the doors' arch
    expect(s.y - s.height / 2).toBeGreaterThan(6);
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
    expect(texts).toHaveLength(1);
    expect(built.mats.some((record) => record.mat === texts[0].material)).toBe(true);
  });
});
