import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildHarbormasterGear,
  HARBORMASTER_GEAR_ASSETS,
  sourceFingerprint,
} from '../scripts/assets/harbormaster_gear/build.mjs';
import {
  boneFramePart,
  loadModularBody,
} from '../scripts/assets/harbormaster_gear/extract_reference.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  characterPreloadUrls,
  VISUALS,
  visibleAttachmentsForGraphics,
} from '../src/render/characters/manifest';

// Harbormaster Tamsin's worn sea gear (public/models/chars/npc_gear/), built from the Blender
// source by scripts/assets/harbormaster_gear/build.mjs: the tricorne and pipe on the head bone,
// the spyglass on the hips bone. Pins the bytes, the one identity root the game parents to the
// bone, the named parts, the texture-free vertex-coloured materials, the triangle budget, the
// source fingerprint, the fit against the modular body's measured head and coat, and the
// manifest wiring (every graphics tier loads and shows both). Re-pin the sha256 and size
// literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const SHIPPED: Record<string, { sha256: string; bytes: number }> = {
  'public/models/chars/npc_gear/harbormaster_tricorne.glb': {
    sha256: 'c02cc2676b5ec85cc050a3a9cb044760b670b8f5040b35caa252f841536acba5',
    bytes: 40512,
  },
  'public/models/chars/npc_gear/harbormaster_spyglass.glb': {
    sha256: '74aa429a1aed82725ab54ce8c9409f67075b213698b5277bc38c8fdc8e4f8df7',
    bytes: 11024,
  },
};
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = { Tricorne: 2022, Pipe: 180, Spyglass: 472 };

// The live modular body (public/models/chars/modular/warrior_modular.glb) in the gear's
// bone frames, by the same inverse-bind-matrix math the builder was fitted with
// (extract_reference.mjs): +y up the bone, +z the way she faces, +x her left. Derived, not
// copied, so a re-exported body or braid that no longer fits the shipped gear turns red.
interface Extent {
  lo: [number, number, number];
  hi: [number, number, number];
}
const body: Record<string, Extent> = {};
/** The coat's widest reach at each 0.05 band of hips-frame height. */
const coatHalfWidthByBand = new Map<number, number>();

function extentOf(parts: { positions: Float32Array }[]): Extent {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
  }
  return { lo, hi };
}

/** Every vertex of a shipped gear part in its model root's frame (quantization undone). */
function rootFrameVertices(n: GltfNode): [number, number, number][] {
  const out: [number, number, number][] = [];
  const walk = (m: GltfNode): void => {
    const w = m.getWorldMatrix();
    for (const prim of m.getMesh()?.listPrimitives() ?? []) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        out.push([
          w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12],
          w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13],
          w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14],
        ]);
      }
    }
    for (const child of m.listChildren()) walk(child);
  };
  walk(n);
  return out;
}

const docs = new Map<string, Document>();

function node(doc: Document, name: string): GltfNode {
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
  for (const asset of HARBORMASTER_GEAR_ASSETS) {
    docs.set(asset.target, await io.read(path.join(ROOT, asset.target)));
  }
  const modular = await loadModularBody(
    path.join(ROOT, 'public/models/chars/modular/warrior_modular.glb'),
  );
  for (const part of ['F_Head', 'H2_warriorbraid', 'F_Mouth_smile', 'F_Brow_thick']) {
    body[part] = extentOf(boneFramePart(modular, part, 'head'));
  }
  for (const { positions } of boneFramePart(modular, 'Armor_mage_Chest', 'hips')) {
    for (let i = 0; i < positions.length; i += 3) {
      const band = Math.floor(positions[i + 1] / 0.05);
      const reach = Math.abs(positions[i]);
      coatHalfWidthByBand.set(band, Math.max(coatHalfWidthByBand.get(band) ?? 0, reach));
    }
  }
}, 60_000);

describe('harbormaster gear GLBs', () => {
  it('ships the pinned bytes of both models, in the media manifest', () => {
    expect(HARBORMASTER_GEAR_ASSETS.map((a) => a.target).sort()).toEqual(
      Object.keys(SHIPPED).sort(),
    );
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      const bytes = readFileSync(path.join(ROOT, asset.target));
      expect(bytes.length, asset.target).toBe(SHIPPED[asset.target].bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.target).toBe(
        SHIPPED[asset.target].sha256,
      );
      expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
      const key = asset.target.replace(/^public\//, '');
      const base = path.basename(key, '.glb');
      expect(MEDIA_ASSETS[key]).toMatch(
        new RegExp(`^/media/models/chars/npc_gear/${base}\\.[0-9a-f]{12}\\.glb$`),
      );
    }
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain(
      "Harbormaster Tamsin's sea gear (`public/models/chars/npc_gear/harbormaster_tricorne.glb`",
    );
  });

  it('carries the live source fingerprint', () => {
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      expect(docs.get(asset.target)?.getRoot().getExtras(), asset.target).toMatchObject({
        authoring: 'Blender',
        sourceFingerprint: sourceFingerprint(asset),
      });
    }
  });

  it('holds one untransformed root per model, named for its bone, over its named parts', () => {
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      const doc = docs.get(asset.target) as Document;
      const top = doc.getRoot().listScenes()[0].listChildren();
      // characters/assets.ts flattenWeaponScene resets the lone child's position and
      // rotation: the root must already sit at the bone origin or the gear would jump
      expect(
        top.map((n) => n.getName()),
        asset.target,
      ).toEqual([asset.root]);
      expect(top[0].getTranslation()).toEqual([0, 0, 0]);
      expect(top[0].getRotation()).toEqual([0, 0, 0, 1]);
      expect(top[0].getScale()).toEqual([1, 1, 1]);
      expect(top[0].getExtras()).toMatchObject({
        harbormasterGear: { bone: asset.bone, up: [0, 1, 0], front: [0, 0, 1], left: [1, 0, 0] },
      });
      for (const part of asset.parts) {
        expect(node(doc, part).getParentNode()?.getName(), part).toBe(asset.root);
      }
    }
  });

  it('shares texture-free, vertex-coloured materials, and nothing skins or animates', () => {
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      const root = (docs.get(asset.target) as Document).getRoot();
      expect(
        root
          .listMaterials()
          .map((m) => m.getName())
          .sort(),
      ).toEqual(asset.materials);
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
        }
      }
    }
  });

  it('holds each part to its triangle budget', () => {
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      const doc = docs.get(asset.target) as Document;
      for (const part of asset.parts) {
        expect(trianglesUnder(node(doc, part)), part).toBe(TRIANGLES[part]);
      }
    }
  });

  it('rebuilds byte for byte from the committed Blender source', async () => {
    for (const asset of HARBORMASTER_GEAR_ASSETS) {
      const bytes = await buildHarbormasterGear(asset);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.target).toBe(
        SHIPPED[asset.target].sha256,
      );
    }
  });

  it('fits the live body: hat over the head and braid, pipe in the mouth, spyglass clear', () => {
    const [hat, glass] = HARBORMASTER_GEAR_ASSETS.map((a) => docs.get(a.target) as Document);
    const head = body.F_Head;
    const crest = body.H2_warriorbraid;
    const tricorne = getBounds(node(hat, 'Tricorne'));
    // wider than the head, its crown over the braid's crest, its brim down below the scalp's
    // top and above the brows, worn front point forward
    expect(tricorne.max[0]).toBeGreaterThan(head.hi[0] + 0.2);
    expect(tricorne.min[0]).toBeLessThan(head.lo[0] - 0.2);
    expect(tricorne.max[1]).toBeGreaterThan(crest.hi[1] + 0.05);
    expect(tricorne.min[1]).toBeLessThan(head.hi[1] - 0.2);
    expect(tricorne.max[2]).toBeGreaterThan(-tricorne.min[2]);
    // nothing of the hat sits low over her face: every vertex in front of the brows is
    // above their top
    const brows = body.F_Brow_thick;
    for (const [x, y, z] of rootFrameVertices(node(hat, 'Tricorne'))) {
      if (z > brows.lo[2] && Math.abs(x) < brows.hi[0]) expect(y).toBeGreaterThan(brows.hi[1]);
    }
    // the stem reaches into her mouth, on her right (-x), the bowl out in front
    const mouth = body.F_Mouth_smile;
    const pipe = getBounds(node(hat, 'Pipe'));
    expect(pipe.min[2]).toBeLessThan(mouth.hi[2]);
    expect(pipe.max[2]).toBeGreaterThan(mouth.hi[2] + 0.15);
    expect(pipe.max[0]).toBeLessThan(0);
    expect(pipe.max[1]).toBeGreaterThan(mouth.lo[1]);
    // the spyglass hangs on her left hip, below the hips bone, and every vertex of its
    // barrel (under the belt, y < 0.2) stands clear of the coat at its own height
    const spyglass = rootFrameVertices(node(glass, 'Spyglass'));
    expect(Math.min(...spyglass.map((v) => v[1]))).toBeLessThan(0);
    let checked = 0;
    for (const [x, y] of spyglass) {
      if (y >= 0.2) continue;
      const coat = coatHalfWidthByBand.get(Math.floor(y / 0.05));
      if (coat === undefined) continue;
      expect(x, `y ${y.toFixed(3)}`).toBeGreaterThan(coat);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('is what the harbormaster prop set wears, loaded and shown on every graphics tier', () => {
    const def = VISUALS.npc_modular_harbormaster;
    expect(def.modular).toBe(true);
    const wanted = HARBORMASTER_GEAR_ASSETS.map((a) => ({
      url: a.target.replace(/^public\//, ''),
      bone: a.bone,
    }));
    expect(def.attach).toEqual(wanted);
    // worn gear is cosmetic but never tier-shed: the attach list is the same everywhere
    expect(visibleAttachmentsForGraphics(def)).toEqual(wanted);
    // and both tiers' boot preload fetch it before the harbormaster can be drawn
    for (const standard of [true, false]) {
      const urls = characterPreloadUrls(standard);
      for (const { url } of wanted) expect(urls, url).toContain(url);
    }
  });
});
