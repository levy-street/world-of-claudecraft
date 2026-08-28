// Transmissive GLB materials become translucent at load
// (src/render/assets/transmission_neutralize.ts): three's transmission pass
// (a second full-scene render per frame) never runs for a shipped asset.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isTransmissive,
  neutralizeGltfTransmission,
  neutralizeTransmission,
  TRANSMISSION_OPACITY_LOSS,
} from '../src/render/assets/transmission_neutralize';

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
    const loader = readFileSync(new URL('../src/render/assets/loader.ts', import.meta.url), 'utf8');
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
    const length = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + length).toString('utf8')) as {
      materials?: { name?: string; extensions?: Record<string, unknown> }[];
    };
    const transmissive = (json.materials ?? [])
      .filter((m) => m.extensions?.KHR_materials_transmission)
      .map((m) => m.name);
    expect(transmissive).toEqual(['living_water', 'deep_water']);
  });
});
