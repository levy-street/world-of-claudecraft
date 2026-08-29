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
import {
  type BattlegroundAssetPrewarmUnit,
  createBattlegroundAssetPrewarm,
} from './battleground_asset_prewarm';
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
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import { idleSlot } from './idle_queue';
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

const BG_PREWARM_IDLE_TIMEOUT_MS = 120;
const BG_PREWARM_BATCH_SIZE = 2;

const structuralModel = (path: string): boolean =>
  /\/(?:wall|barrier|fence|pillar|tower|arch|gate|banner)/.test(path);

/** Lazily materialized so players who never show PvP intent do not even decode
 * the generated placement table to build this ordering. Ground comes first,
 * then collision-readable structures, ordinary props, foliage, and decals. */
function battlegroundAssetPrewarmUnits(): BattlegroundAssetPrewarmUnit[] {
  const assets = battlegroundPreloadAssetPaths();
  const paint = assets.textures.filter((texture) => !texture.srgb);
  const decals = assets.textures.filter((texture) => texture.srgb);
  const structures = assets.models.filter(structuralModel);
  const props = assets.models.filter(
    (path) => !structuralModel(path) && !path.includes('/foliage/'),
  );
  const foliage = assets.models.filter((path) => path.includes('/foliage/'));
  return [
    { id: 'shared:dungeon-kit', run: ensureDungeonAssets },
    ...paint.map(({ path, srgb }) => ({
      id: `texture:${path}`,
      run: () => loadTexture(path, { srgb }),
    })),
    ...[...structures, ...props, ...foliage].map((path) => ({
      id: `model:${path}`,
      run: () => loadGltf(path),
    })),
    ...decals.map(({ path, srgb }) => ({
      id: `texture:${path}`,
      run: () => loadTexture(path, { srgb }),
    })),
  ];
}

export const battlegroundAssetPrewarm = createBattlegroundAssetPrewarm(
  battlegroundAssetPrewarmUnits,
  {
    idle: () =>
      idleSlot(BG_PREWARM_IDLE_TIMEOUT_MS, { maxTimeoutDeferrals: 2 }).then(() => undefined),
    batchSize: BG_PREWARM_BATCH_SIZE,
  },
);

/** The renderer-owned hooks the field plugs into (the yumi signature shape). */
export interface BattlegroundLightHooks {
  lowGfx: boolean;
  /** Unused by this field, unlike the yumi maze it mirrors: Thornhollow's fire
   *  is one shader-animated Points draw per fixture family
   *  (`buildLanternFlames`), never a Mesh the renderer's flicker pass rescales. */
  flames?: THREE.Mesh[];
  /** The renderer's shared fire-light registry. The field's authored lights MUST
   *  land here (see buildBgFieldLights). */
  fireLights?: THREE.PointLight[];
  /** Called after the field pushes lights into, or splices them out of,
   *  `fireLights`, so the renderer can rebuild its light rank. */
  onFireLightsChanged?: () => void;
  /** The renderer's async shader-compile gate (renderer.compileGate). When
   *  present, every streamed field piece attaches hidden and reveals only once
   *  its programs are linked (gated_scene_attach.ts); absent means no
   *  KHR_parallel_shader_compile, so pieces attach direct and link at first
   *  draw, exactly as before. */
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
}

/** Authored intensities are map units; the renderer's lights are much dimmer. */
const BG_LIGHT_INTENSITY_SCALE = 0.05;

/**
 * Build the field's authored point lights INTO the renderer's shared fire-light
 * budget, and return them so the view can hand them back on dispose.
 *
 * They MUST be ranked there. Three counts a light into numPointLights iff
 * `visible`, that count is part of every lit material's program cache key, and
 * the field streams in mid-session: up to 14 unranked lights appearing at once
 * is a synchronous relink of every lit material in view, the exact stall the
 * pinned point-light count exists to prevent.
 */
export function buildBgFieldLights(fireLights?: THREE.PointLight[]): THREE.PointLight[] {
  const budget = BG_LIGHT_BUDGET_BY_TIER[GFX.tier] ?? 6;
  const authored = [...bgFieldLights()]
    .sort((a, b) => b.intensity * b.range - a.intensity * a.range)
    .slice(0, budget);
  const built: THREE.PointLight[] = [];
  for (const l of authored) {
    const intensity = l.intensity * BG_LIGHT_INTENSITY_SCALE;
    const light = new THREE.PointLight(l.color, intensity, l.range, 2);
    light.position.set(l.x, l.y, l.z);
    // The budget's flicker pass drives contributing fire lights from
    // userData.baseIntensity and falls back to its own bright default: these are
    // deliberately dim cosmetic warmth, so state their level and let it flicker
    // around THAT (the Mirefen impact-site light does the same, impact_site.ts).
    light.userData.baseIntensity = intensity;
    // Hidden until the first budget pass ranks it, exactly like the fire lights
    // the renderer hides at boot: the field lands between frames, and a visible
    // light the rank has never seen would change the pinned count.
    light.visible = false;
    built.push(light);
    fireLights?.push(light);
  }
  return built;
}

/** Hand the field's lights back to the shared budget. Idempotent, and it leaves
 *  every other owner's light in place. */
export function releaseBgFieldLights(
  lights: readonly THREE.PointLight[],
  fireLights?: THREE.PointLight[],
): void {
  if (!fireLights) return;
  for (const light of lights) {
    const index = fireLights.indexOf(light);
    if (index >= 0) fireLights.splice(index, 1);
  }
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

/** The authored blood decals in the Fightpit: flat, ground-hugging quads.
 *  ONE material per texture, shared across every quad that paints it: the
 *  compile gate cuts its queue units per material, so a per-quad material
 *  would submit a dozen units for one program's worth of work. */
async function buildDecals(heightAt: (x: number, z: number) => number): Promise<THREE.Mesh[]> {
  const out: THREE.Mesh[] = [];
  const matByTex = new Map<string, THREE.MeshBasicMaterial>();
  for (const d of bgFieldDecals()) {
    try {
      let mat = matByTex.get(d.tex);
      if (!mat) {
        const tex = await loadTexture(`${BG_TEXTURE_DIR}/decals/${d.tex}.webp`, { srgb: true });
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          opacity: 0.85,
        });
        matByTex.set(d.tex, mat);
      }
      const geo = new THREE.PlaneGeometry(d.size, d.size);
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
  // Queue intent normally commits the prewarm first; reconnecting directly
  // into an active match deliberately takes this fail-soft streaming path.
  //
  // Gate COMPILATION, not availability: the group is already live in the scene
  // while the field streams, so a piece added visible would link its shader
  // programs synchronously on its first visible frame (the first-match hitch).
  // Each piece still attaches the moment its load lands, hidden, and reveals
  // once its own programs are linked; each piece submits its own gate, and the
  // renderer's shared queue owns pacing and order, so the field keeps filling
  // in piece by piece. Dispose cancels a pending reveal; the dispose()/disposed
  // guards below keep owning every resource release, exactly as ungated.
  //
  // The trade this inherits from the interiors seam, stated out loud: on a
  // reconnect into a live match the client stays responsive while collider-
  // bearing pieces (the terrain and placements ARE the colliders) are still
  // linking, so a wall can block invisibly for the link duration, where it
  // used to freeze the whole frame for that same time. The mirror image also
  // holds: entity views carry their own gate and reveal independently, so for
  // the same window a fighter can be visible THROUGH a keep wall that has not
  // drawn yet. Both are transient, tier-neutral, and the same trade the
  // interiors seam ships. A reach floor or imminence elevation is the tracked
  // follow-up if fleet attach-watchdog captures show that window mattering.
  const attachPieceGated = (piece: THREE.Object3D): void => {
    void attachSceneGroupGated(group, piece, opts.compileGate, () => disposed).catch(() => {
      // A field retired mid-gate cancels its reveal; dispose() owns teardown.
    });
  };
  void (async () => {
    try {
      const { bgFieldHeightLocal } = await import('../sim/battleground_field');
      terrain = await buildBattlegroundTerrain({ lowGfx: opts.lowGfx });
      if (disposed) {
        terrain.dispose();
        return;
      }
      attachPieceGated(terrain.group);

      // The wards go up with the ground: they are the visible half of rules
      // the sim already enforces, so their AVAILABILITY is never gated (a
      // rule enforced behind a hidden ward is exactly the invisible refusal
      // this module exists to prevent, and a gated reveal rides the queue's
      // priority and the initial-paint barrier, seconds behind on a slow
      // driver). They attach visible immediately; the gate is only their fast
      // path for the link itself: prewarm the one small shared ward program
      // off-thread now, so the first countdown reveal finds it already linked
      // instead of paying a first-draw sync link. Fail-soft on rejection: the
      // ungated first-draw link is the same tiny cost as before this seam.
      wards = buildBgWards();
      group.add(wards.group);
      void opts.compileGate?.(wards.group).catch(() => undefined);
      if (pendingWard) wards.setState(pendingWard);

      placements = await buildBattlegroundPlacements(bgAssetGroups(), { lowGfx: opts.lowGfx });
      if (disposed) {
        placements.dispose();
        return;
      }
      attachPieceGated(placements.group);

      const grass = buildGrass();
      if (grass) {
        // Named so a stuck gate's watchdog event attributes to the field.
        grass.name = 'battleground-grass';
        owned.push(grass.geometry, grass.material as THREE.Material);
        attachPieceGated(grass);
      }

      const decalMeshes = await buildDecals(bgFieldHeightLocal);
      // The decal load has no early-out of its own: on a field retired while
      // it was in flight, release the meshes inline (their maps stay owned by
      // the loader cache) instead of attaching them to a dead group.
      if (disposed) {
        const releasedMats = new Set<THREE.Material>();
        for (const mesh of decalMeshes) {
          mesh.geometry.dispose();
          releasedMats.add(mesh.material as THREE.Material);
        }
        for (const mat of releasedMats) mat.dispose();
        return;
      }
      if (decalMeshes.length > 0) {
        // One gate for the whole decal family: one shared material per
        // texture (buildDecals), so the queue sees a couple of pieces.
        const decalGroup = new THREE.Group();
        decalGroup.name = 'battleground-decals';
        const decalMats = new Set<THREE.Material>();
        for (const mesh of decalMeshes) {
          owned.push(mesh.geometry);
          decalMats.add(mesh.material as THREE.Material);
          decalGroup.add(mesh);
        }
        owned.push(...decalMats);
        attachPieceGated(decalGroup);
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
          attachPieceGated(flames);
        }
      }

      // Belt over the early-outs above: a light registered on a torn-down
      // field would rank, and shine, for a field that no longer exists.
      if (disposed) return;
      for (const light of buildBgFieldLights(opts.fireLights)) {
        lights.push(light);
        group.add(light);
      }
      if (lights.length > 0) opts.onFireLightsChanged?.();

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
      // Out of the shared budget BEFORE the lights are disposed: a left-behind
      // registry entry would keep ranking (and could keep counting) a light
      // that no longer belongs to any scene.
      releaseBgFieldLights(lights, opts.fireLights);
      if (lights.length > 0) opts.onFireLightsChanged?.();
      wards?.dispose();
      terrain?.dispose();
      placements?.dispose();
      for (const light of lights) light.dispose();
      for (const o of owned) o.dispose();
      group.clear();
    },
  };
}
