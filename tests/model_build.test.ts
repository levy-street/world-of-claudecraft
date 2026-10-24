// The Build tool's custom-model pipeline: a MODEL_ASSET_ID placement carries
// its geometry inline (`meshes`) plus a built-in surface texture, survives the
// untrusted-document sanitizer, resolves to the MODEL_PATH procedural render
// asset, and fuses into a real mesh. Collision (when enabled) rides the same
// baked hitbox/ramp channel every placement uses.

import { describe, expect, it } from 'vitest';
import { cmBox, meshToHitboxes } from '../src/editor/cm_mesh';
import { placementsToRenderAssets } from '../src/editor/custom_map';
import { buildModelMesh } from '../src/render/model_gen';
import {
  MAX_MODEL_MESH_VERTS,
  MODEL_ASSET_ID,
  MODEL_PATH,
  sanitizeMapDoc,
} from '../src/sim/map_doc';

function rawDoc(placements: unknown[]): Record<string, unknown> {
  return {
    version: 2,
    meta: { id: 'm1', name: 'Map', seed: 7 },
    content: {
      zones: [
        { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [],
    placements,
  };
}

const boxMesh = () => {
  const m = cmBox(1, 1, 1, 1);
  return { verts: m.verts, tris: m.tris };
};

describe('built-model sanitizer round trip', () => {
  it('keeps a valid model placement geometry + texture', () => {
    const doc = sanitizeMapDoc(
      rawDoc([
        {
          assetId: MODEL_ASSET_ID,
          x: 5,
          z: -3,
          rotY: 0,
          scale: 1,
          collide: true,
          collisionMode: 'baked',
          meshes: [boxMesh()],
          modelTexId: 'Rock051',
          modelTexTile: 4,
        },
      ]),
    );
    const p = doc?.placements[0];
    expect(p?.assetId).toBe(MODEL_ASSET_ID);
    expect(p?.meshes?.length).toBe(1);
    expect(p?.meshes?.[0].verts.length).toBe(24);
    expect(p?.modelTexId).toBe('Rock051');
    expect(p?.modelTexTile).toBe(4);
  });

  it('drops a mesh with out-of-range indices but keeps the placement', () => {
    const doc = sanitizeMapDoc(
      rawDoc([
        {
          assetId: MODEL_ASSET_ID,
          x: 0,
          z: 0,
          rotY: 0,
          scale: 1,
          collide: false,
          meshes: [{ verts: [0, 0, 0, 1, 0, 0, 0, 0, 1], tris: [0, 1, 99] }],
        },
      ]),
    );
    // The placement survives; the single malformed volume is filtered out.
    expect(doc?.placements[0]?.assetId).toBe(MODEL_ASSET_ID);
    expect(doc?.placements[0]?.meshes).toBeUndefined();
  });

  it('rejects an absurd vertex count (bounds the document)', () => {
    const verts = new Array((MAX_MODEL_MESH_VERTS + 30) * 3).fill(0);
    const doc = sanitizeMapDoc(
      rawDoc([
        {
          assetId: MODEL_ASSET_ID,
          x: 0,
          z: 0,
          rotY: 0,
          scale: 1,
          collide: false,
          meshes: [{ verts, tris: [0, 1, 2] }],
        },
      ]),
    );
    expect(doc?.placements[0]?.meshes).toBeUndefined();
  });

  it('rejects an out-of-range texture tile', () => {
    const doc = sanitizeMapDoc(
      rawDoc([
        {
          assetId: MODEL_ASSET_ID,
          x: 0,
          z: 0,
          rotY: 0,
          scale: 1,
          collide: false,
          meshes: [boxMesh()],
          modelTexTile: 9999,
        },
      ]),
    );
    expect(doc?.placements[0]?.modelTexTile).toBe(64);
  });
});

describe('built-model render projection', () => {
  it('resolves MODEL_ASSET_ID to the MODEL_PATH and carries geometry + texture', () => {
    const [asset] = placementsToRenderAssets([
      {
        assetId: MODEL_ASSET_ID,
        x: 2,
        z: 2,
        rotY: 0,
        scale: 1,
        collide: false,
        meshes: [boxMesh()],
        modelTexId: 'Grass002',
        modelTexTile: 6,
      },
    ]);
    expect(asset?.path).toBe(MODEL_PATH);
    expect(asset?.meshes?.length).toBe(1);
    expect(asset?.modelTexId).toBe('Grass002');
    expect(asset?.modelTexTile).toBe(6);
  });

  it('projects baked collision hitboxes derived from the model mesh', () => {
    const box = cmBox(1, 1, 1, 1);
    const hitboxes = meshToHitboxes(box);
    const [asset] = placementsToRenderAssets([
      {
        assetId: MODEL_ASSET_ID,
        x: 0,
        z: 0,
        rotY: 0,
        scale: 1,
        collide: true,
        collisionMode: 'baked',
        meshes: [{ verts: box.verts, tris: box.tris }],
        hitboxes,
      },
    ]);
    expect(asset?.hitboxes?.length).toBeGreaterThan(0);
  });
});

describe('built-model mesh builder', () => {
  it('fuses volumes into a non-empty geometry with UVs and normals', () => {
    const mesh = buildModelMesh({ meshes: [boxMesh()] });
    const pos = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    const nrm = mesh.geometry.getAttribute('normal');
    // A box is 12 triangles -> 36 verts, non-indexed.
    expect(pos.count).toBe(36);
    expect(uv.count).toBe(36);
    expect(nrm.count).toBe(36);
    mesh.geometry.dispose();
  });

  it('skips degenerate triangles instead of emitting NaN geometry', () => {
    const flat = { verts: [0, 0, 0, 1, 0, 0, 2, 0, 0], tris: [0, 1, 2] }; // collinear
    const mesh = buildModelMesh({ meshes: [flat] });
    expect(mesh.geometry.getAttribute('position').count).toBe(0);
    mesh.geometry.dispose();
  });
});
