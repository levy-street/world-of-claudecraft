// The ground footprint, at scale 1, of every decor model a `seat: 'footprint'` row may
// name: the model's bounding width (x) and depth (z) in its own axes, and its height (y).
// The renderer draws each model centred on this footprint with its base at the row's
// base Y (src/render/props.ts propAsset), so these are the extents the seat in
// src/sim/decor_seat.ts samples the ground under.
//
// Data, copied from the GLB-measured src/render/prop_natural_size.generated.ts (the sim
// may not import render). tests/decor_seat.test.ts pins every row here to that table, so
// a re-exported model that changes size fails the test instead of drifting.

export interface DecorFootprint {
  /** Bounding width along the model's local x, scale 1. */
  x: number;
  /** Bounding height, scale 1. */
  y: number;
  /** Bounding depth along the model's local z, scale 1. */
  z: number;
}

export const DECOR_FOOTPRINTS: Readonly<Record<string, DecorFootprint>> = {
  // the Gyre's council seat, beacons and storm stone (content/quartered_council_seat.ts,
  // content/quartered_gyre_crags.ts)
  councilPlaza: { x: 10, y: 0.16, z: 10 },
  councilSeatGate: { x: 8.0508, y: 9, z: 4.3565 },
  councilBeacon: { x: 1.8987, y: 4.6, z: 1.8313 },
  gyreStormSpire: { x: 11.8557, y: 22, z: 10.1765 },
  gyreStormBluff: { x: 18, y: 9.1728, z: 10.4209 },
  gyreStormArch: { x: 14.4, y: 11.3606, z: 7.1251 },
  gyreStormStone: { x: 3.013, y: 8, z: 2.7786 },
  // the quarters' generated stone (content/quartered_spires.ts)
  cinderColumnsTall: { x: 11.3423, y: 12, z: 10.7314 },
  cinderLavaVent: { x: 8.0803, y: 1.2002, z: 8.112 },
  heaveStrataSmall: { x: 7.4816, y: 6.0005, z: 7.7229 },
  heaveStrataLarge: { x: 13.8359, y: 14, z: 12.3012 },
  heaveStrataRubble: { x: 9.0552, y: 1.4994, z: 9.463 },
  frostFloeSlab: { x: 4.7813, y: 1.6, z: 4.6879 },
  frostFloeBroad: { x: 9.0731, y: 1.3996, z: 9.2909 },
  frostSnowOutcrop: { x: 8.1061, y: 8.9996, z: 10.8723 },
  // the stock rock and ruin kit (the Fireice Rift's teeth, the Hammer's Cut, the Fallen Giant)
  rockTallA: { x: 0.983, y: 0.9959, z: 0.6832 },
  rockTallH: { x: 0.575, y: 0.7108, z: 0.6638 },
  rockLargeD: { x: 1.0688, y: 0.5683, z: 1.0303 },
  statueHead: { x: 0.726, y: 1, z: 0.5544 },
  statueBlock: { x: 0.4, y: 0.4, z: 0.4 },
  columnBroken: { x: 0.3, y: 0.7, z: 0.3 },
};
