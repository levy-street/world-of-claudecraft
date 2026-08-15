// What a composed variant is allowed to FREE when the cache evicts it.
//
// The variant cache is bounded and refcounted so a populated zone stops minting
// part sets forever, and eviction disposes geometry to make that mean anything.
// The hazard is that a variant root is a SkeletonUtils clone, which SHARES
// BufferGeometry with the parsed GLB it came from, and mergeSkinnedParts only
// mints new geometry for the buckets it can PROVE safe: it refuses anything
// carrying morph targets (head, eyes, ears, lashes, brows, mouth) and skips
// buckets of one. Every one of those meshes is still pointing at the parsed
// scene's buffers, which every other variant, and every future compose, also
// point at, and which nothing re-creates.
//
// So an eviction that disposed the whole root would free the head, eye, ear,
// lash and brow buffers out from under every character on screen, and only in
// a session that has seen more than the cap's worth of distinct looks: the exact
// situation the cache exists for. That is the same shape as the recolorCache
// bug this workstream fixed, one layer down.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { variantOwnedGeometries } from '../src/render/characters/assets';

type AssetsModule = typeof import('../src/render/characters/assets');

/** A mesh pointing at a given geometry, the way a clone shares its source's. */
function meshWith(geo: THREE.BufferGeometry, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

function boxGeo(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

/** The parsed GLB's meshes, and a variant root built the way modularVariant
 *  builds one: the unmerged parts still on the source geometry, the merged
 *  bucket on geometry the merge minted. */
function scene() {
  const head = boxGeo(); // morph targets -> mergeSkinnedParts refuses it
  const eyes = boxGeo(); // ditto
  const loneArm = boxGeo(); // bucket of one -> skipped
  const plateA = boxGeo();
  const plateB = boxGeo();
  const shared = new Set([head, eyes, loneArm, plateA, plateB]);

  const merged = boxGeo(); // what mergeSkinnedParts minted from plateA + plateB
  const variantRoot = new THREE.Group();
  variantRoot.add(meshWith(head, 'head'));
  variantRoot.add(meshWith(eyes, 'eyes'));
  variantRoot.add(meshWith(loneArm, 'arm'));
  variantRoot.add(meshWith(merged, 'plate_merged'));
  return { shared, variantRoot, head, eyes, loneArm, merged };
}

describe('variantOwnedGeometries', () => {
  it('claims only the geometry the merge minted', () => {
    const { shared, variantRoot, merged } = scene();
    expect(variantOwnedGeometries(variantRoot, shared)).toEqual([merged]);
  });

  it('never claims a part still pointing at the parsed GLB', () => {
    const { shared, variantRoot, head, eyes, loneArm } = scene();
    const owned = variantOwnedGeometries(variantRoot, shared);
    for (const geo of [head, eyes, loneArm]) expect(owned).not.toContain(geo);
  });

  it('leaves a second variant intact when the first is evicted', () => {
    // The reviewer's scenario end to end: two distinct part sets sharing the
    // GLB's head buffer, one evicted. `dispose()` is observable as the event
    // the renderer frees GPU buffers on, so listen for it rather than poking at
    // attributes (dispose does not clear those).
    const { shared, variantRoot, head, merged } = scene();

    const otherRoot = new THREE.Group();
    otherRoot.add(meshWith(head, 'head')); // the SAME buffer, as a real clone would
    otherRoot.add(meshWith(boxGeo(), 'plate_merged'));

    let headDisposed = false;
    let mergedDisposed = false;
    head.addEventListener('dispose', () => {
      headDisposed = true;
    });
    merged.addEventListener('dispose', () => {
      mergedDisposed = true;
    });

    for (const geo of variantOwnedGeometries(variantRoot, shared)) geo.dispose();

    expect(mergedDisposed).toBe(true); // the evicted variant's own buffer went back
    expect(headDisposed).toBe(false); // ...and the shared one did not
    // The survivor still draws from a live buffer.
    const otherHead = otherRoot.getObjectByName('head') as THREE.Mesh;
    expect(otherHead.geometry).toBe(head);
    expect(otherHead.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('claims everything when nothing is shared (a fully merged root)', () => {
    const { variantRoot } = scene();
    expect(variantOwnedGeometries(variantRoot, new Set())).toHaveLength(4);
  });
});

describe('modularVariant insertion order (source pin)', () => {
  it('sweeps BEFORE inserting, so a fresh variant can never evict itself', () => {
    // At the cap with every other entry live, a sweep run AFTER the insert
    // reaches the newest refs-0 entry last, deletes it, disposes it, and hands
    // the caller a disposed root, after which that look re-mints and
    // re-evicts itself forever and its far bake writes to an orphan. The
    // property is pure statement order, so pin it as source (the mntOwn
    // pattern): the sweep call must precede the cache insert.
    const src = readFileSync(resolve(process.cwd(), 'src/render/characters/assets.ts'), 'utf8');
    const fnStart = src.indexOf('function modularVariant(');
    const fnEnd = src.indexOf('\n}', fnStart);
    const body = src.slice(fnStart, fnEnd);
    const sweepAt = body.indexOf('evictModularVariants()');
    const insertAt = body.indexOf('modularVariantCache.set(key, entry)');
    expect(sweepAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(sweepAt).toBeLessThan(insertAt);
  });

  it('routes eviction through the predicate, never a whole-root dispose', () => {
    // variantOwnedGeometries is exhaustively covered above, and none of it
    // matters if the CALLER stops asking. Reverting evictModularVariants to the
    // pre-fix `entry.root.traverse(o => o.geometry?.dispose())` reintroduces the
    // whole bug one line above the predicate that exists to prevent it, and
    // leaves every test above green: they exercise the predicate, not the sweep.
    // The sweep needs a parsed GLB to run, so pin it as source.
    const src = readFileSync(resolve(process.cwd(), 'src/render/characters/assets.ts'), 'utf8');
    const fnStart = src.indexOf('function evictModularVariants(');
    const fnEnd = src.indexOf('\n}', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    const body = src.slice(fnStart, fnEnd);
    // the geometry it frees comes from the predicate, diffed against the parse
    expect(body).toContain('variantOwnedGeometries(entry.root, sourceGeometries(entry.url))');
    // ...and nothing here walks the root itself
    expect(body).not.toMatch(/entry\.root\.traverse/);
    // the far bake is the one thing eviction frees unconditionally: this code
    // minted it (bakeStaticPose), so no other variant can be pointing at it
    expect(body).toContain('entry.far?.geo.dispose()');
    // and an entry with a live clone is never touched, whatever the cap says
    expect(body).toMatch(/entry\.refs\s*>\s*0/);
  });

  it('retains LAST in assembleModular, after every throw point', () => {
    // attachAllProps throws for streamed assets (the designed retry path) and
    // the retry never reaches dispose, so a retain taken before it leaked one
    // ref per attempt until the entry could never be evicted.
    const src = readFileSync(resolve(process.cwd(), 'src/render/characters/assets.ts'), 'utf8');
    const fnStart = src.indexOf('export function assembleModular(');
    const fnEnd = src.indexOf('\n}', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body.indexOf('attachAllProps(')).toBeLessThan(body.indexOf('variant.refs++'));
  });
});

// sourceGeometries is the PRODUCER of the `shared` set every test above injects
// by hand: it is what evictModularVariants actually diffs a variant against. A
// mutation that hollows its traversal out to `return new Set()` would make every
// geometry in a variant read as variant-owned, and evictModularVariants would go
// back to disposing shared parsed-GLB buffers out from under every other
// character on screen, exactly the bug this whole file exists to prevent, one
// layer upstream of variantOwnedGeometries itself. sourceGeometries reads its
// scene through resolvedGltf(url), which resolves out of the module's private
// preload map, so exercising the real function needs a real (mocked) GLTF
// loader and a fresh module instance per test, the same seam
// character_visual_material_release.test.ts uses for full CharacterVisual
// construction.
describe('sourceGeometries', () => {
  afterEach(() => {
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  const FIXTURE_URL = 'test-fixture/source-geometries.glb';

  /** A parsed-scene shape with a geometry shared by two meshes, a second
   *  distinct geometry, and non-mesh nodes that must not count. */
  function fixtureScene(): {
    scene: THREE.Group;
    geoA: THREE.BufferGeometry;
    geoB: THREE.BufferGeometry;
  } {
    const scene = new THREE.Group();
    const geoA = boxGeo();
    const geoB = boxGeo();
    scene.add(meshWith(geoA, 'partA1'));
    scene.add(meshWith(geoA, 'partA2')); // shares geoA with partA1
    scene.add(meshWith(geoB, 'partB'));
    scene.add(new THREE.Group()); // a non-mesh node: must contribute nothing
    scene.add(new THREE.Object3D()); // ditto
    return { scene, geoA, geoB };
  }

  /** Load a fresh assets module instance whose loader is mocked to hand back
   *  `fixture.scene` for FIXTURE_URL (and a trivial empty scene for any other
   *  url the module's own top-level preload sweep happens to ask for), then
   *  wait for ensureCharacterUrl's `.then(gltfByUrl.set(...))` to have run:
   *  the two attach to the SAME already-resolved promise, and the callback
   *  attached first (inside ensureCharacterUrl) always settles first. */
  async function primedAssets(): Promise<{
    assets: AssetsModule;
    fixture: ReturnType<typeof fixtureScene>;
  }> {
    const fixture = fixtureScene();
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn((url: string) =>
        Promise.resolve(
          url === FIXTURE_URL
            ? { scene: fixture.scene, animations: [] }
            : { scene: new THREE.Group(), animations: [] },
        ),
      ),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    }));
    const assets = (await import('../src/render/characters/assets')) as AssetsModule;
    assets.ensureCharacterUrl(FIXTURE_URL);
    await new Promise((r) => setTimeout(r, 0));
    return { assets, fixture };
  }

  it('collects exactly the distinct geometries the parsed scene owns', async () => {
    const { assets, fixture } = await primedAssets();
    const owned = assets.sourceGeometries(FIXTURE_URL);
    expect(owned.size).toBe(2);
    expect(owned.has(fixture.geoA)).toBe(true);
    expect(owned.has(fixture.geoB)).toBe(true);
  });

  it('memoizes per parsed scene: two calls return the identical set', async () => {
    const { assets } = await primedAssets();
    const first = assets.sourceGeometries(FIXTURE_URL);
    const second = assets.sourceGeometries(FIXTURE_URL);
    // The mutant that hollows the traversal to `return new Set()` also breaks
    // this: a fresh empty set every call is never `===` to the last one.
    expect(second).toBe(first);
  });

  it('variantOwnedGeometries against the REAL producer: only a minted geometry is owned', async () => {
    // The integration shape: a variant root that mixes a mesh still pointing at
    // the parsed scene's buffer (as a SkeletonUtils clone genuinely would) with
    // one on freshly minted geometry, diffed against sourceGeometries' own
    // output rather than a hand-built `shared` set.
    const { assets, fixture } = await primedAssets();
    const shared = assets.sourceGeometries(FIXTURE_URL);
    const minted = boxGeo();
    const variantRoot = new THREE.Group();
    variantRoot.add(meshWith(fixture.geoA, 'partA1'));
    variantRoot.add(meshWith(minted, 'plate_merged'));
    expect(assets.variantOwnedGeometries(variantRoot, shared)).toEqual([minted]);
  });
});
