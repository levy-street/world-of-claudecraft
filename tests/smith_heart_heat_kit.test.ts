// The Smith's Heart raid's Heat vein (phase 2I, docs/design/raid/smith_heart.md
// section 5.16): the Hearth, never a forge. Its columnar basalt floors, its
// Blender kit (scripts/assets/smith_heart_heat_kit/build.mjs, built from
// docs/design/raid/kit/build_smith_heart_heat_kit.py) and its plan
// (heat_kit_plan_core.ts):
//   - the floors: every Heat walk the `hearth` ground, its burning joints
//     painted in a hue the floor's material finds and nothing else carries;
//   - the shipped GLB is the current sources', inside its budget, the first
//     flame's crystal and seams the only glow; the pieces a body touches stay
//     within their colliders, the inlays, the drifts and the channel never
//     stand over a walk past a hand, the walls stand past the lip, the
//     Hearth's mouth never reaches the Forge's floor;
//   - the plan fits every Heat prop on its old spot (ids frozen), lays the
//     Pour Channel from the wellspring to the lip, raises the corner pillars
//     past the lips, walls every Heat lip over the void (never over a walk,
//     never across the spill), lays the seams flat on the floors (never
//     across the channel);
//   - nothing player-facing names a forge object: the guardian's strikes are
//     the first flame's (Basalt Fist, Molten Swell), never a smith's tool.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), so a
// piece's front (Blender -Y) is +Z here, as in the game.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_HEAT_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_heat_kit/build.mjs';
import {
  fieldFamilyUvScale,
  fieldGroundFamily,
  topColor,
} from '../src/render/authored_field/field_mesh_core';
import { HEARTH_SEAM_PAINT } from '../src/render/authored_field/field_textures';
import { hearthSeamMask } from '../src/render/smith_heart/heat_hearth_floor';
import {
  HEAT_CHANNEL_HALF,
  HEAT_DRESS_FLOORS,
  HEAT_HEARTH_FACE,
  HEAT_KIT_KINDS,
  HEAT_KIT_SHALLOW,
  HEAT_PILLAR,
  HEAT_WALK_SURFACES,
  HEAT_WALL,
  HEAT_WELL_FIRE,
  HEAT_WELL_FRONT,
  heatChannelRun,
  heatWallClear,
  heatWellspring,
  planHeatBridge,
  planHeatChannel,
  planHeatDressing,
  planHeatKit,
  planHeatPillars,
  planHeatProps,
  planHeatWalls,
  HEAT_KIT_SHALLOW as ROCK_SEES_SHALLOW,
} from '../src/render/smith_heart/heat_kit_plan_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import {
  GIANT_ANVIL,
  GREAT_HEARTH,
  HEAT,
  POUR_CHANNEL,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { HEAT_NAMES } from '../src/sim/encounters/smith_heart/heat_ids';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;

describe("the Heat's floors", () => {
  it('lays every Heat walk in the columnar basalt, its cliffs as rock', () => {
    expect(fieldGroundFamily('hearth')).toBe('hearth');
    expect(fieldFamilyUvScale('hearth')).toBeCloseTo(1 / 10, 9);
    for (const id of HEAT_WALK_SURFACES) {
      const s = F.surfaces.find((q) => q.id === id);
      expect(s?.ground, id).toBe('hearth');
      // The carved mountain's own edge, never a built wall.
      expect(s?.edge, id).toBe('rock');
    }
    // No forge floor is left anywhere in the raid (the soot and the plate
    // were the smithy's).
    for (const s of F.surfaces) expect(['soot', 'plate'], s.id).not.toContain(s.ground);
  });

  it('paints the basalt a dark warm grey in broad drifts, never one flat colour, never black', () => {
    const lum: number[] = [];
    let warm = 0;
    let n = 0;
    for (let x = -250; x < -80; x += 7)
      for (let z = -40; z < 40; z += 9) {
        const [r, g, b] = topColor('hearth', x, z, false);
        lum.push(0.3 * r + 0.59 * g + 0.11 * b);
        if (r >= b) warm++;
        n++;
      }
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(1.3);
    expect(Math.min(...lum)).toBeGreaterThan(0.08);
    // Grey, not orange: the fire is the joints' own light.
    for (let x = -250; x < -80; x += 13) {
      const [r, , b] = topColor('hearth', x, 3, false);
      expect(r / b).toBeLessThan(1.35);
    }
    expect(warm / n).toBeGreaterThan(0.9);
  });

  it('finds the burning joints by their hue in the map, and nothing else the tile paints', () => {
    const seam = HEARTH_SEAM_PAINT.map((v) => v / 1.6);
    expect(hearthSeamMask(seam[0], seam[2])).toBeGreaterThan(0.99);
    // The basalt, the ash, the umber the fire bakes round a joint.
    for (const [r, , b] of [
      [1.1, 1.05, 1.0],
      [1.32, 1.26, 1.18],
      [1.05, 0.72, 0.5],
      [0.5, 0.47, 0.45],
    ])
      expect(hearthSeamMask(r / 1.6, b / 1.6)).toBe(0);
  });
});

// ---- the kit's GLB ---------------------------------------------------------------

const KIT = ASSET.target;
const haveKit = existsSync(KIT);

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  points: V3[];
  byMaterial: Map<string, V3[]>;
  triangles: number;
  materials: Set<string>;
}
const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  extras = (doc.getRoot().getExtras() ?? {}) as Record<string, unknown>;
  nodeNames = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName())
    .sort();
  materialNames = doc
    .getRoot()
    .listMaterials()
    .map((m) => m.getName())
    .sort();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const points: V3[] = [];
    const byMaterial = new Map<string, V3[]>();
    const materials = new Set<string>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      materials.add(mat);
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const list = byMaterial.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const p: V3 = [
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ];
        points.push(p);
        list.push(p);
      }
      byMaterial.set(mat, list);
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, byMaterial, triangles, materials });
  }
});

const shape = (name: string): Shape => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  return s;
};

/** How far a piece reaches from its origin between a hand over the ground
 *  and `below` yards up. */
const reach = (name: string, below: number): number => {
  let r = 0;
  for (const p of shape(name).points)
    if (p[1] < below && p[1] > 0.3) r = Math.max(r, Math.hypot(p[0], p[2]));
  return r;
};
/** Its reach along each local axis (|x|, |z|) in the same band. */
const box = (name: string, below: number): [number, number] => {
  let x = 0;
  let z = 0;
  for (const p of shape(name).points)
    if (p[1] < below && p[1] > 0.3) {
      x = Math.max(x, Math.abs(p[0]));
      z = Math.max(z, Math.abs(p[2]));
    }
  return [x, z];
};

describe('Smith Heart Heat kit: the piece list and the shipped GLB', () => {
  it('lists every piece once: the Forge, the crystal, the casting floor, the walks', () => {
    const list = SMITH_HEART_HEAT_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'HearthMouth',
      'AltarStone',
      'EmberBoulder',
      'HearthPillar',
      'FireCrystalA',
      'FireCrystalB',
      'Wellspring',
      'PourChannel',
      'PourSpill',
      'HeatBridge',
      'HeatWallA',
      'HeatWallB',
      'FireCrackA',
      'FireCrackB',
      'AshDriftA',
      'AshDriftB',
    ])
      expect(list, piece).toContain(piece);
    // Never a smithy's piece again.
    for (const p of list) expect(p, p).not.toMatch(/Anvil|Bellows|Crucible|Chain|Coal/);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_HEAT_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const cap = /Crack|Drift|Wall|Channel/.test(name)
        ? 2000
        : name === 'Kit_HearthMouth'
          ? 18000
          : 9000;
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
      total += s.triangles;
    }
    expect(total).toBeLessThan(70_000);
  });

  it.skipIf(!haveKit)('glows only in the first flame: its crystal, its seams, its brim', () => {
    for (const glowing of [
      'Kit_HearthMouth',
      'Kit_AltarStone',
      'Kit_Wellspring',
      'Kit_FireCrystalA',
      'Kit_FireCrystalB',
      'Kit_EmberBoulder',
      'Kit_HearthPillar',
      'Kit_FireCrackA',
      'Kit_PourChannel',
    ])
      expect(shape(glowing).materials.has('KitGlow'), glowing).toBe(true);
    for (const plain of ['Kit_HeatWallB', 'Kit_AshDriftA', 'Kit_AshDriftB'])
      expect(shape(plain).materials.has('KitGlow'), plain).toBe(false);
  });
});

describe('Smith Heart Heat kit: the measures the plan relies on', () => {
  it.skipIf(!haveKit)('keeps every touchable foot inside its collider and a body', () => {
    const prop = (kind: string) => F.props.find((p) => p.kind === kind);
    // The crystal clusters (r 2.4) and the wellspring (r 3).
    for (const piece of ['Kit_FireCrystalA', 'Kit_FireCrystalB'])
      expect(reach(piece, 3), piece).toBeLessThanOrEqual((prop('sh_crucible')?.r ?? 0) + 0.5);
    expect(reach('Kit_Wellspring', 3)).toBeLessThanOrEqual(
      (prop('sh_pour_crucible')?.r ?? 0) + 0.5,
    );
    // The altar-stone on the old anvil's box, the boulders on the bellows'.
    const [ax, az] = box('Kit_AltarStone', 3);
    expect(ax).toBeLessThanOrEqual(GIANT_ANVIL.hw + 0.5);
    expect(az).toBeLessThanOrEqual(GIANT_ANVIL.hd + 0.5);
    const bellows = prop('sh_great_bellows');
    const [bx, bz] = box('Kit_EmberBoulder', 3);
    expect(bx).toBeLessThanOrEqual((bellows?.hw ?? 0) + 0.5);
    expect(bz).toBeLessThanOrEqual((bellows?.hd ?? 0) + 0.5);
    // The landmarks stand well over a body: the altar's crown and the
    // wellspring's crystal.
    expect(shape('Kit_AltarStone').max[1]).toBeGreaterThan(8);
    expect(shape('Kit_Wellspring').max[1]).toBeGreaterThan(6);
  });

  it.skipIf(!haveKit)(
    'brims the wellspring where the pour reads it, its chute to the front',
    () => {
      // Its fire (the glow inside the rim; the crystal crowns it outside).
      const fire = (shape('Kit_Wellspring').byMaterial.get('KitGlow') ?? []).filter(
        (p) => Math.hypot(p[0], p[2]) < 1.6,
      );
      const top = Math.max(...fire.map((p) => p[1]));
      expect(top).toBeGreaterThan(HEAT_WELL_FIRE);
      expect(top).toBeLessThan(HEAT_WELL_FIRE + 0.45);
      // The tongue spills out of its front (+Z) to the channel's head.
      const tongue = shape('Kit_Wellspring').byMaterial.get('KitGlow') ?? [];
      const front = Math.max(...tongue.filter((p) => p[1] < 0.6).map((p) => p[2]));
      expect(front).toBeGreaterThan(HEAT_WELL_FRONT - 0.6);
    },
  );

  it.skipIf(!haveKit)(
    'lays the inlays, the drifts and the channel flat under every telegraph',
    () => {
      for (const flat of ['Kit_FireCrackA', 'Kit_FireCrackB'])
        expect(shape(flat).max[1], flat).toBeLessThan(0.05);
      for (const low of ['Kit_AshDriftA', 'Kit_AshDriftB', 'Kit_PourChannel'])
        expect(shape(low).max[1], low).toBeLessThanOrEqual(0.3);
      // The channel's bed (everything between its lips) under a breath.
      for (const p of shape('Kit_PourChannel').points)
        if (Math.abs(p[2]) < 2.2) expect(p[1]).toBeLessThan(0.05);
      expect(shape('Kit_PourChannel').max[2]).toBeLessThanOrEqual(HEAT_CHANNEL_HALF + 0.3);
    },
  );

  it.skipIf(!haveKit)('stands the walls past the lip, a knee high, nothing over the walk', () => {
    for (const v of ['A', 'B']) {
      const s = shape(`Kit_HeatWall${v}`);
      for (const p of s.points) if (p[2] < 0.04) expect(p[1], v).toBeLessThan(0.05);
      expect(s.max[1], v).toBeGreaterThan(0.8);
      expect(s.max[1], v).toBeLessThan(HEAT_WALL.height + 0.05);
      expect(s.max[2], v).toBeLessThanOrEqual(HEAT_WALL.far + 0.05);
      // A module fills its own length (no gap at the joins).
      expect(s.max[0] - s.min[0], v).toBeGreaterThan(5.6);
    }
  });

  it.skipIf(!haveKit)(
    "keeps the Hearth's mouth off the Forge's floor and the pillars in their bundle",
    () => {
      const m = shape('Kit_HearthMouth');
      // Its front (+Z, toward the Forge) never reaches the floor's lip.
      expect(m.max[2]).toBeLessThan(HEAT_HEARTH_FACE);
      // Its root plunges into the chasm (never a block floating on the void).
      expect(m.min[1]).toBeLessThan(-25);
      // Vast: higher than the Forge is wide at its mouth, about.
      expect(m.max[1]).toBeGreaterThan(40);
      const p = shape('Kit_HearthPillar');
      expect(
        Math.max(Math.abs(p.min[0]), p.max[0], Math.abs(p.min[2]), p.max[2]),
      ).toBeLessThanOrEqual(HEAT_PILLAR.r + 0.05);
      expect(p.min[1]).toBeLessThan(-30);
      // The bridge's arch: nothing over its deck.
      const b = shape('Kit_HeatBridge');
      expect(b.max[1]).toBeLessThan(0);
    },
  );
});

describe('Smith Heart Heat kit: the plan', () => {
  it('fits every Heat prop with its piece on its old spot (ids frozen)', () => {
    const plan = planHeatProps();
    const of = (piece: string) => plan.filter((p) => p.piece === piece).length;
    const kinds = (kind: string) => F.props.filter((p) => p.kind === kind).length;
    expect(of('Kit_HearthMouth')).toBe(kinds('sh_great_hearth'));
    expect(of('Kit_AltarStone')).toBe(kinds('sh_giant_anvil'));
    expect(of('Kit_Wellspring')).toBe(kinds('sh_pour_crucible'));
    expect(of('Kit_EmberBoulder')).toBe(kinds('sh_great_bellows'));
    expect(of('Kit_FireCrystalA') + of('Kit_FireCrystalB')).toBe(kinds('sh_crucible'));
    expect(of('Kit_FireCrystalB')).toBeGreaterThan(0);
    // The casting channels are seams of fire laid along them, on the Forge.
    const seams = plan.filter((p) => p.piece.startsWith('Kit_FireCrack'));
    expect(seams.length).toBeGreaterThanOrEqual(kinds('sh_casting_channel') * 3);
    for (const p of seams) expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id).toBe('smiths_forge');
    // Each piece on its prop's own spot.
    for (const kind of ['sh_great_hearth', 'sh_giant_anvil', 'sh_pour_crucible']) {
      const prop = F.props.find((p) => p.kind === kind);
      expect(
        plan.some((p) => p.x === prop?.x && p.z === prop?.z && p.rot === prop?.rot),
        kind,
      ).toBe(true);
    }
    for (const k of HEAT_KIT_KINDS) expect(kinds(k), k).toBeGreaterThan(0);
    // The layout's own constants are where the sim keeps them.
    expect(GREAT_HEARTH.x).toBe(-263);
    expect(POUR_CHANNEL.x).toBe(-150);
  });

  it('lays the Pour Channel from the wellspring down to the south lip', () => {
    const run = heatChannelRun();
    const w = heatWellspring();
    expect(run.x).toBe(POUR_CHANNEL.x);
    expect(run.z0).toBe(HEAT.floor.z0);
    expect(run.z1).toBeCloseTo(w.z - HEAT_WELL_FRONT, 6);
    const ch = planHeatChannel();
    const mods = ch.filter((p) => p.piece === 'Kit_PourChannel');
    const covered = mods.reduce((s, p) => s + (p.stretch ?? 1) * HEAT_CHANNEL_HALF * 2, 0);
    expect(covered).toBeCloseTo(run.z1 - run.z0, 6);
    for (const p of mods) {
      expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id).toBe('casting_floor');
      expect(Math.abs(p.y - authoredFieldHeight(F, p.x, p.z))).toBeLessThan(0.01);
      expect(p.stretch ?? 1).toBeGreaterThan(0.8);
    }
    const spill = ch.find((p) => p.piece === 'Kit_PourSpill');
    expect(spill?.z).toBe(HEAT.floor.z0);
    // Its drop (local +Z) faces the south, out of the floor.
    expect(spill && Math.cos(spill.rot)).toBeLessThan(-0.99);
  });

  it("raises the Forge's corner pillars past its lips, never over a walk", () => {
    const pillars = planHeatPillars();
    expect(pillars.length).toBe(10);
    for (const p of pillars) {
      const k = p.scale ?? 1;
      for (let a = 0; a < 16; a++)
        for (const r of [0, 1.5, HEAT_PILLAR.r * k]) {
          const x = p.x + Math.sin((a / 16) * Math.PI * 2) * r;
          const z = p.z + Math.cos((a / 16) * Math.PI * 2) * r;
          expect(authoredFieldSurfaceAt(F, x, z), `pillar at ${p.x} ${p.z}`).toBeNull();
        }
      // Never in the Hearth's mouth.
      expect(Math.abs(p.z) > GREAT_HEARTH.halfWidth || p.x > GREAT_HEARTH.x + 9).toBe(true);
    }
  });

  it('stands the bridge on its arch, the field drawing only a keel under it', () => {
    expect(HEAT_KIT_SHALLOW.has('anvil_bridge')).toBe(true);
    expect(ROCK_SEES_SHALLOW).toBe(HEAT_KIT_SHALLOW);
    const [b] = planHeatBridge();
    const s = F.surfaces.find((q) => q.id === 'anvil_bridge');
    if (!s || s.kind !== 'path') throw new Error('no anvil bridge');
    expect(b.x).toBe(s.points[0][0]);
    expect(b.z).toBe(s.points[0][1]);
    // Local +X runs along the bridge to its far end.
    const [ex, ez] = s.points[s.points.length - 1];
    expect(Math.cos(b.rot) * (ex - b.x) - Math.sin(b.rot) * (ez - b.z)).toBeGreaterThan(17);
  });

  it('walls the Heat walks over the void, never over a walk, never across the spill', () => {
    const walls = planHeatWalls();
    expect(walls.length).toBeGreaterThan(20);
    for (const w of walls)
      expect(heatWallClear(w.x, w.z, w.rot, w.stretch ?? 1), `${w.x} ${w.z}`).toBe(true);
    const run = heatChannelRun();
    for (const w of walls) {
      expect(Math.abs(w.x - run.x) < 5.5 && Math.abs(w.z - run.z0) < 3, `${w.x} ${w.z}`).toBe(
        false,
      );
      // The modules keep their own length (never squeezed into a fence).
      expect(w.stretch ?? 1).toBeGreaterThan(0.6);
    }
    const near = (id: string) =>
      walls.filter((w) =>
        [-1.5, -0.5].some(
          (d) =>
            authoredFieldSurfaceAt(F, w.x + Math.sin(w.rot) * d, w.z + Math.cos(w.rot) * d)?.id ===
            id,
        ),
      ).length;
    for (const id of ['casting_floor', 'smiths_forge', 'anvil_bridge'])
      expect(near(id), id).toBeGreaterThan(1);
    expect(walls.some((w) => w.piece === 'Kit_HeatWallB')).toBe(true);
  });

  it('lays the seams of fire and the ash flat on the floors, never across the channel', () => {
    const flat = planHeatDressing();
    const run = heatChannelRun();
    const seams = flat.filter((p) => p.piece.startsWith('Kit_FireCrack'));
    const ash = flat.filter((p) => p.piece.startsWith('Kit_AshDrift'));
    expect(seams.length).toBeGreaterThanOrEqual(10);
    expect(ash.length).toBeGreaterThan(4);
    for (const p of flat) {
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(HEAT_DRESS_FLOORS.has(s?.id ?? ''), `${p.piece} on ${s?.id}`).toBe(true);
      expect(Math.abs(p.y - authoredFieldHeight(F, p.x, p.z))).toBeLessThan(0.05);
      expect(p.cosmetic).toBe(true);
      expect(p.noShadow).toBe(true);
    }
    for (const p of seams)
      expect(Math.abs(p.x - run.x) < 9 && p.z > run.z0 && p.z < run.z1 + 4).toBe(false);
    expect(planHeatKit().length).toBeGreaterThan(60);
  });
});

describe('the Heat names no forge object to the player', () => {
  it('names every strike of the first flame, none of them a forge tool', () => {
    // The guardian has no trash kit of its own any more: its strikes are the
    // fight's (heat_fist.ts, heat_flare.ts), named in HEAT_NAMES.
    expect(SMITH_HEART_MOBS.heart_heat_guardian.trashKit).toBeUndefined();
    expect(HEAT_NAMES.fist).toBe('Basalt Fist');
    expect(HEAT_NAMES.swell).toBe('Molten Swell');
    for (const name of Object.values(HEAT_NAMES))
      expect(name).not.toMatch(/anvil|hammer|forge|bellows|tongs|smith/i);
  });
});
