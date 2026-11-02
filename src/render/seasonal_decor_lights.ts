// The seasonal dressing's candlelight beyond the props' own emissive (the
// painter half of seasonal_glow_sites_core.ts):
//   - HALOS: one instanced, camera-facing additive sprite per lit pumpkin, paper
//     lantern and garland bead. A carved face only glows from the front; the halo
//     wraps the silhouette, so a lit pumpkin reads as lit from behind and from
//     above too. Depth-tested (a wall still hides it), never depth-writing. Each
//     sprite flickers on its own phase in the vertex shader (no per-frame walk).
//   - GROUND LIGHT: the merged sites join the night light field
//     (night_light_field.ts) while the event shows, so the street round a cluster
//     of pumpkins is lit as by a real light; on the Lambert tier, which splices
//     no field, they become draped additive pools (ground_glow_patch.ts), the
//     streetlamps' own fallback.
//   - POINT LIGHTS: a fixed pool of SEASONAL_POINT_LIGHTS dynamic carrier sources
//     in the renderer's ranked budget (adoptDynamicBudgetLight), handed each frame
//     to the sites nearest the player, so the keeper and anyone standing by a
//     pumpkin is warmly lit after dark. Never a light three gathers itself.
// All of it is dark and hidden by day (the halos and pools are hidden, the field
// sites carry nothing at zero glow, the pool lights sit at intensity 0).
//
// GPU: the halo and pool materials are built with the rest of the city view and
// ride the same compile gate as the kit (seasonal_decor.ts attaches the whole
// root through attachSceneGroupGated), so neither links on a live frame. The
// halo's program is one cached variant (`customProgramCacheKey`).
import * as THREE from 'three';
import { terrainHeight } from '../sim/world';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { sharedUniforms } from './gfx';
import { buildDrapedGlowGeometry } from './ground_glow_patch';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
import { adoptDynamicBudgetLight, type BudgetPointLightRegistry } from './point_light_budget';
import { seasonalFlicker } from './seasonal_glow_core';
import {
  haloFalloff,
  nearestLightSites,
  type SeasonalHalo,
  type SeasonalLightSite,
} from './seasonal_glow_sites_core';

/** Budgeted point lights the dressing may hold at once. */
export const SEASONAL_POINT_LIGHTS = 2;
/** A pool light only goes to a site this near the player (yards). */
const POINT_LIGHT_REACH = 18;
const POINT_LIGHT_COLOR = new THREE.Color(1.0, 0.55, 0.2);
const POINT_LIGHT_INTENSITY = 2.4;
const HALO_COLOR = new THREE.Color(1.0, 0.56, 0.16);
const HALO_OPACITY = 0.62;
const POOL_COLOR = new THREE.Color(1.0, 0.5, 0.15);
const POOL_OPACITY = 0.42;
/** Night light field: linear colour and the strength per unit of site strength. */
const FIELD_COLOR = [1.0, 0.48, 0.14] as const;
const FIELD_INTENSITY = 9;
const FIELD_FLICKER = 0.14;
const FIELD_OWNER = 'seasonal-decor';
/** Below this night amount the candlelight shows nothing at all. */
const DARK_EPSILON = 0.02;

/** The halo's soft candle bloom (no canvas, no DOM: the falloff is computed),
 *  a warm core easing out with no hard disc edge. */
function haloTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const a = haloFalloff(Math.hypot(dx, dy) * 2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The camera-facing, self-flickering halo material (one cached program). */
function haloMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map,
    color: HALO_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  material.name = 'SeasonalHalo';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying float vWocFlicker;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( 0.0, 0.0, 0.0, 1.0 );
        float wocSize = 1.0;
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          wocSize = length( instanceMatrix[ 0 ].xyz );
          float wocPhase = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
        #else
          float wocPhase = 0.0;
        #endif
        vWocFlicker = 1.0 + 0.16 * ( 0.55 * sin( uTime * 8.7 + wocPhase ) + 0.3 * sin( uTime * 21.3 + wocPhase * 2.7 ) + 0.15 * sin( uTime * 3.9 + wocPhase * 0.6 ) );
        mvPosition = modelViewMatrix * mvPosition;
        mvPosition.xy += position.xy * wocSize;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vWocFlicker;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= vWocFlicker;`,
      );
  };
  // instanced-only by construction (buildCity): one variant, one key
  material.customProgramCacheKey = () => 'woc-seasonal-halo-instanced';
  return material;
}

const haloMatrix = new THREE.Matrix4();

export class SeasonalDecorLights {
  private readonly haloMap = haloTexture();
  /** For the view test: the budgeted lights, built on the kit's first build. */
  get candleLights(): readonly THREE.PointLight[] {
    return this.pointLights;
  }
  private readonly haloMat = haloMaterial(this.haloMap);
  private readonly poolMat: THREE.MeshBasicMaterial | null;
  private readonly halos: THREE.InstancedMesh[] = [];
  private readonly pools: THREE.Mesh[] = [];
  private readonly pointLights: THREE.PointLight[] = [];
  /** Each pool light's own holder, shown only while its light is lit: the budget
   *  ranks a light by its ancestors' visibility, never its intensity, so a dark
   *  light left eligible would take a carrier slot from a burning lamp. */
  private readonly holders: THREE.Group[] = [];
  private readonly pick: number[] = new Array(SEASONAL_POINT_LIGHTS).fill(0);
  private readonly pickD2: number[] = new Array(SEASONAL_POINT_LIGHTS).fill(0);
  private sites: readonly SeasonalLightSite[] = [];
  private fieldOn = false;
  private lit = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly registry: BudgetPointLightRegistry | null,
    private readonly seed: number,
  ) {
    this.poolMat = hasNightLightField()
      ? null
      : new THREE.MeshBasicMaterial({
          map: this.haloMap,
          color: POOL_COLOR,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
  }

  /** One city's halos (and, on the Lambert tier, its ground pools), for its group. */
  buildCity(halos: readonly SeasonalHalo[], sites: readonly SeasonalLightSite[]): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (halos.length > 0) {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        this.haloMat,
        halos.length,
      );
      halos.forEach((h, i) => {
        haloMatrix.makeScale(h.size, h.size, h.size).setPosition(h.x, h.y, h.z);
        mesh.setMatrixAt(i, haloMatrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = 'seasonal-halos';
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.halos.push(mesh);
      out.push(mesh);
    }
    if (this.poolMat && sites.length > 0) {
      const pool = new THREE.Mesh(
        buildDrapedGlowGeometry(
          sites.map((s) => ({ x: s.x, z: s.z, radius: s.radius * 0.7 })),
          (x, z) => terrainHeight(x, z, this.seed),
        ),
        this.poolMat,
      );
      pool.geometry.computeBoundingSphere();
      pool.name = 'seasonal-glow-pools';
      pool.renderOrder = floorVfxRenderOrder('ground', 0);
      pool.matrixAutoUpdate = false;
      pool.visible = false;
      this.pools.push(pool);
      out.push(pool);
    }
    return out;
  }

  /** The whole dressing's ground-light sites, and the budgeted pool lights
   *  (built once, at the kit's build). */
  setSites(sites: readonly SeasonalLightSite[]): void {
    this.sites = sites;
    if (this.pointLights.length > 0) return;
    for (let i = 0; i < SEASONAL_POINT_LIGHTS; i++) {
      const light = new THREE.PointLight(POINT_LIGHT_COLOR, 0, 8, 1.6);
      light.name = `seasonal-candle-light-${i}`;
      light.castShadow = false;
      // marked as a carrier source BEFORE it can be gathered (point_light_budget.ts)
      adoptDynamicBudgetLight(light, this.registry);
      const holder = new THREE.Group();
      holder.name = `seasonal-candle-holder-${i}`;
      holder.visible = false;
      holder.add(light);
      this.scene.add(holder);
      this.holders.push(holder);
      this.pointLights.push(light);
    }
  }

  /** Per frame while the dressing shows: the night amount, the clock, the player,
   *  and whether the dressing is revealed (its compile gate has settled). Called
   *  before the renderer's budget pass, so the holders' visibility is current. */
  update(night: number, time: number, px: number, pz: number, revealed = true): void {
    const lit = night > DARK_EPSILON;
    if (lit !== this.lit) {
      this.lit = lit;
      for (const h of this.halos) h.visible = lit;
      for (const p of this.pools) p.visible = lit;
    }
    this.setField(true);
    if (!lit || !revealed) {
      this.darkenLights();
      return;
    }
    this.haloMat.opacity = HALO_OPACITY * night;
    if (this.poolMat) this.poolMat.opacity = POOL_OPACITY * night * seasonalFlicker(time, 1.3);
    const n = nearestLightSites(this.sites, px, pz, POINT_LIGHT_REACH, this.pick, this.pickD2);
    for (let i = 0; i < this.pointLights.length; i++) {
      const light = this.pointLights[i];
      this.holders[i].visible = i < n;
      if (i >= n) {
        light.intensity = 0;
        continue;
      }
      const site = this.sites[this.pick[i]];
      light.position.set(site.x, site.y + 0.5, site.z);
      light.distance = site.radius + 3;
      light.intensity =
        POINT_LIGHT_INTENSITY * site.strength * night * seasonalFlicker(time, 0.9 + i * 1.7);
    }
  }

  /** The event closed (or the dressing hid): no light anywhere. */
  hide(): void {
    this.setField(false);
    this.darkenLights();
  }

  private darkenLights(): void {
    for (let i = 0; i < this.pointLights.length; i++) {
      this.pointLights[i].intensity = 0;
      this.holders[i].visible = false;
    }
  }

  private setField(on: boolean): void {
    if (on === this.fieldOn) return;
    this.fieldOn = on;
    registerStaticNightLights(
      FIELD_OWNER,
      on
        ? this.sites.map((s) => ({
            x: s.x,
            y: s.y,
            z: s.z,
            radius: s.radius,
            r: FIELD_COLOR[0],
            g: FIELD_COLOR[1],
            b: FIELD_COLOR[2],
            intensity: FIELD_INTENSITY * s.strength,
            flicker: FIELD_FLICKER,
          }))
        : [],
    );
  }

  /** Terminal: release the lights, the field sites and what this built. */
  dispose(): void {
    this.setField(false);
    for (const light of this.pointLights) {
      this.registry?.release(light);
      light.removeFromParent();
    }
    for (const holder of this.holders) holder.removeFromParent();
    this.holders.length = 0;
    this.pointLights.length = 0;
    for (const h of this.halos) {
      h.geometry.dispose();
      h.dispose();
    }
    for (const p of this.pools) p.geometry.dispose();
    this.halos.length = 0;
    this.pools.length = 0;
    this.haloMat.dispose();
    this.poolMat?.dispose();
    this.haloMap.dispose();
  }
}
