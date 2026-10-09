// The Gravewyrm Sanctum's fires, lights, steam, meltwater and works floor
// (src/render/gravewyrm_sanctum: sanctum_lights.ts, sanctum_fire.ts,
// sanctum_steam.ts, sanctum_vault.ts, sanctum_works.ts and their pure cores):
// the light budget, one light per fire prop, steam only where the design puts
// it, the pools on THAW_POOLS, and every works mark on one floor.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { floorVfxLayerOf } from '../src/render/floor_vfx_layer_core';
import { sanctumFireCounts } from '../src/render/gravewyrm_sanctum/sanctum_fire_core';
import {
  buildSanctumLights,
  SANCTUM_FIRE_SEAT,
} from '../src/render/gravewyrm_sanctum/sanctum_lights';
import {
  planSanctumFires,
  planSanctumLights,
  planSteamSources,
  SANCTUM_FIRE_STYLE,
  sanctumGround,
  sanctumLightZoneOf,
} from '../src/render/gravewyrm_sanctum/sanctum_plan_core';
import { buildSanctumSteam } from '../src/render/gravewyrm_sanctum/sanctum_steam';
import { buildSanctumVault, VAULT_POOL_LIFT } from '../src/render/gravewyrm_sanctum/sanctum_vault';
import { buildSanctumWorks } from '../src/render/gravewyrm_sanctum/sanctum_works';
import {
  planMeltChannel,
  planWorksMarks,
  worksMarkFits,
} from '../src/render/gravewyrm_sanctum/sanctum_works_core';
import {
  GRAVEWYRM_SANCTUM_FIELD,
  MELT_CHANNEL,
  RITUAL_VAULT,
  THAW_POOLS,
  THAW_WORKS,
} from '../src/sim/content/gravewyrm_sanctum_layout';

// The halos and stains sample a canvas glow texture; the node test has no DOM.
vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  radialGlowTexture: () => new THREE.Texture(),
}));

const FIRE_PROPS = new Set(['gs_cult_brazier', 'gs_soul_pyre', 'gs_soul_brazier', 'gs_thaw_pyre']);

describe('the Sanctum light budget', () => {
  it('lights every fire prop exactly once, and nothing else', () => {
    const props = GRAVEWYRM_SANCTUM_FIELD.props.filter((p) => FIRE_PROPS.has(p.kind));
    expect(props.length).toBeGreaterThan(0);
    const lights = planSanctumLights();
    expect(lights.length).toBe(props.length);
    for (const p of props) {
      expect(lights.filter((l) => l.x === p.x && l.z === p.z).length, p.kind).toBe(1);
    }
  });

  it('keeps at most eight budgeted lights in every light zone', () => {
    const perZone = new Map<string, number>();
    for (const l of planSanctumLights()) {
      const zone = sanctumLightZoneOf(l.x, l.z) ?? 'none';
      perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
    }
    for (const [zone, n] of perZone) expect(n, zone).toBeLessThanOrEqual(8);
  });

  it('pushes one point light per fire through the sink and adds no other light', () => {
    const group = new THREE.Group();
    const sink: THREE.PointLight[] = [];
    buildSanctumLights(group, { lowGfx: false, flames: [], fireLights: sink }, sanctumGround);
    expect(sink.length).toBe(planSanctumFires().length);
    const lights: THREE.Light[] = [];
    group.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    expect(lights.length).toBe(sink.length);
    for (const l of lights) expect(l).toBeInstanceOf(THREE.PointLight);
    // The fire stains sit on the floor ladder's ground rung.
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.renderOrder !== 0) {
        expect(floorVfxLayerOf(o.renderOrder)).toBe('ground');
      }
    });
  });

  it('seats every fire on the coals of its kit piece', () => {
    expect(SANCTUM_FIRE_SEAT.thawPyre).toBeGreaterThan(2);
    expect(SANCTUM_FIRE_SEAT.thawPyre).toBeLessThan(4);
    expect(SANCTUM_FIRE_SEAT.brazier).toBeLessThan(3);
    for (const kind of Object.keys(SANCTUM_FIRE_STYLE) as (keyof typeof SANCTUM_FIRE_STYLE)[]) {
      expect(SANCTUM_FIRE_SEAT[kind]).toBeGreaterThan(0);
    }
  });

  it('sheds the cosmetic sprites on the low tier and keeps the soul wisps to soulfire', () => {
    const high = sanctumFireCounts(1.9, true, false);
    const low = sanctumFireCounts(1.9, true, true);
    expect(low.total).toBeLessThan(high.total);
    expect(low.tongues).toBeGreaterThan(0);
    expect(low.embers + low.wisps).toBe(0);
    expect(sanctumFireCounts(1.9, false, false).wisps).toBe(0);
  });
});

describe('the Sanctum steam', () => {
  it('rises only over the Thaw Works and the Ritual Vault', () => {
    const works = THAW_WORKS;
    const sources = planSteamSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      const inWorks =
        s.x >= Math.min(works.upper.x0, works.lower.x0) - 1 &&
        s.x <= Math.max(works.upper.x1, works.lower.x1) + 1 &&
        s.z >= works.upper.z0 - 1 &&
        s.z <= works.lower.z1 + 1;
      const inVault = Math.hypot(s.x - RITUAL_VAULT.x, s.z - RITUAL_VAULT.z) <= RITUAL_VAULT.r;
      expect(inWorks || inVault, `${s.x},${s.z}`).toBe(true);
    }
  });

  it('thins with the density and keeps one draw per kind', () => {
    const count = (g: THREE.Group) => {
      let n = 0;
      let draws = 0;
      g.traverse((o) => {
        const geo = (o as THREE.Mesh).geometry as THREE.InstancedBufferGeometry | undefined;
        if ((o as THREE.Mesh).isMesh && geo) {
          draws++;
          n += geo.instanceCount;
        }
      });
      return { n, draws };
    };
    const full = count(buildSanctumSteam({ lowGfx: false, density: 1 }));
    const low = count(buildSanctumSteam({ lowGfx: true, density: 1 }));
    expect(full.draws).toBe(2);
    expect(low.n).toBeLessThan(full.n);
  });
});

describe('the vault meltwater', () => {
  it('lays one pool on every THAW_POOLS spot at its radius, on the ground rung', () => {
    const group = buildSanctumVault(false);
    const pools = group.children as THREE.Mesh[];
    expect(pools.length).toBe(THAW_POOLS.length);
    for (const pool of THAW_POOLS) {
      const mesh = pools.find(
        (m) => Math.abs(m.position.x - pool.x) < 1e-6 && Math.abs(m.position.z - pool.z) < 1e-6,
      );
      expect(mesh, pool.id).toBeDefined();
      if (!mesh) continue;
      expect(mesh.scale.x).toBeCloseTo(pool.r, 6);
      expect(mesh.position.y).toBeCloseTo(sanctumGround(pool.x, pool.z) + VAULT_POOL_LIFT, 6);
      expect(floorVfxLayerOf(mesh.renderOrder)).toBe('ground');
      // Every pool lies inside the vault's bowl, on its floor.
      expect(
        Math.hypot(pool.x - RITUAL_VAULT.x, pool.z - RITUAL_VAULT.z) + pool.r,
      ).toBeLessThanOrEqual(RITUAL_VAULT.r);
    }
  });
});

describe('the Thaw Works floor', () => {
  it('lays every mark on one walkable floor, never across an edge', () => {
    const marks = planWorksMarks();
    expect(marks.length).toBeGreaterThan(20);
    for (const m of marks) expect(worksMarkFits(m)).toBe(true);
    expect(marks.some((m) => m.kind === 0)).toBe(true);
    expect(marks.some((m) => m.kind === 2)).toBe(true);
    expect(marks.some((m) => m.kind === 3)).toBe(true);
  });

  it('runs the channel along MELT_CHANNEL from its head to its foot', () => {
    const pts = planMeltChannel(1);
    const head = MELT_CHANNEL[0];
    const foot = MELT_CHANNEL[MELT_CHANNEL.length - 1];
    expect(pts[0].x).toBeCloseTo(head[0], 6);
    expect(pts[0].z).toBeCloseTo(head[1], 6);
    expect(pts[pts.length - 1].x).toBeCloseTo(foot[0], 6);
    expect(pts[pts.length - 1].z).toBeCloseTo(foot[1], 6);
    for (let i = 1; i < pts.length; i++) expect(pts[i].s).toBeGreaterThan(pts[i - 1].s);
  });

  it('draws the marks and the water on the ground rung, the cosmetic scatter shed low', () => {
    const count = (g: THREE.Group) => {
      let tris = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        expect(floorVfxLayerOf(m.renderOrder)).toBe('ground');
        tris += (m.geometry.index?.count ?? 0) / 3;
      });
      return tris;
    };
    expect(count(buildSanctumWorks(true, 0.35))).toBeLessThan(count(buildSanctumWorks(false, 1)));
  });
});
