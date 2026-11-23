// The seasonal city dressing (Gourdlight Eve's pumpkins, lanterns, festival
// poles and strung garlands), drawn exactly where the sim's resolver put them
// (src/sim/seasonal_decor_layout.ts: anchored to lamps, townsfolk and the town
// square, nudged off colliders and roads). This module only paints that list.
//
// Lifetime: nothing is fetched or built until the world first reports the event
// open. Then the kit loads (seasonal_decor_assets.ts), each city's pieces are
// instanced once (one InstancedMesh per glTF primitive per piece kind, plus one
// merged rope per city), and the whole root attaches through the renderer's
// compile gate (gated_scene_attach.ts): hidden until its programs link, so the
// first lit frame never links on a live frame. The gate owns the ROOT's visibility;
// the event's open and close flip an inner content group, so a toggle can never
// reveal the kit before it is linked. A closed event costs one boolean per frame.
// The renderer's teardown disposes what this view built (dispose); the shared
// parts belong to seasonal_decor_assets.ts.
//
// Each city is its own group, shown only within DRAW_RANGE of the camera's
// subject, so a city out of reach submits no draws. The glow (dim by day,
// bright at night, a candle flicker) is the shared driver in seasonal_glow.ts,
// written once per frame for every pumpkin, lantern and worn head together.
// The light those candles throw (halos, ground light, a couple of budgeted point
// lights near the player) is seasonal_decor_lights.ts.
// The indoor pumpkins (a candle-lit jack-o'-lantern on a table or by a wall inside the
// walk-in houses, src/sim/seasonal_interior_pumpkins.ts) join the street list at build,
// so they ride the same instancing, glow, halos and budgeted candle light.
// The road lanterns between the cities (src/sim/seasonal_road_lanterns.ts) build with the
// same kit in short runs (seasonal_road_lanterns_core.ts), each its own ranged group under
// the same gated root, with their halos and candle light; never a separate attach.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GOURDLIGHT_EVE_ID } from '../sim/content/gourdlight_eve';
import { GOURDLIGHT_DECOR_CITIES } from '../sim/content/gourdlight_eve_decor';
import { getActiveWorldContent } from '../sim/data';
import {
  type SeasonalDecorLayout,
  type SeasonalGarland,
  seasonalDecorLayout,
} from '../sim/seasonal_decor_layout';
import {
  type InteriorPumpkinJob,
  interiorPumpkinJob,
  interiorPumpkins,
} from '../sim/seasonal_interior_pumpkins';
import { type RoadLanternJob, roadLanternJob } from '../sim/seasonal_road_lanterns';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import type { BudgetPointLightRegistry } from './point_light_budget';
import {
  type GourdlightAssets,
  type GourdlightDecorNode,
  gourdlightAssets,
} from './seasonal_decor_assets';
import { SeasonalDecorLights } from './seasonal_decor_lights';
import { garlandOrnaments, garlandPolyline } from './seasonal_garland_core';
import { driveSeasonalGlow } from './seasonal_glow';
import { seasonalHalos, seasonalLightSites } from './seasonal_glow_sites_core';
import { SeasonalInteriorWisps } from './seasonal_interior_wisps';
import { roadLanternSegments } from './seasonal_road_lanterns_core';

/** A city's dressing draws within this reach of the player (yards, squared below). */
const DRAW_RANGE = 240;
const DRAW_RANGE_SQ = DRAW_RANGE * DRAW_RANGE;
const ROPE_RADIUS = 0.03;
/** The lanterns and the garland's ornaments read at street distance only bigger
 *  than their authored size (a festival lantern, not a desk lamp). */
const LANTERN_SCALE = 1.6;
const ORNAMENT_SCALE = 1.8;

export type SeasonalDecorCompileGate = (target: THREE.Object3D) => Promise<unknown>;

interface CityView {
  group: THREE.Group;
  x: number;
  z: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  tilt?: number;
}

export class SeasonalDecor {
  readonly root = new THREE.Group();
  /** The event's toggle (the gate drives `root`, never this). */
  private readonly content = new THREE.Group();
  private readonly owned: THREE.Mesh[] = [];
  private disposed = false;
  private cities: CityView[] = [];
  private built = false;
  private ropeMaterial: THREE.Material | null = null;
  private lights: SeasonalDecorLights | null = null;
  private wisps: SeasonalInteriorWisps | null = null;
  private indoorJob: InteriorPumpkinJob | null = null;
  private roadJob: RoadLanternJob | null = null;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly seed: number,
    private readonly activeEvent: () => string | null,
    private readonly compileGate?: SeasonalDecorCompileGate,
    private readonly pointLights: BudgetPointLightRegistry | null = null,
  ) {
    this.root.name = 'seasonal-decor';
    this.content.name = 'seasonal-decor-content';
    this.root.add(this.content);
  }

  /** Per frame: the event's state, the night amount (0 day .. 1 night), the
   *  clock, and the player's position for the per-city reach. */
  update(night: number, time: number, px: number, pz: number, reducedMotion = false): void {
    if (this.disposed) return;
    const active = this.activeEvent() === GOURDLIGHT_EVE_ID;
    if (!active) {
      if (this.built) this.content.visible = false;
      this.lights?.hide();
      return;
    }
    if (!this.built) {
      // the indoor pumpkins resolve one house a frame (never one long stall), while the
      // kit loads; the dressing builds once both are ready
      this.indoorJob ??= interiorPumpkinJob(this.seed);
      const indoorDone = this.indoorJob.step();
      // ...and the road lanterns one route a frame (seasonal_road_lanterns.ts), after it
      this.roadJob ??= roadLanternJob(this.seed);
      const roadDone = indoorDone && this.roadJob.step();
      const assets = gourdlightAssets();
      if (!assets || !indoorDone || !roadDone) return;
      this.build(assets);
    }
    this.content.visible = true;
    for (const city of this.cities) {
      const dx = city.x - px;
      const dz = city.z - pz;
      city.group.visible = dx * dx + dz * dz <= DRAW_RANGE_SQ;
    }
    driveSeasonalGlow(night, time);
    this.wisps?.update(time, reducedMotion);
    // the gate owns root's visibility: no candle light before the kit is linked
    this.lights?.update(night, time, px, pz, this.root.visible);
  }

  private build(assets: GourdlightAssets): void {
    this.built = true;
    const street = seasonalDecorLayout(this.seed);
    const indoor = this.indoorJob?.result ?? interiorPumpkins(this.seed);
    const layout = { ...street, ground: [...street.ground, ...indoor] };
    const zones = getActiveWorldContent().zones;
    const hubs = GOURDLIGHT_DECOR_CITIES.map((rule) => zones.find((z) => z.id === rule.zoneId)?.hub)
      .filter((hub): hub is NonNullable<typeof hub> => hub !== undefined)
      .map((hub) => ({ x: hub.x, z: hub.z }));
    if (hubs.length === 0) return;
    const nearestHub = (x: number, z: number) => {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      hubs.forEach((hub, i) => {
        const d = (hub.x - x) ** 2 + (hub.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    const perCity = hubs.map(() => emptyCity());
    for (const p of layout.ground) perCity[nearestHub(p.x, p.z)].ground.push(p);
    for (const l of layout.lanterns) perCity[nearestHub(l.x, l.z)].lanterns.push(l);
    for (const g of layout.garlands) perCity[nearestHub(g.ax, g.az)].garlands.push(g);
    for (const st of layout.stalls) perCity[nearestHub(st.x, st.z)].stalls.push(st);
    this.ropeMaterial = this.makeRopeMaterial();
    const roads = roadLanternSegments(this.roadJob?.result ?? []);
    const lights = new SeasonalDecorLights(this.scene, this.pointLights, this.seed);
    this.lights = lights;
    lights.setSites(
      seasonalLightSites({
        ...layout,
        ground: [...layout.ground, ...roads.flatMap((r) => r.lanterns)],
      }),
    );
    hubs.forEach((hub, i) => {
      const group = this.buildCity(assets, perCity[i], i);
      for (const o of lights.buildCity(seasonalHalos(perCity[i]), seasonalLightSites(perCity[i])))
        group.add(o);
      // the indoor pumpkins' wisps, in this city's group (gated and ranged with it)
      this.wisps ??= new SeasonalInteriorWisps();
      this.wisps.build(
        group,
        indoor.filter((p) => nearestHub(p.x, p.z) === i),
      );
      group.name = `seasonal-decor-city-${i}`;
      this.content.add(group);
      this.cities.push({ group, x: hub.x, z: hub.z });
    });
    // the road lanterns: one ranged group per run, the same kit, halos and candle light
    roads.forEach((run, i) => {
      const part: SeasonalDecorLayout = { ...emptyCity(), ground: run.lanterns };
      const group = this.buildCity(assets, part, hubs.length + i);
      for (const o of lights.buildCity(seasonalHalos(part), seasonalLightSites(part))) group.add(o);
      group.name = `seasonal-decor-road-${i}`;
      this.content.add(group);
      this.cities.push({ group, x: run.x, z: run.z });
    });
    void attachSceneGroupGated(this.scene, this.root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
  }

  private makeRopeMaterial(): THREE.Material {
    const opts = { color: 0x3b2a18 };
    return GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.92, metalness: 0 })
      : new THREE.MeshLambertMaterial(opts);
  }

  private buildCity(assets: GourdlightAssets, city: SeasonalDecorLayout, cityIndex: number) {
    const group = new THREE.Group();
    const byKind = new Map<GourdlightDecorNode, Placement[]>();
    const add = (kind: GourdlightDecorNode, p: Placement) => {
      const list = byKind.get(kind) ?? [];
      list.push(p);
      byKind.set(kind, list);
    };
    for (const p of city.ground)
      add(p.kind, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale });
    // the keeper's stall: one instance per city, on its resolved footprint
    for (const s of city.stalls) {
      add('keeper_stall', { x: s.x, y: s.y, z: s.z, yaw: s.yaw, scale: s.scale });
    }
    for (const l of city.lanterns) {
      add('lantern', { x: l.x, y: l.y, z: l.z, yaw: l.yaw, scale: LANTERN_SCALE });
    }
    city.garlands.forEach((g, gi) => {
      for (const o of garlandOrnaments(g, cityIndex * 1000 + gi)) {
        add(o.kind === 'leaf' ? 'garland_leaf' : 'garland_bead', {
          x: o.x,
          y: o.y,
          z: o.z,
          yaw: o.kind === 'leaf' ? o.spin : o.yaw,
          scale: o.scale * ORNAMENT_SCALE,
        });
      }
    });
    for (const [kind, placements] of byKind) {
      for (const part of assets.decor[kind]) {
        const mesh = instanced(part, placements);
        this.owned.push(mesh);
        group.add(mesh);
      }
    }
    const rope = this.buildRope(city.garlands);
    if (rope) {
      group.add(rope);
      this.owned.push(rope);
    }
    return group;
  }

  /** Terminal: detach and free what this view built (its instance buffers, the
   *  merged ropes and their material); the shared parts stay with the kit cache.
   *  Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const mesh of this.owned) {
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
      else mesh.geometry.dispose();
    }
    this.owned.length = 0;
    this.ropeMaterial?.dispose();
    this.ropeMaterial = null;
    this.lights?.dispose();
    this.lights = null;
    this.wisps?.dispose();
    this.wisps = null;
    this.cities = [];
  }

  private buildRope(garlands: readonly SeasonalGarland[]): THREE.Mesh | null {
    if (garlands.length === 0 || !this.ropeMaterial) return null;
    const pieces: THREE.BufferGeometry[] = [];
    for (const g of garlands) {
      const pts = garlandPolyline(g).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(pts);
      pieces.push(new THREE.TubeGeometry(curve, pts.length * 2, ROPE_RADIUS, 5, false));
    }
    const merged = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, this.ropeMaterial);
    mesh.name = 'seasonal-garland-rope';
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

function emptyCity(): SeasonalDecorLayout {
  return { ground: [], lanterns: [], garlands: [], stalls: [] };
}

const scratchMatrix = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One InstancedMesh for one glTF primitive of a piece, at every placement. */
function instanced(
  part: { geometry: THREE.BufferGeometry; material: THREE.Material },
  placements: readonly Placement[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
  placements.forEach((p, i) => {
    scratchQuat.setFromAxisAngle(UP, p.yaw);
    scratchPos.set(p.x, p.y, p.z);
    scratchScale.setScalar(p.scale);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    mesh.setMatrixAt(i, scratchMatrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
