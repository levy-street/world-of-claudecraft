import * as THREE from 'three';
import { Entity, SimEvent } from '../sim/types';
import { OVERHEAD_EMOTES, type IWorld } from '../world_api';
import { groundHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import {
  MOBS, ABILITIES, DUNGEON_X_THRESHOLD, DUNGEON_LIST, QUESTS,
  instanceOrigin, INSTANCE_SLOT_COUNT, ARENA_SLOT_COUNT, arenaOrigin, isArenaPos, dungeonAt,
} from '../sim/data';
import { cameraOcclusion } from '../sim/colliders';
import type { BiomeId } from '../sim/types';
import { AnimState, CharacterVisual, createCharacterVisual } from './characters';
import { visualKeyFor } from './characters/manifest';
import { mechAssetsReady, preloadMechAssets } from './characters/assets';
import { isVisuallyDead } from './anim_state';
import { LocoTrack, newLocoTrack, updateLocomotion } from './locomotion';
import type { SpatialAudioSink, Surface } from './audio_sink';
import { buildProps } from './props';
import { plankTexture, sparkleTexture } from './textures';
import { DungeonInteriors, ensureDungeonAssets } from './dungeon';
import { buildGroundQuestObject } from './quest_objects';
import { Vfx } from './vfx';
import { Weather } from './weather';
import {
  GFX, initGfxTier, sharedUniforms, SUN_ANCHOR, SUN_DIR, surfaceMat, urlForcedTier,
} from './gfx';
import { buildComposer, PostPipeline } from './post';
import { buildTerrain, TerrainView } from './terrain';
import { buildWater, WaterView } from './water';
import { buildClouds, buildSky, SkyView } from './sky';
import { buildFoliage, FoliageView } from './foliage';
import { buildFish, FishView } from './fish';
import { buildCritters, CritterField } from './critters';
import { buildMotes, MotesView } from './motes';
import { buildBirds, BirdsView } from './birds';
import { buildImpactSite, type ImpactSiteView } from './impact_site';
import { shouldRenderStealthGhost } from './stealth';
import { t } from '../ui/i18n';
import { tEntity } from '../ui/entity_i18n';
import { raidMarkerDataUrl } from '../ui/icons';
import { HOLDER_TIERS, holderTierBadgeDataUrl } from '../ui/holder_tier';
import { isProjectedNameplateAnchorVisible, nameplateScreenTransform } from './nameplate_projection';
import { comboPipsFor, COMBO_PIP_MAX } from './nameplate_combo';
import { stepCameraOcclusion, type CameraOcclusionState } from './camera_collision';
import { castBarState } from './cast_bar';
import { isMobThreateningViewer } from './nameplate_threat';

const NAMEPLATE_RANGE = 55;
const NAMEPLATE_RANGE_SQ = NAMEPLATE_RANGE * NAMEPLATE_RANGE;
const emoteIconUrl = (id: string): string => `/ui/emotes/emote-${id}.png`;
// Entities further than this from the player are hidden entirely: their rigs
// are several draw calls each and read as sub-pixel specks long before this.
const ENTITY_DRAW_RANGE = 80;
const ENTITY_VIEW_CREATE_RANGE_SQ = ENTITY_DRAW_RANGE * ENTITY_DRAW_RANGE;
const ENTITY_VIEW_DESTROY_RANGE_SQ = 96 * 96;
const VIEW_CREATE_BUDGET_LOW = 4;
const VIEW_CREATE_BUDGET_HIGH = 16;
// rigs further than this stop casting articulated shadows (~7 draws each) and
// hand off to a single-draw static-pose shadow proxy (the merged far-LOD mesh
// with a colorWrite-off material) so mid-ground NPCs keep their grounding for
// ~1/7 the cost — the pose freeze is invisible in a shadow blob this far out
const ENTITY_SHADOW_RANGE_SQ = 25 * 25;
const ENTITY_PROXY_SHADOW_RANGE_SQ = 62 * 62;
// loot sparkles further than this are hidden (sub-pixel, real draw cost)
const SPARKLE_DRAW_RANGE_SQ = 40 * 40;
// beyond this, the articulated rig swaps for its single-draw merged far LOD
// (just inside the nameplate range; rigs out there are ~30px tall)
const ENTITY_LOD_RANGE_SQ = 50 * 50;
// Feet-above-terrain margin that counts as "airborne" for the jump pose. Mirrors
// the sim's own 0.4u grounded tolerance (sim.ts), so walking slopes doesn't trip
// it but a jump (apex ~1.1u) does. Needed because online snapshots don't carry
// `onGround`, so the flag alone never fires the jump clip for the mirrored world.
const AIRBORNE_EPS = 0.4;
// Beyond this (squared) an entity's footsteps/movement are inaudible, so we skip
// the surface sample + dispatch entirely. Kept under the engine's own cutoff (46u).
const SFX_MOVE_RANGE_SQ = 42 * 42;
// Stride length (world units travelled) between footfalls — longer at a run.
const FOOT_STRIDE_WALK = 0.95;
const FOOT_STRIDE_RUN = 1.55;
const SWIM_STRIDE = 2.4;
const FOOT_RUN_SPEED = 4.5; // u/s — matches the run threshold in characters/anim_state.ts
// fire/torch point lights beyond this never shine (their falloff range is
// shorter anyway); the nearest GFX.maxPointLights within it win the budget
const LIGHT_BUDGET_RANGE_SQ = 55 * 55;
// HDR boosts so the bloom pass picks these out (composer tiers only)
const SELECTION_RING_BOOST = 1.5;
const SELECTION_RING_SPIN = 0.6; // rad/s — slow classic target-reticle rotation
const SPARKLE_BOOST = 1.5;
const PORTAL_BOOST = 2;
// Third-person camera collision (see updateCamera). Prop colliders marked
// camGhost are hidden by props.ts/foliage.ts instead; this path is for
// non-hideable blockers such as large rocks and interior walls.
const CAMERA_COLLIDER_PAD = 0.35;
const CAMERA_SOFT_COLLIDER_PAD = 1.65;
const CAMERA_MIN_DIST = 1.2;
const CAMERA_PULL_IN_RATE = 10;
const CAMERA_PULL_OUT_RATE = 6;
const CAMERA_SOFT_PULL_WEIGHT = 0.45;
const CAMERA_BASE_FOV = 60;
const CAMERA_MAX_COMP_FOV = 98;
const SELF_RENDER_SMOOTH_RATE = 30;
const SELF_RENDER_SNAP_DIST_SQ = 6 * 6;
const SUN_HALO_OPACITY = 0.35; // bloom now supplies most of the halo
// lighting rig (high/ultra) — IBL supplies ambient, sun carries the key
const HEMI_INTENSITY = 0.45;
const SUN_INTENSITY = 2.8;
const ENV_INTENSITY = 0.5;
// dungeon interiors: kill the daylight so torchlight carries the scene
// (env at 0.15 still lit rigs sky-blue against the pitch-dark crypt)
const DUNGEON_SUN_INTENSITY = 0.3;
const DUNGEON_ENV_INTENSITY = 0.05;
// raw HDRI PMREMs integrate the real sun the dome shader clamps away —
// rescale so ambient matches the dome-capture look (see lookdev-hookup.md)
const IBL_RAW_SCALE = 0.55;
const DUNGEON_HEMI_INTENSITY = 0.22; // floor of readability — bosses crushed to black at 0.14
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
const RENDERER_PHASE_SAMPLE_LIMIT = 720;

type RendererPhase = 'setup' | 'entities' | 'world' | 'nameplates' | 'submit' | 'total';
type RendererPhaseStats = Record<RendererPhase, { count: number; avg: number; p95: number; max: number }>;

function selfSnapshotAlpha(alpha: number, lead: number): number {
  return Math.min(1.25, alpha + Math.max(0, lead));
}

interface EntityView {
  group: THREE.Group;
  /** rigged glTF visual for characters; null for object views (doors/crates) */
  visual: CharacterVisual | null;
  visualKey: string | null;
  sheepVisual: CharacterVisual | null; // polymorph form, built lazily
  bearVisual: CharacterVisual | null; // druid bear form, built lazily
  catVisual: CharacterVisual | null; // druid cat form, built lazily
  skin: number; // last-rendered appearance skin — diffed each frame for live swaps
  /** unscaled height — nameplate/vfx anchor reads height * e.scale */
  height: number;
  /** last-applied entity scale (group.scale); diffed each frame for live size buffs */
  liveScale: number;
  /** what removeView pulls back out of clickTargets */
  clickTarget: THREE.Object3D;
  nameplate: HTMLDivElement;
  nameEl: HTMLDivElement;
  hpBar: HTMLDivElement;
  hpFill: HTMLDivElement;
  emoteEl: HTMLDivElement;
  emoteIconEl: HTMLImageElement;
  emoteLabelEl: HTMLSpanElement;
  markerEl: HTMLDivElement;
  castBar: HTMLDivElement; // overhead spell cast/channel bar, below the hp bar
  castFill: HTMLDivElement;
  castLabel: HTMLDivElement;
  raidMarkEl: HTMLDivElement; // party raid/target marker, above the name
  comboRow: HTMLDivElement; // rogue/druid combo-point pips, above the name
  comboPips: HTMLDivElement[]; // the COMBO_PIP_MAX pip cells, lit left-to-right
  nameplateDisplay: string;
  nameplateTransform: string;
  nameplateSig: string;
  nameplateHpWidth: string;
  comboSig: string; // cheap-diff for the combo pip row
  tierEl: HTMLImageElement; // $WOC holder-tier flair badge (other players)
  tierValue: number; // last-applied holderTier, to diff cheaply
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  portal?: THREE.Mesh; // dungeon door swirl
  objectCasters: THREE.Object3D[]; // object-view shadow meshes, distance-gated
  shadowOn: boolean;
  isFar: boolean;
  lastOverheadEmoteKey: string | null;
  // render-space position last frame, for true u/s locomotion speed
  lastX: number;
  lastZ: number;
  // locomotion-state hysteresis so a one-frame speed dip can't reset the
  // walk clip (see locomotion.ts)
  loco: LocoTrack;
  // spatial-audio state: distance travelled since the last footfall, and edge
  // latches for jump/land/water-entry detection.
  stepAccum: number;
  wasAirborne: boolean;
  wasSwimming: boolean;
}

function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
}

function roundMs(v: number): number {
  return Math.round(v * 100) / 100;
}

function distSqXZ(a: Entity, b: Entity): number {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  return dx * dx + dz * dz;
}

function summarizeMs(values: number[]): { count: number; avg: number; p95: number; max: number } {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    count: values.length,
    avg: roundMs(total / values.length),
    p95: roundMs(sorted[p95Idx]),
    max: roundMs(sorted[sorted.length - 1]),
  };
}

function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

function npcDisplayName(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'name' });
}

function dungeonDisplayName(dungeonId: string): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field: 'name' });
}

function objectDisplayName(entity: Entity): string {
  if ((entity.templateId === 'dungeon_door' || entity.templateId === 'dungeon_exit') && entity.dungeonId) {
    const dungeonName = dungeonDisplayName(entity.dungeonId);
    return entity.templateId === 'dungeon_exit'
      ? t('worldContent.dungeonExitName', { name: dungeonName })
      : dungeonName;
  }
  // Collectible/quest ground objects carry the item id they grant; localize the
  // nameplate through the item dictionary instead of the raw English name.
  if (entity.objectItemId) return tEntity({ kind: 'item', id: entity.objectItemId, field: 'name' });
  return entity.name;
}

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  views = new Map<number, EntityView>();
  nameplateLayer: HTMLDivElement;
  selectionRing: THREE.Mesh;
  raycaster = new THREE.Raycaster();
  clickTargets: THREE.Object3D[] = [];
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  // Smoothed chase-cam occlusion (1 = no pull-in); see updateCamera.
  private camOcclusion: CameraOcclusionState = { pullT: 1, lensT: 1, fov: CAMERA_BASE_FOV };
  showNameplates = true;
  // settings-menu graphics knobs (applied live)
  private renderScale = 1; // user-requested resolution ceiling on top of the device pixel ratio
  private effectiveRenderScale = 1; // runtime value after adaptive backoff
  private frameMsEma = 16.7;
  private adaptiveGrace = 2.0;
  private adaptiveCooldown = 0;
  private stableFrameTime = 0;
  private baseExposure = 1.12; // tone-mapping exposure at brightness 1.0
  private tmpV = new THREE.Vector3();
  private viewCandidates: { e: Entity; d2: number }[] = [];
  private tmpV2 = new THREE.Vector3();
  private selfRenderPosition = new THREE.Vector3();
  private selfRenderPositionReady = false;
  private cameraLookAt = new THREE.Vector3();
  // floating /say-/yell bubbles, keyed by speaker entity id
  private chatBubbles = new Map<number, { el: HTMLDivElement; until: number }>();
  private sun: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private sky!: THREE.Mesh;
  private skyView!: SkyView;
  private sunSprites: THREE.Sprite[] = [];
  private sunDir = new THREE.Vector3();
  private sunAzimuth = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
  private clouds: THREE.Sprite[] = [];
  private waterView: WaterView;
  private terrainView: TerrainView;
  private foliage: FoliageView;
  private fish: FishView;
  private critters: CritterField;
  private motes: MotesView;
  private birds: BirdsView;
  private impactSite: ImpactSiteView;
  private fogScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private fireLights: THREE.PointLight[];
  private propsView!: {
    update(
      camX: number, camY: number, camZ: number,
      eyeX: number, eyeY: number, eyeZ: number,
      fogFar: number,
    ): void;
  };
  private lightRank: { light: THREE.PointLight; d2: number; worldPos: THREE.Vector3 }[] = [];
  private doomedIds: number[] = [];
  private dungeons: DungeonInteriors | null = null;
  private envRTs = new Map<BiomeId, THREE.WebGLRenderTarget>();
  private envBiome: BiomeId = 'vale';
  private envOutdoorIntensity = ENV_INTENSITY;
  private time = 0;
  private frameIdx = 0;
  vfx: Vfx;
  private weather: Weather;
  private weatherOn = true;
  private audioSink: SpatialAudioSink | null = null;

  // 2v2 Fiesta juice: trauma-based screen shake (decays each frame) and the
  // hazard-ring wall (built lazily the first time a Fiesta bout asks for it).
  private shakeTrauma = 0;
  private shakeElapsed = 0;
  private fiestaRing: THREE.Mesh | null = null;
  private fiestaPowerupMeshes = new Map<number, THREE.Mesh>();
  // Per-entity power-up glow: emits a coloured swirl around the carrier until it expires.
  private fiestaGlows = new Map<number, { color: number; until: number; nextSwirl: number }>();

  private lowGfx: boolean;
  private post: PostPipeline | null = null;
  private godRays: THREE.Sprite[] = [];
  private viewport = { width: 1, height: 1 };
  private viewportPollTimer = 0;
  private nameplateTimer = 0;
  private glVendor = '';
  private glRenderer = '';
  private contextLostCount = 0;
  private contextRestoredCount = 0;
  private phaseSamples: Record<RendererPhase, number[]> = {
    setup: [],
    entities: [],
    world: [],
    nameplates: [],
    submit: [],
    total: [],
  };

  constructor(private sim: IWorld, canvas: HTMLCanvasElement, nameplateLayer: HTMLDivElement) {
    this.nameplateLayer = nameplateLayer;
    // No default-framebuffer MSAA on any tier: high/ultra get AA from the
    // composer's MSAA HalfFloat target, low is meant to run without AA — and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.captureGlIdentity();
    canvas.addEventListener('webglcontextlost', () => { this.contextLostCount++; });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextRestoredCount++;
      this.captureGlIdentity();
    });
    initGfxTier(this.webgl); // software-GL autodetect needs the live context
    // The lightweight material path does not preload HDR sky/water assets.
    // Keep the renderer's HDR/IBL branch aligned with that preload decision.
    this.lowGfx = !GFX.standardMaterials;
    const LOW_GFX = this.lowGfx;
    this.viewport = this.measureViewport();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    this.webgl.shadowMap.enabled = !LOW_GFX;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass reads this on the composer path
    this.webgl.toneMappingExposure = this.baseExposure;
    this.camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, this.viewport.width / this.viewport.height, 0.1, 950);

    this.scene.fog = new THREE.Fog(LOW_GFX ? 0xb6cddd : 0xa6c6e0, LOW_GFX ? 150 : 130, LOW_GFX ? 520 : 470);

    // sky dome — follows the camera so the world strip never outruns it.
    // High tier: shader gradient + sun glow with biome-aware horizon tints;
    // low keeps the legacy canvas-gradient dome.
    this.skyView = buildSky(LOW_GFX, SUN_ANCHOR);
    this.sky = this.skyView.dome;
    this.scene.add(this.sky);

    // IBL: prefilter the real per-biome HDRI equirects so PBR materials get
    // sky-matched ambient; swapped as the camera crosses biome bands (the
    // dome shader cross-fades the same textures). The raw equirects carry
    // the unclamped sun that the dome shader tames with per-biome gain, so
    // the environment intensity is rescaled to match the shipped look.
    if (!LOW_GFX) {
      const pmrem = new THREE.PMREMGenerator(this.webgl);
      for (const b of ['vale', 'marsh', 'peaks'] as BiomeId[]) {
        const eq = this.skyView.envTexture(b);
        if (eq) this.envRTs.set(b, pmrem.fromEquirectangular(eq));
      }
      if (this.envRTs.size > 0) {
        this.envOutdoorIntensity = ENV_INTENSITY * IBL_RAW_SCALE;
        this.scene.environment = this.envRTs.get('vale')!.texture;
        this.scene.environmentRotation.y = this.skyView.envRotationY('vale');
      } else {
        // fallback: prefilter the dome itself (gain/clamp already applied)
        const envScene = new THREE.Scene();
        envScene.add(this.sky.clone());
        const envRT = pmrem.fromScene(envScene, 0.04, 0.1, 1100); // far must cover the 560u dome
        this.scene.environment = envRT.texture;
      }
      this.scene.environmentIntensity = this.envOutdoorIntensity;
      pmrem.dispose(); // prefiltered envRTs stay alive for the session
    }

    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x405a35, LOW_GFX ? 0.9 : HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(LOW_GFX ? 0xfff2d6 : 0xffedd0, LOW_GFX ? 2.45 : SUN_INTENSITY);
    sun.position.copy(SUN_ANCHOR);
    sun.castShadow = !LOW_GFX;
    sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    sun.shadow.camera.near = 30;
    sun.shadow.camera.far = 480;
    // 95u half-extent: the whole mid-ground shadows (a 50u box left every
    // tree/house past it on uniformly lit grass); ~4.6cm texels at 4096
    const S = LOW_GFX ? 75 : 95;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = LOW_GFX ? 0.02 : 0.05;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunDir.copy(SUN_DIR);

    // visible sun disc + bloom halo
    const sunCanvas = (core: boolean): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      if (core) {
        g.addColorStop(0, 'rgba(255,252,238,1)');
        g.addColorStop(0.35, 'rgba(255,238,180,0.95)');
        g.addColorStop(1, 'rgba(255,220,140,0)');
      } else {
        g.addColorStop(0, 'rgba(255,236,180,0.55)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    for (const [tex, scale] of [[sunCanvas(true), 60], [sunCanvas(false), 190]] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, fog: false, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
        // bloom supplies the big halo on the composer path; the painted one
        // would double up and wash out the sky
        opacity: scale === 190 && !LOW_GFX ? SUN_HALO_OPACITY : 1,
      }));
      sp.scale.set(scale, scale, 1);
      sp.renderOrder = -9;
      this.sunSprites.push(sp);
      this.scene.add(sp);
    }

    // god-ray shafts: elongated additive gradient sprites hanging sunward of
    // the camera; opacity follows how directly the camera faces the sun
    if (!LOW_GFX) {
      const shaft = document.createElement('canvas');
      shaft.width = 64;
      shaft.height = 256;
      const sctx = shaft.getContext('2d')!;
      const gh = sctx.createLinearGradient(0, 0, 0, 256);
      gh.addColorStop(0, 'rgba(255,240,200,0)');
      gh.addColorStop(0.45, 'rgba(255,240,200,0.55)');
      gh.addColorStop(0.6, 'rgba(255,240,200,0.5)');
      gh.addColorStop(1, 'rgba(255,240,200,0)');
      sctx.fillStyle = gh;
      sctx.fillRect(0, 0, 64, 256);
      const gw = sctx.createLinearGradient(0, 0, 64, 0);
      gw.addColorStop(0, 'rgba(0,0,0,1)');
      gw.addColorStop(0.5, 'rgba(0,0,0,0)');
      gw.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = gw;
      sctx.fillRect(0, 0, 64, 256);
      const shaftTex = new THREE.CanvasTexture(shaft);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: shaftTex, transparent: true, opacity: 0, fog: false,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          rotation: 0.42 + i * 0.13,
        }));
        sp.scale.set(26 + i * 16, 150 + i * 35, 1);
        sp.renderOrder = -8;
        this.godRays.push(sp);
        this.scene.add(sp);
      }
    }

    // clouds, spread over the whole zone strip (3 sprite variants + a faint
    // high cirrus layer on the full pipeline)
    for (const cl of buildClouds(LOW_GFX).sprites) {
      this.clouds.push(cl);
      this.scene.add(cl);
    }

    this.terrainView = buildTerrain(this.sim.cfg.seed);
    this.scene.add(this.terrainView.group);
    this.waterView = buildWater(this.sim.cfg.seed);
    for (const mesh of this.waterView.meshes) this.scene.add(mesh);

    this.foliage = buildFoliage(this.sim.cfg.seed);
    this.scene.add(this.foliage.group);
    this.fish = buildFish(this.sim.cfg.seed);
    this.scene.add(this.fish.group);
    this.critters = buildCritters(this.sim.cfg.seed);
    this.scene.add(this.critters.group);
    this.motes = buildMotes(this.sim.cfg.seed);
    this.scene.add(this.motes.group);
    this.birds = buildBirds(this.sim.cfg.seed);
    this.scene.add(this.birds.group);
    this.impactSite = buildImpactSite(this.sim.cfg.seed);
    this.scene.add(this.impactSite.group);
    const props = buildProps(this.sim.cfg.seed);
    this.scene.add(props.group);
    this.flames = props.flames;
    this.fireLights = props.fireLights;
    this.propsView = props;

    // selection ring — a classic target reticle: a base ring plus four
    // inward-pointing ticks. The ring is radially symmetric (so spin reads
    // only off the ticks); it rotates slowly and pulses in sync() below.
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, depthWrite: false });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    // four cardinal ticks, flat in the XZ plane, sharing the ring material so
    // the per-frame hostile/friendly recolour carries over for free.
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.72, 0, 0,     // inner tip (points toward the unit)
      1.2, 0, 0.16,   // outer corners
      1.2, 0, -0.16,
    ], 3));
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tickGeo, ringMat);
      t.rotation.y = (i * Math.PI) / 2;
      this.selectionRing.add(t);
    }
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    // particle system: projectiles, impacts, heal glows, ambience
    this.vfx = new Vfx(this.scene, (id, frac) => {
      const v = this.views.get(id);
      if (!v) return null;
      const e = this.sim.entities.get(id);
      const h = v.height * (e?.scale ?? 1) * frac;
      return new THREE.Vector3(v.group.position.x, v.group.position.y + h, v.group.position.z);
    });
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);

    // ambient precipitation: biome-driven snow/rain that rides with the camera
    this.weather = new Weather(this.scene, this.lowGfx);

    // post chain (bloom + grade, GTAO on ultra); low renders direct
    if (GFX.composer) this.post = buildComposer(this.webgl, this.scene, this.camera, this.viewport.width, this.viewport.height);

    const resize = () => this.resizeViewport();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => {
      resize();
      window.setTimeout(resize, 250);
      window.setTimeout(resize, 800);
    });
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    document.addEventListener('fullscreenchange', resize);
  }

  private measureViewport(): { width: number; height: number } {
    const rect = this.webgl.domElement.getBoundingClientRect();
    const stableMobileGameViewport = document.body.classList.contains('game-active') && document.body.classList.contains('mobile-touch');
    const vv = stableMobileGameViewport ? null : window.visualViewport;
    const width = Math.round(stableMobileGameViewport ? (rect.width || window.innerWidth) : (vv?.width ?? (rect.width || window.innerWidth)));
    const height = Math.round(stableMobileGameViewport ? (rect.height || window.innerHeight) : (vv?.height ?? (rect.height || window.innerHeight)));
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  private captureGlIdentity(): void {
    try {
      const gl = this.webgl.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.glVendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      this.glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      this.glVendor = '';
      this.glRenderer = '';
    }
  }

  private resizeViewport(measured = this.measureViewport()): void {
    this.viewport = measured;
    this.camera.aspect = this.viewport.width / this.viewport.height;
    this.camera.updateProjectionMatrix();
    this.applyResolution();
  }

  // Push the current device pixel ratio (× renderScale, still capped by the
  // tier) to the renderer, composer, and vfx. Shared by resize and the
  // render-scale setting so a window resize never drops the chosen scale.
  private applyResolution(): void {
    const ratio = Math.min(window.devicePixelRatio, GFX.pixelRatioCap) * this.effectiveRenderScale;
    this.webgl.setPixelRatio(ratio);
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    if (this.post) {
      this.post.composer.setPixelRatio(ratio);
      this.post.setSize(this.viewport.width, this.viewport.height);
    }
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
  }

  /** Tone-mapping exposure multiplier (1.0 = the default look). */
  setBrightness(mult: number): void {
    this.webgl.toneMappingExposure = this.baseExposure * mult;
  }

  /** Toggle biome-driven ambient precipitation (snow/rain). */
  setWeatherEnabled(on: boolean): void {
    this.weather.setEnabled(on);
    this.weatherOn = on;
  }

  /** main.ts injects the spatial sound engine here (render never imports game/). */
  setAudioSink(sink: SpatialAudioSink | null): void {
    this.audioSink = sink;
  }

  // Surface under (x,z) for footstep timbre. Sampled only at a footfall (cheap).
  private surfaceAt(x: number, z: number, y: number): Surface {
    if (x > DUNGEON_X_THRESHOLD) return 'stone'; // dungeon interiors are stone halls
    if (groundHeight(x, z, this.sim.cfg.seed) < WATER_LEVEL && y <= WATER_LEVEL + 0.3) return 'water';
    const biome = zoneBiomeAt(z);
    if (biome === 'vale') return 'grass';
    if (biome === 'marsh') return 'dirt';
    return this.weatherOn ? 'snow' : 'stone'; // peaks: snowy when weather is on
  }

  /** Vertical camera field of view in degrees (55..100, default 60). */
  setCameraFov(deg: number): void {
    this.camera.fov = Math.min(100, Math.max(55, deg));
    this.camera.updateProjectionMatrix();
  }

  /** Resolution multiplier on top of the device pixel ratio (0.5..1). */
  setRenderScale(scale: number): void {
    this.renderScale = Math.min(1, Math.max(0.5, scale));
    this.effectiveRenderScale = this.initialEffectiveRenderScale(this.renderScale);
    this.frameMsEma = 16.7;
    this.adaptiveGrace = 1.0;
    this.adaptiveCooldown = 0.5;
    this.stableFrameTime = 0;
    this.applyResolution();
  }

  private isMobileRuntime(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private initialEffectiveRenderScale(scale: number): number {
    const forcedTier = urlForcedTier();
    if (this.isMobileRuntime() && forcedTier !== 'high' && forcedTier !== 'ultra') return Math.min(scale, 0.85);
    return scale;
  }

  perfStats(): {
    tier: string;
    renderScale: number;
    effectiveRenderScale: number;
    pixelRatio: number;
    width: number;
    height: number;
    calls: number;
    triangles: number;
    textures: number;
    programs: number;
    views: number;
    glVendor: string;
    glRenderer: string;
    contextLost: number;
    contextRestored: number;
    phaseMs: RendererPhaseStats;
  } {
    const info = this.webgl.info;
    return {
      tier: GFX.tier,
      renderScale: this.renderScale,
      effectiveRenderScale: this.effectiveRenderScale,
      pixelRatio: this.webgl.getPixelRatio(),
      width: this.viewport.width,
      height: this.viewport.height,
      calls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      views: this.views.size,
      glVendor: this.glVendor,
      glRenderer: this.glRenderer,
      contextLost: this.contextLostCount,
      contextRestored: this.contextRestoredCount,
      phaseMs: this.rendererPhaseStats(),
    };
  }

  private recordRendererPhase(phase: RendererPhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const samples = this.phaseSamples[phase];
    samples.push(Math.min(250, ms));
    if (samples.length > RENDERER_PHASE_SAMPLE_LIMIT) samples.splice(0, samples.length - RENDERER_PHASE_SAMPLE_LIMIT);
  }

  private rendererPhaseStats(): RendererPhaseStats {
    return {
      setup: summarizeMs(this.phaseSamples.setup),
      entities: summarizeMs(this.phaseSamples.entities),
      world: summarizeMs(this.phaseSamples.world),
      nameplates: summarizeMs(this.phaseSamples.nameplates),
      submit: summarizeMs(this.phaseSamples.submit),
      total: summarizeMs(this.phaseSamples.total),
    };
  }

  private updateAdaptiveResolution(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const frameMs = Math.min(250, dt * 1000);
    this.frameMsEma += (frameMs - this.frameMsEma) * 0.08;
    if (this.adaptiveGrace > 0) {
      this.adaptiveGrace -= dt;
      return;
    }
    if (this.adaptiveCooldown > 0) {
      this.adaptiveCooldown -= dt;
      return;
    }

    const mobile = this.isMobileRuntime();
    const minScale = mobile ? 0.55 : (GFX.tier === 'low' ? 0.9 : 0.7);
    const dropThreshold = mobile ? 20 : 24; // ~50fps mobile, ~42fps desktop
    const urgentThreshold = mobile ? 28 : 34;
    const recoverThreshold = mobile ? 15.5 : 14.5;

    if (this.frameMsEma >= dropThreshold && this.effectiveRenderScale > minScale) {
      const step = this.frameMsEma >= urgentThreshold ? 0.15 : 0.1;
      this.effectiveRenderScale = Math.max(minScale, Math.round((this.effectiveRenderScale - step) * 100) / 100);
      this.stableFrameTime = 0;
      this.adaptiveCooldown = 1.25;
      this.applyResolution();
      return;
    }

    if (this.frameMsEma <= recoverThreshold && this.effectiveRenderScale < this.renderScale) {
      this.stableFrameTime += dt;
      if (this.stableFrameTime >= 6) {
        this.effectiveRenderScale = Math.min(this.renderScale, Math.round((this.effectiveRenderScale + 0.05) * 100) / 100);
        this.stableFrameTime = 0;
        this.adaptiveCooldown = 2.0;
        this.applyResolution();
      }
    } else {
      this.stableFrameTime = 0;
    }
  }

  // Visual reactions to sim events (called by the HUD for every event,
  // including those between other players and mobs).
  handleEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'spellfx':
        if (ev.fx === 'projectile') this.vfx.projectile(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'tick') this.vfx.tick(ev.targetId, ev.school);
        else this.vfx.nova(ev.targetId, ev.school);
        break;
      case 'damage':
        // every melee/ranged swing animates the attacker for all to see
        if (ev.school === 'physical' && ev.sourceId !== -1) this.triggerAttack(ev.sourceId);
        if (ev.kind === 'hit' && ev.amount > 0) {
          // landed blows flinch the victim (rate-limited inside the visual)
          this.triggerHit(ev.targetId);
          if (ev.school === 'physical') this.vfx.meleeSpark(ev.targetId, ev.crit);
        }
        break;
      case 'heal2':
        if (ev.amount > 0 || ev.crit) this.vfx.healGlow(ev.targetId);
        break;
      case 'aura': {
        const tgt = this.sim.entities.get(ev.targetId);
        if (ev.gained && tgt?.kind === 'player') this.vfx.buffSwirl(ev.targetId);
        break;
      }
      case 'levelup':
        this.vfx.levelUpPillar(this.sim.playerId);
        break;
      case 'fiestaPowerup':
        // Big celebratory pop on grab, plus a lingering coloured glow.
        this.vfx.levelUpPillar(ev.entityId);
        this.vfx.nova(ev.entityId, 'nature');
        this.fiestaGlows.set(ev.entityId, { color: ev.glow, until: this.time + ev.duration, nextSwirl: 0 });
        if (ev.entityId === this.sim.playerId) this.addShake(0.5);
        break;
    }
  }

  // ---- 2v2 Fiesta juice (driven by the HUD's event handler) --------------

  // Add camera trauma (0..1). Squared on apply, so small adds barely register
  // and big hits (kills, ring closes) really kick.
  addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  // A golden pillar bursts up off a fighter who just locked in an augment.
  fiestaAugmentBurst(entityId: number): void {
    this.vfx.levelUpPillar(entityId);
  }

  // A school-flavoured nova pops on a takedown.
  fiestaKillBurst(entityId: number, school = 'fire'): void {
    this.vfx.nova(entityId, school);
  }

  // The shrinking hazard-ring wall. Built once on first use, then positioned and
  // scaled to the live ring each frame; hidden whenever no Fiesta bout is active.
  private updateFiestaRing(dt: number): void {
    const match = this.sim.arenaInfo?.match;
    const ring = match?.fiesta?.ring;
    if (!ring || match?.state !== 'active') {
      if (this.fiestaRing) this.fiestaRing.visible = false;
      return;
    }
    if (!this.fiestaRing) {
      const geo = new THREE.CylinderGeometry(1, 1, 8, 48, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3df0, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.fiestaRing = new THREE.Mesh(geo, mat);
      this.scene.add(this.fiestaRing);
    }
    const m = this.fiestaRing;
    m.visible = true;
    const gy = groundHeight(ring.cx, ring.cz, this.sim.cfg.seed);
    m.position.set(ring.cx, gy + 3, ring.cz);
    m.scale.set(ring.radius, 1, ring.radius);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(this.time * 4) * 0.08;
    m.rotation.y += dt * 0.35;
  }

  // Floating power-up gems: a 5s growing/pulsing telegraph while 'spawning',
  // then a bright bobbing orb once 'ready'. Pooled by power-up id.
  private updateFiestaPowerups(dt: number): void {
    const match = this.sim.arenaInfo?.match;
    const list = (match?.fiesta && match.state === 'active') ? match.fiesta.powerups : [];
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let m = this.fiestaPowerupMeshes.get(p.id);
      if (!m) {
        const geo = new THREE.OctahedronGeometry(0.8, 0);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
        m = new THREE.Mesh(geo, mat);
        this.fiestaPowerupMeshes.set(p.id, m);
        this.scene.add(m);
      }
      const gy = groundHeight(p.x, p.z, this.sim.cfg.seed);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(p.color);
      if (p.state === 'spawning') {
        m.scale.setScalar(0.25 + p.frac * 0.85);
        m.position.set(p.x, gy + 0.7, p.z);
        mat.opacity = 0.3 + Math.abs(Math.sin(this.time * 9)) * 0.4; // urgent pulse
      } else {
        m.scale.setScalar(1);
        m.position.set(p.x, gy + 1.1 + Math.sin(this.time * 2 + p.id) * 0.25, p.z);
        mat.opacity = 0.9;
      }
      m.rotation.y += dt * 1.6;
    }
    for (const [id, m] of this.fiestaPowerupMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
      this.fiestaPowerupMeshes.delete(id);
    }
  }

  private tickFiestaGlows(dt: number): void {
    if (this.fiestaGlows.size === 0) return;
    for (const [id, g] of this.fiestaGlows) {
      if (this.time >= g.until || !this.views.has(id)) { this.fiestaGlows.delete(id); continue; }
      g.nextSwirl -= dt;
      if (g.nextSwirl <= 0) { g.nextSwirl = 0.22; this.vfx.buffSwirl(id, g.color); }
    }
  }

  // -------------------------------------------------------------------------
  // Entity views
  // -------------------------------------------------------------------------

  // Shared object-view resources: views must not own materials/textures, or
  // interest churn leaks them (removeView only disposes per-view geometry).
  private doorStoneMat: THREE.Material | null = null;
  private doorMineRockMat: THREE.Material | null = null;
  private doorMineWoodMat: THREE.Material | null = null;
  private doorMineDarkMat: THREE.Material | null = null;
  private doorLanternMat: THREE.Material | null = null;
  private sparkleMat: THREE.SpriteMaterial | null = null;

  private createView(e: Entity): void {
    const group = new THREE.Group();
    let visual: CharacterVisual | null = null;
    let body: THREE.Group | null = null; // object views build meshes into this
    let height = 1.2;
    let sparkle: THREE.Sprite | undefined;
    let objectMesh: THREE.Object3D | undefined;
    const isQuestVision = e.kind === 'mob' && e.templateId.startsWith('vision_');

    let portal: THREE.Mesh | undefined;
    if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
      // dungeon doorway: stone arch with a swirling portal
      const entering = e.templateId === 'dungeon_door';
      const tint = entering ? 0x9a5df0 : 0x6ab8ff;
      body = new THREE.Group();
      height = 4.6;
      this.doorStoneMat ??= new THREE.MeshLambertMaterial({ color: 0x6a6a72 });
      const stone = this.doorStoneMat;
      if (entering && e.dungeonId === 'nythraxis_crypt') {
        const clickMat = new THREE.MeshBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.001, depthWrite: false,
        });
        const clickBox = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.2, 2.4), clickMat);
        clickBox.position.y = 2.1;
        body!.add(clickBox);
      } else {
        // carved stone arch: pointed outer/inner outline + keystone + plinths
        // (no raw pillar-and-lintel boxes)
        const outer = new THREE.Shape();
        outer.moveTo(-2.1, 0);
        outer.lineTo(-2.1, 3.1);
        outer.quadraticCurveTo(-2.1, 4.85, 0, 5.05);
        outer.quadraticCurveTo(2.1, 4.85, 2.1, 3.1);
        outer.lineTo(2.1, 0);
        outer.closePath();
        const inner = new THREE.Path();
        inner.moveTo(-1.3, -0.5);
        inner.lineTo(-1.3, 2.9);
        inner.quadraticCurveTo(-1.3, 4.05, 0, 4.22);
        inner.quadraticCurveTo(1.3, 4.05, 1.3, 2.9);
        inner.lineTo(1.3, -0.5);
        inner.closePath();
        outer.holes.push(inner);
        const archGeo = new THREE.ExtrudeGeometry(outer, {
          depth: 0.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1,
        });
        archGeo.translate(0, 0, -0.35);
        const arch = new THREE.Mesh(archGeo, stone);
        arch.castShadow = true;
        body!.add(arch);
        const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.95), stone);
        keystone.position.set(0, 4.75, 0);
        keystone.castShadow = true;
        body!.add(keystone);
        for (const sx of [-1.7, 1.7]) {
          const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.7, 1.15), stone);
          plinth.position.set(sx, 0.35, 0);
          plinth.castShadow = true;
          body!.add(plinth);
        }
        const portalMat = new THREE.MeshBasicMaterial({
          color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        if (!this.lowGfx) portalMat.color.multiplyScalar(PORTAL_BOOST); // HDR swirl -> bloom
        portal = new THREE.Mesh(new THREE.CircleGeometry(1.55, 24), portalMat);
        portal.position.y = 2.15;
        portal.scale.set(1, 1.35, 1);
        body!.add(portal);
        const glow = new THREE.PointLight(tint, 9, 15, 2);
        glow.position.y = 2.4;
        body!.add(glow);
      }
      objectMesh = body!;
    } else if (e.kind === 'object') {
      const built = buildGroundQuestObject(e.objectItemId ?? '', e.id);
      body = built.group;
      height = built.height;
      objectMesh = body!;
      if (!this.sparkleMat) {
        this.sparkleMat = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false });
        if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST); // gold glint via bloom
      }
      sparkle = new THREE.Sprite(this.sparkleMat);
      sparkle.scale.set(0.9, 0.9, 1);
      sparkle.position.y = 1.35;
      group.add(sparkle);
    } else {
      const visualKey = visualKeyFor(e);
      if (visualKey === 'player_mech' && !mechAssetsReady()) {
        void preloadMechAssets().catch((err) => console.error('Failed to preload live mech cosmetic:', err));
        return;
      }
      visual = createCharacterVisual(e);
      // entity scale is applied to the whole group below, so it can update live
      // (Fiesta size buffs) and also scale lazily-built form visuals for free.
      group.add(visual.root);
      height = visual.height;
    }

    let clickTarget: THREE.Object3D;
    if (visual) {
      // raycasting skinned meshes is expensive — pick against the invisible
      // capsule proxy instead (three's raycaster ignores `visible`)
      if (!isQuestVision) visual.clickProxy.userData.entityId = e.id;
      clickTarget = visual.clickProxy;
    } else {
      group.add(body!);
      body!.traverse((o) => { o.userData.entityId = e.id; });
      clickTarget = body!;
    }
    group.scale.setScalar(e.scale);
    group.position.set(e.pos.x, e.pos.y, e.pos.z);
    group.userData.entityId = e.id;
    this.scene.add(group);
    if (!isQuestVision) this.clickTargets.push(clickTarget);

    // nameplate
    const np = document.createElement('div');
    np.className = 'nameplate';
    np.style.display = 'none';
    const emoteEl = document.createElement('div');
    emoteEl.className = 'np-emote';
    emoteEl.style.display = 'none';
    const emoteIconEl = document.createElement('img');
    emoteIconEl.className = 'np-emote-icon';
    emoteIconEl.alt = '';
    const emoteLabelEl = document.createElement('span');
    emoteLabelEl.className = 'np-emote-label';
    emoteEl.append(emoteIconEl, emoteLabelEl);
    const raidMark = document.createElement('div');
    raidMark.className = 'np-raidmark';
    raidMark.style.display = 'none';
    // combo-point pips (rogue/druid): hidden until the local player builds
    // points on this entity; lit left-to-right as they accumulate
    const comboRow = document.createElement('div');
    comboRow.className = 'np-combo';
    comboRow.style.display = 'none';
    const comboPips: HTMLDivElement[] = [];
    for (let i = 0; i < COMBO_PIP_MAX; i++) {
      const pip = document.createElement('div');
      pip.className = 'np-combo-pip';
      comboRow.appendChild(pip);
      comboPips.push(pip);
    }
    const marker = document.createElement('div');
    marker.className = 'np-marker';
    const tierEl = document.createElement('img');
    tierEl.className = 'np-tier';
    tierEl.alt = '';
    tierEl.style.display = 'none';
    const nameEl = document.createElement('div');
    nameEl.className = 'np-name';
    nameEl.textContent = e.kind === 'object' ? objectDisplayName(e) : e.name;
    const hpBar = document.createElement('div');
    hpBar.className = 'np-hpbar';
    const hpFill = document.createElement('div');
    hpFill.className = 'np-hpfill';
    hpBar.appendChild(hpFill);
    // overhead cast bar — hidden until the entity starts casting/channeling
    const castBar = document.createElement('div');
    castBar.className = 'np-castbar';
    castBar.style.display = 'none';
    const castFill = document.createElement('div');
    castFill.className = 'np-castfill';
    const castLabel = document.createElement('div');
    castLabel.className = 'np-castlabel';
    castBar.append(castFill, castLabel);
    np.append(emoteEl, raidMark, comboRow, marker, tierEl, nameEl, hpBar, castBar);
    this.nameplateLayer.appendChild(np);

    // object views gate their own casters; character shadows live in visual
    const objectCasters: THREE.Object3D[] = [];
    if (!visual) collectCasters(group, objectCasters);
    this.views.set(e.id, {
      group, visual, visualKey: visual ? visualKeyFor(e) : null, sheepVisual: null, bearVisual: null, catVisual: null, height, clickTarget,
      nameplate: np, nameEl, hpBar, hpFill, emoteEl, emoteIconEl, emoteLabelEl, markerEl: marker, raidMarkEl: raidMark, comboRow, comboPips, castBar, castFill, castLabel, tierEl, sparkle, objectMesh, portal,
      nameplateDisplay: 'none', nameplateTransform: '', nameplateSig: '', nameplateHpWidth: '', comboSig: '', tierValue: 0,
      objectCasters, shadowOn: true, isFar: false, lastOverheadEmoteKey: null,
      lastX: e.pos.x, lastZ: e.pos.z, skin: e.skin, liveScale: e.scale,
      loco: newLocoTrack(),
      stepAccum: 0, wasAirborne: false, wasSwimming: false,
    });
  }

  /** The visual the player currently sees (form swaps hide the base rig). */
  private activeVisual(v: EntityView): CharacterVisual | null {
    if (v.sheepVisual?.root.visible) return v.sheepVisual;
    if (v.bearVisual?.root.visible) return v.bearVisual;
    if (v.catVisual?.root.visible) return v.catVisual;
    return v.visual;
  }

  private updateBaseVisual(e: Entity, v: EntityView): void {
    if (!v.visual) return;
    const nextKey = visualKeyFor(e);
    if (nextKey === v.visualKey) return;
    if (nextKey === 'player_mech' && !mechAssetsReady()) {
      void preloadMechAssets().catch((err) => console.error('Failed to preload live mech cosmetic:', err));
      return;
    }
    const next = createCharacterVisual(e);
    next.root.scale.multiplyScalar(e.scale);
    next.setShadow(v.shadowOn);
    next.setFar(v.isFar);
    next.root.visible = v.visual.root.visible;
    const oldClickTarget = v.clickTarget;
    const idx = this.clickTargets.indexOf(oldClickTarget);
    v.visual.dispose();
    v.group.remove(v.visual.root);
    if (!e.templateId.startsWith('vision_')) next.clickProxy.userData.entityId = e.id;
    if (idx >= 0) this.clickTargets[idx] = next.clickProxy;
    v.visual = next;
    v.visualKey = nextKey;
    v.clickTarget = next.clickProxy;
    v.height = next.height;
    v.skin = e.skin;
    v.group.add(next.root);
  }

  triggerAttack(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playAttack();
  }

  triggerHit(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playHit();
  }

  private isHostileSelectionTarget(target: Entity): boolean {
    if (target.kind === 'mob') return target.hostile;
    if (target.kind !== 'player' || target.dead || target.id === this.sim.playerId) return false;
    if (this.sim.duelInfo?.state === 'active' && this.sim.duelInfo.otherPid === target.id) return true;
    const match = this.sim.arenaInfo?.match;
    return match?.state === 'active' && (match.oppPid === target.id || match.enemies.some((e) => e.pid === target.id));
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Dungeon interiors (see dungeon.ts), built lazily per instance origin.
  // ---------------------------------------------------------------------

  private builtInteriors = new Set<string>();
  private fogState: 'outdoor' | 'dungeon' | 'temple' | 'underwater' = 'outdoor';

  private buildInterior(interior: string, ox: number, oz: number): void {
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    void this.dungeons.buildInterior(interior, ox, oz).catch((err) => {
      console.error('Failed to build dungeon interior:', err);
    });
  }

  // Outdoor fog presets per biome (high tier eases between them as the
  // player crosses zone bands; low keeps the legacy vale fog everywhere).
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    vale: { color: 0xa6c6e0, near: 130, far: 470 },
    marsh: { color: 0xa3b294, near: 80, far: 330 },
    peaks: { color: 0xbdd3ec, near: 160, far: 560 },
  };
  private static LOW_FOG = { color: 0xa6c6e0, near: 70, far: 260 };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.LOW_FOG;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.z)];
  }

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    if (inside && isArenaPos(px)) {
      void ensureDungeonAssets().catch(() => undefined);
      // build the Ashen Coliseum copy the player was matched into
      const pz = this.sim.player.pos.z;
      for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
        const key = `arena:${i}`;
        if (this.builtInteriors.has(key)) continue;
        const o = arenaOrigin(i);
        if (Math.abs(px - o.x) < 200 && Math.abs(pz - o.z) < 120) {
          this.builtInteriors.add(key);
          this.buildInterior('arena', o.x, o.z);
        }
      }
    } else if (inside) {
      void ensureDungeonAssets().catch(() => undefined);
      // build the interior copy the player is standing in
      for (const dungeon of DUNGEON_LIST) {
        for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
          const key = `${dungeon.id}:${i}`;
          if (this.builtInteriors.has(key)) continue;
          const o = instanceOrigin(dungeon.index, i);
          if (Math.abs(px - o.x) < 200 && Math.abs(this.sim.player.pos.z - o.z) < 250) {
            this.builtInteriors.add(key);
            this.buildInterior(dungeon.interior, o.x, o.z);
          }
        }
      }
    }
    // the Drowned Temple reads as submerged: a teal murk instead of the
    // crypt's near-black, so its flooded halls feel underwater, not just dark
    const inTemple = inside && !isArenaPos(px) && dungeonAt(px)?.interior === 'temple';
    const desired = inTemple ? 'temple'
      : inside ? 'dungeon'
        : camY < WATER_LEVEL - 0.05 ? 'underwater' : 'outdoor';
    const fog = this.scene.fog as THREE.Fog;
    if (desired !== this.fogState) {
      this.fogState = desired;
      if (desired === 'dungeon') {
        fog.color.setHex(0x05060a);
        fog.near = 18;
        fog.far = 90;
      } else if (desired === 'temple') {
        fog.color.setHex(0x0a3a44);
        fog.near = 12;
        fog.far = 78;
      } else if (desired === 'underwater') {
        fog.color.setHex(0x17506e);
        fog.near = 2;
        fog.far = 48;
      } else {
        const preset = this.outdoorFogPreset();
        fog.color.setHex(preset.color);
        fog.near = preset.near;
        fog.far = preset.far;
      }
      // interiors must not leak daylight: drop sun + sky ambient + IBL
      // underground so the torch point lights own the scene; restore outside.
      // The rim glow cranks up instead — silhouettes must split from the murk.
      if (!this.lowGfx) {
        const underground = desired === 'dungeon' || desired === 'temple';
        this.sun.intensity = underground ? DUNGEON_SUN_INTENSITY : SUN_INTENSITY;
        this.hemi.intensity = underground ? DUNGEON_HEMI_INTENSITY : HEMI_INTENSITY;
        this.scene.environmentIntensity = underground ? DUNGEON_ENV_INTENSITY : this.envOutdoorIntensity;
        sharedUniforms.uRimBoost.value = underground ? DUNGEON_RIM_BOOST : 1;
      }
      return;
    }
    // outdoors: ease fog toward the current biome's preset (~2s)
    if (desired === 'outdoor' && !this.lowGfx) {
      const preset = this.outdoorFogPreset();
      const k = 1 - Math.exp(-dt * 1.5);
      fog.color.lerp(this.fogScratch.setHex(preset.color), k);
      fog.near += (preset.near - fog.near) * k;
      fog.far += (preset.far - fog.far) * k;
    }
  }

  // Swap the prefiltered environment map to the dominant biome's HDRI as the
  // camera crosses zone bands (the dome cross-fades the same textures); a
  // brief intensity dip masks the hard texture swap, then eases back like fog.
  private updateEnvBiome(dt: number): void {
    if (this.lowGfx || this.envRTs.size < 2) return;
    const blend = this.skyView.biomeAt(this.camera.position.z);
    const dominant = blend.t < 0.5 ? blend.from : blend.to;
    if (dominant !== this.envBiome && this.envRTs.has(dominant)) {
      this.envBiome = dominant;
      this.scene.environment = this.envRTs.get(dominant)!.texture;
      this.scene.environmentRotation.y = this.skyView.envRotationY(dominant);
      this.scene.environmentIntensity = this.envOutdoorIntensity * 0.4;
    }
    const k = 1 - Math.exp(-dt * 1.5);
    this.scene.environmentIntensity += (this.envOutdoorIntensity - this.scene.environmentIntensity) * k;
  }

  // Drop the view of an entity that left the world / our interest area.
  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    v.nameplate.remove();
    const idx = this.clickTargets.indexOf(v.clickTarget);
    if (idx >= 0) this.clickTargets.splice(idx, 1);
    if (v.visual) {
      // Character geometry/materials are shared per-asset caches and must
      // survive interest churn — dispose only per-instance mixer bindings.
      v.visual.dispose();
      v.sheepVisual?.dispose();
      v.bearVisual?.dispose();
      v.catVisual?.dispose();
    } else {
      // Object views (door arch, loot crates) own their geometries; their
      // materials are shared caches (door stone / crate planks / sparkle) and
      // must survive. The per-view portal swirl material is owned here.
      v.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      if (v.portal) (v.portal.material as THREE.Material).dispose();
    }
    this.views.delete(id);
  }

  sync(alpha: number, dt: number, renderFacingOverride: number | null, selfAlphaLead = 0): void {
    const totalStart = performance.now();
    let phaseStart = totalStart;
    const markPhase = (phase: RendererPhase): void => {
      const t = performance.now();
      this.recordRendererPhase(phase, t - phaseStart);
      phaseStart = t;
    };

    this.updateAdaptiveResolution(dt);
    this.viewportPollTimer += dt;
    if (this.viewportPollTimer >= 0.25) {
      this.viewportPollTimer = 0;
      const measured = this.measureViewport();
      if (measured.width !== this.viewport.width || measured.height !== this.viewport.height) {
        this.resizeViewport(measured);
      }
    }
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();
    const selfPos = this.updateSelfRenderPosition(alpha, dt, selfAlphaLead);
    markPhase('setup');

    // dynamic worlds: create nearby views lazily and drop views for leavers or
    // entities that moved well outside the draw band. This avoids building
    // rig/nameplate DOM for the whole sim on the first rendered frame.
    let createBudget = this.lowGfx ? VIEW_CREATE_BUDGET_LOW : VIEW_CREATE_BUDGET_HIGH;
    this.viewCandidates.length = 0;
    for (const e of sim.entities.values()) {
      if (this.views.has(e.id)) continue;
      const required = e.id === p.id || e.id === p.targetId;
      if (required) {
        this.createView(e);
      } else {
        const d2 = distSqXZ(e, p);
        if (d2 <= ENTITY_VIEW_CREATE_RANGE_SQ) this.viewCandidates.push({ e, d2 });
      }
    }
    if (this.viewCandidates.length > 1) this.viewCandidates.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.viewCandidates.length && createBudget > 0; i++, createBudget--) {
      this.createView(this.viewCandidates[i].e);
    }
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      const e = sim.entities.get(id);
      if (!e || (id !== p.id && id !== p.targetId && distSqXZ(e, p) > ENTITY_VIEW_DESTROY_RANGE_SQ)) {
        this.doomedIds.push(id);
      }
    }
    for (const id of this.doomedIds) this.removeView(id);

    // frame parity for distance-tiered mixer throttling
    this.frameIdx = (this.frameIdx + 1) & 0xffff;

    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      // form swaps (polymorph sheep, druid forms) — computed up front because
      // the shadow gates below must not run the base rig's proxy under a form
      const polyed = e.auras.some((a) => a.kind === 'polymorph');
      const bear = !polyed && e.auras.some((a) => a.kind === 'form_bear');
      const ghostWolf = !polyed && !bear && e.auras.some((a) => a.id === 'ghost_wolf');
      const cat = !polyed && !bear && (ghostWolf || e.auras.some((a) => a.kind === 'form_cat'));
      const stealthed = e.auras.some((a) => a.kind === 'stealth');
      // distance cull: far rigs are invisible specks but cost real draw calls
      const cdx = e.pos.x - p.pos.x, cdz = e.pos.z - p.pos.z;
      const d2 = cdx * cdx + cdz * cdz;
      if (id !== p.id) {
        if (d2 > ENTITY_DRAW_RANGE * ENTITY_DRAW_RANGE) {
          v.group.visible = false;
          continue;
        }
        v.group.visible = true; // the object branch below may re-hide loot
        // mid-distance rigs keep rendering but leave the shadow pass
        const wantShadow = d2 < ENTITY_SHADOW_RANGE_SQ;
        const inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
        if (v.visual) {
          v.visual.setShadow(wantShadow);
          v.isFar = d2 > ENTITY_LOD_RANGE_SQ;
          // past the articulated gate the static-pose proxy carries the
          // shadow; an active form's own rig keeps casting instead
          v.visual.setProxyShadow(!wantShadow && inProxyBand && !polyed && !bear && !cat);
          // sheep/forms keep articulated shadows through the whole proxy band —
          // a frozen humanoid proxy silhouette would be wrong under a form
          const wantFormShadow = wantShadow || inProxyBand;
          v.sheepVisual?.setShadow(wantFormShadow);
          v.bearVisual?.setShadow(wantFormShadow);
          v.catVisual?.setShadow(wantFormShadow);
        } else if (wantShadow !== v.shadowOn) {
          v.shadowOn = wantShadow;
          for (const caster of v.objectCasters) (caster as THREE.Mesh).castShadow = wantShadow;
        }
      }
      // online, entities beyond nameplate range stream below snapshot rate;
      // each interpolates on its own clock so they move smoothly instead of
      // freezing and dashing once per update (self keeps the global alpha
      // the camera follow uses)
      const isSelf = e.id === p.id;
      const ea = e.id !== p.id && e.netUpdatedAt !== undefined && e.netInterval !== undefined
        ? Math.min(1.25, (now - e.netUpdatedAt) / Math.max(20, e.netInterval))
        : isSelf ? selfSnapshotAlpha(alpha, selfAlphaLead) : alpha;
      const x = isSelf ? selfPos.x : e.prevPos.x + (e.pos.x - e.prevPos.x) * ea;
      const y = isSelf ? selfPos.y : e.prevPos.y + (e.pos.y - e.prevPos.y) * ea;
      const z = isSelf ? selfPos.z : e.prevPos.z + (e.pos.z - e.prevPos.z) * ea;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + shortestAngle(e.prevFacing, e.facing) * ea;
      if (id === p.id && renderFacingOverride !== null) facing = renderFacingOverride;
      v.group.rotation.y = facing;

      if (e.kind === 'object') {
        const vis = e.lootable;
        v.group.visible = vis;
        if (v.sparkle && vis) {
          // sub-pixel beyond ~45u but still a full transparent draw each
          const sdx = e.pos.x - p.pos.x, sdz = e.pos.z - p.pos.z;
          v.sparkle.visible = sdx * sdx + sdz * sdz < SPARKLE_DRAW_RANGE_SQ;
          const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
          v.sparkle.scale.set(pulse, pulse, 1);
          v.sparkle.material.rotation = this.time * 0.8;
        }
        if (v.portal && vis) {
          v.portal.rotation.z = this.time * 1.4;
          (v.portal.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 2.2 + e.id) * 0.15;
        }
        continue;
      }
      if (!v.visual) continue;

      this.updateBaseVisual(e, v);
      if (!v.visual) continue;

      // live skin swap — appearance changed (in-game changer or a multiplayer peer)
      if (e.skin !== v.skin) { v.skin = e.skin; v.visual.setSkin(e.skin); }

      // live body-size buffs (Fiesta power-ups): scale the whole group so the
      // rig, click proxy, and any form visual grow/shrink together.
      if (e.scale !== v.liveScale) { v.liveScale = e.scale; v.group.scale.setScalar(e.scale); }

      // swimming pose: prone at the surface (derived here — the sim is unaware)
      const swimming = !e.dead
        && groundHeight(e.pos.x, e.pos.z, this.sim.cfg.seed) < WATER_LEVEL - 0.8
        && e.pos.y <= WATER_LEVEL - 0.5;

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      if (polyed && !v.sheepVisual) {
        v.sheepVisual = createCharacterVisual(e, 'form_sheep');
        v.group.add(v.sheepVisual.root); // group.scale already carries e.scale
      }
      if (bear && !v.bearVisual) {
        v.bearVisual = createCharacterVisual(e, 'form_bear');
        v.group.add(v.bearVisual.root);
      }
      if (cat && !v.catVisual) {
        v.catVisual = createCharacterVisual(e, 'form_cat');
        v.group.add(v.catVisual.root);
      }
      if (v.sheepVisual) v.sheepVisual.root.visible = polyed;
      if (v.bearVisual) v.bearVisual.root.visible = bear;
      if (v.catVisual) v.catVisual.root.visible = cat;
      const active = polyed && v.sheepVisual ? v.sheepVisual
        : bear && v.bearVisual ? v.bearVisual
          : cat && v.catVisual ? v.catVisual : v.visual;
      const ghost = ghostWolf || shouldRenderStealthGhost(this.sim.playerId, e) || e.templateId.startsWith('vision_');
      active.setGhost(ghost);
      v.visual.root.visible = active === v.visual;
      // distant rigs swap to the single-draw baked idle-pose mesh
      v.visual.setFar(v.isFar && active === v.visual);

      // animation state machine inputs, derived from render-space motion with
      // hysteresis so a one-frame speed dip can't reset the walk clip.
      // For the local player online, sample the *plain* interpolated sim motion
      // (ax/ay/az), never the smoothed/predicted self render position (selfPos):
      // the online self predictor freezes-then-jumps within each snapshot
      // interval, and feeding that jitter to the cadence/airborne logic
      // intermittently flips the base state and resets the walk clip. The
      // predictor moves only the mesh. Offline, ax==x so this is a no-op.
      const ax = isSelf ? e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha : x;
      const ay = isSelf ? e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha : y;
      const az = isSelf ? e.prevPos.z + (e.pos.z - e.prevPos.z) * alpha : z;
      const vx = ax - v.lastX, vz = az - v.lastZ;
      v.lastX = ax;
      v.lastZ = az;
      const loco = updateLocomotion(v.loco, vx, vz, facing, dt);
      const moving = loco.moving;
      const visuallyDead = isVisuallyDead(e);
      // `onGround` is authoritative offline but is never sent in online snapshots
      // (ClientWorld defaults it to true), so for players fall back to deriving the
      // airborne state from foot height vs terrain — keeps the jump pose working in
      // both worlds without a wire change. Gated to players (only they jump) to keep
      // the extra groundHeight sample off the hot path for mobs/NPCs.
      const airborne = !visuallyDead && !swimming && (
        !e.onGround
        || (e.kind === 'player'
          && ay - groundHeight(ax, az, this.sim.cfg.seed) > AIRBORNE_EPS));
      const st: AnimState = {
        speed: loco.speed,
        moving,
        airborne,
        backwards: loco.backwards,
        reverseBackpedal: ghostWolf,
        dead: visuallyDead,
        casting: e.castingAbility !== null && !visuallyDead,
        swimming,
        sitting: e.kind === 'player' && (e.sitting || e.eating !== null || e.drinking !== null),
      };
      // --- spatial movement audio (self + others) --------------------------
      // All gated by audibility (squared distance) so far entities cost nothing.
      const sink = this.audioSink;
      if (sink && d2 < SFX_MOVE_RANGE_SQ) {
        // jump / land / water-entry edges
        if (airborne && !v.wasAirborne && !visuallyDead) sink.movement('jump', ax, ay, az, isSelf);
        else if (!airborne && v.wasAirborne && !visuallyDead) sink.movement('land', ax, ay, az, isSelf);
        if (swimming && !v.wasSwimming && !visuallyDead) sink.movement('splash', ax, ay, az, isSelf);
        // footfalls / swim strokes via a distance accumulator (no timers)
        if (visuallyDead || st.sitting) {
          v.stepAccum = 0;
        } else if (swimming) {
          v.stepAccum += loco.speed * dt;
          if (v.stepAccum >= SWIM_STRIDE) { v.stepAccum = 0; sink.movement('swim', ax, ay, az, isSelf); }
        } else if (moving && !airborne) {
          v.stepAccum += loco.speed * dt;
          const stride = loco.speed >= FOOT_RUN_SPEED ? FOOT_STRIDE_RUN : FOOT_STRIDE_WALK;
          if (v.stepAccum >= stride) {
            v.stepAccum = 0;
            sink.footstep(ax, ay, az, this.surfaceAt(ax, az, ay), loco.speed >= FOOT_RUN_SPEED, isSelf);
          }
        } else {
          // standing still — prime the accumulator so the first step after moving
          // lands promptly rather than after a full stride of travel.
          v.stepAccum = FOOT_STRIDE_WALK * 0.6;
        }
      }
      v.wasAirborne = airborne;
      v.wasSwimming = swimming;
      // distance-tiered mixer updates: near = every frame, mid = every 2nd,
      // far (static LOD mesh visible) = every 6th; edges latch regardless
      let animate = true;
      if (id !== p.id) {
        if (v.isFar) animate = ((this.frameIdx + e.id) % 6) === 0;
        else if (d2 > ENTITY_SHADOW_RANGE_SQ) animate = ((this.frameIdx + e.id) & 1) === 0;
      }
      active.update(dt, st, animate);

      const emoteId = e.kind === 'player' && e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
      const emoteKey = emoteId ? `${emoteId}:${e.overheadEmoteSeq}` : null;
      if (emoteKey !== v.lastOverheadEmoteKey) {
        const canPlayEmote = emoteId && !moving && !st.airborne && !st.swimming && !st.casting && !st.sitting;
        if (canPlayEmote) {
          active.playEmote(emoteId);
          v.lastOverheadEmoteKey = emoteKey;
        } else if (!emoteId) {
          v.lastOverheadEmoteKey = null;
        }
      }

      if (st.casting) {
        this.vfx.castSparkle(e.id, e.castingAbility === 'demon_heal' ? 'shadow' : ABILITIES[e.castingAbility!]?.school ?? 'arcane', dt);
      }
      if (swimming) this.vfx.swimRipple(v.group.position, moving ? dt * 3 : dt);
    }

    // selection ring
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target) {
      const tv = this.views.get(target.id);
      if (tv) {
        this.selectionRing.position.copy(tv.group.position);
        this.selectionRing.position.y += 0.08;
        this.selectionRing.scale.setScalar(target.scale);
        this.selectionRing.rotation.y += dt * SELECTION_RING_SPIN; // slow reticle spin
        const ringMat = this.selectionRing.material as THREE.MeshBasicMaterial;
        ringMat.color.setHex(this.isHostileSelectionTarget(target) ? 0xcc2222 : 0xd4af37);
        if (!this.lowGfx) ringMat.color.multiplyScalar(SELECTION_RING_BOOST); // subtle bloom edge
        ringMat.opacity = 0.78 + 0.2 * Math.sin(this.time * 4.5); // gentle pulse
        this.selectionRing.visible = true;
      } else {
        this.selectionRing.visible = false;
      }
    } else {
      this.selectionRing.visible = false;
    }
    markPhase('entities');

    // fire flicker + rising embers
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.85 + Math.sin(this.time * 9 + i * 2.4) * 0.12 + Math.sin(this.time * 23 + i) * 0.06;
      f.scale.set(fl, fl * (1 + Math.sin(this.time * 13 + i) * 0.12), fl);
      const mat = f.material as THREE.MeshLambertMaterial;
      if (mat.color.r > mat.color.b) {
        f.getWorldPosition(this.tmpV);
        this.vfx.campfireEmber(this.tmpV, dt);
      }
    }
    for (let i = 0; i < this.fireLights.length; i++) {
      const light = this.fireLights[i];
      const base = (light.userData.baseIntensity as number | undefined) ?? 11;
      light.intensity = base + Math.sin(this.time * 11 + i * 1.7) * 2.5 * (base / 11);
    }
    this.budgetFireLights(p.pos.x, p.pos.z);

    // clouds drift (the high cirrus layer crawls slower); on the lit tiers
    // they tint warm sunward / cool anti-sun to anchor the key light's azimuth
    for (const cl of this.clouds) {
      cl.position.x += dt * ((cl.userData.drift as number | undefined) ?? 1.6);
      if (cl.position.x > 320) cl.position.x = -320;
      if (!this.lowGfx) {
        const along = ((cl.position.x - this.camera.position.x) * this.sunAzimuth.x
          + (cl.position.z - this.camera.position.z) * this.sunAzimuth.z) / 320;
        const t = Math.max(-1, Math.min(1, along)) * 0.5 + 0.5;
        (cl.material as THREE.SpriteMaterial).color.setRGB(
          0.86 + 0.14 * t, 0.90 + 0.05 * t, 1.0 - 0.13 * t,
        );
      }
    }

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.waterView.update(this.time);
    this.vfx.update(dt);
    this.updateFiestaRing(dt);
    this.updateFiestaPowerups(dt);
    this.tickFiestaGlows(dt);

    this.updateCamera(selfPos, dt);
    // Fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; camera-ghost props hide against the current eye-to-camera ray.
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.propsView.update(
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    this.dungeons?.update(
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
    );
    this.foliage.update(
      p.pos.x, p.pos.z,
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.critters.update(p.pos.x, p.pos.z, dt);
    this.motes.update(p.pos.x, p.pos.z, dt);
    this.birds.update(p.pos.x, p.pos.z, dt);
    this.impactSite.update(p.pos.x, p.pos.z, dt);

    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    // shadow frustum follows the player
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.sun.position.set(pp.x + SUN_ANCHOR.x, pp.y + SUN_ANCHOR.y, pp.z + SUN_ANCHOR.z);
      this.sun.target.position.set(pp.x, pp.y, pp.z);
    }
    // sky dome + sun disc ride along with the camera
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.visible = this.fogState === 'outdoor';
    if (this.sky.visible) {
      this.skyView.setCameraZ(this.camera.position.z, dt);
      this.updateEnvBiome(dt);
    }
    // precipitation only falls outdoors; indoors/underwater pass null to clear
    this.weather.update(
      this.camera.position,
      dt,
      this.fogState === 'outdoor' ? zoneBiomeAt(p.pos.z) : null,
    );
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = this.fogState === 'outdoor';
    }
    this.updateGodRays();
    markPhase('world');

    this.nameplateTimer += dt;
    const nameplateInterval = this.isMobileRuntime() ? 1 / 15 : 1 / 24;
    const fullNameplatePass = this.nameplateTimer >= nameplateInterval;
    if (fullNameplatePass) this.nameplateTimer = 0;
    this.updateNameplates(fullNameplatePass);
    this.updateChatBubbles();
    markPhase('nameplates');
    // Fiesta screen shake: trauma^2 jitter offsets the camera for the draw only.
    let shakeX = 0, shakeY = 0;
    if (this.shakeTrauma > 0) {
      this.shakeElapsed += dt;
      const intensity = this.shakeTrauma * this.shakeTrauma;
      const t = this.shakeElapsed * 60;
      shakeX = Math.sin(t * 1.7) * intensity * 0.6;
      shakeY = Math.sin(t * 2.3 + 1.1) * intensity * 0.45;
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);
    }
    if (this.post) this.post.render();
    else this.webgl.render(this.scene, this.camera);
    if (shakeX !== 0 || shakeY !== 0) { this.camera.position.x -= shakeX; this.camera.position.y -= shakeY; }
    markPhase('submit');
    this.recordRendererPhase('total', performance.now() - totalStart);
  }

  // Forward-renderer point-light budget: every campfire/torch light exists,
  // but only the nearest GFX.maxPointLights within range shine each frame.
  // Rank entries are pooled (extended only when interiors add lights) and
  // world positions cached once — the lights never move — so this hot loop
  // allocates nothing and skips the sort while the budget isn't contended.
  private budgetFireLights(px: number, pz: number): void {
    const ranked = this.lightRank;
    while (ranked.length < this.fireLights.length) {
      const light = this.fireLights[ranked.length];
      ranked.push({ light, d2: 0, worldPos: light.getWorldPosition(new THREE.Vector3()) });
    }
    for (const entry of ranked) {
      const dx = entry.worldPos.x - px, dz = entry.worldPos.z - pz;
      entry.d2 = dx * dx + dz * dz;
    }
    if (ranked.length > GFX.maxPointLights) ranked.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < ranked.length; i++) {
      ranked[i].light.visible = i < GFX.maxPointLights && ranked[i].d2 < LIGHT_BUDGET_RANGE_SQ;
    }
  }

  // light shafts fade in as the camera turns toward the sun, outdoor only
  private updateGodRays(): void {
    if (this.godRays.length === 0) return;
    const outdoor = this.fogState === 'outdoor';
    // azimuth-only alignment — the chase cam always pitches down while the
    // sun sits high, so a full 3D dot product would never light the shafts
    this.camera.getWorldDirection(this.tmpV);
    this.tmpV.y = 0;
    this.tmpV.normalize();
    const sunAzimuth = this.tmpV2.set(this.sunDir.x, 0, this.sunDir.z).normalize();
    const facing = Math.max(0, this.tmpV.dot(sunAzimuth));
    const side = this.tmpV.set(sunAzimuth.z, 0, -sunAzimuth.x); // sunAzimuth x up
    for (let i = 0; i < this.godRays.length; i++) {
      const sp = this.godRays[i];
      sp.visible = outdoor;
      if (!outdoor) continue;
      const sway = Math.sin(this.time * 0.13 + i * 2.1) * 10;
      // hang the shafts sunward of the camera but near eye height so they
      // cross a third-person frame instead of floating 150u overhead
      sp.position.copy(this.camera.position)
        .addScaledVector(sunAzimuth, 48 + i * 26)
        .addScaledVector(side, (i - 1) * 30 + sway);
      sp.position.y = this.camera.position.y + 16 + i * 7;
      sp.material.opacity = facing * facing * facing * (0.30 - i * 0.05);
    }
  }

  private updateSelfRenderPosition(alpha: number, dt: number, selfAlphaLead: number): THREE.Vector3 {
    const p = this.sim.player;
    const playerAlpha = selfSnapshotAlpha(alpha, selfAlphaLead);
    const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * playerAlpha;
    const py = p.prevPos.y + (p.pos.y - p.prevPos.y) * playerAlpha;
    const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * playerAlpha;
    if (selfAlphaLead > 0) {
      const dx = px - this.selfRenderPosition.x;
      const dy = py - this.selfRenderPosition.y;
      const dz = pz - this.selfRenderPosition.z;
      if (!this.selfRenderPositionReady || dx * dx + dy * dy + dz * dz > SELF_RENDER_SNAP_DIST_SQ) {
        this.selfRenderPosition.set(px, py, pz);
        this.selfRenderPositionReady = true;
      } else {
        const t = 1 - Math.exp(-SELF_RENDER_SMOOTH_RATE * Math.max(0, dt));
        this.selfRenderPosition.x += dx * t;
        this.selfRenderPosition.y += dy * t;
        this.selfRenderPosition.z += dz * t;
      }
    } else {
      this.selfRenderPosition.set(px, py, pz);
      this.selfRenderPositionReady = true;
    }
    return this.selfRenderPosition;
  }

  private updateCamera(selfPos: THREE.Vector3, dt: number): void {
    const p = this.sim.player;
    const seed = this.sim.cfg.seed;
    const px = selfPos.x;
    const py = selfPos.y;
    const pz = selfPos.z;
    const eyeY = py + 2.0;
    let cx = px - Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    let cy = eyeY + Math.sin(this.camPitch) * this.camDist;
    let cz = pz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    if (isArenaPos(p.pos.x)) {
      // Arena walls hide from the camera like buildings, so the chase camera
      // stays at the player's requested zoom instead of clamping inside the pit.
      this.camOcclusion.pullT = 1;
      this.camOcclusion.lensT = 1;
      this.camOcclusion.fov = CAMERA_BASE_FOV;
    } else {
      // Camera collision for non-hideable blockers. Camera-ghost props are left
      // at the requested zoom and hidden in props.ts while keeping their shadows.
      let hardT = cameraOcclusion(seed, px, eyeY, pz, cx, cy, cz, CAMERA_COLLIDER_PAD);
      let softT = cameraOcclusion(seed, px, eyeY, pz, cx, cy, cz, CAMERA_SOFT_COLLIDER_PAD);
      const segLen = Math.hypot(cx - px, cy - eyeY, cz - pz);
      if (segLen > 1e-3) {
        const minT = CAMERA_MIN_DIST / segLen;
        hardT = Math.min(1, Math.max(hardT, minT));
        softT = Math.min(1, Math.max(softT, minT));
      }
      stepCameraOcclusion(
        this.camOcclusion,
        hardT,
        softT,
        dt,
        CAMERA_PULL_IN_RATE,
        CAMERA_PULL_OUT_RATE,
        CAMERA_SOFT_PULL_WEIGHT,
        CAMERA_BASE_FOV,
        CAMERA_MAX_COMP_FOV,
      );
    }
    const ct = this.camOcclusion.pullT;
    cx = px + (cx - px) * ct;
    cy = eyeY + (cy - eyeY) * ct;
    cz = pz + (cz - pz) * ct;
    const groundY = groundHeight(cx, cz, seed) + 0.6;
    this.camera.position.set(cx, Math.max(cy, groundY), cz);
    if (Math.abs(this.camera.fov - this.camOcclusion.fov) > 0.01) {
      this.camera.fov = this.camOcclusion.fov;
      this.camera.updateProjectionMatrix();
    }
    this.cameraLookAt.set(px, eyeY, pz);
    this.camera.lookAt(this.cameraLookAt);
    this.camera.updateMatrixWorld();

    // Spatial-audio listener (at the camera, facing the player) + ambience state.
    const sink = this.audioSink;
    if (sink) {
      const cpx = this.camera.position.x, cpy = this.camera.position.y, cpz = this.camera.position.z;
      let fx = px - cpx, fy = eyeY - cpy, fz = pz - cpz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      sink.setListener(cpx, cpy, cpz, fx / fl, fy / fl, fz / fl);
      const inDungeon = px > DUNGEON_X_THRESHOLD;
      const biome = zoneBiomeAt(pz);
      const precip = !this.weatherOn || inDungeon ? null : biome === 'peaks' ? 'snow' : biome === 'marsh' ? 'rain' : null;
      // Only at the water's edge / in it — sampled at the player, so a loose
      // threshold made the loop bleed across the low marsh from far off.
      const nearWater = !inDungeon && groundHeight(px, pz, seed) < WATER_LEVEL + 0.4;
      sink.ambience(biome, inDungeon, precip, nearWater);
    }
  }

  private updateNameplates(fullPass: boolean): void {
    const sim = this.sim;
    const p = sim.player;
    const { width: w, height: h } = this.viewport;
    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d2 = dx * dx + dz * dz;
      const urgent = id === p.targetId || d2 < 14 * 14 || e.castingAbility !== null;
      const isSelf = id === p.id;
      const hasOverheadEmote = !!(e.kind === 'player' && e.overheadEmoteId && !e.dead);
      const isDoor = e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit';
      const hidden = (isSelf && !hasOverheadEmote) || d2 > NAMEPLATE_RANGE_SQ
        || (e.dead && !e.lootable && e.kind === 'mob')
        || (e.kind === 'object' && !isDoor)
        || (!this.showNameplates && e.kind === 'mob' && !e.dead);
      if (hidden) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale + (isSelf && hasOverheadEmote ? 0.2 : 0.8);
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      if (v.nameplateDisplay !== '') {
        v.nameplate.style.display = '';
        v.nameplateDisplay = '';
      }
      const transform = nameplateScreenTransform(sx, sy);
      if (transform !== v.nameplateTransform) {
        v.nameplate.style.transform = transform;
        v.nameplateTransform = transform;
      }

      if (!fullPass && !urgent) continue;
      v.nameplate.classList.toggle('has-emote', hasOverheadEmote);

      // party raid/target marker (only mobs are markable, so this is null elsewhere)
      const emote = e.overheadEmoteId ? OVERHEAD_EMOTES.find((x) => x.id === e.overheadEmoteId) : null;
      if (emote && e.kind === 'player' && !e.dead) {
        v.emoteIconEl.src = emoteIconUrl(emote.id);
        v.emoteLabelEl.textContent = emote.label;
        v.emoteEl.title = emote.label;
        v.emoteEl.style.display = '';
      } else {
        v.emoteEl.style.display = 'none';
      }
      v.nameEl.style.display = '';

      const raidMark = this.sim.markerFor(e.id);
      if (raidMark !== null) {
        v.raidMarkEl.style.backgroundImage = `url(${raidMarkerDataUrl(raidMark)})`;
        v.raidMarkEl.style.display = '';
      } else {
        v.raidMarkEl.style.display = 'none';
      }

      // combo points the local player has built on this entity (rogue/druid)
      this.setNameplateCombo(v, comboPipsFor(p, e));

      if (e.kind === 'object') {
        // dungeon doorways announce themselves
        const objName = objectDisplayName(e);
        this.setNameplateStatic(v, `object|${objName}`, objName, '#c084ff', 'none', '', 'np-marker', '1');
      } else if (e.kind === 'player') {
        // other players: friendly blue with an hp bar
        const opacity = e.auras.some((a) => a.kind === 'stealth') ? '0.55' : '1';
        const nameDisplay = isSelf ? 'none' : '';
        const hpDisplay = e.dead || isSelf ? 'none' : '';
        this.setNameplateStatic(v, `player|${e.name}|${nameDisplay}|${hpDisplay}|${opacity}`, e.name, '#7fb8ff', hpDisplay, '', 'np-marker', opacity);
        v.nameEl.style.display = nameDisplay;
        // $WOC holder-tier flair, shown on OTHER players (own nameplate is hidden).
        this.setNameplateTier(v, isSelf ? 0 : (e.holderTier ?? 0));
        this.setNameplateHp(v, e);
      } else if (e.kind === 'npc') {
        const npcName = npcDisplayName(e.templateId);
        let marker = '';
        let cls = '';
        // role-aware: '!' only at the quest's giver, '?' only at its turn-in
        // NPC (gray while in progress), matching the gossip dialog
        for (const qid of e.questIds) {
          const quest = QUESTS[qid];
          if (!quest) continue;
          const st = sim.questState(qid);
          if (st === 'ready' && quest.turnInNpcId === e.templateId) { marker = '?'; cls = 'ready'; break; }
          if (st === 'available' && quest.giverNpcId === e.templateId) { marker = '!'; cls = 'avail'; }
          else if (st === 'active' && quest.turnInNpcId === e.templateId && !marker) { marker = '?'; cls = 'active'; }
        }
        const markerClass = cls ? `np-marker ${cls}` : 'np-marker';
        this.setNameplateStatic(v, `npc|${npcName}|${marker}|${markerClass}`, npcName, '#9fdc7f', 'none', marker, markerClass, '1');
      } else {
        const diff = e.level - p.level;
        const template = MOBS[e.templateId];
        const elite = !!template?.elite;
        const boss = !!template?.boss;
        const color = e.dead ? '#999' : diff >= 3 ? '#ff4444' : diff >= 1 ? '#ffaa33' : diff >= -2 ? '#ffe97a' : diff >= -5 ? '#7fdc4f' : '#9d9d9d';
        const mobName = e.ownerId !== null ? e.name : mobDisplayName(e.templateId);
        const name = e.dead ? t('worldContent.corpseName', { name: mobName }) : `[${e.level}${elite ? '+' : ''}] ${mobName}`;
        const hpDisplay = e.dead ? 'none' : '';
        const marker = e.lootable ? '$' : elite && !e.dead ? '◆' : '';
        // classic "dragon frame" cue: gold bar frame for elites, red for bosses (live mobs only)
        const frame = e.dead ? '' : boss ? 'boss' : elite ? 'elite' : '';
        this.setNameplateStatic(v, `mob|${name}|${color}|${hpDisplay}|${marker}|${frame}`, name, color, hpDisplay, marker, 'np-marker loot', '1', frame);
        this.setNameplateHp(v, e);
        // threat plate: tint the bar red when this mob is aggroed on me
        v.nameplate.classList.toggle('np-threat', isMobThreateningViewer(e, this.sim.playerId));
      }

      this.updateCastBar(v, e);
    }
  }

  private setNameplateStatic(
    v: EntityView,
    sig: string,
    name: string,
    color: string,
    hpDisplay: string,
    marker: string,
    markerClass: string,
    opacity: string,
    frame = '',
  ): void {
    if (sig === v.nameplateSig) return;
    v.nameplateSig = sig;
    v.nameEl.textContent = name;
    v.nameEl.style.color = color;
    v.hpBar.style.display = hpDisplay;
    v.hpBar.classList.toggle('elite', frame === 'elite');
    v.hpBar.classList.toggle('boss', frame === 'boss');
    v.markerEl.textContent = marker;
    v.markerEl.className = markerClass;
    v.nameplate.style.opacity = opacity;
  }

  // Show/hide the $WOC holder-tier badge on a player's nameplate. Cheap-diffed
  // on the tier value so the badge image is only rebuilt when the tier changes.
  private setNameplateTier(v: EntityView, tier: number): void {
    if (tier === v.tierValue) return;
    v.tierValue = tier;
    const def = tier > 0 ? HOLDER_TIERS.find((t) => t.index === tier) : undefined;
    if (def) {
      v.tierEl.src = holderTierBadgeDataUrl(def, 32);
      v.tierEl.title = `${def.name} — $WOC holder`;
      v.tierEl.style.display = '';
    } else {
      v.tierEl.removeAttribute('src');
      v.tierEl.style.display = 'none';
    }
  }

  private setNameplateHp(v: EntityView, e: Entity): void {
    const width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
    if (width === v.nameplateHpWidth) return;
    v.nameplateHpWidth = width;
    v.hpFill.style.width = width;
  }

  // Light `count` of the COMBO_PIP_MAX pips over this nameplate; hide the row
  // entirely at zero so non-combo classes/targets show nothing.
  private setNameplateCombo(v: EntityView, count: number): void {
    const n = Math.max(0, Math.min(COMBO_PIP_MAX, count));
    const sig = `${n}`;
    if (sig === v.comboSig) return;
    v.comboSig = sig;
    v.comboRow.style.display = n > 0 ? '' : 'none';
    for (let i = 0; i < v.comboPips.length; i++) {
      v.comboPips[i].classList.toggle('lit', i < n);
    }
  }

  // Overhead spell cast/channel bar. The fill + label rules live in the DOM-free
  // castBarState() helper (cast_bar.ts); here we just push them to the DOM. Casts
  // fill up toward completion, channels drain down — both honest to the live
  // cast fields the sim and the online snapshot already expose.
  private updateCastBar(v: EntityView, e: Entity): void {
    const st = castBarState(e);
    if (!st.visible) {
      if (v.castBar.style.display !== 'none') v.castBar.style.display = 'none';
      return;
    }
    v.castBar.style.display = '';
    v.castBar.classList.toggle('channel', st.channel);
    v.castFill.style.width = `${(st.fill * 100).toFixed(1)}%`;
    v.castLabel.textContent = st.label;
  }

  // Hang a speech bubble over an entity's head; it follows the entity and
  // fades out after a few seconds (longer for longer messages).
  showChatBubble(entityId: number, text: string, yell: boolean): void {
    let b = this.chatBubbles.get(entityId);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      this.nameplateLayer.appendChild(el);
      b = { el, until: 0 };
      this.chatBubbles.set(entityId, b);
    }
    b.el.textContent = text; // textContent: chat is player input, never HTML
    b.el.classList.toggle('yell', yell);
    // wall-clock ttl: sim/render time can run slower than real time under
    // frame-delta clamping, which would keep bubbles up too long
    b.until = performance.now() + 1000 * Math.min(10, 3.5 + text.length * 0.045);
  }

  private updateChatBubbles(): void {
    if (this.chatBubbles.size === 0) return;
    const { width: w, height: h } = this.viewport;
    const now = performance.now();
    for (const [id, b] of this.chatBubbles) {
      const e = this.sim.entities.get(id);
      const v = e ? this.views.get(id) : undefined;
      if (!e || !v || now >= b.until) {
        b.el.remove();
        this.chatBubbles.delete(id);
        continue;
      }
      // culled rigs (beyond ENTITY_DRAW_RANGE) stop updating group.position,
      // so a yell from 80–100u away would hang frozen over empty terrain —
      // fall back to the live entity position when the rig isn't being drawn
      if (v.group.visible) this.tmpV.copy(v.group.position);
      else this.tmpV.set(e.pos.x, e.pos.y, e.pos.z);
      this.tmpV.y += v.height * e.scale + 1.0;
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        b.el.style.display = 'none';
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      b.el.style.transform = nameplateScreenTransform(sx, sy);
    }
  }

  // Click-to-move (#95): where a screen click meets the ground. Intersects a
  // horizontal plane at the player's foot height — robust on the gentle terrain
  // here and far cheaper than raycasting the terrain mesh.
  groundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.entityId !== undefined && o.userData.entityId !== this.sim.playerId) {
          const e = this.sim.entities.get(o.userData.entityId as number);
          if (e?.kind === 'object' && !e.lootable) return null;
          return o.userData.entityId as number;
        }
        o = o.parent;
      }
    }
    // Forgiving assist: nothing under the ray, so snap to the nearest
    // targetable character within a small screen radius — chibi proportions
    // and melee scrums (often hidden behind the player's own model) make
    // precise capsule clicks fiddly. Objects (doors/loot) still need a
    // direct hit; the local player never competes for the click.
    const SLOPPY_PICK_PX = 26;
    let bestId: number | null = null;
    let bestD = SLOPPY_PICK_PX;
    for (const [id, v] of this.views) {
      if (id === this.sim.playerId || !v.visual || !v.group.visible) continue;
      const e = this.sim.entities.get(id);
      if (!e || (e.dead && !e.lootable)) continue;
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale * 0.5;
      this.tmpV.project(this.camera);
      if (this.tmpV.z > 1) continue;
      const sx = (this.tmpV.x * 0.5 + 0.5) * this.viewport.width;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * this.viewport.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    return bestId;
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.viewport.width,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.viewport.height,
      behind: this.tmpV.z > 1,
    };
  }
}

function shortestAngle(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
