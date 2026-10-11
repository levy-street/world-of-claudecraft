import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  sourceFingerprint,
  WICKHARBOR_WHARF_ASSET,
} from '../scripts/assets/wickharbor_wharf/build.mjs';
import {
  WICKHARBOR_LAYOUT_FILE,
  wickharborWharfLayout,
} from '../scripts/assets/wickharbor_wharf/layout';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  WICKHARBOR_WHARF_CRITICAL_PARTS,
  WICKHARBOR_WHARF_OPTIONAL_PARTS,
  WICKHARBOR_WHARF_TRIM_PARTS,
} from '../src/render/wickharbor_wharf_core';
import {
  WICKHARBOR_WHARF_ABOVE_WATER,
  WICKHARBOR_WHARF_DECKS,
  WICKHARBOR_WHARF_ORIGIN,
  WICKHARBOR_WHARF_PROPS,
  WICKHARBOR_WHARF_ROT,
} from '../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_RAIL_HEIGHT } from '../src/sim/content/wyrmwatch_harbor';

// The shipped Wickharbor ferry wharf GLB (public/models/props/wickharbor_wharf.glb), built in
// Blender from the sim's own layout (scripts/assets/wickharbor_wharf/layout.json, exported from
// src/sim/content/wickharbor_wharf.ts with the terrain under it) and shipped by build.mjs. Pins
// the bytes, the source fingerprint, the layout's freshness against the sim and the terrain,
// the named tier parts the runtime keeps or sheds, the five texture-free materials (the
// Wyrmwatch harbor's), the triangle budget, and the model's stamped numbers against the sim.
// Re-pin the sha256 and size literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, WICKHARBOR_WHARF_ASSET.target);
const SHIPPED_SHA256 = '655410d0d1042dc1b63a8558d84c0457428650c98b97d9fbbe2bacf1181b1e72';
const SHIPPED_BYTES = 168588;
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  WharfDeck: 1800,
  WharfFrame: 2112,
  WharfFlight: 360,
  WharfRails: 1508,
  WharfLanterns: 1128,
  WharfCargo: 828,
  WharfTrim: 2652,
  WharfClutter: 904,
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

interface WharfExtras {
  origin: number[];
  rot: number;
  tiers: Record<string, string[]>;
  level: number;
  decks: Record<string, number[]>;
  railHeight: number;
}

function extras(): WharfExtras {
  return (node('WickharborWharf_ROOT').getExtras() as { wickharborWharf: WharfExtras })
    .wickharborWharf;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('wickharbor ferry wharf GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/wickharbor_wharf.glb']).toMatch(
      /^\/media\/models\/props\/wickharbor_wharf\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Wickharbor ferry wharf (`public/models/props/wickharbor_wharf.glb`');
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('was built from the live layout: the sim content and the terrain under it', () => {
    const committed = JSON.parse(readFileSync(path.join(ROOT, WICKHARBOR_LAYOUT_FILE), 'utf8'));
    // the same decks, rails, props and ground heights the sim has today (a moved deck or a
    // reshaped shore means re-exporting the model so no pile floats)
    expect(committed).toEqual(JSON.parse(JSON.stringify(wickharborWharfLayout())));
  });

  it('keeps every named part the runtime keeps or sheds, under one root', () => {
    const names = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const name of WICKHARBOR_WHARF_ASSET.requiredNodes) {
      expect(names.has(name), name).toBe(true);
    }
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['WickharborWharf_ROOT']);
    for (const part of [
      ...WICKHARBOR_WHARF_CRITICAL_PARTS,
      ...WICKHARBOR_WHARF_TRIM_PARTS,
      ...WICKHARBOR_WHARF_OPTIONAL_PARTS,
    ]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('WickharborWharf_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    expect(extras().tiers).toEqual({
      low: [...WICKHARBOR_WHARF_CRITICAL_PARTS],
      medium: [...WICKHARBOR_WHARF_TRIM_PARTS],
      high: [...WICKHARBOR_WHARF_OPTIONAL_PARTS],
    });
  });

  it('shares the Wyrmwatch harbor five texture-free, vertex-coloured materials, and nothing animates', () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(WICKHARBOR_WHARF_ASSET.materials);
    expect(WICKHARBOR_WHARF_ASSET.materials).toEqual([
      'HarborGlow',
      'HarborIron',
      'HarborRope',
      'HarborStone',
      'HarborWood',
    ]);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    expect(doc.getRoot().listAnimations()).toHaveLength(0);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
      }
    }
  });

  it('holds each part to its triangle budget, the low tier well inside it', () => {
    let total = 0;
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
      total += count;
    }
    expect(trianglesUnder(node('WickharborWharf_ROOT'))).toBe(total);
    // one wharf (a pier, a berth head, an arm and a flight, dressed): under 14k in all, the
    // low tier under 9k
    expect(total).toBeLessThan(14000);
    const low = WICKHARBOR_WHARF_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(9000);
  });

  it("stamps the sim's numbers: the origin, the heading, the one plank height and the rail", () => {
    const e = extras();
    expect(e.origin).toEqual([WICKHARBOR_WHARF_ORIGIN.x, WICKHARBOR_WHARF_ORIGIN.z]);
    expect(e.rot).toBe(WICKHARBOR_WHARF_ROT);
    expect(e.level).toBe(WICKHARBOR_WHARF_ABOVE_WATER);
    for (const d of WICKHARBOR_WHARF_DECKS) {
      const [near, far] = e.decks[d.id];
      expect(near, d.id).toBeCloseTo(d.nearAboveWater ?? 0, 4);
      expect(far, d.id).toBeCloseTo(d.farAboveWater ?? 0, 4);
    }
    expect(e.railHeight).toBe(WYRMWATCH_RAIL_HEIGHT);
    // the rail stands at the player's waist (above a jump), the lantern posts well over head
    expect(e.railHeight).toBeGreaterThan(PLAYER_H * 0.4);
    for (const p of WICKHARBOR_WHARF_PROPS) {
      if (p.kind === 'lanternPost') expect(p.height).toBeGreaterThan(PLAYER_H * 1.5);
    }
  });

  it('sits on the waterline at its origin, its piles running down into the sea bed', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    // the piles reach below the waterline into the bed; the lantern posts are the tallest thing
    expect(min[1]).toBeLessThan(-2.5);
    expect(min[1]).toBeGreaterThan(-5);
    expect(max[1]).toBeGreaterThan(WICKHARBOR_WHARF_ABOVE_WATER + 4);
    expect(max[1]).toBeLessThan(WICKHARBOR_WHARF_ABOVE_WATER + 5);
    // no timetable, clock or ship state is modelled: no node names one
    for (const n of doc.getRoot().listNodes()) {
      expect(n.getName(), n.getName()).not.toMatch(/timer|clock|schedule|status|depart/i);
    }
  });
});
