// Thornhollow Fields battleground field (Thornhollow): the Three half of the render
// layer. One view per match slot, built lazily by the renderer when the player
// is near (the yumi_maze pattern).
//
// The field is an AUTHORED map, so this builder assembles rather than
// generates: the ground mesh comes from the same heightfield the sim walks on
// (battleground_terrain.ts), and every wall, tree, crate and torch is a
// catalogue GLB instanced from the generated placement record
// (battleground_placements.ts), which the SAME compiler derived the colliders
// from. What you see is what blocks you, by construction.
//
// Flags, runes and their state animation are ENTITY props (battleground_props.ts
// driven by the sim), not field geometry, so nothing here has to track match
// state; this view is static once built.
//
// Graphics fairness: nothing gameplay-actionable is tier-gated. Ground paint,
// the field's art and its point lights render on every tier; only shadow
// casting and paint texture resolution follow the tier.
import * as THREE from 'three';
import { TH_PLACEMENTS } from '../sim/thornhollow_field.generated';
import { loadGltf, loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  BG_FLOOR_Y,
  BG_TEXTURE_DIR,
  bgAssetGroups,
  bgFieldDecals,
  bgFieldLights,
  bgGrassPatches,
  bgPaintTextureFiles,
} from './battleground_core';
import { buildLanternFlames } from './battleground_lantern_fx';
import { TORCH_FLAME, TORCH_HEAD_LOCAL } from './battleground_lantern_fx_core';
import { type BgPlacementsView, buildBattlegroundPlacements } from './battleground_placements';
import { type BgTerrainView, buildBattlegroundTerrain } from './battleground_terrain';
import { type BgWardState, type BgWardView, buildBgWards } from './battleground_ward';
import { ensureDungeonAssets } from './dungeon';
import { GFX } from './gfx';
import { freezeStaticMatrices } from './static_matrix';

export * from './battleground_core';

/** The field's point-light budget. The map authors 12 lights (the flag stands'
 *  team glow, the gate and gatehouse flames, the ruin pit fires, the
 *  graveyards); every one is cosmetic warmth, so the low tier keeps the
 *  brightest few rather than all of them. */
const BG_LIGHT_BUDGET_BY_TIER: Record<string, number> = {
  low: 0,
  medium: 6,
  high: 14,
  ultra: 14,
};

export interface BattlegroundPreloadAssetPaths {
  models: string[];
  textures: Array<{ path: string; srgb: boolean }>;
}

/** The tier-independent preload superset for collision-relevant field art. */
export function battlegroundPreloadAssetPaths(): BattlegroundPreloadAssetPaths {
  const decalPaths = new Set(bgFieldDecals().map((d) => `${BG_TEXTURE_DIR}/decals/${d.tex}.webp`));
  return {
    models: bgAssetGroups().map((g) => g.path),
    textures: [
      ...bgPaintTextureFiles().map((path) => ({ path, srgb: false })),
      ...[...decalPaths].map((path) => ({ path, srgb: true })),
    ],
  };
}

let battlegroundAssetsPromise: Promise<void> | null = null;

export function ensureBattlegroundAssets(): Promise<void> {
  battlegroundAssetsPromise ??= (() => {
    const assets = battlegroundPreloadAssetPaths();
    return Promise.all([
      ensureDungeonAssets(),
      ...assets.models.map((path) => loadGltf(path)),
      ...assets.textures.map(({ path, srgb }) => loadTexture(path, { srgb })),
    ]).then(() => undefined);
  })();
  return battlegroundAssetsPromise;
}

// The DEFERRED lane: the field's art is only ever needed by a player who enters
// the band, so it must not compete with the launcher's own fetches.
if (typeof window !== 'undefined') registerDeferredPreload(() => ensureBattlegroundAssets());

/** The renderer-owned hooks the field plugs into (the yumi signature shape). */
export interface BattlegroundLightHooks {
  lowGfx: boolean;
  flames?: THREE.Mesh[];
  fireLights?: THREE.PointLight[];
}

export interface BattlegroundView {
  group: THREE.Group;
  /** Drive the field's state-dependent wards (the form-up gate, the grave
   *  ward). Cheap and idempotent: it only sets visibility flags. */
  setWardState(state: BgWardState): void;
  dispose(): void;
}

/** Grass tufts: unlit cross-billboards tinted by the placement's own hue/lum,
 *  merged into one mesh. Cheap ground cover that softens the ravine floor.
 *
 *  Each blade is a tapered cross of two quads, DARK at the root and full colour
 *  at the tip. The gradient is what makes a tuft read as grass rather than as a
 *  flat card lying on the ground: an unlit quad at one tone has no contact
 *  shadow of its own, so it floats no matter how small it is drawn. Blade size
 *  and lean vary per blade from the same positional hash the offsets use, so
 *  the field is identical on every host. */
function buildGrass(): THREE.Mesh | null {
  const patches = bgGrassPatches();
  if (patches.length === 0) return null;
  const perPatch = 5;
  const spread = 1.7;
  const verts: number[] = [];
  const colors: number[] = [];
  const idx: number[] = [];
  const tip = new THREE.Color();
  const root = new THREE.Color();
  for (const p of patches) {
    // Deterministic spread inside the patch: the placement's own coordinates
    // seed the offsets, so the field looks identical on every host.
    for (let i = 0; i < perPatch; i++) {
      const a = Math.sin((p.x * 12.9898 + p.z * 78.233 + i * 37.719) * 43758.5453);
      const b = Math.sin((p.x * 93.9898 + p.z * 27.345 + i * 11.135) * 24634.6345);
      const ra = a - Math.floor(a);
      const rb = b - Math.floor(b);
      const ox = (ra - 0.5) * spread;
      const oz = (rb - 0.5) * spread;
      const yaw = ra * Math.PI;
      const bladeH = 0.22 + rb * 0.3;
      const bladeW = 0.1 + ra * 0.11;
      const lean = (rb - 0.5) * 0.2;
      const hue = (((p.hue ?? 95) + (ra - 0.5) * 14) % 360) / 360;
      // Deliberately DARKER than the ground it grows out of. These quads are
      // unlit and the post chain blooms, so a tuft mixed at the ground's own
      // brightness comes back paler than the ground and reads as litter; a dark
      // tuft over bright meadow reads as grass.
      const lum = Math.max(0.05, Math.min(0.4, 0.08 + (p.lum ?? 0) * 0.28));
      tip.setHSL(hue, 0.5, lum);
      root.setHSL(hue, 0.58, lum * 0.45);
      const base = verts.length / 3;
      for (const turn of [yaw, yaw + Math.PI / 2]) {
        const dx = (Math.cos(turn) * bladeW) / 2;
        const dz = (Math.sin(turn) * bladeW) / 2;
        const x = p.x + ox;
        const z = p.z + oz;
        const y = p.seatY;
        // Root pair at full width, tip pair narrowed and leaned over: a taper,
        // not a rectangle.
        const tx = x + Math.cos(yaw) * lean;
        const tz = z + Math.sin(yaw) * lean;
        verts.push(
          x - dx,
          y,
          z - dz,
          x + dx,
          y,
          z + dz,
          tx + dx * 0.35,
          y + bladeH,
          tz + dz * 0.35,
          tx - dx * 0.35,
          y + bladeH,
          tz - dz * 0.35,
        );
        colors.push(root.r, root.g, root.b, root.r, root.g, root.b);
        colors.push(tip.r, tip.g, tip.b, tip.r, tip.g, tip.b);
      }
      for (let q = 0; q < 2; q++) {
        const o = base + q * 4;
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** The authored blood decals in the Fightpit: flat, ground-hugging quads. */
async function buildDecals(heightAt: (x: number, z: number) => number): Promise<THREE.Mesh[]> {
  const out: THREE.Mesh[] = [];
  for (const d of bgFieldDecals()) {
    try {
      const tex = await loadTexture(`${BG_TEXTURE_DIR}/decals/${d.tex}.webp`, { srgb: true });
      const geo = new THREE.PlaneGeometry(d.size, d.size);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(-Math.PI / 2, 0, d.rot);
      mesh.position.set(d.x, heightAt(d.x, d.z) + BG_FLOOR_Y, d.z);
      mesh.renderOrder = 1;
      out.push(mesh);
    } catch {
      // A missing decal is pure dressing: never fail the field for one.
    }
  }
  return out;
}

export function buildBattleground(
  origin: { x: number; z: number },
  _seed: number,
  opts: BattlegroundLightHooks,
): BattlegroundView {
  const group = new THREE.Group();
  group.name = 'battleground';
  // Field-local coordinates throughout: the group sits at the slot origin at
  // y=0, and the terrain carries its own absolute heights, exactly as the sim
  // reports them through groundHeight's band arm.
  group.position.set(origin.x, 0, origin.z);

  let terrain: BgTerrainView | null = null;
  let wards: BgWardView | null = null;
  let pendingWard: BgWardState | null = null;
  let placements: BgPlacementsView | null = null;
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  const lights: THREE.PointLight[] = [];
  let disposed = false;

  // The field streams in: the ground mesh and the art both need async loads
  // (the paint texture array, one GLB per asset group), and the renderer's
  // build call is synchronous. Everything lands in the same group, so a player
  // who arrives mid-stream sees the field fill in rather than nothing at all.
  void (async () => {
    try {
      const { bgFieldHeightLocal } = await import('../sim/battleground_field');
      terrain = await buildBattlegroundTerrain({ lowGfx: opts.lowGfx });
      if (disposed) {
        terrain.dispose();
        return;
      }
      group.add(terrain.group);

      // The wards go up with the ground: they are the visible half of rules the
      // sim already enforces, so they must not wait on the art stream.
      wards = buildBgWards();
      group.add(wards.group);
      if (pendingWard) wards.setState(pendingWard);

      placements = await buildBattlegroundPlacements(bgAssetGroups(), { lowGfx: opts.lowGfx });
      if (disposed) {
        placements.dispose();
        return;
      }
      group.add(placements.group);

      const grass = buildGrass();
      if (grass) {
        owned.push(grass.geometry, grass.material as THREE.Material);
        group.add(grass);
      }

      for (const mesh of await buildDecals(bgFieldHeightLocal)) {
        owned.push(mesh.geometry, mesh.material as THREE.Material);
        group.add(mesh);
      }

      // Fire: one Points draw per fixture family for the WHOLE field, animated
      // entirely in its vertex shader off the shared clock (no tick here). The
      // rune-pad lamps burn behind glass; the wall torches down every keep,
      // curtain and gatehouse face burn in the open, which is why they carry
      // their own seat offset and tuning. Unlit iron cages on otherwise dressed
      // stone was the thing that read as unfinished.
      for (const fixture of [
        { assetId: 'dungeon/post_lantern', local: undefined, flame: undefined },
        { assetId: 'dungeon/torch_mounted', local: TORCH_HEAD_LOCAL, flame: TORCH_FLAME },
      ]) {
        const flames = buildLanternFlames(TH_PLACEMENTS, {
          lowGfx: opts.lowGfx,
          assetId: fixture.assetId,
          local: fixture.local,
          flame: fixture.flame,
        });
        if (flames) {
          owned.push(flames.geometry, flames.material as THREE.Material);
          group.add(flames);
        }
      }

      const budget = BG_LIGHT_BUDGET_BY_TIER[GFX.tier] ?? 6;
      const authored = [...bgFieldLights()]
        .sort((a, b) => b.intensity * b.range - a.intensity * a.range)
        .slice(0, budget);
      for (const l of authored) {
        const light = new THREE.PointLight(l.color, l.intensity * 0.05, l.range, 2);
        light.position.set(l.x, l.y, l.z);
        lights.push(light);
        group.add(light);
      }

      freezeStaticMatrices(group);
    } catch (err) {
      console.warn('battleground: field build failed', err);
    }
  })();

  return {
    group,
    setWardState(state: BgWardState): void {
      // The field streams in, so a state that arrives before the wards exist is
      // remembered rather than dropped.
      if (wards) wards.setState(state);
      else pendingWard = state;
    },
    dispose(): void {
      disposed = true;
      group.removeFromParent();
      wards?.dispose();
      terrain?.dispose();
      placements?.dispose();
      for (const light of lights) light.dispose();
      for (const o of owned) o.dispose();
      group.clear();
    },
  };
}
