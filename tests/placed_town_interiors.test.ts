import { afterEach, describe, expect, it } from 'vitest';
import {
  interiorCameraInternalsForTest,
  registerCameraInterior,
} from '../src/render/interior_camera';
import { cameraInterior } from '../src/render/interior_camera_core';
import { placedTownCameraInterior } from '../src/render/placed_town_interior_core';
import { createPlacedTownInteriors } from '../src/render/placed_town_interiors';

// The registrar a town view keeps for its walk-in painted buildings
// (src/render/placed_town_interiors.ts): what it registers with the indoor camera, and that a
// view's next build drops exactly what the last one registered, never another view's rooms.

afterEach(() => interiorCameraInternalsForTest.reset());

/** A walk-in record of a painted model, seated the way every town seats one. */
function record(id: string, name: string, scale: number, rotation = 0, walkIn = true) {
  return {
    id,
    assetId: `/models/tidehold/${name}.glb`,
    walkIn,
    placement: { x: 20 + id.length, z: -30, rotation, scale, lift: -(scale + 0.05) },
  };
}

const registered = () => interiorCameraInternalsForTest.interiors().map((room) => room.id);

describe('a town view registrar of camera interiors', () => {
  it('registers a walk-in building on the ground under its anchor', () => {
    const interiors = createPlacedTownInteriors();
    const inn = record('town_inn', 'tavern', 1.3, Math.PI / 2);
    const groundAt = (x: number, z: number) => 0.5 * x - 0.25 * z;
    const air = placedTownCameraInterior(inn, groundAt(inn.placement.x, inn.placement.z));
    // it hands back the air it registered (its doors feed the town's camera fade)
    expect(interiors.add(inn, groundAt)).toEqual(air);
    expect(interiors.ids()).toEqual(['placed_town:town_inn']);
    expect(interiorCameraInternalsForTest.interiors()).toEqual([air]);
  });

  it('registers nothing for a sealed record or a model with no air', () => {
    const interiors = createPlacedTownInteriors();
    const groundAt = () => 2;
    expect(interiors.add(record('shut_inn', 'tavern', 1, 0, false), groundAt)).toBeNull();
    expect(interiors.add(record('cottage', 'house_b', 1), groundAt)).toBeNull();
    expect(interiors.add(record('vault', 'vault', 1), groundAt)).toBeNull();
    expect(interiors.ids()).toEqual([]);
    expect(registered()).toEqual([]);
  });

  it('registers a walk-in building at any turn, its air in its own frame', () => {
    // Eastbrook stands its buildings at the Studio map's own turns (the bank at 225 degrees)
    const interiors = createPlacedTownInteriors();
    const groundAt = (x: number, z: number) => 0.5 * x - 0.25 * z;
    const bank = record('skew_bank', 'bank', 1.3, (225 * Math.PI) / 180);
    const air = interiors.add(bank, groundAt);
    expect(air).toEqual(
      placedTownCameraInterior(bank, groundAt(bank.placement.x, bank.placement.z)),
    );
    expect(air?.frame).toMatchObject({
      x: bank.placement.x,
      z: bank.placement.z,
      yaw: bank.placement.rotation,
    });
    expect(interiors.ids()).toEqual(['placed_town:skew_bank']);
    expect(interiorCameraInternalsForTest.interiors()).toEqual([air]);
  });

  it('drops what it registered on clear, and only that', () => {
    // two town views, each with its own registrar, and a building registered elsewhere (the
    // Mirefen tavern registers its own)
    const east = createPlacedTownInteriors();
    const fen = createPlacedTownInteriors();
    const groundAt = () => 1;
    registerCameraInterior(cameraInterior('mirefen_tavern', [[0, 4, 0, 4, 0, 4]]));
    east.add(record('east_bank', 'bank', 1.3), groundAt);
    east.add(record('east_shop', 'shop_a', 1.5), groundAt);
    fen.add(record('fen_shop', 'shop_b', 1.5), groundAt);
    expect(registered()).toEqual([
      'mirefen_tavern',
      'placed_town:east_bank',
      'placed_town:east_shop',
      'placed_town:fen_shop',
    ]);
    east.clear();
    expect(east.ids()).toEqual([]);
    expect(registered()).toEqual(['mirefen_tavern', 'placed_town:fen_shop']);
    // a rebuild registers afresh, never doubling a room it already holds
    fen.clear();
    fen.add(record('fen_shop', 'shop_b', 1.5), groundAt);
    fen.add(record('fen_shop', 'shop_b', 1.5), groundAt);
    expect(fen.ids()).toEqual(['placed_town:fen_shop']);
    expect(registered()).toEqual(['mirefen_tavern', 'placed_town:fen_shop']);
    fen.clear();
    expect(registered()).toEqual(['mirefen_tavern']);
  });
});
