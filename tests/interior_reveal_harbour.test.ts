import fs from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { interiorSpecFor, isRevealShellName, revealState } from '../src/render/interior_reveal';

// A plain placement of a walk-in town building (a Studio map stands them that way) shows
// its room by hiding what is over the player: the G_H1 / G_H2 groups of the older models,
// and for the hand-built harbour lots the one-piece outer shell. These pins hold the lots'
// rows to the files that ship: a rebuilt room that outgrows its row, a renamed mesh or a
// new colour set without a row would otherwise leave a player under a solid roof.

const TOWN = path.resolve(process.cwd(), 'public/models/tidehold');
const SETS = fs
  .readdirSync(TOWN)
  .filter(
    (name) =>
      /^harbour(?:_[a-z]+)?$/.test(name) && fs.statSync(path.join(TOWN, name)).isDirectory(),
  )
  .sort();
const WALK_IN = ['tavern', 'tavern_b', 'bank', 'shop_a', 'shop_b', 'smithy'];
const NO_REVEAL = ['hall', 'house_a', 'house_b', 'house_c', 'guild'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

describe('the harbour lots interior reveal', () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  });

  it('serves every colour set of every walk-in lot from one row per model', () => {
    // the set the town paints by default and its seven repaints
    expect(SETS).toEqual([
      'harbour',
      'harbour_alpine',
      'harbour_brick',
      'harbour_diamond',
      'harbour_moss',
      'harbour_pantile',
      'harbour_shakes',
      'harbour_thatch',
    ]);
    for (const model of WALK_IN) {
      const first = interiorSpecFor(`/models/tidehold/harbour/${model}.glb`);
      expect(first, model).not.toBeNull();
      expect(first?.shell, model).toBe(true);
      expect(first?.volumes, model).toHaveLength(1);
      // one room, so nothing but the shell ever hides
      expect(first?.storeySplit, model).toBeUndefined();
      for (const set of SETS) {
        if (!fs.existsSync(path.join(TOWN, set, `${model}.glb`))) continue;
        expect(interiorSpecFor(`/models/tidehold/${set}/${model}.glb`), `${set}/${model}`).toBe(
          first,
        );
      }
    }
  });

  it('leaves the chapel, the sealed cottages and the guild hall without a reveal', () => {
    for (const model of NO_REVEAL) {
      expect(interiorSpecFor(`/models/tidehold/harbour/${model}.glb`), model).toBeNull();
    }
    // only the lots' own folders: never a look-alike path
    expect(interiorSpecFor('/models/tidehold/harbourside/tavern.glb')).toBeNull();
    expect(interiorSpecFor('/models/props/harbour/tavern.glb')).toBeNull();
    expect(interiorSpecFor('/models/tidehold/harbour/tavern.half.glb')).toBeNull();
  });

  it('keeps the older models on their own rows', () => {
    const tavern = interiorSpecFor('/models/tidehold/tavern.glb');
    expect(tavern?.storeySplit).toBe(5.55);
    expect(tavern?.shell).toBeUndefined();
    expect(interiorSpecFor('/models/tidehold/hall.glb')).toBeNull();
  });

  it('tells a lot shell from its room and from the older groups', () => {
    expect(isRevealShellName('tavern_L0')).toBe(true);
    expect(isRevealShellName('shop_a_L0')).toBe(true);
    expect(isRevealShellName('tavern_INT_L0')).toBe(false);
    expect(isRevealShellName('G_H2')).toBe(false);
    expect(isRevealShellName('G_INT_L0')).toBe(false);
  });

  it('measures each row off the room the shipped file carries', async () => {
    for (const model of WALK_IN) {
      const spec = interiorSpecFor(`/models/tidehold/harbour/${model}.glb`);
      if (!spec) throw new Error(`no row for ${model}`);
      const doc = await io.readBinary(
        new Uint8Array(fs.readFileSync(path.join(TOWN, 'harbour', `${model}.glb`))),
      );
      const nodes = doc.getRoot().listNodes();
      // exactly one shell to hide and one room to show
      expect(
        nodes.filter((node) => isRevealShellName(node.getName())).map((n) => n.getName()),
      ).toEqual([`${model}_L0`]);
      const room = nodes.find((node) => node.getName() === `${model}_INT_L0`);
      if (!room) throw new Error(`${model} ships no room mesh`);
      const bounds = getBounds(room);
      const v = spec.volumes[0];
      // the row is the room's floor plan: inside the room mesh on every side, and within a
      // yard and a half of its walls (a hearth or a porch may stand the mesh out further)
      expect(v.x0, `${model} x0`).toBeGreaterThanOrEqual(bounds.min[0] - 0.01);
      expect(v.x1, `${model} x1`).toBeLessThanOrEqual(bounds.max[0] + 0.01);
      expect(v.z0, `${model} z0`).toBeGreaterThanOrEqual(bounds.min[2] - 0.01);
      expect(v.z1, `${model} z1`).toBeLessThanOrEqual(bounds.max[2] + 0.01);
      expect(v.x1 - v.x0, `${model} width`).toBeGreaterThan(bounds.max[0] - bounds.min[0] - 3);
      expect(v.z1 - v.z0, `${model} depth`).toBeGreaterThan(bounds.max[2] - bounds.min[2] - 3);
      // from the ground line up to the ceiling: the room mesh's own height
      expect(v.y0, `${model} floor`).toBe(0);
      expect(v.y1, `${model} ceiling`).toBeGreaterThan(3.5);
      expect(v.y1, `${model} ceiling`).toBeLessThanOrEqual(bounds.max[1] + 0.3);

      // a player on the floor in the middle of the room is inside; one a stride outside
      // any wall, or over the roof, is not
      const floor = Math.max(0, bounds.min[1]);
      expect(revealState(spec, 0, floor + 0.1, 0), `${model} middle`).toBe(1);
      expect(revealState(spec, v.x1 + 1, floor + 0.1, 0), `${model} past +x`).toBe(0);
      expect(revealState(spec, v.x0 - 1, floor + 0.1, 0), `${model} past -x`).toBe(0);
      expect(revealState(spec, 0, floor + 0.1, v.z1 + 1), `${model} past +z`).toBe(0);
      expect(revealState(spec, 0, floor + 0.1, v.z0 - 1), `${model} past -z`).toBe(0);
      expect(revealState(spec, 0, v.y1 + 1, 0), `${model} over the ceiling`).toBe(0);
    }
  });
});
