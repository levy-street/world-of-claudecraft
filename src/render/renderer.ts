import * as THREE from 'three';
import { Entity, SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { groundHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import {
  MOBS, ABILITIES, DUNGEON_X_THRESHOLD, DUNGEON_LIST, QUESTS,
  instanceOrigin, INSTANCE_SLOT_COUNT, ARENA_SLOT_COUNT, arenaOrigin, arenaOriginAt, isArenaPos,
} from '../sim/data';
import { ARENA_LAYOUT, DUNGEON_WALL_X } from '../sim/dungeon_layout';
import type { BiomeId } from '../sim/types';
import { AnimState, CharacterVisual, createCharacterVisual } from './characters';
import { LocoTrack, newLocoTrack, updateLocomotion } from './locomotion';
import { buildProps } from './props';
import { plankTexture, sparkleTexture } from './textures';
import { DungeonInteriors } from './dungeon';
import { Vfx } from './vfx';
import {
  GFX, initGfxTier, sharedUniforms, SUN_ANCHOR, SUN_DIR, surfaceMat,
} from './gfx';
import { buildComposer, PostPipeline } from './post';
import { buildTerrain, TerrainView } from './terrain';
import { buildWater, WaterView } from './water';
import { buildClouds, buildSky, SkyView } from './sky';
import { buildFoliage, FoliageView } from './foliage';
import { shouldRenderStealthGhost } from './stealth';
import { raidMarkerDataUrl } from '../ui/icons';
import { isProjectedNameplateAnchorVisible } from './nameplate_projection';

const NAMEPLATE_RANGE = 55;
// Entities further than this from the player are hidden entirely: their rigs
// are several draw calls each and read as sub-pixel specks long before this.
const ENTITY_DRAW_RANGE = 80;
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
// fire/torch point lights beyond this never shine (their falloff range is
// shorter anyway); the nearest GFX.maxPointLights within it win the budget
const LIGHT_BUDGET_RANGE_SQ = 55 * 55;
// HDR boosts so the bloom pass picks these out (composer tiers only)
const SELECTION_RING_BOOST = 1.5;
const SPARKLE_BOOST = 1.5;
const PORTAL_BOOST = 2;
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

interface EntityView {
  group: THREE.Group;
  /** rigged glTF visual for characters; null for object views (doors/crates) */
  visual: CharacterVisual | null;
  sheepVisual: CharacterVisual | null; // polymorph form, built lazily
  bearVisual: CharacterVisual | null; // druid bear form, built lazily
  /** unscaled height — nameplate/vfx anchor reads height * e.scale */
  height: number;
  /** what removeView pulls back out of clickTargets */
  clickTarget: THREE.Object3D;
  nameplate: HTMLDivElement;
  nameEl: HTMLDivElement;
  hpBar: HTMLDivElement;
  hpFill: HTMLDivElement;
  markerEl: HTMLDivElement;
  raidMarkEl: HTMLDivElement; // party raid/target marker, above the name
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  portal?: THREE.Mesh; // dungeon door swirl
  objectCasters: THREE.Object3D[]; // object-view shadow meshes, distance-gated
  shadowOn: boolean;
  isFar: boolean;
  // render-space position last frame, for true u/s locomotion speed
  lastX: number;
  lastZ: number;
  // locomotion-state hysteresis so a one-frame speed dip can't reset the
  // walk clip (see locomotion.ts)
  loco: LocoTrack;
}

function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
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
  showNameplates = true;
  // settings-menu graphics knobs (applied live)
  private renderScale = 1; // resolution multiplier on top of the device pixel ratio
  private baseExposure = 1.12; // tone-mapping exposure at brightness 1.0
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
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
  private fogScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private fireLights: THREE.PointLight[];
  private propsView!: { update(camX: number, camZ: number, fogFar: number): void };
  private lightRank: { light: THREE.PointLight; d2: number; worldPos: THREE.Vector3 }[] = [];
  private doomedIds: number[] = [];
  private dungeons: DungeonInteriors | null = null;
  private envRTs = new Map<BiomeId, THREE.WebGLRenderTarget>();
  private envBiome: BiomeId = 'vale';
  private envOutdoorIntensity = ENV_INTENSITY;
  private time = 0;
  private frameIdx = 0;
  vfx: Vfx;

  private lowGfx: boolean;
  private post: PostPipeline | null = null;
  private godRays: THREE.Sprite[] = [];
  private viewport = { width: 1, height: 1 };

  constructor(private sim: IWorld, canvas: HTMLCanvasElement, nameplateLayer: HTMLDivElement) {
    this.nameplateLayer = nameplateLayer;
    // No default-framebuffer MSAA on any tier: high/ultra get AA from the
    // composer's MSAA HalfFloat target, low is meant to run without AA — and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    initGfxTier(this.webgl); // software-GL autodetect needs the live context
    this.lowGfx = GFX.tier === 'low';
    const LOW_GFX = this.lowGfx;
    this.viewport = this.measureViewport();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    this.webgl.shadowMap.enabled = !LOW_GFX;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass reads this on the composer path
    this.webgl.toneMappingExposure = this.baseExposure;
    this.camera = new THREE.PerspectiveCamera(60, this.viewport.width / this.viewport.height, 0.1, 950);

    this.scene.fog = new THREE.Fog(0xa6c6e0, 130, 470);

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

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x46603a, LOW_GFX ? 1.0 : HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(LOW_GFX ? 0xfff0cd : 0xffedd0, LOW_GFX ? 2.2 : SUN_INTENSITY);
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
    const props = buildProps(this.sim.cfg.seed);
    this.scene.add(props.group);
    this.flames = props.flames;
    this.fireLights = props.fireLights;
    this.propsView = props;

    // selection ring
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, depthWrite: false }),
    );
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

    for (const e of sim.entities.values()) this.createView(e);

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

  private resizeViewport(): void {
    this.viewport = this.measureViewport();
    this.camera.aspect = this.viewport.width / this.viewport.height;
    this.camera.updateProjectionMatrix();
    this.applyResolution();
  }

  // Push the current device pixel ratio (× renderScale, still capped by the
  // tier) to the renderer, composer, and vfx. Shared by resize and the
  // render-scale setting so a window resize never drops the chosen scale.
  private applyResolution(): void {
    this.viewport = this.measureViewport();
    const ratio = Math.min(window.devicePixelRatio, GFX.pixelRatioCap) * this.renderScale;
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

  /** Resolution multiplier on top of the device pixel ratio (0.5..1). */
  setRenderScale(scale: number): void {
    this.renderScale = Math.min(1, Math.max(0.5, scale));
    this.applyResolution();
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
    }
  }

  // -------------------------------------------------------------------------
  // Entity views
  // -------------------------------------------------------------------------

  // Shared object-view resources: views must not own materials/textures, or
  // interest churn leaks them (removeView only disposes per-view geometry).
  private doorStoneMat: THREE.Material | null = null;
  private crateMat: THREE.Material | null = null;
  private crateLidMat: THREE.Material | null = null;
  private sparkleMat: THREE.SpriteMaterial | null = null;

  private createView(e: Entity): void {
    const group = new THREE.Group();
    let visual: CharacterVisual | null = null;
    let body: THREE.Group | null = null; // object views build meshes into this
    let height = 1.2;
    let sparkle: THREE.Sprite | undefined;
    let objectMesh: THREE.Object3D | undefined;

    let portal: THREE.Mesh | undefined;
    if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
      // dungeon doorway: stone arch with a swirling portal
      const entering = e.templateId === 'dungeon_door';
      const tint = entering ? 0x9a5df0 : 0x6ab8ff;
      body = new THREE.Group();
      height = 4.6;
      this.doorStoneMat ??= new THREE.MeshLambertMaterial({ color: 0x6a6a72 });
      const stone = this.doorStoneMat;
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
      objectMesh = body!;
    } else if (e.kind === 'object') {
      body = new THREE.Group();
      height = 1.2;
      // braced plank crate matching the props.ts crates — never a bare cube
      this.crateMat ??= new THREE.MeshLambertMaterial({ map: plankTexture() });
      this.crateLidMat ??= new THREE.MeshLambertMaterial({ color: 0x4a3320 });
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.78), this.crateMat);
      crate.position.y = 0.42;
      crate.castShadow = true;
      body!.add(crate);
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.86, 0.1), this.crateLidMat);
          brace.position.set(sx * 0.37, 0.42, sz * 0.37);
          body!.add(brace);
        }
      }
      for (const sy of [0.06, 0.78]) {
        for (const s of [1, -1]) {
          const stripA = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.08), this.crateLidMat);
          stripA.position.set(0, sy, s * 0.38);
          const stripB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.82), this.crateLidMat);
          stripB.position.set(s * 0.38, sy, 0);
          body!.add(stripA, stripB);
        }
      }
      body!.rotation.y = (e.id % 7) * 0.45; // break identical alignment
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
      visual = createCharacterVisual(e);
      visual.root.scale.multiplyScalar(e.scale);
      group.add(visual.root);
      height = visual.height;
    }

    let clickTarget: THREE.Object3D;
    if (visual) {
      // raycasting skinned meshes is expensive — pick against the invisible
      // capsule proxy instead (three's raycaster ignores `visible`)
      visual.clickProxy.userData.entityId = e.id;
      clickTarget = visual.clickProxy;
    } else {
      body!.scale.multiplyScalar(e.scale);
      group.add(body!);
      body!.traverse((o) => { o.userData.entityId = e.id; });
      clickTarget = body!;
    }
    group.position.set(e.pos.x, e.pos.y, e.pos.z);
    group.userData.entityId = e.id;
    this.scene.add(group);
    this.clickTargets.push(clickTarget);

    // nameplate
    const np = document.createElement('div');
    np.className = 'nameplate';
    const raidMark = document.createElement('div');
    raidMark.className = 'np-raidmark';
    raidMark.style.display = 'none';
    const marker = document.createElement('div');
    marker.className = 'np-marker';
    const nameEl = document.createElement('div');
    nameEl.className = 'np-name';
    nameEl.textContent = e.name;
    const hpBar = document.createElement('div');
    hpBar.className = 'np-hpbar';
    const hpFill = document.createElement('div');
    hpFill.className = 'np-hpfill';
    hpBar.appendChild(hpFill);
    np.append(raidMark, marker, nameEl, hpBar);
    this.nameplateLayer.appendChild(np);

    // object views gate their own casters; character shadows live in visual
    const objectCasters: THREE.Object3D[] = [];
    if (!visual) collectCasters(group, objectCasters);
    this.views.set(e.id, {
      group, visual, sheepVisual: null, bearVisual: null, height, clickTarget,
      nameplate: np, nameEl, hpBar, hpFill, markerEl: marker, raidMarkEl: raidMark, sparkle, objectMesh, portal,
      objectCasters, shadowOn: true, isFar: false,
      lastX: e.pos.x, lastZ: e.pos.z,
      loco: newLocoTrack(),
    });
  }

  /** The visual the player currently sees (form swaps hide the base rig). */
  private activeVisual(v: EntityView): CharacterVisual | null {
    if (v.sheepVisual?.root.visible) return v.sheepVisual;
    if (v.bearVisual?.root.visible) return v.bearVisual;
    return v.visual;
  }

  triggerAttack(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playAttack();
  }

  triggerHit(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playHit();
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Dungeon interiors (see dungeon.ts), built lazily per instance origin.
  // ---------------------------------------------------------------------

  private builtInteriors = new Set<string>();
  private fogState: 'outdoor' | 'dungeon' | 'underwater' = 'outdoor';

  private buildInterior(interior: string, ox: number, oz: number): void {
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    this.dungeons.buildInterior(interior, ox, oz);
  }

  // Outdoor fog presets per biome (high tier eases between them as the
  // player crosses zone bands; low keeps the legacy vale fog everywhere).
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    vale: { color: 0xa6c6e0, near: 130, far: 470 },
    marsh: { color: 0xa3b294, near: 80, far: 330 },
    peaks: { color: 0xbdd3ec, near: 160, far: 560 },
  };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.BIOME_FOG.vale;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.z)];
  }

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    if (inside && isArenaPos(px)) {
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
    const desired = inside ? 'dungeon' : camY < WATER_LEVEL - 0.05 ? 'underwater' : 'outdoor';
    const fog = this.scene.fog as THREE.Fog;
    if (desired !== this.fogState) {
      this.fogState = desired;
      if (desired === 'dungeon') {
        fog.color.setHex(0x05060a);
        fog.near = 18;
        fog.far = 90;
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
        const underground = desired === 'dungeon';
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

  sync(alpha: number, dt: number, renderFacingOverride: number | null): void {
    const measured = this.measureViewport();
    if (measured.width !== this.viewport.width || measured.height !== this.viewport.height) {
      this.resizeViewport();
    }
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();

    // dynamic worlds: create views for newcomers, drop views for leavers
    // (doomed ids collected into a reused scratch array — no per-frame alloc)
    for (const e of sim.entities.values()) {
      if (!this.views.has(e.id)) this.createView(e);
    }
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      if (!sim.entities.has(id)) this.doomedIds.push(id);
    }
    for (const id of this.doomedIds) this.removeView(id);

    // frame parity for distance-tiered mixer throttling
    this.frameIdx = (this.frameIdx + 1) & 0xffff;

    for (const e of sim.entities.values()) {
      const v = this.views.get(e.id);
      if (!v) continue;
      // form swaps (polymorph sheep, druid bear) — computed up front because
      // the shadow gates below must not run the base rig's proxy under a form
      const polyed = e.auras.some((a) => a.kind === 'polymorph');
      const bear = !polyed && e.auras.some((a) => a.kind === 'form_bear');
      const stealthed = e.auras.some((a) => a.kind === 'stealth');
      // distance cull: far rigs are invisible specks but cost real draw calls
      const cdx = e.pos.x - p.pos.x, cdz = e.pos.z - p.pos.z;
      const d2 = cdx * cdx + cdz * cdz;
      if (e.id !== p.id) {
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
          v.visual.setProxyShadow(!wantShadow && inProxyBand && !polyed && !bear);
          // sheep/bear keep articulated shadows through the whole proxy band —
          // a frozen humanoid proxy silhouette would be wrong under a form
          const wantFormShadow = wantShadow || inProxyBand;
          v.sheepVisual?.setShadow(wantFormShadow);
          v.bearVisual?.setShadow(wantFormShadow);
        } else if (wantShadow !== v.shadowOn) {
          v.shadowOn = wantShadow;
          for (const caster of v.objectCasters) (caster as THREE.Mesh).castShadow = wantShadow;
        }
      }
      // online, entities beyond nameplate range stream below snapshot rate;
      // each interpolates on its own clock so they move smoothly instead of
      // freezing and dashing once per update (self keeps the global alpha
      // the camera follow uses)
      const ea = e.id !== p.id && e.netUpdatedAt !== undefined && e.netInterval !== undefined
        ? Math.min(1.25, (now - e.netUpdatedAt) / Math.max(20, e.netInterval))
        : alpha;
      const x = e.prevPos.x + (e.pos.x - e.prevPos.x) * ea;
      const y = e.prevPos.y + (e.pos.y - e.prevPos.y) * ea;
      const z = e.prevPos.z + (e.pos.z - e.prevPos.z) * ea;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + shortestAngle(e.prevFacing, e.facing) * ea;
      if (e.id === p.id && renderFacingOverride !== null) facing = renderFacingOverride;
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

      // swimming pose: prone at the surface (derived here — the sim is unaware)
      const swimming = !e.dead
        && groundHeight(e.pos.x, e.pos.z, this.sim.cfg.seed) < WATER_LEVEL - 0.8
        && e.pos.y <= WATER_LEVEL - 0.5;

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      if (polyed && !v.sheepVisual) {
        v.sheepVisual = createCharacterVisual(e, 'form_sheep');
        v.sheepVisual.root.scale.multiplyScalar(e.scale);
        v.group.add(v.sheepVisual.root);
      }
      if (bear && !v.bearVisual) {
        v.bearVisual = createCharacterVisual(e, 'form_bear');
        v.bearVisual.root.scale.multiplyScalar(e.scale);
        v.group.add(v.bearVisual.root);
      }
      if (v.sheepVisual) v.sheepVisual.root.visible = polyed;
      if (v.bearVisual) v.bearVisual.root.visible = bear;
      const active = polyed && v.sheepVisual ? v.sheepVisual
        : bear && v.bearVisual ? v.bearVisual : v.visual;
      const ghost = shouldRenderStealthGhost(this.sim.playerId, e);
      active.setGhost(ghost);
      v.visual.root.visible = active === v.visual;
      // distant rigs swap to the single-draw baked idle-pose mesh
      v.visual.setFar(v.isFar && active === v.visual);

      // animation state machine inputs, derived from render-space motion with
      // hysteresis so a one-frame speed dip can't reset the walk clip
      const vx = x - v.lastX, vz = z - v.lastZ;
      v.lastX = x;
      v.lastZ = z;
      const loco = updateLocomotion(v.loco, vx, vz, facing, dt);
      const moving = loco.moving;
      const st: AnimState = {
        speed: loco.speed,
        moving,
        backwards: loco.backwards,
        dead: e.dead,
        casting: e.castingAbility !== null && !e.dead,
        swimming,
        sitting: e.kind === 'player' && (e.sitting || e.eating !== null || e.drinking !== null),
      };
      // distance-tiered mixer updates: near = every frame, mid = every 2nd,
      // far (static LOD mesh visible) = every 6th; edges latch regardless
      let animate = true;
      if (e.id !== p.id) {
        if (v.isFar) animate = ((this.frameIdx + e.id) % 6) === 0;
        else if (d2 > ENTITY_SHADOW_RANGE_SQ) animate = ((this.frameIdx + e.id) & 1) === 0;
      }
      active.update(dt, st, animate);

      if (st.casting) {
        this.vfx.castSparkle(e.id, ABILITIES[e.castingAbility!]?.school ?? 'arcane', dt);
      }
      if (swimming) this.vfx.swimRipple(v.group.position, moving ? dt * 3 : dt);
    }

    // selection ring
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target) {
      const tv = this.views.get(target.id)!;
      this.selectionRing.position.copy(tv.group.position);
      this.selectionRing.position.y += 0.08;
      this.selectionRing.scale.setScalar(target.scale);
      const ringMat = this.selectionRing.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(target.hostile ? 0xcc2222 : 0xd4af37);
      if (!this.lowGfx) ringMat.color.multiplyScalar(SELECTION_RING_BOOST); // subtle bloom edge
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }

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
    // fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; the grass ring follows the player
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.propsView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.foliage.update(p.pos.x, p.pos.z, this.camera.position.x, this.camera.position.z, fogFar);

    this.vfx.update(dt);

    this.updateCamera(alpha);
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
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = this.fogState === 'outdoor';
    }
    this.updateGodRays();

    this.updateNameplates();
    this.updateChatBubbles();
    if (this.post) this.post.render();
    else this.webgl.render(this.scene, this.camera);
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

  private updateCamera(alpha: number): void {
    const p = this.sim.player;
    const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
    const py = p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha;
    const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
    const eyeY = py + 2.0;
    let cx = px - Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = eyeY + Math.sin(this.camPitch) * this.camDist;
    let cz = pz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    // The Ashen Coliseum is a small enclosed pit and the combatants spawn only
    // ~6yd from the end walls, so the 12yd chase cam would otherwise sit outside
    // the walls looking in. Keep it inside the room's interior box.
    if (isArenaPos(p.pos.x)) {
      const o = arenaOriginAt(p.pos.z);
      const m = 2; // clearance from the wall faces
      cx = Math.min(Math.max(cx, o.x - DUNGEON_WALL_X + m), o.x + DUNGEON_WALL_X - m);
      cz = Math.min(Math.max(cz, o.z + ARENA_LAYOUT.zMin + m), o.z + ARENA_LAYOUT.zMax - m);
    }
    const groundY = groundHeight(cx, cz, this.sim.cfg.seed) + 0.6;
    this.camera.position.set(cx, Math.max(cy, groundY), cz);
    this.camera.lookAt(px, eyeY, pz);
    this.camera.updateMatrixWorld();
  }

  private updateNameplates(): void {
    const sim = this.sim;
    const p = sim.player;
    const { width: w, height: h } = this.viewport;
    for (const e of sim.entities.values()) {
      const v = this.views.get(e.id);
      if (!v) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const isSelf = e.id === p.id;
      const isDoor = e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit';
      const hidden = isSelf || dist > NAMEPLATE_RANGE
        || (e.dead && !e.lootable && e.kind === 'mob')
        || (e.kind === 'object' && !isDoor)
        || (!this.showNameplates && e.kind === 'mob' && !e.dead);
      if (hidden) {
        v.nameplate.style.display = 'none';
        continue;
      }
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale + 0.5;
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        v.nameplate.style.display = 'none';
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) { v.nameplate.style.display = 'none'; continue; }
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      v.nameplate.style.display = '';
      v.nameplate.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;

      // party raid/target marker (only mobs are markable, so this is null elsewhere)
      const raidMark = this.sim.markerFor(e.id);
      if (raidMark !== null) {
        v.raidMarkEl.style.backgroundImage = `url(${raidMarkerDataUrl(raidMark)})`;
        v.raidMarkEl.style.display = '';
      } else {
        v.raidMarkEl.style.display = 'none';
      }

      if (e.kind === 'object') {
        // dungeon doorways announce themselves
        v.nameEl.style.color = '#c084ff';
        v.nameEl.textContent = e.name;
        v.hpBar.style.display = 'none';
        v.markerEl.textContent = '';
      } else if (e.kind === 'player') {
        // other players: friendly blue with an hp bar
        v.nameEl.style.color = '#7fb8ff';
        v.nameEl.textContent = `${e.name}`;
        v.nameplate.style.opacity = e.auras.some((a) => a.kind === 'stealth') ? '0.55' : '1';
        v.hpBar.style.display = e.dead ? 'none' : '';
        v.hpFill.style.width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
        v.markerEl.textContent = '';
      } else if (e.kind === 'npc') {
        v.nameEl.style.color = '#9fdc7f';
        v.nameEl.textContent = e.name;
        v.hpBar.style.display = 'none';
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
        v.markerEl.textContent = marker;
        v.markerEl.className = 'np-marker ' + cls;
      } else {
        const diff = e.level - p.level;
        const template = MOBS[e.templateId];
        const elite = !!template?.elite;
        v.nameEl.style.color = e.dead ? '#999' : diff >= 3 ? '#ff4444' : diff >= 1 ? '#ffaa33' : diff >= -2 ? '#ffe97a' : diff >= -5 ? '#7fdc4f' : '#9d9d9d';
        v.nameEl.textContent = e.dead ? `${e.name} (corpse)` : `[${e.level}${elite ? '+' : ''}] ${e.name}`;
        v.hpBar.style.display = e.dead ? 'none' : '';
        v.hpFill.style.width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
        v.markerEl.textContent = e.lootable ? '$' : elite && !e.dead ? '◆' : '';
        v.markerEl.className = 'np-marker loot';
      }
    }
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
      b.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
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
