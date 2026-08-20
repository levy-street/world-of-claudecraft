// The boot twins for the ground-decor pools nothing else warms: the grass
// cards (both `cap:` program arms), the ground flowers and the night-accent
// glow caps.
//
// The measured defect (production capture 2026-08-18): the last three cold
// links before the entry curtain lifted were `grass-card|cap:NN.NNN-NN.NNN|`
// (565.8 ms), `grass-card|cap:none|` (66.0 ms) and the `night-accents`
// instanced glow (207.4 ms). The grass ring builds its chunk InstancedMeshes
// per frame as you walk, and the night group is created hidden while the boot
// compile unit collects the scene with traverseVisible, so no compile root ever
// reached any of them. The same grass pair had escaped into LIVE frames on the
// day before's capture, on both GPUs.
//
// The cap arms are enumerated from the tier table in gfx.ts and composed
// through the same `grassCardProgramCacheKey` the live material uses: a hand
// list here would go stale the day a tier changes its carpet radius, and the
// twin set would silently stop covering an arm the game still draws.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foliageGrassInternalsForTest } from '../src/render/foliage';
import {
  type GrassCapCollapseBand,
  grassCapCollapseBand,
  grassCardCapKey,
  grassCardProgramCacheKey,
} from '../src/render/grass_cap_collapse_core';
import {
  buildGroundDecorPrewarmTwins,
  clearGroundDecorPrewarmDraws,
  type GroundDecorPrewarmDraw,
  groundDecorPrewarmDraws,
  groundDecorPrewarmKey,
  registerGroundDecorPrewarmDraw,
} from '../src/render/ground_decor_prewarm';
import { buildNightAccents, nightAccentGlowMaterial } from '../src/render/night_accents';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

/**
 * Every registration as it happens, in order. The registry itself folds two
 * draws that share a program key onto one entry, and on a plain Node tier the
 * grass card and the flower card DO share one (no cap band, the same merged
 * two-quad shape), so reading the registry back cannot say whether the flower
 * arm was published at all. This records the calls instead, which is the only
 * observable that survives the fold.
 */
const registrations = vi.hoisted(() => [] as GroundDecorPrewarmDraw[]);

vi.mock('../src/render/ground_decor_prewarm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/ground_decor_prewarm')>();
  return {
    ...actual,
    registerGroundDecorPrewarmDraw: (draw: GroundDecorPrewarmDraw): void => {
      registrations.push(draw);
      actual.registerGroundDecorPrewarmDraw(draw);
    },
  };
});

/** Sources are read comment-STRIPPED: every pin below names a line of code that
 *  is explained in prose right beside itself, so a raw read would stay green
 *  over a commented-out registration. */
const sourceOf = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(`../src/render/${path}`, import.meta.url), 'utf8'));

/**
 * Every blade-carpet radius the tier table can hand `grassCapCollapseBand`,
 * read off gfx.ts rather than copied: the live grass material is built with
 * `grassCapCollapseBand(GFX.bladeCarpetRadius)`, so these ARE the cap arms the
 * game produces (the ios/lean arms land on 0, i.e. the `none` arm).
 */
function carpetRadiiFromSource(): number[] {
  const matches = sourceOf('gfx.ts').matchAll(/bladeCarpetRadius:\s*(\d+(?:\.\d+)?)/g);
  return [...new Set([...matches].map((m) => Number(m[1])))];
}

function capArmsFromSource(): { key: string; band: GrassCapCollapseBand | null }[] {
  const arms = new Map<string, GrassCapCollapseBand | null>();
  for (const radius of carpetRadiiFromSource()) {
    const band = grassCapCollapseBand(radius);
    arms.set(grassCardCapKey(band), band);
  }
  return [...arms].map(([key, band]) => ({ key, band }));
}

/** A grass-card material in the live shape: the tuft sheet, the cutout, the
 *  double-sided card, and the cache key composed through the live composer. */
function grassCardMaterial(band: GrassCapCollapseBand | null): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    alphaTest: 0.3,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const baseProgramKey = mat.customProgramCacheKey();
  const key = grassCardProgramCacheKey(band, baseProgramKey);
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** The merged tuft card geometry's attribute shape (position + uv, normals
 *  deleted, the cap tag on the arms that collapse). */
function cardGeometry(withCapAttribute: boolean): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.deleteAttribute('normal');
  if (withCapAttribute) {
    const count = geo.getAttribute('position').count;
    geo.setAttribute('aCap', new THREE.Uint8BufferAttribute(new Uint8Array(count), 1));
  }
  return geo;
}

beforeEach(() => {
  clearGroundDecorPrewarmDraws();
  registrations.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The procedural grass/firefly sheets are drawn on a 2D canvas, which a plain
 *  Node run has none of (same stub shape as tests/ability_vfx_prewarm.test.ts).
 *  `getContext` answers only for '2d': gfx.ts probes for a WebGL context and
 *  must keep getting none. */
function installCanvasStub(): void {
  const noop = (): void => {};
  const gradient = { addColorStop: noop };
  const named: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    measureText: () => ({ width: 0 }),
  };
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (state, prop) => named[prop as string] ?? (prop in state ? state[prop] : noop),
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: (kind: string) => (kind === '2d' ? context : null),
    }),
  });
}

describe('the real pools publish themselves (the twins=0 floor)', () => {
  // Every other case here registers its own draws, so all of them would still
  // pass over a manifest the LIVE builders never fill: a boot with zero twins
  // is exactly the defect this module exists to prevent. This one runs the
  // real ring build and the real night-accent build and reads the registry
  // back.
  it('registers the grass card and the night-accent glow at build time', () => {
    installCanvasStub();
    buildNightAccents(7);
    let frameMs = 0;
    foliageGrassInternalsForTest.buildGrassRing(new THREE.Group(), 42, () => (frameMs += 1));

    const draws = groundDecorPrewarmDraws();
    expect(draws.length).toBeGreaterThanOrEqual(2);
    const signatures = draws.map((draw) => materialProgramSignature(draw.material));
    // The grass card's key is composed through grassCardProgramCacheKey, so a
    // cap arm is the proof the LIVE material (not a lookalike) was published.
    expect(signatures.filter((signature) => signature.includes('cap:')).length).toBeGreaterThan(0);
    expect(
      signatures.filter((signature) => signature.startsWith('MeshBasicMaterial|')).length,
    ).toBeGreaterThan(0);
    // Every published draw becomes a twin: a registry that fills but builds
    // nothing warms nothing.
    expect(buildGroundDecorPrewarmTwins()).toHaveLength(draws.length);
    for (const draw of draws) expect(draw.instanceColor).toBe(true);
  });

  it('publishes the FLOWER palettes at ring build too, before any chunk exists', () => {
    // The flower material is minted lazily, per biome palette, by the chunk
    // builder's flowerMatFor. The ring primes every palette up front, and that
    // is what puts the flower program in the boot twin set: without it the
    // first palette is minted long after buildFoliageMaterialPrewarmGroup ran,
    // and its program links in whatever frame the walk reaches that biome.
    installCanvasStub();
    let frameMs = 0;
    const ring = foliageGrassInternalsForTest.buildGrassRing(
      new THREE.Group(),
      42,
      () => (frameMs += 1),
    );
    // No chunk was ever built: update() is what builds them, and it has not
    // run. So every registration below happened at BUILD time.
    expect(ring.perfStats().grassBuiltChunks).toBe(0);
    expect(ring.perfStats().grassChunks).toBe(0);

    // The card and the flower card are two distinct geometries, whatever the
    // tier's cap arm folds their program keys into.
    const geometries = new Set(registrations.map((draw) => draw.geometry));
    const materials = new Set(registrations.map((draw) => draw.material));
    expect(registrations.length).toBeGreaterThanOrEqual(2);
    expect(geometries.size).toBeGreaterThanOrEqual(2);
    // One material per palette, all published before the first chunk: a lazy
    // registration would leave exactly one material here (the card's).
    expect(materials.size).toBeGreaterThanOrEqual(3);
    for (const draw of registrations) expect(draw.instanceColor).toBe(true);
  });
});

describe('the grass-card cap arms', () => {
  it('enumerates more than one arm from the tier table', () => {
    // Vacuity floor: an empty or single-arm enumeration would make every
    // coverage assertion below pass over nothing.
    const arms = capArmsFromSource();
    expect(carpetRadiiFromSource().length).toBeGreaterThanOrEqual(3);
    expect(arms.length).toBeGreaterThanOrEqual(2);
    expect(arms.map((arm) => arm.key)).toContain('none');
    expect(arms.filter((arm) => arm.key !== 'none').length).toBeGreaterThanOrEqual(1);
  });

  it('gets one twin per arm, wearing the live material and geometry', () => {
    const arms = capArmsFromSource();
    const live = arms.map((arm) => ({
      arm,
      geometry: cardGeometry(arm.band !== null),
      material: grassCardMaterial(arm.band),
    }));
    for (const entry of live) {
      registerGroundDecorPrewarmDraw({
        geometry: entry.geometry,
        material: entry.material,
        instanceColor: true,
      });
    }

    const twins = buildGroundDecorPrewarmTwins();
    expect(twins).toHaveLength(arms.length);
    for (const [index, entry] of live.entries()) {
      const twin = twins[index];
      // The twin IS the live program: same material, same geometry, an
      // InstancedMesh with an instance colour like the live chunk mesh.
      expect(materialProgramSignature(twin.material as THREE.Material)).toBe(
        materialProgramSignature(entry.material),
      );
      expect(twin.material).toBe(entry.material);
      expect(twin.geometry).toBe(entry.geometry);
      expect(twin.isInstancedMesh).toBe(true);
      expect(twin.instanceColor).not.toBeNull();
      expect(twin.visible).toBe(false);
      expect(twin.castShadow).toBe(false);
      expect(twin.frustumCulled).toBe(false);
    }
  });

  it('never folds two cap arms onto one twin', () => {
    const arms = capArmsFromSource();
    const keys = new Set(
      arms.map((arm) =>
        groundDecorPrewarmKey({
          geometry: cardGeometry(arm.band !== null),
          material: grassCardMaterial(arm.band),
          instanceColor: true,
        }),
      ),
    );
    expect(keys.size).toBe(arms.length);
  });

  it('folds the flower palettes, which share one program, onto one twin', () => {
    // The ring builds one material per biome palette (ten of them) and they
    // differ only in their texture image, which three never keys a program on.
    const geometry = cardGeometry(false);
    for (let palette = 0; palette < 10; palette++) {
      registerGroundDecorPrewarmDraw({
        geometry,
        material: grassCardMaterial(null),
        instanceColor: true,
      });
    }
    expect(groundDecorPrewarmDraws()).toHaveLength(1);
    expect(buildGroundDecorPrewarmTwins()).toHaveLength(1);
  });

  it('separates the instance-colour arm, which three does key on', () => {
    const geometry = cardGeometry(false);
    const material = grassCardMaterial(null);
    registerGroundDecorPrewarmDraw({ geometry, material, instanceColor: true });
    registerGroundDecorPrewarmDraw({ geometry, material, instanceColor: false });
    expect(buildGroundDecorPrewarmTwins()).toHaveLength(2);
  });
});

describe('the night-accent glow twin', () => {
  it('links the same program the live caps draw with', () => {
    const material = nightAccentGlowMaterial();
    const geometry = new THREE.SphereGeometry(0.19, 7, 4);
    registerGroundDecorPrewarmDraw({ geometry, material, instanceColor: true });
    const [twin] = buildGroundDecorPrewarmTwins();
    expect(materialProgramSignature(twin.material as THREE.Material)).toBe(
      materialProgramSignature(nightAccentGlowMaterial()),
    );
    // The live cap mesh is instanced AND per-instance tinted; a twin without
    // the instance colour links a different program (the capture's key delta
    // was exactly `+instancing +instancingColor +vertexColors`).
    expect(twin.instanceColor).not.toBeNull();
    expect((twin.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
  });

  it('registers the live cap material and geometry, not a rebuilt pair', () => {
    const source = sourceOf('night_accents.ts');
    expect(source).toContain('const capMat = nightAccentGlowMaterial();');
    expect(source).toContain('const caps = new THREE.InstancedMesh(capGeometry(), capMat,');
    // The registered pair IS the live pair: the caps mesh's own geometry and
    // the material it was built with, never a rebuilt lookalike.
    expect(source).toContain('registerGroundDecorPrewarmDraw({\n    geometry: caps.geometry,');
    expect(source).toContain('material: capMat,');
    expect(source).toContain('instanceColor: true,');
  });
});

describe('the prewarm manifest wiring (source pins)', () => {
  const foliage = sourceOf('foliage.ts');

  it('publishes the grass card and the flower palettes at ring build time', () => {
    expect(foliage).toContain(
      'registerGroundDecorPrewarmDraw({ geometry: geo, material: mat, instanceColor: true });',
    );
    expect(foliage).toContain(
      'registerGroundDecorPrewarmDraw({ geometry: flowerGeo, material: fmMat, instanceColor: true });',
    );
    // Composed through the core, so the arms this test enumerates are the ones
    // the live material really keys on.
    expect(foliage).toContain('grassCardProgramCacheKey(capBand, baseProgramKey)');
  });

  it('stages the twins inside the foliage material prewarm group', () => {
    expect(foliage).toContain(
      'for (const twin of buildGroundDecorPrewarmTwins()) group.add(twin);',
    );
  });

  it('is cleared by the graphics rebuild, so the registry restarts empty', () => {
    // A rebuild retires every profile-derived material and mints new ones. The
    // registry holds the LIVE materials of the outgoing generation, so without
    // this the next boot manifest links programs for materials nothing will
    // ever draw, and the twins keep the retired ones alive.
    const profile = codeWithoutLineComments(
      readFileSync(new URL('../src/render/assets/graphics_profile.ts', import.meta.url), 'utf8'),
    );
    expect(profile).toContain(
      "import { clearGroundDecorPrewarmDraws } from '../ground_decor_prewarm';",
    );
    // Beside the other module caches the same rebuild resets, on the one
    // RESETTERS table resetGraphicsProfileDerivedCaches drives.
    expect(profile).toContain("['ground_decor_prewarm', clearGroundDecorPrewarmDraws],");
    expect(profile).toContain('for (const [, reset] of RESETTERS) reset();');

    // ...and the clear really restarts the registry from nothing.
    registerGroundDecorPrewarmDraw({
      geometry: cardGeometry(false),
      material: grassCardMaterial(null),
      instanceColor: true,
    });
    expect(groundDecorPrewarmDraws()).toHaveLength(1);
    clearGroundDecorPrewarmDraws();
    expect(groundDecorPrewarmDraws()).toEqual([]);
    expect(buildGroundDecorPrewarmTwins()).toEqual([]);
  });

  it('rides the existing foliage.materials manifest entry, not a new lane', () => {
    const renderer = sourceOf('renderer.ts');
    const start = renderer.indexOf("        id: 'foliage.materials',");
    expect(start).toBeGreaterThan(0);
    // Up to the next MANIFEST entry (the eight-space id), not the next id at
    // all: this entry's resume units carry ids of their own.
    const entry = renderer.slice(start, renderer.indexOf("\n        id: '", start + 30));
    // Both arms of the entry mint the group: the entry run AND the resume
    // units a deadline drop falls back to.
    expect(entry.match(/buildFoliageMaterialPrewarmGroup\(\)/g)?.length).toBe(2);
    // The twins ride that entry and never mint a lane of their own. A bare
    // `not.toContain` over a needle nothing ever writes is vacuous, so the
    // needle is proven against a manifest id that IS there, and the scan is
    // proven to be over a source full of manifest ids.
    const laneId = "id: 'ground-decor";
    expect(`        ${laneId}.twins',`).toContain(laneId);
    expect(renderer.match(/^\s+id: '[\w.:-]+',$/gm)?.length ?? 0).toBeGreaterThan(10);
    expect(renderer.match(/id: 'foliage\.materials',/g)).toHaveLength(1);
    expect(renderer).not.toContain(laneId);
  });
});
