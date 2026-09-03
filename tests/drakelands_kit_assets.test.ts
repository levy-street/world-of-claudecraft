// The Drakelands rebuild kit's shipping hygiene, pinned three ways so the
// cleanup that established it cannot silently regress:
//   1. every kit asset the loader registers has at least one REAL placement
//      in the fortress table (being wired into a loader is not being used;
//      five zero-placement pieces were stripped from shipping in the first
//      sweep, their sources archived under tmp/asset_src),
//   2. every kit GLB on disk is registered (no orphan file ships), and every
//      registered URL is on disk and in the media manifest,
//   3. no two kit files carry the same bytes, the same embedded texture
//      payload, or the same mesh POSITION payload (the same thing must never
//      ship twice under two names).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { IGNIVAR_ENV_PROP_URLS } from '../src/render/ignivar_env_props';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';

const KIT_PREFIX = '/models/drakelands_kit/';
const KIT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/models/drakelands_kit',
);

const kitEntries = Object.entries(IGNIVAR_ENV_PROP_URLS).filter(([, url]) =>
  url.startsWith(KIT_PREFIX),
);

describe('drakelands rebuild kit shipping hygiene', () => {
  it('every registered kit asset has a real placement', () => {
    const placedKeys = new Set(FORGEFATHER_FORTRESS_PLACEMENTS.map((p) => p.key));
    const unplaced = kitEntries.filter(([key]) => !placedKeys.has(key as never)).map(([k]) => k);
    expect(
      unplaced,
      'kit assets registered in the loader but placed nowhere; strip them from ' +
        'shipping (archive the source under tmp/asset_src) or place them',
    ).toEqual([]);
    // vacuity floor: the kit really is registered and really is placed
    expect(kitEntries.length).toBeGreaterThanOrEqual(18);
  });

  it('disk, loader map, and media manifest agree on the kit set', () => {
    const onDisk = readdirSync(KIT_DIR)
      .filter((f) => f.endsWith('.glb'))
      .sort();
    const registered = kitEntries.map(([, url]) => path.basename(url)).sort();
    expect(onDisk).toEqual(registered);
    for (const [, url] of kitEntries)
      expect(MEDIA_ASSETS[url.slice(1)], `${url} in the media manifest`).toBeDefined();
  });

  it('no kit file, texture payload, or mesh payload ships twice', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const files = new Map<string, string>();
    const textures = new Map<string, string>();
    const meshes = new Map<string, string>();
    const claim = (map: Map<string, string>, hash: string, owner: string, what: string) => {
      const prior = map.get(hash);
      expect(
        prior === undefined || prior === owner,
        `${what} shared by ${prior} and ${owner}`,
      ).toBe(true);
      map.set(hash, owner);
    };
    for (const f of readdirSync(KIT_DIR)
      .filter((f) => f.endsWith('.glb'))
      .sort()) {
      const full = path.join(KIT_DIR, f);
      claim(files, digest(readFileSync(full)), f, 'file bytes');
      const doc = await io.read(full);
      for (const tex of doc.getRoot().listTextures()) {
        const img = tex.getImage();
        if (img) claim(textures, digest(img), f, 'texture payload');
      }
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          if (!pos) continue;
          const arr = pos.getArray();
          if (arr)
            claim(
              meshes,
              digest(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)),
              f,
              'mesh POSITION payload',
            );
        }
      }
    }
    // vacuity floor: the sweep really hashed a full kit
    expect(files.size).toBeGreaterThanOrEqual(18);
  });
});
