import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MIREFEN_TAVERN_ASSET,
  sourceFingerprint,
} from '../scripts/assets/mirefen_tavern/build.mjs';
import {
  MIREFEN_TAVERN_LAYOUT_FILE,
  mirefenTavernLayout,
} from '../scripts/assets/mirefen_tavern/layout';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  TAVERN_CRITICAL_PARTS,
  TAVERN_FRONT_SPLIT,
  TAVERN_OPTIONAL_PARTS,
  TAVERN_SHELL_PARTS,
  TAVERN_TRIM_PARTS,
} from '../src/render/mirefen_tavern_core';
import { TAVERN_HALL_AIR_TOP } from '../src/render/mirefen_tavern_interior_core';
import {
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_HOOD,
  TAVERN_PROPS,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import { tavernPropBaseY, tavernPropCollider } from '../src/sim/mirefen_tavern';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The shipped Mirefen tavern GLB (public/models/props/mirefen_tavern.glb), built in Blender from
// the sim's own layout (scripts/assets/mirefen_tavern/layout.json, exported from
// src/sim/content/mirefen_tavern.ts with the terrain under it) and shipped by build.mjs. Pins the
// bytes, the source fingerprint, the layout's freshness against the sim and the terrain, the
// named tier and shell parts the runtime keeps, sheds and cuts away, the five texture-free
// materials, the triangle budget, and the model's stamped numbers against the sim. Re-pin the
// sha256, size and triangle literals only with a re-export (docs/design/mirefen-tavern.md).

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, MIREFEN_TAVERN_ASSET.target);
const SHIPPED_SHA256 = '15526efc703938728afbf563eb434fdac76627c862600cf7b433ae18dd56af78';
const SHIPPED_BYTES = 1589444;
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  TavernFrame: 10976,
  TavernFurnishings: 8264,
  TavernLights: 4680,
  TavernGrounds: 11438,
  TavernDog: 374,
  HallWallFront: 1272,
  HallWallFrontLeft: 4565,
  HallWallFrontRight: 4547,
  HallWallBack: 2612,
  HallWallLeft: 4105,
  HallWallRight: 5795,
  HallRoof: 12864,
  WingWallEast: 2064,
  WingWallBack: 2036,
  WingWallWest: 976,
  WingRoof: 1812,
  TowerWall: 4370,
  TowerRoof: 2000,
  HallPorch: 2228,
  BarPillar: 784,
  TavernTrim: 8804,
  TavernClutter: 12350,
};
/** The player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts). */
const PLAYER_H = 2.6;

let doc: Document;

function node(name: string): GltfNode {
  const found = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!found) throw new Error(`no node ${name}`);
  return found;
}

function trianglesUnder(n: GltfNode): number {
  let total = 0;
  const walk = (m: GltfNode): void => {
    for (const prim of m.getMesh()?.listPrimitives() ?? []) {
      total += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    for (const child of m.listChildren()) walk(child);
  };
  walk(n);
  return total;
}

interface TavernExtras {
  tiers: Record<string, string[]>;
  shell: string[];
  hall: { eave: number; ridge: number; truss: number };
  door: number[];
  nookRadius: number;
}

function extras(): TavernExtras {
  return (node('MirefenTavern_ROOT').getExtras() as { mirefenTavern: TavernExtras }).mirefenTavern;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('mirefen tavern GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/mirefen_tavern.glb']).toMatch(
      /^\/media\/models\/props\/mirefen_tavern\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Mirefen tavern (`public/models/props/mirefen_tavern.glb`');
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('was built from the live layout: the sim content and the terrain under it', () => {
    const committed = JSON.parse(readFileSync(path.join(ROOT, MIREFEN_TAVERN_LAYOUT_FILE), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(mirefenTavernLayout())));
  });

  it('keeps every named part the runtime keeps, sheds or cuts away, under one root', () => {
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['MirefenTavern_ROOT']);
    for (const name of MIREFEN_TAVERN_ASSET.requiredNodes) expect(node(name)).toBeTruthy();
    for (const part of [...TAVERN_CRITICAL_PARTS, ...TAVERN_TRIM_PARTS, ...TAVERN_OPTIONAL_PARTS]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('MirefenTavern_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    expect(extras().tiers).toEqual({
      low: [...TAVERN_CRITICAL_PARTS],
      medium: [...TAVERN_TRIM_PARTS],
      high: [...TAVERN_OPTIONAL_PARTS],
    });
    expect(extras().shell).toEqual([...TAVERN_SHELL_PARTS]);
  });

  it('shares five texture-free, vertex-coloured materials, and nothing animates', () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(MIREFEN_TAVERN_ASSET.materials);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    expect(doc.getRoot().listAnimations()).toHaveLength(0);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
      }
    }
  });

  it('holds each part to its triangle budget, the low tier inside it', () => {
    let total = 0;
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
      total += count;
    }
    expect(trianglesUnder(node('MirefenTavern_ROOT'))).toBe(total);
    // a whole inn with its booths, stage, nook, kitchen and hammerbeam roof, and since the
    // exterior pass its grounds: under 112k in all, the low tier under 90k, the shipped file
    // under 1600 KiB. Raised from 72.5k, 58k and 1100 KiB for the exterior the road sees: the
    // jettied upper storey with its bressumer, joists and carved brackets (the front's parts),
    // leaded diamond panes on every window, four dormers, a roof of irregular mossy shingles
    // with deep eaves (HallRoof, about 6k over the old slates), the weathering decals, and the
    // grounds (TavernGrounds, about 11k: the forecourt's bed, the terrace's tables, benches,
    // posts and lantern strings, the open stable, the trough, the hay, the cart and the
    // woodpile), all of it outside, merged per material (the draw calls do not grow: one mesh
    // per material and one per shell part, as before). The cobbles (trim), straw, sacks and
    // moss cushions (clutter) are shed below medium and high.
    expect(total).toBeLessThan(112000);
    const low = TAVERN_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(90000);
    expect(readFileSync(GLB).length).toBeLessThan(1600 * 1024);
  });

  it("stamps the sim's numbers, all generous next to the player", () => {
    const e = extras();
    expect(e.hall).toEqual({
      eave: TAVERN_HALL.eave,
      ridge: TAVERN_HALL.ridge,
      truss: TAVERN_HALL.truss,
    });
    expect(e.door).toEqual([TAVERN_DOOR.width, TAVERN_DOOR.height]);
    expect(e.nookRadius).toBe(TAVERN_TOWER.rIn);
    expect(e.door[1]).toBeGreaterThan(1.7 * PLAYER_H);
    // open to the roof: nothing crosses the room under the hammer beams, near four bodies up
    expect(e.hall.truss).toBeGreaterThan(3.5 * PLAYER_H);
  });

  it('keeps the common room clear of timber between the tables and the top of the air', () => {
    // no beam, brace, joist or hung thing crosses the room where the camera flies: over the
    // floor's furniture (the settles' backs, the candles) and under the camera's air top
    // (render/mirefen_tavern_interior_core.ts), inside the hall clear of its walls, only the bar
    // (its pillar, which cuts away, the kegs and the racks behind it), the wall fire and the
    // trophies an arm's length off the walls stand
    const lo = 2.9;
    const hi = TAVERN_HALL_AIR_TOP;
    const offenders: string[] = [];
    const v = [0, 0, 0];
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      const m = n.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!pos || !idx) continue;
        const pt = (k: number): [number, number, number] => {
          pos.getElement(k, v);
          return [
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
          ];
        };
        for (let t = 0; t < idx.getCount(); t += 3) {
          const a = pt(idx.getScalar(t));
          const b = pt(idx.getScalar(t + 1));
          const c = pt(idx.getScalar(t + 2));
          const x = (a[0] + b[0] + c[0]) / 3;
          const y = (a[1] + b[1] + c[1]) / 3;
          const z = (a[2] + b[2] + c[2]) / 3;
          if (y <= lo || y >= hi) continue;
          if (Math.abs(x) > TAVERN_HALL.x1 - TAVERN_HALL.wall - 1.2) continue;
          if (z < TAVERN_HALL.z0 + TAVERN_HALL.wall + 1.2) continue;
          if (z > TAVERN_HALL.z1 - TAVERN_HALL.wall - 1.2) continue;
          if (x > 2.0 && z < -4.0) continue; // the bar
          if (x > 13.2 && Math.abs(z - 2.5) < 2.6) continue; // the wall fire and its jawbone
          offenders.push(`${n.getName()} at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
        }
      }
    }
    expect(offenders.slice(0, 12)).toEqual([]);
  });

  it("draws each piece of the front where the camera's cutaway looks for it", () => {
    // the front wall's three parts meet at TAVERN_FRONT_SPLIT either side of the door
    // (mirefen_tavern_core.ts BOX_VOLUMES): no solid of one reaches into another's span, so the
    // piece a sight line crosses is the piece that ghosts
    const v = [0, 0, 0];
    const xs = (name: string): number[] => {
      const out: number[] = [];
      const n = node(name);
      const m = n.getWorldMatrix();
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let k = 0; k < pos.getCount(); k++) {
          pos.getElement(k, v);
          out.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]);
        }
      }
      return out;
    };
    const slack = 0.2;
    for (const x of xs('HallWallFront')) {
      expect(Math.abs(x), 'HallWallFront').toBeLessThanOrEqual(TAVERN_FRONT_SPLIT + slack);
    }
    for (const x of xs('HallWallFrontLeft')) {
      expect(x, 'HallWallFrontLeft').toBeLessThanOrEqual(-TAVERN_DOOR.width / 2 + slack);
    }
    for (const x of xs('HallWallFrontRight')) {
      expect(x, 'HallWallFrontRight').toBeGreaterThanOrEqual(TAVERN_DOOR.width / 2 - slack);
    }
    // ...and the side parts' walls start at the split, their door leaves inside it
    const left = xs('HallWallFrontLeft');
    expect(Math.max(...left)).toBeGreaterThan(-TAVERN_FRONT_SPLIT - 0.5);
  });

  it('stands every piece outside on the terrain, colliding there', () => {
    // a piece outside on the terrain (the steps' and the terrace's flower tubs, and everything
    // on the grounds but the dog on the porch) carries the ground's height under its middle
    // (baseY): the model seats it there and the sim's collider tops it there
    const outside = TAVERN_PROPS.filter((p) => p.baseY !== undefined);
    expect(outside.filter((p) => p.kind === 'planter')).toHaveLength(4);
    expect(outside.length).toBeGreaterThan(20);
    const layout = mirefenTavernLayout().props;
    for (const p of outside) {
      const w = tavernToWorld(p.x, p.z);
      const ground = terrainHeight(w.x, w.z, WORLD_SEED) - TAVERN_FLOOR_Y;
      expect(Math.abs((p.baseY ?? 0) - ground), `${p.kind} ${p.x}`).toBeLessThan(0.02);
      expect(tavernPropBaseY(p)).toBe(p.baseY);
      const c = tavernPropCollider(p);
      if (p.standable) {
        expect(c.moveTopY).toBeCloseTo(TAVERN_FLOOR_Y + ground + p.height, 1);
        expect(c.standable).toBe(true);
      }
      expect(layout.some((q) => q.kind === p.kind && q.x === p.x && q.base === p.baseY)).toBe(true);
    }
  });

  it('stands on the ground floor at its origin, the base running down into the ground', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    // the stone base reaches down under the lowest ground round the building
    expect(min[1]).toBeLessThan(-2.5);
    // the tallest things are the tower's finial over its hat and the hood's flue cap
    expect(max[1]).toBeGreaterThan(TAVERN_TOWER.peak + 1.5);
    expect(max[1]).toBeGreaterThan(TAVERN_HOOD.flueTop);
    expect(max[1]).toBeLessThan(TAVERN_TOWER.peak + 3);
  });
});
