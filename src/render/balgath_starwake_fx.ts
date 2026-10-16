// Wake of the Fallen Star, on the ground and in the air (the mechanic:
// src/sim/mob/boss_starwake.ts; the curves: balgath_starwake_fx_core.ts).
//
// Composed by BalgathFx (balgath_fx.ts), which owns routing, the shared dust, ring and
// shake; this module owns:
//
//  - THE STAR      While he winds up, glowing star crystals push up round the fallen star
//                  in his crater (the Blender kit, balgath_starwake_kit.ts), a column of
//                  light stands over it that the whole fight can see from any picket, and
//                  shockwaves pulse off it faster and faster toward the eruption.
//  - FISSURES      Each path goes down at once as a dark scorched strip with glowing edges
//                  (so the whole path is readable from the first frame), then a molten fill
//                  and a jagged bright crack crawl from its origin to its tip, and the strip
//                  heats up through the hold. On the eruption a fuse of lava spouts runs
//                  down it, and a short cooling scar is left (darker than a pool, and gone
//                  in a second and a half, so it never reads as a hazard).
//  - GEYSERS       A draped circle that fills to its rim on the eruption; then a lava
//                  column bursts out of it, flinging molten chunks, over the shared dust.
//  - POOLS         Where a geyser burst: a crust-dark disc, a flickering molten glow, a hot
//                  rim and floating crust plates, at full strength until the moment the
//                  pool stops burning.
//
// Every telegraph and every pool is actionable information and is drawn on EVERY graphics
// preset (the gameplay-neutral-graphics invariant); the quality knob scales only the
// spouts, the chunks and the shared dust. Reduced motion stills the beats and the
// wobble and keeps every fill, since a fill IS a timer.
//
// GPU: the five material kinds live in one module-level bundle registered as a boot
// prewarm source (ability_material_prewarm.ts); every live piece draws a CLONE of one of
// them on a geometry with the attribute set the stand-in carries, so no cast ever links a
// program inside a combat frame.

import * as THREE from 'three';
import {
  drapedSector,
  drapedStrip,
  type GroundAt,
  LIFT,
  leadingEdge,
  withOrder,
} from './balgath_ranged_fx';
import {
  chunkBudget,
  chunkPosition,
  crackJag,
  crawlFraction,
  fissureHeat,
  poolSpread,
  poolStrength,
  type SpoutShape,
  STARWAKE_CHUNK_SECONDS,
  STARWAKE_COLUMN_SECONDS,
  STARWAKE_CRAWL_SECONDS,
  STARWAKE_FISSURE_HALF_WIDTH,
  STARWAKE_FISSURE_TRAUMA,
  STARWAKE_FLARE_DECAY,
  STARWAKE_GEYSER_TRAUMA,
  STARWAKE_METEOR_TRAUMA,
  STARWAKE_POOL_FADE,
  STARWAKE_SCAR_SECONDS,
  STARWAKE_SPEW_LINGER,
  STARWAKE_SPOUT_SECONDS,
  STARWAKE_STAR_AFTERGLOW,
  STARWAKE_WAKE_TRAUMA,
  spoutBudget,
  spoutDelay,
  spoutDistances,
  spoutShape,
  starGlow,
  starPulseDue,
} from './balgath_starwake_fx_core';
import {
  BALGATH_LAVA_CHUNKS,
  BALGATH_POOL_CRUSTS,
  BALGATH_STAR_CRYSTALS,
  balgathGeyserColumnGeometry,
  balgathLavaChunkGeometry,
  balgathPoolCrustGeometry,
  balgathStarCrystalGeometry,
} from './balgath_starwake_kit';
import { MIREFEN_IMPACT_SITE } from './impact_site';

// ---- palette -----------------------------------------------------------------------
// Molten orange on scorched black: hotter and redder than the Boulder Toss amber, so a
// lava mark never reads as a boulder mark.
const SCORCH = 0x1a0703;
const LAVA_FILL = 0xff4d12;
const LAVA_EDGE = 0xff8a2a;
const LAVA_HOT = 0xffd27a;
const GEYSER_RIM = 0xffc45a;
const POOL_CRUST = 0x2a0d05;
const POOL_GLOW = 0xff5a14;
const POOL_RIM = 0xffb050;
const STAR_LIGHT = 0xffc27a;
const STAR_CORE = 0xfff0c8;
const SCAR = 0x7a1e06;

// ---- the one material bundle -------------------------------------------------------

export interface BalgathStarwakeMaterials {
  /** Dark, normal-blended ground base under every bright line. */
  groundBase: THREE.MeshBasicMaterial;
  /** Additive ground fills, edges, cracks, rims and pool glow. */
  groundGlow: THREE.MeshBasicMaterial;
  /** Additive airborne pieces: the star's light column and shockwaves. */
  airGlow: THREE.MeshBasicMaterial;
  /** Vertex-coloured, unlit, fading: the star crystals and the lava columns. */
  lava: THREE.MeshBasicMaterial;
  /** Vertex-coloured lit rock: the flung chunks and the floating crust plates. */
  rock: THREE.MeshStandardMaterial;
}

let balgathStarwakeMats: BalgathStarwakeMaterials | null = null;

export function balgathStarwakeMaterials(): BalgathStarwakeMaterials {
  if (balgathStarwakeMats) return balgathStarwakeMats;
  const glow = (): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  const groundGlow = glow();
  groundGlow.polygonOffset = true;
  groundGlow.polygonOffsetFactor = -4;
  groundGlow.polygonOffsetUnits = -4;
  const groundBase = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  balgathStarwakeMats = {
    groundBase,
    groundGlow,
    airGlow: glow(),
    lava: new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    }),
    rock: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    }),
  };
  return balgathStarwakeMats;
}

/**
 * The boot prewarm stand-in: one hidden mesh per (material, geometry kind) pair the live
 * pieces draw, so every program a live cast links is linked behind the loading cover. The
 * draped pieces are position-only; the light column and shockwaves carry normals (a
 * CylinderGeometry); the kit pieces carry position, normal and colour.
 */
export function buildBalgathStarwakeStandIn(): THREE.Group {
  const m = balgathStarwakeMaterials();
  const group = new THREE.Group();
  group.name = 'balgath-starwake-standin';
  const draped = drapedSector(() => 0, 0, 0, 0, 1, 0, Math.PI, 1, 8);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  group.add(
    new THREE.Mesh(draped, m.groundBase),
    new THREE.Mesh(draped, m.groundGlow),
    new THREE.Mesh(cylinder, m.airGlow),
    new THREE.Mesh(balgathGeyserColumnGeometry(), m.lava),
  );
  // EVERY kit piece, not one of each: the program is shared, but each geometry's buffers
  // upload on its first draw, and the wake and eruption frames should upload none.
  for (let i = 0; i < BALGATH_STAR_CRYSTALS; i++) {
    group.add(new THREE.Mesh(balgathStarCrystalGeometry(i), m.lava));
  }
  for (let i = 0; i < BALGATH_LAVA_CHUNKS; i++) {
    group.add(new THREE.Mesh(balgathLavaChunkGeometry(i), m.rock));
  }
  for (let i = 0; i < BALGATH_POOL_CRUSTS; i++) {
    group.add(new THREE.Mesh(balgathPoolCrustGeometry(i), m.rock));
  }
  group.visible = false;
  return group;
}

// ---- live pieces -------------------------------------------------------------------

interface Owned {
  group: THREE.Group;
  /** Clones this piece owns and disposes; the kit and unit geometries are shared. */
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

interface Star extends Owned {
  sourceId: number;
  elapsed: number;
  total: number;
  crystals: THREE.Mesh[];
  crystalMat: THREE.MeshBasicMaterial;
  column: THREE.Mesh;
  core: THREE.Mesh;
  columnMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
  pool: THREE.Mesh;
  poolMat: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
  rumbled: number;
  /** Seconds past the eruption the star keeps spewing for its meteor shower (0: none). */
  spew: number;
  /** The last wave's flare, 1 on the call and dying away (STARWAKE_FLARE_DECAY). */
  flare: number;
}

interface Shockwave extends Owned {
  mat: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  elapsed: number;
}

interface FissureMark extends Owned {
  sourceId: number;
  ox: number;
  oz: number;
  dirX: number;
  dirZ: number;
  length: number;
  elapsed: number;
  total: number;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  crack: THREE.Mesh;
  crackMat: THREE.MeshBasicMaterial;
  edgeMat: THREE.MeshBasicMaterial;
}

interface GeyserMark extends Owned {
  sourceId: number;
  x: number;
  z: number;
  radius: number;
  elapsed: number;
  total: number;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  rimMat: THREE.MeshBasicMaterial;
}

interface Spout extends Owned {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  delay: number;
  elapsed: number;
  life: number;
  height: number;
  width: number;
}

interface Scar extends Owned {
  mat: THREE.MeshBasicMaterial;
  elapsed: number;
}

interface Chunk {
  mesh: THREE.Mesh;
  origin: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
  spin: THREE.Vector3;
  groundY: number;
}

interface ChunkBurst extends Owned {
  chunks: Chunk[];
  elapsed: number;
}

interface Pool extends Owned {
  sourceId: number;
  x: number;
  z: number;
  radius: number;
  elapsed: number;
  life: number;
  disc: THREE.Group;
  baseMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  rimMat: THREE.MeshBasicMaterial;
  crusts: THREE.Mesh[];
  seed: number;
}

/** What the starwake layer needs from its owner: the shared dust, ring and shake. */
export interface BalgathStarwakeHooks {
  felt(trauma: number, x: number, z: number): void;
  ground(x: number, z: number, radius: number, power: number): void;
  ring(x: number, z: number, radius: number, power: number): void;
}

/** The entity shape read each frame (only a Balgath body's id and death matter here). */
export interface StarwakeBody {
  id: number;
  dead?: boolean;
}

const MAX_CHUNK_BURSTS = 16;

/** Rows of the jagged crack down a fissure: one per yard and a half. */
function crackRows(length: number): number {
  return Math.max(1, Math.ceil(length / 1.5));
}

export class BalgathStarwakeFx {
  private stars: Star[] = [];
  private waves: Shockwave[] = [];
  private fissures: FissureMark[] = [];
  private geysers: GeyserMark[] = [];
  private spouts: Spout[] = [];
  private scars: Scar[] = [];
  private bursts: ChunkBurst[] = [];
  private pools: Pool[] = [];
  private dead = new Set<number>();
  private clock = 0;
  private quality = 1;
  private unitCylinder: THREE.CylinderGeometry | null = null;
  /** Frame-loop scratch for the pure core's outputs (no per-frame allocation). */
  private readonly shape: SpoutShape = { height: 0, width: 0 };
  private readonly chunkAt = { x: 0, y: 0, z: 0 };

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: GroundAt,
    private hooks: BalgathStarwakeHooks,
  ) {}

  /** Cosmetic density knob (0..1): spouts and chunks only, never a telegraph or a pool. */
  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, level));
  }

  /** Start a frame's intake of Balgath bodies. */
  beginFrame(): void {
    this.dead.clear();
  }

  /** One Balgath body from the owner's world walk. A felled one's pools stop burning. */
  note(e: StarwakeBody): void {
    if (e.dead) this.dead.add(e.id);
  }

  // ---- the star -----------------------------------------------------------------------

  /** The star wakes for `total` seconds (the whole wind-up, to the eruption). */
  wake(sourceId: number, x: number, z: number, total: number): void {
    const m = balgathStarwakeMaterials();
    // The event names the crater; the star itself is the meteor the site draws in it.
    const nearSite = Math.hypot(x - MIREFEN_IMPACT_SITE.x, z - MIREFEN_IMPACT_SITE.z) < 4;
    const sx = nearSite ? MIREFEN_IMPACT_SITE.meteor.x : x;
    const sz = nearSite ? MIREFEN_IMPACT_SITE.meteor.z : z;
    const sy = this.groundHeightAt(sx, sz);
    const group = new THREE.Group();
    group.name = 'balgath-starwake-star';
    const crystalMat = m.lava.clone();
    const crystals: THREE.Mesh[] = [];
    for (let i = 0; i < BALGATH_STAR_CRYSTALS; i++) {
      const a = (i / BALGATH_STAR_CRYSTALS) * Math.PI * 2 + 0.4;
      const r = 1.3 + (i % 3) * 0.55;
      const mesh = new THREE.Mesh(balgathStarCrystalGeometry(i), crystalMat);
      mesh.position.set(sx + Math.sin(a) * r, sy - 0.2, sz + Math.cos(a) * r);
      // Leaning OUT from the star, as if it burst up through the crust round it.
      mesh.rotation.set(Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35);
      mesh.userData.size = 1.6 + (i % 2) * 0.7;
      mesh.renderOrder = 5;
      crystals.push(mesh);
      group.add(mesh);
    }
    const columnMat = m.airGlow.clone();
    columnMat.color.setHex(STAR_LIGHT);
    columnMat.opacity = 0;
    const coreMat = m.airGlow.clone();
    coreMat.color.setHex(STAR_CORE);
    coreMat.opacity = 0;
    const column = new THREE.Mesh(this.cylinder(), columnMat);
    const core = new THREE.Mesh(this.cylinder(), coreMat);
    column.renderOrder = 6;
    core.renderOrder = 7;
    group.add(column, core);
    const poolMat = m.groundGlow.clone();
    poolMat.color.setHex(LAVA_FILL);
    poolMat.opacity = 0;
    const poolGeo = drapedSector(this.groundHeightAt, sx, sz, 0, 6, 0, Math.PI, 1, 40);
    const pool = withOrder(new THREE.Mesh(poolGeo, poolMat), 2);
    group.add(pool);
    this.scene.add(group);
    this.stars.push({
      group,
      mats: [crystalMat, columnMat, coreMat, poolMat],
      geos: [poolGeo],
      sourceId,
      elapsed: 0,
      total: Math.max(0.5, total),
      crystals,
      crystalMat,
      column,
      core,
      columnMat,
      coreMat,
      pool,
      poolMat,
      x: sx,
      y: sy,
      z: sz,
      rumbled: 0,
      spew: 0,
      flare: 0,
    });
    this.hooks.ground(sx, sz, 4, 0.9);
  }

  // ---- the meteor shower (Star Debris) --------------------------------------------------
  // The meteors are Ignivar's and mage_ground_fx.ts draws them, circle, fall and landing,
  // unchanged. These two riders tie them to the fight: the crater spews each wave up, and
  // the ground jolts under each landing like the rest of his blows. Neither allocates a
  // material: the flare rides the star's own, the dust and the jolt are the shared hooks.

  /** A wave of the shower was called: the star keeps blazing and flares, the crater spits. */
  meteorCalled(sourceId: number): void {
    for (const s of this.stars) {
      if (s.sourceId !== sourceId) continue;
      s.spew = Math.max(s.spew, s.elapsed - s.total + STARWAKE_SPEW_LINGER);
      if (s.flare < 0.5) this.hooks.ground(s.x, s.z, 3, 0.55 * this.quality);
      s.flare = 1;
    }
  }

  /** One Star Debris meteor landed: the jolt and the thrown ground of a heavy impact. */
  meteorLanded(x: number, z: number, radius: number): void {
    this.hooks.felt(STARWAKE_METEOR_TRAUMA, x, z);
    this.hooks.ground(x, z, radius, 0.8);
  }

  private shockwave(x: number, y: number, z: number): void {
    const mat = balgathStarwakeMaterials().airGlow.clone();
    mat.color.setHex(LAVA_EDGE);
    mat.opacity = 0;
    const mesh = new THREE.Mesh(this.cylinder(), mat);
    mesh.position.set(x, y + 0.6, z);
    mesh.renderOrder = 6;
    const group = new THREE.Group();
    group.add(mesh);
    this.scene.add(group);
    this.waves.push({ group, mats: [mat], geos: [], mat, mesh, elapsed: 0 });
  }

  // ---- fissures -----------------------------------------------------------------------

  fissureTelegraph(
    sourceId: number,
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    length: number,
    total: number,
  ): void {
    const m = balgathStarwakeMaterials();
    const ground = this.groundHeightAt;
    const hw = STARWAKE_FISSURE_HALF_WIDTH;
    const group = new THREE.Group();
    group.name = 'balgath-starwake-fissure';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(SCORCH);
    baseMat.opacity = 0.62;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(LAVA_FILL);
    fillMat.opacity = 0.35;
    const edgeMat = m.groundGlow.clone();
    edgeMat.color.setHex(LAVA_EDGE);
    const leadMat = m.groundGlow.clone();
    leadMat.color.setHex(LAVA_HOT);
    const crackMat = m.groundGlow.clone();
    crackMat.color.setHex(LAVA_HOT);
    crackMat.opacity = 0.5;
    const base = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, -hw, hw, 2, LIFT - 0.02);
    // Two-yard bands: fine enough for the crawl to read as continuous, and it keeps the
    // whole pattern's drape to a few hundred terrain samples in the frame it arrives.
    const fillGeo = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, -hw * 0.8, hw * 0.8, 2);
    const edgeA = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, hw - 0.3, hw, 2, LIFT + 0.02);
    const edgeB = drapedStrip(
      ground,
      ox,
      oz,
      dirX,
      dirZ,
      0,
      length,
      -hw,
      -hw + 0.3,
      2,
      LIFT + 0.02,
    );
    const cap = drapedStrip(
      ground,
      ox,
      oz,
      dirX,
      dirZ,
      length - 0.4,
      length,
      -hw,
      hw,
      1,
      LIFT + 0.02,
    );
    const crackGeo = this.crackGeometry(ox, oz, dirX, dirZ, length);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.bands = Math.max(1, Math.ceil(length / 2));
    fill.userData.segs = 1;
    const lead = leadingEdge(fill, fillGeo, leadMat);
    const crack = withOrder(new THREE.Mesh(crackGeo, crackMat), 4);
    crack.userData.bands = crackRows(length);
    crack.userData.segs = 1;
    // Hidden until the first frame reveals them, never drawn whole for a frame.
    this.reveal(fill, 0);
    this.reveal(crack, 0);
    group.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(fill, 2),
      lead,
      withOrder(new THREE.Mesh(edgeA, edgeMat), 3),
      withOrder(new THREE.Mesh(edgeB, edgeMat), 3),
      withOrder(new THREE.Mesh(cap, edgeMat), 3),
      crack,
    );
    this.scene.add(group);
    this.fissures.push({
      group,
      mats: [baseMat, fillMat, edgeMat, leadMat, crackMat],
      geos: [base, fillGeo, lead.geometry, edgeA, edgeB, cap, crackGeo],
      sourceId,
      ox,
      oz,
      dirX,
      dirZ,
      length,
      elapsed: 0,
      total: Math.max(STARWAKE_CRAWL_SECONDS, total),
      fill,
      fillMat,
      crack,
      crackMat,
      edgeMat,
    });
  }

  /** A jagged bright crack down the strip's centre, one row per yard, draped. */
  private crackGeometry(
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    length: number,
  ): THREE.BufferGeometry {
    const rows = crackRows(length);
    const px = dirZ;
    const pz = -dirX;
    const salt = Math.round(Math.atan2(dirX, dirZ) * 1000);
    const positions = new Float32Array((rows + 1) * 2 * 3);
    let o = 0;
    for (let r = 0; r <= rows; r++) {
      const d = (length * r) / rows;
      const wob = crackJag(r, salt) * 0.9;
      // The crack narrows toward its tip and is widest where it leaves the ground.
      const half = 0.42 * (1 - 0.5 * (r / rows)) + 0.08;
      for (const side of [-1, 1]) {
        const off = wob + side * half;
        const x = ox + dirX * d + px * off;
        const z = oz + dirZ * d + pz * off;
        positions[o++] = x;
        positions[o++] = this.groundHeightAt(x, z) + LIFT + 0.04;
        positions[o++] = z;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      const a = r * 2;
      index.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }

  /** The strip bursts: a fuse of spouts runs down it, then a short cooling scar. */
  fissureErupted(
    sourceId: number,
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    length: number,
  ): void {
    this.retireNearest(
      this.fissures,
      (f) =>
        f.sourceId === sourceId &&
        Math.hypot(f.ox - ox, f.oz - oz) < 0.5 &&
        Math.abs(f.dirX - dirX) + Math.abs(f.dirZ - dirZ) < 0.01,
    );
    const m = balgathStarwakeMaterials();
    const all = spoutDistances(length);
    const keep = spoutBudget(all.length, this.quality);
    const stride = all.length / keep;
    for (let k = 0; k < keep; k++) {
      const d = all[Math.min(all.length - 1, Math.floor(k * stride))];
      const x = ox + dirX * d;
      const z = oz + dirZ * d;
      this.spout(
        x,
        z,
        0.9 + 0.25 * ((k * 7) % 3),
        2.6 + (1.6 * ((k * 5) % 3)) / 2,
        spoutDelay(d, length),
      );
    }
    // Dust at three points down the crack (the shared layer scales its own density).
    for (const f of [0.2, 0.55, 0.9]) {
      this.hooks.ground(ox + dirX * length * f, oz + dirZ * length * f, 3, 0.8);
    }
    const scarMat = m.groundGlow.clone();
    scarMat.color.setHex(SCAR);
    scarMat.opacity = 0.5;
    const scarGeo = drapedStrip(
      this.groundHeightAt,
      ox,
      oz,
      dirX,
      dirZ,
      0,
      length,
      -0.9,
      0.9,
      2,
      LIFT + 0.03,
    );
    const group = new THREE.Group();
    group.add(withOrder(new THREE.Mesh(scarGeo, scarMat), 2));
    this.scene.add(group);
    this.scars.push({ group, mats: [scarMat], geos: [scarGeo], mat: scarMat, elapsed: 0 });
    const mid = length / 2;
    this.hooks.felt(STARWAKE_FISSURE_TRAUMA, ox + dirX * mid, oz + dirZ * mid);
  }

  private spout(x: number, z: number, width: number, height: number, delay: number): void {
    const mat = balgathStarwakeMaterials().lava.clone();
    const mesh = new THREE.Mesh(balgathGeyserColumnGeometry(), mat);
    mesh.position.set(x, this.groundHeightAt(x, z) - 0.1, z);
    mesh.scale.set(0.001, 0.001, 0.001);
    mesh.visible = false;
    mesh.rotation.y = (x * 3.1 + z * 1.7) % (Math.PI * 2);
    mesh.renderOrder = 5;
    const group = new THREE.Group();
    group.add(mesh);
    this.scene.add(group);
    this.spouts.push({
      group,
      mats: [mat],
      geos: [],
      mesh,
      mat,
      delay,
      elapsed: 0,
      life: STARWAKE_SPOUT_SECONDS,
      height,
      width,
    });
  }

  // ---- geysers ------------------------------------------------------------------------

  geyserTelegraph(sourceId: number, x: number, z: number, radius: number, total: number): void {
    const m = balgathStarwakeMaterials();
    const ground = this.groundHeightAt;
    const group = new THREE.Group();
    group.name = 'balgath-starwake-geyser';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(SCORCH);
    baseMat.opacity = 0.55;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(LAVA_FILL);
    fillMat.opacity = 0.4;
    const rimMat = m.groundGlow.clone();
    rimMat.color.setHex(GEYSER_RIM);
    const leadMat = m.groundGlow.clone();
    leadMat.color.setHex(LAVA_HOT);
    const base = drapedSector(ground, x, z, 0, radius, 0, Math.PI, 1, 32, LIFT - 0.02);
    const fillGeo = drapedSector(ground, x, z, 0, radius, 0, Math.PI, 10, 32);
    const rimGeo = drapedSector(
      ground,
      x,
      z,
      radius - 0.38,
      radius,
      0,
      Math.PI,
      1,
      64,
      LIFT + 0.02,
    );
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.bands = 10;
    fill.userData.segs = 32;
    const lead = leadingEdge(fill, fillGeo, leadMat);
    this.reveal(fill, 0);
    group.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(fill, 2),
      lead,
      withOrder(new THREE.Mesh(rimGeo, rimMat), 3),
    );
    this.scene.add(group);
    this.geysers.push({
      group,
      mats: [baseMat, fillMat, rimMat, leadMat],
      geos: [base, fillGeo, lead.geometry, rimGeo],
      sourceId,
      x,
      z,
      radius,
      elapsed: 0,
      total: Math.max(0.5, total),
      fill,
      fillMat,
      rimMat,
    });
  }

  /** The geyser bursts: a lava column, flung chunks, dust, a jolt, and its pool. */
  geyserErupted(sourceId: number, x: number, z: number, radius: number, poolSeconds: number): void {
    this.retireNearest(
      this.geysers,
      (g) => g.sourceId === sourceId && Math.hypot(g.x - x, g.z - z) < 0.5,
    );
    this.spout(x, z, radius * 0.42, radius * 2.4, 0);
    const spouted = this.spouts[this.spouts.length - 1];
    spouted.life = STARWAKE_COLUMN_SECONDS;
    this.fling(x, z, radius);
    this.hooks.ground(x, z, radius, 1.1);
    this.hooks.ring(x, z, radius, 0.7);
    this.hooks.felt(STARWAKE_GEYSER_TRAUMA, x, z);
    if (poolSeconds > 0) this.pool(sourceId, x, z, radius, poolSeconds);
  }

  private fling(x: number, z: number, radius: number): void {
    if (this.bursts.length >= MAX_CHUNK_BURSTS) this.retire(this.bursts, 0);
    const m = balgathStarwakeMaterials();
    const group = new THREE.Group();
    const gy = this.groundHeightAt(x, z);
    const chunks: Chunk[] = [];
    const n = chunkBudget(this.quality);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (x + z) * 0.37;
      const out = 3 + ((i * 7) % 4);
      const mesh = new THREE.Mesh(balgathLavaChunkGeometry(i % BALGATH_LAVA_CHUNKS), m.rock);
      mesh.scale.setScalar(0.9 + (i % 3) * 0.35);
      mesh.position.set(x, gy + 1, z);
      group.add(mesh);
      chunks.push({
        mesh,
        origin: { x, y: gy + 1, z },
        v: {
          x: Math.sin(a) * out * (radius / 4),
          y: 9 + (i % 3) * 2.5,
          z: Math.cos(a) * out * (radius / 4),
        },
        spin: new THREE.Vector3(3 + i, 2.2, 1.4 - i * 0.3),
        groundY: gy,
      });
    }
    this.scene.add(group);
    // The chunks share the bundle's rock material and the kit geometry: nothing to dispose.
    this.bursts.push({ group, mats: [], geos: [], chunks, elapsed: 0 });
  }

  // ---- pools --------------------------------------------------------------------------

  private pool(sourceId: number, x: number, z: number, radius: number, life: number): void {
    const m = balgathStarwakeMaterials();
    const ground = this.groundHeightAt;
    const group = new THREE.Group();
    group.name = 'balgath-starwake-pool';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(POOL_CRUST);
    baseMat.opacity = 0;
    const glowMat = m.groundGlow.clone();
    glowMat.color.setHex(POOL_GLOW);
    glowMat.opacity = 0;
    const rimMat = m.groundGlow.clone();
    rimMat.color.setHex(POOL_RIM);
    rimMat.opacity = 0;
    // Drawn at the pool's TRUE radius from the first frame (the spread is only the glow's
    // opacity ramp): the area that burns is the area shown.
    const base = drapedSector(ground, x, z, 0, radius, 0, Math.PI, 1, 36, LIFT - 0.01);
    const glow = drapedSector(ground, x, z, 0, radius * 0.92, 0, Math.PI, 2, 36, LIFT + 0.01);
    const rim = drapedSector(ground, x, z, radius - 0.45, radius, 0, Math.PI, 1, 48, LIFT + 0.03);
    const disc = new THREE.Group();
    disc.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(new THREE.Mesh(glow, glowMat), 2),
      withOrder(new THREE.Mesh(rim, rimMat), 3),
    );
    group.add(disc);
    const crusts: THREE.Mesh[] = [];
    const count = Math.min(BALGATH_POOL_CRUSTS, 2 + Math.floor(radius / 2));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + x * 0.21;
      const r = radius * (0.25 + (0.4 * ((i * 3) % 4)) / 3);
      const cx = x + Math.sin(a) * r;
      const cz = z + Math.cos(a) * r;
      const mesh = new THREE.Mesh(balgathPoolCrustGeometry(i), m.rock);
      const s = radius * (0.32 + 0.08 * (i % 2));
      mesh.scale.set(s, s * 0.6, s);
      mesh.position.set(cx, ground(cx, cz) + LIFT + 0.05, cz);
      mesh.rotation.y = a * 1.7;
      mesh.userData.baseX = cx;
      mesh.userData.baseZ = cz;
      crusts.push(mesh);
      group.add(mesh);
    }
    this.scene.add(group);
    this.pools.push({
      group,
      mats: [baseMat, glowMat, rimMat],
      geos: [base, glow, rim],
      sourceId,
      x,
      z,
      radius,
      elapsed: 0,
      life,
      disc,
      baseMat,
      glowMat,
      rimMat,
      crusts,
      seed: (x * 13.1 + z * 7.3) % 10,
    });
  }

  /** How many pools are on the ground right now (a probe and test read). */
  livePools(): number {
    return this.pools.length;
  }

  /** How many stars are lit right now (waking, spewing for a shower, or in afterglow). */
  liveStars(): number {
    return this.stars.length;
  }

  /** How many fissure and geyser telegraphs are on the ground right now. */
  liveTelegraphs(): number {
    return this.fissures.length + this.geysers.length;
  }

  // ---- the frame ----------------------------------------------------------------------

  update(dt: number, reducedMotion: boolean): void {
    this.clock += dt;
    this.updateStars(dt, reducedMotion);
    this.updateWaves(dt);
    this.updateFissures(dt, reducedMotion);
    this.updateGeysers(dt, reducedMotion);
    this.updateSpouts(dt);
    this.updateScars(dt);
    this.updateBursts(dt, reducedMotion);
    this.updatePools(dt, reducedMotion);
  }

  private updateStars(dt: number, reducedMotion: boolean): void {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      const prev = s.elapsed;
      s.elapsed += dt;
      if (s.elapsed >= s.total + s.spew + STARWAKE_STAR_AFTERGLOW || this.dead.has(s.sourceId)) {
        this.retire(this.stars, i);
        continue;
      }
      s.flare = Math.max(0, s.flare - dt * STARWAKE_FLARE_DECAY);
      const flare = reducedMotion ? 0 : s.flare;
      const glow = starGlow(s.elapsed, s.total, reducedMotion, s.spew);
      // The crystals push up out of the crust over the first second and sink back with the
      // afterglow; their colour is the glow itself.
      const rise = Math.min(1, s.elapsed / 1) * (s.elapsed > s.total + s.spew ? glow : 1);
      for (const c of s.crystals) {
        const size = Number(c.userData.size ?? 1.8);
        c.scale.set(size * rise, size * rise, size * rise);
      }
      s.crystalMat.color.setScalar(0.35 + 0.65 * glow);
      s.crystalMat.opacity = Math.min(1, 0.2 + rise);
      // The light column: tall enough to see over the crater rim from any picket.
      const h = 46;
      s.column.position.set(s.x, s.y + h / 2, s.z);
      // A wave's flare throws the column wider and brighter for a moment: the crater
      // spitting the next handful of the sky back up.
      const wide = 1.5 + 0.5 * glow + 1.6 * flare;
      s.column.scale.set(wide, h, wide);
      s.columnMat.opacity = Math.min(1, 0.22 * glow + 0.22 * flare);
      s.core.position.set(s.x, s.y + h / 2, s.z);
      s.core.scale.set(0.45 + 0.5 * flare, h, 0.45 + 0.5 * flare);
      s.coreMat.opacity = Math.min(1, 0.5 * glow + 0.35 * flare);
      s.poolMat.opacity = 0.55 * glow;
      if (!reducedMotion && starPulseDue(prev, s.elapsed, s.total)) this.shockwave(s.x, s.y, s.z);
      // A low rumble under the fight, once a second while it wakes.
      if (s.elapsed <= s.total && Math.floor(s.elapsed) > s.rumbled) {
        s.rumbled = Math.floor(s.elapsed);
        this.hooks.felt(STARWAKE_WAKE_TRAUMA, s.x, s.z);
      }
    }
  }

  private updateWaves(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.elapsed += dt;
      const life = 1.1;
      if (w.elapsed >= life) {
        this.retire(this.waves, i);
        continue;
      }
      const t = w.elapsed / life;
      const r = 2 + 22 * (1 - (1 - t) * (1 - t));
      w.mesh.scale.set(r, 1.4 * (1 - t) + 0.2, r);
      w.mat.opacity = 0.5 * (1 - t);
    }
  }

  private updateFissures(dt: number, reducedMotion: boolean): void {
    for (let i = this.fissures.length - 1; i >= 0; i--) {
      const f = this.fissures[i];
      f.elapsed += dt;
      // A small grace past the eruption in case its event arrives a frame late.
      if (f.elapsed >= f.total + 0.4 || this.dead.has(f.sourceId)) {
        this.retire(this.fissures, i);
        continue;
      }
      const crawl = crawlFraction(f.elapsed);
      this.reveal(f.fill, crawl);
      this.reveal(f.crack, crawl);
      const heat = fissureHeat(f.elapsed, f.total);
      const beat = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * (6 + 12 * heat));
      f.fillMat.opacity = 0.3 + 0.4 * heat;
      f.crackMat.opacity = 0.45 + 0.45 * heat + 0.1 * beat;
      f.edgeMat.opacity = 0.7 + 0.3 * beat;
    }
  }

  private updateGeysers(dt: number, reducedMotion: boolean): void {
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const g = this.geysers[i];
      g.elapsed += dt;
      if (g.elapsed >= g.total + 0.4 || this.dead.has(g.sourceId)) {
        this.retire(this.geysers, i);
        continue;
      }
      const t = Math.min(1, g.elapsed / g.total);
      // Grows from the centre and touches the rim on the eruption: the fill IS the timer.
      this.reveal(g.fill, 0.08 + 0.92 * t * t * (1.35 - 0.35 * t));
      g.fillMat.opacity = 0.3 + 0.35 * t;
      g.rimMat.opacity = reducedMotion
        ? 0.95
        : 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(this.clock * (4 + 10 * t)));
    }
  }

  private updateSpouts(dt: number): void {
    for (let i = this.spouts.length - 1; i >= 0; i--) {
      const s = this.spouts[i];
      s.elapsed += dt;
      const t = s.elapsed - s.delay;
      if (t >= s.life) {
        this.retire(this.spouts, i);
        continue;
      }
      // Still waiting on its fuse: not drawn at all (a hidden spout costs no draw call).
      s.mesh.visible = t >= 0;
      if (t < 0) continue;
      const shape = spoutShape(t, s.life, this.shape);
      const w = Math.max(0.001, s.width * shape.width);
      s.mesh.scale.set(w, Math.max(0.001, s.height * shape.height), w);
      s.mat.opacity = Math.min(1, 0.4 + shape.height);
    }
  }

  private updateScars(dt: number): void {
    for (let i = this.scars.length - 1; i >= 0; i--) {
      const s = this.scars[i];
      s.elapsed += dt;
      if (s.elapsed >= STARWAKE_SCAR_SECONDS) {
        this.retire(this.scars, i);
        continue;
      }
      const k = 1 - s.elapsed / STARWAKE_SCAR_SECONDS;
      s.mat.opacity = 0.5 * k * k;
    }
  }

  private updateBursts(dt: number, reducedMotion: boolean): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.elapsed += dt;
      if (b.elapsed >= STARWAKE_CHUNK_SECONDS) {
        this.retire(this.bursts, i);
        continue;
      }
      for (const c of b.chunks) {
        const p = chunkPosition(b.elapsed, c.origin, c.v, c.groundY, this.chunkAt);
        c.mesh.position.set(p.x, p.y, p.z);
        if (!reducedMotion) {
          c.mesh.rotation.x += c.spin.x * dt;
          c.mesh.rotation.y += c.spin.y * dt;
          c.mesh.rotation.z += c.spin.z * dt;
        }
      }
    }
  }

  private updatePools(dt: number, reducedMotion: boolean): void {
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.elapsed += dt;
      // A felled Foreman's pools stop burning (the sim drops them with his engaged tick),
      // so they go with him rather than lie about a hazard that no longer hurts.
      if (p.elapsed >= p.life + STARWAKE_POOL_FADE || this.dead.has(p.sourceId)) {
        this.retire(this.pools, i);
        continue;
      }
      const k = poolStrength(p.elapsed, p.life);
      const spread = poolSpread(p.elapsed);
      const flicker = reducedMotion
        ? 0.5
        : 0.5 + 0.25 * Math.sin(this.clock * 7.3 + p.seed) + 0.25 * Math.sin(this.clock * 3.1);
      p.baseMat.opacity = 0.82 * k;
      p.glowMat.opacity = (0.5 + 0.25 * flicker) * k * spread;
      p.rimMat.opacity = (0.75 + 0.25 * flicker) * k;
      if (!reducedMotion) {
        for (let j = 0; j < p.crusts.length; j++) {
          const c = p.crusts[j];
          const drift = 0.25 * Math.sin(this.clock * 0.6 + j * 2.1 + p.seed);
          const bx = Number(c.userData.baseX ?? p.x);
          const bz = Number(c.userData.baseZ ?? p.z);
          c.position.x = bx + drift;
          c.position.z = bz + 0.6 * drift;
          c.rotation.y += dt * 0.12 * (j % 2 === 0 ? 1 : -1);
        }
      }
    }
  }

  /** Reveal a fill up to `fraction`, with its bright leading band on the frontier. */
  private reveal(mesh: THREE.Mesh, fraction: number): void {
    const bands = Number(mesh.userData.bands ?? 1);
    const segs = Number(mesh.userData.segs ?? 1);
    const shown = Math.max(1, Math.round(bands * Math.min(1, fraction)));
    mesh.geometry.setDrawRange(0, shown * segs * 6);
    const lead = mesh.userData.lead as THREE.Mesh | undefined;
    lead?.geometry.setDrawRange((shown - 1) * segs * 6, segs * 6);
  }

  private cylinder(): THREE.CylinderGeometry {
    if (!this.unitCylinder) this.unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    return this.unitCylinder;
  }

  private retireNearest<T extends Owned>(list: T[], match: (item: T) => boolean): void {
    for (let i = 0; i < list.length; i++) {
      if (match(list[i])) {
        this.retire(list, i);
        return;
      }
    }
  }

  private retire<T extends Owned>(list: T[], i: number): void {
    const item = list[i];
    this.scene.remove(item.group);
    for (const mat of item.mats) mat.dispose();
    for (const geo of item.geos) geo.dispose();
    list.splice(i, 1);
  }

  clear(): void {
    for (const list of [
      this.stars,
      this.waves,
      this.fissures,
      this.geysers,
      this.spouts,
      this.scars,
      this.bursts,
      this.pools,
    ] as Owned[][]) {
      for (let i = list.length - 1; i >= 0; i--) this.retire(list, i);
    }
    this.dead.clear();
  }

  dispose(): void {
    this.clear();
    this.unitCylinder?.dispose();
    this.unitCylinder = null;
  }
}
