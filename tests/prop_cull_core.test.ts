// The prop band fog cull and its first-reveal policy (prop_cull_core.ts): the
// props twin of town_reveal_core. A band's first fog reveal on a walking
// approach consults the gate and holds while cold; a band already near the
// camera (login, hearth, teleport) consults too and holds too, but its consult
// is IMMINENT and a frame's imminent consults run nearest first; only the reach
// floor reveals instantly; a revealed band never consults again; no gate keeps
// the historical immediate cull. Nothing here answers to a clock.

import { describe, expect, it } from 'vitest';
import { PROP_FAR_SWAP_DISTANCE, propCellKey, propCellNearKey } from '../src/render/prop_cell_core';
import {
  newPropCullPass,
  PROP_CULL_REVEAL_NEAR_FRACTION,
  PROP_CULL_REVEAL_REACH,
  type PropCullBounds,
  propCullBoxDistanceSq,
  propCullConsultImminent,
  propCullInFog,
  propCullKey,
  propCullReveal,
  propRevealRoots,
  updatePropCullable,
  updatePropCullables,
} from '../src/render/prop_cull_core';
import { createRevealGateCore, type RevealGateCoreOptions } from '../src/render/reveal_gate_core';

const box = (minX: number, maxX: number, minZ: number, maxZ: number): PropCullBounds => ({
  hasBox: true,
  minX,
  maxX,
  minZ,
  maxZ,
  cx: (minX + maxX) / 2,
  cz: (minZ + maxZ) / 2,
  r: Math.hypot(maxX - minX, maxZ - minZ) / 2,
});

const sphere = (cx: number, cz: number, r: number): PropCullBounds => ({
  hasBox: false,
  minX: cx - r,
  maxX: cx + r,
  minZ: cz - r,
  maxZ: cz + r,
  cx,
  cz,
  r,
});

function cullable(bounds: PropCullBounds, key = 'cull:0') {
  return { ...bounds, key, revealed: false, held: false, obj: { visible: true } };
}

function gateWith(requested: string[], options?: RevealGateCoreOptions) {
  return createRevealGateCore((key) => requested.push(key), options);
}

/** The historical props.ts cull, composed the way updatePropCullable does. */
function inFog(c: PropCullBounds, camX: number, camZ: number, fogFar: number): boolean {
  return propCullInFog(
    c,
    propCullBoxDistanceSq(c, camX, camZ),
    camX,
    camZ,
    fogFar,
    fogFar * fogFar,
  );
}

describe('prop cull fog test', () => {
  it('culls a boxed band by its box distance and a sphere band by its reach', () => {
    const band = box(100, 300, -50, 50);
    // Box distance 20 < fogFar 100.
    expect(inFog(band, 80, 0, 100)).toBe(true);
    // Box distance 100 is NOT < 100 (the exact fog boundary is excluded).
    expect(inFog(band, 0, 0, 100)).toBe(false);
    // Inside the box: distance 0.
    expect(propCullBoxDistanceSq(band, 200, 0)).toBe(0);
    // A sphere band past its box distance still draws while its centre is
    // within fogFar + r (the historical fallback).
    const orb = sphere(0, 0, 10);
    expect(inFog(orb, 105, 0, 100)).toBe(true);
    expect(inFog(orb, 111, 0, 100)).toBe(false);
  });
});

describe('prop cull gate keys and roots', () => {
  it('mints dense band keys that never collide with the far-cell grid keys', () => {
    expect([0, 1, 7].map(propCullKey)).toEqual(['cull:0', 'cull:1', 'cull:7']);
    // Both namespaces share ONE props gate: a far-cell key must never look
    // like a band key, whatever the cell coordinates.
    for (const [x, z] of [
      [0, 0],
      [-1, -1],
      [119, 119],
      [120, -120],
      [-100000, 100000],
    ]) {
      expect(propCellKey(x, z)).not.toMatch(/^cull:/);
    }
  });

  it('resolves a far cell to its bake meshes, its near key to the members, a band to its one object, a stranger to nothing', () => {
    const bakeA = { name: 'bake-a' };
    const bakeB = { name: 'bake-b' };
    const band = { name: 'band' };
    const memberA = { name: 'member-a' };
    const memberB = { name: 'member-b' };
    const farCells = new Map([
      ['0:1', { meshes: [bakeA, bakeB], hideables: [{ group: memberA }, { group: memberB }] }],
    ]);
    const bands = new Map([['cull:3', { obj: band }]]);
    expect(propRevealRoots(farCells, bands, '0:1')).toEqual([bakeA, bakeB]);
    // The cell's near key resolves to its members' own groups (the roots the
    // first near flip links), a stranger's near key to nothing.
    expect(propRevealRoots(farCells, bands, propCellNearKey('0:1'))).toEqual([memberA, memberB]);
    expect(propRevealRoots(farCells, bands, propCellNearKey('9:9'))).toEqual([]);
    expect(propRevealRoots(farCells, bands, 'cull:3')).toEqual([band]);
    expect(propRevealRoots(farCells, bands, 'cull:4')).toEqual([]);
    expect(propRevealRoots(farCells, bands, '9:9')).toEqual([]);
  });
});

describe('prop cull first-reveal policy', () => {
  it('hides a fogged band and never consults the gate for it', () => {
    let consulted = 0;
    const gate = { allow: () => (consulted++, true) };
    const state = { key: 'cull:1', revealed: false, held: false };
    expect(propCullReveal(false, 500 * 500, 100, state, gate)).toBe('hidden');
    expect(consulted).toBe(0);
  });

  it('holds a cold far band, reveals it once the gate warms, then never consults again', () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    const c = cullable(box(150, 350, -50, 50), 'cull:7');
    // Camera 100 from the box, fogFar 120: inside the fog, beyond the near
    // fraction (60), so the first reveal rides the gate.
    updatePropCullable(c, 50, 0, 120, 120 * 120, gate);
    expect(requested).toEqual(['cull:7']);
    expect(c.obj.visible).toBe(false);
    expect(c.revealed).toBe(false);
    expect(c.held).toBe(true);
    updatePropCullable(c, 50, 0, 120, 120 * 120, gate);
    expect(requested).toEqual(['cull:7']);
    expect(c.obj.visible).toBe(false);
    gate.settle('cull:7');
    updatePropCullable(c, 50, 0, 120, 120 * 120, gate);
    expect(c.obj.visible).toBe(true);
    expect(c.revealed).toBe(true);
    // Fog re-entry after the latch: a plain cull flip, no consult.
    const cold = createRevealGateCore((key) => requested.push(`again:${key}`));
    updatePropCullable(c, -100, 0, 120, 120 * 120, cold);
    expect(c.obj.visible).toBe(false);
    updatePropCullable(c, 50, 0, 120, 120 * 120, cold);
    expect(c.obj.visible).toBe(true);
    expect(requested).toEqual(['cull:7']);
  });

  it('holds a band already near the camera and submits it as IMMINENT', () => {
    // The arrival case. It used to reveal on the jump frame, before any
    // compile was even submitted, which linked the whole streamed kit inside
    // live frames on a host whose boot manifest never carried it. It holds
    // like any other band now; what its nearness buys is queue position.
    const requested: { key: string; imminent: boolean }[] = [];
    const gate = createRevealGateCore((key, imminent) => requested.push({ key, imminent }));
    const near = fogFarNearEdge(120);
    const c = cullable(box(near, near + 100, -50, 50), 'cull:2');
    updatePropCullable(c, 0, 0, 120, 120 * 120, gate);
    expect(requested).toEqual([{ key: 'cull:2', imminent: true }]);
    expect(c.obj.visible).toBe(false);
    expect(c.revealed).toBe(false);
    // No clock exists to pass: however many frames go by, the band waits for
    // its own compile.
    for (let frame = 0; frame < 500; frame++) {
      updatePropCullable(c, 0, 0, 120, 120 * 120, gate);
    }
    expect(c.obj.visible).toBe(false);
    expect(c.revealed).toBe(false);
    expect(requested).toHaveLength(1);
  });

  it('reveals an imminent band as soon as its compile settles', () => {
    const requested: string[] = [];
    const gate = gateWith(requested);
    const near = fogFarNearEdge(120);
    const c = cullable(box(near, near + 100, -50, 50), 'cull:8');
    updatePropCullable(c, 0, 0, 120, 120 * 120, gate);
    expect(c.obj.visible).toBe(false);
    gate.settle('cull:8');
    updatePropCullable(c, 0, 0, 120, 120 * 120, gate);
    expect(c.obj.visible).toBe(true);
  });

  it('a band beyond the near fraction is submitted ordinarily and holds', () => {
    // One unit further out is a walking approach, not an arrival: it waits
    // for the compile however long that takes (the watchdog is its only end),
    // and it never claims the imminent priority.
    const requested: { key: string; imminent: boolean }[] = [];
    const gate = createRevealGateCore((key, imminent) => requested.push({ key, imminent }));
    const near = fogFarNearEdge(120);
    const far = cullable(box(near + 1, near + 100, -50, 50), 'cull:3');
    updatePropCullable(far, 0, 0, 120, 120 * 120, gate);
    expect(requested).toEqual([{ key: 'cull:3', imminent: false }]);
    expect(far.obj.visible).toBe(false);
    for (let frame = 0; frame < 500; frame++) {
      updatePropCullable(far, 0, 0, 120, 120 * 120, gate);
    }
    expect(far.obj.visible).toBe(false);
  });

  it('keeps holding a held band that crosses the near line while its compile is in flight', () => {
    // After a cover arrival the fog opens over seconds: a band held at the
    // fog edge (dist 100, fogFar 120) is inside the near line once fogFar
    // reaches 300 (near 150). It must stay held until the settle, or it
    // links cold anyway (the raced-pending-link rows after an arrival).
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    const c = cullable(box(150, 350, -50, 50), 'cull:9');
    updatePropCullable(c, 50, 0, 120, 120 * 120, gate);
    expect(c.held).toBe(true);
    expect(c.obj.visible).toBe(false);
    updatePropCullable(c, 50, 0, 300, 300 * 300, gate);
    expect(c.obj.visible).toBe(false);
    expect(c.revealed).toBe(false);
    gate.settle('cull:9');
    updatePropCullable(c, 50, 0, 300, 300 * 300, gate);
    expect(c.obj.visible).toBe(true);
    expect(requested).toEqual(['cull:9']);
  });

  it('reveals a band inside the reach floor on every consult, held or not', () => {
    // A held band whose compile is still in flight when the player walks up
    // to it: the colliders it carries must not stay invisible at arm's length,
    // whatever the gate does.
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    const c = cullable(box(150, 350, -50, 50), 'cull:5');
    updatePropCullable(c, 50, 0, 120, 120 * 120, gate);
    expect(c.held).toBe(true);
    expect(c.obj.visible).toBe(false);
    // Box distance 41: still held.
    updatePropCullable(c, 109, 0, 120, 120 * 120, gate);
    expect(c.obj.visible).toBe(false);
    // Box distance 40: the reach floor reveals, with no settle at all.
    updatePropCullable(c, 110, 0, 120, 120 * 120, gate);
    expect(c.obj.visible).toBe(true);
    expect(c.revealed).toBe(true);
    expect(requested).toEqual(['cull:5']);
    // The floor also covers a first consult under a tightly clamped fog,
    // where half the fog would be a few yards: band at 30 under fogFar 45.
    const clamped = cullable(box(30, 130, -50, 50), 'cull:6');
    updatePropCullable(clamped, 0, 0, 45, 45 * 45, gate);
    expect(clamped.obj.visible).toBe(true);
    expect(requested).toEqual(['cull:5']);
  });

  it('keeps the historical immediate cull without a gate', () => {
    const c = cullable(box(150, 350, -50, 50), 'cull:4');
    updatePropCullable(c, 50, 0, 120, 120 * 120, null);
    expect(c.obj.visible).toBe(true);
    expect(c.revealed).toBe(true);
    updatePropCullable(c, 50, 0, 120, 120 * 120, undefined);
    expect(c.obj.visible).toBe(true);
    updatePropCullable(c, -100, 0, 120, 120 * 120, null);
    expect(c.obj.visible).toBe(false);
  });

  it('pins the near fraction to half the fog range and the reach floor to the far-cell swap', () => {
    // A walking approach meets a band at the fog plane; a cover arrival lands
    // among bands the player can reach before any compile settles. Half the
    // fog range keeps the reachable ones ungated (prop_cull_core.ts), and the
    // absolute floor is one camera boom plus the largest footprint, the same
    // distance the far cells swap to individuals at.
    expect(PROP_CULL_REVEAL_NEAR_FRACTION).toBe(0.5);
    expect(PROP_CULL_REVEAL_REACH).toBe(40);
    expect(PROP_CULL_REVEAL_REACH).toBe(PROP_FAR_SWAP_DISTANCE);
  });

  it('answers the imminence of a consult without consulting anything', () => {
    // The frame pass reads this to decide which bands to defer and sort, so
    // it must not fire a request as a side effect.
    const requested: string[] = [];
    const gate = gateWith(requested);
    const near = fogFarNearEdge(120);
    const c = cullable(box(near, near + 100, -50, 50), 'cull:12');
    expect(propCullConsultImminent(true, 100 * 100, 400, c, gate)).toBe(true);
    expect(requested).toEqual([]);
    // Outside the fog, past the near line, inside the reach floor, already
    // held, already revealed, and with no gate: never imminent.
    expect(propCullConsultImminent(false, 100 * 100, 400, c, gate)).toBe(false);
    expect(propCullConsultImminent(true, 201 * 201, 400, c, gate)).toBe(false);
    expect(propCullConsultImminent(true, 10 * 10, 400, c, gate)).toBe(false);
    expect(propCullConsultImminent(true, 100 * 100, 400, c, null)).toBe(false);
    expect(propCullConsultImminent(true, 100 * 100, 400, { ...c, held: true }, gate)).toBe(false);
    expect(propCullConsultImminent(true, 100 * 100, 400, { ...c, revealed: true }, gate)).toBe(
      false,
    );
  });
});

describe('prop cull frame pass ordering', () => {
  /** Three bands the camera lands among at once, listed FAR to NEAR so a pass
   *  that kept list order would submit them backwards. */
  function arrivalBands() {
    return [
      cullable(box(150, 250, -50, 50), 'cull:far'),
      cullable(box(100, 140, -50, 50), 'cull:mid'),
      cullable(box(60, 90, -50, 50), 'cull:near'),
    ];
  }

  it("consults a frame's imminent bands nearest to the camera first", () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    const bands = arrivalBands();
    // fogFar 400: the near line is 200, so all three escape on this frame.
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, newPropCullPass());
    expect(requested).toEqual(['cull:near', 'cull:mid', 'cull:far']);
    for (const band of bands) expect(band.obj.visible).toBe(false);
  });

  it('leaves the ordinary bands in list order and only sorts the imminent ones', () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    // Two walking-approach bands past the near line, one arrival band inside
    // it: the two ordinary ones consult in list order, before the sort runs.
    const bands = [
      cullable(box(300, 400, -50, 50), 'cull:walk-a'),
      cullable(box(250, 290, -50, 50), 'cull:walk-b'),
      cullable(box(100, 140, -50, 50), 'cull:arrival'),
    ];
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, newPropCullPass());
    expect(requested).toEqual(['cull:walk-a', 'cull:walk-b', 'cull:arrival']);
  });

  it('reveals an imminent band through the list pass once its compile settles', () => {
    // The list pass is what production runs; every other case above that
    // reaches `visible === true` goes through the single-band entry, so a pass
    // that consulted correctly and then never applied the reveal would keep
    // them all green while the arrival stayed invisible.
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    const bands = arrivalBands();
    const pass = newPropCullPass();
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, pass);
    expect(requested).toEqual(['cull:near', 'cull:mid', 'cull:far']);
    for (const band of bands) expect(band.obj.visible).toBe(false);

    // One settle at a time: only the settled band turns visible.
    gate.settle('cull:mid');
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, pass);
    expect(bands.map((band) => band.obj.visible)).toEqual([false, true, false]);
    expect(bands[1].revealed).toBe(true);

    for (const key of ['cull:near', 'cull:far']) gate.settle(key);
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, pass);
    for (const band of bands) expect(band.obj.visible).toBe(true);
    // No second consult for a band that already revealed.
    expect(requested).toEqual(['cull:near', 'cull:mid', 'cull:far']);
  });

  it('reuses one caller-owned scratch across frames', () => {
    const gate = createRevealGateCore(() => undefined);
    const bands = arrivalBands();
    const pass = newPropCullPass();
    updatePropCullables(bands, 0, 0, 400, 400 * 400, gate, pass);
    expect(pass.order).toHaveLength(3);
    // A frame with nothing imminent leaves no stale indices behind.
    updatePropCullables(bands, 0, 0, 400, 400 * 400, null, pass);
    expect(pass.order).toHaveLength(0);
  });

  it('culls, reveals and latches exactly like the single-band entry', () => {
    const pass = newPropCullPass();
    const gate = createRevealGateCore(() => undefined);
    const bands = [
      cullable(box(1_000, 1_100, -50, 50), 'cull:fogged'),
      cullable(box(150, 350, -50, 50), 'cull:approach'),
      cullable(box(10, 30, -50, 50), 'cull:reach'),
    ];
    updatePropCullables(bands, 50, 0, 120, 120 * 120, gate, pass);
    expect(bands[0].obj.visible).toBe(false);
    expect(bands[0].held).toBe(false);
    expect(bands[1].obj.visible).toBe(false);
    expect(bands[1].held).toBe(true);
    // Inside the reach floor: revealed and latched, gate or not.
    expect(bands[2].obj.visible).toBe(true);
    expect(bands[2].revealed).toBe(true);
  });
});

function fogFarNearEdge(fogFar: number): number {
  return fogFar * PROP_CULL_REVEAL_NEAR_FRACTION;
}
