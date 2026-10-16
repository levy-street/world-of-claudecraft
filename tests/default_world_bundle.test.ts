import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { mapBounds, newCustomMap } from '../src/editor/custom_map';
import {
  ambientDecorationsToPlacements,
  closestAmbientDecorations,
} from '../src/editor/foliage_edit_core';
import { BUILTIN_WORLD } from '../src/sim/data';
import { generateGroundDressing } from '../src/sim/ground_dressing';
import { MAX_PLACEMENTS } from '../src/sim/map_doc';
import { generateDecorationsInBounds } from '../src/sim/world';

// The shipped default map (public/maps/default-world.wocmap.zip) is the world
// the editor opens on a fresh browser. It must BE the world the game boots ,
// the previous bundle was a v0.39 snapshot and had drifted a zone, 8 camps, 2
// ground objects and 11 roads behind it.
//
// This test rebuilds the doc from the live content and asserts it matches, so
// the drift cannot come back silently. `UPDATE_DEFAULT_WORLD=1 npx vitest run
// tests/default_world_bundle.test.ts` also writes the bundle.
/** The single deflate-raw member ("map.json") out of the shipped bundle. */
function readShippedBundleMember(): Buffer {
  const zip = readFileSync('public/maps/default-world.wocmap.zip');
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  return zip.subarray(start, start + zip.readUInt32LE(18));
}

describe('default world bundle', () => {
  it('builds the shipped default map from the live world', () => {
    const map = newCustomMap('World of ClaudeCraft', 'woc-v041-world', 1_756_000_000_000);
    map.meta.description = 'The live overworld, every prop and decoration editable.';
    const propPlacements = map.placements.length;

    // The same field the Foliage tool's "Make ALL foliage editable" converts.
    const mb = mapBounds(map);
    const bounds = { minX: -mb.halfW, maxX: mb.halfW, minZ: mb.zMin, maxZ: mb.zMax };
    const decorations = [
      ...generateDecorationsInBounds(map.meta.seed, bounds),
      ...generateGroundDressing(map.meta.seed, { leanFoliage: false, bounds }),
    ];
    const room = MAX_PLACEMENTS - map.placements.length;
    const focus = { x: 0, z: (bounds.minZ + bounds.maxZ) / 2 };
    const converted = ambientDecorationsToPlacements(
      closestAmbientDecorations(decorations, focus, room),
    );
    map.placements.push(...converted);
    // Every anchor is a placement now, so the render scatter stands down.
    map.decorationsMode = 'empty';

    // eslint-disable-next-line no-console
    console.log(
      `DEFAULT_WORLD ${JSON.stringify({
        zones: map.content.zones.length,
        camps: map.content.camps.length,
        objects: map.content.objects.length,
        roads: map.content.roads?.length ?? 0,
        propPlacements,
        decorationPlacements: converted.length,
        decorationsAvailable: decorations.length,
        placements: map.placements.length,
        cap: MAX_PLACEMENTS,
      })}`,
    );
    expect(map.placements.length).toBeLessThanOrEqual(MAX_PLACEMENTS);
    // The whole procedural field converts: nothing is left renderer-owned, and
    // nothing is dropped on the placement budget.
    expect(converted.length).toBe(decorations.length);

    // Content parity with the GAME's world, field for field, not just counts.
    expect(map.content.zones).toEqual(BUILTIN_WORLD.zones);
    expect(map.content.camps).toEqual(BUILTIN_WORLD.camps);
    expect(map.content.npcs).toEqual(BUILTIN_WORLD.npcs);
    expect(map.content.objects).toEqual(BUILTIN_WORLD.groundObjects);
    expect(map.content.roads).toEqual(BUILTIN_WORLD.roads);

    if (process.env.UPDATE_DEFAULT_WORLD === '1') {
      // Same container the importer reads: one deflate-raw member, "map.json".
      const json = Buffer.from(JSON.stringify(map));
      const body = deflateRawSync(json);
      const name = Buffer.from('map.json');
      const crc = (() => {
        let c = ~0;
        for (const b of json) {
          c ^= b;
          for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1));
        }
        return ~c >>> 0;
      })();
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04_03_4b_50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(json.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02_01_4b_50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(body.length, 20);
      central.writeUInt32LE(json.length, 24);
      central.writeUInt16LE(name.length, 28);
      const centralOffset = local.length + name.length + body.length;
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06_05_4b_50, 0);
      end.writeUInt16LE(1, 8);
      end.writeUInt16LE(1, 10);
      end.writeUInt32LE(central.length + name.length, 12);
      end.writeUInt32LE(centralOffset, 16);
      writeFileSync(
        'public/maps/default-world.wocmap.zip',
        Buffer.concat([local, name, body, central, name, end]),
      );
      // eslint-disable-next-line no-console
      console.log('WROTE public/maps/default-world.wocmap.zip');
    }

    // The bundle on disk must still be this world.
    const shipped = JSON.parse(
      inflateRawSync(readShippedBundleMember()).toString('utf8'),
    ) as typeof map;
    expect(shipped.content.zones.length).toBe(map.content.zones.length);
    expect(shipped.content.camps.length).toBe(map.content.camps.length);
    expect(shipped.content.objects.length).toBe(map.content.objects.length);
    expect(shipped.content.roads?.length).toBe(map.content.roads?.length);
    expect(shipped.placements.length).toBe(map.placements.length);
    expect(shipped.content.zones).toEqual(BUILTIN_WORLD.zones);
    expect(shipped.content.camps).toEqual(BUILTIN_WORLD.camps);
    expect(shipped.content.roads).toEqual(BUILTIN_WORLD.roads);
    expect(shipped.decorationsMode).toBe('empty');
    expect(shipped.propsMode).toBe('editable-all');
  });
});
