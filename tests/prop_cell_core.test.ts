import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyPropCellMode,
  PROP_CELL_NEAR_FLIP_IMMINENT_FOG_FRACTION,
  PROP_FAR_CELL_SIZE,
  PROP_FAR_SWAP_DISTANCE,
  type PropCellRuntime,
  propCellBoxDistance,
  propCellKey,
  propCellMode,
  propCellNearBaseKey,
  propCellNearKey,
  updatePropCell,
} from '../src/render/prop_cell_core';
import { PROP_CULL_REVEAL_NEAR_FRACTION } from '../src/render/prop_cull_core';

describe('propCellKey', () => {
  it('quantizes to the cell grid including negative coordinates', () => {
    expect(propCellKey(0, 0)).toBe('0:0');
    expect(propCellKey(119, 119)).toBe('0:0');
    expect(propCellKey(120, 0)).toBe('1:0');
    expect(propCellKey(-1, -1)).toBe('-1:-1');
    expect(propCellKey(-120, -121)).toBe('-1:-2');
    expect(propCellKey(50, 50, 100)).toBe('0:0');
  });

  it('pins the cell size and swap distance the props dual representation uses', () => {
    expect(PROP_FAR_CELL_SIZE).toBe(120);
    // Must stay above the ghost reach or the chase camera can sit inside an
    // opaque building: the max camera boom is 22 (src/game/input.ts camDist
    // clamp; the director's vista/drift caps stay below it) plus the largest
    // structure footprint radius (~8). Raising the zoom clamp past this
    // margin requires raising the swap distance with it.
    expect(PROP_FAR_SWAP_DISTANCE).toBe(40);
    expect(PROP_FAR_SWAP_DISTANCE).toBeGreaterThanOrEqual(22 + 8 + 8);
  });
});

describe('propCellBoxDistance', () => {
  const bounds = { minX: 100, maxX: 220, minZ: -40, maxZ: 80 };

  it('is zero inside the box and axis distance outside', () => {
    expect(propCellBoxDistance(bounds, 150, 0)).toBe(0);
    expect(propCellBoxDistance(bounds, 90, 0)).toBe(10);
    expect(propCellBoxDistance(bounds, 150, 100)).toBe(20);
  });

  it('is the diagonal distance from a corner', () => {
    expect(propCellBoxDistance(bounds, 97, -44)).toBeCloseTo(5, 5);
  });
});

describe('propCellMode', () => {
  const bounds = { minX: 100, maxX: 220, minZ: -40, maxZ: 80 };

  it('keeps a near cell in individual mode with the merged bake color-hidden', () => {
    const near = propCellMode(bounds, 120, 0, 470);
    expect(near.farMode).toBe(false);
    expect(near.showMerged).toBe(false);
  });

  it('flips to merged mode at the swap distance', () => {
    const nearEdge = propCellMode(bounds, 100 - 39, 0, 470);
    expect(nearEdge.farMode).toBe(false);
    const atEdge = propCellMode(bounds, 100 - 40, 0, 470);
    expect(atEdge.farMode).toBe(true);
    expect(atEdge.showMerged).toBe(true);
  });

  it('hides the merged bake past the fog distance while staying in far mode', () => {
    const fogged = propCellMode(bounds, 100 - 500, 0, 470);
    expect(fogged.farMode).toBe(true);
    expect(fogged.showMerged).toBe(false);
  });

  it('honors a custom swap distance', () => {
    expect(propCellMode(bounds, 100 - 30, 0, 470, 30).farMode).toBe(true);
    expect(propCellMode(bounds, 100 - 29, 0, 470, 30).farMode).toBe(false);
  });
});

describe('applyPropCellMode', () => {
  function makeCell(): PropCellRuntime {
    return {
      farMode: false,
      visible: true,
      meshes: [
        { visible: true, count: 0 },
        { visible: true, count: 0 },
      ],
      hideables: [
        {
          suppressed: false,
          hidden: false,
          bakeMeshes: [{ mesh: { visible: true } }, { mesh: { visible: true } }],
          mats: [{ mat: { colorWrite: true, depthWrite: true }, depthWrite: true }],
        },
      ],
    };
  }

  it('transitions to far mode: bake fully on, individuals suppressed', () => {
    const cell = makeCell();
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    expect(cell.farMode).toBe(true);
    expect(cell.meshes.every((m) => m.visible && m.count === 1)).toBe(true);
    const h = cell.hideables[0];
    expect(h.suppressed).toBe(true);
    expect(h.bakeMeshes.every((b) => !b.mesh.visible)).toBe(true);
  });

  it('transitions back to near mode: bake shadow-only, individuals restored', () => {
    const cell = makeCell();
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    applyPropCellMode(cell, { farMode: false, showMerged: false });
    expect(cell.farMode).toBe(false);
    // Near mode keeps the bake VISIBLE (it is the cell's shadow caster) but
    // count-gated out of the color pass.
    expect(cell.meshes.every((m) => m.visible && m.count === 0)).toBe(true);
    const h = cell.hideables[0];
    expect(h.suppressed).toBe(false);
    expect(h.bakeMeshes.every((b) => b.mesh.visible)).toBe(true);
  });

  it('hides the bake past the fog while staying in far mode', () => {
    const cell = makeCell();
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    applyPropCellMode(cell, { farMode: true, showMerged: false });
    expect(cell.farMode).toBe(true);
    expect(cell.meshes.every((m) => !m.visible)).toBe(true);
    // and back inside the fog without a mode flip
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    expect(cell.meshes.every((m) => m.visible && m.count === 1)).toBe(true);
  });

  it('clears a stale ghost fade when entering far mode (teleport case)', () => {
    const cell = makeCell();
    const h = cell.hideables[0];
    // ghost fade active: color/depth writes off
    h.hidden = true;
    h.mats[0].mat.colorWrite = false;
    h.mats[0].mat.depthWrite = false;
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    expect(h.hidden).toBe(false);
    expect(h.mats[0].mat.colorWrite).toBe(true);
    expect(h.mats[0].mat.depthWrite).toBe(true);
  });

  it('is edge-triggered: reapplying the same mode touches nothing', () => {
    const cell = makeCell();
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    // poke state that a redundant reapply must NOT overwrite
    cell.meshes[0].count = 1;
    cell.hideables[0].hidden = true;
    applyPropCellMode(cell, { farMode: true, showMerged: true });
    expect(cell.hideables[0].hidden).toBe(true);
  });
});

describe('updatePropCell first-far reveal gating (hitch-hunt P3a)', () => {
  const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

  function makeGatedCell(key?: string): PropCellRuntime & { bounds: typeof bounds } {
    return {
      key,
      bounds,
      farMode: false,
      visible: true,
      farReady: false,
      meshes: [{ visible: true, count: 0 }],
      hideables: [
        {
          suppressed: false,
          hidden: false,
          bakeMeshes: [{ mesh: { visible: true } }],
          mats: [{ mat: { colorWrite: true, depthWrite: true }, depthWrite: true }],
        },
      ],
    };
  }

  const farCam = { x: 100, z: 5 }; // box distance 90 >= swap distance 40

  it('holds the first far flip in near mode while the gate is cold', () => {
    const cell = makeGatedCell('0:0');
    const consulted: string[] = [];
    const gate = {
      allow: (key: string) => {
        consulted.push(key);
        return false;
      },
    };
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(consulted).toEqual(['0:0']);
    expect(cell.farMode).toBe(false);
    expect(cell.farReady).toBe(false);
    expect(cell.meshes[0].count).toBe(0);
    expect(cell.hideables[0].suppressed).toBe(false);
  });

  it('never consults the gate for a far cell beyond the fog (nothing draws)', () => {
    // A cold world entry flips essentially every cell to far mode on frame
    // one; gating there would fire a world-wide compile burst for bakes the
    // fog hides anyway. The consult belongs to the DRAWN swap only.
    const cell = makeGatedCell('0:0');
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    updatePropCell(cell, farCam.x, farCam.z, 50, undefined, gate);
    expect(consulted).toBe(0);
    expect(cell.farMode).toBe(true);
    expect(cell.farReady).toBe(false);
    // Bake hidden past the fog, exactly the historical beyond-fog far state.
    expect(cell.meshes[0].visible).toBe(false);
    // Walking closer brings the bake inside the fog: NOW the gate holds it.
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(consulted).toBe(1);
    expect(cell.farMode).toBe(false);
  });

  it('composes with the real reveal gate core end to end', async () => {
    const { createRevealGateCore } = await import('../src/render/reveal_gate_core');
    const cell = makeGatedCell('0:0');
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(requested).toEqual(['0:0']);
    expect(cell.farMode).toBe(false);
    gate.settle('0:0');
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farMode).toBe(true);
    expect(cell.farReady).toBe(true);
  });

  it('flips far once the gate allows, and never consults it again', () => {
    const cell = makeGatedCell('0:0');
    let warm = false;
    const consulted: string[] = [];
    const gate = {
      allow: (key: string) => {
        consulted.push(key);
        return warm;
      },
    };
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    warm = true;
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farMode).toBe(true);
    expect(cell.farReady).toBe(true);
    expect(cell.meshes[0].count).toBe(1);
    // Back near (the near key consults once, warm here, and latches), then
    // far again: the latches skip the gate on every later flip.
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    expect(cell.nearReady).toBe(true);
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farMode).toBe(true);
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    expect(consulted).toEqual(['0:0', '0:0', '0:0:near']);
  });

  it('never consults the gate while the cell is near', () => {
    const cell = makeGatedCell('0:0');
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(consulted).toBe(0);
    expect(cell.farMode).toBe(false);
  });

  it('without a gate (or without a key) the flip stays immediate', () => {
    const ungated = makeGatedCell('0:0');
    updatePropCell(ungated, farCam.x, farCam.z, 200);
    expect(ungated.farMode).toBe(true);
    expect(ungated.farReady).toBe(true);
    const keyless = makeGatedCell(undefined);
    updatePropCell(keyless, farCam.x, farCam.z, 200, undefined, {
      allow: () => false,
    });
    expect(keyless.farMode).toBe(true);
  });
});

describe('updatePropCell first-near reveal gating (the symmetric hold)', () => {
  // Riding in from a shown bake, the members' own materials (a building's
  // unique kit) are programs the bake never linked: the Eastbrook Grand
  // Armoury's five linked cold at first draw on the iGPU ride even with the
  // far flip and the hideables gated. The near flip holds on the bake, a
  // pixel-identical stand-in already on screen, until the near key warms.
  const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
  const farCam = { x: 100, z: 5 }; // box distance 90 >= swap distance 40

  function makeCell(): PropCellRuntime & { bounds: typeof bounds } {
    return {
      key: '2:3',
      bounds,
      farMode: false,
      visible: true,
      farReady: false,
      meshes: [{ visible: true, count: 0 }],
      hideables: [
        {
          suppressed: false,
          hidden: false,
          bakeMeshes: [{ mesh: { visible: true } }],
          mats: [{ mat: { colorWrite: true, depthWrite: true }, depthWrite: true }],
        },
      ],
    };
  }

  /** A cell whose bake was proven: the far flip consulted warm. */
  function provenFarCell(gate: { allow(key: string, imminent?: boolean): boolean }) {
    const cell = makeCell();
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farMode).toBe(true);
    expect(cell.farReady).toBe(true);
    return cell;
  }

  it('holds the first near flip on the proven bake while the near key is cold', () => {
    const consulted: { key: string; imminent: boolean | undefined }[] = [];
    let nearWarm = false;
    const gate = {
      allow: (key: string, imminent?: boolean) => {
        consulted.push({ key, imminent });
        return key.endsWith(':near') ? nearWarm : true;
      },
    };
    const cell = provenFarCell(gate);
    // Camera walks into the cell: box distance 0, fogFar 200 (imminent, the
    // camera is among the members).
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    // (The far consult carries no imminence: only the near flip mirrors the
    // bands there.)
    expect(consulted).toEqual([
      { key: '2:3', imminent: undefined },
      { key: '2:3:near', imminent: true },
    ]);
    // Still on the bake: the members stay suppressed, the bake keeps drawing.
    expect(cell.farMode).toBe(true);
    expect(cell.nearReady).toBeUndefined();
    expect(cell.meshes[0].count).toBe(1);
    expect(cell.meshes[0].visible).toBe(true);
    expect(cell.hideables[0].suppressed).toBe(true);
    expect(cell.hideables[0].bakeMeshes[0].mesh.visible).toBe(false);
    // Frames go by, the hold re-consults, nothing flips on a clock.
    for (let n = 0; n < 200; n++) updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(true);
    expect(consulted.filter((c) => c.key === '2:3:near')).toHaveLength(201);
    // The near key warms: the members draw, the latch skips the gate for good.
    nearWarm = true;
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    expect(cell.nearReady).toBe(true);
    expect(cell.meshes[0].count).toBe(0);
    expect(cell.hideables[0].suppressed).toBe(false);
    expect(cell.hideables[0].bakeMeshes[0].mesh.visible).toBe(true);
    const asked = consulted.length;
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    expect(consulted.length).toBe(asked);
  });

  it('composes with the real reveal gate core end to end', async () => {
    const { createRevealGateCore } = await import('../src/render/reveal_gate_core');
    const requested: { key: string; imminent: boolean }[] = [];
    const gate = createRevealGateCore((key, imminent) => requested.push({ key, imminent }));
    const cell = makeCell();
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    gate.settle('2:3');
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farReady).toBe(true);
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(requested).toEqual([
      { key: '2:3', imminent: false },
      { key: '2:3:near', imminent: true },
    ]);
    expect(cell.farMode).toBe(true);
    gate.settle('2:3:near');
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(cell.farMode).toBe(false);
    expect(cell.nearReady).toBe(true);
  });

  it("is imminent inside half the fog only, the bands' near line", () => {
    const consulted: { key: string; imminent: boolean | undefined }[] = [];
    const gate = {
      allow: (key: string, imminent?: boolean) => {
        consulted.push({ key, imminent });
        return !key.endsWith(':near');
      },
    };
    // Box distance 30 (near mode under the 40 swap): fogFar 59 puts the near
    // line at 29.5, so this consult is a walking approach.
    const cell = provenFarCell(gate);
    updatePropCell(cell, 40, 5, 59, undefined, gate);
    expect(consulted[1]).toEqual({ key: '2:3:near', imminent: false });
    expect(PROP_CELL_NEAR_FLIP_IMMINENT_FOG_FRACTION).toBe(PROP_CULL_REVEAL_NEAR_FRACTION);
  });

  it('never holds a cell that starts near: no bake was ever proven to stand in', () => {
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    const cell = makeCell();
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(consulted).toBe(0);
    expect(cell.farMode).toBe(false);
    expect(cell.nearReady).toBe(true);
    // Later far (held cold here) and back near: still never a near consult,
    // the members' programs were linked when the cell first drew near.
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(consulted).toBe(1);
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(consulted).toBe(1);
    expect(cell.farMode).toBe(false);
  });

  it('never holds a near flip whose far flip was never proven (a cold far hold, then the walk-up)', () => {
    // The far key held (bake never drawn) and the player walked into the
    // cell: nothing is on screen to stand in, so the members draw at once,
    // the historical behaviour, and the hideable arm covers their first sight.
    const consulted: string[] = [];
    const gate = {
      allow: (key: string) => {
        consulted.push(key);
        return false;
      },
    };
    const cell = makeCell();
    updatePropCell(cell, farCam.x, farCam.z, 200, undefined, gate);
    expect(cell.farReady).toBe(false);
    updatePropCell(cell, 5, 5, 200, undefined, gate);
    expect(consulted).toEqual(['2:3']);
    expect(cell.farMode).toBe(false);
    expect(cell.nearReady).toBe(true);
  });

  it('without a gate (or without a key) the near flip stays immediate', () => {
    const warm = { allow: () => true };
    const ungated = provenFarCell(warm);
    updatePropCell(ungated, 5, 5, 200);
    expect(ungated.farMode).toBe(false);
    expect(ungated.nearReady).toBe(true);
    const keyless = makeCell();
    keyless.key = undefined;
    updatePropCell(keyless, farCam.x, farCam.z, 200, undefined, warm);
    updatePropCell(keyless, 5, 5, 200, undefined, { allow: () => false });
    expect(keyless.farMode).toBe(false);
  });

  it('mints the near key from the cell key and reads it back, and nothing else', () => {
    expect(propCellNearKey('2:3')).toBe('2:3:near');
    expect(propCellNearBaseKey('2:3:near')).toBe('2:3');
    expect(propCellNearBaseKey('-1:-2:near')).toBe('-1:-2');
    expect(propCellNearBaseKey('2:3')).toBeNull();
    expect(propCellNearBaseKey('cull:4')).toBeNull();
    expect(propCellNearBaseKey('hideable:4')).toBeNull();
  });
});

// The bake-eligibility wiring in props.ts is not reachable as a pure unit (it
// lives inside buildProps, which needs the full GLB cache), so the contract is
// pinned as a source scan, the tests/foliage_lod.test.ts precedent: every
// renderer-animated mesh must be excluded from the far-cell bake, or its pose
// bakes frozen while the live copy hides in far mode (the windmill-sail
// regression from the v0.33.0 base merge, which added spinning windmills to a
// world whose bake predates them).
describe('props.ts bake-eligibility wiring (source pins)', () => {
  const propsSrc = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');

  it('filters the hideable bake scan on the keep-live set', () => {
    expect(propsSrc).toMatch(/!keepLiveMeshes\.has\(mesh\) && srcMat\.transparent !== true/);
  });

  it('keeps the windmill sail out of the bake at its reparent site', () => {
    const windmillBlock = propsSrc.slice(
      propsSrc.indexOf("d.key === 'hexWindmill'"),
      propsSrc.indexOf('windmillFans.push(pivot)'),
    );
    expect(windmillBlock).toContain('keepLiveMeshes.add(fanMesh)');
  });

  it('keeps campfire flames out of the bake', () => {
    expect(propsSrc).toMatch(/keepLiveMeshes\.add\(flame\)/);
  });
});
