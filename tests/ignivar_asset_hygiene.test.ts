// Asset hygiene for the Ignivar prop drop: the shipped set never carries
// the same payload twice, and never ships a prop nothing places.
//
// Both rules exist because both defects shipped: the exterior pack's
// Lava_Furnace.glb was the interior lava_furnace's mesh byte for byte
// (two files, one model, players downloading it twice), and lava_ramp
// rode the loader maps with zero placements in any sim table. The
// duplicate sweep hashes whole files, every embedded texture image, and
// every decoded mesh payload (POSITION plus indices), so a re-bake that
// reships an existing model under a new name goes red however the
// container bytes differ.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { IGNIVAR_ENV_PROP_URLS } from '../src/render/ignivar_env_props';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_LAYOUT,
  IGNIVAR_LIFT_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../src/sim/dungeon_layout';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';
import {
  ignivarApproachPropPlacements,
  ignivarArenaPropPlacements,
  ignivarCruciblePropPlacements,
  ignivarLiftPropPlacements,
} from '../src/sim/ignivar_props';

const publicDir = path.join(__dirname, '..', 'public');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Keys shipped ahead of their placements, each a visible maintainer
// decision. SHRINK-ONLY: never park a new asset here; place it or strip
// it (the lava_ramp recipe: loader rows out, GLB out of public/, source
// kept under tmp/asset_src). The raid arm's 2026-08 unplaced-prop trim
// stripped the rest of the BASE-drop interior placer stock, and the raid
// interior dressing now places every survivor, torch included, so the
// list is empty today.
const EXPECTED_UNPLACED: ReadonlySet<string> = new Set<string>();

/** Every prop placement the REAL sim tables author (wired into a loader
 *  does not count as used; these tables are what the game draws). */
function placedKeys(): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const row of FORGEFATHER_FORTRESS_PLACEMENTS) bump(row.key);
  for (const row of ignivarApproachPropPlacements(IGNIVAR_FORGE_APPROACH_LAYOUT)) bump(row.key);
  for (const row of ignivarArenaPropPlacements(IGNIVAR_LAYOUT)) bump(row.key);
  for (const row of ignivarCruciblePropPlacements(IGNIVAR_SECOND_WING_LAYOUT)) bump(row.key);
  for (const row of ignivarLiftPropPlacements(IGNIVAR_LIFT_LAYOUT)) bump(row.key);
  return counts;
}

describe('ignivar asset hygiene', () => {
  it('every shipped prop key has at least one authored placement', () => {
    const counts = placedKeys();
    const unplaced = Object.keys(IGNIVAR_ENV_PROP_URLS).filter(
      (key) => !(counts.get(key) ?? 0) && !EXPECTED_UNPLACED.has(key),
    );
    expect(unplaced, 'shipped props with zero placements (place or strip them)').toEqual([]);
    // the exception list stays honest both ways: an entry that gained
    // placements comes OFF the list in the same change
    for (const key of EXPECTED_UNPLACED) {
      expect(counts.get(key) ?? 0, `${key} is placed now: remove it from EXPECTED_UNPLACED`).toBe(
        0,
      );
      expect(key in IGNIVAR_ENV_PROP_URLS, `${key} is not a shipped key any more`).toBe(true);
    }
  });

  it('no two shipped prop files carry the same file, texture, or mesh payload', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const files = [...new Set(Object.values(IGNIVAR_ENV_PROP_URLS))];
    const byFile = new Map<string, string[]>();
    const byTexture = new Map<string, Set<string>>();
    const byMesh = new Map<string, Set<string>>();
    for (const url of files) {
      const file = path.join(publicDir, url.replace(/^\//, ''));
      expect(existsSync(file), `${url} should exist under public/`).toBe(true);
      const raw = await readFile(file);
      const fileHash = sha(raw);
      byFile.set(fileHash, [...(byFile.get(fileHash) ?? []), url]);
      const doc = await io.read(file);
      for (const texture of doc.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) continue;
        const hash = sha(new Uint8Array(image));
        byTexture.set(hash, (byTexture.get(hash) ?? new Set()).add(url));
      }
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const position = primitive.getAttribute('POSITION');
          if (!position) continue;
          const digest = createHash('sha256');
          const posArray = position.getArray();
          if (!posArray) continue;
          digest.update(new Uint8Array(posArray.buffer, posArray.byteOffset, posArray.byteLength));
          const indices = primitive.getIndices();
          const idxArray = indices?.getArray();
          if (idxArray)
            digest.update(
              new Uint8Array(idxArray.buffer, idxArray.byteOffset, idxArray.byteLength),
            );
          const hash = digest.digest('hex');
          byMesh.set(hash, (byMesh.get(hash) ?? new Set()).add(url));
        }
      }
    }
    const collisions = (map: Map<string, Iterable<string>>) =>
      [...map.values()].map((set) => [...set]).filter((list) => list.length > 1);
    expect(collisions(byFile), 'byte-identical shipped files').toEqual([]);
    expect(collisions(byTexture), 'the same texture shipped in two files').toEqual([]);
    expect(collisions(byMesh), 'the same mesh payload shipped in two files').toEqual([]);
  });
});
