// The Eastbrook market stall's canopy repaint (src/render/eastbrook_stall_canopy_core.ts,
// applied by the town extraction in src/render/eastbrook_town.ts). Pinned here:
//  - the core: every canopy variant the layout names has a colour, a missing or
//    unknown variant falls back to the default, only the stall model is keyed by
//    variant, and a canopy vertex needs BOTH a canvas surface and the height;
//  - the shipped GLB still carries the premise the repaint rests on: above the
//    height line its only canvas is the three flag panels, below it only the
//    counter's cream sack, with a clear gap either side of the line;
//  - the extraction of the real GLB: every canopy vertex takes its variant's
//    colour on the one canopy cell, no flag colour survives anywhere, and nothing
//    else in the model changes between variants;
//  - a Studio-placed copy (town_styled_placed_assets.ts) draws the default canopy.
// The town view's per-stall variants are pinned in tests/eastbrook_town_renderer.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const atlas = vi.hoisted(() => ({ texture: undefined as unknown }));
vi.mock('../src/render/eastbrook_surface_atlas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/eastbrook_surface_atlas')>()),
  eastbrookSurfaceAtlasTexture: () => atlas.texture,
}));

const {
  EASTBROOK_STALL_ASSET_URL,
  isStallCanopyVertex,
  STALL_CANOPY_COLORS,
  STALL_CANOPY_DEFAULT_VARIANT,
  STALL_CANOPY_MIN_Y,
  STALL_CANOPY_SEMANTIC,
  stallCanopyColor,
  stallCanopyVariant,
  stallTemplateKey,
} = await import('../src/render/eastbrook_stall_canopy_core');
const { EASTBROOK_SURFACE_ATLAS_COLUMNS, EASTBROOK_SURFACE_CELLS, eastbrookTownSemanticForColor } =
  await import('../src/render/eastbrook_surface_atlas');
const { eastbrookTownInternalsForTest } = await import('../src/render/eastbrook_town');
const { townStyledPlacedTemplate } = await import('../src/render/town_styled_placed_assets');

// The flag the model paints (scripts/assets/eastbrook_town/shared.js TOWN_PALETTE).
const CLOTH_BLUE = 0x315b9d;
const CLOTH_CREAM = 0xd6c29d;
const CLOTH_RED = 0xaa4c39;

async function loadShippedStall(): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(
    path.join(__dirname, '..', 'public', EASTBROOK_STALL_ASSET_URL.replace(/^\//, '')),
  );
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

/** Whether a working-space (linear) colour is the sRGB hex, within the two
 *  steps of 8-bit rounding the GLB's normalized colours carry. */
function isHex(r: number, g: number, b: number, hex: number): boolean {
  const actual = new THREE.Color().setRGB(r, g, b).getHex();
  return [16, 8, 0].every(
    (shift) => Math.abs(((actual >> shift) & 0xff) - ((hex >> shift) & 0xff)) <= 2,
  );
}

/** Whether a working-space colour is exactly the canopy colour a variant paints. */
function isCanopy(r: number, g: number, b: number, canopy: THREE.Color): boolean {
  return (
    Math.abs(r - canopy.r) < 1e-6 && Math.abs(g - canopy.g) < 1e-6 && Math.abs(b - canopy.b) < 1e-6
  );
}

describe('stall canopy core', () => {
  it('colours every canopy variant the layout names', () => {
    const named = new Set(EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.canopyVariant));
    expect(named.size).toBeGreaterThan(1);
    for (const variant of named) {
      expect(Object.hasOwn(STALL_CANOPY_COLORS, variant), variant).toBe(true);
      expect(stallCanopyVariant(variant)).toBe(variant);
      expect(stallCanopyColor(variant)).toBe(STALL_CANOPY_COLORS[stallCanopyVariant(variant)]);
    }
    // Two stalls, two colours: the square never draws the same stall twice.
    expect(new Set([...named].map((variant) => stallCanopyColor(variant))).size).toBe(named.size);
  });

  it('falls back to the default canopy for a missing or unknown variant', () => {
    expect(Object.hasOwn(STALL_CANOPY_COLORS, STALL_CANOPY_DEFAULT_VARIANT)).toBe(true);
    for (const variant of [undefined, '', 'blue', 'toString', '__proto__']) {
      expect(stallCanopyVariant(variant), String(variant)).toBe(STALL_CANOPY_DEFAULT_VARIANT);
      expect(stallCanopyColor(variant)).toBe(STALL_CANOPY_COLORS[STALL_CANOPY_DEFAULT_VARIANT]);
    }
  });

  it('keys only the stall model by canopy variant', () => {
    expect(stallTemplateKey(EASTBROOK_STALL_ASSET_URL, 'green')).toBe(
      `${EASTBROOK_STALL_ASSET_URL}#canopy=green`,
    );
    expect(stallTemplateKey(EASTBROOK_STALL_ASSET_URL, 'gold')).not.toBe(
      stallTemplateKey(EASTBROOK_STALL_ASSET_URL, 'green'),
    );
    expect(stallTemplateKey(EASTBROOK_STALL_ASSET_URL, undefined)).toBe(
      stallTemplateKey(EASTBROOK_STALL_ASSET_URL, STALL_CANOPY_DEFAULT_VARIANT),
    );
    expect(stallTemplateKey('/models/props/fenbridge_provision_stall.glb', 'green')).toBe(
      '/models/props/fenbridge_provision_stall.glb',
    );
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      expect(stall.assetId).toBe(EASTBROOK_STALL_ASSET_URL);
    }
  });

  it('needs both a canvas surface and the canopy height', () => {
    expect(isStallCanopyVertex('blueCreamCanvas', STALL_CANOPY_MIN_Y)).toBe(true);
    expect(isStallCanopyVertex('redCreamCanvas', STALL_CANOPY_MIN_Y + 0.5)).toBe(true);
    expect(isStallCanopyVertex('blueCreamCanvas', STALL_CANOPY_MIN_Y - 0.01)).toBe(false);
    expect(isStallCanopyVertex('warmGoldMetal', STALL_CANOPY_MIN_Y + 0.5)).toBe(false);
    expect(isStallCanopyVertex('verticalDarkTimber', STALL_CANOPY_MIN_Y + 0.5)).toBe(false);
  });
});

describe('the shipped stall model', () => {
  it('has only the three flag panels as canvas above the canopy line, only the sack below', async () => {
    const stall = await loadShippedStall();
    stall.updateMatrixWorld(true);
    const above = new Set<number>();
    const below = new Set<number>();
    let lowestCanopy = Number.POSITIVE_INFINITY;
    let highestSack = Number.NEGATIVE_INFINITY;
    const point = new THREE.Vector3();
    stall.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const position = mesh.geometry.getAttribute('position');
      const color = mesh.geometry.getAttribute('color');
      if (!color) return;
      for (let index = 0; index < position.count; index++) {
        const r = color.getX(index) * material.color.r;
        const g = color.getY(index) * material.color.g;
        const b = color.getZ(index) * material.color.b;
        const semantic = eastbrookTownSemanticForColor(r, g, b);
        if (semantic !== 'blueCreamCanvas' && semantic !== 'redCreamCanvas') continue;
        point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        const hex = [CLOTH_BLUE, CLOTH_CREAM, CLOTH_RED].find((cloth) => isHex(r, g, b, cloth));
        expect(hex, `canvas vertex off the flag palette at y ${point.y}`).toBeDefined();
        if (point.y >= STALL_CANOPY_MIN_Y) {
          above.add(hex as number);
          lowestCanopy = Math.min(lowestCanopy, point.y);
        } else {
          below.add(hex as number);
          highestSack = Math.max(highestSack, point.y);
        }
      }
    });
    expect([...above].sort()).toEqual([CLOTH_BLUE, CLOTH_CREAM, CLOTH_RED].sort());
    expect([...below]).toEqual([CLOTH_CREAM]);
    // A clear gap both sides of the line, so a re-export that moves the
    // canopy or the counter goods trips here rather than repainting a sack.
    expect(lowestCanopy).toBeGreaterThan(STALL_CANOPY_MIN_Y + 0.15);
    expect(highestSack).toBeLessThan(STALL_CANOPY_MIN_Y - 0.15);
  });
});

describe('the town extraction of the shipped stall', () => {
  const cell = EASTBROOK_SURFACE_CELLS[STALL_CANOPY_SEMANTIC];
  const cellSize = 1 / EASTBROOK_SURFACE_ATLAS_COLUMNS;
  const cellU = (cell % EASTBROOK_SURFACE_ATLAS_COLUMNS) * cellSize;
  const cellV = 1 - (Math.floor(cell / EASTBROOK_SURFACE_ATLAS_COLUMNS) + 1) * cellSize;

  async function templateOf(variant: string | undefined) {
    return eastbrookTownInternalsForTest.extractTemplate(
      await loadShippedStall(),
      EASTBROOK_STALL_ASSET_URL,
      variant,
    );
  }

  async function opaqueOf(variant: string | undefined): Promise<THREE.BufferGeometry> {
    const template = await templateOf(variant);
    if (!template.opaque) throw new Error('the stall template has no opaque geometry');
    return template.opaque;
  }

  it('repaints every canopy vertex in its variant colour on the one canopy cell', async () => {
    for (const variant of ['gold', 'green'] as const) {
      const geometry = await opaqueOf(variant);
      const position = geometry.getAttribute('position');
      const color = geometry.getAttribute('color');
      const uv = geometry.getAttribute('uv');
      const canopy = new THREE.Color(STALL_CANOPY_COLORS[variant]);
      let canopyVertices = 0;
      let sackVertices = 0;
      for (let index = 0; index < position.count; index++) {
        const r = color.getX(index);
        const g = color.getY(index);
        const b = color.getZ(index);
        const label = `${variant} vertex ${index} at y ${position.getY(index)}`;
        // No flag colour survives anywhere: blue and red were canopy only.
        expect(isHex(r, g, b, CLOTH_BLUE), label).toBe(false);
        expect(isHex(r, g, b, CLOTH_RED), label).toBe(false);
        if (isHex(r, g, b, CLOTH_CREAM)) {
          // The counter's cream sack keeps its cream; the cream panel does not.
          expect(position.getY(index), label).toBeLessThan(STALL_CANOPY_MIN_Y);
          sackVertices++;
        }
        if (!isCanopy(r, g, b, canopy)) continue;
        canopyVertices++;
        expect(position.getY(index), label).toBeGreaterThanOrEqual(STALL_CANOPY_MIN_Y);
        // On the canopy cell, never the red panel's old one: the stripes run on
        // unbroken across the three panels.
        expect(uv.getX(index), label).toBeGreaterThanOrEqual(cellU);
        expect(uv.getX(index), label).toBeLessThanOrEqual(cellU + cellSize);
        expect(uv.getY(index), label).toBeGreaterThanOrEqual(cellV);
        expect(uv.getY(index), label).toBeLessThanOrEqual(cellV + cellSize);
      }
      // At least every corner of the three tilted sheets (24 each, none shared);
      // the valances hang level, so the extraction merges the corners two of
      // them now share across a seam.
      expect(canopyVertices, variant).toBeGreaterThanOrEqual(3 * 24);
      expect(sackVertices, variant).toBeGreaterThan(0);
    }
  });

  it("leaves the stall's glow (lantern, crystal) alone in every variant", async () => {
    const gold = (await templateOf('gold')).emissive;
    const green = (await templateOf('green')).emissive;
    if (!gold || !green) throw new Error('the stall template has no emissive geometry');
    for (const name of ['position', 'normal', 'uv', 'color'] as const) {
      expect(Array.from(green.getAttribute(name).array), name).toEqual(
        Array.from(gold.getAttribute(name).array),
      );
    }
    const color = gold.getAttribute('color');
    for (const variant of ['gold', 'green'] as const) {
      const canopy = new THREE.Color(STALL_CANOPY_COLORS[variant]);
      for (let index = 0; index < color.count; index++) {
        expect(isCanopy(color.getX(index), color.getY(index), color.getZ(index), canopy)).toBe(
          false,
        );
      }
    }
  });

  it('changes nothing but the canopy colour between variants', async () => {
    const gold = await opaqueOf('gold');
    const green = await opaqueOf('green');
    expect(Array.from(green.getIndex()?.array ?? [])).toEqual(
      Array.from(gold.getIndex()?.array ?? []),
    );
    for (const name of ['position', 'normal', 'uv'] as const) {
      expect(Array.from(green.getAttribute(name).array), name).toEqual(
        Array.from(gold.getAttribute(name).array),
      );
    }
    const goldColor = gold.getAttribute('color');
    const greenColor = green.getAttribute('color');
    const goldCanopy = new THREE.Color(STALL_CANOPY_COLORS.gold);
    let differing = 0;
    for (let index = 0; index < goldColor.count; index++) {
      const same =
        goldColor.getX(index) === greenColor.getX(index) &&
        goldColor.getY(index) === greenColor.getY(index) &&
        goldColor.getZ(index) === greenColor.getZ(index);
      const goldPainted = isCanopy(
        goldColor.getX(index),
        goldColor.getY(index),
        goldColor.getZ(index),
        goldCanopy,
      );
      expect(same, `vertex ${index}`).toBe(!goldPainted);
      if (!same) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });

  it('draws the default canopy when no variant is named', async () => {
    const fallback = await opaqueOf(undefined);
    const named = await opaqueOf(STALL_CANOPY_DEFAULT_VARIANT);
    const color = fallback.getAttribute('color');
    const canopy = new THREE.Color(STALL_CANOPY_COLORS[STALL_CANOPY_DEFAULT_VARIANT]);
    let painted = 0;
    for (let index = 0; index < color.count; index++) {
      if (isCanopy(color.getX(index), color.getY(index), color.getZ(index), canopy)) painted++;
    }
    expect(painted).toBeGreaterThanOrEqual(3 * 24);
    expect(Array.from(color.array)).toEqual(Array.from(named.getAttribute('color').array));
  });

  it('gives a Studio-placed copy the default canopy', async () => {
    atlas.texture = new THREE.Texture();
    try {
      const placed = townStyledPlacedTemplate(EASTBROOK_STALL_ASSET_URL, await loadShippedStall());
      if (!placed) throw new Error('the placed stall declined with its atlas loaded');
      const canopy = new THREE.Color(stallCanopyColor(undefined));
      let painted = 0;
      placed.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const color = mesh.geometry.getAttribute('color');
        for (let index = 0; index < color.count; index++) {
          const [r, g, b] = [color.getX(index), color.getY(index), color.getZ(index)];
          expect(isHex(r, g, b, CLOTH_RED)).toBe(false);
          if (isCanopy(r, g, b, canopy)) painted++;
        }
      });
      expect(painted).toBeGreaterThanOrEqual(3 * 24);
    } finally {
      atlas.texture = undefined;
    }
  });
});
