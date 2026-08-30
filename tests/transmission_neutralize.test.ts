// Transmissive GLB materials become translucent at load
// (src/render/assets/transmission_neutralize.ts): three's transmission pass
// (a second full-scene render per frame) never runs for a shipped asset.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isTransmissive,
  neutralizeGltfTransmission,
  neutralizeTransmission,
  TRANSMISSION_OPACITY_LOSS,
} from '../src/render/assets/transmission_neutralize';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

describe('neutralizeTransmission', () => {
  it('turns a transmissive physical material into a translucent one', () => {
    const material = new THREE.MeshPhysicalMaterial({ transmission: 0.9, thickness: 0.24 });
    expect(isTransmissive(material)).toBe(true);
    expect(neutralizeTransmission(material)).toBe(true);
    expect(material.transmission).toBe(0);
    expect(isTransmissive(material)).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(1 - 0.9 * TRANSMISSION_OPACITY_LOSS, 6);
    expect(material.opacity).toBeCloseTo(0.8, 2);
    expect(material.depthWrite).toBe(false);
  });

  it('keeps an authored lower opacity and leaves opaque materials alone', () => {
    const faint = new THREE.MeshPhysicalMaterial({ transmission: 0.5, opacity: 0.3 });
    neutralizeTransmission(faint);
    expect(faint.opacity).toBe(0.3);
    const plain = new THREE.MeshStandardMaterial({ opacity: 1 });
    expect(neutralizeTransmission(plain as unknown as THREE.MeshPhysicalMaterial)).toBe(false);
    expect(plain.transparent).toBe(false);
    expect(plain.opacity).toBe(1);
  });

  it('walks a parsed GLB once per material, arrays included', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshPhysicalMaterial({ transmission: 0.72 });
    const plain = new THREE.MeshStandardMaterial();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), shared));
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), [shared, plain]));
    expect(neutralizeGltfTransmission({ scene })).toBe(1);
    expect(shared.transmission).toBe(0);
    expect(shared.transparent).toBe(true);
    expect(plain.transparent).toBe(false);
  });
});

describe('the loader applies the rule to every parsed GLB', () => {
  it('runs the walk in the parse resolve chain, before any consumer sees the scene', () => {
    // Comments stripped, so a commented-out call cannot satisfy the pin.
    const loader = stripComments(
      readFileSync(new URL('../src/render/assets/loader.ts', import.meta.url), 'utf8'),
    );
    const polish = loader.indexOf('polishGltfTextures(gltf);');
    const neutralize = loader.indexOf('neutralizeGltfTransmission(gltf);');
    expect(polish).toBeGreaterThan(-1);
    expect(neutralize).toBeGreaterThan(polish);
  });

  it('knows the shipped GLBs that carry the extension', () => {
    // The sweep of 2026-08-28: one creature declares transmissive materials.
    // A new one is allowed (the loader neutralizes it) but should be listed
    // here on purpose, since its author probably expected refraction.
    const glb = readFileSync(
      new URL('../public/models/creatures/water_elemental.glb', import.meta.url),
    );
    const transmissive = glbMaterials(glb)
      .filter((m) => m.extensions?.KHR_materials_transmission)
      .map((m) => m.name);
    expect(transmissive).toEqual(['living_water', 'deep_water']);
  });
});

interface GlbMaterial {
  name?: string;
  extensions?: Record<string, unknown>;
}

/** The materials of a GLB's JSON chunk (12-byte header, chunk 0 length at
 *  offset 12, its JSON at offset 20). */
function glbMaterials(glb: Buffer): GlbMaterial[] {
  if (glb.readUInt32LE(0) !== 0x46546c67) return [];
  const length = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + length).toString('utf8')) as {
    materials?: GlbMaterial[];
  };
  return json.materials ?? [];
}

function* walkGlbs(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkGlbs(full);
    else if (entry.name.endsWith('.glb')) yield full;
  }
}

describe('no material buys a second scene pass (src/render/CLAUDE.md)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));

  /** Shipped models whose materials carry KHR_materials_transmission or
   *  KHR_materials_volume, each neutralized at load. A new entry is a
   *  decision, not a fact: the asset pipeline preserves the extension
   *  (gltf-transform registers ALL_EXTENSIONS) and Tripo generates with
   *  `pbr: true`, so a glass-like prompt lands one here. List it, and know
   *  that the player will see alpha blending, never refraction. */
  const TRANSMISSIVE_GLBS: Record<string, readonly string[]> = {
    'public/models/creatures/water_elemental.glb': ['living_water', 'deep_water'],
  };

  it('every shipped GLB with a transmissive or volume material is listed on purpose', () => {
    const found: Record<string, string[]> = {};
    let scanned = 0;
    for (const file of walkGlbs(join(root, 'public'))) {
      scanned++;
      const names = glbMaterials(readFileSync(file))
        .filter(
          (m) =>
            m.extensions?.KHR_materials_transmission !== undefined ||
            m.extensions?.KHR_materials_volume !== undefined,
        )
        .map((m) => m.name ?? '(unnamed)');
      if (names.length > 0) found[relative(root, file)] = names;
    }
    // The vacuity floor: the walk must have seen the real model tree.
    expect(scanned).toBeGreaterThan(1000);
    expect(found).toEqual(TRANSMISSIVE_GLBS);
  });

  it('constructs no MeshPhysicalMaterial and sets no transmission in the client source', () => {
    // three's transmission pass is what a MeshPhysicalMaterial with
    // transmission > 0 buys; a physical material with none of it is a
    // MeshStandardMaterial with extra uniforms. Translucency here is alpha
    // blending. The neutralizer is the one writer, and it writes zero.
    const offenders: string[] = [];
    for (const dir of ['src/render', 'src/ui', 'src/game', 'src/editor', 'src/guide']) {
      for (const { file, full } of tsFilesUnder(join(root, dir))) {
        if (file.endsWith('.test.ts')) continue;
        const rel = `${dir}/${file}`;
        if (rel === 'src/render/assets/transmission_neutralize.ts') continue;
        const source = readFileSync(full, 'utf8');
        if (/new\s+(THREE\.)?MeshPhysicalMaterial\s*\(/.test(source))
          offenders.push(`${rel}: construction`);
        if (/\btransmission\s*[:=]\s*(?!0\b)[0-9.]/.test(source))
          offenders.push(`${rel}: transmission set`);
        if (/\b(thickness|attenuationColor|attenuationDistance)\s*[:=]/.test(source)) {
          offenders.push(`${rel}: volume set`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
