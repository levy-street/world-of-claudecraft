import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GFX } from '../src/render/gfx';
import {
  fissureLavaTriangles,
  planFissureLava,
  VENT_POOL_LIFT,
  VENT_POOL_SHARE,
} from '../src/render/quartered_fissure_lava_core';
import {
  ISLE_MODEL_KEYS,
  ISLE_MODELS,
  LOW_TIER_DEBRIS_SHARE,
  shedFloatingIsles,
} from '../src/render/quartered_floating_debris_core';
import { floatingIslesInternalsForTest } from '../src/render/quartered_floating_isles';
import {
  BORROWED_MATERIAL_FLAG,
  buildQuarteredLandmarks,
  quarteredLandmarkAssetsResident,
  quarteredLandmarkDressingInternalsForTest,
  quarteredLandmarkLoadFor,
} from '../src/render/quartered_landmark_dressing';
import { planQuarteredLandmarkDressing } from '../src/render/quartered_landmark_dressing_core';
import { ISLE_KIT, QUARTERED_ISLE_SPIRES } from '../src/sim/content/quartered_spires';
import { QUARTERED_FROZEN_LAKES } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';

afterEach(() => quarteredLandmarkDressingInternalsForTest.reset());

function sourceModel(geometry: THREE.BufferGeometry): THREE.Group {
  const source = new THREE.Group();
  source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff5a18 })));
  return source;
}

function installAll(): void {
  quarteredLandmarkDressingInternalsForTest.installSources({
    spire: sourceModel(new THREE.ConeGeometry(0.8, 4, 6)),
  });
  // each island stands in as a box of its native size, its tip at y 0
  floatingIslesInternalsForTest.installSources(
    Object.fromEntries(
      ISLE_MODEL_KEYS.map((model) => {
        const spec = ISLE_MODELS[model];
        const box = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
        box.translate(0, spec.h / 2, 0);
        return [model, sourceModel(box)];
      }),
    ),
  );
  quarteredLandmarkDressingInternalsForTest.installLavaTextures({ color: new THREE.Texture() });
}

describe('the Quartered Isle landmark dressing module', () => {
  it('loads the Frostveil spire, the Drakelands lava and the kit rocks already in the catalogue', () => {
    expect(Object.values(quarteredLandmarkDressingInternalsForTest.urls).sort()).toEqual([
      '/models/props/frostveil_ice_spire.glb',
    ]);
    // the six generated island models, one per kind
    expect(Object.values(floatingIslesInternalsForTest.urls).sort()).toEqual(
      [...ISLE_MODEL_KEYS].sort().map((m) => `/models/props/sky_isle_${m}.glb`),
    );
  });

  it('refuses to build before every model is resident, so the prepare retries', () => {
    expect(quarteredLandmarkAssetsResident()).toBe(false);
    expect(() => buildQuarteredLandmarks(0)).toThrow(/not resident/);
    // the models alone are not enough: the fissure melt needs its lava texture
    installAll();
    quarteredLandmarkDressingInternalsForTest.installLavaTextures(null);
    expect(quarteredLandmarkAssetsResident()).toBe(false);
    expect(() => buildQuarteredLandmarks(0)).toThrow(/not resident/);
  });

  it('asks the zone prepare to wait only for the quartered biome, and only while not resident', () => {
    expect(quarteredLandmarkLoadFor('ember')).toBeNull();
    expect(quarteredLandmarkLoadFor('frost')).toBeNull();
    installAll();
    expect(quarteredLandmarkLoadFor('quartered')).toBeNull();
  });

  it('instances one body per planned placement, split into per-landmark cull groups', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const plan = planQuarteredLandmarkDressing((x, z) => terrainHeight(x, z, 0));
    const counted = (flag: string): number => {
      let n = 0;
      view.group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh && o.userData[flag]) n += o.count;
      });
      return n;
    };
    expect(counted('quarteredIceSpire')).toBe(plan.spires.length);
    // the isles follow the build-time tier share: one body per kept islet,
    // one link per kept chain link
    const share = GFX.standardMaterials ? 1 : LOW_TIER_DEBRIS_SHARE;
    const kept = shedFloatingIsles(plan.debris, share);
    expect(counted('quarteredIsle')).toBe(kept.isles.length);
    expect(counted('quarteredIsle')).toBeGreaterThan(0);
    expect(counted('quarteredIsleChain')).toBe(kept.chains.reduce((n, c) => n + c.links, 0));
    const names = view.cullGroups.map((g) => g.name);
    const lakes = QUARTERED_FROZEN_LAKES.length;
    expect(names.slice(0, lakes + 4)).toEqual([
      'quartered-rimeglass',
      ...QUARTERED_FROZEN_LAKES.slice(1).map((_, i) => `quartered-frozen-lake-${i + 1}`),
      'quartered-crevasse-spires',
      'quartered-hoarshelf-spires-west',
      'quartered-hoarshelf-spires-east',
      'quartered-lava-vent-pools',
    ]);
    // the fissure melt splits into its tiles; the floating isles split into
    // near, middle and far stretches of their trail
    const tiles = planFissureLava({ groundAt: (x, z) => terrainHeight(x, z, 0) });
    const rest = names.slice(lakes + 4);
    expect(rest.slice(0, tiles.length)).toEqual(
      tiles.map((t) => `quartered-fissure-lava-${t.ti}-${t.tj}`),
    );
    expect(names).toContain('quartered-floating-isles-near');
    for (const name of rest.slice(tiles.length)) {
      expect(name).toMatch(/^quartered-floating-isles-(near|mid|far)$/);
    }
    // the isles (and only the isles) opt out of Low's near-radius cutoff
    for (const g of view.cullGroups) {
      expect(g.userData.sceneryBackdrop === true, g.name).toBe(
        g.name.startsWith('quartered-floating-isles-'),
      );
    }
    for (const g of view.cullGroups) expect(g.parent).toBe(view.group);
    // cosmetic: the view carries no point lights for the carrier budget
    view.group.traverse((o) => expect(o).not.toBeInstanceOf(THREE.PointLight));
  });

  it('lays one clear-ice sheet on every frozen lake, in its own lake group', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const sheets: THREE.Mesh[] = [];
    view.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.quarteredLakeIce) sheets.push(o);
    });
    expect(sheets).toHaveLength(QUARTERED_FROZEN_LAKES.length);
    const material = sheets[0].material as THREE.MeshStandardMaterial;
    // one shared, glossy, see-through material with the crack texture
    for (const s of sheets) expect(s.material).toBe(material);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexColors).toBe(true);
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    QUARTERED_FROZEN_LAKES.forEach((lake, li) => {
      const sheet = sheets.find((s) => s.name === `quartered-lake-ice-${li}`);
      expect(sheet?.parent).toBe(view.cullGroups[li]);
      const sphere = sheet?.geometry.boundingSphere;
      expect(sphere?.center.x).toBeCloseTo(lake.x, 0);
      expect(sphere?.center.z).toBeCloseTo(lake.z, 0);
      expect(sphere?.radius).toBeLessThan(lake.r);
      // the sheet never casts a shadow onto the ground it lies on
      expect(sheet?.castShadow).toBe(false);
    });
  });

  it('fills the Cinderscar fissures with the Ignivar lava material, one mesh per tile', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const melt: THREE.Mesh[] = [];
    view.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.quarteredFissureLava) melt.push(o);
    });
    const tiles = planFissureLava({ groundAt: (x, z) => terrainHeight(x, z, 0) });
    expect(melt).toHaveLength(tiles.length);
    let triangles = 0;
    for (const m of melt) {
      triangles += (m.geometry.index?.count ?? 0) / 3;
      expect(m.material).toBe(melt[0].material);
      expect(m.castShadow).toBe(false);
    }
    expect(triangles).toBe(fissureLavaTriangles(tiles));
    const material = melt[0].material as THREE.ShaderMaterial;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.userData.source).toBe('project-generated:drive-referenced-lava');
  });

  it('pools the melt in every lava vent: one merged disc mesh in the Ignivar material', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const vents = QUARTERED_ISLE_SPIRES.filter((d) => d.key === 'cinderLavaVent');
    expect(vents.length).toBeGreaterThanOrEqual(4);
    const pools: THREE.Mesh[] = [];
    let fissure: THREE.Mesh | null = null;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.userData.quarteredVentPool) pools.push(o);
      if (o.userData.quarteredFissureLava) fissure = o;
    });
    expect(pools).toHaveLength(1);
    const pool = pools[0];
    expect(pool.material).toBe((fissure as THREE.Mesh | null)?.material);
    expect((pool.geometry.index?.count ?? 0) / 3).toBe(vents.length * 20);
    // each disc sits inside its vent's stone ring, over the vent's ground
    const pos = pool.geometry.getAttribute('position');
    vents.forEach((v, n) => {
      const c = n * 21;
      expect(pos.getX(c)).toBeCloseTo(v.x, 3);
      expect(pos.getZ(c)).toBeCloseTo(v.z, 3);
      expect(pos.getY(c)).toBeCloseTo(terrainHeight(v.x, v.z, 0) + VENT_POOL_LIFT, 3);
      const rim = Math.hypot(pos.getX(c + 1) - v.x, pos.getZ(c + 1) - v.z);
      expect(rim).toBeCloseTo(ISLE_KIT.cinderLavaVent.w * (v.scale ?? 1) * VENT_POOL_SHARE, 3);
      expect(rim).toBeLessThan((ISLE_KIT.cinderLavaVent.w * (v.scale ?? 1)) / 2);
    });
  });

  it('hangs each island on its planned point and turn, clear of the ground', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const plan = planQuarteredLandmarkDressing((x, z) => terrainHeight(x, z, 0));
    const kept = shedFloatingIsles(plan.debris, GFX.standardMaterials ? 1 : LOW_TIER_DEBRIS_SHARE);
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    let checked = 0;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.userData.quarteredIsle) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, matrix);
        const isle = kept.isles.find(
          (c) =>
            c.model === o.userData.quarteredIsle &&
            Math.abs(c.x - matrix.elements[12]) < 1e-3 &&
            Math.abs(c.y - matrix.elements[13]) < 1e-3 &&
            Math.abs(c.z - matrix.elements[14]) < 1e-3,
        );
        expect(isle).toBeDefined();
        if (!isle) continue;
        // the drawn box is the plan's turned box: same lowest and highest y
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox as THREE.Box3).applyMatrix4(matrix);
        expect(box.min.y).toBeCloseTo(isle.minY, 3);
        expect(box.max.y).toBeCloseTo(isle.maxY, 3);
        expect(box.min.y).toBeGreaterThan(terrainHeight(isle.x, isle.z, 0));
        checked++;
      }
    });
    expect(checked).toBe(kept.isles.length);
  });

  it('floats one soft cloud bank per isle cluster, drawn without depth writes', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const banks: THREE.Mesh[] = [];
    view.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.quarteredIsleCloud) banks.push(o);
    });
    expect(banks.length).toBeGreaterThan(0);
    for (const bank of banks) {
      expect(bank.parent?.name).toMatch(/^quartered-floating-isles-(near|mid|far)$/);
      const material = bank.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.map).toBeInstanceOf(THREE.DataTexture);
      expect(material).toBe(banks[0].material);
      expect(bank.castShadow).toBe(false);
    }
  });

  it('frees its own geometry, materials and procedural textures, never a borrowed material', () => {
    installAll();
    const view = buildQuarteredLandmarks(0);
    const geometries = new Set<THREE.BufferGeometry>();
    const own = new Set<THREE.Material>();
    const borrowed = new Set<THREE.Material>();
    const dataTextures = new Set<THREE.Texture>();
    view.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (mesh.userData[BORROWED_MATERIAL_FLAG] === true ? borrowed : own).add(m);
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map instanceof THREE.DataTexture && mesh.userData[BORROWED_MATERIAL_FLAG] !== true) {
          dataTextures.add(map);
        }
      }
    });
    // the islands' cached GLB materials and the shared Ignivar lava are borrowed
    expect(borrowed.size).toBeGreaterThanOrEqual(2);
    expect(own.size).toBeGreaterThanOrEqual(4); // ice sheet, spire ice, chain iron, cloud
    expect(dataTextures.size).toBe(2); // the lake ice and the cloud puff
    for (const m of borrowed) expect(own.has(m)).toBe(false);
    const seen = new Set<object>();
    const watch = (target: THREE.EventDispatcher<{ dispose: object }>) =>
      target.addEventListener('dispose', () => seen.add(target));
    for (const g of geometries) watch(g);
    for (const m of [...own, ...borrowed]) watch(m);
    for (const t of dataTextures) watch(t);

    view.dispose();
    for (const g of geometries) expect(seen.has(g)).toBe(true);
    for (const m of own) expect(seen.has(m)).toBe(true);
    for (const t of dataTextures) expect(seen.has(t)).toBe(true);
    for (const m of borrowed) expect(seen.has(m)).toBe(false);
    expect(view.group.children).toHaveLength(0);
    // idempotent: a second call frees nothing twice
    const count = seen.size;
    view.dispose();
    expect(seen.size).toBe(count);
  });

  it('is disposed by the renderer teardown (source pin)', () => {
    const lifecycle = readFileSync(
      new URL('../src/render/renderer_resource_lifecycle.ts', import.meta.url),
      'utf8',
    );
    expect(lifecycle).toContain('bestEffort(() => resources.quarteredMarks?.dispose());');
  });

  it('is wired as a gated zone feature for the quartered biome (renderer source pin)', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const cases = source.slice(source.indexOf('private ensureZoneFeatures(zone: ZoneDef): void {'));
    const at = cases.indexOf("case 'quartered':");
    expect(at).toBeGreaterThan(-1);
    const arm = cases.slice(at, cases.indexOf('break;', at));
    expect(arm).toContain(
      "this.quarteredMarks = this.timedBuild('buildQuarteredLandmarks', buildQuarteredLandmarks);",
    );
    // attachZoneFeature is the gated attach (world compile gate + idle prewarm)
    expect(arm).toContain('this.attachZoneFeature(this.quarteredMarks);');
    expect(source).toContain(
      'const kitLoad = drakelandsKitLoadFor(zone.biome) ?? quarteredLandmarkLoadFor(zone.biome);',
    );
  });
});
