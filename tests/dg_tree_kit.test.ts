// The Deepglass tree kit (scripts/assets/deepglass/bl_dg_trees.py): ten trees,
// every one under the budget SPACEY set (2026-09-19: "keep each tree below
// 2000polys"), one shared painted atlas, and a registered authored scale so a
// placement at scale 1 stands at its built height with its installed collision.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, describe, expect, it } from 'vitest';
import overrides from '../data/asset_collision_overrides.json';
import { targetHeightFor } from '../src/render/asset_scale';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainHeight, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';

const root = path.resolve(__dirname, '..');
const meta: Record<string, { kind: string; tris: number; dims: number[] }> = JSON.parse(
  fs.readFileSync(path.join(root, 'data/dg_tree_kit.json'), 'utf8'),
);
const names = Object.keys(meta);

describe('Deepglass tree kit', () => {
  it('ships pines, big-root giants and snow-laden variants', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names.filter((n) => meta[n].kind === 'pine').length).toBeGreaterThanOrEqual(5);
    expect(names.filter((n) => meta[n].kind === 'root').length).toBeGreaterThanOrEqual(4);
    // the snow twins draw off the same atlas, so they cost no extra texture
    expect(names.filter((n) => n.includes('snow')).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every tree under 2000 triangles', () => {
    for (const n of names) expect(meta[n].tris).toBeLessThan(2000);
  });

  it('installs each GLB with its authored scale and a trunk collision', () => {
    for (const n of names) {
      const file = path.join(root, 'public/models/deepglass', `${n}.glb`);
      expect(fs.existsSync(file)).toBe(true);
      // scale 1 = as built: the loader normalizes by the largest dimension
      expect(targetHeightFor(`/models/deepglass/${n}.glb`)).toBeCloseTo(
        Math.max(...meta[n].dims),
        2,
      );
      const entry = (
        overrides as unknown as Record<
          string,
          { mode: string; boxes: { hx: number; hy: number }[] }
        >
      )[`deepglass/${n}`];
      expect(entry.mode).toBe('baked');
      // the trunk, never the crown: a box no wider than the tree is tall
      expect(entry.boxes.length).toBeGreaterThan(0);
      for (const box of entry.boxes) {
        expect(box.hx).toBeLessThan(Math.max(...meta[n].dims) / 2);
        expect(box.hy).toBeGreaterThan(0);
      }
    }
  });

  it('paints the foliage family sheets with an anchor on every cell, and takes bark from the terrain library', () => {
    // paint_foliage.py (v2, 2026-09-24): every cell records where its wood
    // enters (`anchor`) and which way it grows (`axis`), so the builders can
    // seat a bough's woody end on the branch, never out at the card's tip
    // (SPACEY: "the base of the branches should always be closest to the tree").
    const fol = path.join(root, 'scripts/assets/deepglass/tree_tex/foliage');
    const cells: Record<
      string,
      Record<string, { box: number[]; anchor: number[]; axis: string }>
    > = JSON.parse(fs.readFileSync(path.join(fol, 'cells.json'), 'utf8'));
    for (const sheet of ['dg_fol_pine', 'dg_fol_snow', 'dg_fol_bloom', 'dg_fol_under']) {
      expect(fs.existsSync(path.join(fol, `${sheet}.png`))).toBe(true);
      expect(Object.keys(cells[sheet]).length).toBeGreaterThan(4);
      for (const c of Object.values(cells[sheet])) {
        expect(['right', 'down', 'up', 'centre']).toContain(c.axis);
        const [u0, v0, u1, v1] = c.box;
        const [ua, va] = c.anchor;
        // the anchor sits on (or within a hair of) the painted box
        expect(ua).toBeGreaterThanOrEqual(u0 - 0.02);
        expect(ua).toBeLessThanOrEqual(u1 + 0.02);
        expect(va).toBeGreaterThanOrEqual(v0 - 0.02);
        expect(va).toBeLessThanOrEqual(v1 + 0.02);
        // ...and at the edge the art grows AWAY from
        if (c.axis === 'right') expect((ua - u0) / (u1 - u0)).toBeLessThan(0.2);
        if (c.axis === 'down') expect((v1 - va) / (v1 - v0)).toBeLessThan(0.2);
        if (c.axis === 'up') expect((va - v0) / (v1 - v0)).toBeLessThan(0.2);
      }
    }
    for (const f of ['Wood003_Color.jpg', 'Wood004_Color.jpg']) {
      expect(fs.existsSync(path.join(root, 'public/textures/terrain', f))).toBe(true);
    }
  });

  it('ships violet-blossom and violet-pollen variants', () => {
    expect(names.filter((n) => meta[n].kind === 'bloom').length).toBeGreaterThanOrEqual(3);
    expect(names.filter((n) => n.includes('pollen')).length).toBeGreaterThanOrEqual(2);
  });
});

// The crag pine's stone (2026-09-24 rebuild, SPACEY: "insure the collision
// lines up with this tree", then "the player is just floatign"): a dome, one
// cone-topped surface fitted under the stone whose rim stands above a
// stride, footprinted on the stone's own outline at that height.
describe('the crag pine stone', () => {
  afterEach(() => setActiveWorldContent(null));
  type Box = {
    x: number;
    y: number;
    z: number;
    hx: number;
    hy: number;
    hz: number;
    ry?: number;
    slope?: string;
    eave?: number;
  };
  const boxes = (overrides as unknown as Record<string, { boxes: Box[] }>)[
    'deepglass/tree_root_crag_pine'
  ].boxes;
  const stone = boxes.filter((b) => b.slope === 'cone');
  const cx = stone.reduce((s, b) => s + b.x, 0) / stone.length;
  const cz = stone.reduce((s, b) => s + b.z, 0) / stone.length;

  it('stops a player walking at it on its open side AT the stone', () => {
    const pz = 60;
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [
        {
          path: '/models/deepglass/tree_root_crag_pine.glb',
          x: 0,
          z: pz,
          rotY: 0,
          scale: 1,
          collideRadius: 1.2,
        },
      ],
    } as never);
    // away from the trunk; the stone's rim reaches 1.2-2.1 yd from its centre
    const away = Math.atan2(cz, cx);
    for (const da of [-0.3, 0, 0.3]) {
      const fx = cx + Math.cos(away + da) * 7;
      const fz = pz + cz + Math.sin(away + da) * 7;
      const res = resolveMovement(4242, fx, fz, cx, pz + cz, 0.5, false, undefined, {
        y: groundHeight(fx, fz, 4242),
        lift: 0,
      });
      const stop = Math.hypot(res.x - cx, res.z - pz - cz);
      expect(stop).toBeGreaterThan(1.4); // not into the stone
      expect(stop).toBeLessThan(3.2); // not an invisible wall short of it
    }
  });

  it('can be jumped onto but not walked up: one dome, its rim above a stride', () => {
    expect(stone.length).toBe(3);
    // one surface: every box on the same centre with the same cone
    for (const b of stone) {
      expect(b.x).toBeCloseTo(cx, 3);
      expect(b.z).toBeCloseTo(cz, 3);
      expect(b.eave).toBeGreaterThan(MAX_STEP_HEIGHT);
    }
  });
});

// The rooty trees' base (SPACEY, 2026-09-24): "they are blocking the player
// even tho the player should be able to walk on them", "make it so you can
// walk up the tree root collision without needing to jump", "the player is
// just floatign cause its so far off the real collision make sure its spot
// on". Each root is ONE box with a sloped top fitted UNDER the bark
// (bl_dg_trees.py base_collision): walked onto from any side, never stood
// above the bark it shows.
describe('root giant buttress roots', () => {
  afterEach(() => setActiveWorldContent(null));
  const SEED = 42;
  type Box = {
    x: number;
    y: number;
    z: number;
    hx: number;
    hy: number;
    hz: number;
    ry?: number;
    slope?: string;
  };

  function flatSpot(): { x: number; z: number } {
    for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3) {
        if (terrainHeight(x, z, SEED) < WATER_LEVEL + 2) continue;
        let ok = true;
        for (let dx = -12; dx <= 12 && ok; dx += 2)
          for (let dz = -12; dz <= 12 && ok; dz += 2)
            if (
              terrainSteepnessAt(x + dx, z + dz, SEED) > 0.12 ||
              isBlocked(SEED, x + dx, z + dz, 1)
            )
              ok = false;
        if (ok) return { x, z };
      }
    throw new Error('no flat spot');
  }

  // the model's bark and stone placed at S: ground-to-head points, the
  // outline where it meets the ground, and the height it shows over a point
  async function barkOf(name: string, S: { x: number; z: number }) {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path.join(root, 'public/models/deepglass', `${name}.glb`));
    const pts: number[][] = [];
    const tris: number[][] = [];
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const M = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (!/^(Bark|Stone)/.test(prim.getMaterial()?.getName() ?? '')) continue;
        const a = prim.getAttribute('POSITION');
        const e: number[] = [];
        const world: number[][] = [];
        for (let i = 0; i < (a?.getCount() ?? 0); i++) {
          a?.getElement(i, e);
          world.push([
            S.x + M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12],
            M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13],
            S.z + M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14],
          ]);
        }
        for (const [x, y, z] of world) if (y >= 0 && y <= 1.8) pts.push([x, z]);
        const idx = prim.getIndices()?.getArray() ?? [];
        for (let t = 0; t < idx.length; t += 3) {
          const tri = [world[idx[t]], world[idx[t + 1]], world[idx[t + 2]]];
          if (Math.min(...tri.map((q) => q[1])) < 3.5) tris.push(tri.flat());
          // exactly where the surface meets the ground: the widest a stone
          // emerging from the soil gets lies BETWEEN its vertex rings
          for (const [p, q] of [
            [tri[0], tri[1]],
            [tri[1], tri[2]],
            [tri[2], tri[0]],
          ]) {
            if ((p[1] - 0.05) * (q[1] - 0.05) >= 0) continue;
            const f = (0.05 - p[1]) / (q[1] - p[1]);
            pts.push([p[0] + (q[0] - p[0]) * f, p[2] + (q[2] - p[2]) * f]);
          }
        }
      }
    }
    const heightAt = (x: number, z: number): number => {
      let best = 0;
      for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of tris) {
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const y = l1 * ay + l2 * by + (1 - l1 - l2) * cy;
        if (y < 3.5) best = Math.max(best, y);
      }
      return best;
    };
    return { pts, heightAt };
  }

  function place(name: string, S: { x: number; z: number }) {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [
        {
          path: `/models/deepglass/${name}.glb`,
          x: S.x,
          z: S.z,
          rotY: 0,
          scale: 1,
          collideRadius: 1.5,
        },
      ],
    } as never);
  }

  function walker(from: [number, number], dir: [number, number]) {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    p.pos.x = from[0];
    p.pos.z = from[1];
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED) + 0.02;
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.facing = Math.atan2(dir[0], dir[1]);
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');
    Object.assign(meta.moveInput, {
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
    });
    Object.assign(meta.moveInput, { strafeRight: false, jump: false, dive: false, surface: false });
    meta.moveInput.forward = true;
    return { sim, p };
  }

  const rootYaws = (name: string): number[] => {
    const boxes = (overrides as unknown as Record<string, { boxes: Box[] }>)[`deepglass/${name}`]
      .boxes;
    return [
      ...new Set(
        boxes.filter((b) => b.slope === 'ridge').map((b) => Math.round((b.ry ?? 0) * 100) / 100),
      ),
    ];
  };

  it('walks a player up every root of a giant, feet never above the bark', async () => {
    const name = 'tree_root_giant_a';
    const yaws = rootYaws(name);
    expect(yaws.length).toBeGreaterThanOrEqual(4);
    const S = flatSpot();
    const { heightAt } = await barkOf(name, S);
    place(name, S);
    for (const a of yaws) {
      const ux = Math.cos(a);
      const uz = -Math.sin(a);
      const { sim, p } = walker([S.x + ux * 10, S.z + uz * 10], [-ux, -uz]);
      let rise = 0;
      for (let i = 0; i < 70; i++) {
        sim.tick();
        const feet = p.pos.y - terrainHeight(p.pos.x, p.pos.z, SEED);
        rise = Math.max(rise, feet);
        // never standing on air over the root (v2's flat terraces floated
        // a body up to 0.6 yd over the slope past each edge)
        if (p.onGround) expect(feet - heightAt(p.pos.x, p.pos.z)).toBeLessThan(0.3);
      }
      // it walked up onto the root (v2: stopped at the tip, rise 0)
      expect(rise).toBeGreaterThan(0.4);
    }
  });

  it('crosses a root from the side without a jump', () => {
    const name = 'tree_root_giant_b';
    const S = flatSpot();
    place(name, S);
    for (const a of rootYaws(name)) {
      const u = [Math.cos(a), -Math.sin(a)];
      const v = [-u[1], u[0]];
      const { sim, p } = walker(
        [S.x + u[0] * 4.5 + v[0] * 3, S.z + u[1] * 4.5 + v[1] * 3],
        [-v[0], -v[1]],
      );
      for (let i = 0; i < 40; i++) sim.tick();
      // over to the far side of the root, walking the whole way
      expect((p.pos.x - S.x) * v[0] + (p.pos.z - S.z) * v[1]).toBeLessThan(-2);
    }
  });

  // SPACEY, 2026-09-24: "player is getting blocked futher out than the roots
  // visually represent". Walking in from every side, a player the collision
  // stops must already be touching bark or stone it can see.
  it('never stops a player short of the bark or stone it can see', async () => {
    const S = flatSpot();
    for (const name of ['tree_root_giant_a', 'tree_root_crag_pine']) {
      const { pts } = await barkOf(name, S);
      const cx = pts.reduce((q, p) => q + p[0], 0) / pts.length;
      const cz = pts.reduce((q, p) => q + p[1], 0) / pts.length;
      const reachAt = (th: number, win = 0.14): number => {
        let best = 0;
        for (const [x, z] of pts) {
          const d = Math.hypot(x - cx, z - cz);
          const da = Math.abs(
            ((Math.atan2(z - cz, x - cx) - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
          );
          if (da < win) best = Math.max(best, d * Math.cos(da));
        }
        return best > 0 || win > 0.5 ? best : reachAt(th, win * 2);
      };
      place(name, S);
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * Math.PI * 2;
        const { sim, p } = walker(
          [cx + Math.cos(th) * 12, cz + Math.sin(th) * 12],
          [-Math.cos(th), -Math.sin(th)],
        );
        let still = 0;
        for (let i = 0; i < 100 && still < 5; i++) {
          const [x0, z0] = [p.pos.x, p.pos.z];
          sim.tick();
          still = Math.hypot(p.pos.x - x0, p.pos.z - z0) < 0.01 ? still + 1 : 0;
        }
        if (still < 5 || p.pos.y - terrainHeight(p.pos.x, p.pos.z, SEED) > 0.3) continue;
        const d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
        const seen = reachAt(Math.atan2(p.pos.z - cz, p.pos.x - cx));
        // stopped with the body on (or into) something visible
        expect(d - PLAYER_BODY_RADIUS - seen, `${name} ${k}`).toBeLessThan(0.25);
      }
    }
  });
});
