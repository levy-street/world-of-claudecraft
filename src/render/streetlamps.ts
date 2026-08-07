// Streetlamps: one modeled fixture identity per authored area, standing beside
// every road in the world. Dark by day, lit through the night, so the whole
// road network stays readable after dusk without the world ceasing to read as
// night. The compact procedural fixture below is retained only as a synchronous
// fallback for headless tests or a failed/missing preload.
//
// A lamp is a REAL light, not a decal. Two things make it, and neither is a
// painted pool on the ground:
//   1. the night light field (night_light_field.ts), which lights terrain with
//      true direction, distance falloff and surface normal from the fixture's
//      authored socket, so the road brightens because something above it is
//      burning, not because a sprite was laid over it,
//   2. the fixture's own AUTHORED emissive materials (streetlamp_emissive.ts),
//      driven above the bloom threshold so the lamp reads as the source.
// Per-fixture PointLights are still deliberately avoided: the renderer budgets
// them by proximity, which made identical lamps alternate between blown-out and
// dim. The field is the same physics without the budget lottery.
//
// The additive draped pool this used to stack on top of the field is GONE. It
// was the artificial half: a flat radial sprite that ignored the surface it
// lay on and read as a painted disc rather than as light. It survives only on
// the Lambert tier, which compiles no standard splat material for the field to
// splice and would otherwise have no ground illumination at all.
//
// Every anchor below comes from the model's own authored LIGHT_SOCKET, so a
// hanging lantern lights the ground under the LANTERN rather than under the
// foot of its post, and the light cannot drift from the thing that glows.
//
// The same socket decides which way a fixture is turned. Each style is measured
// once (streetlamp_assets `lightAxis`: foot of the post to socket), and every
// post is instanced at the yaw that swings that axis over the road, so the lit
// end of a fixture overhangs the track and the post is left standing on the far
// side of it, whichever edge the artist hung the light off.
//
// A lamp post is SOLID, and the sim owns it. `src/sim/streetlamp_layout.ts`
// lays the network out (every road end to end, clearance-banded against the
// sim's roadDistance so a post stands beside the PAINTED track, never on it,
// with ground heights from the sim's terrainHeight per the "terrain height =
// sim height" invariant), `src/sim/colliders.ts` plants a collider on every
// site, and this module instances the fixtures on the SAME list via
// `streetlampPlacements`. So the lamp you walk into is the lamp you see, and
// neither half can drift from the other.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { streetlampPlacements } from '../sim/colliders';
import { getActiveWorldContent } from '../sim/data';
import { lampFixtureYaw, type PlacedStreetlamp } from '../sim/streetlamp_layout';
import type { StreetlampStyleId } from '../sim/streetlamp_style';
import { terrainHeight } from '../sim/world';
import { attachBiomeHaze } from './biome_haze_field';
import { GFX } from './gfx';
import { buildDrapedGlowGeometry, type GlowPatchSite } from './ground_glow_patch';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
import { STREETLAMP_ASSET_DEFS, streetlampAsset } from './streetlamp_assets';
import { type StreetlampEmissiveState, updateStreetlampEmissive } from './streetlamp_emissive';
import { radialGlowTexture } from './textures';

export interface StreetlampsView {
  group: THREE.Group;
  /** Kept for the renderer feature-view contract; lamp illumination is field-based. */
  glowLights: THREE.PointLight[];
  /** per-zone subtrees, so the zone-feature distance cull works per zone */
  cullGroups: THREE.Group[];
  /** Drive the whole set from the frame's lamp glow amount (0 = out, 1 = full). */
  update(glow: number, time: number): void;
}

/** The whole fixture is authored at unit scale and blown up by this. */
export const LAMP_SCALE = 1.5;

const POST_HEIGHT = 2.7;
const IRON_COLOR = 0x3a3128;
const GLASS_COLOR = 0xffdca0;
// Warmer than the first pass on purpose: the lantern reads amber, not white.
const GLASS_EMISSIVE = 0xffa14a;
const FALLBACK_SOURCE_EMISSIVE = 0.8;
/** Lambert-tier fallback only: the field needs a standard splat material to
 *  splice, so the low tier keeps the draped pool rather than an unlit road. */
const POOL_RADIUS = 6.5;
const POOL_OPACITY = 0.5;
/** Night-light-field entries: the punctual cutoff and candela-style level.
 *  Calibrated to the ground, not to the units: the head hangs 4.7 yd up, so
 *  the patch straight below it gets intensity * 0.045 / pi of the albedo,
 *  and reading CLEARLY lit on dark night ground needs the level up here.
 *  Raised with the pools removed (the field now carries the road alone), and
 *  again when the palette dropped to a true ~1800K flame amber: that colour
 *  carries far less luminance per unit intensity than the pale amber before it,
 *  so the same number would have read as a dimmer road.
 *
 *  The cutoff is the REACH knob and the intensity is the BRIGHTNESS knob, and
 *  they are deliberately turned separately: with decay-2 falloff the level
 *  under the lamp is set by 1/d^2 at four yards, which the cutoff barely
 *  touches, while the cutoff window is what strangles the tail. Widening the
 *  cutoff therefore carries lamplight further down the road (halfway to the
 *  next town lamp is roughly twice as lit as it was) without touching the pool
 *  underneath, which is already where it should be. */
const FIELD_RADIUS = 48;
const FIELD_INTENSITY = 205;
/** A glassed lantern wavers gently, so the authored source and ground breathe
 *  together without introducing fixture-to-fixture brightness differences. */
const FIELD_FLICKER = 0.1;

/**
 * Post, collar, lantern housing, and finial, merged into one instanced draw,
 * then scaled up as one piece (LAMP_SCALE).
 *
 * Every part is a CylinderGeometry/ConeGeometry on purpose: mergeGeometries
 * refuses a mixed set (Three's polyhedra come back NON-indexed while the lathe
 * primitives are indexed), and a null merge here fails the whole scene build.
 * `tests/streetlamps.test.ts` pins the merge rather than leaving it to a boot.
 */
export function buildLampFixtureGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.075, 0.135, POST_HEIGHT, 6);
  post.translate(0, POST_HEIGHT * 0.5, 0);
  const collar = new THREE.CylinderGeometry(0.16, 0.19, 0.13, 6);
  collar.translate(0, POST_HEIGHT + 0.06, 0);
  // the lantern housing: a flared skirt under the glass and a peaked cap over it
  const skirt = new THREE.ConeGeometry(0.25, 0.2, 6);
  skirt.rotateX(Math.PI);
  skirt.translate(0, POST_HEIGHT + 0.22, 0);
  const cap = new THREE.ConeGeometry(0.29, 0.3, 6);
  cap.translate(0, POST_HEIGHT + 0.73, 0);
  const finial = new THREE.ConeGeometry(0.07, 0.16, 4);
  finial.translate(0, POST_HEIGHT + 0.96, 0);
  const parts = [post, collar, skirt, cap, finial];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('streetlamps: lamp fixture geometry failed to merge');
  merged.scale(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE);
  merged.computeVertexNormals();
  return merged;
}

export function buildLampGlassGeometry(): THREE.BufferGeometry {
  const glass = new THREE.OctahedronGeometry(0.23, 0);
  glass.scale(1, 1.35, 1);
  glass.translate(0, POST_HEIGHT + 0.45, 0);
  glass.scale(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE);
  return glass;
}

/** Emissive-capable material on every tier (Lambert carries emissive too). */
function glassMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = {
    color: GLASS_COLOR,
    emissive: GLASS_EMISSIVE,
    emissiveIntensity: 0,
    flatShading: true,
  };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.45, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
  attachBiomeHaze(material);
  return material;
}

function ironMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = { color: IRON_COLOR, flatShading: true };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: 0.82,
        metalness: 0.25,
      })
    : new THREE.MeshLambertMaterial(opts);
  attachBiomeHaze(material);
  return material;
}

export function buildStreetlamps(seed = 0): StreetlampsView {
  const group = new THREE.Group();
  group.name = 'streetlamps';
  const glowLights: THREE.PointLight[] = [];
  const cullGroups: THREE.Group[] = [];
  const poolMeshes: THREE.Mesh[] = [];
  const poolMaterials = new Set<THREE.MeshBasicMaterial>();
  const emitterMaterials = new Map<
    THREE.MeshStandardMaterial | THREE.MeshLambertMaterial,
    number
  >();
  const authoredGlowStates = new Set<StreetlampEmissiveState>();

  // The sim's list, fixture identity and all: the same rows its collider pass
  // planted posts on.
  const placements = streetlampPlacements(seed);
  if (placements.length === 0) {
    registerStaticNightLights('streetlamps', []);
    return { group, glowLights, cullGroups, update: () => undefined };
  }

  const content = getActiveWorldContent();
  const zoneIndexById = new Map(content.zones.map((zone, index) => [zone.id, index]));

  /**
   * Where the light actually comes from, in world space. The authored
   * LIGHT_SOCKET is the truth; `lightOffset` only stands in for the procedural
   * fallback fixture, which has no model to read a socket from.
   */
  const socketFor = (style: StreetlampStyleId): readonly [number, number, number] =>
    streetlampAsset(style)?.socket ?? STREETLAMP_ASSET_DEFS[style].lightOffset;

  const lightAnchor = (
    site: PlacedStreetlamp,
    yaw: number,
    socket: readonly [number, number, number],
  ): { x: number; y: number; z: number } => {
    const [ox, oy, oz] = socket;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return {
      x: site.x + ox * c + oz * s,
      y: site.y + oy,
      z: site.z - ox * s + oz * c,
    };
  };

  interface StyledSite {
    site: PlacedStreetlamp;
    style: StreetlampStyleId;
    yaw: number;
  }
  // The style arrives from the sim (it sized the post's collider from it); the
  // yaw is resolved ONCE per site here, and every consumer below reads the same
  // record. The field anchor and the instance transform must agree on the yaw
  // or the light drifts off the lantern that casts it.
  const styled: StyledSite[] = placements.map((site) => {
    const axis = streetlampAsset(site.style)?.lightAxis;
    return {
      site,
      style: site.style,
      // Turn the fixture's own lit end over the road: a hanging lantern reaches
      // out across the track, its post left standing out on the verge.
      yaw: lampFixtureYaw(site.roadYaw, axis?.[0] ?? 0, axis?.[1] ?? 0),
    };
  });

  // EVERY lamp joins the night light field, from its own authored socket. This
  // path is identical for every fixture, regardless of camera range, which is
  // what keeps a plaza of fourteen different styles reading as one warm night.
  registerStaticNightLights(
    'streetlamps',
    styled.map(({ site, style, yaw }) => {
      const def = STREETLAMP_ASSET_DEFS[style];
      const anchor = lightAnchor(site, yaw, socketFor(style));
      return {
        ...anchor,
        radius: FIELD_RADIUS,
        r: def.fieldColor[0],
        g: def.fieldColor[1],
        b: def.fieldColor[2],
        intensity: FIELD_INTENSITY,
        flicker: FIELD_FLICKER,
      };
    }),
  );
  // Pools ONLY where the field cannot run. Wherever the field is spliced the
  // real light is the whole story and no sprite is built at all.
  const fieldActive = hasNightLightField();
  const usePools = typeof document !== 'undefined' && !fieldActive;

  const byZone = new Map<number, StyledSite[]>();
  for (const entry of styled) {
    const zoneIndex = entry.site.areaId ? (zoneIndexById.get(entry.site.areaId) ?? -1) : -1;
    const bucket = byZone.get(zoneIndex);
    if (bucket) bucket.push(entry);
    else byZone.set(zoneIndex, [entry]);
  }

  let fallbackFixtureGeo: THREE.BufferGeometry | null = null;
  let fallbackGlassGeo: THREE.BufferGeometry | null = null;
  let fallbackIronMat: THREE.Material | null = null;
  let fallbackGlassMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null = null;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const patchSites: GlowPatchSite[] = [];

  for (const [zoneIndex, zoneSites] of byZone) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `streetlamps-zone-${zoneIndex}`;
    const byStyle = new Map<StreetlampStyleId, StyledSite[]>();
    for (const entry of zoneSites) {
      const bucket = byStyle.get(entry.style);
      if (bucket) bucket.push(entry);
      else byStyle.set(entry.style, [entry]);
    }

    for (const [style, sites] of byStyle) {
      const def = STREETLAMP_ASSET_DEFS[style];
      const asset = streetlampAsset(style);
      const styleGroup = new THREE.Group();
      styleGroup.name = `streetlamps-${style}`;
      let parts = asset?.parts;
      if (!parts) {
        fallbackFixtureGeo ??= buildLampFixtureGeometry();
        fallbackIronMat ??= ironMaterial();
        parts = [{ geometry: fallbackFixtureGeo, material: fallbackIronMat }];
      }

      const bodies = parts.map((part) => {
        const body = new THREE.InstancedMesh(part.geometry, part.material, sites.length);
        body.userData.streetlampRole = 'body';
        body.castShadow = true;
        body.receiveShadow = true;
        styleGroup.add(body);
        return body;
      });

      let emitters: THREE.InstancedMesh | null = null;
      if (asset) {
        // The GLB's own LAMP_GLASS / LAMP_SOURCE materials, already normalized
        // to a constant luminance when authored. Nothing per-style is applied
        // on top, which is exactly why every fixture reads equally lit.
        for (const state of asset.glowStates) authoredGlowStates.add(state);
      } else {
        fallbackGlassGeo ??= buildLampGlassGeometry();
        fallbackGlassMat ??= glassMaterial();
        emitterMaterials.set(fallbackGlassMat, FALLBACK_SOURCE_EMISSIVE);
        emitters = new THREE.InstancedMesh(fallbackGlassGeo, fallbackGlassMat, sites.length);
        emitters.userData.streetlampRole = 'emitter';
        styleGroup.add(emitters);
      }

      patchSites.length = 0;
      const socket = socketFor(style);
      for (let i = 0; i < sites.length; i++) {
        const { site, yaw } = sites[i];
        quaternion.setFromAxisAngle(up, yaw);
        position.set(site.x, site.y, site.z);
        const instanceMatrix = matrix.compose(position, quaternion, scale);
        for (const body of bodies) body.setMatrixAt(i, instanceMatrix);
        emitters?.setMatrixAt(i, instanceMatrix);
        if (usePools) {
          // Project from the authored socket, including off-axis hanging
          // lanterns, instead of from the foot of the post.
          const anchor = lightAnchor(site, yaw, socket);
          patchSites.push({ x: anchor.x, z: anchor.z, radius: POOL_RADIUS });
        }
      }
      for (const body of bodies) {
        body.instanceMatrix.needsUpdate = true;
        body.computeBoundingBox();
        body.computeBoundingSphere();
      }
      if (emitters) {
        emitters.instanceMatrix.needsUpdate = true;
        emitters.computeBoundingBox();
        emitters.computeBoundingSphere();
      }

      if (usePools) {
        const poolMat = new THREE.MeshBasicMaterial({
          map: radialGlowTexture(),
          color: def.lightColor,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        poolMaterials.add(poolMat);
        const pools = new THREE.Mesh(
          buildDrapedGlowGeometry(patchSites, (x, z) => terrainHeight(x, z, seed)),
          poolMat,
        );
        pools.geometry.computeBoundingSphere();
        pools.renderOrder = 1;
        pools.visible = false;
        poolMeshes.push(pools);
        styleGroup.add(pools);
      }
      zoneGroup.add(styleGroup);
    }
    group.add(zoneGroup);
    cullGroups.push(zoneGroup);
  }

  let poolsShown = false;
  let darkened = false;
  return {
    group,
    glowLights,
    cullGroups,
    update(glow: number, time: number): void {
      const lit = glow > 0.001;
      if (lit !== poolsShown) {
        poolsShown = lit;
        for (const pool of poolMeshes) pool.visible = lit;
      }
      if (!lit) {
        // Write-elided: the lamps are out for the whole daylight half of the
        // cycle, and a fixture already dark has nothing to be told. Rewriting
        // the same zero into every authored emitter of all fourteen styles,
        // every frame, all day, is cost with no pixel behind it.
        if (darkened) return;
        darkened = true;
        for (const material of emitterMaterials.keys()) material.emissiveIntensity = 0;
        for (const state of authoredGlowStates) updateStreetlampEmissive(state, 0);
        for (const material of poolMaterials) material.opacity = 0;
        return;
      }
      darkened = false;
      // A lantern flame breathes rather than strobing: two slow out-of-phase
      // sines, the same idiom the Icemantle lanterns use.
      const flicker = 1 + Math.sin(time * 5.7) * 0.05 + Math.sin(time * 1.9) * 0.04;
      for (const [material, intensity] of emitterMaterials) {
        material.emissiveIntensity = intensity * glow * flicker;
      }
      // One drive for every fixture: the per-role level is authored in the GLB,
      // so nothing here can make one style brighter than another.
      for (const state of authoredGlowStates) {
        updateStreetlampEmissive(state, glow * flicker);
      }
      for (const material of poolMaterials) material.opacity = POOL_OPACITY * glow;
    },
  };
}
