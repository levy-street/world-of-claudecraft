// The editor's locked flatten level, set-to-ground seating, and per-material
// texture finishes (src/editor/ground_level_core.ts, src/sim/material_finishes.ts,
// src/render/material_finishes.ts). Pinned here:
//  - a locked level wins over the press height, and an empty or bad entry
//    clears it;
//  - seating on the ground re-attaches a floated placement and drops its lift,
//    and a captured seat restores exactly what was there;
//  - material finishes sanitize (bad keys, empty finishes and over-cap slots
//    drop), set and clear one slot without mutating, list their imported
//    images for bundles, survive the shared map-document sanitizer, reach the
//    game world projection, and keep the placement out of instanced batching;
//  - the render side derives the same slot keys the editor stores, swaps only
//    the matching material for a hooked clone, and restores it on dispose.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap } from '../src/editor/custom_map';
import {
  applyGroundSeat,
  FLATTEN_LEVEL_LIMIT,
  flattenStrokeTarget,
  groundSeatOf,
  isOnGround,
  parseLevelInput,
  seatOnGround,
} from '../src/editor/ground_level_core';
import { finishTextureOptions } from '../src/editor/material_finish_options';
import {
  applyMaterialFinishes,
  materialSlotKey,
  materialSlots,
} from '../src/render/material_finishes';
import { placementBatchable } from '../src/render/placed_batch_core';
import { type MapPlacement, sanitizeMapDoc } from '../src/sim/map_doc';
import {
  MAX_MATERIAL_FINISHES,
  materialFinishTextureRefs,
  sanitizeMaterialFinishes,
  withMaterialFinish,
} from '../src/sim/material_finishes';
import type { PlacedAsset } from '../src/sim/types';

const SHA = 'a'.repeat(64);

describe('the flatten locked level', () => {
  it('levels to the lock when one is set, else to the press height', () => {
    expect(flattenStrokeTarget(null, 3.5)).toBe(3.5);
    expect(flattenStrokeTarget(12.25, 3.5)).toBe(12.25);
    expect(flattenStrokeTarget(-4, 3.5)).toBe(-4);
    expect(flattenStrokeTarget(Number.NaN, 3.5)).toBe(3.5);
  });

  it('reads a typed level, and clears it for an empty or unreadable entry', () => {
    expect(parseLevelInput(' 7.5 ')).toBe(7.5);
    expect(parseLevelInput('-2')).toBe(-2);
    expect(parseLevelInput('')).toBeNull();
    expect(parseLevelInput('high')).toBeNull();
  });

  it('clamps a typed level to the height range the map document keeps', () => {
    expect(parseLevelInput('500')).toBe(FLATTEN_LEVEL_LIMIT);
    expect(parseLevelInput('-999')).toBe(-FLATTEN_LEVEL_LIMIT);
    expect(FLATTEN_LEVEL_LIMIT).toBe(200);
  });
});

describe('seating on the ground', () => {
  const base = (): MapPlacement => ({
    assetId: 'props/well',
    x: 1,
    z: 2,
    rotY: 0,
    scale: 1,
    collide: true,
  });

  it('re-attaches a floated placement and drops its lift', () => {
    const p = { ...base(), detached: true, groundY: 4.2, y: 1.5 };
    expect(isOnGround(p)).toBe(false);
    seatOnGround(p);
    expect(p.detached).toBeUndefined();
    expect(p.groundY).toBeUndefined();
    expect(p.y).toBeUndefined();
    expect(isOnGround(p)).toBe(true);
  });

  it('treats a lifted but attached placement as off the ground too', () => {
    expect(isOnGround({ ...base(), y: 0.5 })).toBe(false);
    expect(isOnGround(base())).toBe(true);
  });

  it('restores exactly the captured seat (undo)', () => {
    const p = { ...base(), detached: true, groundY: 4.2, y: 1.5 };
    const before = groundSeatOf(p);
    seatOnGround(p);
    applyGroundSeat(p, before);
    expect({ detached: p.detached, groundY: p.groundY, y: p.y }).toEqual({
      detached: true,
      groundY: 4.2,
      y: 1.5,
    });
  });
});

describe('material finishes: the shared data', () => {
  it('keeps valid slots and drops bad keys, empty finishes and junk', () => {
    const clean = sanitizeMaterialFinishes({
      Walls: { texture: 'Bricks076C', tileSize: 3 },
      'roof#0': { color: 0x884422 },
      '': { texture: 'Wood001' },
      'bad\u0001key': { texture: 'Wood001' },
      Empty: {},
      Junk: 'not a finish',
      __proto__: { texture: 'Wood001' },
    });
    expect(clean).toEqual({
      Walls: { texture: 'Bricks076C', tileSize: 3 },
      'roof#0': { color: 0x884422 },
    });
    expect(sanitizeMaterialFinishes({})).toBeUndefined();
    expect(sanitizeMaterialFinishes(['Walls'])).toBeUndefined();
  });

  it('caps the slots one placement may override', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_MATERIAL_FINISHES + 5 }, (_, i) => [`m${i}`, { color: i }]),
    );
    expect(Object.keys(sanitizeMaterialFinishes(many) ?? {})).toHaveLength(MAX_MATERIAL_FINISHES);
  });

  it('sets and clears one slot without mutating the record', () => {
    const before = { Walls: { texture: 'Bricks076C' } };
    const set = withMaterialFinish(before, 'Roof', { texture: 'Wood001', tileSize: 2 });
    expect(set).toEqual({
      Walls: { texture: 'Bricks076C' },
      Roof: { texture: 'Wood001', tileSize: 2 },
    });
    expect(before).toEqual({ Walls: { texture: 'Bricks076C' } });
    expect(withMaterialFinish(set, 'Roof', null)).toEqual({ Walls: { texture: 'Bricks076C' } });
    expect(withMaterialFinish(before, 'Walls', null)).toBeUndefined();
  });

  it('lists imported images once each for map bundles', () => {
    expect(
      materialFinishTextureRefs({
        Walls: { texture: `custom:${SHA}` },
        Trim: { texture: `custom:${SHA}` },
        Roof: { texture: 'Wood001' },
      }),
    ).toEqual([SHA]);
  });

  it('survives the shared map-document sanitizer the server also applies', () => {
    const map = newCustomMap('Finishes', 'finishes', 1);
    const placement: MapPlacement = {
      assetId: 'props/well',
      x: 1,
      z: 2,
      rotY: 0,
      scale: 1,
      collide: true,
      materialFinishes: { Walls: { texture: 'Bricks076C', tileSize: 3, color: 0xffeedd } },
    };
    const doc = sanitizeMapDoc({ ...map, placements: [placement] });
    expect(doc?.placements[0].materialFinishes).toEqual(placement.materialFinishes);
  });

  it('reaches the game world projection and keeps the placement out of batching', () => {
    const map = newCustomMap('Finishes', 'finishes', 1);
    const finishes = { Roof: { texture: 'Wood001' } };
    map.placements = [
      {
        assetId: 'props/well',
        x: 1,
        z: 2,
        rotY: 0,
        scale: 1,
        collide: true,
        materialFinishes: finishes,
      },
    ];
    const world = customMapToWorldContent(map);
    const placed = world.placements?.find((p) => p.x === 1 && p.z === 2);
    expect(placed?.materialFinishes).toEqual(finishes);
    expect(placementBatchable(placed as PlacedAsset)).toBe(false);
    expect(placementBatchable({ ...(placed as PlacedAsset), materialFinishes: undefined })).toBe(
      true,
    );
  });

  it('offers only library textures that have catalog names', () => {
    const options = finishTextureOptions();
    expect(options.length).toBeGreaterThan(5);
    for (const o of options) expect(o.label).not.toContain('editor.buildMode.materialNames');
  });
});

describe('material finishes: the render side', () => {
  const model = () => {
    const root = new THREE.Group();
    const walls = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    walls.name = 'Walls';
    const roof = new THREE.MeshStandardMaterial({ color: 0x663322 });
    roof.name = 'Roof';
    const unnamed = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [walls, roof]);
    body.name = 'house';
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), unnamed);
    trim.name = 'trim';
    // a second mesh sharing the walls material lists it once
    const annex = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), walls);
    root.add(body, trim, annex);
    return { root, body, trim, annex, walls, roof, unnamed };
  };

  it('keys slots by material name, falling back to mesh and index', () => {
    expect(materialSlotKey('house', 'Walls', 0)).toBe('Walls');
    expect(materialSlotKey('trim', '', 0)).toBe('trim#0');
    expect(materialSlotKey('', ' ', 2)).toBe('mesh#2');
    const { root } = model();
    expect(materialSlots(root).map((s) => s.key)).toEqual(['Walls', 'Roof', 'trim#0']);
  });

  it('swaps only the matching materials for hooked clones and restores them', async () => {
    const { root, body, trim, annex, walls, roof, unnamed } = model();
    const view = applyMaterialFinishes(root, {
      Walls: { color: 0x336699 },
      'trim#0': { color: 0x112233 },
    });
    await view.ready;
    const bodyMats = body.material as THREE.Material[];
    expect(bodyMats[0]).not.toBe(walls);
    expect(bodyMats[0].customProgramCacheKey()).toContain('material-finish-v1');
    expect(bodyMats[1]).toBe(roof);
    expect(trim.material).not.toBe(unnamed);
    expect(annex.material).not.toBe(walls);
    view.dispose();
    expect((body.material as THREE.Material[])[0]).toBe(walls);
    expect(trim.material).toBe(unnamed);
    expect(annex.material).toBe(walls);
  });
});
