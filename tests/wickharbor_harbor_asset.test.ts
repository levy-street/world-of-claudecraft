import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  sourceFingerprint,
  WICKHARBOR_HARBOR_ASSET,
} from '../scripts/assets/wickharbor_harbor/build.mjs';
import {
  WICKHARBOR_HARBOR_LAYOUT_FILE,
  wickharborHarborLayout,
} from '../scripts/assets/wickharbor_harbor/layout';
import { WICKHARBOR_WHARF_ASSET } from '../scripts/assets/wickharbor_wharf/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  WICKHARBOR_HARBOR_CRITICAL_PARTS,
  WICKHARBOR_HARBOR_OPTIONAL_PARTS,
  WICKHARBOR_HARBOR_TRIM_PARTS,
} from '../src/render/wickharbor_harbor_core';
import {
  WICKHARBOR_BEACON_STAIR_TOP,
  WICKHARBOR_BOARDWALK_TOP,
  WICKHARBOR_HARBOR_DECKS,
  WICKHARBOR_HARBOR_FRAME,
  WICKHARBOR_HARBOR_PROPS,
} from '../src/sim/content/wickharbor_harbor';
import { WYRMWATCH_RAIL_HEIGHT } from '../src/sim/content/wyrmwatch_harbor';

// The shipped Wickharbor harbor GLB (public/models/props/wickharbor_harbor.glb), built in
// Blender from the sim's own layout (scripts/assets/wickharbor_harbor/layout.json, exported from
// src/sim/content/wickharbor_harbor.ts with the terrain under it) and shipped by build.mjs. Pins
// the bytes, the source fingerprint, the layout's freshness against the sim and the terrain,
// the named tier parts the runtime keeps or sheds, the five texture-free materials (the ferry
// wharf's and the Wyrmwatch harbor's: one wood), the triangle budget, and the model's stamped
// numbers against the sim. Re-pin the sha256 and size literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, WICKHARBOR_HARBOR_ASSET.target);
const SHIPPED_SHA256 = '0c2872d472703711ac7b9fa0ba2ea60814e54501c7909338b5439db848ddebab';
const SHIPPED_BYTES = 409384;
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  HarborDecks: 5148,
  HarborFrame: 5328,
  HarborStairs: 1572,
  HarborRails: 2992,
  HarborLanterns: 2752,
  HarborCargo: 1900,
  HarborTrim: 8080,
  HarborClutter: 2748,
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

interface HarborExtras {
  origin: number[];
  tiers: Record<string, string[]>;
  boardwalkTop: number;
  decks: Record<string, number[]>;
  railHeight: number;
}

function extras(): HarborExtras {
  return (node('WickharborHarbor_ROOT').getExtras() as { wickharborHarbor: HarborExtras })
    .wickharborHarbor;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('wickharbor harbor GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/wickharbor_harbor.glb']).toMatch(
      /^\/media\/models\/props\/wickharbor_harbor\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Wickharbor harbor (`public/models/props/wickharbor_harbor.glb`');
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('was built from the live layout: the sim content and the terrain under it', () => {
    const committed = JSON.parse(
      readFileSync(path.join(ROOT, WICKHARBOR_HARBOR_LAYOUT_FILE), 'utf8'),
    );
    // the same decks, rails, props and ground heights the sim has today (a moved deck or a
    // reshaped shore means re-exporting the model so no pile floats)
    expect(committed).toEqual(JSON.parse(JSON.stringify(wickharborHarborLayout())));
  });

  it('keeps every named part the runtime keeps or sheds, under one root', () => {
    const names = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const name of WICKHARBOR_HARBOR_ASSET.requiredNodes) {
      expect(names.has(name), name).toBe(true);
    }
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['WickharborHarbor_ROOT']);
    for (const part of [
      ...WICKHARBOR_HARBOR_CRITICAL_PARTS,
      ...WICKHARBOR_HARBOR_TRIM_PARTS,
      ...WICKHARBOR_HARBOR_OPTIONAL_PARTS,
    ]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('WickharborHarbor_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    expect(extras().tiers).toEqual({
      low: [...WICKHARBOR_HARBOR_CRITICAL_PARTS],
      medium: [...WICKHARBOR_HARBOR_TRIM_PARTS],
      high: [...WICKHARBOR_HARBOR_OPTIONAL_PARTS],
    });
  });

  it("is the ferry wharf's wood: the same five texture-free, vertex-coloured materials, and nothing animates", () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(WICKHARBOR_HARBOR_ASSET.materials);
    expect(WICKHARBOR_HARBOR_ASSET.materials).toEqual(WICKHARBOR_WHARF_ASSET.materials);
    // one recipe and palette: the builder that paints the wharf paints the harbor
    for (const asset of [WICKHARBOR_HARBOR_ASSET, WICKHARBOR_WHARF_ASSET]) {
      expect(asset.inputs).toContain('scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py');
      expect(asset.inputs).toContain('scripts/assets/eastbrook_ferry/shiplib.py');
    }
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
    expect(trianglesUnder(node('WickharborHarbor_ROOT'))).toBe(total);
    // the whole town harbor (a boardwalk, the great quay, two piers, three stairs and the
    // Beacon dock, about five times the ferry wharf's planks, with the quay's crane and cargo
    // shelter): under 32k in all, the low tier under 21k (the quay's planks and frame are most
    // of the rise; the crane's rig and the shelter's braces are medium-tier trim)
    expect(total).toBeLessThan(32000);
    const low = WICKHARBOR_HARBOR_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(21000);
  });

  it("stamps the sim's numbers: the origin, every deck's heights and the rail", () => {
    const e = extras();
    expect(e.origin).toEqual([WICKHARBOR_HARBOR_FRAME.x, WICKHARBOR_HARBOR_FRAME.z]);
    expect(e.boardwalkTop).toBe(WICKHARBOR_BOARDWALK_TOP);
    for (const d of WICKHARBOR_HARBOR_DECKS) {
      const [near, far] = e.decks[d.id];
      expect(near, d.id).toBeCloseTo(d.nearAboveWater ?? 0, 4);
      expect(far, d.id).toBeCloseTo(d.farAboveWater ?? 0, 4);
    }
    expect(e.railHeight).toBe(WYRMWATCH_RAIL_HEIGHT);
    // the rail stands at the player's waist (above a jump), the lantern posts well over head
    expect(e.railHeight).toBeGreaterThan(PLAYER_H * 0.4);
    for (const p of WICKHARBOR_HARBOR_PROPS) {
      if (p.kind === 'lanternPost') expect(p.height).toBeGreaterThan(PLAYER_H * 1.5);
      // the crane's mast towers over the quay, the shelter's posts clear a player's head
      if (p.kind === 'timberPost') expect(p.height).toBeGreaterThan(PLAYER_H * 1.6);
    }
  });

  it('sits on the waterline at its origin, its piles running down into the sea bed', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    // the piles reach below the waterline into the bed; the Beacon stair's head lanterns on
    // the headland are the tallest thing
    expect(min[1]).toBeLessThan(-1.5);
    expect(min[1]).toBeGreaterThan(-5);
    expect(max[1]).toBeGreaterThan(WICKHARBOR_BEACON_STAIR_TOP + WYRMWATCH_RAIL_HEIGHT);
    expect(max[1]).toBeLessThan(WICKHARBOR_BEACON_STAIR_TOP + 3);
    // the whole harbor, the stairs' heads to the Beacon dock's head, and nothing past it
    expect(min[0]).toBeGreaterThan(-12);
    expect(max[0]).toBeLessThan(62);
    // no timetable, clock or ship state is modelled: no node names one
    for (const n of doc.getRoot().listNodes()) {
      expect(n.getName(), n.getName()).not.toMatch(/timer|clock|schedule|status|depart/i);
    }
  });
});
