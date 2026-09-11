// The Drakelands rebuild kit's load-time grade (ignivar_env_props.ts
// applyDrakelandsKitWarmth) keeps its ember emissive floor, but the floor
// must ride the piece's base-colour atlas rather than sit on the material as
// a constant: a flat emissive term adds the same value to every texel however
// the face is lit, and on the kit's dark baked textures that rendered whole
// buildings as one uniform slab at dusk and night (the same grey-film class
// tests/authored_surfaces.test.ts guards on creatures and held items, which
// does not sweep environment props). Two pins:
//   1. the grade routes the floor through the atlas (emissiveMap is the base
//      map) and keeps the warm multiply, on a material shaped like the loader
//      hands it (a base map, no emissive map),
//   2. every shipped kit GLB actually carries a base-colour texture, so the
//      route has an atlas to ride on for EVERY piece (a textureless piece
//      would fall back to the constant floor this fix retires).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_ENV_PROP_URLS,
  ignivarEnvPropsInternalsForTest,
} from '../src/render/ignivar_env_props';

const KIT_PREFIX = '/models/drakelands_kit/';
// the shipped grade values, pinned as literals (a drift in either changes the
// night read this file exists to protect)
const KIT_EMISSIVE_HEX = 0x462314;
const KIT_EMISSIVE_INTENSITY = 12;
const KIT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/models/drakelands_kit',
);

function kitMaterial(): THREE.MeshStandardMaterial {
  const map = new THREE.Texture();
  map.name = 'church_basecolor';
  return new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 });
}

describe('drakelands rebuild kit grade', () => {
  it('routes the ember emissive floor through the base-colour atlas', () => {
    const material = kitMaterial();
    const atlas = material.map;
    ignivarEnvPropsInternalsForTest.applyDrakelandsKitWarmth(material);
    // the floor stays (night read beside the lamp wash) ...
    expect(material.emissiveIntensity).toBe(KIT_EMISSIVE_INTENSITY);
    expect(material.emissive.getHex()).toBe(KIT_EMISSIVE_HEX);
    // ... but never as a constant: it samples the piece's own atlas (the
    // texture captured BEFORE the call, so a grade that nulled both slots
    // could not pass by identity)
    expect(atlas).not.toBeNull();
    expect(material.emissiveMap).toBe(atlas);
    expect(material.map).toBe(atlas);
    // and the warm albedo lift is unchanged
    expect(material.color.r).toBeCloseTo(1.4, 5);
    expect(material.color.g).toBeCloseTo(1.24, 5);
    expect(material.color.b).toBeCloseTo(1.1, 5);
  });

  it('is idempotent: a second grade keeps the atlas route', () => {
    const material = kitMaterial();
    const atlas = material.map;
    ignivarEnvPropsInternalsForTest.applyDrakelandsKitWarmth(material);
    ignivarEnvPropsInternalsForTest.applyDrakelandsKitWarmth(material);
    expect(material.emissiveMap).toBe(atlas);
    expect(material.emissiveIntensity).toBe(KIT_EMISSIVE_INTENSITY);
  });

  it('does not fabricate an emissive map for a material without a base map', () => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    ignivarEnvPropsInternalsForTest.applyDrakelandsKitWarmth(material);
    // the grade ran (liveness control) ...
    expect(material.emissive.getHex()).toBe(KIT_EMISSIVE_HEX);
    // ... and left the slot empty rather than pointing it at a stand-in
    expect(material.emissiveMap).toBeNull();
  });

  it('never clobbers an authored emissive texture with the atlas route', () => {
    const material = kitMaterial();
    const glow = new THREE.Texture();
    glow.name = 'window_glow';
    material.emissiveMap = glow;
    ignivarEnvPropsInternalsForTest.applyDrakelandsKitWarmth(material);
    expect(material.emissiveMap).toBe(glow);
  });

  it('every shipped kit piece carries a base-colour atlas and no authored emissive', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    // the registered set and the on-disk set agree name-exact already
    // (tests/drakelands_kit_assets.test.ts); this sweep is about what each
    // piece's material carries
    const registered = Object.values(IGNIVAR_ENV_PROP_URLS).filter((url) =>
      url.startsWith(KIT_PREFIX),
    );
    const onDisk = readdirSync(KIT_DIR).filter((f) => f.endsWith('.glb'));
    // occurrence bound: the sweep must actually examine the whole kit
    expect(registered.length).toBeGreaterThan(0);
    expect(onDisk.length).toBe(registered.length);
    let inspected = 0;
    const textureless: string[] = [];
    const authoredEmissive: string[] = [];
    for (const file of onDisk) {
      const document = await io.read(path.join(KIT_DIR, file));
      for (const material of document.getRoot().listMaterials()) {
        inspected += 1;
        const id = `${file}:${material.getName()}`;
        if (!material.getBaseColorTexture()) textureless.push(id);
        // a future piece that bakes its own glow keeps it (the loader guard
        // above), but then the floor no longer rides the atlas for that
        // piece: surface it here so the drop decides on purpose
        if (material.getEmissiveTexture()) authoredEmissive.push(id);
      }
    }
    // at least one material per file was actually examined
    expect(inspected).toBeGreaterThanOrEqual(onDisk.length);
    expect(textureless, 'kit materials with no base-colour atlas').toEqual([]);
    expect(authoredEmissive, 'kit materials shipping their own emissive texture').toEqual([]);
  });
});
