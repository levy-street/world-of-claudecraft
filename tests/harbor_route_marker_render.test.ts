import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  activateGfxProfile,
  GFX,
  type GfxSettings,
  type GfxTier,
  getActiveGfxProfile,
  gfxInternalsForTest,
} from '../src/render/gfx';
import {
  buildHarborRouteMarker,
  buildHarborRouteMarkers,
  harborRouteMarkerInternalsForTest,
  harborRouteMarkerPrewarmParts,
} from '../src/render/harbor_route_markers';
import { HARBOR_ROUTE_MARKERS } from '../src/sim/content/harbor_route_markers';
import { harborRouteMarkerYaw } from '../src/sim/harbor_route_markers';
import { WORLD_SEED } from '../src/sim/world_seed';

// The harbor route marker painter (src/render/harbor_route_markers.ts) over the
// shipped GLB: which parts each graphics tier really draws, the two destination
// planes (never mirrored, standing proud of the board), the plate read from the
// model's anchor, a repaint (language switch, web font) that uploads a texture
// without touching a material, so no program ever relinks, and the plate canvas
// the live memory profile paints (its size and metrics from the core).

const internals = harborRouteMarkerInternalsForTest;
const GLB = path.join(__dirname, '..', 'public', internals.assetUrl.replace(/^\//, ''));
/** Triangles per part (tests/harbor_route_marker_asset.test.ts pins the same). */
const TRIS = {
  Post: 188,
  SignBoard: 164,
  MaritimeIcon: 728,
  MetalTrim: 668,
  OptionalLantern: 128,
  OptionalChain: 192,
  OptionalRope: 260,
};
const LOW = TRIS.Post + TRIS.SignBoard + TRIS.MaritimeIcon;
const MEDIUM = LOW + TRIS.MetalTrim;
const HIGH = MEDIUM + TRIS.OptionalLantern + TRIS.OptionalChain + TRIS.OptionalRope;
/** Two triangles per text face would be a rectangle; the clipped plate is an 8-fan. */
const PLATE_TRIS = 8;

let gltf: GLTF;
const originalProfile = getActiveGfxProfile();
const realDocument = (globalThis as { document?: unknown }).document;

/** One call or property write on a plate's 2D context. */
interface PaintCall {
  op: string;
  args: unknown[];
}
interface FakeCanvas {
  width: number;
  height: number;
  paintLog: PaintCall[];
  getContext(): unknown;
}

/** A 2D context that logs every call and property write, and measures a name
 *  0.6 font px wide per letter at the font last set. */
function fakeContext(log: PaintCall[]): unknown {
  let fontPx = 10;
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'measureText') return (s: string) => ({ width: s.length * fontPx * 0.6 });
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args: unknown[]) => {
          log.push({ op: String(key), args });
        };
      },
      set(_t, key, value) {
        if (key === 'font') fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(String(value))?.[1]);
        log.push({ op: `${String(key)}=`, args: [value] });
        return true;
      },
    },
  );
}

function fakeCanvas(): FakeCanvas {
  const paintLog: PaintCall[] = [];
  return { width: 0, height: 0, paintLog, getContext: () => fakeContext(paintLog) };
}

function withTier(tier: GfxTier): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, effectsTier: tier } });
  internals.setLoadedGltfForTest(gltf);
}

function triangles(root: THREE.Object3D, skipText = true): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (skipText && mesh.name === 'DestinationText')) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(GLB);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
  (globalThis as { document?: unknown }).document = {
    createElement: fakeCanvas,
    addEventListener() {},
  };
  internals.clearPlatesForTest();
});

afterEach(() => {
  activateGfxProfile(originalProfile);
});

afterAll(() => {
  internals.setLoadedGltfForTest(null);
  internals.clearPlatesForTest();
  (globalThis as { document?: unknown }).document = realDocument;
});

describe('harbor route marker painter: tiers', () => {
  it('draws the post, board and roundel on low, adds the trim on medium, the dressing from high', () => {
    for (const [tier, want] of [
      ['low', LOW],
      ['medium', MEDIUM],
      ['high', HIGH],
      ['ultra', HIGH],
    ] as const) {
      withTier(tier);
      const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[0], WORLD_SEED);
      expect(triangles(sign), tier).toBe(want);
      // the lantern is the only glowing part: low and medium draw no glow at all
      const glows = new Set<THREE.Material>();
      sign.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (m.emissive?.getHex() ?? 0) !== 0) glows.add(m);
      });
      expect(glows.size, tier).toBe(tier === 'low' || tier === 'medium' ? 0 : 1);
    }
  });

  it('keeps both destination faces on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      withTier(tier);
      const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[1], WORLD_SEED);
      const faces = sign.children.filter((c) => c.name === 'DestinationText');
      expect(faces, tier).toHaveLength(2);
    }
  });
});

describe('harbor route marker painter: the destination planes', () => {
  it('reads the plate from the model anchor, unrotated, with all its fields', () => {
    const anchor = gltf.scene.getObjectByName('DestinationTextAnchor');
    if (!anchor) throw new Error('no anchor');
    expect(anchor.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(gltf.scene.getObjectByName('HarborRouteMarker_ROOT')?.quaternion.w).toBeCloseTo(1, 9);
    const plate = anchor.userData.destinationText as Record<string, number>;
    for (const key of ['width', 'height', 'corner', 'faceOffset', 'textWidth', 'textHeight']) {
      expect(typeof plate[key], key).toBe('number');
    }
    withTier('high');
    const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[2], WORLD_SEED);
    const [front, back] = sign.children.filter((c) => c.name === 'DestinationText') as THREE.Mesh[];
    // the planes stand where the model says, at its offset (never the fallback)
    expect(front.position.z).toBeCloseTo(plate.faceOffset, 6);
    expect(back.position.z).toBeCloseTo(-plate.faceOffset, 6);
    expect(front.position.x).toBeCloseTo(anchor.position.x, 6);
    expect(front.position.y).toBeCloseTo(anchor.position.y, 6);
    const g = front.geometry;
    g.computeBoundingBox();
    const box = g.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(plate.width, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(plate.height, 6);
    expect((g.index?.count ?? 0) / 3).toBe(PLATE_TRIS);
  });

  it('never mirrors a face: positive scale, the back turned half a turn to face out behind', () => {
    withTier('high');
    const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[3], WORLD_SEED);
    expect(sign.scale.x * sign.scale.y * sign.scale.z).toBeGreaterThan(0);
    const [front, back] = sign.children.filter((c) => c.name === 'DestinationText');
    for (const face of [front, back]) {
      expect(face.scale.x).toBeGreaterThan(0);
      expect(face.scale.y).toBeGreaterThan(0);
      expect(face.scale.z).toBeGreaterThan(0);
    }
    const out = (o: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyEuler(o.rotation);
    const reading = (o: THREE.Object3D) => new THREE.Vector3(1, 0, 0).applyEuler(o.rotation);
    expect(out(front).z).toBeCloseTo(1, 9);
    expect(out(back).z).toBeCloseTo(-1, 9);
    // seen from behind the board, the back face's lettering runs toward the tail
    expect(reading(back).x).toBeCloseTo(-1, 9);
  });

  it('stands both planes proud of the board over the whole plate (no z-fight, never buried)', () => {
    const anchor = gltf.scene.getObjectByName('DestinationTextAnchor');
    const board = gltf.scene.getObjectByName('SignBoard');
    if (!anchor || !board) throw new Error('missing nodes');
    const plate = anchor.userData.destinationText as {
      width: number;
      height: number;
      faceOffset: number;
    };
    gltf.scene.updateMatrixWorld(true);
    let deepest = 0;
    let seen = 0;
    const v = new THREE.Vector3();
    board.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x - anchor.position.x) > plate.width / 2) continue;
        if (Math.abs(v.y - anchor.position.y) > plate.height / 2) continue;
        deepest = Math.max(deepest, Math.abs(v.z));
        seen++;
      }
    });
    expect(seen).toBeGreaterThan(8);
    expect(plate.faceOffset - deepest).toBeGreaterThan(0.002);
  });

  it('turns the whole sign so its arrow meets the berth yaw, one per berth', () => {
    withTier('high');
    const all = buildHarborRouteMarkers(WORLD_SEED);
    expect(all.children).toHaveLength(HARBOR_ROUTE_MARKERS.length);
    all.children.forEach((sign, i) => {
      expect(sign.rotation.y).toBeCloseTo(harborRouteMarkerYaw(HARBOR_ROUTE_MARKERS[i]), 9);
      expect(sign.position.x).toBe(HARBOR_ROUTE_MARKERS[i].x);
      expect(sign.position.z).toBe(HARBOR_ROUTE_MARKERS[i].z);
    });
  });
});

describe('harbor route marker painter: repaint and prewarm', () => {
  it('repaints a texture upload only: no material or program change', () => {
    withTier('high');
    const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[0], WORLD_SEED);
    const text = sign.children.find((c) => c.name === 'DestinationText') as THREE.Mesh;
    const material = text.material as THREE.MeshStandardMaterial;
    const map = material.map as THREE.Texture;
    const matVersion = material.version;
    const texVersion = map.version;
    internals.repaintAll();
    expect(material.version).toBe(matVersion);
    expect(map.version).toBeGreaterThan(texVersion);
  });

  it('hands the props prewarm every program a marker draws, the plate included', () => {
    withTier('high');
    const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[0], WORLD_SEED);
    const parts = harborRouteMarkerPrewarmParts();
    const drawn = new Set<THREE.Material>();
    sign.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) drawn.add((o as THREE.Mesh).material as THREE.Material);
    });
    const warmed = new Set(parts.map((p) => p.material));
    // the plates differ only by their map texture: one plate program covers all four
    for (const m of drawn) {
      const plate = (m as THREE.MeshStandardMaterial).map;
      if (plate) expect([...warmed].some((w) => (w as THREE.MeshStandardMaterial).map)).toBe(true);
      else expect(warmed.has(m)).toBe(true);
    }
  });
});

describe('harbor route marker painter: the plate canvas per memory profile', () => {
  /** A fresh plate for the Drakelands berth's destination under `settings`. */
  function paintedPlate(settings: GfxSettings): FakeCanvas {
    activateGfxProfile({ ...originalProfile, settings });
    internals.setLoadedGltfForTest(gltf);
    internals.clearPlatesForTest();
    const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[2], WORLD_SEED);
    const text = sign.children.find((c) => c.name === 'DestinationText') as THREE.Mesh;
    const map = (text.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture;
    return map.image as unknown as FakeCanvas;
  }
  const calls = (canvas: FakeCanvas, op: string) =>
    canvas.paintLog.filter((c) => c.op === op).map((c) => c.args);

  afterAll(() => internals.clearPlatesForTest());

  it('paints 1024x340 with the authored metrics off the iOS memory profile', () => {
    for (const hints of [undefined, { platform: 'android' as const }]) {
      const canvas = paintedPlate(gfxInternalsForTest.settingsFor('high', hints));
      const at = JSON.stringify(hints ?? null);
      expect([canvas.width, canvas.height], at).toEqual([1024, 340]);
      expect(calls(canvas, 'lineWidth='), at).toEqual([[6]]);
      expect(calls(canvas, 'strokeRect'), at).toEqual([[22, 22, 980, 296]]);
      // the lift then the ink, both squeezed to the same text box
      const [lift, ink] = calls(canvas, 'fillText');
      expect(lift.slice(1), at).toEqual([514, 173, 1024 * 0.9]);
      expect(ink.slice(1), at).toEqual([512, 170, 1024 * 0.9]);
      // "The Drakelands" fits from 211 px down in steps of 4
      const fonts = calls(canvas, 'font=').map(([f]) => Number(/(\d+)px/.exec(String(f))?.[1]));
      expect(fonts[0], at).toBe(211);
      expect(fonts[1] - fonts[0], at).toBe(-4);
      expect(fonts.at(-1), at).toBe(107);
    }
  });

  it('paints 512x170 with every metric halved on the iOS memory profile, tight rung included', () => {
    for (const hints of [
      { platform: 'ios' as const },
      { platform: 'ios' as const, tightMemory: true },
    ]) {
      const canvas = paintedPlate(gfxInternalsForTest.settingsFor('high', hints));
      const at = JSON.stringify(hints);
      expect([canvas.width, canvas.height], at).toEqual([512, 170]);
      expect(calls(canvas, 'lineWidth='), at).toEqual([[3]]);
      expect(calls(canvas, 'strokeRect'), at).toEqual([[11, 11, 490, 148]]);
      const [lift, ink] = calls(canvas, 'fillText');
      expect(lift.slice(1), at).toEqual([257, 86.5, 512 * 0.9]);
      expect(ink.slice(1), at).toEqual([256, 85, 512 * 0.9]);
      // the same name fits the same share of the plate: half the font, steps of 2
      const fonts = calls(canvas, 'font=').map(([f]) => Number(/(\d+)px/.exec(String(f))?.[1]));
      expect(fonts[0], at).toBe(105);
      expect(fonts[1] - fonts[0], at).toBe(-2);
      expect(fonts.at(-1), at).toBe(53);
    }
  });

  it('paints the name on every tier on the iOS memory profile, at the half size', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      for (const hints of [
        { platform: 'ios' as const },
        { platform: 'ios' as const, tightMemory: true },
      ]) {
        const canvas = paintedPlate(gfxInternalsForTest.settingsFor(tier, hints));
        const at = `${tier} ${JSON.stringify(hints)}`;
        expect([canvas.width, canvas.height], at).toEqual([512, 170]);
        // the lift and the ink, both carrying the destination name
        const fills = calls(canvas, 'fillText');
        expect(fills, at).toHaveLength(2);
        for (const [text] of fills)
          expect(text, at).toBe(internals.destinationLabel(HARBOR_ROUTE_MARKERS[2].destination));
      }
    }
  });

  it('keeps the texture settings on both sizes', () => {
    for (const hints of [undefined, { platform: 'ios' as const }]) {
      paintedPlate(gfxInternalsForTest.settingsFor('high', hints));
      const sign = buildHarborRouteMarker(HARBOR_ROUTE_MARKERS[2], WORLD_SEED);
      const text = sign.children.find((c) => c.name === 'DestinationText') as THREE.Mesh;
      const map = (text.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture;
      const at = JSON.stringify(hints ?? null);
      expect(map.colorSpace, at).toBe(THREE.SRGBColorSpace);
      expect(map.generateMipmaps, at).toBe(true);
      expect(map.minFilter, at).toBe(THREE.LinearMipmapLinearFilter);
      expect(map.anisotropy, at).toBe(4);
    }
  });

  it('takes the canvas size and every paint metric from the core, never its own literals', () => {
    const painter = readFileSync(
      path.join(__dirname, '../src/render/harbor_route_markers.ts'),
      'utf8',
    );
    expect(painter).toContain('harborRouteMarkerPlateCanvasSize(GFX)');
    expect(painter).toContain('harborRouteMarkerPlatePaint(h)');
    expect(painter).toContain('harborRouteMarkerPlateFontPx(');
    const paint = painter.slice(
      painter.indexOf('function paintPlate('),
      painter.indexOf('function repaintAll('),
    );
    expect(paint).not.toMatch(/lineWidth = \d|strokeRect\(\d|[-+] \d+,|size -= |> \d/);
    expect(painter).not.toMatch(/\b(1024|340|512|170)\b/);
  });
});
