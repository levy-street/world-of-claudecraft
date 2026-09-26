import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HARBOR_ROUTE_MARKER_ASSET,
  sourceFingerprint,
} from '../scripts/assets/harbor_route_marker/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
  HARBOR_ROUTE_MARKER_OPTIONAL_PARTS,
  HARBOR_ROUTE_MARKER_TRIM_PARTS,
} from '../src/render/harbor_route_marker_core';
import {
  HARBOR_ROUTE_MARKER_POST_RADIUS,
  HARBOR_ROUTE_MARKER_POST_TOP,
} from '../src/sim/harbor_route_markers';

// The shipped harbor route marker GLB (public/models/props/harbor_route_marker.glb), built
// from the Blender source by scripts/assets/harbor_route_marker/build.mjs. Pins the bytes,
// the named parts the runtime keeps or sheds per tier, the four texture-free materials,
// the triangle budget, the source fingerprint, the arrow's direction and the destination
// plate the runtime writes on, and the agreement between the model's stamped numbers and
// the sim's post collider. Re-pin the sha256 and size literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, HARBOR_ROUTE_MARKER_ASSET.target);
const SHIPPED_SHA256 = '57f037b8b6b1b787cfc838dd9c5deaf9be8ce074dd043471a7de38df52caaf8f';
const SHIPPED_BYTES = 51384;
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  Post: 188,
  SignBoard: 164,
  MaritimeIcon: 728,
  MetalTrim: 668,
  OptionalLantern: 128,
  OptionalChain: 192,
  OptionalRope: 260,
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

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('harbor route marker GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/harbor_route_marker.glb']).toMatch(
      /^\/media\/models\/props\/harbor_route_marker\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain(
      'Harbor route marker signpost (`public/models/props/harbor_route_marker.glb`',
    );
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('keeps every named part the runtime keeps or sheds, under one root', () => {
    const names = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const name of HARBOR_ROUTE_MARKER_ASSET.requiredNodes) {
      expect(names.has(name), name).toBe(true);
    }
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['HarborRouteMarker_ROOT']);
    // the tier lists the render core applies name real parts of the model,
    // each a direct child of the root with its own mesh
    for (const part of [
      ...HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
      ...HARBOR_ROUTE_MARKER_TRIM_PARTS,
      ...HARBOR_ROUTE_MARKER_OPTIONAL_PARTS,
    ]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('HarborRouteMarker_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    const extras = node('HarborRouteMarker_ROOT').getExtras() as {
      harborRouteMarker: { tiers: Record<string, string[]> };
    };
    expect(extras.harborRouteMarker.tiers).toEqual({
      low: [...HARBOR_ROUTE_MARKER_CRITICAL_PARTS],
      medium: [...HARBOR_ROUTE_MARKER_TRIM_PARTS],
      high: [...HARBOR_ROUTE_MARKER_OPTIONAL_PARTS],
    });
  });

  it('shares four texture-free, vertex-coloured materials, and nothing animates', () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(HARBOR_ROUTE_MARKER_ASSET.materials);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    expect(doc.getRoot().listAnimations()).toHaveLength(0);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
      }
    }
  });

  it('holds each part to its triangle budget', () => {
    let total = 0;
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
      total += count;
    }
    expect(trianglesUnder(node('HarborRouteMarker_ROOT'))).toBe(total);
    // a prop, not a landmark: under 3k in all, the low tier under 1.2k
    expect(total).toBeLessThan(3000);
    const low = HARBOR_ROUTE_MARKER_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(1200);
  });

  it('stands floor-seated on its post, clearly taller than a player, board above head height', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    expect(min[1]).toBeCloseTo(0, 3);
    // the owner's scale: about two to two and a half players tall
    expect(max[1] / PLAYER_H).toBeGreaterThanOrEqual(2);
    expect(max[1] / PLAYER_H).toBeLessThanOrEqual(2.5);
    // slim across the board's faces, long along the arrow
    expect(max[2] - min[2]).toBeLessThan(1.2);
    expect(max[0]).toBeGreaterThan(4);
    const extras = node('HarborRouteMarker_ROOT').getExtras() as {
      harborRouteMarker: {
        arrow: number[];
        front: number[];
        postColliderRadius: number;
        postTop: number;
        boardBottom: number;
        boardTop: number;
      };
    };
    const m = extras.harborRouteMarker;
    expect(m.boardBottom).toBeGreaterThan(PLAYER_H + 0.5);
    expect(m.boardTop).toBeGreaterThan(m.boardBottom);
    // the sim's one narrow collider is the model's post
    expect(m.postColliderRadius).toBeCloseTo(HARBOR_ROUTE_MARKER_POST_RADIUS, 6);
    expect(m.postTop).toBeCloseTo(HARBOR_ROUTE_MARKER_POST_TOP, 6);
  });

  it('points its arrow down +x, and leaves a clean plate for the runtime name', () => {
    const extras = node('HarborRouteMarker_ROOT').getExtras() as {
      harborRouteMarker: {
        arrow: number[];
        front: number[];
        boardBottom: number;
        boardTop: number;
      };
    };
    expect(extras.harborRouteMarker.arrow).toEqual([1, 0, 0]);
    expect(extras.harborRouteMarker.front).toEqual([0, 0, 1]);
    const tip = node('Socket_ArrowTip').getWorldTranslation();
    const { max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(tip[0]).toBeCloseTo(max[0], 3);
    expect(tip[2]).toBeCloseTo(0, 6);
    // the plate sits on the board, between the post and the arrow head
    const anchor = node('DestinationTextAnchor');
    const at = anchor.getWorldTranslation();
    const plate = anchor.getExtras().destinationText as {
      width: number;
      height: number;
      corner: number;
      faceOffset: number;
      textWidth: number;
      textHeight: number;
      faces: string[];
    };
    expect(at[0] - plate.width / 2).toBeGreaterThan(0.22); // clear of the post
    expect(at[0] + plate.width / 2).toBeLessThan(tip[0] - 1); // clear of the head
    expect(at[1] - plate.height / 2).toBeGreaterThan(extras.harborRouteMarker.boardBottom);
    expect(at[1] + plate.height / 2).toBeLessThan(extras.harborRouteMarker.boardTop);
    expect(at[2]).toBeCloseTo(0, 6);
    expect(plate.faces).toEqual(['+z', '-z']);
    expect(plate.faceOffset).toBeGreaterThan(0.1);
    expect(plate.textWidth).toBeLessThanOrEqual(1);
    expect(plate.textHeight).toBeLessThanOrEqual(1);
    // no text, timetable or ship state is modelled: no node names one
    for (const n of doc.getRoot().listNodes()) {
      expect(n.getName(), n.getName()).not.toMatch(/timer|clock|schedule|status|depart/i);
    }
  });
});
