import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { FERRY_ASSET, sourceFingerprint } from '../scripts/assets/eastbrook_ferry/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { EASTBROOK_FERRY_HULL } from '../src/sim/content/transport_ships';

// The shipped Eastbrook ferry GLB (public/models/props/eastbrook_ferry.glb), built
// from the Blender source by scripts/assets/eastbrook_ferry/build.mjs. Pins the
// bytes, the hierarchy the runtime depends on, the five shared materials, the one
// idle clip, the triangle budget of every level of detail, the source fingerprint,
// and the agreement between the model's stamped layout and the sim's hull.
// Re-pin the sha256 and size literals only together with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, FERRY_ASSET.target);
const SHIPPED_SHA256 = '1038ed4b3d602bd49113cb4aaf1a4ff6b05e6fcb025ba1f15aacfbb97d546311';
const SHIPPED_BYTES = 559300;
/** Triangles per level (and the gangplank), from the Blender build report. */
const TRIANGLES = { LOD0: 28094, LOD1: 4138, LOD2: 219, LOD3: 89, Gangplank: 252 };

let doc: Document;

function trianglesUnder(node: GltfNode): number {
  let total = 0;
  const walk = (n: GltfNode): void => {
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      total += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    for (const child of n.listChildren()) walk(child);
  };
  walk(node);
  return total;
}

function node(name: string): GltfNode {
  const found = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!found) throw new Error(`no node ${name}`);
  return found;
}

function worldTranslation(n: GltfNode): number[] {
  return n.getWorldTranslation();
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('Eastbrook ferry GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/eastbrook_ferry.glb']).toMatch(
      /^\/media\/models\/props\/eastbrook_ferry\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain(
      'Eastbrook ferry transport ship (`public/models/props/eastbrook_ferry.glb`',
    );
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('keeps the hierarchy the runtime and the next phases depend on', () => {
    const names = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const name of FERRY_ASSET.requiredNodes) expect(names.has(name), name).toBe(true);
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['TransportShip_ROOT']);
    // the idle bob parents every level of detail; the gangplank rests on the pier
    expect(node('LOD0').getParentNode()?.getName()).toBe('Ship_Motion');
    expect(node('LOD3').getParentNode()?.getName()).toBe('Ship_Motion');
    expect(node('Gangplank').getParentNode()?.getName()).toBe('TransportShip_ROOT');
    expect(node('Ship_Motion').getParentNode()?.getName()).toBe('TransportShip_ROOT');
  });

  it('shares five texture-free materials, the cloth double sided', () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(FERRY_ASSET.materials);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    for (const m of materials) {
      expect(m.getDoubleSided(), m.getName()).toBe(m.getName() === 'FerryCloth');
    }
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
      }
    }
  });

  it('holds each level of detail to its triangle budget', () => {
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
    }
    // the hero budget: full model under 30k, each level a real step down
    expect(TRIANGLES.LOD0).toBeLessThan(30000);
    expect(TRIANGLES.LOD1).toBeLessThan(TRIANGLES.LOD0 / 4);
    expect(TRIANGLES.LOD2).toBeLessThan(400);
    expect(TRIANGLES.LOD3).toBeLessThan(TRIANGLES.LOD2);
  });

  it('carries one idle clip on the bob, the full-detail sails and the flags only', () => {
    const anims = doc.getRoot().listAnimations();
    expect(anims.map((a) => a.getName())).toEqual(['Idle']);
    const targets = new Set(anims[0].listChannels().map((c) => c.getTargetNode()?.getName() ?? ''));
    const lod0 = new Set<string>();
    const walk = (n: GltfNode): void => {
      lod0.add(n.getName());
      for (const c of n.listChildren()) walk(c);
    };
    walk(node('LOD0'));
    for (const t of targets) {
      expect(t === 'Ship_Motion' || lod0.has(t), t).toBe(true);
    }
    expect(targets.has('Ship_Motion')).toBe(true);
    for (const sail of ['MainSail', 'SecondarySail', 'MizzenSail', 'JibSail']) {
      expect(targets.has(sail), sail).toBe(true);
    }
    expect([...targets].some((t) => t.startsWith('Pennant_Main'))).toBe(true);
    expect([...targets].some((t) => t.startsWith('Ensign'))).toBe(true);
    // nothing the static merge folds away is animated
    for (const fixed of ['Hull', 'Deck', 'MainMast', 'Gangplank', 'LOD1']) {
      expect(targets.has(fixed), fixed).toBe(false);
    }
    // a seamless loop: every sampler ends where it starts, twelve seconds on
    for (const channel of anims[0].listChannels()) {
      const sampler = channel.getSampler();
      const input = sampler?.getInput()?.getArray();
      const output = sampler?.getOutput();
      if (!input || !output) throw new Error('empty sampler');
      expect(input[input.length - 1] - input[0]).toBeCloseTo(12, 3);
      const size = output.getElementSize();
      const first = output.getElement(0, []);
      const last = output.getElement(output.getCount() - 1, []);
      for (let i = 0; i < size; i++) expect(last[i]).toBeCloseTo(first[i], 4);
    }
  });

  it('keeps the idle bob small: a few centimetres, under a degree', () => {
    const anim = doc.getRoot().listAnimations()[0];
    for (const channel of anim.listChannels()) {
      if (channel.getTargetNode()?.getName() !== 'Ship_Motion') continue;
      const out = channel.getSampler()?.getOutput();
      if (!out) continue;
      for (let i = 0; i < out.getCount(); i++) {
        const v = out.getElement(i, []);
        if (channel.getTargetPath() === 'translation') {
          expect(Math.abs(v[1])).toBeLessThan(0.08);
          expect(Math.abs(v[0])).toBeLessThan(1e-4);
        }
        if (channel.getTargetPath() === 'rotation') {
          // quaternion: the angle is 2 acos(w)
          expect(2 * Math.acos(Math.min(1, Math.abs(v[3])))).toBeLessThan((1 * Math.PI) / 180);
        }
      }
    }
  });

  it('agrees with the sim hull it is walked on', () => {
    const extras = node('TransportShip_ROOT').getExtras() as {
      transportShip: Record<string, unknown>;
    };
    const layout = extras.transportShip as {
      mainDeckY: number;
      captainDeckY: number;
      forecastleY: number;
      railHeight: number;
      length: number;
      beam: number;
      draft: number;
      gangwayPort: number[];
      gangwayStarboard: number[];
      gangwayWidth: number;
      masts: Record<string, number[]>;
    };
    const hull = EASTBROOK_FERRY_HULL;
    expect(layout.mainDeckY).toBeCloseTo(hull.mainDeckY, 6);
    expect(layout.captainDeckY).toBeCloseTo(hull.captainDeckY, 6);
    expect(layout.forecastleY).toBeCloseTo(hull.forecastleY, 6);
    expect(layout.railHeight).toBeCloseTo(hull.railHeight, 6);
    expect(layout.length).toBeCloseTo(hull.length, 6);
    expect(layout.beam).toBeCloseTo(hull.beam, 6);
    expect(layout.draft).toBeCloseTo(hull.draft, 6);
    const port = hull.boarding.find((b) => b.side === 'port');
    const starboard = hull.boarding.find((b) => b.side === 'starboard');
    expect(layout.gangwayPort).toEqual(
      [port?.x, port?.y, port?.z].map((v) => expect.closeTo(v ?? 0, 6)),
    );
    expect(layout.gangwayStarboard).toEqual(
      [starboard?.x, starboard?.y, starboard?.z].map((v) => expect.closeTo(v ?? 0, 6)),
    );
    expect(layout.gangwayWidth).toBeCloseTo(port?.width ?? 0, 6);
    const masts = hull.volumes.filter((v) => v.kind === 'mast');
    const byName: Record<string, string> = {
      MainMast: 'mast_main',
      SecondaryMast: 'mast_fore',
      MizzenMast: 'mast_mizzen',
    };
    for (const [name, [z, top]] of Object.entries(layout.masts)) {
      const vol = masts.find((m) => m.id === byName[name]);
      expect(vol?.z, name).toBeCloseTo(z, 6);
      expect(vol?.top, name).toBeCloseTo(top, 6);
    }
    // the sockets sit where the sim opens the gangways
    const socket = worldTranslation(node('Socket_Gangway_Port'));
    expect(socket[0]).toBeCloseTo(port?.x ?? 0, 4);
    expect(socket[1]).toBeCloseTo(port?.y ?? 0, 4);
    expect(socket[2]).toBeCloseTo(port?.z ?? 0, 4);
  });

  it('stands on the waterline, bow to +z, inside its footprint', () => {
    const scene = doc.getRoot().listScenes()[0];
    // the root is untransformed: the waterline centre is the origin
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const figure = worldTranslation(node('Socket_BowSplash'));
    const wake = worldTranslation(node('Socket_Wake'));
    expect(figure[2]).toBeGreaterThan(14);
    expect(wake[2]).toBeLessThan(-15);
    expect(figure[1]).toBeCloseTo(0, 6);
  });
});
