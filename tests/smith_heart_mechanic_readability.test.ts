// The Smith's Heart's mechanic readability fixes of the weak-spots pass of
// 2026-11-04 (the bot pass's captures):
//   - the Wheel of the Hearth: the red slices crimson (the lethal hue, never the
//     danger orange the Hearth's glowing floor swallows), the safe slice its own
//     cool sheet with bright cold edges;
//   - Narrow Shelter: the shelter gems big, over the hiding players' names, each in
//     a dark setting, a crowded row blood red and never the lit ochre;
//   - the Quench's lake: the key light's highlight held to a glint, so no white
//     sheet washes a slash's line out.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAKE_ICE_GLARE, LAKE_ICE_GLARE_CAP } from '../src/render/smith_heart/quench_lake_ice';
import { CouncilLimitFx } from '../src/render/smith_heart_fx/council_limit_fx';
import type {
  CouncilFxHost,
  CouncilPillarsFx,
} from '../src/render/smith_heart_fx/council_pillars_fx';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Smith Heart readability: the Wheel of the Hearth', () => {
  const fx = src('src/render/smith_heart_fx/heat_fight_fx.ts');
  const at = fx.indexOf('const WHEEL_FRAG');
  const wheel = fx.slice(at, fx.indexOf('/** A flare', at));

  it('draws the safe slice as its own cool sheet, rimmed in cold light', () => {
    expect(wheel).toMatch(/uniform float uSafe;/);
    const safe = wheel.slice(wheel.indexOf('if (uSafe > 0.5)'), wheel.indexOf('return;'));
    expect(safe.length).toBeGreaterThan(0);
    // Blue over red and green in its sheet: a cool hue, never the floor's gold.
    const sheet = /vec3 sheet = mix\(vec3\(([\d., ]+)\), vec3\(([\d., ]+)\)/.exec(safe);
    expect(sheet).not.toBeNull();
    for (const v of [sheet?.[1], sheet?.[2]]) {
      const [r, g, b] = (v ?? '').split(',').map(Number);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g * 0.95);
    }
    // Opaque enough to read over a glowing floor from any height.
    expect(safe).toMatch(/max\(rims \* 0\.98, 0\.5/);
  });

  it('washes the red slices in the lethal crimson, the painter marking the safe one', () => {
    expect(fx).toMatch(/setHex\(safe \? WHEEL_SAFE_RIM : TELEGRAPH_THREAT_COLORS\.lethal\)/);
    expect(fx).toMatch(/u\.uSafe\.value = safe \? 1 : 0;/);
    expect(fx).toMatch(/uSafe: \{ value: 0 \}/);
  });
});

describe('Smith Heart readability: Narrow Shelter', () => {
  const host = () => {
    const root = new THREE.Group();
    const h = {
      root,
      geometries: [] as THREE.BufferGeometry[],
      materials: [] as THREE.Material[],
      groundY: () => 10,
    } as unknown as CouncilFxHost;
    // Two pillars due north of the blast, one a little east.
    const pillars = [
      { x: 0, z: 10, r: 1.5 },
      { x: 8, z: 10, r: 1.5 },
    ];
    const pillarsFx = {
      shelters(out: { x: number; z: number; r: number }[]): number {
        pillars.forEach((p, i) => {
          out[i] = { ...p };
        });
        return pillars.length;
      },
    } as unknown as CouncilPillarsFx;
    return { h, root, fx: new CouncilLimitFx(h, pillarsFx) };
  };
  const meshes = (root: THREE.Group) => {
    const gems = root.children.find((c) => c.name === 'smithHeartCouncilLimitGems');
    const settings = root.children.find((c) => c.name === 'smithHeartCouncilLimitSettings');
    return { gems: gems as THREE.InstancedMesh, settings: settings as THREE.InstancedMesh };
  };

  it('sets every gem in a larger dark setting, over the hiding players', () => {
    const { root, fx } = host();
    // Two players behind the first pillar (limit 3): two lit, one spent.
    const players = [
      { x: 0, z: 14 },
      { x: 0.3, z: 15 },
    ];
    fx.lay(0, 0, 3, players.length, (i, out) => {
      out.x = players[i].x;
      out.z = players[i].z;
    });
    const { gems, settings } = meshes(root);
    expect(gems.visible).toBe(true);
    expect(settings.visible).toBe(true);
    expect(gems.count).toBe(6);
    expect(settings.count).toBe(6);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const gs = new THREE.Vector3();
    const ss = new THREE.Vector3();
    gems.getMatrixAt(0, m);
    m.decompose(p, q, gs);
    settings.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), q, ss);
    // Over the names (a name rides about 3.5 yd over the floor), bigger than the
    // old 0.42 yd gem, its setting a size larger.
    expect(p.y - 10).toBeGreaterThanOrEqual(5);
    expect(gs.x).toBeGreaterThanOrEqual(0.6);
    expect(ss.x).toBeGreaterThan(gs.x * 1.1);
    // The setting is dark and drawn from behind (an outline round the gem).
    const set = settings.material as THREE.MeshBasicMaterial;
    expect(set.side).toBe(THREE.BackSide);
    expect(set.color.r + set.color.g + set.color.b).toBeLessThan(0.3);
    // The lit gems burn over white (the bloom takes them); the spent one is grey.
    const c = new THREE.Color();
    gems.getColorAt(0, c);
    expect(Math.max(c.r, c.g)).toBeGreaterThan(1);
    gems.getColorAt(2, c);
    expect(c.r).toBeLessThan(0.5);
    expect((gems.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
  });

  it('turns a crowded row blood red, never the lit ochre', () => {
    const { root, fx } = host();
    const players = [0, 1, 2, 3].map((k) => ({ x: (k - 1.5) * 0.4, z: 14 + k * 0.5 }));
    fx.lay(0, 0, 3, players.length, (i, out) => {
      out.x = players[i].x;
      out.z = players[i].z;
    });
    const { gems } = meshes(root);
    const c = new THREE.Color();
    for (let k = 0; k < 3; k++) {
      gems.getColorAt(k, c);
      expect(c.r, `gem ${k}`).toBeGreaterThan(1);
      expect(c.g, `gem ${k}`).toBeLessThan(0.25 * c.r);
    }
    // The other pillar's row stays spent.
    gems.getColorAt(3, c);
    expect(c.r).toBeLessThan(0.5);
    fx.hide();
    expect(meshes(root).gems.visible).toBe(false);
    expect(meshes(root).settings.visible).toBe(false);
  });
});

describe("Smith Heart readability: the Quench lake's glare", () => {
  it('holds the key light on the polish to a glint', () => {
    expect(LAKE_ICE_GLARE).toBeGreaterThan(0);
    expect(LAKE_ICE_GLARE).toBeLessThanOrEqual(0.35);
    expect(LAKE_ICE_GLARE_CAP).toBeLessThanOrEqual(0.25);
    const ice = src('src/render/smith_heart/quench_lake_ice.ts');
    expect(ice).toMatch(
      /#include <lights_fragment_end>[\s\S]*reflectedLight\.directSpecular = min\( reflectedLight\.directSpecular \* \$\{LAKE_ICE_GLARE/,
    );
  });
});
